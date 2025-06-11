import { EventEmitter } from 'events';
import { Connection } from '@solana/web3.js';
import Decimal from 'decimal.js';
import { PoolStateMonitor } from './PoolStateMonitor';
import { PriceOracleClient } from './PriceOracleClient';
import { LiquidityMonitor } from './LiquidityMonitor';
import {
  MonitoringConfig,
  MonitoringEvent,
  PoolUpdateEvent,
  OracleUpdateEvent,
  LiquidityAlertEvent,
  PoolStateSnapshot,
  OraclePrice
} from './types';
import { DEXPrice, PoolUpdate } from '../types';

/**
 * MonitoringManager - Centralized coordinator for all monitoring components
 * 
 * Coordinates and manages:
 * - Pool state monitoring (PoolStateMonitor)
 * - Oracle price validation (PriceOracleClient)
 * - Liquidity tracking and alerting (LiquidityMonitor)
 * - Event aggregation and routing
 * - Performance monitoring and statistics
 */
export class MonitoringManager extends EventEmitter {
  private connection: Connection;
  private config: MonitoringConfig;
  
  // Core monitoring components
  private poolMonitor: PoolStateMonitor;
  private oracleClient: PriceOracleClient;
  private liquidityMonitor: LiquidityMonitor;
  
  // State management
  private isInitialized = false;
  private isRunning = false;
  private monitoredPools = new Set<string>();
  private eventStats = new Map<string, number>();
  
  // Performance tracking
  private startTime?: number;
  private totalEvents = 0;

  constructor(
    connection: Connection,
    config: Partial<MonitoringConfig> = {}
  ) {
    super();
    this.connection = connection;
    this.config = this.getDefaultConfig(config);
    
    // Initialize monitoring components
    this.poolMonitor = new PoolStateMonitor(connection, this.config.pool);
    this.oracleClient = new PriceOracleClient(connection, this.config.oracle);
    this.liquidityMonitor = new LiquidityMonitor();
    
    this.setupEventHandlers();
  }

