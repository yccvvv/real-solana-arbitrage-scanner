export { BasePriceAggregator, TokenPrice, PriceQuote, MarketData, AggregatorRoute } from '../BasePriceAggregator';
export { JupiterClient } from './JupiterClient';
export { OneInchClient } from './OneInchClient';
export { CoinGeckoClient } from './CoinGeckoClient';

import { JupiterClient } from './JupiterClient';
import { OneInchClient } from './OneInchClient';
import { CoinGeckoClient } from './CoinGeckoClient';
import { BasePriceAggregator, TokenPrice, PriceQuote, MarketData } from '../BasePriceAggregator';

// Price Aggregator Factory
export class PriceAggregatorFactory {
  static createJupiterClient(): JupiterClient {
    return new JupiterClient();
  }

  static createOneInchClient(apiKey?: string): OneInchClient {
    return new OneInchClient(apiKey);
  }

  static createCoinGeckoClient(apiKey?: string): CoinGeckoClient {
    return new CoinGeckoClient(apiKey);
  }

  static createAllAggregators(config?: {
    oneInchApiKey?: string;
    coinGeckoApiKey?: string;
  }): {
    jupiter: JupiterClient;
    oneInch: OneInchClient;
    coinGecko: CoinGeckoClient;
  } {
    return {
      jupiter: new JupiterClient(),
      oneInch: new OneInchClient(config?.oneInchApiKey),
      coinGecko: new CoinGeckoClient(config?.coinGeckoApiKey)
    };
  }
}

// Price Aggregator Manager
export class PriceAggregatorManager {
  private aggregators: Map<string, BasePriceAggregator> = new Map();

  constructor(config?: {
    oneInchApiKey?: string;
    coinGeckoApiKey?: string;
  }) {
    this.aggregators.set('jupiter', new JupiterClient());
    this.aggregators.set('oneinch', new OneInchClient(config?.oneInchApiKey));
    this.aggregators.set('coingecko', new CoinGeckoClient(config?.coinGeckoApiKey));
  }

  async connectAll(): Promise<void> {
    const connectionPromises = Array.from(this.aggregators.values()).map(aggregator => 
      aggregator.connect().catch(error => {
        console.error(`Failed to connect ${aggregator.getAggregatorName()}:`, error);
        return null;
      })
    );
    
    await Promise.all(connectionPromises);
  }

  async disconnectAll(): Promise<void> {
    const disconnectionPromises = Array.from(this.aggregators.values()).map(aggregator => 
      aggregator.disconnect().catch(error => {
        console.error(`Failed to disconnect ${aggregator.getAggregatorName()}:`, error);
        return null;
      })
    );
    
    await Promise.all(disconnectionPromises);
  }

  getAggregator(name: string): BasePriceAggregator | undefined {
    return this.aggregators.get(name.toLowerCase());
  }

  getAllAggregators(): BasePriceAggregator[] {
    return Array.from(this.aggregators.values());
  }

  getConnectedAggregators(): BasePriceAggregator[] {
    return Array.from(this.aggregators.values()).filter(aggregator => aggregator.isAggregatorConnected());
  }

  async getTokenPriceFromAllSources(mint: string): Promise<{ source: string; price: TokenPrice | null }[]> {
    const results = await Promise.all(
      Array.from(this.aggregators.entries()).map(async ([name, aggregator]) => {
        try {
          if (!aggregator.isAggregatorConnected()) {
            await aggregator.connect();
          }
          const price = await aggregator.getTokenPrice(mint);
          return { source: name, price };
        } catch (error) {
          console.error(`Failed to get price from ${name}:`, error);
          return { source: name, price: null };
        }
      })
    );

    return results;
  }

  async getMultipleTokenPricesFromAllSources(mints: string[]): Promise<{
    source: string;
    prices: TokenPrice[];
  }[]> {
    const results = await Promise.all(
      Array.from(this.aggregators.entries()).map(async ([name, aggregator]) => {
        try {
          if (!aggregator.isAggregatorConnected()) {
            await aggregator.connect();
          }
          const prices = await aggregator.getMultipleTokenPrices(mints);
          return { source: name, prices };
        } catch (error) {
          console.error(`Failed to get prices from ${name}:`, error);
          return { source: name, prices: [] };
        }
      })
    );

    return results;
  }

