import Decimal from 'decimal.js';
import { DEXPrice, PoolUpdate } from '../types';

// ========================================
// POOL STATE MONITORING TYPES
// ========================================

export interface PoolLiquidity {
  poolAddress: string;
  tokenA: {
    mint: string;
    reserve: Decimal;
    decimals: number;
  };
  tokenB: {
    mint: string;
    reserve: Decimal;
    decimals: number;
  };
  totalLiquidity: Decimal; // USD value
  liquidityDepth: Decimal; // Available liquidity at current price
  lastUpdate: number;
  dex: string;
}

export interface PoolHealthMetrics {
  poolAddress: string;
  isActive: boolean;
  tradingVolume24h: Decimal;
  numberOfTrades24h: number;
  averageTradeSize: Decimal;
  liquidityUtilization: number; // 0-1
  priceVolatility: number; // Standard deviation
  lastTradeTimestamp: number;
  healthScore: number; // 0-100
}

export interface PoolStateSnapshot {
  poolAddress: string;
  dex: string;
  timestamp: number;
  blockNumber: number;
  liquidity: PoolLiquidity;
  health: PoolHealthMetrics;
  currentPrice: Decimal;
  priceHistory: PriceHistoryPoint[];
}

export interface PriceHistoryPoint {
  timestamp: number;
  price: Decimal;
  volume: Decimal;
  blockNumber: number;
}

// ========================================
// ORACLE PRICE DATA TYPES
// ========================================

export interface OraclePrice {
  tokenMint: string;
  price: Decimal;
  confidence: Decimal; // Price confidence interval
  timestamp: number;
  source: 'pyth' | 'switchboard' | 'chainlink';
  exponent: number;
  status: 'active' | 'inactive' | 'stale';
  publishSlot: number;
}

export interface OracleValidation {
  isValid: boolean;
  confidence: number; // 0-1
  priceDeviation: Decimal; // Difference from oracle price
  staleness: number; // Seconds since last update
  reason?: string; // Why validation failed
}

export interface MultiOraclePrice {
  tokenMint: string;
  prices: OraclePrice[];
  consensus: {
    price: Decimal;
    confidence: number;
    agreement: number; // How well oracles agree (0-1)
  };
  timestamp: number;
}

// ========================================
// LIQUIDITY MONITORING TYPES
// ========================================

export interface LiquidityAlert {
  type: 'low_liquidity' | 'high_impact' | 'pool_drain' | 'anomaly';
  poolAddress: string;
  dex: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  data: {
    currentLiquidity: Decimal;
    thresholdLiquidity: Decimal;
    change: Decimal; // Percentage change
    duration: number; // How long this condition has existed
  };
  timestamp: number;
}

export interface LiquidityTrend {
  poolAddress: string;
  timeframe: '1m' | '5m' | '15m' | '1h' | '24h';
  trend: 'increasing' | 'decreasing' | 'stable' | 'volatile';
  changePercent: number;
  confidence: number; // Statistical confidence in trend
  dataPoints: LiquidityDataPoint[];
}

export interface LiquidityDataPoint {
  timestamp: number;
  liquidity: Decimal;
  volume: Decimal;
  utilization: number;
}

// ========================================
// MONITORING CONFIGURATION TYPES
// ========================================

export interface PoolMonitorConfig {
  updateInterval: number; // milliseconds
  healthCheckInterval: number;
  liquidityThresholds: {
    minimum: Decimal;
    warning: Decimal;
    critical: Decimal;
  };
  volatilityThreshold: number;
  maxPriceAge: number; // milliseconds
}

export interface OracleConfig {
  pythProgramId: string;
  switchboardProgramId: string;
  maxPriceAge: number;
  confidenceThreshold: number;
  deviationThreshold: number; // Max % deviation from oracle
  updateInterval: number;
}

export interface MonitoringConfig {
  pool: PoolMonitorConfig;
  oracle: OracleConfig;
  alerting: {
    enabled: boolean;
    webhookUrl?: string;
    emailAlerts?: boolean;
    slackWebhook?: string;
  };
  performance: {
    maxCacheSize: number;
    cacheTimeout: number;
    batchSize: number;
  };
}

// ========================================
// EVENT TYPES FOR MONITORING
// ========================================

export interface MonitoringEvent {
  type: 'pool_update' | 'oracle_update' | 'liquidity_alert' | 'health_change';
  timestamp: number;
  data: any;
  source: string;
}

export interface PoolUpdateEvent extends MonitoringEvent {
  type: 'pool_update';
  data: {
    poolAddress: string;
    oldState: PoolStateSnapshot;
    newState: PoolStateSnapshot;
    changes: string[];
  };
}

export interface OracleUpdateEvent extends MonitoringEvent {
  type: 'oracle_update';
  data: {
    tokenMint: string;
    oldPrice: OraclePrice;
    newPrice: OraclePrice;
    validation: OracleValidation;
  };
}

export interface LiquidityAlertEvent extends MonitoringEvent {
  type: 'liquidity_alert';
  data: LiquidityAlert;
}

// ========================================
// MONITORING INTERFACE CONTRACTS
// ========================================

export interface IPoolStateMonitor {
  subscribeToPool(poolAddress: string, dex: string): Promise<void>;
  unsubscribeFromPool(poolAddress: string): Promise<void>;
  getPoolState(poolAddress: string): Promise<PoolStateSnapshot | null>;
  getPoolHealth(poolAddress: string): Promise<PoolHealthMetrics | null>;
  getAllMonitoredPools(): string[];
  startMonitoring(): Promise<void>;
  stopMonitoring(): Promise<void>;
}

export interface IPriceOracleClient {
  connectToPyth(): Promise<void>;
  connectToSwitchboard(): Promise<void>;
  getOraclePrice(tokenMint: string): Promise<OraclePrice | null>;
  getMultiOraclePrice(tokenMint: string): Promise<MultiOraclePrice | null>;
  validatePrice(price: DEXPrice, tokenMint: string): Promise<OracleValidation>;
  isConnected(): boolean;
}

export interface ILiquidityMonitor {
  monitorPoolLiquidity(poolAddress: string): Promise<void>;
  getLiquidityTrend(poolAddress: string, timeframe: string): Promise<LiquidityTrend | null>;
  checkLiquidityAlerts(): Promise<LiquidityAlert[]>;
  setLiquidityThreshold(poolAddress: string, threshold: Decimal): Promise<void>;
} 