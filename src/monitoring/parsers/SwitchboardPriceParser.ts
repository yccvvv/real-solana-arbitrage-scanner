import { Connection, PublicKey, AccountInfo } from '@solana/web3.js';
import Decimal from 'decimal.js';
import { OraclePrice, OracleValidation } from '../types';

/**
 * SwitchboardPriceParser - Simplified Switchboard oracle parser
 * 
 * Parses Switchboard aggregator price feeds without requiring SDK
 * Uses manual parsing of account data structures
 */
export class SwitchboardPriceParser {
  private connection: Connection;
  private knownFeeds: Map<string, string> = new Map();

  constructor(connection: Connection) {
    this.connection = connection;
    this.initializeKnownFeeds();
  }

  /**
   * Initialize known Switchboard aggregator addresses
   */
  private initializeKnownFeeds(): void {
    // Real Switchboard aggregator addresses on Solana mainnet
    this.knownFeeds.set('SOL/USD', 'GdHyNjRZqmxGWpV3xz6a7G1CNLFPLKhVJLm5qZQnKxbB');
    this.knownFeeds.set('USDC/USD', '5mp8kbkTYwWWCsKSte8rURjSaGyNDiuewcAMwERHE1T9');
    this.knownFeeds.set('USDT/USD', 'Et3bNDxe2wP1yE5ao6mMvUByQUHg8nZTndPJNw6bJgpy');
    this.knownFeeds.set('BTC/USD', '74YzQPGUT9VnjrBz8MuyDLKgKpbDqGot5xZJvTtMi6Ng');
    this.knownFeeds.set('ETH/USD', '2ciUuGZiee5macAMeQ7bHGTJtwcYTgnt6jdmQnnKZrfu');
    this.knownFeeds.set('mSOL/USD', 'E4v1BBgoso9s64TQvmyownAVJbhbEPGyzA3qn4n46qj9');
  }

  /**
   * Parse Switchboard oracle price data
   */
  async parseOraclePrice(
    feedId: string,
    symbol?: string
  ): Promise<OraclePrice | null> {
    try {
      // Get feed address from symbol or use direct feed ID
      const feedAddress = symbol ? this.knownFeeds.get(symbol) : feedId;
      
      if (!feedAddress) {
        console.log(`⚠️ Unknown Switchboard feed: ${symbol || feedId}`);
        return null;
      }

      // Get account data
      const publicKey = new PublicKey(feedAddress);
      const accountInfo = await this.connection.getAccountInfo(publicKey);
      
      if (!accountInfo || !accountInfo.data) {
        console.log(`⚠️ No Switchboard data for feed: ${feedAddress}`);
        return null;
      }

      // Parse Switchboard aggregator data
      const priceData = this.parseSwitchboardData(accountInfo.data);
      
      if (!priceData) {
        console.log(`⚠️ Invalid Switchboard data for feed: ${feedAddress}`);
        return null;
      }

      // Determine price status
      const status = this.determinePriceStatus(priceData.lastUpdate);
      
      return {
        feedId: feedAddress,
        symbol: symbol || 'UNKNOWN',
        price: priceData.price,
        confidence: priceData.confidence,
        lastUpdate: priceData.lastUpdate,
        status,
        source: 'switchboard'
      };

    } catch (error) {
      console.error(`❌ Error parsing Switchboard oracle price for ${symbol || feedId}:`, error);
      return null;
    }
  }

