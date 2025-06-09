import Decimal from 'decimal.js';

export interface TokenInfo {
  symbol: string;
  mint: string;
  decimals: number;
  name?: string;
}

export interface TokenPair {
  tokenA: TokenInfo;
  tokenB: TokenInfo;
  id: string;
}

export interface DEXPrice {
  dex: string;
  price: Decimal;
  liquidity: Decimal;
  timestamp: number;
  source: 'direct' | 'websocket' | 'oracle' | 'aggregated';
  poolAddress?: string;
  volume24h?: Decimal;
  slippage?: number;
}

export interface DEXPriceMap {
  [dexName: string]: DEXPrice;
}

export interface PoolUpdate {
  dex: string;
  pool: string;
  price: Decimal;
  liquidity: Decimal;
  volume: Decimal;
  timestamp: number;
  lastUpdate: number;
  reserves?: {
    tokenA: Decimal;
    tokenB: Decimal;
  };
}

export interface TrueArbitrageOpportunity {
  pair: string;
  buyDex: string;
  sellDex: string;
  buyPrice: Decimal;
  sellPrice: Decimal;
  profitPercentage: Decimal;
  liquidityScore: number;
  gasEstimate: Decimal;
  netProfit: Decimal;
  executionProbability: number;
  slippageImpact: Decimal;
  totalFees: Decimal;
  minimumTradeSize: Decimal;
  maximumTradeSize: Decimal;
  confidence: number;
  timestamp: number;
}

export interface CostComponents {
  swapFeeBuy: Decimal;
  swapFeeSell: Decimal;
  gasCost: Decimal;
  slippageBuy: Decimal;
  slippageSell: Decimal;
  protocolFee: Decimal;
  mevProtection: Decimal;
}

export interface LiquidityMetrics {
  totalLiquidity: Decimal;
  liquidityDepth: Decimal;
  averageSpread: Decimal;
  volatility: number;
  tradingVolume24h: Decimal;
  numberOfTrades24h: number;
  priceImpact: number;
}

export interface ExecutionContext {
  blockNumber: number;
  gasPrice: Decimal;
  networkCongestion: number;
  mevRisk: number;
  latency: number;
  priorityFee: Decimal;
}

export type DEXName = 'Raydium' | 'Orca' | 'Phoenix' | 'Jupiter' | 'Meteora' | 'Lifinity' | 'Aldrin' | 'Saber'; 