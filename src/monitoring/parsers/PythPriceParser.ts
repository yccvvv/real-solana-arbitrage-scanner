import { Connection, PublicKey } from '@solana/web3.js';
import { PythConnection, getPythConnection, PriceData, PriceFeed } from '@pythnetwork/client';
import Decimal from 'decimal.js';
import { OraclePrice, OracleValidation } from '../types';

/**
 * PythPriceParser - Real Pyth Network price oracle parsing
 * 
 * Uses the official Pyth Network client to parse actual oracle price feeds
 * Supports all Pyth price feeds with confidence intervals and validation
 */
export class PythPriceParser {
  private connection: Connection;
  private pythConnection: PythConnection;
  private knownFeeds: Map<string, string> = new Map();

  constructor(connection: Connection) {
    this.connection = connection;
    this.pythConnection = getPythConnection(connection, 'mainnet-beta');
    this.initializeKnownFeeds();
  }

  /**
   * Initialize known Pyth price feeds
   */
  private initializeKnownFeeds(): void {
    // Real Pyth Network price feed addresses on Solana mainnet
    this.knownFeeds.set('SOL/USD', 'H6ARHf6YXhGYeQfUzQNGk6rDNnLBQKrenN712K4AQJEG');
    this.knownFeeds.set('USDC/USD', 'Gnt27xtC473ZT2Mw5u8wZ68Z3gULkSTb5DuxJy7eJotD');
    this.knownFeeds.set('USDT/USD', '3vxLXJqLqF3JG5TCbYycbKWRBbCJQLxQmBGCkyqEEefL');
    this.knownFeeds.set('BTC/USD', 'GVXRSBjFk6e6J3NbVPXohDJetcTjaeeuykUpbQF8UoMU');
    this.knownFeeds.set('ETH/USD', 'JBu1AL4obBcCMqKBBxhpWCNUt136ijcuMZLFvTP7iWdB');
    this.knownFeeds.set('AVAX/USD', 'Ax9ujW5B9oqcv59N8m6f1BpTBq2rGeGaBcpKjC5UYsXU');
    this.knownFeeds.set('MATIC/USD', '5de6C4F78C758EY4yJTGJJoSAJbWN7xUhNKhBjhk7vJf');
    this.knownFeeds.set('LINK/USD', 'CZx29wKMUxaJDq6aLVQTdViPL754tTR64NAgQBUGxxHb');
    this.knownFeeds.set('DOT/USD', 'EcQQnKYptk26P8sWxyuwKSqf9KDnN2YPGPUGLtBSKcNt');
    this.knownFeeds.set('UNI/USD', '78xZv7Q7fZNMGrYEp4rZNNQNxzFePvX82M6K8wLGJh3V');
  }

  /**
   * Parse Pyth oracle price data
   */
  async parseOraclePrice(
    feedId: string,
    symbol?: string
  ): Promise<OraclePrice | null> {
    try {
      // Get feed address from symbol or use direct feed ID
      const feedAddress = symbol ? this.knownFeeds.get(symbol) : feedId;
      
      if (!feedAddress) {
        console.log(`⚠️ Unknown Pyth feed: ${symbol || feedId}`);
        return null;
      }

      // Get price data from Pyth
      const priceData = await this.pythConnection.getLatestPriceFeeds([feedAddress]);
      
      if (!priceData || priceData.length === 0) {
        console.log(`⚠️ No Pyth price data for feed: ${feedAddress}`);
        return null;
      }

      const feed = priceData[0];
      const price = feed.getPriceUnchecked();

      if (!price) {
        console.log(`⚠️ Invalid Pyth price data for feed: ${feedAddress}`);
        return null;
      }

      // Calculate price with proper scaling
      const scaledPrice = new Decimal(price.price).mul(
        new Decimal(10).pow(price.expo)
      );

      // Calculate confidence interval
      const confidence = new Decimal(price.conf || 0).mul(
        new Decimal(10).pow(price.expo)
      );

      const confidenceInterval = confidence.div(scaledPrice).mul(100); // As percentage

      // Determine price status
      const status = this.determinePriceStatus(price.publishTime);
      
      return {
        feedId: feedAddress,
        symbol: symbol || 'UNKNOWN',
        price: scaledPrice,
        confidence: confidenceInterval.toNumber(),
        lastUpdate: price.publishTime * 1000, // Convert to milliseconds
        status,
        source: 'Pyth Network'
      };

    } catch (error) {
      console.error(`❌ Error parsing Pyth oracle price for ${symbol || feedId}:`, error);
      return null;
    }
  }

  /**
   * Get multiple oracle prices at once
   */
  async getMultiplePrices(symbols: string[]): Promise<Map<string, OraclePrice>> {
    const results = new Map<string, OraclePrice>();
    
    try {
      // Get all feed addresses
      const feedAddresses = symbols
        .map(symbol => this.knownFeeds.get(symbol))
        .filter(address => address !== undefined) as string[];

      if (feedAddresses.length === 0) {
        console.log('⚠️ No valid Pyth feeds found for symbols:', symbols);
        return results;
      }

      // Batch request to Pyth
      const priceDataList = await this.pythConnection.getLatestPriceFeeds(feedAddresses);

      for (let i = 0; i < priceDataList.length; i++) {
        const feed = priceDataList[i];
        const symbol = symbols[i];
        
        if (!feed) continue;

        const price = feed.getPriceUnchecked();
        if (!price) continue;

        const scaledPrice = new Decimal(price.price).mul(
          new Decimal(10).pow(price.expo)
        );

        const confidence = new Decimal(price.conf || 0).mul(
          new Decimal(10).pow(price.expo)
        );

        const confidenceInterval = confidence.div(scaledPrice).mul(100);
        const status = this.determinePriceStatus(price.publishTime);

        results.set(symbol, {
          feedId: feedAddresses[i],
          symbol,
          price: scaledPrice,
          confidence: confidenceInterval.toNumber(),
          lastUpdate: price.publishTime * 1000,
          status,
          source: 'Pyth Network'
        });
      }

    } catch (error) {
      console.error('❌ Error getting multiple Pyth prices:', error);
    }

    return results;
  }

