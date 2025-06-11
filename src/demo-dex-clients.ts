import { DexClientManager, DexClientFactory } from './clients';

/**
 * Demonstration of individual DEX client implementations
 * This shows how to use each DEX client separately and together
 */
async function demonstrateDexClients() {
  console.log('🚀 Starting DEX Client Demonstration...\n');

  // Method 1: Using individual clients
  await demonstrateIndividualClients();

  // Method 2: Using client factory
  await demonstrateClientFactory();

  // Method 3: Using client manager
  await demonstrateClientManager();
}

async function demonstrateIndividualClients() {
  console.log('=== Individual DEX Clients ===');

  try {
    // Create individual clients
    const { RaydiumClient, OrcaClient, PhoenixClient, MeteoraClient } = await import('./clients/dex');
    
    const raydiumClient = new RaydiumClient();
    const orcaClient = new OrcaClient();
    const phoenixClient = new PhoenixClient();
    const meteoraClient = new MeteoraClient();

    console.log('\n📡 Connecting to all DEX APIs...');
    
    // Connect to each DEX
    await Promise.allSettled([
      raydiumClient.connect(),
      orcaClient.connect(),
      phoenixClient.connect(),
      meteoraClient.connect()
    ]);

    // Test getting pools from each DEX
    console.log('\n📊 Fetching pools from each DEX...');
    
    const [raydiumPools, orcaPools, phoenixPools, meteoraPools] = await Promise.allSettled([
      raydiumClient.getAllPools(),
      orcaClient.getAllPools(),
      phoenixClient.getAllPools(),
      meteoraClient.getAllPools()
    ]);

    console.log(`📈 Raydium Pools: ${raydiumPools.status === 'fulfilled' ? raydiumPools.value.length : 'Failed'}`);
    console.log(`🌊 Orca Pools: ${orcaPools.status === 'fulfilled' ? orcaPools.value.length : 'Failed'}`);
    console.log(`🔥 Phoenix Markets: ${phoenixPools.status === 'fulfilled' ? phoenixPools.value.length : 'Failed'}`);
    console.log(`☄️ Meteora Pools: ${meteoraPools.status === 'fulfilled' ? meteoraPools.value.length : 'Failed'}`);

    // Test price quotes
    const SOL_MINT = 'So11111111111111111111111111111111111111112';
    const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
    const amount = 1000000; // 1 SOL (in lamports)

    console.log('\n💰 Getting price quotes for 1 SOL -> USDC...');
    
    const quotes = await Promise.allSettled([
      raydiumClient.getPriceQuote(SOL_MINT, USDC_MINT, amount),
      orcaClient.getPriceQuote(SOL_MINT, USDC_MINT, amount),
      phoenixClient.getPriceQuote(SOL_MINT, USDC_MINT, amount),
      meteoraClient.getPriceQuote(SOL_MINT, USDC_MINT, amount)
    ]);

    quotes.forEach((result, index) => {
      const dexNames = ['Raydium', 'Orca', 'Phoenix', 'Meteora'][index];
      if (result.status === 'fulfilled' && result.value) {
        const quote = result.value;
        console.log(`  ${dexNames}: ${quote.outputAmount.toFixed(2)} USDC @ ${quote.price.toFixed(4)} (${(quote.slippage * 100).toFixed(3)}% slippage)`);
      } else {
        console.log(`  ${dexNames}: No quote available`);
      }
    });

    // Disconnect all clients
    await Promise.allSettled([
      raydiumClient.disconnect(),
      orcaClient.disconnect(),
      phoenixClient.disconnect(),
      meteoraClient.disconnect()
    ]);

  } catch (error) {
    console.error('❌ Error in individual clients demo:', error);
  }
}

