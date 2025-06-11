import { EventEmitter } from 'events';
import { Connection, PublicKey } from '@solana/web3.js';
import Decimal from 'decimal.js';
import {
  IPriceOracleClient,
  OraclePrice,
  MultiOraclePrice,
  OracleValidation,
  OracleConfig,
  OracleUpdateEvent
} from './types';
import { DEXPrice } from '../types';

/**
 * PriceOracleClient - Oracle price validation and data aggregation
 * 
 * Provides integration with major Solana oracle networks:
 * - Pyth Network (real-time financial data)
 * - Switchboard (decentralized oracle network)
 * - Price validation for arbitrage opportunities
 * - Multi-oracle consensus pricing
 */
export class PriceOracleClient extends EventEmitter implements IPriceOracleClient {
  private connection: Connection;
  private config: OracleConfig;
  private pythConnected = false;
  private switchboardConnected = false;
  private priceCache = new Map<string, OraclePrice>();
  private multiPriceCache = new Map<string, MultiOraclePrice>();
  private subscriptions = new Map<string, number>();

  // Pyth price feed addresses (mainnet)
  private readonly pythFeeds = new Map<string, string>([
    ['So11111111111111111111111111111111111111112', 'H6ARHf6YXhGYeQfUzQNGk6rDNnLBQKrenN712K4AQJEG'], // SOL/USD
    ['EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', '5uGwzuFHLzeSZNdH32q62CHdLyWBt8QpkbJxFSmcZKT3'], // USDC/USD
    ['Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', 'EnSrmqBJNjT8CMOWHHcnR4Y4d7hX4z5HCF88VdGFg4HT'], // USDT/USD
    // Add more feeds as needed
  ]);

  // Switchboard feed addresses (mainnet)  
  private readonly switchboardFeeds = new Map<string, string>([
    ['So11111111111111111111111111111111111111112', 'GdHyNjRZqmxGWpV3xz6a7G1CNLFPLKhVJLm5qZQnKxbB'], // SOL/USD
    ['EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', '38xMBhKwjvJZhjJNFr5fPDmBdnvXmJ7rG6NeB8jFtNLZ'], // USDC/USD
    // Add more feeds as needed
  ]);

  constructor(
    connection: Connection,
    config: Partial<OracleConfig> = {}
  ) {
    super();
    this.connection = connection;
    this.config = this.getDefaultConfig(config);
  }

  /**
   * Connect to Pyth Network oracle feeds
   */
  async connectToPyth(): Promise<void> {
    try {
      console.log('📡 Connecting to Pyth Network...');
      
      // Verify Pyth program is accessible
      const pythProgramId = new PublicKey(this.config.pythProgramId);
      const pythProgramInfo = await this.connection.getAccountInfo(pythProgramId);
      
      if (!pythProgramInfo) {
        throw new Error('Pyth program not found on network');
      }

      // Subscribe to key price feeds
      for (const [tokenMint, feedAddress] of this.pythFeeds) {
        await this.subscribeToPythFeed(tokenMint, feedAddress);
      }

      this.pythConnected = true;
      console.log('✅ Connected to Pyth Network');
      this.emit('pythConnected');

    } catch (error) {
      console.error('❌ Failed to connect to Pyth Network:', error);
      throw error;
    }
  }

  /**
   * Connect to Switchboard oracle network
   */
  async connectToSwitchboard(): Promise<void> {
    try {
      console.log('📡 Connecting to Switchboard...');
      
      // Verify Switchboard program is accessible
      const switchboardProgramId = new PublicKey(this.config.switchboardProgramId);
      const switchboardProgramInfo = await this.connection.getAccountInfo(switchboardProgramId);
      
      if (!switchboardProgramInfo) {
        throw new Error('Switchboard program not found on network');
      }

      // Subscribe to key aggregator feeds
      for (const [tokenMint, aggregatorAddress] of this.switchboardFeeds) {
        await this.subscribeToSwitchboardFeed(tokenMint, aggregatorAddress);
      }

      this.switchboardConnected = true;
      console.log('✅ Connected to Switchboard');
      this.emit('switchboardConnected');

    } catch (error) {
      console.error('❌ Failed to connect to Switchboard:', error);
      throw error;
    }
  }

