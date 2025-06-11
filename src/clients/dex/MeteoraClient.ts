import { BaseDexClient, DexPoolInfo, DexPriceQuote } from '../BaseDexClient';
import { Connection, PublicKey } from '@solana/web3.js';

interface MeteoraPool {
  pubkey: string;
  lpMint: string;
  aTokenMint: string;
  bTokenMint: string;
  aTokenVault: string;
  bTokenVault: string;
  protocolFeeAAmount: string;
  protocolFeeBAmount: string;
  aTokenAmount: string;
  bTokenAmount: string;
  virtualPrice: string;
  tokenAFeeAmount: string;
  tokenBFeeAmount: string;
  totalFee: string;
  tradeFeeNumerator: string;
  tradeFeeDenominator: string;
  ownerTradeFeeNumerator: string;
  ownerTradeFeeDenominator: string;
  ownerWithdrawFeeNumerator: string;
  ownerWithdrawFeeDenominator: string;
  hostFeeNumerator: string;
  hostFeeDenominator: string;
  curveType: number;
}

interface MeteoraPoolInfo {
  pool_address: string;
  pool_name: string;
  pool_type: string;
  token_a: {
    address: string;
    symbol: string;
    name: string;
    decimals: number;
    logoURI?: string;
  };
  token_b: {
    address: string;
    symbol: string;
    name: string;
    decimals: number;
    logoURI?: string;
  };
  current_price: number;
  liquidity_a: number;
  liquidity_b: number;
  total_liquidity: number;
  volume_24h: number;
  fees_24h: number;
  apr: number;
  fee_rate: number;
}

interface MeteoraQuote {
  input_amount: string;
  output_amount: string;
  minimum_output_amount: string;
  price_impact: number;
  swap_fee: string;
  protocol_fee: string;
  route: {
    pool_address: string;
    input_mint: string;
    output_mint: string;
  }[];
}

interface MeteoraToken {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  logoURI?: string;
  coingeckoId?: string;
  price?: number;
}

export class MeteoraClient extends BaseDexClient {
  private connection: Connection;
  private poolSubscriptions: Map<string, any> = new Map();
  private poolCache: Map<string, DexPoolInfo> = new Map();
  private readonly METEORA_PROGRAM_ID = 'Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB';

  constructor(rpcUrl: string = 'https://api.mainnet-beta.solana.com') {
    super('Meteora', 'https://app.meteora.ag/api');
    this.connection = new Connection(rpcUrl);
  }

  async connect(): Promise<void> {
    try {
      // Test connection
      await this.connection.getVersion();
      this.isConnected = true;
      console.log('[Meteora] Connected successfully');
    } catch (error) {
      console.error('[Meteora] Connection failed:', error);
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
    console.log('[Meteora] Disconnected');
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

      // Fetch from Meteora API
      const poolInfo = await this.getMeteoraPoolInfo(poolAddress);
      if (!poolInfo) {
        return null;
      }

      const dexPoolInfo: DexPoolInfo = {
        poolAddress: poolInfo.pool_address,
        tokenA: poolInfo.token_a.address,
        tokenB: poolInfo.token_b.address,
        liquidity: poolInfo.total_liquidity,
        priceA: poolInfo.current_price,
        priceB: 1 / poolInfo.current_price,
        fee: poolInfo.fee_rate,
        lastUpdated: Date.now()
      };

      // Cache the result
      this.poolCache.set(poolAddress, dexPoolInfo);
      return dexPoolInfo;
    } catch (error) {
      console.error('[Meteora] Failed to get pool info:', error);
      return null;
    }
  }

  async getPriceQuote(
    inputMint: string,
    outputMint: string,
    amount: number
  ): Promise<DexPriceQuote | null> {
    try {
      // Get quote from Meteora API
      const quote = await this.getMeteoraQuote(inputMint, outputMint, amount);
      if (!quote) {
        // Fallback to pool-based calculation
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
      }

      const outputAmount = parseFloat(quote.output_amount);
      const price = outputAmount / amount;

      return {
        inputMint,
        outputMint,
        inputAmount: amount,
        outputAmount,
        price,
        slippage: quote.price_impact,
        fee: parseFloat(quote.swap_fee) / amount,
        route: quote.route,
        timestamp: Date.now()
      };
    } catch (error) {
      console.error('[Meteora] Failed to get price quote:', error);
      return null;
    }
  }

  async getAllPools(): Promise<DexPoolInfo[]> {
    try {
      const pools = await this.getMeteoraAllPools();
      
      return pools.map(pool => ({
        poolAddress: pool.pool_address,
        tokenA: pool.token_a.address,
        tokenB: pool.token_b.address,
        liquidity: pool.total_liquidity,
        priceA: pool.current_price,
        priceB: 1 / pool.current_price,
        fee: pool.fee_rate,
        lastUpdated: Date.now()
      }));
    } catch (error) {
      console.error('[Meteora] Failed to get all pools:', error);
      return [];
    }
  }

