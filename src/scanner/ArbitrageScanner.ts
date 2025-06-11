import { EventEmitter } from 'events';
import Decimal from 'decimal.js';
import { SolanaWebSocketClient } from '../websocket/SolanaWebSocketClient';
import { TrueArbitrageOpportunity, PoolUpdate, DEXPriceMap, TokenPair, CostComponents, DEXPrice } from '../types';
import { DEFAULT_CONFIG, ScannerConfig } from '../config';

export class ArbitrageScanner extends EventEmitter {
  private solanaClient: SolanaWebSocketClient;
  private config: ScannerConfig;
  private priceCache: Map<string, PoolUpdate> = new Map();
  private isRunning = false;
  private scanInterval?: NodeJS.Timeout;

  constructor(config: Partial<ScannerConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    
    this.solanaClient = new SolanaWebSocketClient({
      endpoint: this.config.solanaEndpoints.websocket,
      commitment: this.config.scanning.commitment
    });

    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.solanaClient.on('connected', () => {
      console.log('✅ Arbitrage scanner connected to Solana WebSocket');
      this.emit('connected');
    });

    this.solanaClient.on('poolUpdate', (update: PoolUpdate) => {
      this.handlePoolUpdate(update);
    });

    this.solanaClient.on('error', (error: Error) => {
      console.error('❌ WebSocket error:', error);
      this.emit('error', error);
    });
  }

  /**
   * Start real-time arbitrage scanning
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      console.log('⚠️ Scanner is already running');
      return;
    }

    console.log('🚀 Starting real-time arbitrage scanner...');
    this.isRunning = true;

    try {
      // Connect to Solana WebSocket
      await this.solanaClient.connect();

      // Subscribe to all configured pools
      await this.subscribeToAllPools();

      // Start periodic arbitrage scanning
      this.startPeriodicScanning();

      console.log('✅ Arbitrage scanner started successfully');
      this.emit('started');

    } catch (error) {
      console.error('❌ Failed to start arbitrage scanner:', error);
      this.isRunning = false;
      throw error;
    }
  }

  /**
   * Stop arbitrage scanning
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      console.log('⚠️ Scanner is not running');
      return;
    }

    console.log('🛑 Stopping arbitrage scanner...');
    this.isRunning = false;

    // Stop periodic scanning
    if (this.scanInterval) {
      clearInterval(this.scanInterval);
      this.scanInterval = undefined;
    }

    // Close WebSocket connections
    await this.solanaClient.close();

    // Clear price cache
    this.priceCache.clear();

    console.log('✅ Arbitrage scanner stopped');
    this.emit('stopped');
  }

  /**
   * Subscribe to all configured pools
   */
  private async subscribeToAllPools(): Promise<void> {
    console.log('📡 Subscribing to all configured pools...');

    for (const [dex, pools] of Object.entries(this.config.pools)) {
      for (const poolAddress of pools) {
        try {
          await this.solanaClient.subscribeToPoolAccount(poolAddress, dex as any);
          console.log(`✅ Subscribed to ${dex} pool: ${poolAddress.substring(0, 8)}...`);
        } catch (error) {
          console.error(`❌ Failed to subscribe to ${dex} pool ${poolAddress}:`, error);
        }
      }
    }
  }

  /**
   * Handle real-time pool updates
   */
  private handlePoolUpdate(update: PoolUpdate): void {
    const cacheKey = `${update.dex}:${update.pool}`;
    this.priceCache.set(cacheKey, update);

    console.log(`📊 Price update: [${update.dex}] ${update.pool.substring(0, 8)}... = ${update.price.toFixed(8)}`);

    // Emit price update event
    this.emit('priceUpdate', update);

    // Trigger immediate arbitrage check for this pool
    this.checkArbitrageOpportunities();
  }

  /**
   * Start periodic arbitrage scanning
   */
  private startPeriodicScanning(): void {
    this.scanInterval = setInterval(() => {
      this.checkArbitrageOpportunities();
    }, this.config.scanning.updateInterval);
  }

