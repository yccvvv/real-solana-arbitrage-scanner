import { BaseDexClient, DexPoolInfo, DexPriceQuote } from '../BaseDexClient';
import { Connection, PublicKey } from '@solana/web3.js';

interface OrcaPoolData {
  account: string;
  authority: string;
  tokenMintA: string;
  tokenMintB: string;
  tokenVaultA: string;
  tokenVaultB: string;
  feeRate: number;
  protocolFeeRate: number;
  liquidity: string;
  sqrtPrice: string;
  tickCurrentIndex: number;
  protocolFeeOwedA: string;
  protocolFeeOwedB: string;
  tokenAmountA: string;
  tokenAmountB: string;
  tickSpacing: number;
  reward: any[];
}

interface OrcaToken {
  mint: string;
  symbol: string;
  name: string;
  decimals: number;
  logoURI?: string;
  coingeckoId?: string;
}

interface OrcaWhirlpool {
  address: string;
  tokenA: OrcaToken;
  tokenB: OrcaToken;
  price: number;
  liquidity: number;
  volume24h: number;
  volumeWeek: number;
  fee: number;
  apr: {
    fee: number;
    reward: number;
    total: number;
  };
  tvl: number;
  priceRange: {
    min: number;
    max: number;
  };
}

export class OrcaClient extends BaseDexClient {
  private connection: Connection;
  private poolSubscriptions: Map<string, any> = new Map();
  private poolCache: Map<string, DexPoolInfo> = new Map();
  private readonly ORCA_WHIRLPOOL_PROGRAM_ID = 'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc';

  constructor(rpcUrl: string = 'https://api.mainnet-beta.solana.com') {
    super('Orca', 'https://api.mainnet.orca.so');
    this.connection = new Connection(rpcUrl);
  }

