import { AccountInfo, Connection, PublicKey } from '@solana/web3.js';
import { Liquidity, LiquidityPoolKeys, Token, TokenAmount } from '@raydium-io/raydium-sdk';
import Decimal from 'decimal.js';
import { PoolLiquidity, PoolHealthMetrics } from '../types';

/**
 * RaydiumPoolParser - Real Raydium AMM pool data parsing
 * 
 * Uses the official Raydium SDK to parse actual pool account data
 * Supports Raydium v4 AMM pools with real-time state tracking
 */
export class RaydiumPoolParser {
  private connection: Connection;

  constructor(connection: Connection) {
    this.connection = connection;
  }

  /**
   * Parse Raydium pool account data into structured format
   */
  async parsePoolData(
    poolAddress: string,
    accountInfo: AccountInfo<Buffer>
  ): Promise<PoolLiquidity | null> {
    try {
      // Parse the raw account data using Raydium SDK
      const poolState = Liquidity.decode(accountInfo.data);
      
      if (!poolState) {
        console.log(`⚠️ Could not decode Raydium pool data for ${poolAddress}`);
        return null;
      }

      // Get token information
      const baseToken = await this.getTokenInfo(poolState.baseMint);
      const quoteToken = await this.getTokenInfo(poolState.quoteMint);

      if (!baseToken || !quoteToken) {
        console.log(`⚠️ Could not fetch token info for pool ${poolAddress}`);
        return null;
      }

      // Calculate reserves with proper decimals
      const baseReserve = new Decimal(poolState.baseReserve.toString())
        .div(new Decimal(10).pow(baseToken.decimals));
      const quoteReserve = new Decimal(poolState.quoteReserve.toString())
        .div(new Decimal(10).pow(quoteToken.decimals));

      // Calculate total liquidity in USD
      const totalLiquidity = await this.calculateTotalLiquidityUSD(
        baseReserve,
        quoteReserve,
        baseToken,
        quoteToken
      );

      // Calculate available liquidity depth (tradeable amount without high slippage)
      const liquidityDepth = this.calculateLiquidityDepth(baseReserve, quoteReserve);

      return {
        poolAddress,
        tokenA: {
          mint: poolState.baseMint.toString(),
          reserve: baseReserve,
          decimals: baseToken.decimals
        },
        tokenB: {
          mint: poolState.quoteMint.toString(),
          reserve: quoteReserve,
          decimals: quoteToken.decimals
        },
        totalLiquidity,
        liquidityDepth,
        lastUpdate: Date.now(),
        dex: 'Raydium'
      };

    } catch (error) {
      console.error(`❌ Error parsing Raydium pool data for ${poolAddress}:`, error);
      return null;
    }
  }

  /**
   * Calculate pool health metrics from current state
   */
  async calculatePoolHealth(
    poolAddress: string,
    poolData: PoolLiquidity
  ): Promise<PoolHealthMetrics> {
    try {
      // Get recent pool transactions for volume analysis
      const signatures = await this.connection.getSignaturesForAddress(
        new PublicKey(poolAddress),
        { limit: 100 }
      );

      // Calculate 24h metrics
      const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
      const recent24h = signatures.filter(sig => 
        sig.blockTime && sig.blockTime * 1000 > dayAgo
      );

      const numberOfTrades24h = recent24h.length;
      
      // Estimate volume (this would need more sophisticated analysis in production)
      const estimatedVolume24h = new Decimal(numberOfTrades24h * 5000); // Rough estimate
      
      const averageTradeSize = numberOfTrades24h > 0 
        ? estimatedVolume24h.div(numberOfTrades24h)
        : new Decimal(0);

      // Calculate liquidity utilization based on reserve balance
      const liquidityUtilization = this.calculateLiquidityUtilization(poolData);

      // Calculate price volatility (simplified)
      const priceVolatility = await this.calculatePriceVolatility(poolAddress);

      // Calculate overall health score (0-100)
      const healthScore = this.calculateHealthScore(
        poolData,
        numberOfTrades24h,
        liquidityUtilization,
        priceVolatility
      );

      const lastTradeTimestamp = recent24h.length > 0 && recent24h[0].blockTime
        ? recent24h[0].blockTime * 1000
        : Date.now() - 300000; // Default to 5 minutes ago

      return {
        poolAddress,
        isActive: numberOfTrades24h > 0,
        tradingVolume24h: estimatedVolume24h,
        numberOfTrades24h,
        averageTradeSize,
        liquidityUtilization,
        priceVolatility,
        lastTradeTimestamp,
        healthScore
      };

    } catch (error) {
      console.error(`❌ Error calculating pool health for ${poolAddress}:`, error);
      return this.getDefaultHealthMetrics(poolAddress);
    }
  }

