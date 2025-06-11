# Technical Documentation

## System Architecture

### Overview

The Solana Arbitrage Scanner is built using a modular, event-driven architecture designed for real-time processing of blockchain data. The system prioritizes accuracy and reliability over speed, implementing multiple validation layers and fallback mechanisms.

### Core Architecture Patterns

1. **Event-Driven Processing** - WebSocket events trigger price updates and arbitrage calculations
2. **Factory Pattern** - PoolParserFactory abstracts DEX-specific parsing logic
3. **Observer Pattern** - EventEmitter-based communication between components
4. **Strategy Pattern** - Pluggable DEX parsers and oracle integrations

## Component Deep Dive

### 1. WebSocket Client (`SolanaWebSocketClient`)

Manages persistent connections to Solana RPC WebSocket endpoints for real-time account monitoring.

#### Key Features
- Automatic subscription management
- Connection health monitoring
- Event-based data processing
- Account change filtering

#### Current Limitations
- No automatic reconnection on dropped connections
- Limited error recovery mechanisms
- Single endpoint dependency

#### Connection Lifecycle

```typescript
// Connection lifecycle
await client.connect()
await client.subscribeToPoolAccount(poolAddress, dexType)
client.on('poolUpdate', handleUpdate)
```

### 2. Pool Parser Factory (`PoolParserFactory`)

Central orchestrator for DEX-specific pool data parsing with intelligent fallback mechanisms.

#### Parser Implementations

**Manual Parsing Approach** (Current)
- Reads raw account data directly
- Implements DEX-specific data layouts
- No external SDK dependencies
- Higher maintenance overhead

**SDK Integration Approach** (Partial)
- Uses official DEX SDKs where stable
- Fallback to manual parsing on errors
- Version compatibility issues
- Cleaner code but less reliable

#### Price Calculation Logic

The factory implements intelligent price calculation that handles various edge cases:

```typescript
getCurrentPrice(poolData: PoolLiquidity): Decimal {
  // 1. Token pair identification
  // 2. Stablecoin detection 
  // 3. Price direction calculation
  // 4. Validation and sanity checks
}
```

**Known Issues:**
- Price calculation assumes token pair ordering
- Limited handling of exotic token pairs
- No dynamic token metadata fetching

### 3. DEX-Specific Parsers

#### Raydium Parser (`RaydiumPoolParser`)
- **Status**: Partially functional with SDK integration
- **Data Layout**: AMM pool state structure
- **Known Issues**: SDK API changes require fallbacks

#### Orca Parser (`OrcaPoolParser`) 
- **Status**: Basic implementation with Whirlpool support
- **Data Layout**: Concentrated liquidity positions
- **Known Issues**: Complex tick and position calculations

#### Phoenix Parser (`PhoenixPoolParser`)
- **Status**: Manual order book parsing
- **Data Layout**: Order book bid/ask structure
- **Known Issues**: Simplified liquidity depth calculation

#### Meteora Parser (`MeteoraPoolParser`)
- **Status**: Basic implementation
- **Data Layout**: Dynamic fee structures
- **Known Issues**: Limited support for all pool types

### 4. Oracle Integration

#### Pyth Network (`PythPriceParser`)
- **Connection**: Official Pyth client library
- **Data**: Price feeds with confidence intervals
- **Update Frequency**: Sub-second updates
- **Reliability**: High (decentralized network)

#### Switchboard (`SwitchboardPriceParser`)
- **Connection**: Switchboard Solana client
- **Data**: Aggregated price feeds
- **Update Frequency**: Variable (depends on feed)
- **Reliability**: Medium (smaller oracle network)

### 5. Arbitrage Detection (`ArbitrageScanner`)

Implements sophisticated arbitrage opportunity detection with comprehensive cost analysis.

#### Detection Algorithm

1. **Price Collection**: Gather prices from all monitored DEXs
2. **Cross-DEX Comparison**: Identify price discrepancies
3. **Cost Calculation**: Factor in all trading costs
4. **Probability Assessment**: Estimate execution likelihood
5. **Risk Evaluation**: Assess market conditions

#### Cost Components

```typescript
interface CostComponents {
  swapFeeBuy: Decimal;      // DEX trading fees
  swapFeeSell: Decimal;     // DEX trading fees  
  gasCost: Decimal;         // Blockchain transaction costs
  slippageBuy: Decimal;     // Price impact estimates
  slippageSell: Decimal;    // Price impact estimates
  protocolFee: Decimal;     // Protocol-specific fees
  mevProtection: Decimal;   // MEV protection costs
}
```

#### Execution Probability Factors

- **Liquidity Depth**: Available tradeable amounts
- **Price Volatility**: Recent price movement patterns
- **Network Congestion**: Current blockchain conditions
- **DEX Reliability**: Historical execution success rates

## Data Flow

### Real-Time Processing Pipeline

1. **WebSocket Event** - Account change notification received
2. **Data Parsing** - Raw account data parsed by DEX-specific parser
3. **Price Calculation** - Current pool price calculated and validated
4. **Cache Update** - Price cache updated with new data
5. **Arbitrage Analysis** - Cross-DEX price comparison performed
6. **Opportunity Evaluation** - Cost-benefit analysis conducted
7. **Event Emission** - Opportunity broadcasted to subscribers

### Error Handling Strategy

- **Graceful Degradation**: Failed parsers don't crash entire system
- **Fallback Mechanisms**: Manual parsing when SDK integration fails
- **Data Validation**: Multiple validation layers for price data
- **Timeout Handling**: Network request timeouts with retries

