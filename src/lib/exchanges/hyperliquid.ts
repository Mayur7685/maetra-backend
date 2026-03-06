// Hyperliquid API client
// Docs: https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api
// No API key needed for read-only user data — just an EVM address

const HL_API = "https://api.hyperliquid.xyz/info";

interface HlFill {
  coin: string;
  px: string;        // price
  sz: string;        // size
  side: string;      // "A" (ask/sell) or "B" (bid/buy)
  time: number;      // epoch ms
  closedPnl: string; // realized PnL for this fill
  fee: string;
  tid: number;
}

interface HlPortfolioEntry {
  accountValue: string;
  pnl: string;
}

interface HlPortfolio {
  day: HlPortfolioEntry[];
  week: HlPortfolioEntry[];
  month: HlPortfolioEntry[];
  allTime: HlPortfolioEntry[];
}

export interface TradeMetrics {
  totalTrades: number;
  profitableTrades: number;
  totalDays: number;
  profitableDays: number;
  currentStreak: number;
  avgVolumeUsd: number;       // monthly avg in USD
  totalPnl: number;
  positionsOpened: number;
  positionsClosed: number;
}

async function hlPost<T>(body: Record<string, unknown>): Promise<T> {
  const res = await fetch(HL_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`Hyperliquid API error: ${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

export async function fetchHyperliquidFills(
  evmAddress: string,
  startTime?: number,
  endTime?: number,
): Promise<HlFill[]> {
  if (startTime && endTime) {
    return hlPost<HlFill[]>({
      type: "userFillsByTime",
      user: evmAddress,
      startTime,
      endTime,
    });
  }
  return hlPost<HlFill[]>({
    type: "userFills",
    user: evmAddress,
    aggregateByTime: false,
  });
}

export async function fetchHyperliquidPortfolio(
  evmAddress: string,
): Promise<HlPortfolio> {
  return hlPost<HlPortfolio>({
    type: "portfolio",
    user: evmAddress,
  });
}

export async function computeHyperliquidMetrics(
  evmAddress: string,
  periodDays: number = 30,
): Promise<TradeMetrics> {
  const now = Date.now();
  const startTime = now - periodDays * 24 * 60 * 60 * 1000;

  const fills = await fetchHyperliquidFills(evmAddress, startTime, now);

  if (fills.length === 0) {
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

  // Group fills by day
  const dailyPnl = new Map<string, number>();
  let totalVolume = 0;
  let positionsOpened = 0;
  let positionsClosed = 0;

  for (const fill of fills) {
    const day = new Date(fill.time).toISOString().slice(0, 10);
    const pnl = parseFloat(fill.closedPnl);
    dailyPnl.set(day, (dailyPnl.get(day) || 0) + pnl);

    const vol = parseFloat(fill.px) * parseFloat(fill.sz);
    totalVolume += vol;

    // A fill with closedPnl !== "0" means a position was closed
    if (pnl !== 0) {
      positionsClosed++;
    } else {
      positionsOpened++;
    }
  }

  const profitableTrades = fills.filter(
    (f) => parseFloat(f.closedPnl) > 0
  ).length;

  const totalDays = dailyPnl.size || 1;
  const profitableDays = [...dailyPnl.values()].filter((p) => p > 0).length;
  const totalPnl = [...dailyPnl.values()].reduce((a, b) => a + b, 0);

  // Compute current win streak (consecutive profitable days, most recent first)
  const sortedDays = [...dailyPnl.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  let currentStreak = 0;
  for (const [, pnl] of sortedDays) {
    if (pnl > 0) currentStreak++;
    else break;
  }

  // Average monthly volume
  const monthsInPeriod = periodDays / 30;
  const avgVolumeUsd = totalVolume / Math.max(monthsInPeriod, 1);

  return {
    totalTrades: fills.length,
    profitableTrades,
    totalDays,
    profitableDays,
    currentStreak,
    avgVolumeUsd,
    totalPnl,
    positionsOpened,
    positionsClosed,
  };
}
