import { Hono } from "hono";
import { db } from "../lib/db.js";
import { authMiddleware } from "../middleware/auth.js";
import { runProofPipeline, formatForLeo, fetchTradeMetrics } from "../lib/exchanges/pipeline.js";

const exchanges = new Hono();
exchanges.use("*", authMiddleware);

// GET /api/exchanges — list user's connected exchanges
exchanges.get("/", async (c) => {
  const { userId } = c.get("user");

  const connections = await db.exchangeConnection.findMany({
    where: { userId },
    select: {
      id: true,
      exchange: true,
      lastSyncedAt: true,
      createdAt: true,
    },
  });

  return c.json({ connections });
});

// POST /api/exchanges/connect — connect an exchange
exchanges.post("/connect", async (c) => {
  const { userId } = c.get("user");
  const body = await c.req.json<{
    exchange: string;        // "hyperliquid" | "binance"
    apiKey?: string;         // EVM address for Hyperliquid, API key for Binance
    apiSecret?: string;      // Only for Binance
  }>();

  if (!body.exchange || !["hyperliquid", "binance"].includes(body.exchange)) {
    return c.json({ error: "Invalid exchange. Use 'hyperliquid' or 'binance'" }, 400);
  }

  let apiKeyEncrypted: string;

  if (body.exchange === "hyperliquid") {
    if (!body.apiKey) {
      return c.json({ error: "EVM address is required for Hyperliquid" }, 400);
    }
    // For Hyperliquid, store the EVM address directly (read-only, no secret needed)
    apiKeyEncrypted = body.apiKey;
  } else {
    if (!body.apiKey || !body.apiSecret) {
      return c.json({ error: "API key and secret are required for Binance" }, 400);
    }
    // Store as "key:secret" — in production, encrypt this
    apiKeyEncrypted = `${body.apiKey}:${body.apiSecret}`;
  }

  // Upsert: replace existing connection for this exchange
  const existing = await db.exchangeConnection.findFirst({
    where: { userId, exchange: body.exchange },
  });

  let connection;
  if (existing) {
    connection = await db.exchangeConnection.update({
      where: { id: existing.id },
      data: { apiKeyEncrypted },
      select: { id: true, exchange: true, createdAt: true },
    });
  } else {
    connection = await db.exchangeConnection.create({
      data: { userId, exchange: body.exchange, apiKeyEncrypted },
      select: { id: true, exchange: true, createdAt: true },
    });
  }

  return c.json({ connection, message: `${body.exchange} connected` });
});

// DELETE /api/exchanges/:id — disconnect an exchange
exchanges.delete("/:id", async (c) => {
  const { userId } = c.get("user");
  const id = c.req.param("id");

  await db.exchangeConnection.deleteMany({
    where: { id, userId },
  });

  return c.json({ message: "Exchange disconnected" });
});

// POST /api/exchanges/sync — fetch trade data and update performance cache
exchanges.post("/sync", async (c) => {
  const { userId } = c.get("user");
  const body = await c.req.json<{ period?: string }>().catch(() => ({ period: undefined }));
  const period = body.period || "30D";

  const result = await runProofPipeline(userId, period);

  if (!result) {
    return c.json({ error: "No exchange connected or no trade data found" }, 404);
  }

  return c.json({
    metrics: {
      totalTrades: result.metrics.totalTrades,
      profitableTrades: result.metrics.profitableTrades,
      profitableDays: result.metrics.profitableDays,
      totalDays: result.metrics.totalDays,
      currentStreak: result.metrics.currentStreak,
      avgVolumeUsd: Math.round(result.metrics.avgVolumeUsd),
      totalPnl: Math.round(result.metrics.totalPnl * 100) / 100,
      positionsOpened: result.metrics.positionsOpened,
      positionsClosed: result.metrics.positionsClosed,
    },
    leoInputs: result.leoInputs,
    period,
  });
});

// GET /api/exchanges/proof-inputs — get formatted Leo inputs without re-syncing
exchanges.get("/proof-inputs", async (c) => {
  const { userId } = c.get("user");
  const period = c.req.query("period") || "30D";

  // Check cached performance first
  const cached = await db.performanceCache.findUnique({
    where: { userId_period: { userId, period } },
  });

  if (cached && cached.lastVerifiedAt) {
    // If cache is less than 1 hour old, return it
    const age = Date.now() - cached.lastVerifiedAt.getTime();
    if (age < 60 * 60 * 1000) {
      return c.json({
        cached: true,
        lastVerifiedAt: cached.lastVerifiedAt.toISOString(),
        performance: {
          winRate: Number(cached.winRate),
          winStreak: cached.winStreak,
          trustScore: Number(cached.trustScore),
          tradeCount: cached.tradeCount,
          positionsOpened: cached.positionsOpened,
          positionsClosed: cached.positionsClosed,
          weightClass: cached.weightClass,
        },
      });
    }
  }

  // Stale or missing — run pipeline
  const result = await runProofPipeline(userId, period);

  if (!result) {
    return c.json({ error: "No exchange data available" }, 404);
  }

  return c.json({
    cached: false,
    leoInputs: result.leoInputs,
    metrics: result.metrics,
  });
});

export default exchanges;