  /**
   * Check for arbitrage opportunities across all cached prices
   */
  private checkArbitrageOpportunities(): void {
    if (this.priceCache.size < 2) {
      return; // Need at least 2 pools to find arbitrage
    }

    const opportunities: TrueArbitrageOpportunity[] = [];
    const prices = Array.from(this.priceCache.values());

    // Compare prices across different DEXs
    for (let i = 0; i < prices.length; i++) {
      for (let j = i + 1; j < prices.length; j++) {
        const priceA = prices[i];
        const priceB = prices[j];

        // Skip if same DEX (no arbitrage opportunity)
        if (priceA.dex === priceB.dex) {
          continue;
        }

        // Calculate potential arbitrage
        const opportunity = this.calculateArbitrageOpportunity(priceA, priceB);
        
        if (opportunity && opportunity.profitPercentage.gte(this.config.scanning.minProfitThreshold)) {
          opportunities.push(opportunity);
        }
      }
    }

    // Emit opportunities
    if (opportunities.length > 0) {
      console.log(`🎯 Found ${opportunities.length} arbitrage opportunities!`);
      opportunities.forEach(opp => {
        console.log(`   💰 ${opp.pair}: Buy ${opp.buyDex} @ ${opp.buyPrice.toFixed(8)}, Sell ${opp.sellDex} @ ${opp.sellPrice.toFixed(8)} = ${opp.profitPercentage.toFixed(4)}% profit`);
        this.emit('arbitrageOpportunity', opp);
      });
    }
  }

  /**
   * Calculate real arbitrage opportunity with sophisticated cost analysis
   * Implements client's specification for proper arbitrage calculation
   */
  private calculateArbitrageOpportunity(priceA: PoolUpdate, priceB: PoolUpdate): TrueArbitrageOpportunity | null {
    try {
      // Convert PoolUpdate to DEXPrice format for analysis
      const dexPriceA: DEXPrice = {
        dex: priceA.dex,
        price: priceA.price,
        liquidity: priceA.liquidity,
        timestamp: priceA.timestamp,
        source: 'websocket',
        poolAddress: priceA.pool,
        volume24h: priceA.volume,
        slippage: this.calculateSlippageFromLiquidity(priceA.liquidity)
      };

      const dexPriceB: DEXPrice = {
        dex: priceB.dex,
        price: priceB.price,
        liquidity: priceB.liquidity,
        timestamp: priceB.timestamp,
        source: 'websocket',
        poolAddress: priceB.pool,
        volume24h: priceB.volume,
        slippage: this.calculateSlippageFromLiquidity(priceB.liquidity)
      };

      // Use the client's specified calculation method
      return this.calculateRealArbitrage(dexPriceA, dexPriceB);

    } catch (error) {
      console.error('❌ Error calculating arbitrage opportunity:', error);
      return null;
    }
  }

  /**
   * Client's specified real arbitrage calculation
   * Accounts for slippage, fees, and gas with execution probability
   */
  private calculateRealArbitrage(dexA: DEXPrice, dexB: DEXPrice): TrueArbitrageOpportunity | null {
    // Determine buy and sell DEXs
    let buyDex: DEXPrice, sellDex: DEXPrice;
    
    if (dexA.price.lt(dexB.price)) {
      buyDex = dexA;
      sellDex = dexB;
    } else {
      buyDex = dexB;
      sellDex = dexA;
    }

    // Calculate price difference
    const priceDiff = sellDex.price.sub(buyDex.price);
    const profitPercentage = priceDiff.div(buyDex.price);

    // Account for slippage, fees, and gas
    const totalCosts = this.calculateTotalCosts(buyDex, sellDex);
    const netProfit = priceDiff.sub(totalCosts);

    // Return null if not profitable after costs
    if (netProfit.lte(0)) {
      return null;
    }

    // Calculate execution probability based on liquidity and slippage
    const executionProbability = this.calculateExecutionProbability(buyDex, sellDex);

    // Calculate liquidity score (0-1 normalized)
    const liquidityScore = this.calculateLiquidityScore(buyDex, sellDex);

    // Calculate trade size limits based on liquidity
    const tradeSizeLimits = this.calculateTradeSizeLimits(buyDex, sellDex);

    // Calculate gas estimate in USD
    const gasEstimate = this.calculateGasEstimate(buyDex, sellDex);

    return {
      pair: `${this.formatTokenPair(buyDex, sellDex)}`,
      buyDex: buyDex.dex,
      sellDex: sellDex.dex,
      buyPrice: buyDex.price,
      sellPrice: sellDex.price,
      profitPercentage: profitPercentage.mul(100), // Convert to percentage
      liquidityScore,
      gasEstimate,
      netProfit,
      executionProbability,
      slippageImpact: new Decimal(buyDex.slippage || 0).add(new Decimal(sellDex.slippage || 0)),
      totalFees: this.calculateTotalFees(buyDex, sellDex),
      minimumTradeSize: tradeSizeLimits.minimum,
      maximumTradeSize: tradeSizeLimits.maximum,
      confidence: executionProbability * liquidityScore,
      timestamp: Date.now()
    };
  }

