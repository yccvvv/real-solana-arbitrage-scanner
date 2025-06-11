import { PriceAggregatorManager, PriceAggregatorFactory } from './clients/aggregators';

/**
 * Demonstration of price aggregator implementations
 * This shows how to use each aggregator separately and together for price consensus
 */
async function demonstratePriceAggregators() {
  console.log('🚀 Starting Price Aggregator Demonstration...\n');

  // Method 1: Using individual aggregators
  await demonstrateIndividualAggregators();

  // Method 2: Using aggregator factory
  await demonstrateAggregatorFactory();

  // Method 3: Using aggregator manager
  await demonstrateAggregatorManager();

  // Method 4: Advanced features
  await demonstrateAdvancedFeatures();
}

async function demonstrateIndividualAggregators() {
  console.log('=== Individual Price Aggregators ===');

  try {
    // Create individual aggregators
    const { JupiterClient, OneInchClient, CoinGeckoClient } = await import('./clients/aggregators');
    
    const jupiterClient = new JupiterClient();
    const oneInchClient = new OneInchClient(); // No API key for demo
    const coinGeckoClient = new CoinGeckoClient(); // No API key for demo

    console.log('\n📡 Connecting to all price aggregators...');
    
    // Connect to each aggregator
    const connectionResults = await Promise.allSettled([
      jupiterClient.connect(),
      oneInchClient.connect(),
      coinGeckoClient.connect()
    ]);

    connectionResults.forEach((result, index) => {
      const names = ['Jupiter', '1inch', 'CoinGecko'][index];
      console.log(`  ${names}: ${result.status === 'fulfilled' ? '✅ Connected' : '❌ Failed'}`);
    });

    // Test price fetching
    const SOL_MINT = 'So11111111111111111111111111111111111111112';
    const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

    console.log('\n💰 Getting SOL prices from each aggregator...');
    
    const priceResults = await Promise.allSettled([
      jupiterClient.getTokenPrice(SOL_MINT),
      oneInchClient.getTokenPrice(SOL_MINT),
      coinGeckoClient.getTokenPrice(SOL_MINT)
    ]);

    priceResults.forEach((result, index) => {
      const names = ['Jupiter', '1inch', 'CoinGecko'][index];
      if (result.status === 'fulfilled' && result.value) {
        const price = result.value;
        console.log(`  ${names}: $${price.price.toFixed(4)} (${price.symbol})`);
      } else {
        console.log(`  ${names}: No price available`);
      }
    });

    // Test market data
    console.log('\n📊 Getting market data for SOL...');
    
    const marketDataResults = await Promise.allSettled([
      jupiterClient.getMarketData(SOL_MINT),
      oneInchClient.getMarketData(SOL_MINT),
      coinGeckoClient.getMarketData(SOL_MINT)
    ]);

    marketDataResults.forEach((result, index) => {
      const names = ['Jupiter', '1inch', 'CoinGecko'][index];
      if (result.status === 'fulfilled' && result.value) {
        const data = result.value;
        console.log(`  ${names}: ${data.name} ($${data.price.toFixed(4)})`);
        if (data.marketCap) console.log(`    Market Cap: $${(data.marketCap / 1e9).toFixed(2)}B`);
        if (data.volume24h) console.log(`    24h Volume: $${(data.volume24h / 1e6).toFixed(2)}M`);
      } else {
        console.log(`  ${names}: No market data available`);
      }
    });

    // Disconnect all aggregators
    await Promise.allSettled([
      jupiterClient.disconnect(),
      oneInchClient.disconnect(),
      coinGeckoClient.disconnect()
    ]);

  } catch (error) {
    console.error('❌ Error in individual aggregators demo:', error);
  }
}

async function demonstrateAggregatorFactory() {
  console.log('\n=== Price Aggregator Factory ===');

  try {
    // Create all aggregators using factory
    const aggregators = PriceAggregatorFactory.createAllAggregators({
      // oneInchApiKey: 'your-api-key', // Uncomment if you have API keys
      // coinGeckoApiKey: 'your-api-key'
    });
    
    console.log('📡 Connecting all aggregators via factory...');
    await Promise.allSettled([
      aggregators.jupiter.connect(),
      aggregators.oneInch.connect(),
      aggregators.coinGecko.connect()
    ]);

    // Test batch price fetching
    const testTokens = [
      'So11111111111111111111111111111111111111112', // SOL
      'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
    ];

    console.log('\n💱 Getting prices for multiple tokens...');
    
    const batchPrices = await aggregators.jupiter.getMultipleTokenPrices(testTokens);
    batchPrices.forEach(price => {
      console.log(`  ${price.symbol}: $${price.price.toFixed(6)}`);
    });

    // Disconnect all
    await Promise.allSettled([
      aggregators.jupiter.disconnect(),
      aggregators.oneInch.disconnect(),
      aggregators.coinGecko.disconnect()
    ]);

  } catch (error) {
    console.error('❌ Error in factory demo:', error);
  }
}

