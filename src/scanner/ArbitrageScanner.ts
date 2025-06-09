import { EventEmitter } from 'events';
import Decimal from 'decimal.js';
import { SolanaWebSocketClient } from '../websocket/SolanaWebSocketClient';
import { TrueArbitrageOpportunity, PoolUpdate, DEXPriceMap, TokenPair, CostComponents } from '../types';
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
   * Calculate arbitrage opportunity between two price sources
   */
  private calculateArbitrageOpportunity(priceA: PoolUpdate, priceB: PoolUpdate): TrueArbitrageOpportunity | null {
    try {
      // Determine buy and sell sides
      let buyPrice: PoolUpdate, sellPrice: PoolUpdate;
      
      if (priceA.price.lt(priceB.price)) {
        buyPrice = priceA;
        sellPrice = priceB;
      } else {
        buyPrice = priceB;
        sellPrice = priceA;
      }

      // Calculate basic profit
      const priceDiff = sellPrice.price.sub(buyPrice.price);
      const profitPercentage = priceDiff.div(buyPrice.price).mul(100);

      // Calculate costs
      const costs = this.calculateTotalCosts(buyPrice, sellPrice);
      const netProfit = priceDiff.sub(costs.swapFeeBuy).sub(costs.swapFeeSell).sub(costs.gasCost);
      const netProfitPercentage = netProfit.div(buyPrice.price).mul(100);

      // Skip if not profitable after costs
      if (netProfitPercentage.lte(0)) {
        return null;
      }

      // Calculate execution probability
      const executionProbability = this.calculateExecutionProbability(buyPrice, sellPrice);

      // Calculate liquidity score
      const liquidityScore = Math.min(
        buyPrice.liquidity.toNumber(),
        sellPrice.liquidity.toNumber()
      ) / 1000000; // Normalize to millions

      return {
        pair: `${buyPrice.pool.substring(0, 8)}.../${sellPrice.pool.substring(0, 8)}...`,
        buyDex: buyPrice.dex,
        sellDex: sellPrice.dex,
        buyPrice: buyPrice.price,
        sellPrice: sellPrice.price,
        profitPercentage: netProfitPercentage,
        liquidityScore,
        gasEstimate: costs.gasCost,
        netProfit,
        executionProbability,
        slippageImpact: costs.slippageBuy.add(costs.slippageSell),
        totalFees: costs.swapFeeBuy.add(costs.swapFeeSell),
        minimumTradeSize: new Decimal(1000), // $1000 minimum
        maximumTradeSize: new Decimal(Math.min(buyPrice.liquidity.toNumber(), sellPrice.liquidity.toNumber()) * 0.1),
        confidence: executionProbability * liquidityScore,
        timestamp: Date.now()
      };

    } catch (error) {
      console.error('❌ Error calculating arbitrage opportunity:', error);
      return null;
    }
  }

  /**
   * Calculate total trading costs
   */
  private calculateTotalCosts(buyPrice: PoolUpdate, sellPrice: PoolUpdate): CostComponents {
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
   * Estimate slippage based on liquidity
   */
  private estimateSlippage(price: PoolUpdate): Decimal {
    const liquidityFactor = price.liquidity.div(1000000); // Normalize
    const baseSlippage = new Decimal(0.001); // 0.1% base slippage
    
    // Lower liquidity = higher slippage
    return baseSlippage.div(liquidityFactor.add(1));
  }

  /**
   * Calculate execution probability
   */
  private calculateExecutionProbability(buyPrice: PoolUpdate, sellPrice: PoolUpdate): number {
    // Base probability
    let probability = 0.8;

    // Factor in liquidity
    const minLiquidity = Math.min(buyPrice.liquidity.toNumber(), sellPrice.liquidity.toNumber());
    if (minLiquidity < 100000) probability *= 0.7; // Low liquidity penalty
    if (minLiquidity > 1000000) probability *= 1.1; // High liquidity bonus

    // Factor in price age
    const now = Date.now();
    const maxAge = Math.max(now - buyPrice.timestamp, now - sellPrice.timestamp);
    if (maxAge > 5000) probability *= 0.9; // Stale price penalty

    return Math.min(probability, 1.0);
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
} 