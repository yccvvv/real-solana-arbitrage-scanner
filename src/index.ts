import { ArbitrageScanner } from './scanner/ArbitrageScanner';
import { ScannerConfig } from './config';

/**
 * Real Solana Arbitrage Scanner
 * 
 * Production-ready arbitrage scanner with real WebSocket connections
 * to Solana mainnet. No simulations - only real data.
 */

export { ArbitrageScanner };
export { SolanaWebSocketClient } from './websocket/SolanaWebSocketClient';
export { DEFAULT_CONFIG } from './config';
export * from './types';

/**
 * Create and start a new arbitrage scanner
 */
export async function createArbitrageScanner(config?: Partial<ScannerConfig>): Promise<ArbitrageScanner> {
  const scanner = new ArbitrageScanner(config);
  
  // Set up event listeners for logging
  scanner.on('connected', () => {
    console.log('🎯 Arbitrage scanner connected and ready');
  });

  scanner.on('arbitrageOpportunity', (opportunity) => {
    console.log(`💰 ARBITRAGE FOUND: ${opportunity.pair}`);
    console.log(`   Buy: ${opportunity.buyDex} @ ${opportunity.buyPrice.toFixed(8)}`);
    console.log(`   Sell: ${opportunity.sellDex} @ ${opportunity.sellPrice.toFixed(8)}`);
    console.log(`   Profit: ${opportunity.profitPercentage.toFixed(4)}%`);
    console.log(`   Net Profit: $${opportunity.netProfit.toFixed(2)}`);
    console.log(`   Confidence: ${(opportunity.confidence * 100).toFixed(1)}%`);
  });

  scanner.on('error', (error) => {
    console.error('❌ Scanner error:', error.message);
  });

  return scanner;
}

/**
 * Main function to run the scanner
 */
async function main(): Promise<void> {
  console.log('🚀 Starting Real Solana Arbitrage Scanner...');
  console.log('═'.repeat(60));

  try {
    // Create scanner with default configuration
    const scanner = await createArbitrageScanner();

    // Start scanning
    await scanner.start();

    // Keep running
    console.log('✅ Scanner running. Press Ctrl+C to stop...');
    
    // Graceful shutdown
    process.on('SIGINT', async () => {
      console.log('\n🛑 Shutting down scanner...');
      await scanner.stop();
      console.log('✅ Scanner stopped. Goodbye!');
      process.exit(0);
    });

    // Log status every 30 seconds
    setInterval(() => {
      const status = scanner.getStatus();
      console.log(`📊 Status: Running: ${status.isRunning}, Connected: ${status.connectionStatus}, Pools: ${status.subscribedPools}, Prices: ${status.cachedPrices}`);
    }, 30000);

  } catch (error) {
    console.error('❌ Failed to start scanner:', error);
    process.exit(1);
  }
}

// Run if this is the main module
if (require.main === module) {
  main().catch(console.error);
} 