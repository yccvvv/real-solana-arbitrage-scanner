import { EventEmitter } from 'events';
import Decimal from 'decimal.js';
import {
  ILiquidityMonitor,
  LiquidityAlert,
  LiquidityTrend,
  LiquidityDataPoint,
  LiquidityAlertEvent,
  PoolLiquidity,
  PoolStateSnapshot
} from './types';

/**
 * LiquidityMonitor - Advanced liquidity tracking and alerting
 * 
 * Provides comprehensive liquidity monitoring including:
 * - Real-time liquidity depth tracking
 * - Trend analysis and forecasting
 * - Automated alerting for significant changes
 * - Impact analysis for large trades
 * - Historical liquidity patterns
 */
export class LiquidityMonitor extends EventEmitter implements ILiquidityMonitor {
  private liquidityHistory = new Map<string, LiquidityDataPoint[]>();
  private liquidityThresholds = new Map<string, Decimal>();
  private activeAlerts = new Map<string, LiquidityAlert[]>();
  private isMonitoring = false;
  private monitoringInterval?: NodeJS.Timeout;
  private readonly historyLimit = 2000; // Keep 2000 data points per pool
  private readonly trendAnalysisWindow = 100; // Use last 100 points for trend analysis

  constructor() {
    super();
  }

  /**
   * Start monitoring pool liquidity
   */
  async monitorPoolLiquidity(poolAddress: string): Promise<void> {
    try {
      console.log(`📊 Starting liquidity monitoring for pool ${poolAddress.substring(0, 8)}...`);

      // Initialize history if not exists
      if (!this.liquidityHistory.has(poolAddress)) {
        this.liquidityHistory.set(poolAddress, []);
      }

      // Set default threshold if not exists
      if (!this.liquidityThresholds.has(poolAddress)) {
        this.liquidityThresholds.set(poolAddress, new Decimal(100000)); // $100k default
      }

      console.log(`✅ Liquidity monitoring started for pool ${poolAddress.substring(0, 8)}...`);
      this.emit('liquidityMonitoringStarted', { poolAddress });

    } catch (error) {
      console.error(`❌ Failed to start liquidity monitoring for ${poolAddress}:`, error);
      throw error;
    }
  }

  /**
   * Update liquidity data for a pool
   */
  updateLiquidityData(poolAddress: string, liquidity: PoolLiquidity): void {
    try {
      const dataPoint: LiquidityDataPoint = {
        timestamp: Date.now(),
        liquidity: liquidity.totalLiquidity,
        volume: new Decimal(0), // Will be updated with actual volume data
        utilization: this.calculateLiquidityUtilization(liquidity)
      };

      // Add to history
      const history = this.liquidityHistory.get(poolAddress) || [];
      history.push(dataPoint);

      // Maintain history limit
      if (history.length > this.historyLimit) {
        history.splice(0, history.length - this.historyLimit);
      }

      this.liquidityHistory.set(poolAddress, history);

      // Check for alerts
      this.checkLiquidityAlertsForPool(poolAddress, dataPoint);

      // Emit update event
      this.emit('liquidityUpdated', { poolAddress, dataPoint });

    } catch (error) {
      console.error(`❌ Error updating liquidity data for ${poolAddress}:`, error);
    }
  }

  /**
   * Get liquidity trend analysis for a pool
   */
  async getLiquidityTrend(poolAddress: string, timeframe: string): Promise<LiquidityTrend | null> {
    try {
      const history = this.liquidityHistory.get(poolAddress);
      if (!history || history.length < 10) {
        console.log(`⚠️ Insufficient data for trend analysis: ${poolAddress.substring(0, 8)}...`);
        return null;
      }

      // Filter data based on timeframe
      const filteredData = this.filterDataByTimeframe(history, timeframe);
      if (filteredData.length < 5) {
        return null;
      }

      // Calculate trend
      const trend = this.calculateTrend(filteredData);
      const changePercent = this.calculateChangePercent(filteredData);
      const confidence = this.calculateTrendConfidence(filteredData);

      return {
        poolAddress,
        timeframe: timeframe as any,
        trend,
        changePercent,
        confidence,
        dataPoints: filteredData
      };

    } catch (error) {
      console.error(`❌ Error getting liquidity trend for ${poolAddress}:`, error);
      return null;
    }
  }