  /**
   * Get oracle price for a specific token
   */
  async getOraclePrice(tokenMint: string): Promise<OraclePrice | null> {
    try {
      // Check cache first
      const cached = this.priceCache.get(tokenMint);
      if (cached && this.isPriceValid(cached)) {
        return cached;
      }

      // Try Pyth first
      if (this.pythConnected) {
        const pythPrice = await this.fetchPythPrice(tokenMint);
        if (pythPrice) {
          this.priceCache.set(tokenMint, pythPrice);
          return pythPrice;
        }
      }

      // Fallback to Switchboard
      if (this.switchboardConnected) {
        const switchboardPrice = await this.fetchSwitchboardPrice(tokenMint);
        if (switchboardPrice) {
          this.priceCache.set(tokenMint, switchboardPrice);
          return switchboardPrice;
        }
      }

      console.log(`⚠️ No oracle price available for token ${tokenMint.substring(0, 8)}...`);
      return null;

    } catch (error) {
      console.error(`❌ Error fetching oracle price for ${tokenMint}:`, error);
      return null;
    }
  }

  /**
   * Get multi-oracle consensus price
   */
  async getMultiOraclePrice(tokenMint: string): Promise<MultiOraclePrice | null> {
    try {
      // Check cache first
      const cached = this.multiPriceCache.get(tokenMint);
      if (cached && (Date.now() - cached.timestamp) < this.config.maxPriceAge) {
        return cached;
      }

      const prices: OraclePrice[] = [];

      // Collect prices from all available oracles
      if (this.pythConnected) {
        const pythPrice = await this.fetchPythPrice(tokenMint);
        if (pythPrice) prices.push(pythPrice);
      }

      if (this.switchboardConnected) {
        const switchboardPrice = await this.fetchSwitchboardPrice(tokenMint);
        if (switchboardPrice) prices.push(switchboardPrice);
      }

      if (prices.length === 0) {
        return null;
      }

      // Calculate consensus
      const consensus = this.calculateConsensus(prices);
      
      const multiPrice: MultiOraclePrice = {
        tokenMint,
        prices,
        consensus,
        timestamp: Date.now()
      };

      this.multiPriceCache.set(tokenMint, multiPrice);
      return multiPrice;

    } catch (error) {
      console.error(`❌ Error fetching multi-oracle price for ${tokenMint}:`, error);
      return null;
    }
  }

  /**
   * Validate DEX price against oracle data
   */
  async validatePrice(price: DEXPrice, tokenMint: string): Promise<OracleValidation> {
    try {
      const oraclePrice = await this.getOraclePrice(tokenMint);
      
      if (!oraclePrice) {
        return {
          isValid: false,
          confidence: 0,
          priceDeviation: new Decimal(0),
          staleness: 0,
          reason: 'No oracle price available'
        };
      }

      // Check staleness
      const staleness = (Date.now() - oraclePrice.timestamp) / 1000; // seconds
      if (staleness > this.config.maxPriceAge / 1000) {
        return {
          isValid: false,
          confidence: 0,
          priceDeviation: new Decimal(0),
          staleness,
          reason: 'Oracle price is stale'
        };
      }

      // Calculate price deviation
      const deviation = price.price.sub(oraclePrice.price).div(oraclePrice.price).abs();
      const deviationPercent = deviation.toNumber();

      // Check if deviation is within acceptable threshold
      const isWithinThreshold = deviationPercent <= this.config.deviationThreshold;
      
      // Calculate confidence based on oracle confidence and deviation
      const oracleConfidence = oraclePrice.confidence.div(oraclePrice.price).toNumber();
      let confidence = Math.max(0, 1 - deviationPercent - oracleConfidence);
      
      // Apply penalty for staleness
      if (staleness > 10) { // More than 10 seconds old
        confidence *= Math.max(0.5, 1 - (staleness / 60)); // Reduce confidence over time
      }

      return {
        isValid: isWithinThreshold,
        confidence,
        priceDeviation: deviation.mul(100), // Convert to percentage
        staleness,
        reason: isWithinThreshold ? undefined : 'Price deviation exceeds threshold'
      };

    } catch (error) {
      console.error(`❌ Error validating price for ${tokenMint}:`, error);
      return {
        isValid: false,
        confidence: 0,
        priceDeviation: new Decimal(0),
        staleness: 0,
        reason: 'Validation error'
      };
    }
  }

  /**
   * Check if oracle connections are active
   */
  isConnected(): boolean {
    return this.pythConnected || this.switchboardConnected;
  }

  /**
   * Subscribe to Pyth price feed
   */
  private async subscribeToPythFeed(tokenMint: string, feedAddress: string): Promise<void> {
    try {
      const feedPublicKey = new PublicKey(feedAddress);
      
      const subscriptionId = this.connection.onAccountChange(
        feedPublicKey,
        (accountInfo, context) => {
          this.handlePythPriceUpdate(tokenMint, accountInfo, context);
        },
        'confirmed'
      );

      this.subscriptions.set(`pyth:${tokenMint}`, subscriptionId);
      console.log(`📊 Subscribed to Pyth feed: ${tokenMint.substring(0, 8)}...`);

    } catch (error) {
      console.error(`❌ Failed to subscribe to Pyth feed ${feedAddress}:`, error);
    }
  }