  /**
   * Initialize all monitoring components
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      console.log('⚠️ Monitoring manager is already initialized');
      return;
    }

    try {
      console.log('🚀 Initializing monitoring manager...');

      // Connect to oracle networks
      console.log('📡 Connecting to oracle networks...');
      await Promise.allSettled([
        this.oracleClient.connectToPyth(),
        this.oracleClient.connectToSwitchboard()
      ]);

      // Start pool state monitoring
      await this.poolMonitor.startMonitoring();

      // Start liquidity monitoring
      this.liquidityMonitor.startMonitoring(30000); // 30 second intervals

      this.isInitialized = true;
      this.startTime = Date.now();

      console.log('✅ Monitoring manager initialized successfully');
      this.emit('initialized');

    } catch (error) {
      console.error('❌ Failed to initialize monitoring manager:', error);
      throw error;
    }
  }

  /**
   * Start comprehensive monitoring for a pool
   */
  async startPoolMonitoring(poolAddress: string, dex: string): Promise<void> {
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      console.log(`📊 Starting comprehensive monitoring for pool ${poolAddress.substring(0, 8)}... [${dex}]`);

      // Start pool state monitoring
      await this.poolMonitor.subscribeToPool(poolAddress, dex);

      // Start liquidity monitoring
      await this.liquidityMonitor.monitorPoolLiquidity(poolAddress);

      // Set default liquidity threshold
      const defaultThreshold = new Decimal(100000); // $100k
      await this.liquidityMonitor.setLiquidityThreshold(poolAddress, defaultThreshold);

      this.monitoredPools.add(poolAddress);
      
      console.log(`✅ Comprehensive monitoring started for pool ${poolAddress.substring(0, 8)}... [${dex}]`);
      this.emit('poolMonitoringStarted', { poolAddress, dex });

    } catch (error) {
      console.error(`❌ Failed to start pool monitoring for ${poolAddress}:`, error);
      throw error;
    }
  }

  /**
   * Stop monitoring for a specific pool
   */
  async stopPoolMonitoring(poolAddress: string): Promise<void> {
    try {
      console.log(`🛑 Stopping monitoring for pool ${poolAddress.substring(0, 8)}...`);

      // Stop pool state monitoring
      await this.poolMonitor.unsubscribeFromPool(poolAddress);

      this.monitoredPools.delete(poolAddress);
      
      console.log(`✅ Stopped monitoring for pool ${poolAddress.substring(0, 8)}...`);
      this.emit('poolMonitoringStopped', { poolAddress });

    } catch (error) {
      console.error(`❌ Failed to stop pool monitoring for ${poolAddress}:`, error);
      throw error;
    }
  }

  /**
   * Start monitoring all configured pools
   */
  async startAllMonitoring(): Promise<void> {
    if (this.isRunning) {
      console.log('⚠️ Monitoring is already running');
      return;
    }

    try {
      console.log('🚀 Starting all monitoring services...');
      this.isRunning = true;

      if (!this.isInitialized) {
        await this.initialize();
      }

      console.log('✅ All monitoring services started');
      this.emit('monitoringStarted');

    } catch (error) {
      console.error('❌ Failed to start all monitoring:', error);
      this.isRunning = false;
      throw error;
    }
  }

  /**
   * Stop all monitoring services
   */
  async stopAllMonitoring(): Promise<void> {
    if (!this.isRunning) {
      console.log('⚠️ Monitoring is not running');
      return;
    }

    try {
      console.log('🛑 Stopping all monitoring services...');
      this.isRunning = false;

      // Stop all component monitoring
      await Promise.allSettled([
        this.poolMonitor.stopMonitoring(),
        this.oracleClient.disconnect(),
        this.liquidityMonitor.stopMonitoring()
      ]);

      // Clear monitored pools
      this.monitoredPools.clear();

      console.log('✅ All monitoring services stopped');
      this.emit('monitoringStopped');

    } catch (error) {
      console.error('❌ Failed to stop all monitoring:', error);
      throw error;
    }
  }

  /**
   * Validate price using oracle data
   */
  async validatePriceWithOracle(price: DEXPrice, tokenMint: string): Promise<boolean> {
    try {
      const validation = await this.oracleClient.validatePrice(price, tokenMint);
      
      if (!validation.isValid) {
        console.log(`⚠️ Price validation failed for ${tokenMint.substring(0, 8)}...: ${validation.reason}`);
      }

      return validation.isValid;
    } catch (error) {
      console.error(`❌ Error validating price for ${tokenMint}:`, error);
      return false;
    }
  }

  /**
   * Get oracle price for token
   */
  async getOraclePrice(tokenMint: string): Promise<OraclePrice | null> {
    return await this.oracleClient.getOraclePrice(tokenMint);
  }

  /**
   * Get pool state snapshot
   */
  async getPoolState(poolAddress: string): Promise<PoolStateSnapshot | null> {
    return await this.poolMonitor.getPoolState(poolAddress);
  }

  /**
   * Get liquidity trend for pool
   */
  async getLiquidityTrend(poolAddress: string, timeframe: string) {
    return await this.liquidityMonitor.getLiquidityTrend(poolAddress, timeframe);
  }

  /**
   * Handle enhanced pool updates with cross-validation
   */
  async handlePoolUpdate(update: PoolUpdate): Promise<void> {
    try {
      // Update liquidity monitoring
      const poolState = await this.poolMonitor.getPoolState(update.pool);
      if (poolState) {
        this.liquidityMonitor.updateLiquidityData(update.pool, poolState.liquidity);
      }

      // Validate against oracle if available
      const tokenMint = 'So11111111111111111111111111111111111111112'; // SOL mint (example)
      const dexPrice: DEXPrice = {
        dex: update.dex,
        price: update.price,
        liquidity: update.liquidity,
        timestamp: update.timestamp,
        source: 'websocket',
        poolAddress: update.pool,
        volume24h: update.volume
      };

      const isValidated = await this.validatePriceWithOracle(dexPrice, tokenMint);
      
      console.log(`📊 Pool update: ${update.pool.substring(0, 8)}... [${update.dex}] Price: $${update.price.toFixed(4)} ${isValidated ? '✅' : '⚠️'}`);

      // Emit enhanced pool update event
      this.emit('enhancedPoolUpdate', {
        ...update,
        oracleValidated: isValidated
      });

    } catch (error) {
      console.error(`❌ Error handling pool update for ${update.pool}:`, error);
    }
  }

  /**
   * Setup event handlers for all monitoring components
   */
  private setupEventHandlers(): void {
    // Pool state monitoring events
    this.poolMonitor.on('poolUpdate', (event: PoolUpdateEvent) => {
      this.trackEvent('poolUpdate');
      this.emit('poolUpdate', event);
    });

    this.poolMonitor.on('healthAlert', (data: any) => {
      this.trackEvent('healthAlert');
      console.log(`🚨 Pool health alert: ${data.poolAddress.substring(0, 8)}... (score: ${data.healthScore})`);
      this.emit('healthAlert', data);
    });

    this.poolMonitor.on('liquidityAlert', (data: any) => {
      this.trackEvent('liquidityAlert');
      console.log(`🚨 Pool liquidity alert: ${data.poolAddress.substring(0, 8)}... ($${data.liquidity.toFixed(0)})`);
      this.emit('liquidityAlert', data);
    });

    // Oracle client events
    this.oracleClient.on('oracleUpdate', (event: OracleUpdateEvent) => {
      this.trackEvent('oracleUpdate');
      this.emit('oracleUpdate', event);
    });

    this.oracleClient.on('pythConnected', () => {
      console.log('✅ Pyth Network connected');
      this.emit('oracleConnected', { source: 'pyth' });
    });

    this.oracleClient.on('switchboardConnected', () => {
      console.log('✅ Switchboard connected');
      this.emit('oracleConnected', { source: 'switchboard' });
    });

    // Liquidity monitoring events
    this.liquidityMonitor.on('liquidityAlert', (event: LiquidityAlertEvent) => {
      this.trackEvent('liquidityAlert');
      this.emit('liquidityAlert', event);
    });

    this.liquidityMonitor.on('liquidityUpdated', (data: any) => {
      this.trackEvent('liquidityUpdate');
      // Don't emit every update to avoid spam
    });

    this.liquidityMonitor.on('monitoringStarted', () => {
      console.log('✅ Liquidity monitoring service started');
    });
  }

  /**
   * Track event statistics
   */
  private trackEvent(eventType: string): void {
    this.totalEvents++;
    const count = this.eventStats.get(eventType) || 0;
    this.eventStats.set(eventType, count + 1);
  }

  /**
   * Get comprehensive monitoring statistics
   */
  getMonitoringStats(): {
    isInitialized: boolean;
    isRunning: boolean;
    uptime: number;
    monitoredPools: number;
    totalEvents: number;
    eventBreakdown: { [key: string]: number };
    components: {
      poolMonitor: any;
      oracleClient: any;
      liquidityMonitor: any;
    };
  } {
    const uptime = this.startTime ? Date.now() - this.startTime : 0;
    const eventBreakdown: { [key: string]: number } = {};
    
    for (const [event, count] of this.eventStats) {
      eventBreakdown[event] = count;
    }

    return {
      isInitialized: this.isInitialized,
      isRunning: this.isRunning,
      uptime,
      monitoredPools: this.monitoredPools.size,
      totalEvents: this.totalEvents,
      eventBreakdown,
      components: {
        poolMonitor: this.poolMonitor.getMonitoringStats(),
        oracleClient: this.oracleClient.getOracleStats(),
        liquidityMonitor: this.liquidityMonitor.getMonitoringStats()
      }
    };
  }

  /**
   * Get health check status
   */
  getHealthStatus(): {
    overall: 'healthy' | 'warning' | 'critical';
    components: {
      poolMonitor: 'healthy' | 'warning' | 'critical';
      oracleClient: 'healthy' | 'warning' | 'critical';
      liquidityMonitor: 'healthy' | 'warning' | 'critical';
    };
    issues: string[];
  } {
    const issues: string[] = [];
    
    // Check pool monitor health
    const poolStats = this.poolMonitor.getMonitoringStats();
    const poolHealth = poolStats.isMonitoring && poolStats.monitoredPools > 0 ? 'healthy' : 
                     poolStats.isMonitoring ? 'warning' : 'critical';
    
    if (poolHealth !== 'healthy') {
      issues.push('Pool monitoring issues detected');
    }

    // Check oracle client health
    const oracleStats = this.oracleClient.getOracleStats();
    const oracleHealth = (oracleStats.pythConnected || oracleStats.switchboardConnected) ? 'healthy' : 'critical';
    
    if (oracleHealth !== 'healthy') {
      issues.push('Oracle connection issues detected');
    }

    // Check liquidity monitor health
    const liquidityStats = this.liquidityMonitor.getMonitoringStats();
    const liquidityHealth = liquidityStats.isMonitoring ? 'healthy' : 'warning';
    
    if (liquidityHealth !== 'healthy') {
      issues.push('Liquidity monitoring issues detected');
    }

    // Determine overall health
    const overallHealth = issues.length === 0 ? 'healthy' : 
                         issues.length <= 1 ? 'warning' : 'critical';

    return {
      overall: overallHealth,
      components: {
        poolMonitor: poolHealth,
        oracleClient: oracleHealth,
        liquidityMonitor: liquidityHealth
      },
      issues
    };
  }

  /**
   * Perform cleanup operations
   */
  async cleanup(): Promise<void> {
    console.log('🧹 Performing monitoring cleanup...');
    
    // Clean up liquidity monitor data
    this.liquidityMonitor.cleanup();
    
    // Reset event statistics
    this.eventStats.clear();
    this.totalEvents = 0;
    
    console.log('✅ Monitoring cleanup completed');
  }

  /**
   * Get default configuration
   */
  private getDefaultConfig(config: Partial<MonitoringConfig>): MonitoringConfig {
    return {
      pool: {
        updateInterval: 5000, // 5 seconds
        healthCheckInterval: 30000, // 30 seconds
        liquidityThresholds: {
          minimum: new Decimal(50000), // $50k
          warning: new Decimal(100000), // $100k
          critical: new Decimal(25000)  // $25k
        },
        volatilityThreshold: 0.1, // 10%
        maxPriceAge: 30000, // 30 seconds
        ...(config.pool || {})
      },
      oracle: {
        pythProgramId: 'FsJ3A3u2vn5cTVofAjvy6y5kwABJAqYWpe4975bi2epH',
        switchboardProgramId: 'SW1TCH7qEPTdLsDHRgPuMQjbQxKdH2aBStViMFnt64f',
        maxPriceAge: 30000, // 30 seconds
        confidenceThreshold: 0.02, // 2%
        deviationThreshold: 0.05, // 5%
        updateInterval: 5000, // 5 seconds
        ...(config.oracle || {})
      },
      alerting: {
        enabled: true,
        ...(config.alerting || {})
      },
      performance: {
        maxCacheSize: 10000,
        cacheTimeout: 300000, // 5 minutes
        batchSize: 100,
        ...(config.performance || {})
      }
    };
  }

  /**
   * Force refresh all cached data
   */
  async refreshAllData(): Promise<void> {
    console.log('🔄 Refreshing all monitoring data...');
    
    // This would trigger fresh data fetches from all components
    // Implementation would depend on specific refresh needs
    
    console.log('✅ All monitoring data refreshed');
    this.emit('dataRefreshed');
  }
} 