  /**
   * Check for liquidity alerts across all monitored pools
   */
  async checkLiquidityAlerts(): Promise<LiquidityAlert[]> {
    const allAlerts: LiquidityAlert[] = [];

    for (const [poolAddress, history] of this.liquidityHistory) {
      if (history.length === 0) continue;

      const latestData = history[history.length - 1];
      const poolAlerts = await this.generateAlertsForPool(poolAddress, latestData, history);
      allAlerts.push(...poolAlerts);
    }

    return allAlerts;
  }

  /**
   * Set liquidity threshold for a specific pool
   */
  async setLiquidityThreshold(poolAddress: string, threshold: Decimal): Promise<void> {
    this.liquidityThresholds.set(poolAddress, threshold);
    console.log(`📊 Set liquidity threshold for ${poolAddress.substring(0, 8)}...: $${threshold.toFixed(0)}`);
    this.emit('thresholdUpdated', { poolAddress, threshold });
  }

  /**
   * Calculate liquidity utilization rate
   */
  private calculateLiquidityUtilization(liquidity: PoolLiquidity): number {
    // Calculate utilization based on reserve balance
    const tokenAValue = liquidity.tokenA.reserve.mul(85); // Assume SOL = $85
    const tokenBValue = liquidity.tokenB.reserve; // Assume USDC = $1
    const totalValue = tokenAValue.add(tokenBValue);
    
    // Utilization is based on how balanced the pool is
    const imbalance = tokenAValue.sub(tokenBValue).abs().div(totalValue);
    return Math.max(0, 1 - imbalance.toNumber());
  }

  /**
   * Filter data points by timeframe
   */
  private filterDataByTimeframe(history: LiquidityDataPoint[], timeframe: string): LiquidityDataPoint[] {
    const now = Date.now();
    let cutoffTime: number;

    switch (timeframe) {
      case '1m': cutoffTime = now - 60 * 1000; break;
      case '5m': cutoffTime = now - 5 * 60 * 1000; break;
      case '15m': cutoffTime = now - 15 * 60 * 1000; break;
      case '1h': cutoffTime = now - 60 * 60 * 1000; break;
      case '24h': cutoffTime = now - 24 * 60 * 60 * 1000; break;
      default: return history.slice(-this.trendAnalysisWindow);
    }

    return history.filter(point => point.timestamp >= cutoffTime);
  }

  /**
   * Calculate trend direction
   */
  private calculateTrend(data: LiquidityDataPoint[]): LiquidityTrend['trend'] {
    if (data.length < 3) return 'stable';

    // Calculate linear regression slope
    const n = data.length;
    const sumX = data.reduce((sum, _, i) => sum + i, 0);
    const sumY = data.reduce((sum, point) => sum + point.liquidity.toNumber(), 0);
    const sumXY = data.reduce((sum, point, i) => sum + i * point.liquidity.toNumber(), 0);
    const sumX2 = data.reduce((sum, _, i) => sum + i * i, 0);

    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    
    // Calculate volatility
    const avgLiquidity = sumY / n;
    const variance = data.reduce((sum, point) => {
      const diff = point.liquidity.toNumber() - avgLiquidity;
      return sum + diff * diff;
    }, 0) / n;
    const stdDev = Math.sqrt(variance);
    const volatility = stdDev / avgLiquidity;

    // Determine trend based on slope and volatility
    if (volatility > 0.1) return 'volatile'; // High volatility threshold
    if (Math.abs(slope) < avgLiquidity * 0.001) return 'stable'; // Low change threshold
    return slope > 0 ? 'increasing' : 'decreasing';
  }

  /**
   * Calculate percentage change over the timeframe
   */
  private calculateChangePercent(data: LiquidityDataPoint[]): number {
    if (data.length < 2) return 0;

    const first = data[0].liquidity;
    const last = data[data.length - 1].liquidity;
    
    return last.sub(first).div(first).mul(100).toNumber();
  }

  /**
   * Calculate confidence in trend analysis
   */
  private calculateTrendConfidence(data: LiquidityDataPoint[]): number {
    if (data.length < 5) return 0.3; // Low confidence with few data points

    // Calculate R-squared for linear regression
    const n = data.length;
    const sumY = data.reduce((sum, point) => sum + point.liquidity.toNumber(), 0);
    const avgY = sumY / n;

    // Calculate total sum of squares
    const totalSS = data.reduce((sum, point) => {
      const diff = point.liquidity.toNumber() - avgY;
      return sum + diff * diff;
    }, 0);

    // Calculate residual sum of squares (simplified)
    let residualSS = 0;
    for (let i = 1; i < data.length; i++) {
      const expected = data[i - 1].liquidity.toNumber(); // Simplified prediction
      const actual = data[i].liquidity.toNumber();
      residualSS += (actual - expected) * (actual - expected);
    }

    const rSquared = Math.max(0, 1 - residualSS / totalSS);
    
    // Adjust confidence based on data points
    const dataPointsFactor = Math.min(1, n / 50); // Higher confidence with more data
    
    return Math.min(0.95, rSquared * dataPointsFactor + 0.1);
  }