## Configuration Management

### Environment Variables

```bash
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
SOLANA_WS_URL=wss://api.mainnet-beta.solana.com
MIN_PROFIT_THRESHOLD=0.5
MAX_SLIPPAGE_TOLERANCE=0.05
UPDATE_INTERVAL=2000
```

### Pool Configuration

Pools are configured per DEX with known profitable pairs:

```typescript
const DEFAULT_POOLS = {
  Raydium: [
    '58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2', // SOL-USDC
    '8sLbNZoA1cfnvMJLPfp98ZLAnFSYCFApfJKMbiXNLwxj'  // High-volume pair
  ],
  Orca: [
    'EGZ7tiLeH62TPV1gL8WwbXGzEPa9zmcpVnnkPKKnrE2U', // SOL-USDC Whirlpool
    '9vqYJjDUFecbNTuyZQJSXLNmKZdNZzlEiPi4b3hzXCxy'  // SOL-USDT Whirlpool
  ]
};
```

## Performance Characteristics

### Benchmarks (Local Testing)

- **WebSocket Latency**: 50-200ms for account updates
- **Price Calculation**: <5ms per pool
- **Arbitrage Detection**: 10-50ms for full analysis
- **Memory Usage**: ~100MB base + ~1MB per monitored pool

### Bottlenecks

1. **RPC Rate Limits**: Public endpoints limit request frequency
2. **WebSocket Stability**: Connection drops require manual reconnection
3. **Price Cache Growth**: Unbounded memory usage over time
4. **SDK Compatibility**: Breaking changes in external dependencies

## Testing Strategy

### Integration Test Coverage

All tests use real Solana mainnet data:

1. **Blockchain Connectivity** - RPC endpoint availability
2. **Pool Data Retrieval** - Account data fetching and parsing
3. **Real-Time Monitoring** - WebSocket event processing
4. **Price Calculation** - Accuracy of price derivation
5. **Oracle Integration** - Price feed validation

### Test Execution

```bash
# Basic functionality validation
npx ts-node basic-integration-test.ts

# Component-specific testing
npx ts-node src/tests/integration-dex-clients.test.ts
npx ts-node src/tests/integration-price-aggregators.test.ts
npx ts-node src/tests/integration-onchain-monitoring.test.ts
```

## Known Issues and Limitations

### Critical Issues

1. **SDK Dependency Fragility**
   - External DEX SDKs frequently introduce breaking changes
   - Requires constant maintenance and fallback implementations
   - Impact: Reduced parser reliability

2. **Rate Limiting Constraints**
   - Public RPC endpoints throttle high-frequency requests
   - WebSocket connections may be dropped during high load
   - Impact: Missed opportunities, incomplete data

3. **Oracle Synchronization**
   - Price feeds may lag behind DEX state changes
   - Different update frequencies across oracle providers
   - Impact: False arbitrage signals

### Medium Priority Issues

1. **Memory Management**
   - Price cache grows without bounds
   - No cleanup mechanism for stale data
   - Impact: Increasing memory usage over time

2. **Error Recovery**
   - Limited retry logic for failed operations
   - No automatic WebSocket reconnection
   - Impact: System requires manual intervention

3. **Gas Estimation**
   - Simplified gas cost calculations
   - No dynamic fee adjustment for network congestion
   - Impact: Inaccurate profit projections

### Low Priority Issues

1. **Token Metadata**
   - Hardcoded token list with limited coverage
   - No dynamic metadata fetching
   - Impact: Limited support for new tokens

2. **Configuration Management**
   - Limited runtime configuration updates
   - No hot-reloading of pool lists
   - Impact: Requires restart for configuration changes

## Roadmap for Production

### Phase 1: Stability and Reliability
- Implement automatic WebSocket reconnection
- Add comprehensive error handling and retry logic
- Optimize memory usage and implement cache cleanup
- Enhance test coverage for edge cases

### Phase 2: Performance and Scalability  
- Implement connection pooling for RPC requests
- Add support for private RPC endpoints
- Optimize price calculation algorithms
- Implement parallel processing for multiple DEXs

### Phase 3: Advanced Features
- Add MEV protection mechanisms
- Implement multi-hop arbitrage detection
- Add portfolio management capabilities
- Integrate with execution engines

### Phase 4: Production Hardening
- Add comprehensive monitoring and alerting
- Implement graceful degradation strategies
- Add support for multiple Solana clusters
- Enhance security and access control

## API Stability

### Stable APIs (No Breaking Changes Expected)
- `ArbitrageScanner` core interface
- `PoolLiquidity` data structure
- Event emission patterns

### Unstable APIs (Subject to Change)
- DEX parser implementations
- Oracle integration methods
- Internal configuration structures

### Deprecated APIs
- Mock data generators (removed)
- Simulation-based testing (removed)

## Deployment Considerations

### Environment Requirements
- Node.js 18+ with TypeScript support
- Stable internet connection (low latency preferred)
- Access to Solana RPC endpoints (private recommended for production)
- Minimum 4GB RAM for extended operation

### Monitoring Requirements
- WebSocket connection health monitoring
- Price feed staleness detection  
- Memory usage tracking
- Error rate monitoring

### Scaling Considerations
- Horizontal scaling requires coordination for pool monitoring
- Vertical scaling limited by single-threaded JavaScript execution
- Database integration recommended for persistent storage
- Load balancing needed for high-frequency trading

This documentation should be updated as the system evolves and new components are added. 