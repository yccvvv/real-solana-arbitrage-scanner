import { AccountInfo, Connection, PublicKey } from '@solana/web3.js';
import Decimal from 'decimal.js';
import { PoolLiquidity, PoolHealthMetrics } from '../types';

/**
 * PhoenixPoolParser - Phoenix order book DEX parser
 * 
 * Simplified implementation that parses Phoenix order book data
 * without requiring the Phoenix SDK
 */
export class PhoenixPoolParser {
  private connection: Connection;

  constructor(connection: Connection) {
    this.connection = connection;
  }

  /**
   * Parse Phoenix order book data
   */
  async parsePoolData(
    poolAddress: string,
    accountInfo: AccountInfo<Buffer>
  ): Promise<PoolLiquidity | null> {
    try {
      const data = accountInfo.data;
      
      if (data.length < 500) {
        console.log(`⚠️ Insufficient data for Phoenix order book ${poolAddress}`);
        return null;
      }

      // Phoenix uses order book structure - simplified parsing
      const baseMint = this.readPublicKey(data, 16);
      const quoteMint = this.readPublicKey(data, 48);
      
      // Parse bids and asks totals (simplified)
      const bidsTotal = this.readU64(data, 80);
      const asksTotal = this.readU64(data, 88);

      // Get token information
      const baseToken = await this.getTokenInfo(baseMint);
      const quoteToken = await this.getTokenInfo(quoteMint);

      // Calculate reserves based on order book depth
      const baseReserve = new Decimal(bidsTotal.toString())
        .div(new Decimal(10).pow(baseToken.decimals));
      const quoteReserve = new Decimal(asksTotal.toString())
        .div(new Decimal(10).pow(quoteToken.decimals));

      // Calculate total liquidity
      const totalLiquidity = await this.calculateTotalLiquidityUSD(
        baseReserve,
        quoteReserve,
        baseToken,
        quoteToken
      );

      // Order books typically have better depth
      const liquidityDepth = this.calculateLiquidityDepth(baseReserve, quoteReserve);

      return {
        poolAddress,
        tokenA: {
          mint: baseMint,
          reserve: baseReserve,
          decimals: baseToken.decimals
        },
        tokenB: {
          mint: quoteMint,
          reserve: quoteReserve,
          decimals: quoteToken.decimals
        },
        totalLiquidity,
        liquidityDepth,
        lastUpdate: Date.now(),
        dex: 'Phoenix'
      };

    } catch (error) {
      console.error(`❌ Error parsing Phoenix order book for ${poolAddress}:`, error);
      return null;
    }
  }

  /**
   * Calculate Phoenix pool health
   */
  async calculatePoolHealth(
    poolAddress: string,
    poolData: PoolLiquidity
  ): Promise<PoolHealthMetrics> {
    try {
      const signatures = await this.connection.getSignaturesForAddress(
        new PublicKey(poolAddress),
        { limit: 100 }
      );

      const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
      const recent24h = signatures.filter(sig => 
        sig.blockTime && sig.blockTime * 1000 > dayAgo
      );

      const numberOfTrades24h = recent24h.length;
      const estimatedVolume24h = new Decimal(numberOfTrades24h * 8000); // Phoenix higher trade sizes
      
      const averageTradeSize = numberOfTrades24h > 0 
        ? estimatedVolume24h.div(numberOfTrades24h)
        : new Decimal(0);

      const liquidityUtilization = this.calculateLiquidityUtilization(poolData);
      const priceVolatility = await this.calculatePriceVolatility(poolAddress);

      const healthScore = this.calculateHealthScore(
        poolData,
        numberOfTrades24h,
        liquidityUtilization,
        priceVolatility
      );

      const lastTradeTimestamp = recent24h.length > 0 && recent24h[0].blockTime
        ? recent24h[0].blockTime * 1000
        : Date.now() - 300000;

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
      console.error(`❌ Error calculating Phoenix pool health for ${poolAddress}:`, error);
      return this.getDefaultHealthMetrics(poolAddress);
    }
  }

  /**
   * Get current price from order book
   */
  getCurrentPrice(poolData: PoolLiquidity): Decimal {
    try {
      if (poolData.tokenA.reserve.eq(0)) {
        return new Decimal(0);
      }
      
      // For order books, this is mid-price approximation
      return poolData.tokenB.reserve.div(poolData.tokenA.reserve);
    } catch (error) {
      console.error('❌ Error calculating Phoenix price:', error);
      return new Decimal(0);
    }
  }

