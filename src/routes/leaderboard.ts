import { Hono } from "hono";
import { db } from "../lib/db.js";

const leaderboard = new Hono();

// GET /api/leaderboard?period=30D
leaderboard.get("/", async (c) => {
  const period = c.req.query("period") || "30D";

  const entries = await db.performanceCache.findMany({
    where: { period },
    orderBy: { trustScore: "desc" },
    include: {
      user: {
        select: {
          id: true,
          username: true,
          displayName: true,
          xHandle: true,
          aleoAddress: true,
          subscriptionPriceMicrocredits: true,
        },
      },
    },
  });

  const leaderboardData = entries.map((entry, index) => ({
    place: index + 1,
    userId: entry.userId,
    username: entry.user.username || entry.user.displayName || "Anonymous",
    displayName: entry.user.displayName,
    xHandle: entry.user.xHandle,
    winRate: entry.winRate ? Number(entry.winRate) : 0,
    winStreak: entry.winStreak || 0,
    trustScore: entry.trustScore ? Number(entry.trustScore) : 0,
    tradeCount: entry.tradeCount || 0,
    positionsOpened: entry.positionsOpened || 0,
    positionsClosed: entry.positionsClosed || 0,
    weightClass: entry.weightClass || "Lightweight",
    lastVerifiedAt: entry.lastVerifiedAt,
    hasAlpha: (entry.user.subscriptionPriceMicrocredits || 0n) > 0n,
    hasProfile: !!entry.user.username,
  }));

  return c.json({ leaderboard: leaderboardData, period });
});

// GET /api/creator/:username
leaderboard.get("/creator/:username", async (c) => {
  const username = c.req.param("username");

  const user = await db.user.findUnique({
    where: { username },
    select: {
      id: true,
      username: true,
      displayName: true,
      bio: true,
      xHandle: true,
      aleoAddress: true,
      subscriptionPriceMicrocredits: true,
      performanceCache: {
        where: { period: "30D" },
      },
    },
  });

  if (!user) {
    return c.json({ error: "Creator not found" }, 404);
  }

  const perf = user.performanceCache[0];

  return c.json({
    creator: {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      bio: user.bio,
      xHandle: user.xHandle,
      aleoAddress: user.aleoAddress,
      subscriptionPriceMicrocredits: user.subscriptionPriceMicrocredits?.toString(),
      winRate: perf ? Number(perf.winRate) : 0,
      winStreak: perf?.winStreak || 0,
      trustScore: perf ? Number(perf.trustScore) : 0,
      tradeCount: perf?.tradeCount || 0,
      positionsOpened: perf?.positionsOpened || 0,
      positionsClosed: perf?.positionsClosed || 0,
      weightClass: perf?.weightClass || "Lightweight",
    },
  });
});

export default leaderboard;
