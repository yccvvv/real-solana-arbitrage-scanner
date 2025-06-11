import { BasePriceAggregator, TokenPrice, PriceQuote, MarketData, AggregatorRoute } from '../BasePriceAggregator';

interface CoinGeckoCoin {
  id: string;
  symbol: string;
  name: string;
  image?: string;
  platforms?: {
    [chainName: string]: string;
  };
}

interface CoinGeckoPrice {
  [coinId: string]: {
    usd: number;
    usd_market_cap?: number;
    usd_24h_vol?: number;
    usd_24h_change?: number;
    last_updated_at?: number;
  };
}

interface CoinGeckoMarketData {
  id: string;
  symbol: string;
  name: string;
  image: {
    thumb: string;
    small: string;
    large: string;
  };
  market_data: {
    current_price: {
      usd: number;
    };
    market_cap: {
      usd: number;
    };
    total_volume: {
      usd: number;
    };
    price_change_percentage_24h: number;
    market_cap_rank: number;
    circulating_supply: number;
    total_supply: number;
    max_supply: number;
    ath: {
      usd: number;
    };
    atl: {
      usd: number;
    };
  };
  last_updated: string;
}

interface CoinGeckoSimplePrice {
  [address: string]: {
    usd: number;
    usd_market_cap?: number;
    usd_24h_vol?: number;
    usd_24h_change?: number;
    last_updated_at?: number;
  };
}

interface CoinGeckoExchangeRate {
  name: string;
  unit: string;
  value: number;
  type: string;
}

interface CoinGeckoPlatform {
  id: string;
  name: string;
  shortname: string;
}

export class CoinGeckoClient extends BasePriceAggregator {
  private coinList: Map<string, CoinGeckoCoin> = new Map();
  private addressToCoinId: Map<string, string> = new Map();
  private priceCache: Map<string, TokenPrice> = new Map();
  private marketDataCache: Map<string, MarketData> = new Map();
  private readonly CACHE_TTL = 300000; // 5 minutes cache (CoinGecko updates every 5-10 minutes)
  private readonly FREE_TIER_RATE_LIMIT = 10; // 10-50 calls/minute for free tier
  private platforms: CoinGeckoPlatform[] = [];

  constructor(apiKey?: string) {
    super('CoinGecko', 'https://api.coingecko.com/api/v3', apiKey);
    this.setRateLimit(this.FREE_TIER_RATE_LIMIT);
  }

  async connect(): Promise<void> {
    try {
      // Test connection by fetching supported platforms
      await this.loadSupportedPlatforms();
      
      // Load coin list for mapping
      await this.loadCoinList();
      
      this.isConnected = true;
      console.log('[CoinGecko] Connected successfully');
    } catch (error) {
      console.error('[CoinGecko] Connection failed:', error);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    this.coinList.clear();
    this.addressToCoinId.clear();
    this.priceCache.clear();
    this.marketDataCache.clear();
    this.platforms = [];
    this.isConnected = false;
    console.log('[CoinGecko] Disconnected');
  }

  async getTokenPrice(mint: string): Promise<TokenPrice | null> {
    try {
      if (!this.validateTokenMint(mint)) {
        console.warn(`[CoinGecko] Invalid token mint: ${mint}`);
        return null;
      }

      // Check cache first
      const cached = this.priceCache.get(mint);
      if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
        return cached;
      }

      const headers: Record<string, string> = {};
      if (this.apiKey) {
        headers['x-cg-pro-api-key'] = this.apiKey;
      }

      // Try to get price using contract address on Solana
      try {
        const priceData = await this.makeRequest(
          `/simple/token_price/solana?contract_addresses=${mint}&vs_currencies=usd&include_market_cap=true&include_24hr_vol=true&include_24hr_change=true&include_last_updated_at=true`,
          { headers }
        );

        if (priceData[mint]) {
          const tokenData = priceData[mint];
          const coin = Array.from(this.coinList.values()).find(c => 
            c.platforms?.solana?.toLowerCase() === mint.toLowerCase()
          );

          const price: TokenPrice = {
            mint,
            symbol: coin?.symbol.toUpperCase() || 'UNKNOWN',
            price: tokenData.usd,
            timestamp: Date.now(),
            source: 'CoinGecko'
          };

          // Cache the result
          this.priceCache.set(mint, price);
          return price;
        }
      } catch (error) {
        console.warn(`[CoinGecko] Contract address price not available for ${mint}`);
      }

      // Fallback: try to find coin by mapping
      const coinId = this.addressToCoinId.get(mint.toLowerCase());
      if (coinId) {
        const priceData = await this.makeRequest(
          `/simple/price?ids=${coinId}&vs_currencies=usd&include_market_cap=true&include_24hr_vol=true&include_24hr_change=true&include_last_updated_at=true`,
          { headers }
        );

        if (priceData[coinId]) {
          const tokenData = priceData[coinId];
          const coin = this.coinList.get(coinId);

          const price: TokenPrice = {
            mint,
            symbol: coin?.symbol.toUpperCase() || 'UNKNOWN',
            price: tokenData.usd,
            timestamp: Date.now(),
            source: 'CoinGecko'
          };

          // Cache the result
          this.priceCache.set(mint, price);
          return price;
        }
      }

      return null;
    } catch (error) {
      console.error('[CoinGecko] Failed to get token price:', error);
      return null;
    }
  }

