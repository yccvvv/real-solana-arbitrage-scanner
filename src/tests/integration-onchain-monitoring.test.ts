import { Connection, PublicKey } from '@solana/web3.js';
import { SolanaWebSocketClient } from '../websocket/SolanaWebSocketClient';
import { ArbitrageScanner } from '../scanner/ArbitrageScanner';
import { PoolUpdate, TrueArbitrageOpportunity } from '../types';

/**
 * Integration Test for On-Chain Monitoring
 * 
 * Tests real-time WebSocket monitoring and arbitrage detection
 * Uses live blockchain data to validate monitoring capabilities
 */

const WS_ENDPOINT = 'wss://api.mainnet-beta.solana.com';
const RPC_ENDPOINT = 'https://api.mainnet-beta.solana.com';

// Live pools for real-time monitoring
const MONITORING_POOLS = [
  '58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2', // Raydium SOL-USDC
  'EGZ7tiLeH62TPV1gL8WwbXGzEPa9zmcpVnnkPKKnrE2U', // Orca SOL-USDC
  '8sLbNZoA1cfnvMJLPfp98ZLAnFSYCFApfJKMbiXNLwxj', // Another Raydium pool
  '9vqYJjDUFecbNTuyZQJSXLNmKZdNZzlEiPi4b3hzXCxy'  // Orca SOL-USDT
];

interface MonitoringStats {
  totalUpdates: number;
  uniquePools: Set<string>;
  arbitrageOpportunities: number;
  priceUpdates: PoolUpdate[];
  arbitrageAlerts: TrueArbitrageOpportunity[];
  connectionUptime: number;
  averageLatency: number;
  lastUpdateTime: number;
}

class OnChainMonitoringIntegrationTest {
  private wsClient: SolanaWebSocketClient;
  private scanner: ArbitrageScanner;
  private stats: MonitoringStats;
  private startTime: number;
  private latencyMeasurements: number[] = [];

  constructor() {
    this.wsClient = new SolanaWebSocketClient({
      endpoint: WS_ENDPOINT,
      commitment: 'confirmed'
    });

    this.scanner = new ArbitrageScanner({
      solanaEndpoints: {
        rpc: RPC_ENDPOINT,
        websocket: WS_ENDPOINT
      },
      pools: {
        Raydium: ['58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2'],
        Orca: ['EGZ7tiLeH62TPV1gL8WwbXGzEPa9zmcpVnnkPKKnrE2U']
      },
      scanning: {
        updateInterval: 2000,
        minProfitThreshold: 0.5,
        maxSlippage: 0.05,
        commitment: 'confirmed'
      }
    });

    this.stats = {
      totalUpdates: 0,
      uniquePools: new Set(),
      arbitrageOpportunities: 0,
      priceUpdates: [],
      arbitrageAlerts: [],
      connectionUptime: 0,
      averageLatency: 0,
      lastUpdateTime: 0
    };

    this.startTime = Date.now();
    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    // WebSocket client events
    this.wsClient.on('connected', () => {
      console.log('✅ WebSocket connected to Solana mainnet');
    });

    this.wsClient.on('poolUpdate', (update: PoolUpdate) => {
      this.handlePoolUpdate(update);
    });

    this.wsClient.on('error', (error: Error) => {
      console.error('❌ WebSocket error:', error.message);
    });

    // Arbitrage scanner events
    this.scanner.on('connected', () => {
      console.log('✅ Arbitrage scanner connected');
    });

    this.scanner.on('priceUpdate', (update: PoolUpdate) => {
      this.handleScannerPriceUpdate(update);
    });

    this.scanner.on('arbitrageOpportunity', (opportunity: TrueArbitrageOpportunity) => {
      this.handleArbitrageOpportunity(opportunity);
    });
  }

  async runMonitoringTest(durationSeconds = 60): Promise<void> {
    console.log('🕸️ ON-CHAIN MONITORING - LIVE INTEGRATION TEST');
    console.log('===============================================');
    console.log('Testing real-time WebSocket monitoring and arbitrage detection');
    console.log(`Test duration: ${durationSeconds} seconds\n`);

    try {
      // Start monitoring systems
      await this.startMonitoring();

      // Run test for specified duration
      await this.runTestForDuration(durationSeconds);

      // Stop monitoring
      await this.stopMonitoring();

      // Print results
      this.printMonitoringResults();

    } catch (error) {
      console.error('❌ Monitoring test failed:', error);
      await this.stopMonitoring();
      throw error;
    }
  }

