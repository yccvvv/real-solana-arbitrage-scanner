import { AccountInfo, Connection, PublicKey } from '@solana/web3.js';
import Decimal from 'decimal.js';
import { PoolLiquidity, PoolHealthMetrics } from '../types';

/**
 * MeteoraPoolParser - Meteora dynamic liquidity pool parser
 * 
 * Simplified implementation that parses Meteora dynamic pools
 * without requiring the Meteora SDK
 */
export class MeteoraPoolParser {
  private connection: Connection;

  constructor(connection: Connection) {
    this.connection = connection;
  }

  /**
   * Parse Meteora dynamic pool data
   */
  async parsePoolData(
    poolAddress: string,
    accountInfo: AccountInfo<Buffer>
  ): Promise<PoolLiquidity | null> {
    try {
      const data = accountInfo.data;
      
      if (data.length < 400) {
        console.log(`⚠️ Insufficient data for Meteora pool ${poolAddress}`);
        return null;
      }

      // Meteora dynamic pool structure - simplified parsing
      const tokenAMint = this.readPublicKey(data, 8);
      const tokenBMint = this.readPublicKey(data, 40);
      
      // Parse dynamic reserves
      const tokenAReserve = this.readU64(data, 72);
      const tokenBReserve = this.readU64(data, 80);
      
      // Parse fee information (Meteora has dynamic fees)
      const feeRate = this.readU32(data, 88) / 1000000; // Convert from basis points

      // Get token information
      const tokenAInfo = await this.getTokenInfo(tokenAMint);
      const tokenBInfo = await this.getTokenInfo(tokenBMint);

      // Calculate reserves with proper decimals
      const reserveA = new Decimal(tokenAReserve.toString())
        .div(new Decimal(10).pow(tokenAInfo.decimals));
      const reserveB = new Decimal(tokenBReserve.toString())
        .div(new Decimal(10).pow(tokenBInfo.decimals));

      // Calculate total liquidity
      const totalLiquidity = await this.calculateTotalLiquidityUSD(
        reserveA,
        reserveB,
        tokenAInfo,
        tokenBInfo
      );

      // Dynamic pools have variable depth based on market conditions
      const liquidityDepth = this.calculateDynamicLiquidityDepth(reserveA, reserveB, feeRate);

      return {
        poolAddress,
        tokenA: {
          mint: tokenAMint,
          reserve: reserveA,
          decimals: tokenAInfo.decimals
        },
        tokenB: {
          mint: tokenBMint,
          reserve: reserveB,
          decimals: tokenBInfo.decimals
        },
        totalLiquidity,
        liquidityDepth,
        lastUpdate: Date.now(),
        dex: 'Meteora'
      };

    } catch (error) {
      console.error(`❌ Error parsing Meteora pool for ${poolAddress}:`, error);
      return null;
    }
  }