  /**
   * Get multiple oracle prices at once
   */
  async getMultiplePrices(symbols: string[]): Promise<Map<string, OraclePrice>> {
    const results = new Map<string, OraclePrice>();
    
    // Process each symbol individually
    for (const symbol of symbols) {
      try {
        const price = await this.parseOraclePrice('', symbol);
        if (price) {
          results.set(symbol, price);
        }
      } catch (error) {
        console.error(`❌ Error getting Switchboard price for ${symbol}:`, error);
      }
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
    const isStale = ageMinutes > 10; // Consider stale if older than 10 minutes (Switchboard updates less frequently)
    
    // Confidence validation
    const hasGoodConfidence = oraclePrice.confidence < 2; // Less than 2% uncertainty
    
    // Price validation
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
   * Subscribe to real-time price updates (simplified)
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
        console.log('⚠️ No valid Switchboard feeds to subscribe to');
        return;
      }

      // Subscribe to account changes for each feed
      for (const feedItem of feedAddresses) {
        const publicKey = new PublicKey(feedItem.address);
        
        this.connection.onAccountChange(
          publicKey,
          (accountInfo: AccountInfo<Buffer>) => {
            const priceData = this.parseSwitchboardData(accountInfo.data);
            if (!priceData) return;

            const status = this.determinePriceStatus(priceData.lastUpdate);

            const oraclePrice: OraclePrice = {
              feedId: feedItem.address,
              symbol: feedItem.symbol,
              price: priceData.price,
              confidence: priceData.confidence,
              lastUpdate: priceData.lastUpdate,
              status,
              source: 'switchboard'
            };

            callback(feedItem.symbol, oraclePrice);
          },
          'confirmed'
        );
      }

      console.log(`✅ Subscribed to ${feedAddresses.length} Switchboard price feeds`);

    } catch (error) {
      console.error('❌ Error subscribing to Switchboard price updates:', error);
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

  // ========================================
  // PRIVATE HELPER METHODS
  // ========================================

  /**
   * Parse Switchboard aggregator data (simplified)
   */
  private parseSwitchboardData(data: Buffer): { price: Decimal; confidence: number; lastUpdate: number } | null {
    try {
      if (data.length < 512) {
        return null;
      }

      // Switchboard aggregator structure (simplified)
      // This is a basic approximation - real parsing would need the exact layout
      
      // Read price value (stored as signed 128-bit integer at offset 72)
      const priceRaw = data.readBigInt64LE(72);
      const scale = data.readInt8(80); // Scale factor
      
      // Calculate actual price
      const price = new Decimal(priceRaw.toString()).div(new Decimal(10).pow(Math.abs(scale)));
      
      // Read confidence interval (at offset 88)
      const confidenceRaw = data.readBigUInt64LE(88);
      const confidence = new Decimal(confidenceRaw.toString()).div(price).mul(100).toNumber(); // As percentage
      
      // Read last update timestamp (at offset 96)
      const lastUpdate = Number(data.readBigUInt64LE(96)) * 1000; // Convert to milliseconds
      
      return {
        price,
        confidence: Math.min(confidence, 10), // Cap at 10%
        lastUpdate
      };

    } catch (error) {
      console.error('❌ Error parsing Switchboard data:', error);
      return null;
    }
  }

  /**
   * Determine price status based on last update
   */
  private determinePriceStatus(lastUpdate: number): 'active' | 'stale' | 'inactive' {
    const now = Date.now();
    const ageMinutes = (now - lastUpdate) / (1000 * 60);

    if (ageMinutes <= 5) return 'active';        // Less than 5 minutes
    if (ageMinutes <= 15) return 'stale';        // Less than 15 minutes
    return 'inactive';                           // Older than 15 minutes
  }

  /**
   * Calculate quality score for oracle price
   */
  private calculateQualityScore(oraclePrice: OraclePrice, ageMinutes: number): number {
    let score = 100;

    // Age penalty (Switchboard updates less frequently)
    if (ageMinutes > 15) score -= 60;
    else if (ageMinutes > 10) score -= 30;
    else if (ageMinutes > 5) score -= 15;

    // Confidence penalty
    if (oraclePrice.confidence > 8) score -= 50;
    else if (oraclePrice.confidence > 4) score -= 25;
    else if (oraclePrice.confidence > 2) score -= 10;

    // Status penalty
    if (oraclePrice.status === 'stale') score -= 20;
    else if (oraclePrice.status === 'inactive') score -= 60;

    return Math.max(0, score);
  }

  /**
   * Clean up resources
   */
  async cleanup(): Promise<void> {
    try {
      this.knownFeeds.clear();
      console.log('✅ Switchboard price parser cleaned up');
    } catch (error) {
      console.error('❌ Error cleaning up Switchboard price parser:', error);
    }
  }
} 