  async getMultipleTokenPrices(mints: string[]): Promise<TokenPrice[]> {
    try {
      const validMints = mints.filter(mint => this.validateTokenMint(mint));
      if (validMints.length === 0) {
        return [];
      }

      const results: TokenPrice[] = [];
      const uncachedMints: string[] = [];

      // Check cache first
      for (const mint of validMints) {
        const cached = this.priceCache.get(mint);
        if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
          results.push(cached);
        } else {
          uncachedMints.push(mint);
        }
      }

      if (uncachedMints.length === 0) {
        return results;
      }

      const headers: Record<string, string> = {};
      if (this.apiKey) {
        headers['x-cg-pro-api-key'] = this.apiKey;
      }

      // Batch request for uncached mints
      try {
        const contractAddresses = uncachedMints.join(',');
        const priceData = await this.makeRequest(
          `/simple/token_price/solana?contract_addresses=${contractAddresses}&vs_currencies=usd&include_market_cap=true&include_24hr_vol=true&include_24hr_change=true&include_last_updated_at=true`,
          { headers }
        );

        for (const mint of uncachedMints) {
          if (priceData[mint]) {
            const tokenData = priceData[mint];
            const coin = Array.from(this.coinList.values()).find(c => 
              c.platforms?.solana?.toLowerCase() === mint.toLowerCase()
            );

            const price: TokenPrice = {
              mint,
              symbol: coin?.symbol.toUpperCase() || 'UNKNOWN',
              price: tokenData.usd,
              timestamp: Date.now(),
              source: 'CoinGecko'
            };

            // Cache the result
            this.priceCache.set(mint, price);
            results.push(price);
          }
        }
      } catch (error) {
        console.warn('[CoinGecko] Batch price request failed, falling back to individual requests');
        
        // Fallback to individual requests with rate limiting
        for (const mint of uncachedMints) {
          const price = await this.getTokenPrice(mint);
          if (price) {
            results.push(price);
          }
        }
      }

      return results;
    } catch (error) {
      console.error('[CoinGecko] Failed to get multiple token prices:', error);
      return [];
    }
  }

  async getPriceQuote(
    inputMint: string,
    outputMint: string,
    amount: number
  ): Promise<PriceQuote | null> {
    try {
      // CoinGecko doesn't provide swap quotes, only prices
      // Calculate simple price conversion
      const inputPrice = await this.getTokenPrice(inputMint);
      const outputPrice = await this.getTokenPrice(outputMint);

      if (!inputPrice || !outputPrice) {
        return null;
      }

      const inputValue = amount * inputPrice.price;
      const outputAmount = inputValue / outputPrice.price;
      const price = outputAmount / amount;

      return {
        inputMint,
        outputMint,
        inputAmount: amount,
        outputAmount,
        price,
        timestamp: Date.now(),
        source: 'CoinGecko'
      };
    } catch (error) {
      console.error('[CoinGecko] Failed to get price quote:', error);
      return null;
    }
  }

  async getMarketData(mint: string): Promise<MarketData | null> {
    try {
      // Check cache first
      const cached = this.marketDataCache.get(mint);
      if (cached && Date.now() - cached.lastUpdated < this.CACHE_TTL) {
        return cached;
      }

      const headers: Record<string, string> = {};
      if (this.apiKey) {
        headers['x-cg-pro-api-key'] = this.apiKey;
      }

      // Find coin ID from mint address
      const coinId = this.findCoinIdByAddress(mint);
      if (!coinId) {
        console.warn(`[CoinGecko] Coin not found for mint: ${mint}`);
        return null;
      }

      const coinData: CoinGeckoMarketData = await this.makeRequest(`/coins/${coinId}`, { headers });

      const marketData: MarketData = {
        mint,
        symbol: coinData.symbol.toUpperCase(),
        name: coinData.name,
        price: coinData.market_data.current_price.usd,
        marketCap: coinData.market_data.market_cap.usd,
        volume24h: coinData.market_data.total_volume.usd,
        priceChange24h: coinData.market_data.price_change_percentage_24h,
        priceChangePercentage24h: coinData.market_data.price_change_percentage_24h,
        lastUpdated: Date.now(),
        source: 'CoinGecko'
      };

      // Cache the result
      this.marketDataCache.set(mint, marketData);
      return marketData;
    } catch (error) {
      console.error('[CoinGecko] Failed to get market data:', error);
      return null;
    }
  }

  // CoinGecko-specific methods
  async loadCoinList(): Promise<void> {
    try {
      const headers: Record<string, string> = {};
      if (this.apiKey) {
        headers['x-cg-pro-api-key'] = this.apiKey;
      }

      const coins: CoinGeckoCoin[] = await this.makeRequest('/coins/list?include_platform=true', { headers });
      
      this.coinList.clear();
      this.addressToCoinId.clear();

      coins.forEach(coin => {
        this.coinList.set(coin.id, coin);
        
        // Map Solana addresses to coin IDs
        if (coin.platforms?.solana) {
          this.addressToCoinId.set(coin.platforms.solana.toLowerCase(), coin.id);
        }
      });

      console.log(`[CoinGecko] Loaded ${coins.length} coins`);
    } catch (error) {
      console.error('[CoinGecko] Failed to load coin list:', error);
      throw error;
    }
  }

  async loadSupportedPlatforms(): Promise<void> {
    try {
      const headers: Record<string, string> = {};
      if (this.apiKey) {
        headers['x-cg-pro-api-key'] = this.apiKey;
      }

      const platforms: CoinGeckoPlatform[] = await this.makeRequest('/asset_platforms', { headers });
      this.platforms = platforms;
      
      console.log(`[CoinGecko] Loaded ${platforms.length} supported platforms`);
    } catch (error) {
      console.error('[CoinGecko] Failed to load platforms:', error);
      throw error;
    }
  }

  async getTrendingCoins(): Promise<any> {
    try {
      const headers: Record<string, string> = {};
      if (this.apiKey) {
        headers['x-cg-pro-api-key'] = this.apiKey;
      }

      const response = await this.makeRequest('/search/trending', { headers });
      return response.coins || [];
    } catch (error) {
      console.error('[CoinGecko] Failed to get trending coins:', error);
      return [];
    }
  }

  async getGlobalMarketData(): Promise<any> {
    try {
      const headers: Record<string, string> = {};
      if (this.apiKey) {
        headers['x-cg-pro-api-key'] = this.apiKey;
      }

      const response = await this.makeRequest('/global', { headers });
      return response.data || null;
    } catch (error) {
      console.error('[CoinGecko] Failed to get global market data:', error);
      return null;
    }
  }

  async searchCoins(query: string): Promise<CoinGeckoCoin[]> {
    try {
      const headers: Record<string, string> = {};
      if (this.apiKey) {
        headers['x-cg-pro-api-key'] = this.apiKey;
      }

      const response = await this.makeRequest(`/search?query=${encodeURIComponent(query)}`, { headers });
      return response.coins || [];
    } catch (error) {
      console.error('[CoinGecko] Failed to search coins:', error);
      return [];
    }
  }

  async getExchangeRates(): Promise<CoinGeckoExchangeRate[]> {
    try {
      const headers: Record<string, string> = {};
      if (this.apiKey) {
        headers['x-cg-pro-api-key'] = this.apiKey;
      }

      const response = await this.makeRequest('/exchange_rates', { headers });
      return Object.values(response.rates || {}) as CoinGeckoExchangeRate[];
    } catch (error) {
      console.error('[CoinGecko] Failed to get exchange rates:', error);
      return [];
    }
  }

  async getHistoricalPrice(mint: string, days: number = 7): Promise<number[][]> {
    try {
      const coinId = this.findCoinIdByAddress(mint);
      if (!coinId) {
        console.warn(`[CoinGecko] Coin not found for mint: ${mint}`);
        return [];
      }

      const headers: Record<string, string> = {};
      if (this.apiKey) {
        headers['x-cg-pro-api-key'] = this.apiKey;
      }

      const response = await this.makeRequest(
        `/coins/${coinId}/market_chart?vs_currency=usd&days=${days}`,
        { headers }
      );
      
      return response.prices || [];
    } catch (error) {
      console.error('[CoinGecko] Failed to get historical price:', error);
      return [];
    }
  }

  private findCoinIdByAddress(address: string): string | null {
    return this.addressToCoinId.get(address.toLowerCase()) || null;
  }

  getCachedPrice(mint: string): TokenPrice | null {
    const cached = this.priceCache.get(mint);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      return cached;
    }
    return null;
  }

  getCachedMarketData(mint: string): MarketData | null {
    const cached = this.marketDataCache.get(mint);
    if (cached && Date.now() - cached.lastUpdated < this.CACHE_TTL) {
      return cached;
    }
    return null;
  }

  clearCache(): void {
    this.priceCache.clear();
    this.marketDataCache.clear();
  }

  isApiKeyConfigured(): boolean {
    return !!this.apiKey;
  }

  getSupportedPlatforms(): CoinGeckoPlatform[] {
    return this.platforms;
  }

  async ping(): Promise<boolean> {
    try {
      await this.makeRequest('/ping');
      return true;
    } catch (error) {
      console.error('[CoinGecko] Ping failed:', error);
      return false;
    }
  }
} 