  /**
   * Calculate Meteora pool health
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
      const estimatedVolume24h = new Decimal(numberOfTrades24h * 4000); // Meteora medium trade sizes
      
      const averageTradeSize = numberOfTrades24h > 0 
        ? estimatedVolume24h.div(numberOfTrades24h)
        : new Decimal(0);

      const liquidityUtilization = this.calculateLiquidityUtilization(poolData);
      const priceVolatility = await this.calculatePriceVolatility(poolAddress);
      const dynamicEfficiency = this.calculateDynamicEfficiency(poolData);

      const healthScore = this.calculateHealthScore(
        poolData,
        numberOfTrades24h,
        liquidityUtilization,
        priceVolatility,
        dynamicEfficiency
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
      console.error(`❌ Error calculating Meteora pool health for ${poolAddress}:`, error);
      return this.getDefaultHealthMetrics(poolAddress);
    }
  }

  /**
   * Get current price with dynamic adjustment
   */
  getCurrentPrice(poolData: PoolLiquidity): Decimal {
    try {
      if (poolData.tokenA.reserve.eq(0)) {
        return new Decimal(0);
      }
      
      // Base price from reserves
      const basePrice = poolData.tokenB.reserve.div(poolData.tokenA.reserve);
      
      // Apply dynamic adjustment based on utilization
      const utilization = this.calculateLiquidityUtilization(poolData);
      const dynamicFactor = 1 + (utilization * 0.02); // Up to 2% adjustment
      
      return basePrice.mul(dynamicFactor);
    } catch (error) {
      console.error('❌ Error calculating Meteora price:', error);
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

  private readU32(buffer: Buffer, offset: number): number {
    return buffer.readUInt32LE(offset);
  }

  private async getTokenInfo(mintAddress: string): Promise<{ symbol: string; decimals: number; price?: number }> {
    const knownTokens: { [key: string]: { symbol: string; decimals: number; price?: number } } = {
      'So11111111111111111111111111111111111111112': { symbol: 'SOL', decimals: 9, price: 85 },
      'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': { symbol: 'USDC', decimals: 6, price: 1 },
      'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB': { symbol: 'USDT', decimals: 6, price: 1 },
      'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So': { symbol: 'mSOL', decimals: 9, price: 90 },
    };

    return knownTokens[mintAddress] || { symbol: 'UNKNOWN', decimals: 9, price: 0 };
  }

  private async calculateTotalLiquidityUSD(
    reserveA: Decimal,
    reserveB: Decimal,
    tokenAInfo: { symbol: string; decimals: number; price?: number },
    tokenBInfo: { symbol: string; decimals: number; price?: number }
  ): Promise<Decimal> {
    const priceA = tokenAInfo.price || 0;
    const priceB = tokenBInfo.price || 0;

    const valueA = reserveA.mul(priceA);
    const valueB = reserveB.mul(priceB);

    return valueA.add(valueB);
  }

  private calculateDynamicLiquidityDepth(reserveA: Decimal, reserveB: Decimal, feeRate: number): Decimal {
    const minReserve = Decimal.min(reserveA, reserveB);
    
    // Dynamic depth adjusts based on fee rate
    // Lower fees = higher depth allowance
    const feeAdjustment = Math.max(0.05, 0.15 - feeRate * 10);
    
    return minReserve.mul(feeAdjustment);
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
      // Meteora's dynamic nature may increase volatility
      const volatilityEstimate = Math.min(recentActivity / 90, 0.16);
      
      return volatilityEstimate;
    } catch (error) {
      return 0.07; // Default 7%
    }
  }

  private calculateDynamicEfficiency(poolData: PoolLiquidity): number {
    // Calculate how well the dynamic pool is performing
    const utilization = this.calculateLiquidityUtilization(poolData);
    const balanceScore = Math.min(utilization * 2, 1); // Reward balanced pools
    
    // Factor in liquidity size
    const liquidityScore = poolData.totalLiquidity.gte(1000000) ? 1 : 
                          poolData.totalLiquidity.div(1000000).toNumber();
    
    return (balanceScore + liquidityScore) / 2;
  }

  private calculateHealthScore(
    poolData: PoolLiquidity,
    numberOfTrades24h: number,
    liquidityUtilization: number,
    priceVolatility: number,
    dynamicEfficiency: number
  ): number {
    let score = 52; // Base score for dynamic pools

    // Liquidity scoring
    if (poolData.totalLiquidity.gte(8000000)) score += 28;
    else if (poolData.totalLiquidity.gte(3000000)) score += 22;
    else if (poolData.totalLiquidity.gte(1000000)) score += 18;
    else if (poolData.totalLiquidity.gte(200000)) score += 12;

    // Trading activity
    if (numberOfTrades24h >= 400) score += 18;
    else if (numberOfTrades24h >= 150) score += 14;
    else if (numberOfTrades24h >= 40) score += 9;
    else if (numberOfTrades24h >= 15) score += 4;

    // Dynamic efficiency bonus
    score += dynamicEfficiency * 12;

    // Utilization bonus
    score += liquidityUtilization * 8;

    // Volatility adjustments
    if (priceVolatility > 0.12) score -= 12;
    else if (priceVolatility > 0.07) score -= 6;

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