  /**
   * Subscribe to Switchboard aggregator feed
   */
  private async subscribeToSwitchboardFeed(tokenMint: string, aggregatorAddress: string): Promise<void> {
    try {
      const aggregatorPublicKey = new PublicKey(aggregatorAddress);
      
      const subscriptionId = this.connection.onAccountChange(
        aggregatorPublicKey,
        (accountInfo, context) => {
          this.handleSwitchboardPriceUpdate(tokenMint, accountInfo, context);
        },
        'confirmed'
      );

      this.subscriptions.set(`switchboard:${tokenMint}`, subscriptionId);
      console.log(`📊 Subscribed to Switchboard feed: ${tokenMint.substring(0, 8)}...`);

    } catch (error) {
      console.error(`❌ Failed to subscribe to Switchboard feed ${aggregatorAddress}:`, error);
    }
  }

  /**
   * Handle Pyth price update
   */
  private async handlePythPriceUpdate(tokenMint: string, accountInfo: any, context: any): Promise<void> {
    try {
      const oldPrice = this.priceCache.get(tokenMint);
      const newPrice = await this.parsePythPrice(tokenMint, accountInfo.data);
      
      if (newPrice) {
        this.priceCache.set(tokenMint, newPrice);
        
        const event: OracleUpdateEvent = {
          type: 'oracle_update',
          timestamp: Date.now(),
          source: 'pyth',
          data: {
            tokenMint,
            oldPrice: oldPrice!,
            newPrice,
            validation: await this.validatePrice({ 
              dex: 'Oracle', 
              price: newPrice.price, 
              liquidity: new Decimal(0), 
              timestamp: newPrice.timestamp,
              source: 'oracle'
            }, tokenMint)
          }
        };
        
        this.emit('oracleUpdate', event);
      }
    } catch (error) {
      console.error(`❌ Error handling Pyth price update for ${tokenMint}:`, error);
    }
  }

  /**
   * Handle Switchboard price update
   */
  private async handleSwitchboardPriceUpdate(tokenMint: string, accountInfo: any, context: any): Promise<void> {
    try {
      const oldPrice = this.priceCache.get(tokenMint);
      const newPrice = await this.parseSwitchboardPrice(tokenMint, accountInfo.data);
      
      if (newPrice) {
        this.priceCache.set(tokenMint, newPrice);
        
        const event: OracleUpdateEvent = {
          type: 'oracle_update',
          timestamp: Date.now(),
          source: 'switchboard',
          data: {
            tokenMint,
            oldPrice: oldPrice!,
            newPrice,
            validation: await this.validatePrice({ 
              dex: 'Oracle', 
              price: newPrice.price, 
              liquidity: new Decimal(0), 
              timestamp: newPrice.timestamp,
              source: 'oracle'
            }, tokenMint)
          }
        };
        
        this.emit('oracleUpdate', event);
      }
    } catch (error) {
      console.error(`❌ Error handling Switchboard price update for ${tokenMint}:`, error);
    }
  }

  /**
   * Fetch current Pyth price
   */
  private async fetchPythPrice(tokenMint: string): Promise<OraclePrice | null> {
    const feedAddress = this.pythFeeds.get(tokenMint);
    if (!feedAddress) return null;

    try {
      const accountInfo = await this.connection.getAccountInfo(new PublicKey(feedAddress));
      if (!accountInfo) return null;

      return await this.parsePythPrice(tokenMint, accountInfo.data);
    } catch (error) {
      console.error(`❌ Error fetching Pyth price for ${tokenMint}:`, error);
      return null;
    }
  }

  /**
   * Fetch current Switchboard price
   */
  private async fetchSwitchboardPrice(tokenMint: string): Promise<OraclePrice | null> {
    const aggregatorAddress = this.switchboardFeeds.get(tokenMint);
    if (!aggregatorAddress) return null;

    try {
      const accountInfo = await this.connection.getAccountInfo(new PublicKey(aggregatorAddress));
      if (!accountInfo) return null;

      return await this.parseSwitchboardPrice(tokenMint, accountInfo.data);
    } catch (error) {
      console.error(`❌ Error fetching Switchboard price for ${tokenMint}:`, error);
      return null;
    }
  }

  /**
   * Parse Pyth price data (simplified - use @pythnetwork/client in production)
   */
  private async parsePythPrice(tokenMint: string, data: Buffer): Promise<OraclePrice | null> {
    try {
      // This is a simplified parser - use @pythnetwork/client for production
      // Mock implementation for demonstration
      const mockPrice = new Decimal(85 + Math.random() * 10); // SOL price range
      const mockConfidence = mockPrice.mul(0.01); // 1% confidence interval
      
      return {
        tokenMint,
        price: mockPrice,
        confidence: mockConfidence,
        timestamp: Date.now(),
        source: 'pyth',
        exponent: -8,
        status: 'active',
        publishSlot: await this.connection.getSlot()
      };
    } catch (error) {
      console.error('❌ Error parsing Pyth price data:', error);
      return null;
    }
  }

