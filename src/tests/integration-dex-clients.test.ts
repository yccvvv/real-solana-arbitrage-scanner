import { Connection, PublicKey } from '@solana/web3.js';
import { PoolParserFactory } from '../monitoring/parsers/PoolParserFactory';
import { RaydiumPoolParser } from '../monitoring/parsers/RaydiumPoolParser';
import { OrcaPoolParser } from '../monitoring/parsers/OrcaPoolParser';
import { PhoenixPoolParser } from '../monitoring/parsers/PhoenixPoolParser';
import { MeteoraPoolParser } from '../monitoring/parsers/MeteoraPoolParser';

/**
 * Integration Test for Direct DEX Clients
 * 
 * Tests actual DEX pool parsing with real blockchain data
 * No mock data - connects to Solana mainnet
 */

const connection = new Connection('https://api.mainnet-beta.solana.com', 'confirmed');

// Real pool addresses for each DEX
const LIVE_POOLS = {
  Raydium: [
    '58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2', // SOL-USDC
    '8sLbNZoA1cfnvMJLPfp98ZLAnFSYCFApfJKMbiXNLwxj'  // Another SOL-USDC
  ],
  Orca: [
    'EGZ7tiLeH62TPV1gL8WwbXGzEPa9zmcpVnnkPKKnrE2U', // SOL-USDC Whirlpool
    '9vqYJjDUFecbNTuyZQJSXLNmKZdNZzlEiPi4b3hzXCxy'  // SOL-USDT Whirlpool
  ],
  Phoenix: [
    '4DoNfFBfF7UokCC2FQzriy7yHK6DY6NVdYpuekQ5pRgg', // SOL-USDC Order Book
    '7Z3FjB3CgUgF8Dqe4LjRoYDJ4s8jG1HzKV2H3GF6X4a9'  // Example Phoenix market
  ],
  Meteora: [
    'C3Xkqnhp8BEBWkEVGXNmvszpPR8j2N2Q8WFr5fjhG8E8', // Dynamic pool
    '5KKfqEiUfELiHAePZMcP4Xst2iVRHBZnKPqhKjLPPSE1'  // Multi-token pool
  ]
};

interface TestResults {
  dex: string;
  poolAddress: string;
  success: boolean;
  price?: number;
  liquidity?: number;
  tokenA?: string;
  tokenB?: string;
  error?: string;
  latency: number;
}

class DirectDEXClientsIntegrationTest {
  private results: TestResults[] = [];
  private factory: PoolParserFactory;
  private raydiumParser: RaydiumPoolParser;
  private orcaParser: OrcaPoolParser;
  private phoenixParser: PhoenixPoolParser;
  private meteoraParser: MeteoraPoolParser;

  constructor() {
    this.factory = new PoolParserFactory(connection);
    this.raydiumParser = new RaydiumPoolParser(connection);
    this.orcaParser = new OrcaPoolParser(connection);
    this.phoenixParser = new PhoenixPoolParser(connection);
    this.meteoraParser = new MeteoraPoolParser(connection);
  }

  async runAllTests(): Promise<void> {
    console.log('🚀 DIRECT DEX CLIENTS - LIVE INTEGRATION TEST');
    console.log('=============================================');
    console.log('Testing with REAL blockchain data from Solana mainnet\n');

    // Test each DEX with real pools
    await this.testRaydiumClients();
    await this.testOrcaClients();
    await this.testPhoenixClients();
    await this.testMeteoraClients();

    // Print comprehensive results
    this.printResults();
  }

  private async testRaydiumClients(): Promise<void> {
    console.log('📊 Testing Raydium DEX Clients');
    console.log('==============================');

    for (const poolAddress of LIVE_POOLS.Raydium) {
      await this.testDEXPool('Raydium', poolAddress, async (poolAddr, accountInfo) => {
        return await this.raydiumParser.parsePoolData(poolAddr, accountInfo);
      });
    }
  }

  private async testOrcaClients(): Promise<void> {
    console.log('\n🐋 Testing Orca DEX Clients');
    console.log('============================');

    for (const poolAddress of LIVE_POOLS.Orca) {
      await this.testDEXPool('Orca', poolAddress, async (poolAddr, accountInfo) => {
        return await this.orcaParser.parsePoolData(poolAddr, accountInfo);
      });
    }
  }

  private async testPhoenixClients(): Promise<void> {
    console.log('\n🔥 Testing Phoenix DEX Clients');
    console.log('===============================');

    for (const poolAddress of LIVE_POOLS.Phoenix) {
      await this.testDEXPool('Phoenix', poolAddress, async (poolAddr, accountInfo) => {
        return await this.phoenixParser.parsePoolData(poolAddr, accountInfo);
      });
    }
  }

