export interface TokenPrice {
  mint: string;
  symbol: string;
  price: number;
  timestamp: number;
  source: string;
}

export interface PriceQuote {
  inputMint: string;
  outputMint: string;
  inputAmount: number;
  outputAmount: number;
  price: number;
  route?: any[];
  impact?: number;
  fees?: number;
  timestamp: number;
  source: string;
}

export interface MarketData {
  mint: string;
  symbol: string;
  name: string;
  price: number;
  marketCap?: number;
  volume24h?: number;
  priceChange24h?: number;
  priceChangePercentage24h?: number;
  lastUpdated: number;
  source: string;
}

export interface AggregatorRoute {
  inputMint: string;
  outputMint: string;
  inputAmount: number;
  outputAmount: number;
  route: Array<{
    protocol: string;
    percentage: number;
    fee?: number;
  }>;
  priceImpact: number;
  timestamp: number;
}

export abstract class BasePriceAggregator {
  protected aggregatorName: string;
  protected baseUrl: string;
  protected apiKey?: string;
  protected isConnected: boolean = false;
  protected rateLimit: {
    requests: number;
    perSecond: number;
    lastRequest: number;
  };

  constructor(aggregatorName: string, baseUrl: string, apiKey?: string) {
    this.aggregatorName = aggregatorName;
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
    this.rateLimit = {
      requests: 0,
      perSecond: 10, // Default rate limit
      lastRequest: 0
    };
  }

  abstract connect(): Promise<void>;
  abstract disconnect(): Promise<void>;
  abstract getTokenPrice(mint: string): Promise<TokenPrice | null>;
  abstract getMultipleTokenPrices(mints: string[]): Promise<TokenPrice[]>;
  abstract getPriceQuote(
    inputMint: string,
    outputMint: string,
    amount: number
  ): Promise<PriceQuote | null>;
  abstract getMarketData(mint: string): Promise<MarketData | null>;

  getAggregatorName(): string {
    return this.aggregatorName;
  }

  isAggregatorConnected(): boolean {
    return this.isConnected;
  }

  protected async makeRequest(endpoint: string, options?: RequestInit): Promise<any> {
    // Rate limiting
    await this.enforceRateLimit();

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'User-Agent': 'Solana-Arbitrage-Scanner/1.0',
      };

      // Merge additional headers
      if (options?.headers) {
        Object.assign(headers, options.headers);
      }

      // Add API key if available
      if (this.apiKey) {
        headers['Authorization'] = `Bearer ${this.apiKey}`;
      }

      const response = await fetch(`${this.baseUrl}${endpoint}`, {
        headers,
        ...options,
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status} - ${response.statusText}`);
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.error(`[${this.aggregatorName}] Request failed:`, error);
      throw error;
    }
  }

  private async enforceRateLimit(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.rateLimit.lastRequest;
    
    if (timeSinceLastRequest < 1000) {
      // Reset counter if more than 1 second has passed
      if (timeSinceLastRequest >= 1000) {
        this.rateLimit.requests = 0;
      }

      // Check if we've exceeded rate limit
      if (this.rateLimit.requests >= this.rateLimit.perSecond) {
        const waitTime = 1000 - timeSinceLastRequest;
        await new Promise(resolve => setTimeout(resolve, waitTime));
        this.rateLimit.requests = 0;
      }
    }

    this.rateLimit.requests++;
    this.rateLimit.lastRequest = Date.now();
  }

  protected formatTokenAddress(address: string): string {
    // Ensure address is properly formatted for the specific aggregator
    return address.trim();
  }

  protected calculatePriceImpact(inputAmount: number, outputAmount: number, marketPrice: number): number {
    const executionPrice = outputAmount / inputAmount;
    return Math.abs((executionPrice - marketPrice) / marketPrice) * 100;
  }

  protected validateTokenMint(mint: string): boolean {
    // Basic Solana address validation (base58, 32-44 characters)
    const solanaAddressRegex = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
    return solanaAddressRegex.test(mint);
  }

  protected setRateLimit(requestsPerSecond: number): void {
    this.rateLimit.perSecond = requestsPerSecond;
  }

  protected async retryRequest<T>(
    operation: () => Promise<T>,
    maxRetries: number = 3,
    backoffMs: number = 1000
  ): Promise<T> {
    let lastError: Error;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error as Error;
        
        if (attempt === maxRetries) {
          break;
        }

        // Exponential backoff
        const waitTime = backoffMs * Math.pow(2, attempt);
        console.warn(`[${this.aggregatorName}] Attempt ${attempt + 1} failed, retrying in ${waitTime}ms...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }

    throw lastError!;
  }
} 