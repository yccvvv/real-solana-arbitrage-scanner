import { BasePriceAggregator, TokenPrice, PriceQuote, MarketData, AggregatorRoute } from '../BasePriceAggregator';

interface JupiterQuoteResponse {
  data: {
    inputMint: string;
    inAmount: string;
    outputMint: string;
    outAmount: string;
    otherAmountThreshold: string;
    swapMode: string;
    slippageBps: number;
    platformFee?: {
      amount: string;
      feeBps: number;
    };
    priceImpactPct: string;
    routePlan: Array<{
      swapInfo: {
        ammKey: string;
        label: string;
        inputMint: string;
        outputMint: string;
        inAmount: string;
        outAmount: string;
        feeAmount: string;
        feeMint: string;
      };
      percent: number;
    }>;
  }[];
}

interface JupiterToken {
  address: string;
  chainId: number;
  decimals: number;
  name: string;
  symbol: string;
  logoURI?: string;
  tags?: string[];
}

interface JupiterPriceResponse {
  data: Record<string, {
    id: string;
    mintSymbol: string;
    vsToken: string;
    vsTokenSymbol: string;
    price: number;
  }>;
  timeTaken: number;
}

interface JupiterStatsResponse {
  totalTxns: number;
  totalUniqueUsers: number;
  totalVolumeInUSD: number;
  totalFeeInUSD: number;
  last24hTxns: number;
  last24hUniqueUsers: number;
  last24hVolumeInUSD: number;
  last24hFeeInUSD: number;
}

export class JupiterClient extends BasePriceAggregator {
  private tokenList: Map<string, JupiterToken> = new Map();
  private priceCache: Map<string, TokenPrice> = new Map();
  private readonly CACHE_TTL = 30000; // 30 seconds

  constructor() {
    super('Jupiter', 'https://quote-api.jup.ag');
    this.setRateLimit(10); // Jupiter allows higher rate limits
  }

  async connect(): Promise<void> {
    try {
      // Test connection by fetching token list
      await this.loadTokenList();
      this.isConnected = true;
      console.log('[Jupiter] Connected successfully');
    } catch (error) {
      console.error('[Jupiter] Connection failed:', error);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    this.tokenList.clear();
    this.priceCache.clear();
    this.isConnected = false;
    console.log('[Jupiter] Disconnected');
  }

  async getTokenPrice(mint: string): Promise<TokenPrice | null> {
    try {
      if (!this.validateTokenMint(mint)) {
        console.warn(`[Jupiter] Invalid token mint: ${mint}`);
        return null;
      }

      // Check cache first
      const cached = this.priceCache.get(mint);
      if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
        return cached;
      }

      // Get price against USDC
      const usdcMint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
      const priceData = await this.makeRequest(`/v6/price?ids=${mint}&vsToken=${usdcMint}`);

      if (!priceData.data || !priceData.data[mint]) {
        return null;
      }

      const tokenData = priceData.data[mint];
      const token = this.tokenList.get(mint);

      const price: TokenPrice = {
        mint,
        symbol: token?.symbol || tokenData.mintSymbol || 'UNKNOWN',
        price: tokenData.price,
        timestamp: Date.now(),
        source: 'Jupiter'
      };

      // Cache the result
      this.priceCache.set(mint, price);
      return price;
    } catch (error) {
      console.error('[Jupiter] Failed to get token price:', error);
      return null;
    }
  }

