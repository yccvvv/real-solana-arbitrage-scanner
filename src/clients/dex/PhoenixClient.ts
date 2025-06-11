import { BaseDexClient, DexPoolInfo, DexPriceQuote } from '../BaseDexClient';
import { Connection, PublicKey } from '@solana/web3.js';

interface PhoenixMarket {
  pubkey: string;
  account: {
    discriminant: number;
    header: {
      discriminant: number;
      status: number;
      marketSizeParams: {
        bidsSize: number;
        asksSize: number;
        numSeats: number;
      };
      baseParams: {
        mintKey: string;
        vaultKey: string;
        decimals: number;
        depositLimit: string;
      };
      quoteParams: {
        mintKey: string;
        vaultKey: string;
        decimals: number;
        depositLimit: string;
      };
      takerFeeBps: number;
      collectedQuoteFees: string;
      collectedBaseFees: string;
      marketSequenceNumber: string;
      successor: string;
    };
    market: any;
  };
}

interface PhoenixOrderbook {
  market: string;
  bids: Array<{
    price: number;
    size: number;
  }>;
  asks: Array<{
    price: number;
    size: number;
  }>;
  timestamp: number;
}

interface PhoenixTrade {
  market: string;
  price: number;
  size: number;
  side: 'buy' | 'sell';
  timestamp: number;
  maker: string;
  taker: string;
}

interface PhoenixMarketData {
  market: string;
  baseToken: {
    mint: string;
    symbol: string;
    decimals: number;
  };
  quoteToken: {
    mint: string;
    symbol: string;
    decimals: number;
  };
  price: number;
  volume24h: number;
  high24h: number;
  low24h: number;
  change24h: number;
  liquidity: number;
}

export class PhoenixClient extends BaseDexClient {
  private connection: Connection;
  private marketSubscriptions: Map<string, any> = new Map();
  private marketCache: Map<string, DexPoolInfo> = new Map();
  private readonly PHOENIX_PROGRAM_ID = 'PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY';

  constructor(rpcUrl: string = 'https://api.mainnet-beta.solana.com') {
    super('Phoenix', 'https://api.phoenix.trade');
    this.connection = new Connection(rpcUrl);
  }