  /**
   * Check for liquidity alerts for a specific pool
   */
  private checkLiquidityAlertsForPool(poolAddress: string, dataPoint: LiquidityDataPoint): void {
    const threshold = this.liquidityThresholds.get(poolAddress);
    if (!threshold) return;

    const currentLiquidity = dataPoint.liquidity;
    const history = this.liquidityHistory.get(poolAddress) || [];

    // Check for low liquidity alert
    if (currentLiquidity.lt(threshold)) {
      this.createAlert(poolAddress, 'low_liquidity', 'high', 
        `Liquidity below threshold: $${currentLiquidity.toFixed(0)} < $${threshold.toFixed(0)}`,
        currentLiquidity, threshold);
    }

    // Check for rapid liquidity drain
    if (history.length >= 5) {
      const recentHistory = history.slice(-5);
      const liquidityDrop = this.calculateLiquidityDrop(recentHistory);
      
      if (liquidityDrop > 0.2) { // 20% drop in recent history
        this.createAlert(poolAddress, 'pool_drain', 'critical',
          `Rapid liquidity drain detected: ${(liquidityDrop * 100).toFixed(1)}% drop`,
          currentLiquidity, threshold, liquidityDrop);
      }
    }

    // Check for anomalous behavior
    const anomaly = this.detectLiquidityAnomaly(poolAddress, dataPoint);
    if (anomaly) {
      this.createAlert(poolAddress, 'anomaly', 'medium',
        'Unusual liquidity pattern detected',
        currentLiquidity, threshold);
    }
  }

  /**
   * Generate alerts for a pool based on current and historical data
   */
  private async generateAlertsForPool(
    poolAddress: string, 
    currentData: LiquidityDataPoint, 
    history: LiquidityDataPoint[]
  ): Promise<LiquidityAlert[]> {
    const alerts: LiquidityAlert[] = [];
    const threshold = this.liquidityThresholds.get(poolAddress);
    
    if (!threshold) return alerts;

    // High impact alert (large change in short time)
    if (history.length >= 3) {
      const recent = history.slice(-3);
      const maxChange = this.getMaxLiquidityChange(recent);
      
      if (maxChange > 0.15) { // 15% change threshold
        alerts.push({
          type: 'high_impact',
          poolAddress,
          dex: 'Unknown', // Would be provided by pool state monitor
          severity: 'high',
          message: `High impact liquidity change: ${(maxChange * 100).toFixed(1)}%`,
          data: {
            currentLiquidity: currentData.liquidity,
            thresholdLiquidity: threshold,
            change: new Decimal(maxChange * 100),
            duration: this.getChangeDuration(recent)
          },
          timestamp: Date.now()
        });
      }
    }

    return alerts;
  }

  /**
   * Create and emit a liquidity alert
   */
  private createAlert(
    poolAddress: string, 
    type: LiquidityAlert['type'], 
    severity: LiquidityAlert['severity'],
    message: string,
    currentLiquidity: Decimal,
    threshold: Decimal,
    changePercent?: number
  ): void {
    const alert: LiquidityAlert = {
      type,
      poolAddress,
      dex: 'Unknown', // Would be provided by integration
      severity,
      message,
      data: {
        currentLiquidity,
        thresholdLiquidity: threshold,
        change: new Decimal(changePercent || 0),
        duration: 0 // Would calculate based on alert history
      },
      timestamp: Date.now()
    };

    // Store alert
    const poolAlerts = this.activeAlerts.get(poolAddress) || [];
    poolAlerts.push(alert);
    this.activeAlerts.set(poolAddress, poolAlerts);

    // Emit alert event
    const alertEvent: LiquidityAlertEvent = {
      type: 'liquidity_alert',
      timestamp: Date.now(),
      source: 'liquidity_monitor',
      data: alert
    };

    console.log(`🚨 Liquidity Alert [${severity.toUpperCase()}]: ${message}`);
    this.emit('liquidityAlert', alertEvent);
  }