  /**
   * Calculate total trading costs for DEXPrice inputs
   */
  private calculateTotalCosts(buyDex: DEXPrice, sellDex: DEXPrice): Decimal {
    // Base swap fees (typical DEX fees)
    const swapFeeBuy = buyDex.price.mul(this.getDexFeeRate(buyDex.dex));
    const swapFeeSell = sellDex.price.mul(this.getDexFeeRate(sellDex.dex));

    // Gas costs in USD
    const gasCost = this.calculateGasEstimate(buyDex, sellDex);

    // Slippage costs
    const slippageBuy = buyDex.price.mul(buyDex.slippage || 0.001);
    const slippageSell = sellDex.price.mul(sellDex.slippage || 0.001);

    // Protocol fees
    const protocolFeeBuy = buyDex.price.mul(0.0001); // 0.01%
    const protocolFeeSell = sellDex.price.mul(0.0001); // 0.01%

    // MEV protection costs
    const mevProtection = new Decimal(0.0002);

    return swapFeeBuy
      .add(swapFeeSell)
      .add(gasCost)
      .add(slippageBuy)
      .add(slippageSell)
      .add(protocolFeeBuy)
      .add(protocolFeeSell)
      .add(mevProtection);
  }

  /**
   * Legacy cost calculation for PoolUpdate (keeping for compatibility)
   */
  private calculateTotalCostsLegacy(buyPrice: PoolUpdate, sellPrice: PoolUpdate): CostComponents {
    // Base swap fees (typical DEX fees)
    const swapFeeBuy = buyPrice.price.mul(0.003); // 0.3%
    const swapFeeSell = sellPrice.price.mul(0.003); // 0.3%

    // Gas costs (estimated in SOL, converted to price units)
    const gasCost = new Decimal(0.00025); // ~0.00025 SOL per transaction

    // Slippage estimates based on liquidity
    const slippageBuy = this.estimateSlippage(buyPrice);
    const slippageSell = this.estimateSlippage(sellPrice);

    // Protocol fees
    const protocolFee = buyPrice.price.mul(0.0001); // 0.01%

    // MEV protection costs
    const mevProtection = new Decimal(0.0001);

    return {
      swapFeeBuy,
      swapFeeSell,
      gasCost,
      slippageBuy,
      slippageSell,
      protocolFee,
      mevProtection
    };
  }

  /**
   * Legacy slippage estimation (keeping for compatibility)
   */
  private estimateSlippage(price: PoolUpdate): Decimal {
    const liquidityFactor = price.liquidity.div(1000000); // Normalize
    const baseSlippage = new Decimal(0.001); // 0.1% base slippage
    
    // Lower liquidity = higher slippage
    return baseSlippage.div(liquidityFactor.add(1));
  }

  /**
   * Get current scanner status
   */
  getStatus(): {
    isRunning: boolean;
    connectionStatus: boolean;
    subscribedPools: number;
    cachedPrices: number;
  } {
    return {
      isRunning: this.isRunning,
      connectionStatus: this.solanaClient.isConnected(),
      subscribedPools: this.solanaClient.getSubscriptionCount(),
      cachedPrices: this.priceCache.size
    };
  }