  async connect(): Promise<void> {
    try {
      // Test connection
      await this.connection.getVersion();
      this.isConnected = true;
      console.log('[Orca] Connected successfully');
    } catch (error) {
      console.error('[Orca] Connection failed:', error);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    // Unsubscribe from all pools
    for (const [poolAddress, subscription] of this.poolSubscriptions) {
      await this.unsubscribeFromPool(poolAddress);
    }
    this.poolSubscriptions.clear();
    this.poolCache.clear();
    this.isConnected = false;
    console.log('[Orca] Disconnected');
  }

  async getPoolInfo(poolAddress: string): Promise<DexPoolInfo | null> {
    try {
      // Check cache first
      if (this.poolCache.has(poolAddress)) {
        const cached = this.poolCache.get(poolAddress)!;
        // Return cached data if less than 5 seconds old
        if (Date.now() - cached.lastUpdated < 5000) {
          return cached;
        }
      }

      // Fetch from Orca API
      const whirlpools = await this.getOrcaWhirlpools();
      const pool = whirlpools.find(p => p.address === poolAddress);
      
      if (!pool) {
        return null;
      }

      const poolInfo: DexPoolInfo = {
        poolAddress: pool.address,
        tokenA: pool.tokenA.mint,
        tokenB: pool.tokenB.mint,
        liquidity: pool.tvl,
        priceA: pool.price,
        priceB: 1 / pool.price,
        fee: pool.fee,
        lastUpdated: Date.now()
      };

      // Cache the result
      this.poolCache.set(poolAddress, poolInfo);
      return poolInfo;
    } catch (error) {
      console.error('[Orca] Failed to get pool info:', error);
      return null;
    }
  }

  async getPriceQuote(
    inputMint: string,
    outputMint: string,
    amount: number
  ): Promise<DexPriceQuote | null> {
    try {
      // Get all pools and find relevant one
      const pools = await this.getAllPools();
      const relevantPool = pools.find(pool => 
        (pool.tokenA === inputMint && pool.tokenB === outputMint) ||
        (pool.tokenA === outputMint && pool.tokenB === inputMint)
      );

      if (!relevantPool) {
        return null;
      }

      const isTokenAInput = relevantPool.tokenA === inputMint;
      const price = isTokenAInput ? relevantPool.priceA : relevantPool.priceB;
      const outputAmount = amount * price;

      // Calculate slippage based on pool liquidity
      const slippage = this.calculateSlippage(amount, relevantPool.liquidity);

      return {
        inputMint,
        outputMint,
        inputAmount: amount,
        outputAmount: outputAmount * (1 - slippage),
        price,
        slippage,
        fee: relevantPool.fee,
        timestamp: Date.now()
      };
    } catch (error) {
      console.error('[Orca] Failed to get price quote:', error);
      return null;
    }
  }

  async getAllPools(): Promise<DexPoolInfo[]> {
    try {
      const whirlpools = await this.getOrcaWhirlpools();
      
      return whirlpools.map(pool => ({
        poolAddress: pool.address,
        tokenA: pool.tokenA.mint,
        tokenB: pool.tokenB.mint,
        liquidity: pool.tvl,
        priceA: pool.price,
        priceB: 1 / pool.price,
        fee: pool.fee,
        lastUpdated: Date.now()
      }));
    } catch (error) {
      console.error('[Orca] Failed to get all pools:', error);
      return [];
    }
  }

  async subscribeToPool(poolAddress: string, callback: (pool: DexPoolInfo) => void): Promise<void> {
    try {
      if (this.poolSubscriptions.has(poolAddress)) {
        console.log(`[Orca] Already subscribed to pool: ${poolAddress}`);
        return;
      }

      const publicKey = new PublicKey(poolAddress);
      const subscriptionId = this.connection.onAccountChange(
        publicKey,
        async (accountInfo) => {
          // Parse Orca whirlpool account data
          const poolInfo = await this.getPoolInfo(poolAddress);
          if (poolInfo) {
            callback(poolInfo);
          }
        },
        'confirmed'
      );

      this.poolSubscriptions.set(poolAddress, subscriptionId);
      console.log(`[Orca] Subscribed to pool: ${poolAddress}`);
    } catch (error) {
      console.error('[Orca] Failed to subscribe to pool:', error);
      throw error;
    }
  }

  async unsubscribeFromPool(poolAddress: string): Promise<void> {
    const subscriptionId = this.poolSubscriptions.get(poolAddress);
    if (subscriptionId) {
      await this.connection.removeAccountChangeListener(subscriptionId);
      this.poolSubscriptions.delete(poolAddress);
      console.log(`[Orca] Unsubscribed from pool: ${poolAddress}`);
    }
  }

  private calculateSlippage(amount: number, liquidity: number): number {
    // Orca uses concentrated liquidity, so slippage calculation is different
    const ratio = amount / liquidity;
    if (ratio < 0.0005) return 0.0005; // 0.05%
    if (ratio < 0.005) return 0.002;   // 0.2%
    if (ratio < 0.05) return 0.008;    // 0.8%
    return 0.03; // 3% for large trades
  }

  // Orca-specific methods
  async getOrcaWhirlpools(): Promise<OrcaWhirlpool[]> {
    try {
      const response = await this.makeRequest('/v1/whirlpool/list');
      return response.whirlpools || [];
    } catch (error) {
      console.error('[Orca] Failed to get whirlpools:', error);
      return [];
    }
  }

  async getOrcaTokens(): Promise<OrcaToken[]> {
    try {
      const response = await this.makeRequest('/v1/token/list');
      return response.tokens || [];
    } catch (error) {
      console.error('[Orca] Failed to get tokens:', error);
      return [];
    }
  }

  async getOrcaPoolData(poolAddress: string): Promise<OrcaPoolData | null> {
    try {
      const response = await this.makeRequest(`/v1/whirlpool/${poolAddress}`);
      return response.data;
    } catch (error) {
      console.error('[Orca] Failed to get pool data:', error);
      return null;
    }
  }

  async getOrcaQuote(
    inputMint: string,
    outputMint: string,
    amount: number,
    slippageBps: number = 100
  ): Promise<any> {
    try {
      const response = await this.makeRequest('/v1/quote', {
        method: 'POST',
        body: JSON.stringify({
          inputMint,
          outputMint,
          amount,
          slippageBps
        })
      });
      return response;
    } catch (error) {
      console.error('[Orca] Failed to get quote:', error);
      return null;
    }
  }

  async getOrcaPoolsByTokenPair(tokenA: string, tokenB: string): Promise<OrcaWhirlpool[]> {
    try {
      const allPools = await this.getOrcaWhirlpools();
      return allPools.filter(pool => 
        (pool.tokenA.mint === tokenA && pool.tokenB.mint === tokenB) ||
        (pool.tokenA.mint === tokenB && pool.tokenB.mint === tokenA)
      );
    } catch (error) {
      console.error('[Orca] Failed to get pools by token pair:', error);
      return [];
    }
  }

  async getOrcaPoolStatistics(poolAddress: string): Promise<any> {
    try {
      const response = await this.makeRequest(`/v1/whirlpool/${poolAddress}/stats`);
      return response;
    } catch (error) {
      console.error('[Orca] Failed to get pool statistics:', error);
      return null;
    }
  }
} 