  /**
   * Get current pool price from reserves
   */
  getCurrentPrice(poolData: PoolLiquidity): Decimal {
    try {
      // Price = quote_reserve / base_reserve (assuming base is the asset we're pricing)
      if (poolData.tokenA.reserve.eq(0)) {
        return new Decimal(0);
      }
      
      return poolData.tokenB.reserve.div(poolData.tokenA.reserve);
    } catch (error) {
      console.error('❌ Error calculating current price:', error);
      return new Decimal(0);
    }
  }

  /**
   * Get token information from mint address
   */
  private async getTokenInfo(mint: PublicKey): Promise<{ symbol: string; decimals: number } | null> {
    try {
      // Try to get token info from a known token list or on-chain data
      const mintInfo = await this.connection.getParsedAccountInfo(mint);
      
      if (mintInfo.value?.data && 'parsed' in mintInfo.value.data) {
        const parsedData = mintInfo.value.data.parsed;
        if (parsedData.type === 'mint') {
          return {
            symbol: this.getTokenSymbolFromMint(mint.toString()),
            decimals: parsedData.info.decimals
          };
        }
      }

      // Fallback to known tokens
      return this.getKnownTokenInfo(mint.toString());
    } catch (error) {
      console.error(`❌ Error fetching token info for ${mint.toString()}:`, error);
      return this.getKnownTokenInfo(mint.toString());
    }
  }

  /**
   * Get known token information
   */
  private getKnownTokenInfo(mintAddress: string): { symbol: string; decimals: number } | null {
    const knownTokens: { [key: string]: { symbol: string; decimals: number } } = {
      'So11111111111111111111111111111111111111112': { symbol: 'SOL', decimals: 9 },
      'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': { symbol: 'USDC', decimals: 6 },
      'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB': { symbol: 'USDT', decimals: 6 },
      'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So': { symbol: 'mSOL', decimals: 9 },
      'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn': { symbol: 'jitoSOL', decimals: 9 },
      '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU': { symbol: 'SAMO', decimals: 9 },
    };

    return knownTokens[mintAddress] || { symbol: 'UNKNOWN', decimals: 9 };
  }

  /**
   * Get token symbol from mint address
   */
  private getTokenSymbolFromMint(mintAddress: string): string {
    const tokenInfo = this.getKnownTokenInfo(mintAddress);
    return tokenInfo?.symbol || 'UNKNOWN';
  }

  /**
   * Calculate total liquidity in USD
   */
  private async calculateTotalLiquidityUSD(
    baseReserve: Decimal,
    quoteReserve: Decimal,
    baseToken: { symbol: string; decimals: number },
    quoteToken: { symbol: string; decimals: number }
  ): Promise<Decimal> {
    try {
      // Simplified USD calculation - in production, you'd use real price feeds
      const prices: { [key: string]: number } = {
        'SOL': 85,     // SOL price in USD
        'USDC': 1,     // USDC is $1
        'USDT': 1,     // USDT is $1
        'mSOL': 90,    // mSOL premium
        'jitoSOL': 88, // jitoSOL price
        'SAMO': 0.02,  // SAMO price
      };

      const basePrice = prices[baseToken.symbol] || 0;
      const quotePrice = prices[quoteToken.symbol] || 0;

      const baseValueUSD = baseReserve.mul(basePrice);
      const quoteValueUSD = quoteReserve.mul(quotePrice);

      return baseValueUSD.add(quoteValueUSD);
    } catch (error) {
      console.error('❌ Error calculating total liquidity USD:', error);
      return new Decimal(0);
    }
  }