  /**
   * Calculate liquidity drop percentage over recent history
   */
  private calculateLiquidityDrop(history: LiquidityDataPoint[]): number {
    if (history.length < 2) return 0;

    const first = history[0].liquidity;
    const last = history[history.length - 1].liquidity;
    
    if (last.gte(first)) return 0; // No drop
    
    return first.sub(last).div(first).toNumber();
  }

  /**
   * Detect liquidity anomalies using statistical analysis
   */
  private detectLiquidityAnomaly(poolAddress: string, dataPoint: LiquidityDataPoint): boolean {
    const history = this.liquidityHistory.get(poolAddress) || [];
    if (history.length < 20) return false; // Need sufficient history

    // Calculate recent average and standard deviation
    const recentHistory = history.slice(-20);
    const values = recentHistory.map(p => p.liquidity.toNumber());
    const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
    const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
    const stdDev = Math.sqrt(variance);

    // Check if current value is more than 2 standard deviations from mean
    const currentValue = dataPoint.liquidity.toNumber();
    const zScore = Math.abs(currentValue - mean) / stdDev;
    
    return zScore > 2; // Anomaly threshold
  }

  /**
   * Get maximum liquidity change in a set of data points
   */
  private getMaxLiquidityChange(data: LiquidityDataPoint[]): number {
    if (data.length < 2) return 0;

    let maxChange = 0;
    for (let i = 1; i < data.length; i++) {
      const prev = data[i - 1].liquidity;
      const curr = data[i].liquidity;
      const change = curr.sub(prev).div(prev).abs().toNumber();
      maxChange = Math.max(maxChange, change);
    }

    return maxChange;
  }

  /**
   * Get duration of change in milliseconds
   */
  private getChangeDuration(data: LiquidityDataPoint[]): number {
    if (data.length < 2) return 0;
    return data[data.length - 1].timestamp - data[0].timestamp;
  }

  /**
   * Start automated monitoring service
   */
  startMonitoring(intervalMs: number = 30000): void {
    if (this.isMonitoring) {
      console.log('⚠️ Liquidity monitoring is already running');
      return;
    }

    console.log('🚀 Starting automated liquidity monitoring...');
    this.isMonitoring = true;

    this.monitoringInterval = setInterval(async () => {
      try {
        const alerts = await this.checkLiquidityAlerts();
        if (alerts.length > 0) {
          console.log(`📊 Found ${alerts.length} liquidity alerts`);
        }
      } catch (error) {
        console.error('❌ Error in automated liquidity monitoring:', error);
      }
    }, intervalMs);

    console.log('✅ Automated liquidity monitoring started');
    this.emit('monitoringStarted');
  }

  /**
   * Stop automated monitoring service
   */
  stopMonitoring(): void {
    if (!this.isMonitoring) {
      console.log('⚠️ Liquidity monitoring is not running');
      return;
    }

    console.log('🛑 Stopping automated liquidity monitoring...');
    this.isMonitoring = false;

    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = undefined;
    }

    console.log('✅ Automated liquidity monitoring stopped');
    this.emit('monitoringStopped');
  }

  /**
   * Get monitoring statistics
   */
  getMonitoringStats(): {
    monitoredPools: number;
    totalDataPoints: number;
    activeAlerts: number;
    isMonitoring: boolean;
  } {
    let totalDataPoints = 0;
    let activeAlerts = 0;

    for (const history of this.liquidityHistory.values()) {
      totalDataPoints += history.length;
    }

    for (const alerts of this.activeAlerts.values()) {
      activeAlerts += alerts.length;
    }

    return {
      monitoredPools: this.liquidityHistory.size,
      totalDataPoints,
      activeAlerts,
      isMonitoring: this.isMonitoring
    };
  }

  /**
   * Clear old data and alerts
   */
  cleanup(): void {
    const cutoffTime = Date.now() - 24 * 60 * 60 * 1000; // 24 hours

    // Clean old history
    for (const [poolAddress, history] of this.liquidityHistory) {
      const filtered = history.filter(point => point.timestamp > cutoffTime);
      this.liquidityHistory.set(poolAddress, filtered);
    }

    // Clean old alerts
    for (const [poolAddress, alerts] of this.activeAlerts) {
      const filtered = alerts.filter(alert => alert.timestamp > cutoffTime);
      this.activeAlerts.set(poolAddress, filtered);
    }

    console.log('🧹 Cleaned up old liquidity monitoring data');
  }
} 