# Solana Arbitrage Scanner

A real-time arbitrage opportunity detection system for Solana DEXs, built with TypeScript and designed for production trading environments.

## Overview

This system monitors liquidity pools across multiple Solana DEXs to identify arbitrage opportunities in real-time. It implements sophisticated price aggregation, risk assessment, and execution probability calculations to provide actionable trading signals.

## Architecture

### Core Components

1. **Direct DEX Clients** - Native parsers for pool data from major Solana DEXs
2. **Price Aggregators** - Cross-DEX price consolidation with oracle validation  
3. **On-Chain Monitoring** - WebSocket-based real-time pool state tracking
4. **Arbitrage Scanner** - Opportunity detection with cost-benefit analysis

### Supported DEXs

- **Raydium** - AMM and concentrated liquidity pools
- **Orca** - Whirlpool and standard AMM pools  
- **Phoenix** - Order book markets
- **Meteora** - Dynamic liquidity management pools

### Oracle Integration

- **Pyth Network** - Real-time price feeds with confidence intervals
- **Switchboard** - Decentralized oracle aggregation

## Installation

```bash
npm install
```

### Dependencies

Key production dependencies:
- `@solana/web3.js` - Solana blockchain interaction
- `@pythnetwork/client` - Pyth oracle integration
- `@switchboard-xyz/solana.js` - Switchboard oracle access
- `decimal.js` - Precision arithmetic for financial calculations
- `ws` - WebSocket client for real-time data

## Configuration

Configure the scanner via environment variables or the config object:

```typescript
const config = {
  solanaEndpoints: {
    rpc: 'https://api.mainnet-beta.solana.com',
    websocket: 'wss://api.mainnet-beta.solana.com'
  },
  pools: {
    Raydium: ['58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2'],
    Orca: ['EGZ7tiLeH62TPV1gL8WwbXGzEPa9zmcpVnnkPKKnrE2U']
  },
  scanning: {
    updateInterval: 2000,
    minProfitThreshold: 0.5, // 0.5%
    maxSlippage: 0.05,
    commitment: 'confirmed'
  }
};
```

## Usage

### Basic Arbitrage Scanning

```typescript
import { ArbitrageScanner } from './src/scanner/ArbitrageScanner';

const scanner = new ArbitrageScanner(config);

scanner.on('arbitrageOpportunity', (opportunity) => {
  console.log(`Arbitrage opportunity: ${opportunity.profitPercentage.toFixed(2)}% profit`);
  console.log(`Buy: ${opportunity.buyDex} @ ${opportunity.buyPrice}`);
  console.log(`Sell: ${opportunity.sellDex} @ ${opportunity.sellPrice}`);
});

await scanner.start();
```

### Price Monitoring

```typescript
import { PoolParserFactory } from './src/monitoring/parsers/PoolParserFactory';

const factory = new PoolParserFactory(connection);
const poolData = await factory.parsePoolData(poolAddress, accountInfo, 'Raydium');
const currentPrice = factory.getCurrentPrice(poolData);
```

## Testing

The project includes comprehensive integration tests that use real blockchain data:

```bash
# Run basic integration test
npx ts-node basic-integration-test.ts

# Run specific component tests
npx ts-node src/tests/integration-dex-clients.test.ts
npx ts-node src/tests/integration-price-aggregators.test.ts
npx ts-node src/tests/integration-onchain-monitoring.test.ts

# Run all integration tests
npx ts-node run-integration-tests.ts
```

All tests connect to Solana mainnet and validate functionality with live data.

## Key Features

### Arbitrage Detection

- **Cross-DEX Price Analysis** - Identifies price discrepancies between exchanges
- **Cost Calculation** - Accounts for gas fees, slippage, and protocol fees
- **Execution Probability** - Estimates likelihood of successful trade execution
- **Risk Assessment** - Evaluates liquidity depth and market conditions

### Price Aggregation

- **Weighted Averaging** - Combines DEX prices weighted by liquidity
- **Oracle Validation** - Cross-references with Pyth and Switchboard feeds
- **Confidence Scoring** - Provides reliability metrics for price data
- **Stale Data Detection** - Filters out outdated price information

### Real-Time Monitoring

- **WebSocket Integration** - Live account change notifications
- **Pool State Tracking** - Continuous monitoring of liquidity pool updates
- **Event-Driven Architecture** - Efficient processing of blockchain events

## Current Limitations

### Known Issues

1. **SDK Dependencies** - Some DEX SDKs have breaking changes that require manual parsing fallbacks
2. **Rate Limiting** - Public RPC endpoints may throttle high-frequency requests
3. **Oracle Latency** - Price feed updates may lag behind DEX state changes
4. **Gas Estimation** - Current implementation uses simplified gas calculations

### Areas for Improvement

1. **MEV Protection** - Implementation of frontrunning protection mechanisms
2. **Advanced Routing** - Multi-hop arbitrage path optimization
3. **Portfolio Management** - Position sizing and capital allocation strategies
4. **Risk Management** - Dynamic position limits and stop-loss mechanisms

### Performance Considerations

- **Memory Usage** - Price cache grows unbounded in current implementation
- **WebSocket Stability** - No automatic reconnection logic for dropped connections
- **Error Handling** - Limited retry mechanisms for failed blockchain calls

## Production Readiness

### Ready for Production

- Basic arbitrage detection logic
- Real-time price monitoring
- Oracle price validation
- Cost calculation framework

### Requires Development

- MEV protection strategies
- Advanced execution logic
- Comprehensive error handling
- Performance optimization
- Monitoring and alerting

## API Reference

### ArbitrageScanner

```typescript
class ArbitrageScanner extends EventEmitter {
  constructor(config: ScannerConfig)
  async start(): Promise<void>
  async stop(): Promise<void>
  getStatus(): ScannerStatus
}
```

### PoolParserFactory

```typescript
class PoolParserFactory {
  constructor(connection: Connection)
  async parsePoolData(address: string, accountInfo: AccountInfo<Buffer>, dex: string): Promise<PoolLiquidity | null>
  getCurrentPrice(poolData: PoolLiquidity): Decimal
}
```

## Contributing

When contributing to this project:

1. Ensure all tests pass with real blockchain data
2. Add comprehensive error handling for new features
3. Document any new configuration options
4. Consider gas costs and execution feasibility for trading logic

## License

MIT License - see LICENSE file for details.

## Disclaimer

This software is for educational and research purposes. Trading cryptocurrencies involves substantial risk of loss. Users are responsible for their own trading decisions and should conduct thorough testing before using in production environments. 