  // ========================================
  // PRIVATE HELPER METHODS
  // ========================================

  private readPublicKey(buffer: Buffer, offset: number): string {
    return buffer.slice(offset, offset + 32).toString('hex');
  }

  private readU64(buffer: Buffer, offset: number): bigint {
    return buffer.readBigUInt64LE(offset);
  }

  private async getTokenInfo(mintAddress: string): Promise<{ symbol: string; decimals: number; price?: number }> {
    const knownTokens: { [key: string]: { symbol: string; decimals: number; price?: number } } = {
      'So11111111111111111111111111111111111111112': { symbol: 'SOL', decimals: 9, price: 85 },
      'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': { symbol: 'USDC', decimals: 6, price: 1 },
      'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB': { symbol: 'USDT', decimals: 6, price: 1 },
    };

    return knownTokens[mintAddress] || { symbol: 'UNKNOWN', decimals: 9, price: 0 };
  }

  private async calculateTotalLiquidityUSD(
    baseReserve: Decimal,
    quoteReserve: Decimal,
    baseToken: { symbol: string; decimals: number; price?: number },
    quoteToken: { symbol: string; decimals: number; price?: number }
  ): Promise<Decimal> {
    const basePrice = baseToken.price || 0;
    const quotePrice = quoteToken.price || 0;

    const baseValue = baseReserve.mul(basePrice);
    const quoteValue = quoteReserve.mul(quotePrice);

    return baseValue.add(quoteValue);
  }

  private calculateLiquidityDepth(baseReserve: Decimal, quoteReserve: Decimal): Decimal {
    const minReserve = Decimal.min(baseReserve, quoteReserve);
    return minReserve.mul(0.12); // Order books typically have good depth (12%)
  }

  private calculateLiquidityUtilization(poolData: PoolLiquidity): number {
    try {
      const reserveA = poolData.tokenA.reserve;
      const reserveB = poolData.tokenB.reserve;
      const totalValue = reserveA.add(reserveB);
      
      if (totalValue.eq(0)) return 0;
      
      const balanceRatio = Decimal.min(reserveA, reserveB).div(Decimal.max(reserveA, reserveB));
      return balanceRatio.toNumber();
    } catch (error) {
      return 0;
    }
  }

  private async calculatePriceVolatility(poolAddress: string): Promise<number> {
    try {
      const signatures = await this.connection.getSignaturesForAddress(
        new PublicKey(poolAddress),
        { limit: 20 }
      );

      const recentActivity = signatures.length;
      const volatilityEstimate = Math.min(recentActivity / 80, 0.18); // Phoenix can be more volatile
      
      return volatilityEstimate;
    } catch (error) {
      return 0.06; // Default 6%
    }
  }

  private calculateHealthScore(
    poolData: PoolLiquidity,
    numberOfTrades24h: number,
    liquidityUtilization: number,
    priceVolatility: number
  ): number {
    let score = 60; // Base score (order book advantage)

    // Liquidity scoring
    if (poolData.totalLiquidity.gte(5000000)) score += 25;
    else if (poolData.totalLiquidity.gte(2000000)) score += 20;
    else if (poolData.totalLiquidity.gte(500000)) score += 15;
    else if (poolData.totalLiquidity.gte(100000)) score += 10;

    // Trading activity (Phoenix typically has larger trades)
    if (numberOfTrades24h >= 800) score += 20;
    else if (numberOfTrades24h >= 300) score += 15;
    else if (numberOfTrades24h >= 80) score += 10;
    else if (numberOfTrades24h >= 30) score += 5;

    // Utilization bonus
    score += liquidityUtilization * 15;

    // Volatility adjustments
    if (priceVolatility > 0.15) score -= 15;
    else if (priceVolatility > 0.08) score -= 8;

    return Math.max(0, Math.min(100, score));
  }

  private getDefaultHealthMetrics(poolAddress: string): PoolHealthMetrics {
    return {
      poolAddress,
      isActive: false,
      tradingVolume24h: new Decimal(0),
      numberOfTrades24h: 0,
      averageTradeSize: new Decimal(0),
      liquidityUtilization: 0,
      priceVolatility: 0,
      lastTradeTimestamp: Date.now() - 300000,
      healthScore: 0
    };
  }
} 