  async getPriceQuotesFromAllSources(
    inputMint: string,
    outputMint: string,
    amount: number
  ): Promise<{ source: string; quote: PriceQuote | null }[]> {
    const results = await Promise.all(
      Array.from(this.aggregators.entries()).map(async ([name, aggregator]) => {
        try {
          if (!aggregator.isAggregatorConnected()) {
            await aggregator.connect();
          }
          const quote = await aggregator.getPriceQuote(inputMint, outputMint, amount);
          return { source: name, quote };
        } catch (error) {
          console.error(`Failed to get quote from ${name}:`, error);
          return { source: name, quote: null };
        }
      })
    );

    return results;
  }

  async getMarketDataFromAllSources(mint: string): Promise<{ source: string; data: MarketData | null }[]> {
    const results = await Promise.all(
      Array.from(this.aggregators.entries()).map(async ([name, aggregator]) => {
        try {
          if (!aggregator.isAggregatorConnected()) {
            await aggregator.connect();
          }
          const data = await aggregator.getMarketData(mint);
          return { source: name, data };
        } catch (error) {
          console.error(`Failed to get market data from ${name}:`, error);
          return { source: name, data: null };
        }
      })
    );

    return results;
  }

  // Price comparison and analysis methods
  async getBestPrice(mint: string): Promise<{ source: string; price: TokenPrice } | null> {
    const prices = await this.getTokenPriceFromAllSources(mint);
    const validPrices = prices.filter(p => p.price !== null);
    
    if (validPrices.length === 0) {
      return null;
    }

    // Find the most recent price
    const bestPrice = validPrices.reduce((best, current) => {
      const currentPrice = current.price!;
      const bestCurrentPrice = best.price!;
      
      // Prefer more recent prices
      if (currentPrice.timestamp > bestCurrentPrice.timestamp) {
        return current;
      }
      
      return best;
    });

    return { source: bestPrice.source, price: bestPrice.price! };
  }

  async getPriceConsensus(mint: string): Promise<{
    averagePrice: number;
    priceRange: { min: number; max: number };
    sourcesCount: number;
    consensus: boolean;
    sources: { source: string; price: number; timestamp: number }[];
  } | null> {
    const prices = await this.getTokenPriceFromAllSources(mint);
    const validPrices = prices.filter(p => p.price !== null);
    
    if (validPrices.length === 0) {
      return null;
    }

    const priceValues = validPrices.map(p => p.price!.price);
    const averagePrice = priceValues.reduce((sum, price) => sum + price, 0) / priceValues.length;
    const minPrice = Math.min(...priceValues);
    const maxPrice = Math.max(...priceValues);
    
    // Consider consensus if all prices are within 5% of each other
    const priceVariation = (maxPrice - minPrice) / averagePrice;
    const consensus = priceVariation <= 0.05;

    return {
      averagePrice,
      priceRange: { min: minPrice, max: maxPrice },
      sourcesCount: validPrices.length,
      consensus,
      sources: validPrices.map(p => ({
        source: p.source,
        price: p.price!.price,
        timestamp: p.price!.timestamp
      }))
    };
  }

  async findPriceDiscrepancies(
    mint: string,
    thresholdPercentage: number = 5
  ): Promise<{
    hasDiscrepancy: boolean;
    maxVariation: number;
    sources: { source: string; price: number; deviation: number }[];
  } | null> {
    const consensus = await this.getPriceConsensus(mint);
    if (!consensus) {
      return null;
    }

    const maxVariation = ((consensus.priceRange.max - consensus.priceRange.min) / consensus.averagePrice) * 100;
    const hasDiscrepancy = maxVariation > thresholdPercentage;

    const sources = consensus.sources.map(source => ({
      source: source.source,
      price: source.price,
      deviation: ((source.price - consensus.averagePrice) / consensus.averagePrice) * 100
    }));

    return {
      hasDiscrepancy,
      maxVariation,
      sources
    };
  }
} 