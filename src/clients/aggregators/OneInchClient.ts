import { BasePriceAggregator, TokenPrice, PriceQuote, MarketData, AggregatorRoute } from '../BasePriceAggregator';

interface OneInchToken {
  symbol: string;
  name: string;
  address: string;
  decimals: number;
  logoURI?: string;
  tags?: string[];
}

interface OneInchQuoteResponse {
  fromToken: OneInchToken;
  toToken: OneInchToken;
  toTokenAmount: string;
  fromTokenAmount: string;
  protocols: Array<Array<{
    name: string;
    part: number;
    fromTokenAddress: string;
    toTokenAddress: string;
  }>>;
  estimatedGas: number;
}

interface OneInchSwapResponse {
  fromToken: OneInchToken;
  toToken: OneInchToken;
  toTokenAmount: string;
  fromTokenAmount: string;
  protocols: any[];
  tx: {
    from: string;
    to: string;
    data: string;
    value: string;
    gasPrice: string;
    gas: number;
  };
}

interface OneInchPriceResponse {
  [tokenAddress: string]: {
    price: number;
    symbol: string;
    name: string;
    decimals: number;
  };
}

interface OneInchLiquidityProtocol {
  id: string;
  title: string;
  img: string;
  img_color: string;
}

export class OneInchClient extends BasePriceAggregator {
  private readonly SOLANA_CHAIN_ID = '998'; // Solana mainnet chain ID for 1inch
  private tokenList: Map<string, OneInchToken> = new Map();
  private priceCache: Map<string, TokenPrice> = new Map();
  private readonly CACHE_TTL = 60000; // 1 minute cache
  private protocols: OneInchLiquidityProtocol[] = [];

  constructor(apiKey?: string) {
    super('1inch', 'https://api.1inch.dev', apiKey);
    this.setRateLimit(2); // 1inch has stricter rate limits for free tier
  }

  async connect(): Promise<void> {
    try {
      // Test connection by fetching protocols
      await this.loadProtocols();
      
      // Load Solana token list if available
      await this.loadTokenList().catch(error => {
        console.warn('[1inch] Solana token list not available, using basic functionality');
      });
      
      this.isConnected = true;
      console.log('[1inch] Connected successfully');
    } catch (error) {
      console.error('[1inch] Connection failed:', error);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    this.tokenList.clear();
    this.priceCache.clear();
    this.protocols = [];
    this.isConnected = false;
    console.log('[1inch] Disconnected');
  }

  async getTokenPrice(mint: string): Promise<TokenPrice | null> {
    try {
      if (!this.validateTokenMint(mint)) {
        console.warn(`[1inch] Invalid token mint: ${mint}`);
        return null;
      }

      // Check cache first
      const cached = this.priceCache.get(mint);
      if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
        return cached;
      }

      // 1inch doesn't have direct Solana price API, so we fallback to ETH chain for cross-reference
      // This is useful for tokens that exist on both chains
      const headers: Record<string, string> = {};
      if (this.apiKey) {
        headers['Authorization'] = `Bearer ${this.apiKey}`;
      }

      try {
        // Try to get price from ETH mainnet (chain ID 1) for cross-chain comparison
        const priceData = await this.makeRequest(`/price/v1.1/1/${mint}`, { headers });
        
        const token = this.tokenList.get(mint);
        const price: TokenPrice = {
          mint,
          symbol: token?.symbol || 'UNKNOWN',
          price: priceData.price || 0,
          timestamp: Date.now(),
          source: '1inch'
        };

        // Cache the result
        this.priceCache.set(mint, price);
        return price;
      } catch (error) {
        console.warn(`[1inch] Price not available for ${mint}`);
        return null;
      }
    } catch (error) {
      console.error('[1inch] Failed to get token price:', error);
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

      // 1inch doesn't support batch price requests for all chains
      // Process individually with rate limiting
      for (const mint of validMints) {
        const price = await this.getTokenPrice(mint);
        if (price) {
          results.push(price);
        }
      }

      return results;
    } catch (error) {
      console.error('[1inch] Failed to get multiple token prices:', error);
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
        console.warn(`[1inch] Invalid token mints: ${inputMint} -> ${outputMint}`);
        return null;
      }

      const headers: Record<string, string> = {};
      if (this.apiKey) {
        headers['Authorization'] = `Bearer ${this.apiKey}`;
      }

      // Note: 1inch doesn't directly support Solana, but this structure
      // shows how it would work for cross-chain scenarios
      try {
        const quoteResponse = await this.makeRequest(
          `/quote/v1.1/1?fromTokenAddress=${inputMint}&toTokenAddress=${outputMint}&amount=${amount}`,
          { headers }
        );

        return {
          inputMint,
          outputMint,
          inputAmount: parseInt(quoteResponse.fromTokenAmount),
          outputAmount: parseInt(quoteResponse.toTokenAmount),
          price: parseInt(quoteResponse.toTokenAmount) / parseInt(quoteResponse.fromTokenAmount),
          route: quoteResponse.protocols,
          fees: quoteResponse.estimatedGas,
          timestamp: Date.now(),
          source: '1inch'
        };
      } catch (error) {
        console.warn(`[1inch] Quote not available for ${inputMint} -> ${outputMint}`);
        return null;
      }
    } catch (error) {
      console.error('[1inch] Failed to get price quote:', error);
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
        return {
          mint,
          symbol: tokenPrice.symbol,
          name: tokenPrice.symbol,
          price: tokenPrice.price,
          lastUpdated: tokenPrice.timestamp,
          source: '1inch'
        };
      }