  /**
   * Parse Switchboard price data (simplified - use @switchboard-xyz/solana.js in production)
   */
  private async parseSwitchboardPrice(tokenMint: string, data: Buffer): Promise<OraclePrice | null> {
    try {
      // This is a simplified parser - use @switchboard-xyz/solana.js for production
      // Mock implementation for demonstration
      const mockPrice = new Decimal(84 + Math.random() * 12); // SOL price range
      const mockConfidence = mockPrice.mul(0.005); // 0.5% confidence interval
      
      return {
        tokenMint,
        price: mockPrice,
        confidence: mockConfidence,
        timestamp: Date.now(),
        source: 'switchboard',
        exponent: -9,
        status: 'active',
        publishSlot: await this.connection.getSlot()
      };
    } catch (error) {
      console.error('❌ Error parsing Switchboard price data:', error);
      return null;
    }
  }

  /**
   * Calculate consensus from multiple oracle prices
   */
  private calculateConsensus(prices: OraclePrice[]): MultiOraclePrice['consensus'] {
    if (prices.length === 0) {
      return {
        price: new Decimal(0),
        confidence: 0,
        agreement: 0
      };
    }

    if (prices.length === 1) {
      return {
        price: prices[0].price,
        confidence: 1 - prices[0].confidence.div(prices[0].price).toNumber(),
        agreement: 1
      };
    }

    // Calculate weighted average based on confidence
    const totalWeight = prices.reduce((sum, p) => {
      const confidence = 1 - p.confidence.div(p.price).toNumber();
      return sum + confidence;
    }, 0);

    const weightedSum = prices.reduce((sum, p) => {
      const confidence = 1 - p.confidence.div(p.price).toNumber();
      return sum.add(p.price.mul(confidence));
    }, new Decimal(0));

    const consensusPrice = weightedSum.div(totalWeight);

    // Calculate agreement (how well prices align)
    const deviations = prices.map(p => 
      p.price.sub(consensusPrice).div(consensusPrice).abs().toNumber()
    );
    const maxDeviation = Math.max(...deviations);
    const agreement = Math.max(0, 1 - maxDeviation);

    // Calculate overall confidence
    const avgConfidence = totalWeight / prices.length;

    return {
      price: consensusPrice,
      confidence: avgConfidence * agreement,
      agreement
    };
  }

  /**
   * Check if oracle price is valid (not stale)
   */
  private isPriceValid(price: OraclePrice): boolean {
    const age = Date.now() - price.timestamp;
    return age < this.config.maxPriceAge && price.status === 'active';
  }

  /**
   * Get default configuration
   */
  private getDefaultConfig(config: Partial<OracleConfig>): OracleConfig {
    return {
      pythProgramId: 'FsJ3A3u2vn5cTVofAjvy6y5kwABJAqYWpe4975bi2epH', // Pyth mainnet program
      switchboardProgramId: 'SW1TCH7qEPTdLsDHRgPuMQjbQxKdH2aBStViMFnt64f', // Switchboard mainnet program
      maxPriceAge: 30000, // 30 seconds
      confidenceThreshold: 0.02, // 2%
      deviationThreshold: 0.05, // 5%
      updateInterval: 5000, // 5 seconds
      ...config
    };
  }

  /**
   * Disconnect and cleanup
   */
  async disconnect(): Promise<void> {
    console.log('🛑 Disconnecting oracle clients...');
    
    // Remove all subscriptions
    for (const [key, subscriptionId] of this.subscriptions) {
      try {
        await this.connection.removeAccountChangeListener(subscriptionId);
      } catch (error) {
        console.error(`❌ Error removing subscription ${key}:`, error);
      }
    }
    
    this.subscriptions.clear();
    this.priceCache.clear();
    this.multiPriceCache.clear();
    this.pythConnected = false;
    this.switchboardConnected = false;
    
    console.log('✅ Oracle clients disconnected');
    this.emit('disconnected');
  }

  /**
   * Get oracle client statistics
   */
  getOracleStats(): {
    pythConnected: boolean;
    switchboardConnected: boolean;
    cachedPrices: number;
    activeSubscriptions: number;
    supportedTokens: number;
  } {
    return {
      pythConnected: this.pythConnected,
      switchboardConnected: this.switchboardConnected,
      cachedPrices: this.priceCache.size,
      activeSubscriptions: this.subscriptions.size,
      supportedTokens: this.pythFeeds.size + this.switchboardFeeds.size
    };
  }
} 