  /**
   * Validate oracle price data
   */
  validateOraclePrice(oraclePrice: OraclePrice): OracleValidation {
    const now = Date.now();
    const ageMinutes = (now - oraclePrice.lastUpdate) / (1000 * 60);

    // Age validation
    const isStale = ageMinutes > 5; // Consider stale if older than 5 minutes
    
    // Confidence validation
    const hasGoodConfidence = oraclePrice.confidence < 1; // Less than 1% uncertainty
    
    // Price validation (basic sanity checks)
    const hasValidPrice = oraclePrice.price.gt(0) && oraclePrice.price.lt(1000000);

    // Overall validity
    const isValid = !isStale && hasGoodConfidence && hasValidPrice && 
                   oraclePrice.status === 'active';

    let issues: string[] = [];
    if (isStale) issues.push(`Stale data (${ageMinutes.toFixed(1)} minutes old)`);
    if (!hasGoodConfidence) issues.push(`High uncertainty (${oraclePrice.confidence.toFixed(2)}%)`);
    if (!hasValidPrice) issues.push('Invalid price value');
    if (oraclePrice.status !== 'active') issues.push(`Inactive status: ${oraclePrice.status}`);

    return {
      isValid,
      confidence: oraclePrice.confidence,
      lastUpdate: oraclePrice.lastUpdate,
      ageMinutes,
      issues,
      qualityScore: this.calculateQualityScore(oraclePrice, ageMinutes)
    };
  }

  /**
   * Subscribe to real-time price updates
   */
  async subscribeToPriceUpdates(
    symbols: string[],
    callback: (symbol: string, price: OraclePrice) => void
  ): Promise<void> {
    try {
      const feedAddresses = symbols
        .map(symbol => ({ symbol, address: this.knownFeeds.get(symbol) }))
        .filter(item => item.address !== undefined) as Array<{ symbol: string; address: string }>;

      if (feedAddresses.length === 0) {
        console.log('⚠️ No valid Pyth feeds to subscribe to');
        return;
      }

      // Subscribe to price updates
      this.pythConnection.onPriceChange(
        feedAddresses.map(item => item.address),
        (feed) => {
          // Find the symbol for this feed
          const feedItem = feedAddresses.find(item => item.address === feed.id);
          if (!feedItem) return;

          const price = feed.getPriceUnchecked();
          if (!price) return;

          const scaledPrice = new Decimal(price.price).mul(
            new Decimal(10).pow(price.expo)
          );

          const confidence = new Decimal(price.conf || 0).mul(
            new Decimal(10).pow(price.expo)
          );

          const confidenceInterval = confidence.div(scaledPrice).mul(100);
          const status = this.determinePriceStatus(price.publishTime);

          const oraclePrice: OraclePrice = {
            feedId: feed.id,
            symbol: feedItem.symbol,
            price: scaledPrice,
            confidence: confidenceInterval.toNumber(),
            lastUpdate: price.publishTime * 1000,
            status,
            source: 'Pyth Network'
          };

          callback(feedItem.symbol, oraclePrice);
        }
      );

      console.log(`✅ Subscribed to ${feedAddresses.length} Pyth price feeds`);

    } catch (error) {
      console.error('❌ Error subscribing to Pyth price updates:', error);
    }
  }

  /**
   * Get available price feeds
   */
  getAvailableFeeds(): Array<{ symbol: string; feedId: string }> {
    return Array.from(this.knownFeeds.entries()).map(([symbol, feedId]) => ({
      symbol,
      feedId
    }));
  }

  /**
   * Check if a feed is supported
   */
  isFeedSupported(symbol: string): boolean {
    return this.knownFeeds.has(symbol);
  }

  /**
   * Get feed address for symbol
   */
  getFeedAddress(symbol: string): string | undefined {
    return this.knownFeeds.get(symbol);
  }

  /**
   * Determine price status based on publish time
   */
  private determinePriceStatus(publishTime: number): 'active' | 'stale' | 'inactive' {
    const now = Math.floor(Date.now() / 1000); // Current time in seconds
    const ageSeconds = now - publishTime;

    if (ageSeconds <= 60) return 'active';        // Less than 1 minute
    if (ageSeconds <= 300) return 'stale';       // Less than 5 minutes
    return 'inactive';                           // Older than 5 minutes
  }

  /**
   * Calculate quality score for oracle price
   */
  private calculateQualityScore(oraclePrice: OraclePrice, ageMinutes: number): number {
    let score = 100;

    // Age penalty
    if (ageMinutes > 5) score -= 50;
    else if (ageMinutes > 2) score -= 20;
    else if (ageMinutes > 1) score -= 10;

    // Confidence penalty
    if (oraclePrice.confidence > 5) score -= 40;
    else if (oraclePrice.confidence > 2) score -= 20;
    else if (oraclePrice.confidence > 1) score -= 10;

    // Status penalty
    if (oraclePrice.status === 'stale') score -= 15;
    else if (oraclePrice.status === 'inactive') score -= 50;

    return Math.max(0, score);
  }

  /**
   * Clean up resources
   */
  async cleanup(): Promise<void> {
    try {
      // The Pyth connection doesn't have an explicit close method
      // but we can clear our references
      this.knownFeeds.clear();
      console.log('✅ Pyth price parser cleaned up');
    } catch (error) {
      console.error('❌ Error cleaning up Pyth price parser:', error);
    }
  }
} 