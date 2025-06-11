import { Connection, PublicKey } from '@solana/web3.js';
import { PoolParserFactory } from '../monitoring/parsers/PoolParserFactory';
import { PythPriceParser } from '../monitoring/parsers/PythPriceParser';
import { SwitchboardPriceParser } from '../monitoring/parsers/SwitchboardPriceParser';
import Decimal from 'decimal.js';

/**
 * Integration Test for Price Aggregators
 * 
 * Tests price aggregation across multiple DEXs and oracle feeds
 * Uses real blockchain data to validate price consistency
 */

const connection = new Connection('https://api.mainnet-beta.solana.com', 'confirmed');

// Real pools across different DEXs for the same trading pairs
const PRICE_COMPARISON_POOLS = {
  'SOL-USDC': {
    Raydium: ['58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2'],
    Orca: ['EGZ7tiLeH62TPV1gL8WwbXGzEPa9zmcpVnnkPKKnrE2U'],
    Phoenix: ['4DoNfFBfF7UokCC2FQzriy7yHK6DY6NVdYpuekQ5pRgg']
  },
  'SOL-USDT': {
    Raydium: ['8sLbNZoA1cfnvMJLPfp98ZLAnFSYCFApfJKMbiXNLwxj'],
    Orca: ['9vqYJjDUFecbNTuyZQJSXLNmKZdNZzlEiPi4b3hzXCxy']
  }
};

// Real Pyth and Switchboard feeds
const ORACLE_FEEDS = {
  Pyth: {
    'SOL-USD': 'H6ARHf6YXhGYeQfUzQNGk6rDNnLBQKrenN712K4AQJEG',
    'USDC-USD': 'Gnt27xtC473ZT2Mw5u8wZ68Z3gULkSTb5DuxJy7eJotD'
  },
  Switchboard: {
    'SOL-USD': '7yyaeuJ1GGtVBLT2z2xub5ZWYKaNhF28mj1RdV4VDFVk',
    'USDC-USD': 'CZx29wKMUxaJDq6aLVQTdViPL754tTR64NAgQBUGxxHb'
  }
};

interface PriceData {
  source: string;
  pool?: string;
  price: number;
  timestamp: number;
  confidence?: number;
  liquidity?: number;
}

interface AggregatedPriceResult {
  pair: string;
  dexPrices: PriceData[];
  oraclePrices: PriceData[];
  aggregatedPrice: number;
  priceSpread: number;
  confidence: number;
  totalLiquidity: number;
}

class PriceAggregatorsIntegrationTest {
  private factory: PoolParserFactory;
  private pythParser: PythPriceParser;
  private switchboardParser: SwitchboardPriceParser;
  private results: AggregatedPriceResult[] = [];

  constructor() {
    this.factory = new PoolParserFactory(connection);
    this.pythParser = new PythPriceParser(connection);
    this.switchboardParser = new SwitchboardPriceParser(connection);
  }

  async runAllTests(): Promise<void> {
    console.log('🎯 PRICE AGGREGATORS - LIVE INTEGRATION TEST');
    console.log('============================================');
    console.log('Testing real price aggregation across DEXs and oracles\n');

    for (const [pair, dexPools] of Object.entries(PRICE_COMPARISON_POOLS)) {
      await this.testPriceAggregationForPair(pair, dexPools);
    }

    this.printAggregationResults();
  }