  /**
   * Get current price cache
   */
  getPriceCache(): Map<string, PoolUpdate> {
    return new Map(this.priceCache);
  }

  // ========================================
  // NEW SOPHISTICATED ARBITRAGE CALCULATION METHODS
  // Implementing client's specifications
  // ========================================

  /**
   * Calculate slippage from liquidity depth
   */
  private calculateSlippageFromLiquidity(liquidity: Decimal): number {
    // Lower liquidity = higher slippage
    // Formula: base slippage / (liquidity factor + 1)
    const liquidityInMillions = liquidity.div(1000000);
    const baseSlippage = 0.002; // 0.2% base slippage
    
    if (liquidityInMillions.gte(100)) return 0.001; // Very high liquidity: 0.1%
    if (liquidityInMillions.gte(50)) return 0.0015; // High liquidity: 0.15%
    if (liquidityInMillions.gte(10)) return 0.002; // Medium liquidity: 0.2%
    if (liquidityInMillions.gte(1)) return 0.005; // Low liquidity: 0.5%
    
    return 0.01; // Very low liquidity: 1%
  }

  /**
   * Calculate execution probability based on liquidity and market conditions
   */
  private calculateExecutionProbability(buyDex: DEXPrice, sellDex: DEXPrice): number {
    let probability = 0.85; // Base probability

    // Factor in liquidity depth
    const minLiquidity = Decimal.min(buyDex.liquidity, sellDex.liquidity);
    if (minLiquidity.lt(100000)) probability *= 0.6; // Very low liquidity penalty
    else if (minLiquidity.lt(500000)) probability *= 0.75; // Low liquidity penalty
    else if (minLiquidity.lt(1000000)) probability *= 0.9; // Medium liquidity
    else if (minLiquidity.gte(5000000)) probability *= 1.1; // High liquidity bonus

    // Factor in slippage impact
    const totalSlippage = (buyDex.slippage || 0) + (sellDex.slippage || 0);
    if (totalSlippage > 0.01) probability *= 0.7; // High slippage penalty
    else if (totalSlippage > 0.005) probability *= 0.85; // Medium slippage penalty

    // Factor in price age
    const now = Date.now();
    const maxAge = Math.max(now - buyDex.timestamp, now - sellDex.timestamp);
    if (maxAge > 10000) probability *= 0.8; // Stale price penalty (>10s)
    else if (maxAge > 5000) probability *= 0.9; // Medium age penalty (>5s)

    // Factor in DEX reliability
    probability *= this.getDexReliabilityFactor(buyDex.dex);
    probability *= this.getDexReliabilityFactor(sellDex.dex);

    return Math.min(probability, 1.0);
  }

  /**
   * Calculate normalized liquidity score (0-1)
   */
  private calculateLiquidityScore(buyDex: DEXPrice, sellDex: DEXPrice): number {
    const minLiquidity = Decimal.min(buyDex.liquidity, sellDex.liquidity);
    const avgLiquidity = buyDex.liquidity.add(sellDex.liquidity).div(2);
    
    // Normalize to 0-1 scale (10M liquidity = score of 1.0)
    const liquidityScore = avgLiquidity.div(10000000).toNumber();
    
    // Apply penalty for liquidity imbalance
    const liquidityRatio = Decimal.max(buyDex.liquidity, sellDex.liquidity)
      .div(Decimal.min(buyDex.liquidity, sellDex.liquidity));
    
    let balancePenalty = 1.0;
    if (liquidityRatio.gt(5)) balancePenalty = 0.7; // High imbalance penalty
    else if (liquidityRatio.gt(3)) balancePenalty = 0.85; // Medium imbalance penalty
    else if (liquidityRatio.gt(2)) balancePenalty = 0.95; // Small imbalance penalty

    return Math.min(liquidityScore * balancePenalty, 1.0);
  }