  private async testMeteoraClients(): Promise<void> {
    console.log('\n🌟 Testing Meteora DEX Clients');
    console.log('===============================');

    for (const poolAddress of LIVE_POOLS.Meteora) {
      await this.testDEXPool('Meteora', poolAddress, async (poolAddr, accountInfo) => {
        return await this.meteoraParser.parsePoolData(poolAddr, accountInfo);
      });
    }
  }

  private async testDEXPool(
    dex: string, 
    poolAddress: string, 
    parseFunction: (addr: string, info: any) => Promise<any>
  ): Promise<void> {
    const startTime = Date.now();
    const result: TestResults = {
      dex,
      poolAddress,
      success: false,
      latency: 0
    };

    try {
      console.log(`   🔍 Testing ${dex} pool: ${poolAddress.substring(0, 8)}...`);

      // Fetch real account data from blockchain
      const accountInfo = await connection.getAccountInfo(new PublicKey(poolAddress));
      
      if (!accountInfo) {
        throw new Error('Pool account not found on blockchain');
      }

      console.log(`   📦 Retrieved account data: ${accountInfo.data.length} bytes`);

      // Parse with DEX-specific client
      const poolData = await parseFunction(poolAddress, accountInfo);

      if (poolData) {
        // Extract price using our aggregator
        const currentPrice = this.factory.getCurrentPrice(poolData);
        
        result.success = true;
        result.price = currentPrice.toNumber();
        result.liquidity = poolData.totalLiquidity.toNumber();
        result.tokenA = poolData.tokenA.mint.substring(0, 8);
        result.tokenB = poolData.tokenB.mint.substring(0, 8);

        console.log(`   ✅ SUCCESS: Price = $${result.price?.toFixed(4)}, Liquidity = $${result.liquidity?.toFixed(0)}`);
        console.log(`   🏷️  Tokens: ${result.tokenA}... / ${result.tokenB}...`);
      } else {
        throw new Error('Parser returned null - unable to parse pool data');
      }

    } catch (error) {
      result.error = error instanceof Error ? error.message : String(error);
      console.log(`   ❌ FAILED: ${result.error}`);
    }

    result.latency = Date.now() - startTime;
    this.results.push(result);
  }

  private printResults(): void {
    console.log('\n📈 DIRECT DEX CLIENTS TEST RESULTS');
    console.log('===================================');

    const byDEX = this.results.reduce((acc, result) => {
      if (!acc[result.dex]) acc[result.dex] = { total: 0, success: 0 };
      acc[result.dex].total++;
      if (result.success) acc[result.dex].success++;
      return acc;
    }, {} as Record<string, { total: number; success: number }>);

    console.log('\n🎯 Success Rate by DEX:');
    Object.entries(byDEX).forEach(([dex, stats]) => {
      const rate = (stats.success / stats.total * 100).toFixed(1);
      const status = stats.success > 0 ? '✅' : '❌';
      console.log(`   ${status} ${dex}: ${stats.success}/${stats.total} (${rate}%)`);
    });

    const totalSuccess = this.results.filter(r => r.success).length;
    const totalTests = this.results.length;
    const overallRate = (totalSuccess / totalTests * 100).toFixed(1);

    console.log(`\n🏆 Overall Success Rate: ${totalSuccess}/${totalTests} (${overallRate}%)`);

    if (totalSuccess > 0) {
      const avgLatency = this.results
        .filter(r => r.success)
        .reduce((sum, r) => sum + r.latency, 0) / totalSuccess;
      
      console.log(`⚡ Average Latency: ${avgLatency.toFixed(0)}ms`);

      console.log('\n💰 Price Data Extracted:');
      this.results
        .filter(r => r.success && r.price)
        .forEach(r => {
          console.log(`   ${r.dex}: $${r.price?.toFixed(4)} (${r.tokenA}.../${r.tokenB}...)`);
        });
    }

    console.log('\n🎯 CONCLUSION:');
    if (overallRate >= '50') {
      console.log('✅ Direct DEX Clients are working with real blockchain data!');
      console.log('✅ Successfully parsing live pool information');
      console.log('✅ Price extraction functional');
    } else {
      console.log('❌ Direct DEX Clients need improvement');
      console.log('❌ Low success rate indicates parsing issues');
    }
  }
}

// Run the integration test
async function runDEXClientsIntegrationTest() {
  const test = new DirectDEXClientsIntegrationTest();
  
  try {
    await test.runAllTests();
    process.exit(0);
  } catch (error) {
    console.error('❌ Integration test failed:', error);
    process.exit(1);
  }
}

// Auto-run if this file is executed directly
if (require.main === module) {
  runDEXClientsIntegrationTest();
}

export { DirectDEXClientsIntegrationTest }; 