  private async testPriceAggregationForPair(
    pair: string, 
    dexPools: Record<string, string[]>
  ): Promise<void> {
    console.log(`\n💱 Testing Price Aggregation for ${pair}`);
    console.log('='.repeat(40));

    const dexPrices: PriceData[] = [];
    const oraclePrices: PriceData[] = [];

    // Collect prices from all DEXs
    for (const [dexName, poolAddresses] of Object.entries(dexPools)) {
      console.log(`\n📊 Fetching ${dexName} prices...`);
      
      for (const poolAddress of poolAddresses) {
        try {
          const price = await this.getDEXPrice(dexName, poolAddress);
          if (price) {
            dexPrices.push(price);
            console.log(`   ✅ ${dexName}: $${price.price.toFixed(4)} (Liquidity: $${price.liquidity?.toFixed(0)})`);
          }
        } catch (error) {
          console.log(`   ❌ ${dexName} failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }

    // Collect prices from oracles
    console.log(`\n🔮 Fetching Oracle prices...`);
    await this.collectOraclePrices(pair, oraclePrices);

    // Aggregate all prices
    if (dexPrices.length > 0 || oraclePrices.length > 0) {
      const aggregated = this.aggregatePrices(pair, dexPrices, oraclePrices);
      this.results.push(aggregated);
      
      console.log(`\n🎯 ${pair} Aggregation Summary:`);
      console.log(`   📈 Aggregated Price: $${aggregated.aggregatedPrice.toFixed(4)}`);
      console.log(`   📊 Price Spread: ${(aggregated.priceSpread * 100).toFixed(2)}%`);
      console.log(`   🎯 Confidence: ${(aggregated.confidence * 100).toFixed(1)}%`);
      console.log(`   💰 Total Liquidity: $${aggregated.totalLiquidity.toFixed(0)}`);
    } else {
      console.log(`   ❌ No price data collected for ${pair}`);
    }
  }

  private async getDEXPrice(dexName: string, poolAddress: string): Promise<PriceData | null> {
    try {
      const accountInfo = await connection.getAccountInfo(new PublicKey(poolAddress));
      if (!accountInfo) return null;

      const poolData = await this.factory.parsePoolData(poolAddress, accountInfo, dexName);
      if (!poolData) return null;

      const price = this.factory.getCurrentPrice(poolData);

      return {
        source: dexName,
        pool: poolAddress,
        price: price.toNumber(),
        timestamp: Date.now(),
        liquidity: poolData.totalLiquidity.toNumber()
      };
    } catch (error) {
      console.error(`Failed to get ${dexName} price:`, error);
      return null;
    }
  }

  private async collectOraclePrices(pair: string, oraclePrices: PriceData[]): Promise<void> {
    // Map trading pair to oracle feeds
    const pairKey = pair.includes('SOL') ? 'SOL-USD' : 'USDC-USD';
    
    // Test Pyth oracle
    try {
      const pythFeed = ORACLE_FEEDS.Pyth[pairKey];
      if (pythFeed) {
        const pythPrice = await this.pythParser.parseOraclePrice(pythFeed);
        if (pythPrice && pythPrice.price.gt(0)) {
          oraclePrices.push({
            source: 'Pyth',
            price: pythPrice.price.toNumber(),
            timestamp: pythPrice.timestamp,
            confidence: pythPrice.confidence.toNumber()
          });
          console.log(`   ✅ Pyth: $${pythPrice.price.toFixed(4)} (conf: ±${pythPrice.confidence.toFixed(4)})`);
        }
      }
    } catch (error) {
      console.log(`   ❌ Pyth failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    // Test Switchboard oracle
    try {
      const switchboardFeed = ORACLE_FEEDS.Switchboard[pairKey];
      if (switchboardFeed) {
        const sbPrice = await this.switchboardParser.parseOraclePrice(switchboardFeed);
        if (sbPrice && sbPrice.price.gt(0)) {
          oraclePrices.push({
            source: 'Switchboard',
            price: sbPrice.price.toNumber(),
            timestamp: sbPrice.timestamp,
            confidence: sbPrice.confidence ? sbPrice.confidence.toNumber() : 0.95
          });
          console.log(`   ✅ Switchboard: $${sbPrice.price.toFixed(4)}`);
        }
      }
    } catch (error) {
      console.log(`   ❌ Switchboard failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private aggregatePrices(
    pair: string, 
    dexPrices: PriceData[], 
    oraclePrices: PriceData[]
  ): AggregatedPriceResult {
    const allPrices = [...dexPrices, ...oraclePrices];
    
    if (allPrices.length === 0) {
      return {
        pair,
        dexPrices,
        oraclePrices,
        aggregatedPrice: 0,
        priceSpread: 0,
        confidence: 0,
        totalLiquidity: 0
      };
    }

    // Calculate weighted average (DEX prices weighted by liquidity, oracles by confidence)
    let weightedSum = 0;
    let totalWeight = 0;

    // Weight DEX prices by liquidity
    dexPrices.forEach(dp => {
      const weight = dp.liquidity || 1000000; // Default weight if no liquidity
      weightedSum += dp.price * weight;
      totalWeight += weight;
    });

    // Weight oracle prices by confidence and recency
    oraclePrices.forEach(op => {
      const ageMinutes = (Date.now() - op.timestamp) / (1000 * 60);
      const recencyWeight = Math.max(0.1, 1 - (ageMinutes / 60)); // Decay over 1 hour
      const confidenceWeight = op.confidence || 0.9;
      const weight = 10000000 * confidenceWeight * recencyWeight; // High weight for oracles
      
      weightedSum += op.price * weight;
      totalWeight += weight;
    });

    const aggregatedPrice = totalWeight > 0 ? weightedSum / totalWeight : 0;

    // Calculate price spread
    const prices = allPrices.map(p => p.price);
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    const priceSpread = aggregatedPrice > 0 ? (maxPrice - minPrice) / aggregatedPrice : 0;

    // Calculate overall confidence
    const hasOracleData = oraclePrices.length > 0;
    const hasDEXData = dexPrices.length > 0;
    const spreadPenalty = Math.max(0, 1 - (priceSpread * 10)); // Penalty for high spread
    
    let confidence = 0.5; // Base confidence
    if (hasOracleData && hasDEXData) confidence = 0.9;
    else if (hasOracleData || hasDEXData) confidence = 0.7;
    
    confidence *= spreadPenalty;

    // Calculate total liquidity
    const totalLiquidity = dexPrices.reduce((sum, dp) => sum + (dp.liquidity || 0), 0);

    return {
      pair,
      dexPrices,
      oraclePrices,
      aggregatedPrice,
      priceSpread,
      confidence,
      totalLiquidity
    };
  }

  private printAggregationResults(): void {
    console.log('\n📊 PRICE AGGREGATION TEST RESULTS');
    console.log('==================================');

    if (this.results.length === 0) {
      console.log('❌ No aggregation results to display');
      return;
    }

    console.log('\n🎯 Price Aggregation Summary:');
    this.results.forEach(result => {
      console.log(`\n💱 ${result.pair}:`);
      console.log(`   📈 Aggregated Price: $${result.aggregatedPrice.toFixed(4)}`);
      console.log(`   📊 DEX Sources: ${result.dexPrices.length}`);
      console.log(`   🔮 Oracle Sources: ${result.oraclePrices.length}`);
      console.log(`   📏 Price Spread: ${(result.priceSpread * 100).toFixed(2)}%`);
      console.log(`   🎯 Confidence: ${(result.confidence * 100).toFixed(1)}%`);
      console.log(`   💰 Total Liquidity: $${result.totalLiquidity.toFixed(0)}`);

      if (result.dexPrices.length > 0) {
        console.log('   📊 DEX Prices:');
        result.dexPrices.forEach(dp => {
          console.log(`      ${dp.source}: $${dp.price.toFixed(4)}`);
        });
      }

      if (result.oraclePrices.length > 0) {
        console.log('   🔮 Oracle Prices:');
        result.oraclePrices.forEach(op => {
          console.log(`      ${op.source}: $${op.price.toFixed(4)}`);
        });
      }
    });

    // Overall assessment
    const avgConfidence = this.results.reduce((sum, r) => sum + r.confidence, 0) / this.results.length;
    const avgSpread = this.results.reduce((sum, r) => sum + r.priceSpread, 0) / this.results.length;

    console.log('\n🏆 OVERALL ASSESSMENT:');
    console.log(`   📊 Average Confidence: ${(avgConfidence * 100).toFixed(1)}%`);
    console.log(`   📏 Average Spread: ${(avgSpread * 100).toFixed(2)}%`);

    if (avgConfidence > 0.7 && avgSpread < 0.05) {
      console.log('   ✅ EXCELLENT: Price aggregators working optimally!');
      console.log('   ✅ High confidence with low price spreads');
      console.log('   ✅ Successful cross-DEX and oracle integration');
    } else if (avgConfidence > 0.5) {
      console.log('   ⚠️  GOOD: Price aggregators working but could improve');
      console.log('   ⚠️  Moderate confidence or spreads detected');
    } else {
      console.log('   ❌ NEEDS IMPROVEMENT: Low confidence in aggregated prices');
      console.log('   ❌ Review data sources and aggregation logic');
    }
  }
}

// Run the integration test
async function runPriceAggregatorsIntegrationTest() {
  const test = new PriceAggregatorsIntegrationTest();
  
  try {
    await test.runAllTests();
    process.exit(0);
  } catch (error) {
    console.error('❌ Price aggregation test failed:', error);
    process.exit(1);
  }
}

// Auto-run if this file is executed directly
if (require.main === module) {
  runPriceAggregatorsIntegrationTest();
}

export { PriceAggregatorsIntegrationTest }; 