  /**
   * Calculate available liquidity depth
   */
  private calculateLiquidityDepth(baseReserve: Decimal, quoteReserve: Decimal): Decimal {
    // Simplified calculation - use 10% of smaller reserve as tradeable depth
    const minReserve = Decimal.min(baseReserve, quoteReserve);
    return minReserve.mul(0.1);
  }

  /**
   * Calculate liquidity utilization
   */
  private calculateLiquidityUtilization(poolData: PoolLiquidity): number {
    try {
      const baseValue = poolData.tokenA.reserve;
      const quoteValue = poolData.tokenB.reserve;
      const totalValue = baseValue.add(quoteValue);
      
      if (totalValue.eq(0)) return 0;
      
      // Calculate balance ratio (how balanced the pool is)
      const balanceRatio = Decimal.min(baseValue, quoteValue).div(Decimal.max(baseValue, quoteValue));
      
      // Higher balance ratio = better utilization
      return balanceRatio.toNumber();
    } catch (error) {
      console.error('❌ Error calculating liquidity utilization:', error);
      return 0;
    }
  }

  /**
   * Calculate price volatility (simplified)
   */
  private async calculatePriceVolatility(poolAddress: string): Promise<number> {
    try {
      // In production, you'd analyze price history over time
      // For now, return a reasonable estimate based on trading activity
      const signatures = await this.connection.getSignaturesForAddress(
        new PublicKey(poolAddress),
        { limit: 20 }
      );

      // More recent activity = potentially higher volatility
      const recentActivity = signatures.length;
      const volatilityEstimate = Math.min(recentActivity / 100, 0.15); // Cap at 15%
      
      return volatilityEstimate;
    } catch (error) {
      console.error('❌ Error calculating price volatility:', error);
      return 0.05; // Default 5%
    }
  }

  /**
   * Calculate overall health score
   */
  private calculateHealthScore(
    poolData: PoolLiquidity,
    numberOfTrades24h: number,
    liquidityUtilization: number,
    priceVolatility: number
  ): number {
    let score = 50; // Base score

    // Liquidity factor (0-30 points)
    if (poolData.totalLiquidity.gte(10000000)) score += 30; // $10M+
    else if (poolData.totalLiquidity.gte(5000000)) score += 25; // $5M+
    else if (poolData.totalLiquidity.gte(1000000)) score += 20; // $1M+
    else if (poolData.totalLiquidity.gte(500000)) score += 15; // $500k+
    else if (poolData.totalLiquidity.gte(100000)) score += 10; // $100k+

    // Trading activity factor (0-20 points)
    if (numberOfTrades24h >= 1000) score += 20;
    else if (numberOfTrades24h >= 500) score += 15;
    else if (numberOfTrades24h >= 100) score += 10;
    else if (numberOfTrades24h >= 50) score += 5;

    // Utilization factor (0-20 points)
    score += liquidityUtilization * 20;

    // Volatility penalty (reduce score for high volatility)
    if (priceVolatility > 0.1) score -= 10; // High volatility penalty
    else if (priceVolatility > 0.05) score -= 5; // Medium volatility penalty

    return Math.max(0, Math.min(100, score));
  }

  /**
   * Get default health metrics for error cases
   */
  private getDefaultHealthMetrics(poolAddress: string): PoolHealthMetrics {
    return {
      poolAddress,
      isActive: false,
      tradingVolume24h: new Decimal(0),
      numberOfTrades24h: 0,
      averageTradeSize: new Decimal(0),
      liquidityUtilization: 0,
      priceVolatility: 0,
      lastTradeTimestamp: Date.now() - 300000, // 5 minutes ago
      healthScore: 0
    };
  }
} 