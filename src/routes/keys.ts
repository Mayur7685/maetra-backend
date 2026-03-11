import { Hono } from "hono";
import { db } from "../lib/db.js";
import { authMiddleware } from "../middleware/auth.js";

const keys = new Hono();
keys.use("*", authMiddleware);

// POST /api/keys/store — Store user's ECDH public key + encrypted private key backup
keys.post("/store", async (c) => {
  const { userId } = c.get("user");
  const { publicKey, encryptedPrivateKey } = await c.req.json<{
    publicKey: string;
    encryptedPrivateKey: string;
  }>();

  if (!publicKey || !encryptedPrivateKey) {
    return c.json({ error: "publicKey and encryptedPrivateKey are required" }, 400);
  }

  await db.user.update({
    where: { id: userId },
    data: { publicKey, encryptedPrivateKey },
  });

  return c.json({ message: "Keys stored" });
});

// GET /api/keys/my-keys — Fetch my encrypted private key backup (for cross-device recovery)
keys.get("/my-keys", async (c) => {
  const { userId } = c.get("user");

  const user = await db.user.findUnique({
    where: { id: userId },
    select: { publicKey: true, encryptedPrivateKey: true },
  });

  return c.json({
    publicKey: user?.publicKey || null,
    encryptedPrivateKey: user?.encryptedPrivateKey || null,
  });
});

// POST /api/keys/content-key — Creator stores their encrypted CEK backup
keys.post("/content-key", async (c) => {
  const { userId } = c.get("user");
  const { encryptedCek } = await c.req.json<{ encryptedCek: string }>();

  if (!encryptedCek) {
    return c.json({ error: "encryptedCek is required" }, 400);
  }

  await db.creatorContentKey.upsert({
    where: { creatorId: userId },
    update: { encryptedCek },
    create: { creatorId: userId, encryptedCek },
  });

  return c.json({ message: "Content key stored" });
});

// GET /api/keys/content-key — Creator fetches their encrypted CEK backup
keys.get("/content-key", async (c) => {
  const { userId } = c.get("user");

  const key = await db.creatorContentKey.findUnique({
    where: { creatorId: userId },
  });

  return c.json({ encryptedCek: key?.encryptedCek || null });
});

// GET /api/keys/pending-grants — Creator gets subscribers who need key grants
keys.get("/pending-grants", async (c) => {
  const { userId } = c.get("user");

  // Find active subscriptions to this creator that don't have an encrypted CEK yet
  const pending = await db.subscription.findMany({
    where: {
      creatorId: userId,
      status: "active",
      encryptedCek: null,
    },
    include: {
      subscriber: {
        select: { id: true, username: true, publicKey: true },
      },
    },
  });

  // Only return subscribers who have a public key (can receive encrypted CEK)
  const grants = pending
    .filter((s) => s.subscriber.publicKey)
    .map((s) => ({
      subscriptionId: s.id,
      subscriberId: s.subscriber.id,
      subscriberUsername: s.subscriber.username,
      subscriberPublicKey: s.subscriber.publicKey,
    }));

  return c.json({ pendingGrants: grants });
});

// POST /api/keys/grant — Creator sends encrypted CEK for a subscriber
keys.post("/grant", async (c) => {
  const { userId } = c.get("user");
  const { subscriptionId, encryptedCek } = await c.req.json<{
    subscriptionId: string;
    encryptedCek: string;
  }>();

  if (!subscriptionId || !encryptedCek) {
    return c.json({ error: "subscriptionId and encryptedCek are required" }, 400);
  }

  // Verify this subscription belongs to this creator
  const subscription = await db.subscription.findUnique({
    where: { id: subscriptionId },
  });

  if (!subscription || subscription.creatorId !== userId) {
    return c.json({ error: "Subscription not found" }, 404);
  }

  if (subscription.status !== "active") {
    return c.json({ error: "Subscription is not active" }, 400);
  }

  await db.subscription.update({
    where: { id: subscriptionId },
    data: { encryptedCek },
  });

  return c.json({ message: "Key granted" });
});

// POST /api/keys/grant-bulk — Creator sends encrypted CEKs for multiple subscribers at once
keys.post("/grant-bulk", async (c) => {
  const { userId } = c.get("user");
  const { grants } = await c.req.json<{
    grants: Array<{ subscriptionId: string; encryptedCek: string }>;
  }>();

  if (!grants || !grants.length) {
    return c.json({ error: "grants array is required" }, 400);
  }

  // Verify all subscriptions belong to this creator
  const subIds = grants.map((g) => g.subscriptionId);
  const subs = await db.subscription.findMany({
    where: { id: { in: subIds }, creatorId: userId, status: "active" },
  });

  const validIds = new Set(subs.map((s) => s.id));

  // Update each valid subscription
  let granted = 0;
  for (const grant of grants) {
    if (validIds.has(grant.subscriptionId)) {
      await db.subscription.update({
        where: { id: grant.subscriptionId },
        data: { encryptedCek: grant.encryptedCek },
      });
      granted++;
    }
  }

  return c.json({ message: `Granted ${granted} keys` });
});

// GET /api/keys/subscriber-key/:creatorId — Subscriber fetches their encrypted CEK for a creator
keys.get("/subscriber-key/:creatorId", async (c) => {
  const { userId } = c.get("user");
  const creatorId = c.req.param("creatorId");

  const subscription = await db.subscription.findUnique({
    where: {
      subscriberId_creatorId: {
        subscriberId: userId,
        creatorId,
      },
    },
    include: {
      creator: {
        select: { publicKey: true },
      },
    },
  });

  if (!subscription || subscription.status !== "active") {
    return c.json({ error: "No active subscription" }, 403);
  }

  return c.json({
    encryptedCek: subscription.encryptedCek || null,
    creatorPublicKey: subscription.creator.publicKey || null,
    pending: !subscription.encryptedCek,
  });
});

export default keys;