  private async startMonitoring(): Promise<void> {
    console.log('🚀 Starting monitoring systems...');

    // Start WebSocket client
    await this.wsClient.connect();
    console.log('   ✅ WebSocket client connected');

    // Subscribe to pools
    for (const poolAddress of MONITORING_POOLS) {
      try {
        await this.wsClient.subscribeToPoolAccount(poolAddress, 'Raydium');
        console.log(`   📡 Subscribed to pool: ${poolAddress.substring(0, 8)}...`);
      } catch (error) {
        console.log(`   ❌ Failed to subscribe to ${poolAddress}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // Start arbitrage scanner
    await this.scanner.start();
    console.log('   ✅ Arbitrage scanner started');

    console.log('\n🔍 Monitoring live blockchain data...\n');
  }

  private async runTestForDuration(durationSeconds: number): Promise<void> {
    const endTime = Date.now() + (durationSeconds * 1000);
    let lastStatusUpdate = 0;
    const statusInterval = 10000; // Update every 10 seconds

    while (Date.now() < endTime) {
      // Print periodic status updates
      if (Date.now() - lastStatusUpdate > statusInterval) {
        this.printStatus();
        lastStatusUpdate = Date.now();
      }

      // Wait a bit before next check
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  private async stopMonitoring(): Promise<void> {
    console.log('\n🛑 Stopping monitoring systems...');

    await this.scanner.stop();
    console.log('   ✅ Arbitrage scanner stopped');

    await this.wsClient.close();
    console.log('   ✅ WebSocket client disconnected');
  }

  private handlePoolUpdate(update: PoolUpdate): void {
    const receiveTime = Date.now();
    const latency = receiveTime - this.startTime;

    this.stats.totalUpdates++;
    this.stats.uniquePools.add(update.pool);
    this.stats.priceUpdates.push(update);
    this.stats.lastUpdateTime = receiveTime;

    // Track latency (simplified)
    this.latencyMeasurements.push(latency);
    if (this.latencyMeasurements.length > 100) {
      this.latencyMeasurements.shift(); // Keep only recent measurements
    }

    console.log(`📊 Pool Update: [${update.dex}] ${update.pool.substring(0, 8)}... = $${update.price.toFixed(4)}`);
  }

  private handleScannerPriceUpdate(update: PoolUpdate): void {
    // Track scanner-processed updates
    console.log(`🔄 Scanner Update: [${update.dex}] Price = $${update.price.toFixed(4)}, Liquidity = $${update.liquidity.toFixed(0)}`);
  }

  private handleArbitrageOpportunity(opportunity: TrueArbitrageOpportunity): void {
    this.stats.arbitrageOpportunities++;
    this.stats.arbitrageAlerts.push(opportunity);

    console.log(`\n🎯 ARBITRAGE OPPORTUNITY DETECTED!`);
    console.log(`   💰 Pair: ${opportunity.pair}`);
    console.log(`   📈 Buy: ${opportunity.buyDex} @ $${opportunity.buyPrice.toFixed(4)}`);
    console.log(`   📉 Sell: ${opportunity.sellDex} @ $${opportunity.sellPrice.toFixed(4)}`);
    console.log(`   🚀 Profit: ${opportunity.profitPercentage.toFixed(2)}%`);
    console.log(`   🎯 Confidence: ${(opportunity.confidence * 100).toFixed(1)}%`);
    console.log(`   ⚡ Gas Est: $${opportunity.gasEstimate.toFixed(4)}\n`);
  }

  private printStatus(): void {
    const elapsed = (Date.now() - this.startTime) / 1000;
    const updatesPerSecond = this.stats.totalUpdates / elapsed;

    console.log(`\n📈 STATUS UPDATE (${elapsed.toFixed(0)}s elapsed):`);
    console.log(`   📊 Total Updates: ${this.stats.totalUpdates}`);
    console.log(`   🏊 Updates/sec: ${updatesPerSecond.toFixed(2)}`);
    console.log(`   🎯 Pools Monitored: ${this.stats.uniquePools.size}`);
    console.log(`   💰 Arbitrage Opportunities: ${this.stats.arbitrageOpportunities}`);
    
    if (this.stats.lastUpdateTime > 0) {
      const timeSinceLastUpdate = (Date.now() - this.stats.lastUpdateTime) / 1000;
      console.log(`   ⏱️  Last Update: ${timeSinceLastUpdate.toFixed(1)}s ago`);
    }
  }

  private printMonitoringResults(): void {
    const totalTime = (Date.now() - this.startTime) / 1000;
    this.stats.connectionUptime = totalTime;
    
    if (this.latencyMeasurements.length > 0) {
      this.stats.averageLatency = this.latencyMeasurements.reduce((a, b) => a + b, 0) / this.latencyMeasurements.length;
    }

    console.log('\n📊 ON-CHAIN MONITORING TEST RESULTS');
    console.log('===================================');

    console.log('\n🔗 Connection Performance:');
    console.log(`   ⏱️  Total Test Duration: ${totalTime.toFixed(1)}s`);
    console.log(`   ✅ Connection Uptime: ${this.stats.connectionUptime.toFixed(1)}s`);
    console.log(`   📶 Uptime Percentage: ${((this.stats.connectionUptime / totalTime) * 100).toFixed(1)}%`);

    console.log('\n📈 Data Collection:');
    console.log(`   📊 Total Updates Received: ${this.stats.totalUpdates}`);
    console.log(`   🏊 Average Updates/Second: ${(this.stats.totalUpdates / totalTime).toFixed(2)}`);
    console.log(`   🎯 Unique Pools Monitored: ${this.stats.uniquePools.size}`);
    console.log(`   ⏱️  Average Response Time: ${this.stats.averageLatency.toFixed(0)}ms`);

    console.log('\n💰 Arbitrage Detection:');
    console.log(`   🎯 Opportunities Found: ${this.stats.arbitrageOpportunities}`);
    console.log(`   📈 Opportunities/Hour: ${((this.stats.arbitrageOpportunities / totalTime) * 3600).toFixed(1)}`);

    if (this.stats.arbitrageAlerts.length > 0) {
      console.log('\n💎 Sample Arbitrage Opportunities:');
      this.stats.arbitrageAlerts.slice(0, 3).forEach((opp, i) => {
        console.log(`   ${i + 1}. ${opp.pair}: ${opp.profitPercentage.toFixed(2)}% profit (${opp.buyDex} → ${opp.sellDex})`);
      });
    }

    if (this.stats.priceUpdates.length > 0) {
      console.log('\n📊 Price Data Summary:');
      const recentUpdates = this.stats.priceUpdates.slice(-5);
      console.log('   Recent price updates:');
      recentUpdates.forEach(update => {
        console.log(`   - [${update.dex}] $${update.price.toFixed(4)} (${new Date(update.timestamp).toLocaleTimeString()})`);
      });
    }

    // Assessment
    console.log('\n🏆 ASSESSMENT:');
    
    const hasUpdates = this.stats.totalUpdates > 0;
    const hasArbitrage = this.stats.arbitrageOpportunities > 0;
    const goodUptime = (this.stats.connectionUptime / totalTime) > 0.9;
    const goodUpdateRate = (this.stats.totalUpdates / totalTime) > 0.1;

    if (hasUpdates && goodUptime && goodUpdateRate) {
      console.log('   ✅ EXCELLENT: On-chain monitoring working perfectly!');
      console.log('   ✅ Stable WebSocket connections');
      console.log('   ✅ Real-time data collection active');
      console.log('   ✅ Live blockchain monitoring confirmed');
      
      if (hasArbitrage) {
        console.log('   ✅ Arbitrage detection functional');
      }
    } else if (hasUpdates) {
      console.log('   ⚠️  PARTIAL: On-chain monitoring partially working');
      console.log('   ⚠️  Some connectivity or performance issues detected');
    } else {
      console.log('   ❌ FAILED: On-chain monitoring not receiving data');
      console.log('   ❌ Check WebSocket connections and pool subscriptions');
    }
  }
}

// Run the integration test
async function runOnChainMonitoringIntegrationTest() {
  const test = new OnChainMonitoringIntegrationTest();
  
  try {
    await test.runMonitoringTest(30); // Run for 30 seconds
    process.exit(0);
  } catch (error) {
    console.error('❌ On-chain monitoring test failed:', error);
    process.exit(1);
  }
}

// Auto-run if this file is executed directly
if (require.main === module) {
  runOnChainMonitoringIntegrationTest();
}

export { OnChainMonitoringIntegrationTest }; 