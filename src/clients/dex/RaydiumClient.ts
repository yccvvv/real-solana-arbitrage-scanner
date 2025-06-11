import { BaseDexClient, DexPoolInfo, DexPriceQuote } from '../BaseDexClient';
import { Connection, PublicKey } from '@solana/web3.js';

interface RaydiumPoolData {
  id: string;
  baseMint: string;
  quoteMint: string;
  lpMint: string;
  baseDecimals: number;
  quoteDecimals: number;
  lpDecimals: number;
  version: number;
  programId: string;
  authority: string;
  openOrders: string;
  targetOrders: string;
  baseVault: string;
  quoteVault: string;
  withdrawQueue: string;
  lpVault: string;
  marketVersion: number;
  marketProgramId: string;
  marketId: string;
  marketAuthority: string;
  marketBaseVault: string;
  marketQuoteVault: string;
  marketBids: string;
  marketAsks: string;
  marketEventQueue: string;
  lookupTableAccount: string;
}

interface RaydiumPoolInfo {
  id: string;
  mintA: {
    chainId: number;
    address: string;
    programId: string;
    logoURI: string;
    symbol: string;
    name: string;
    decimals: number;
    tags: string[];
    extensions: any;
  };
  mintB: {
    chainId: number;
    address: string;
    programId: string;
    logoURI: string;
    symbol: string;
    name: string;
    decimals: number;
    tags: string[];
    extensions: any;
  };
  price: number;
  mintAmountA: number;
  mintAmountB: number;
  feeRate: number;
  openTime: string;
  tvl: number;
  day: {
    volume: number;
    volumeQuote: number;
    volumeFee: number;
    apr: number;
    feeApr: number;
    priceMin: number;
    priceMax: number;
    rewardApr: string[];
  };
  week: {
    volume: number;
    volumeQuote: number;
    volumeFee: number;
    apr: number;
    feeApr: number;
    priceMin: number;
    priceMax: number;
    rewardApr: string[];
  };
  month: {
    volume: number;
    volumeQuote: number;
    volumeFee: number;
    apr: number;
    feeApr: number;
    priceMin: number;
    priceMax: number;
    rewardApr: string[];
  };
  pooltype: string[];
  rewardDefaultInfos: any[];
  farmUpcomingCount: number;
  farmOngoingCount: number;
  farmFinishedCount: number;
}

export class RaydiumClient extends BaseDexClient {
  private connection: Connection;
  private poolSubscriptions: Map<string, any> = new Map();
  private poolCache: Map<string, DexPoolInfo> = new Map();

  constructor(rpcUrl: string = 'https://api.mainnet-beta.solana.com') {
    super('Raydium', 'https://api.raydium.io');
    this.connection = new Connection(rpcUrl);
  }

  async connect(): Promise<void> {
    try {
      // Test connection
      await this.connection.getVersion();
      this.isConnected = true;
      console.log('[Raydium] Connected successfully');
    } catch (error) {
      console.error('[Raydium] Connection failed:', error);
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
    console.log('[Raydium] Disconnected');
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

      // Fetch from Raydium API
      const response = await this.makeRequest(`/v2/ammV3/ammPools`);
      const pools = response.data as RaydiumPoolInfo[];
      
      const pool = pools.find(p => p.id === poolAddress);
      if (!pool) {
        return null;
      }

      const poolInfo: DexPoolInfo = {
        poolAddress: pool.id,
        tokenA: pool.mintA.address,
        tokenB: pool.mintB.address,
        liquidity: pool.tvl,
        priceA: pool.price,
        priceB: 1 / pool.price,
        fee: pool.feeRate,
        lastUpdated: Date.now()
      };

      // Cache the result
      this.poolCache.set(poolAddress, poolInfo);
      return poolInfo;
    } catch (error) {
      console.error('[Raydium] Failed to get pool info:', error);
      return null;
    }
  }

  async getPriceQuote(
    inputMint: string,
    outputMint: string,
    amount: number
  ): Promise<DexPriceQuote | null> {
    try {
      // Use Raydium SDK approach for price calculation
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
      console.error('[Raydium] Failed to get price quote:', error);
      return null;
    }
  }

  async getAllPools(): Promise<DexPoolInfo[]> {
    try {
      const response = await this.makeRequest('/v2/ammV3/ammPools');
      const pools = response.data as RaydiumPoolInfo[];

      return pools.map(pool => ({
        poolAddress: pool.id,
        tokenA: pool.mintA.address,
        tokenB: pool.mintB.address,
        liquidity: pool.tvl,
        priceA: pool.price,
        priceB: 1 / pool.price,
        fee: pool.feeRate,
        lastUpdated: Date.now()
      }));
    } catch (error) {
      console.error('[Raydium] Failed to get all pools:', error);
      return [];
    }
  }

  async subscribeToPool(poolAddress: string, callback: (pool: DexPoolInfo) => void): Promise<void> {
    try {
      if (this.poolSubscriptions.has(poolAddress)) {
        console.log(`[Raydium] Already subscribed to pool: ${poolAddress}`);
        return;
      }

      const publicKey = new PublicKey(poolAddress);
      const subscriptionId = this.connection.onAccountChange(
        publicKey,
        async (accountInfo) => {
          // Parse account data and convert to DexPoolInfo
          const poolInfo = await this.getPoolInfo(poolAddress);
          if (poolInfo) {
            callback(poolInfo);
          }
        },
        'confirmed'
      );

      this.poolSubscriptions.set(poolAddress, subscriptionId);
      console.log(`[Raydium] Subscribed to pool: ${poolAddress}`);
    } catch (error) {
      console.error('[Raydium] Failed to subscribe to pool:', error);
      throw error;
    }
  }

  async unsubscribeFromPool(poolAddress: string): Promise<void> {
    const subscriptionId = this.poolSubscriptions.get(poolAddress);
    if (subscriptionId) {
      await this.connection.removeAccountChangeListener(subscriptionId);
      this.poolSubscriptions.delete(poolAddress);
      console.log(`[Raydium] Unsubscribed from pool: ${poolAddress}`);
    }
  }

  private calculateSlippage(amount: number, liquidity: number): number {
    // Simple slippage calculation based on amount relative to liquidity
    const ratio = amount / liquidity;
    if (ratio < 0.001) return 0.001; // 0.1%
    if (ratio < 0.01) return 0.005;  // 0.5%
    if (ratio < 0.1) return 0.01;    // 1%
    return 0.05; // 5% for large trades
  }

  // Raydium-specific methods
  async getRaydiumPoolData(poolId: string): Promise<RaydiumPoolData | null> {
    try {
      const response = await this.makeRequest(`/v2/ammV3/ammPools/${poolId}`);
      return response.data;
    } catch (error) {
      console.error('[Raydium] Failed to get pool data:', error);
      return null;
    }
  }

  async getRaydiumPairs(): Promise<any[]> {
    try {
      const response = await this.makeRequest('/v2/ammV3/ammPools');
      return response.data || [];
    } catch (error) {
      console.error('[Raydium] Failed to get pairs:', error);
      return [];
    }
  }
} 