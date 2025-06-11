import { DirectDEXClientsIntegrationTest } from './src/tests/integration-dex-clients.test';
import { PriceAggregatorsIntegrationTest } from './src/tests/integration-price-aggregators.test';
import { OnChainMonitoringIntegrationTest } from './src/tests/integration-onchain-monitoring.test';

/**
 * Master Integration Test Runner
 * 
 * Executes all three core integration tests:
 * 1. Direct DEX Clients - Tests DEX pool parsing with real data
 * 2. Price Aggregators - Tests price aggregation across DEXs and oracles
 * 3. On-Chain Monitoring - Tests real-time WebSocket monitoring
 * 
 * No mock data - all tests use live Solana mainnet blockchain data
 */

interface TestSuite {
  name: string;
  description: string;
  testFunction: () => Promise<void>;
  enabled: boolean;
}

class IntegrationTestRunner {
  private testSuites: TestSuite[] = [
    {
      name: 'Direct DEX Clients',
      description: 'Tests real parsing of DEX pool data from live blockchain',
      testFunction: this.runDEXClientsTest.bind(this),
      enabled: true
    },
    {
      name: 'Price Aggregators',
      description: 'Tests price aggregation across multiple DEXs and oracles',
      testFunction: this.runPriceAggregatorsTest.bind(this),
      enabled: true
    },
    {
      name: 'On-Chain Monitoring',
      description: 'Tests real-time WebSocket monitoring and arbitrage detection',
      testFunction: this.runOnChainMonitoringTest.bind(this),
      enabled: true
    }
  ];

  async runAllTests(): Promise<void> {
    console.log('🚀 REAL SOLANA ARBITRAGE SCANNER - INTEGRATION TESTS');
    console.log('====================================================');
    console.log('Testing ALL components with live blockchain data');
    console.log('No mock data - connecting to Solana mainnet\n');

    const results: { name: string; success: boolean; error?: string; duration: number }[] = [];

    for (const suite of this.testSuites) {
      if (!suite.enabled) {
        console.log(`⏭️  Skipping ${suite.name} (disabled)\n`);
        continue;
      }

      console.log(`🧪 STARTING: ${suite.name}`);
      console.log(`📋 ${suite.description}`);
      console.log('=' + '='.repeat(suite.name.length + 10));

      const startTime = Date.now();
      let success = false;
      let error: string | undefined;

      try {
        await suite.testFunction();
        success = true;
        console.log(`✅ ${suite.name} - PASSED\n`);
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
        console.log(`❌ ${suite.name} - FAILED: ${error}\n`);
      }

      const duration = Date.now() - startTime;
      results.push({ name: suite.name, success, error, duration });

      // Add a pause between tests
      if (suite !== this.testSuites[this.testSuites.length - 1]) {
        console.log('⏸️  Pausing 5 seconds between tests...\n');
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }

    this.printFinalResults(results);
  }

  private async runDEXClientsTest(): Promise<void> {
    const test = new DirectDEXClientsIntegrationTest();
    await test.runAllTests();
  }

  private async runPriceAggregatorsTest(): Promise<void> {
    const test = new PriceAggregatorsIntegrationTest();
    await test.runAllTests();
  }

  private async runOnChainMonitoringTest(): Promise<void> {
    const test = new OnChainMonitoringIntegrationTest();
    await test.runMonitoringTest(45); // Run for 45 seconds
  }

  private printFinalResults(results: { name: string; success: boolean; error?: string; duration: number }[]): void {
    console.log('\n🏆 FINAL INTEGRATION TEST RESULTS');
    console.log('=================================');

    const passed = results.filter(r => r.success).length;
    const total = results.length;
    const passRate = (passed / total * 100).toFixed(1);

    console.log(`\n📊 Overall Results: ${passed}/${total} tests passed (${passRate}%)`);
    console.log('\n📋 Test Summary:');

    results.forEach((result, index) => {
      const status = result.success ? '✅ PASS' : '❌ FAIL';
      const duration = (result.duration / 1000).toFixed(1);
      console.log(`   ${index + 1}. ${result.name}: ${status} (${duration}s)`);
      
      if (result.error) {
        console.log(`      Error: ${result.error.substring(0, 100)}...`);
      }
    });

    const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);
    console.log(`\n⏱️  Total Test Duration: ${(totalDuration / 1000).toFixed(1)} seconds`);

    console.log('\n🎯 COMPONENT STATUS:');
    
    results.forEach(result => {
      if (result.success) {
        console.log(`   ✅ ${result.name}: WORKING with real blockchain data`);
      } else {
        console.log(`   ❌ ${result.name}: NEEDS ATTENTION`);
      }
    });

    console.log('\n🏆 FINAL ASSESSMENT:');
    
    if (passed === total) {
      console.log('   🎉 OUTSTANDING! All components working with live blockchain data');
      console.log('   ✅ Direct DEX clients parsing real pools');
      console.log('   ✅ Price aggregators cross-referencing DEXs and oracles');
      console.log('   ✅ On-chain monitoring receiving real-time updates');
      console.log('   🚀 READY FOR PRODUCTION ARBITRAGE SCANNING!');
    } else if (passed >= total * 0.67) {
      console.log('   👍 GOOD! Most components working, minor issues to resolve');
      console.log('   ⚠️  Address failing components before production use');
    } else {
      console.log('   ⚠️  NEEDS WORK: Multiple components require attention');
      console.log('   🔧 Review errors and fix integration issues');
      console.log('   📋 Check network connectivity and API endpoints');
    }

    console.log('\n' + '='.repeat(50));
    console.log('Integration tests completed - no mock data used');
    console.log('All tests connected to live Solana mainnet blockchain');
    console.log('='.repeat(50));
  }
}

// Run the master integration test
async function runMasterIntegrationTests() {
  const runner = new IntegrationTestRunner();
  
  try {
    await runner.runAllTests();
    process.exit(0);
  } catch (error) {
    console.error('❌ Master integration test failed:', error);
    process.exit(1);
  }
}

// Auto-run if this file is executed directly
if (require.main === module) {
  runMasterIntegrationTests();
}

export { IntegrationTestRunner }; 