  /**
   * Calculate trade size limits based on available liquidity
   */
  private calculateTradeSizeLimits(buyDex: DEXPrice, sellDex: DEXPrice): { minimum: Decimal, maximum: Decimal } {
    const minLiquidity = Decimal.min(buyDex.liquidity, sellDex.liquidity);
    
    // Minimum trade size: $1000 or 0.1% of smaller pool liquidity
    const minimum = Decimal.max(
      new Decimal(1000),
      minLiquidity.mul(0.001)
    );

    // Maximum trade size: 5% of smaller pool to avoid high slippage
    const maximum = minLiquidity.mul(0.05);

    return { minimum, maximum };
  }

  /**
   * Calculate gas estimate in USD
   */
  private calculateGasEstimate(buyDex: DEXPrice, sellDex: DEXPrice): Decimal {
    // Base gas cost per transaction in SOL
    const baseGasSOL = new Decimal(0.000005); // 5000 lamports ≈ $0.0004 at $85/SOL
    
    // Number of transactions (buy + sell)
    const transactionCount = new Decimal(2);
    
    // Priority fee multiplier based on network congestion
    const priorityMultiplier = this.getNetworkCongestionMultiplier();
    
    // Convert to USD (assuming SOL price around $85)
    const solPriceUSD = new Decimal(85);
    
    return baseGasSOL
      .mul(transactionCount)
      .mul(priorityMultiplier)
      .mul(solPriceUSD);
  }

  /**
   * Format token pair for display
   */
  private formatTokenPair(buyDex: DEXPrice, sellDex: DEXPrice): string {
    const buyPool = buyDex.poolAddress?.substring(0, 8) || 'Unknown';
    const sellPool = sellDex.poolAddress?.substring(0, 8) || 'Unknown';
    
    return `${buyPool}.../${sellPool}...`;
  }

  /**
   * Calculate total fees for arbitrage
   */
  private calculateTotalFees(buyDex: DEXPrice, sellDex: DEXPrice): Decimal {
    const buyFee = buyDex.price.mul(this.getDexFeeRate(buyDex.dex));
    const sellFee = sellDex.price.mul(this.getDexFeeRate(sellDex.dex));
    
    return buyFee.add(sellFee);
  }

  /**
   * Get DEX-specific fee rates
   */
  private getDexFeeRate(dex: string): number {
    const feeRates: { [key: string]: number } = {
      'Raydium': 0.0025,    // 0.25%
      'Orca': 0.003,        // 0.3% 
      'Phoenix': 0.002,     // 0.2%
      'Jupiter': 0.004,     // 0.4% (aggregator fee)
      'Meteora': 0.003,     // 0.3%
      'Lifinity': 0.002,    // 0.2%
      'Aldrin': 0.003,      // 0.3%
      'Saber': 0.0025       // 0.25%
    };
    
    return feeRates[dex] || 0.003; // Default 0.3%
  }

  /**
   * Get DEX reliability factor for execution probability
   */
  private getDexReliabilityFactor(dex: string): number {
    const reliabilityFactors: { [key: string]: number } = {
      'Raydium': 0.95,      // Very reliable
      'Orca': 0.93,         // Very reliable
      'Phoenix': 0.90,      // Reliable
      'Jupiter': 0.85,      // Good (aggregator complexity)
      'Meteora': 0.88,      // Good
      'Lifinity': 0.87,     // Good
      'Aldrin': 0.85,       // Moderate
      'Saber': 0.86         // Good
    };
    
    return reliabilityFactors[dex] || 0.8; // Default moderate reliability
  }

  /**
   * Get network congestion multiplier for gas estimation
   */
  private getNetworkCongestionMultiplier(): Decimal {
    // This would typically connect to real network stats
    // For now, return a reasonable estimate
    const hour = new Date().getHours();
    
    // Higher fees during peak hours (UTC)
    if (hour >= 14 && hour <= 18) return new Decimal(1.5); // Peak hours
    if (hour >= 9 && hour <= 21) return new Decimal(1.2);  // Business hours
    
    return new Decimal(1.0); // Off-peak hours
  }
} 