export interface DexPoolInfo {
  poolAddress: string;
  tokenA: string;
  tokenB: string;
  liquidity: number;
  priceA: number;
  priceB: number;
  fee: number;
  lastUpdated: number;
}

export interface DexPriceQuote {
  inputMint: string;
  outputMint: string;
  inputAmount: number;
  outputAmount: number;
  price: number;
  slippage: number;
  fee: number;
  route?: any;
  timestamp: number;
}

export abstract class BaseDexClient {
  protected dexName: string;
  protected baseUrl: string;
  protected isConnected: boolean = false;

  constructor(dexName: string, baseUrl: string) {
    this.dexName = dexName;
    this.baseUrl = baseUrl;
  }

  abstract connect(): Promise<void>;
  abstract disconnect(): Promise<void>;
  abstract getPoolInfo(poolAddress: string): Promise<DexPoolInfo | null>;
  abstract getPriceQuote(
    inputMint: string,
    outputMint: string,
    amount: number
  ): Promise<DexPriceQuote | null>;
  abstract getAllPools(): Promise<DexPoolInfo[]>;
  abstract subscribeToPool(poolAddress: string, callback: (pool: DexPoolInfo) => void): Promise<void>;
  abstract unsubscribeFromPool(poolAddress: string): Promise<void>;

  getDexName(): string {
    return this.dexName;
  }

  isClientConnected(): boolean {
    return this.isConnected;
  }

  protected async makeRequest(endpoint: string, options?: RequestInit): Promise<any> {
    try {
      const response = await fetch(`${this.baseUrl}${endpoint}`, {
        headers: {
          'Content-Type': 'application/json',
          ...options?.headers,
        },
        ...options,
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error(`[${this.dexName}] Request failed:`, error);
      throw error;
    }
  }
} 