// Binance API client
// Docs: https://developers.binance.com/docs/binance-spot-api-docs
// Requires API key + secret for authenticated endpoints

import crypto from "node:crypto";
import type { TradeMetrics } from "./hyperliquid.js";

const BINANCE_API = "https://api.binance.com";

interface BinanceTrade {
  id: number;
  orderId: number;
  price: string;
  qty: string;
  quoteQty: string;
  commission: string;
  commissionAsset: string;
  time: number;
  isBuyer: boolean;
  isMaker: boolean;
}

function sign(queryString: string, secret: string): string {
  return crypto
    .createHmac("sha256", secret)
    .update(queryString)
    .digest("hex");
}

export async function fetchBinanceTrades(
  apiKey: string,
  apiSecret: string,
  symbol: string,
  startTime?: number,
  endTime?: number,
  limit: number = 1000,
): Promise<BinanceTrade[]> {
  const params: Record<string, string> = {
    symbol,
    limit: limit.toString(),
    timestamp: Date.now().toString(),
  };

  if (startTime) params.startTime = startTime.toString();
  if (endTime) params.endTime = endTime.toString();

  const queryString = new URLSearchParams(params).toString();
  const signature = sign(queryString, apiSecret);

  const res = await fetch(
    `${BINANCE_API}/api/v3/myTrades?${queryString}&signature=${signature}`,
    {
      headers: { "X-MBX-APIKEY": apiKey },
    }
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Binance API error: ${res.status} ${err}`);
  }

  return res.json() as Promise<BinanceTrade[]>;
}

// Fetch trades across multiple common trading pairs
const DEFAULT_PAIRS = [
  "BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT",
  "ADAUSDT", "DOGEUSDT", "AVAXUSDT", "DOTUSDT", "MATICUSDT",
];

export async function computeBinanceMetrics(
  apiKey: string,
  apiSecret: string,
  periodDays: number = 30,
  pairs: string[] = DEFAULT_PAIRS,
): Promise<TradeMetrics> {
  const now = Date.now();
  const startTime = now - periodDays * 24 * 60 * 60 * 1000;

  // Fetch trades from all pairs in parallel
  const allTradesArrays = await Promise.allSettled(
    pairs.map((pair) =>
      fetchBinanceTrades(apiKey, apiSecret, pair, startTime, now)
    )
  );

  const allTrades: BinanceTrade[] = [];
  for (const result of allTradesArrays) {
    if (result.status === "fulfilled") {
      allTrades.push(...result.value);
    }
  }

  if (allTrades.length === 0) {
    return {
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
  }

  // Sort by time
  allTrades.sort((a, b) => a.time - b.time);

  // Group by day and compute PnL from buy/sell pairs
  // Simplified: buys are negative cost, sells are positive revenue
  const dailyPnl = new Map<string, number>();
  let totalVolume = 0;
  let buys = 0;
  let sells = 0;

  for (const trade of allTrades) {
    const day = new Date(trade.time).toISOString().slice(0, 10);
    const quoteQty = parseFloat(trade.quoteQty);
    const commission = parseFloat(trade.commission);

    totalVolume += quoteQty;

    if (trade.isBuyer) {
      // Buying: spending quote currency
      dailyPnl.set(day, (dailyPnl.get(day) || 0) - commission);
      buys++;
    } else {
      // Selling: receiving quote currency (approximate PnL from spread)
      dailyPnl.set(day, (dailyPnl.get(day) || 0) - commission);
      sells++;
    }
  }

  // For spot, true PnL requires matching buy/sell pairs per asset
  // This is a simplified version — real implementation would track cost basis
  const totalDays = dailyPnl.size || 1;
  const profitableDays = [...dailyPnl.values()].filter((p) => p > 0).length;
  const totalPnl = [...dailyPnl.values()].reduce((a, b) => a + b, 0);

  // Win streak
  const sortedDays = [...dailyPnl.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  let currentStreak = 0;
  for (const [, pnl] of sortedDays) {
    if (pnl > 0) currentStreak++;
    else break;
  }

  const monthsInPeriod = periodDays / 30;
  const avgVolumeUsd = totalVolume / Math.max(monthsInPeriod, 1);

  return {
    totalTrades: allTrades.length,
    profitableTrades: sells, // simplified: sells as "completed" trades
    totalDays,
    profitableDays,
    currentStreak,
    avgVolumeUsd,
    totalPnl,
    positionsOpened: buys,
    positionsClosed: sells,
  };
}