async function demonstrateAggregatorManager() {
  console.log('\n=== Price Aggregator Manager ===');

  try {
    // Create manager with all aggregators
    const manager = new PriceAggregatorManager({
      // oneInchApiKey: 'your-api-key',
      // coinGeckoApiKey: 'your-api-key'
    });
    
    console.log('📡 Connecting all price aggregators...');
    await manager.connectAll();

    const connectedAggregators = manager.getConnectedAggregators();
    console.log(`✅ Connected to ${connectedAggregators.length} price aggregators`);

    // Cross-aggregator price comparison
    const SOL_MINT = 'So11111111111111111111111111111111111111112';

    console.log('\n💰 Cross-aggregator price comparison for SOL:');
    const allPrices = await manager.getTokenPriceFromAllSources(SOL_MINT);
    
    const validPrices = allPrices.filter(({ price }) => price !== null);
    
    if (validPrices.length > 0) {
      console.log('  Price comparison:');
      validPrices.forEach(({ source, price }) => {
        if (price) {
          console.log(`    ${source.toUpperCase()}: $${price.price.toFixed(6)}`);
        }
      });

      // Calculate price statistics
      const prices = validPrices.map(p => p.price!.price);
      const avgPrice = prices.reduce((sum, p) => sum + p, 0) / prices.length;
      const minPrice = Math.min(...prices);
      const maxPrice = Math.max(...prices);
      const variation = ((maxPrice - minPrice) / avgPrice) * 100;

      console.log('\n📊 Price Statistics:');
      console.log(`    Average: $${avgPrice.toFixed(6)}`);
      console.log(`    Range: $${minPrice.toFixed(6)} - $${maxPrice.toFixed(6)}`);
      console.log(`    Variation: ${variation.toFixed(3)}%`);
    } else {
      console.log('  No valid prices available');
    }

    // Disconnect all
    console.log('\n🛑 Disconnecting all aggregators...');
    await manager.disconnectAll();
    console.log('✅ All aggregators disconnected');

  } catch (error) {
    console.error('❌ Error in manager demo:', error);
  }
}

async function demonstrateAdvancedFeatures() {
  console.log('\n=== Advanced Features ===');

  try {
    const manager = new PriceAggregatorManager();
    await manager.connectAll();

    const SOL_MINT = 'So11111111111111111111111111111111111111112';

    // Price consensus analysis
    console.log('\n🎯 Price Consensus Analysis:');
    const consensus = await manager.getPriceConsensus(SOL_MINT);
    
    if (consensus) {
      console.log(`  Average Price: $${consensus.averagePrice.toFixed(6)}`);
      console.log(`  Price Range: $${consensus.priceRange.min.toFixed(6)} - $${consensus.priceRange.max.toFixed(6)}`);
      console.log(`  Sources: ${consensus.sourcesCount}`);
      console.log(`  Consensus: ${consensus.consensus ? '✅ Yes' : '❌ No'}`);

      console.log('\n  Source Breakdown:');
      consensus.sources.forEach(source => {
        console.log(`    ${source.source.toUpperCase()}: $${source.price.toFixed(6)}`);
      });
    }

    // Price discrepancy detection
    console.log('\n🔍 Price Discrepancy Detection:');
    const discrepancies = await manager.findPriceDiscrepancies(SOL_MINT, 3); // 3% threshold
    
    if (discrepancies) {
      console.log(`  Has Discrepancy: ${discrepancies.hasDiscrepancy ? '⚠️ Yes' : '✅ No'}`);
      console.log(`  Max Variation: ${discrepancies.maxVariation.toFixed(3)}%`);

      if (discrepancies.hasDiscrepancy) {
        console.log('\n  Source Deviations:');
        discrepancies.sources
          .sort((a, b) => Math.abs(b.deviation) - Math.abs(a.deviation))
          .forEach(source => {
            const sign = source.deviation >= 0 ? '+' : '';
            console.log(`    ${source.source.toUpperCase()}: ${sign}${source.deviation.toFixed(3)}%`);
          });
      }
    }

    // Best price finder
    console.log('\n🏆 Best Price Source:');
    const bestPrice = await manager.getBestPrice(SOL_MINT);
    
    if (bestPrice) {
      console.log(`  Source: ${bestPrice.source.toUpperCase()}`);
      console.log(`  Price: $${bestPrice.price.price.toFixed(6)}`);
      console.log(`  Symbol: ${bestPrice.price.symbol}`);
      console.log(`  Updated: ${new Date(bestPrice.price.timestamp).toLocaleTimeString()}`);
    }

    await manager.disconnectAll();

  } catch (error) {
    console.error('❌ Error in advanced features demo:', error);
  }
}

// Run the demonstration
if (require.main === module) {
  demonstratePriceAggregators()
    .then(() => {
      console.log('\n🎉 Price Aggregator demonstration completed!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Demonstration failed:', error);
      process.exit(1);
    });
}

export { demonstratePriceAggregators }; 