  async connect(): Promise<void> {
    try {
      // Test connection
      await this.connection.getVersion();
      this.isConnected = true;
      console.log('[Phoenix] Connected successfully');
    } catch (error) {
      console.error('[Phoenix] Connection failed:', error);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    // Unsubscribe from all markets
    for (const [marketAddress, subscription] of this.marketSubscriptions) {
      await this.unsubscribeFromPool(marketAddress);
    }
    this.marketSubscriptions.clear();
    this.marketCache.clear();
    this.isConnected = false;
    console.log('[Phoenix] Disconnected');
  }

  async getPoolInfo(poolAddress: string): Promise<DexPoolInfo | null> {
    try {
      // Check cache first
      if (this.marketCache.has(poolAddress)) {
        const cached = this.marketCache.get(poolAddress)!;
        // Return cached data if less than 5 seconds old
        if (Date.now() - cached.lastUpdated < 5000) {
          return cached;
        }
      }

      // Fetch market data from Phoenix
      const marketData = await this.getPhoenixMarketData(poolAddress);
      if (!marketData) {
        return null;
      }

      const poolInfo: DexPoolInfo = {
        poolAddress: marketData.market,
        tokenA: marketData.baseToken.mint,
        tokenB: marketData.quoteToken.mint,
        liquidity: marketData.liquidity,
        priceA: marketData.price,
        priceB: 1 / marketData.price,
        fee: 0.002, // Phoenix typically has 0.2% taker fee  
        lastUpdated: Date.now()
      };

      // Cache the result
      this.marketCache.set(poolAddress, poolInfo);
      return poolInfo;
    } catch (error) {
      console.error('[Phoenix] Failed to get pool info:', error);
      return null;
    }
  }

  async getPriceQuote(
    inputMint: string,
    outputMint: string,
    amount: number
  ): Promise<DexPriceQuote | null> {
    try {
      // Find relevant market
      const markets = await this.getAllPools();
      const relevantMarket = markets.find(market => 
        (market.tokenA === inputMint && market.tokenB === outputMint) ||
        (market.tokenA === outputMint && market.tokenB === inputMint)
      );

      if (!relevantMarket) {
        return null;
      }

      // Get orderbook for more accurate pricing
      const orderbook = await this.getPhoenixOrderbook(relevantMarket.poolAddress);
      if (!orderbook) {
        // Fallback to simple price calculation
        const isTokenAInput = relevantMarket.tokenA === inputMint;
        const price = isTokenAInput ? relevantMarket.priceA : relevantMarket.priceB;
        const outputAmount = amount * price;
        const slippage = this.calculateSlippage(amount, relevantMarket.liquidity);

        return {
          inputMint,
          outputMint,
          inputAmount: amount,
          outputAmount: outputAmount * (1 - slippage),
          price,
          slippage,
          fee: relevantMarket.fee,
          timestamp: Date.now()
        };
      }

      // Calculate price impact using orderbook
      const isTokenAInput = relevantMarket.tokenA === inputMint;
      const orders = isTokenAInput ? orderbook.bids : orderbook.asks;
      
      let remainingAmount = amount;
      let totalCost = 0;
      let avgPrice = 0;

      for (const order of orders) {
        if (remainingAmount <= 0) break;
        
        const orderSize = Math.min(remainingAmount, order.size);
        totalCost += orderSize * order.price;
        remainingAmount -= orderSize;
      }

      if (remainingAmount > 0) {
        // Not enough liquidity
        return null;
      }

      avgPrice = totalCost / amount;
      const outputAmount = totalCost;
      const marketPrice = isTokenAInput ? relevantMarket.priceA : relevantMarket.priceB;
      const slippage = Math.abs(avgPrice - marketPrice) / marketPrice;

      return {
        inputMint,
        outputMint,
        inputAmount: amount,
        outputAmount,
        price: avgPrice,
        slippage,
        fee: relevantMarket.fee,
        timestamp: Date.now()
      };
    } catch (error) {
      console.error('[Phoenix] Failed to get price quote:', error);
      return null;
    }
  }

  async getAllPools(): Promise<DexPoolInfo[]> {
    try {
      const markets = await this.getPhoenixMarkets();
      
      return Promise.all(markets.map(async (market) => {
        const marketData = await this.getPhoenixMarketData(market.pubkey);
        if (!marketData) return null;

        return {
          poolAddress: market.pubkey,
          tokenA: marketData.baseToken.mint,
          tokenB: marketData.quoteToken.mint,
          liquidity: marketData.liquidity,
          priceA: marketData.price,
          priceB: 1 / marketData.price,
          fee: 0.002,
          lastUpdated: Date.now()
        };
      })).then(results => results.filter(Boolean) as DexPoolInfo[]);
    } catch (error) {
      console.error('[Phoenix] Failed to get all pools:', error);
      return [];
    }
  }

  async subscribeToPool(poolAddress: string, callback: (pool: DexPoolInfo) => void): Promise<void> {
    try {
      if (this.marketSubscriptions.has(poolAddress)) {
        console.log(`[Phoenix] Already subscribed to market: ${poolAddress}`);
        return;
      }

      const publicKey = new PublicKey(poolAddress);
      const subscriptionId = this.connection.onAccountChange(
        publicKey,
        async (accountInfo) => {
          // Parse Phoenix market account data
          const poolInfo = await this.getPoolInfo(poolAddress);
          if (poolInfo) {
            callback(poolInfo);
          }
        },
        'confirmed'
      );

      this.marketSubscriptions.set(poolAddress, subscriptionId);
      console.log(`[Phoenix] Subscribed to market: ${poolAddress}`);
    } catch (error) {
      console.error('[Phoenix] Failed to subscribe to market:', error);
      throw error;
    }
  }

  async unsubscribeFromPool(poolAddress: string): Promise<void> {
    const subscriptionId = this.marketSubscriptions.get(poolAddress);
    if (subscriptionId) {
      await this.connection.removeAccountChangeListener(subscriptionId);
      this.marketSubscriptions.delete(poolAddress);
      console.log(`[Phoenix] Unsubscribed from market: ${poolAddress}`);
    }
  }

  private calculateSlippage(amount: number, liquidity: number): number {
    // Phoenix is an orderbook DEX, so slippage depends on orderbook depth
    const ratio = amount / liquidity;
    if (ratio < 0.001) return 0.0005; // 0.05%
    if (ratio < 0.01) return 0.002;   // 0.2%
    if (ratio < 0.1) return 0.01;     // 1%
    return 0.05; // 5% for large trades
  }

  // Phoenix-specific methods
  async getPhoenixMarkets(): Promise<PhoenixMarket[]> {
    try {
      const response = await this.makeRequest('/v1/markets');
      return response.data || [];
    } catch (error) {
      console.error('[Phoenix] Failed to get markets:', error);
      return [];
    }
  }

  async getPhoenixMarketData(marketAddress: string): Promise<PhoenixMarketData | null> {
    try {
      const response = await this.makeRequest(`/v1/markets/${marketAddress}`);
      return response.data;
    } catch (error) {
      console.error('[Phoenix] Failed to get market data:', error);
      return null;
    }
  }

  async getPhoenixOrderbook(marketAddress: string): Promise<PhoenixOrderbook | null> {
    try {
      const response = await this.makeRequest(`/v1/markets/${marketAddress}/orderbook`);
      return response.data;
    } catch (error) {
      console.error('[Phoenix] Failed to get orderbook:', error);
      return null;
    }
  }

  async getPhoenixTrades(marketAddress: string, limit: number = 100): Promise<PhoenixTrade[]> {
    try {
      const response = await this.makeRequest(`/v1/markets/${marketAddress}/trades?limit=${limit}`);
      return response.data || [];
    } catch (error) {
      console.error('[Phoenix] Failed to get trades:', error);
      return [];
    }
  }

  async getPhoenixMarketStats(marketAddress: string): Promise<any> {
    try {
      const response = await this.makeRequest(`/v1/markets/${marketAddress}/stats`);
      return response.data;
    } catch (error) {
      console.error('[Phoenix] Failed to get market stats:', error);
      return null;
    }
  }

  async getPhoenixMarketsByTokenPair(baseToken: string, quoteToken: string): Promise<PhoenixMarket[]> {
    try {
      const allMarkets = await this.getPhoenixMarkets();
      return allMarkets.filter(market => 
        market.account.header.baseParams.mintKey === baseToken &&
        market.account.header.quoteParams.mintKey === quoteToken
      );
    } catch (error) {
      console.error('[Phoenix] Failed to get markets by token pair:', error);
      return [];
    }
  }
} 