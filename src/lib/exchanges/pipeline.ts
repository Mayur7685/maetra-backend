// Proof pipeline: fetch trade data → compute metrics → cache in DB → format for Leo
// This bridges exchange APIs to the maetra_trust.aleo smart contract

import { db } from "../db.js";
import { computeHyperliquidMetrics, type TradeMetrics } from "./hyperliquid.js";
import { computeBinanceMetrics } from "./binance.js";

export interface LeoTrustInputs {
  profitable_days: string;   // e.g. "23u64"
  total_days: string;        // e.g. "30u64"
  trade_count: string;       // e.g. "150u64"
  current_streak: string;    // e.g. "5u64"
  avg_volume_usd: string;    // in cents, e.g. "15000000u64" ($150K)
}

// Determine weight class from avg monthly volume (in USD)
function computeWeightClass(avgVolumeUsd: number): string {
  if (avgVolumeUsd >= 500_000) return "Heavyweight";
  if (avgVolumeUsd >= 100_000) return "Middleweight";
  return "Lightweight";
}

// Fetch metrics from the user's connected exchange
export async function fetchTradeMetrics(
  userId: string,
  periodDays: number = 30,
): Promise<TradeMetrics | null> {
  const connections = await db.exchangeConnection.findMany({
    where: { userId },
  });

  if (connections.length === 0) return null;

  // Aggregate metrics across all connected exchanges
  let combined: TradeMetrics = {
    totalTrades: 0,
    profitableTrades: 0,
    totalDays: periodDays,
    profitableDays: 0,
    currentStreak: 0,
    avgVolumeUsd: 0,
    totalPnl: 0,
    positionsOpened: 0,
    positionsClosed: 0,
  };

  for (const conn of connections) {
    try {
      let metrics: TradeMetrics;

      if (conn.exchange === "hyperliquid") {
        // Hyperliquid uses EVM address — stored in apiKeyEncrypted field
        const evmAddress = conn.apiKeyEncrypted;
        if (!evmAddress) continue;
        metrics = await computeHyperliquidMetrics(evmAddress, periodDays);
      } else if (conn.exchange === "binance") {
        // Binance needs API key:secret (stored as "key:secret")
        const parts = conn.apiKeyEncrypted?.split(":") || [];
        if (parts.length < 2) continue;
        metrics = await computeBinanceMetrics(parts[0], parts[1], periodDays);
      } else {
        continue;
      }

      // Combine metrics
      combined.totalTrades += metrics.totalTrades;
      combined.profitableTrades += metrics.profitableTrades;
      combined.profitableDays = Math.max(combined.profitableDays, metrics.profitableDays);
      combined.currentStreak = Math.max(combined.currentStreak, metrics.currentStreak);
      combined.avgVolumeUsd += metrics.avgVolumeUsd;
      combined.totalPnl += metrics.totalPnl;
      combined.positionsOpened += metrics.positionsOpened;
      combined.positionsClosed += metrics.positionsClosed;

      // Update last synced
      await db.exchangeConnection.update({
        where: { id: conn.id },
        data: { lastSyncedAt: new Date() },
      });
    } catch (err) {
      console.error(`[Pipeline] Error fetching from ${conn.exchange}:`, err);
    }
  }

  if (combined.totalTrades === 0) return null;
  return combined;
}

// Cache computed metrics in the PerformanceCache table
export async function cachePerformance(
  userId: string,
  period: string,
  metrics: TradeMetrics,
): Promise<void> {
  const winRate = metrics.totalDays > 0
    ? (metrics.profitableDays / metrics.totalDays) * 100
    : 0;

  const logVal = metrics.totalTrades > 0
    ? Math.log10(metrics.totalTrades + 1)
    : 0;
  const trustScore = (winRate * logVal) / 100;

  const weightClass = computeWeightClass(metrics.avgVolumeUsd);

  await db.performanceCache.upsert({
    where: {
      userId_period: { userId, period },
    },
    create: {
      userId,
      period,
      winRate,
      winStreak: metrics.currentStreak,
      trustScore,
      tradeCount: metrics.totalTrades,
      positionsOpened: metrics.positionsOpened,
      positionsClosed: metrics.positionsClosed,
      weightClass,
      lastVerifiedAt: new Date(),
    },
    update: {
      winRate,
      winStreak: metrics.currentStreak,
      trustScore,
      tradeCount: metrics.totalTrades,
      positionsOpened: metrics.positionsOpened,
      positionsClosed: metrics.positionsClosed,
      weightClass,
      lastVerifiedAt: new Date(),
    },
  });
}

// Format metrics as Leo program inputs for maetra_trust.aleo submit_performance
export function formatForLeo(metrics: TradeMetrics): LeoTrustInputs {
  // Convert avg volume to cents (Leo uses u64 integers)
  const avgVolCents = Math.round(metrics.avgVolumeUsd * 100);

  return {
    profitable_days: `${metrics.profitableDays}u64`,
    total_days: `${Math.max(metrics.totalDays, 1)}u64`,
    trade_count: `${metrics.totalTrades}u64`,
    current_streak: `${metrics.currentStreak}u64`,
    avg_volume_usd: `${avgVolCents}u64`,
  };
}

// Full pipeline: fetch → compute → cache → return Leo inputs
export async function runProofPipeline(
  userId: string,
  period: string = "30D",
): Promise<{ metrics: TradeMetrics; leoInputs: LeoTrustInputs } | null> {
  const periodDays = parsePeriod(period);
  const metrics = await fetchTradeMetrics(userId, periodDays);

  if (!metrics) return null;

  // Cache in DB for the leaderboard
  await cachePerformance(userId, period, metrics);

  // Format for Leo program
  const leoInputs = formatForLeo(metrics);

  return { metrics, leoInputs };
}

function parsePeriod(period: string): number {
  switch (period) {
    case "24H": return 1;
    case "7D": return 7;
    case "30D": return 30;
    case "ALL": return 365;
    default: return 30;
  }
}