  async getMultipleTokenPrices(mints: string[]): Promise<TokenPrice[]> {
    try {
      const validMints = mints.filter(mint => this.validateTokenMint(mint));
      if (validMints.length === 0) {
        return [];
      }

      // Check cache first
      const results: TokenPrice[] = [];
      const uncachedMints: string[] = [];

      for (const mint of validMints) {
        const cached = this.priceCache.get(mint);
        if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
          results.push(cached);
        } else {
          uncachedMints.push(mint);
        }
      }

      // Fetch uncached prices
      if (uncachedMints.length > 0) {
        const usdcMint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
        const priceData = await this.makeRequest(`/v6/price?ids=${uncachedMints.join(',')}&vsToken=${usdcMint}`);

        for (const mint of uncachedMints) {
          if (priceData.data && priceData.data[mint]) {
            const tokenData = priceData.data[mint];
            const token = this.tokenList.get(mint);

            const price: TokenPrice = {
              mint,
              symbol: token?.symbol || tokenData.mintSymbol || 'UNKNOWN',
              price: tokenData.price,
              timestamp: Date.now(),
              source: 'Jupiter'
            };

            // Cache the result
            this.priceCache.set(mint, price);
            results.push(price);
          }
        }
      }

      return results;
    } catch (error) {
      console.error('[Jupiter] Failed to get multiple token prices:', error);
      return [];
    }
  }

  async getPriceQuote(
    inputMint: string,
    outputMint: string,
    amount: number
  ): Promise<PriceQuote | null> {
    try {
      if (!this.validateTokenMint(inputMint) || !this.validateTokenMint(outputMint)) {
        console.warn(`[Jupiter] Invalid token mints: ${inputMint} -> ${outputMint}`);
        return null;
      }

      const quoteResponse = await this.makeRequest(
        `/v6/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&slippageBps=50`
      );

      if (!quoteResponse.data || quoteResponse.data.length === 0) {
        return null;
      }

      const quote = quoteResponse.data[0];
      const inputToken = this.tokenList.get(inputMint);
      const outputToken = this.tokenList.get(outputMint);

      const priceQuote: PriceQuote = {
        inputMint,
        outputMint,
        inputAmount: parseInt(quote.inAmount),
        outputAmount: parseInt(quote.outAmount),
        price: parseInt(quote.outAmount) / parseInt(quote.inAmount),
        route: quote.routePlan,
        impact: parseFloat(quote.priceImpactPct),
        fees: quote.platformFee ? parseInt(quote.platformFee.amount) : 0,
        timestamp: Date.now(),
        source: 'Jupiter'
      };

      return priceQuote;
    } catch (error) {
      console.error('[Jupiter] Failed to get price quote:', error);
      return null;
    }
  }

  async getMarketData(mint: string): Promise<MarketData | null> {
    try {
      const tokenPrice = await this.getTokenPrice(mint);
      if (!tokenPrice) {
        return null;
      }

      const token = this.tokenList.get(mint);
      if (!token) {
        return null;
      }

      return {
        mint,
        symbol: token.symbol,
        name: token.name,
        price: tokenPrice.price,
        lastUpdated: tokenPrice.timestamp,
        source: 'Jupiter'
      };
    } catch (error) {
      console.error('[Jupiter] Failed to get market data:', error);
      return null;
    }
  }

  // Jupiter-specific methods
  async loadTokenList(): Promise<void> {
    try {
      const response = await this.makeRequest('/v6/tokens');
      const tokens: JupiterToken[] = response;

      this.tokenList.clear();
      tokens.forEach(token => {
        this.tokenList.set(token.address, token);
      });

      console.log(`[Jupiter] Loaded ${tokens.length} tokens`);
    } catch (error) {
      console.error('[Jupiter] Failed to load token list:', error);
      throw error;
    }
  }

  async getJupiterStats(): Promise<JupiterStatsResponse | null> {
    try {
      const response = await this.makeRequest('/v6/stats');
      return response;
    } catch (error) {
      console.error('[Jupiter] Failed to get stats:', error);
      return null;
    }
  }

  async getSwapRoute(
    inputMint: string,
    outputMint: string,
    amount: number,
    slippageBps: number = 50
  ): Promise<AggregatorRoute | null> {
    try {
      const quote = await this.getPriceQuote(inputMint, outputMint, amount);
      if (!quote || !quote.route) {
        return null;
      }

      return {
        inputMint,
        outputMint,
        inputAmount: quote.inputAmount,
        outputAmount: quote.outputAmount,
        route: quote.route.map((step: any) => ({
          protocol: step.swapInfo.label,
          percentage: step.percent,
          fee: step.swapInfo.feeAmount ? parseInt(step.swapInfo.feeAmount) : undefined
        })),
        priceImpact: quote.impact || 0,
        timestamp: quote.timestamp
      };
    } catch (error) {
      console.error('[Jupiter] Failed to get swap route:', error);
      return null;
    }
  }

  async getTokenInfo(mint: string): Promise<JupiterToken | null> {
    return this.tokenList.get(mint) || null;
  }

  async searchTokens(query: string): Promise<JupiterToken[]> {
    const searchLower = query.toLowerCase();
    return Array.from(this.tokenList.values()).filter(token =>
      token.symbol.toLowerCase().includes(searchLower) ||
      token.name.toLowerCase().includes(searchLower) ||
      token.address.toLowerCase().includes(searchLower)
    );
  }

  async getTopTokens(limit: number = 50): Promise<JupiterToken[]> {
    // Return first N tokens from the list (Jupiter API doesn't provide ranking)
    return Array.from(this.tokenList.values()).slice(0, limit);
  }

  getCachedPrice(mint: string): TokenPrice | null {
    const cached = this.priceCache.get(mint);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      return cached;
    }
    return null;
  }

  clearPriceCache(): void {
    this.priceCache.clear();
  }
} 