async function demonstrateClientFactory() {
  console.log('\n=== DEX Client Factory ===');

  try {
    // Create all clients using factory
    const clients = DexClientFactory.createAllClients();
    
    console.log('📡 Connecting all clients via factory...');
    await Promise.allSettled([
      clients.raydium.connect(),
      clients.orca.connect(),  
      clients.phoenix.connect(),
      clients.meteora.connect()
    ]);

    // Test getting specific pool info
    const testPoolAddress = '58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2'; // Raydium SOL/USDC
    
    console.log(`\n🎯 Getting pool info for: ${testPoolAddress.substring(0, 8)}...`);
    
    const poolInfo = await clients.raydium.getPoolInfo(testPoolAddress);
    if (poolInfo) {
      console.log(`  Pool: ${poolInfo.poolAddress.substring(0, 8)}...`);
      console.log(`  TokenA: ${poolInfo.tokenA.substring(0, 8)}...`);
      console.log(`  TokenB: ${poolInfo.tokenB.substring(0, 8)}...`);
      console.log(`  Liquidity: $${poolInfo.liquidity.toLocaleString()}`);
      console.log(`  Price: ${poolInfo.priceA.toFixed(6)}`);
      console.log(`  Fee: ${(poolInfo.fee * 100).toFixed(3)}%`);
    } else {
      console.log('  Pool info not available');
    }

    // Disconnect all
    await Promise.allSettled([
      clients.raydium.disconnect(),
      clients.orca.disconnect(),
      clients.phoenix.disconnect(),
      clients.meteora.disconnect()
    ]);

  } catch (error) {
    console.error('❌ Error in factory demo:', error);
  }
}

async function demonstrateClientManager() {
  console.log('\n=== DEX Client Manager ===');

  try {
    // Create manager with all clients
    const manager = new DexClientManager();
    
    console.log('📡 Connecting all DEX clients...');
    await manager.connectAll();

    const connectedClients = manager.getConnectedClients();
    console.log(`✅ Connected to ${connectedClients.length} DEX clients`);

    // Get all pools from all DEXs
    console.log('\n📊 Fetching pools from all connected DEXs...');
    const allPoolsData = await manager.getAllPoolsFromAllDexes();
    
    allPoolsData.forEach(({ dex, pools }) => {
      console.log(`  ${dex.toUpperCase()}: ${pools.length} pools`);
    });

    // Cross-DEX price comparison
    const SOL_MINT = 'So11111111111111111111111111111111111111112';
    const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
    const amount = 1000000; // 1 SOL

    console.log('\n💱 Cross-DEX price comparison for 1 SOL -> USDC:');
    const allQuotes = await manager.getPriceQuotesFromAllDexes(SOL_MINT, USDC_MINT, amount);
    
    const validQuotes = allQuotes.filter(({ quote }) => quote !== null);
    
    if (validQuotes.length > 0) {
      // Sort by price (highest to lowest)
      validQuotes.sort((a, b) => (b.quote?.price || 0) - (a.quote?.price || 0));
      
      console.log('  Ranked by price (best to worst):');
      validQuotes.forEach(({ dex, quote }, index) => {
        if (quote) {
          const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : '  ';
          console.log(`  ${medal} ${dex.toUpperCase()}: ${quote.outputAmount.toFixed(2)} USDC @ ${quote.price.toFixed(4)}`);
        }
      });

      // Calculate arbitrage potential
      if (validQuotes.length >= 2) {
        const bestPrice = validQuotes[0].quote!;
        const worstPrice = validQuotes[validQuotes.length - 1].quote!;
        const profitPotential = ((bestPrice.price - worstPrice.price) / worstPrice.price) * 100;
        
        console.log(`\n🎯 Arbitrage Potential:`);
        console.log(`  Buy on ${validQuotes[validQuotes.length - 1].dex.toUpperCase()} @ ${worstPrice.price.toFixed(4)}`);
        console.log(`  Sell on ${validQuotes[0].dex.toUpperCase()} @ ${bestPrice.price.toFixed(4)}`);
        console.log(`  Profit Potential: ${profitPotential.toFixed(3)}%`);
      }
    } else {
      console.log('  No valid quotes available');
    }

    // Disconnect all
    console.log('\n🛑 Disconnecting all clients...');
    await manager.disconnectAll();
    console.log('✅ All clients disconnected');

  } catch (error) {
    console.error('❌ Error in manager demo:', error);
  }
}

// Run the demonstration
if (require.main === module) {
  demonstrateDexClients()
    .then(() => {
      console.log('\n🎉 DEX Client demonstration completed!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Demonstration failed:', error);
      process.exit(1);
    });
}

export { demonstrateDexClients }; 