      return {
        mint,
        symbol: token.symbol,
        name: token.name,
        price: tokenPrice.price,
        lastUpdated: tokenPrice.timestamp,
        source: '1inch'
      };
    } catch (error) {
      console.error('[1inch] Failed to get market data:', error);
      return null;
    }
  }

  // 1inch-specific methods
  async loadProtocols(): Promise<void> {
    try {
      const headers: Record<string, string> = {};
      if (this.apiKey) {
        headers['Authorization'] = `Bearer ${this.apiKey}`;
      }

      // Get supported protocols for ETH mainnet
      const response = await this.makeRequest('/swap/v5.0/1/liquidity-sources', { headers });
      this.protocols = response.protocols || [];
      
      console.log(`[1inch] Loaded ${this.protocols.length} liquidity protocols`);
    } catch (error) {
      console.error('[1inch] Failed to load protocols:', error);
      throw error;
    }
  }

  async loadTokenList(): Promise<void> {
    try {
      const headers: Record<string, string> = {};
      if (this.apiKey) {
        headers['Authorization'] = `Bearer ${this.apiKey}`;
      }

      // 1inch primarily supports EVM chains, not Solana directly
      // This would be for cross-chain reference
      const response = await this.makeRequest('/swap/v5.0/1/tokens', { headers });
      const tokens = response.tokens || {};

      this.tokenList.clear();
      Object.values(tokens).forEach((token: any) => {
        this.tokenList.set(token.address, {
          symbol: token.symbol,
          name: token.name,
          address: token.address,
          decimals: token.decimals,
          logoURI: token.logoURI
        });
      });

      console.log(`[1inch] Loaded ${this.tokenList.size} tokens`);
    } catch (error) {
      console.error('[1inch] Failed to load token list:', error);
      // Don't throw here as 1inch might not support Solana tokens
    }
  }

  async getOneInchStats(): Promise<any> {
    try {
      const headers: Record<string, string> = {};
      if (this.apiKey) {
        headers['Authorization'] = `Bearer ${this.apiKey}`;
      }

      // Get 1inch protocol statistics
      const response = await this.makeRequest('/stats/v1.0/stats', { headers });
      return response;
    } catch (error) {
      console.error('[1inch] Failed to get stats:', error);
      return null;
    }
  }

  async getSwapRoute(
    inputMint: string,
    outputMint: string,
    amount: number,
    slippage: number = 1
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
        route: quote.route.map((protocolStep: any) => ({
          protocol: protocolStep.name,
          percentage: protocolStep.part,
          fee: undefined
        })),
        priceImpact: quote.impact || 0,
        timestamp: quote.timestamp
      };
    } catch (error) {
      console.error('[1inch] Failed to get swap route:', error);
      return null;
    }
  }

  async getSupportedProtocols(): Promise<OneInchLiquidityProtocol[]> {
    return this.protocols;
  }

  async getHealthCheck(): Promise<boolean> {
    try {
      const headers: Record<string, string> = {};
      if (this.apiKey) {
        headers['Authorization'] = `Bearer ${this.apiKey}`;
      }

      await this.makeRequest('/healthcheck', { headers });
      return true;
    } catch (error) {
      console.error('[1inch] Health check failed:', error);
      return false;
    }
  }

  async getGasPrice(chainId: number = 1): Promise<number | null> {
    try {
      const headers: Record<string, string> = {};
      if (this.apiKey) {
        headers['Authorization'] = `Bearer ${this.apiKey}`;
      }

      const response = await this.makeRequest(`/gas-price/v1.0/${chainId}`, { headers });
      return response.gasPrice || null;
    } catch (error) {
      console.error('[1inch] Failed to get gas price:', error);
      return null;
    }
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

  isApiKeyConfigured(): boolean {
    return !!this.apiKey;
  }

  // Cross-chain functionality
  async getCrossChainQuote(
    fromChainId: number,
    toChainId: number,
    inputMint: string,
    outputMint: string,
    amount: number
  ): Promise<any> {
    try {
      const headers: Record<string, string> = {};
      if (this.apiKey) {
        headers['Authorization'] = `Bearer ${this.apiKey}`;
      }

      // This would be useful for cross-chain arbitrage opportunities
      const response = await this.makeRequest(
        `/cross-chain/v1.0/quote?fromChainId=${fromChainId}&toChainId=${toChainId}&fromTokenAddress=${inputMint}&toTokenAddress=${outputMint}&amount=${amount}`,
        { headers }
      );
      
      return response;
    } catch (error) {
      console.error('[1inch] Cross-chain quote failed:', error);
      return null;
    }
  }
} 