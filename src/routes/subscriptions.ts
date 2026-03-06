import { Hono } from "hono";
import { db } from "../lib/db.js";
import { authMiddleware } from "../middleware/auth.js";

const subscriptions = new Hono();
subscriptions.use("*", authMiddleware);

// GET /api/subscriptions — List my subscriptions
subscriptions.get("/", async (c) => {
  const { userId } = c.get("user");

  const subs = await db.subscription.findMany({
    where: { subscriberId: userId },
    include: {
      creator: {
        select: {
          id: true,
          username: true,
          displayName: true,
          subscriptionPriceMicrocredits: true,
        },
      },
    },
    orderBy: { startedAt: "desc" },
  });

  return c.json({
    subscriptions: subs.map((s) => ({
      id: s.id,
      creatorId: s.creatorId,
      creatorUsername: s.creator.username,
      creatorDisplayName: s.creator.displayName,
      status: s.status,
      priceMicrocredits: s.priceMicrocredits?.toString(),
      startedAt: s.startedAt,
      expiresAt: s.expiresAt,
      aleoTxId: s.aleoTxId,
    })),
  });
});

// POST /api/subscribe/:creatorId — Subscribe to a creator
subscriptions.post("/subscribe/:creatorId", async (c) => {
  const { userId } = c.get("user");
  const creatorId = c.req.param("creatorId");
  const { aleoTxId } = await c.req.json<{ aleoTxId?: string }>();

  if (userId === creatorId) {
    return c.json({ error: "Cannot subscribe to yourself" }, 400);
  }

  const creator = await db.user.findUnique({ where: { id: creatorId } });
  if (!creator) {
    return c.json({ error: "Creator not found" }, 404);
  }

  // Check for existing subscription
  const existing = await db.subscription.findUnique({
    where: {
      subscriberId_creatorId: {
        subscriberId: userId,
        creatorId,
      },
    },
  });

  if (existing?.status === "active") {
    return c.json({ error: "Already subscribed" }, 409);
  }

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 30);

  const subscription = await db.subscription.upsert({
    where: {
      subscriberId_creatorId: {
        subscriberId: userId,
        creatorId,
      },
    },
    update: {
      status: "active",
      priceMicrocredits: creator.subscriptionPriceMicrocredits,
      startedAt: new Date(),
      expiresAt,
      aleoTxId: aleoTxId || null,
    },
    create: {
      subscriberId: userId,
      creatorId,
      status: "active",
      priceMicrocredits: creator.subscriptionPriceMicrocredits,
      expiresAt,
      aleoTxId: aleoTxId || null,
    },
  });

  return c.json({ subscription }, 201);
});

// DELETE /api/subscribe/:creatorId — Cancel subscription
subscriptions.delete("/subscribe/:creatorId", async (c) => {
  const { userId } = c.get("user");
  const creatorId = c.req.param("creatorId");

  const subscription = await db.subscription.findUnique({
    where: {
      subscriberId_creatorId: {
        subscriberId: userId,
        creatorId,
      },
    },
  });

  if (!subscription) {
    return c.json({ error: "Subscription not found" }, 404);
  }

  await db.subscription.update({
    where: { id: subscription.id },
    data: { status: "cancelled" },
  });

  return c.json({ message: "Subscription cancelled" });
});

export default subscriptions;