  async subscribeToPool(poolAddress: string, callback: (pool: DexPoolInfo) => void): Promise<void> {
    try {
      if (this.poolSubscriptions.has(poolAddress)) {
        console.log(`[Meteora] Already subscribed to pool: ${poolAddress}`);
        return;
      }

      const publicKey = new PublicKey(poolAddress);
      const subscriptionId = this.connection.onAccountChange(
        publicKey,
        async (accountInfo) => {
          // Parse Meteora pool account data
          const poolInfo = await this.getPoolInfo(poolAddress);
          if (poolInfo) {
            callback(poolInfo);
          }
        },
        'confirmed'
      );

      this.poolSubscriptions.set(poolAddress, subscriptionId);
      console.log(`[Meteora] Subscribed to pool: ${poolAddress}`);
    } catch (error) {
      console.error('[Meteora] Failed to subscribe to pool:', error);
      throw error;
    }
  }

  async unsubscribeFromPool(poolAddress: string): Promise<void> {
    const subscriptionId = this.poolSubscriptions.get(poolAddress);
    if (subscriptionId) {
      await this.connection.removeAccountChangeListener(subscriptionId);
      this.poolSubscriptions.delete(poolAddress);
      console.log(`[Meteora] Unsubscribed from pool: ${poolAddress}`);
    }
  }

  private calculateSlippage(amount: number, liquidity: number): number {
    // Meteora uses stable swap curves, so slippage is generally lower
    const ratio = amount / liquidity;
    if (ratio < 0.001) return 0.0001; // 0.01%
    if (ratio < 0.01) return 0.001;   // 0.1%
    if (ratio < 0.1) return 0.005;    // 0.5%
    return 0.02; // 2% for large trades
  }

  // Meteora-specific methods
  async getMeteoraAllPools(): Promise<MeteoraPoolInfo[]> {
    try {
      const response = await this.makeRequest('/pools');
      return response.data || [];
    } catch (error) {
      console.error('[Meteora] Failed to get all pools:', error);
      return [];
    }
  }

  async getMeteoraPoolInfo(poolAddress: string): Promise<MeteoraPoolInfo | null> {
    try {
      const response = await this.makeRequest(`/pools/${poolAddress}`);
      return response.data;
    } catch (error) {
      console.error('[Meteora] Failed to get pool info:', error);
      return null;
    }
  }

  async getMeteoraQuote(
    inputMint: string,
    outputMint: string,
    amount: number
  ): Promise<MeteoraQuote | null> {
    try {
      const response = await this.makeRequest('/quote', {
        method: 'POST',
        body: JSON.stringify({
          inputMint,
          outputMint,
          amount: amount.toString(),
          slippageBps: 50 // 0.5% default slippage
        })
      });
      return response.data;
    } catch (error) {
      console.error('[Meteora] Failed to get quote:', error);
      return null;
    }
  }

  async getMeteoraTokens(): Promise<MeteoraToken[]> {
    try {
      const response = await this.makeRequest('/tokens');
      return response.data || [];
    } catch (error) {
      console.error('[Meteora] Failed to get tokens:', error);
      return [];
    }
  }

  async getMeteoraPoolsByTokenPair(tokenA: string, tokenB: string): Promise<MeteoraPoolInfo[]> {
    try {
      const allPools = await this.getMeteoraAllPools();
      return allPools.filter(pool => 
        (pool.token_a.address === tokenA && pool.token_b.address === tokenB) ||
        (pool.token_a.address === tokenB && pool.token_b.address === tokenA)
      );
    } catch (error) {
      console.error('[Meteora] Failed to get pools by token pair:', error);
      return [];
    }
  }

  async getMeteoraPoolStatistics(poolAddress: string): Promise<any> {
    try {
      const response = await this.makeRequest(`/pools/${poolAddress}/stats`);
      return response.data;
    } catch (error) {
      console.error('[Meteora] Failed to get pool statistics:', error);
      return null;
    }
  }

  async getMeteoraPoolHistory(poolAddress: string, timeframe: string = '24h'): Promise<any> {
    try {
      const response = await this.makeRequest(`/pools/${poolAddress}/history?timeframe=${timeframe}`);
      return response.data;
    } catch (error) {
      console.error('[Meteora] Failed to get pool history:', error);
      return null;
    }
  }

  async getMeteoraSwapRoute(
    inputMint: string,
    outputMint: string,
    amount: number,
    maxHops: number = 3
  ): Promise<any> {
    try {
      const response = await this.makeRequest('/route', {
        method: 'POST',
        body: JSON.stringify({
          inputMint,
          outputMint,
          amount: amount.toString(),
          maxHops
        })
      });
      return response.data;
    } catch (error) {
      console.error('[Meteora] Failed to get swap route:', error);
      return null;
    }
  }
} 