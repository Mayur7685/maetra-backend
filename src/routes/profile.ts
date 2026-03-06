import { Hono } from "hono";
import { db } from "../lib/db.js";
import { authMiddleware } from "../middleware/auth.js";

const profile = new Hono();
profile.use("*", authMiddleware);

// GET /api/profile/me
profile.get("/me", async (c) => {
  const { userId } = c.get("user");

  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      username: true,
      displayName: true,
      bio: true,
      xHandle: true,
      aleoAddress: true,
      subscriptionPriceMicrocredits: true,
      createdAt: true,
    },
  });

  if (!user) {
    return c.json({ error: "User not found" }, 404);
  }

  return c.json({
    user: {
      ...user,
      subscriptionPriceMicrocredits: user.subscriptionPriceMicrocredits.toString(),
    },
  });
});

// PUT /api/profile/me
profile.put("/me", async (c) => {
  const { userId } = c.get("user");
  const body = await c.req.json<{
    username?: string;
    displayName?: string;
    bio?: string;
    xHandle?: string;
    subscriptionPriceMicrocredits?: number;
  }>();

  // Validate username uniqueness if changing
  if (body.username) {
    const existing = await db.user.findUnique({
      where: { username: body.username },
    });
    if (existing && existing.id !== userId) {
      return c.json({ error: "Username already taken" }, 409);
    }
  }

  const user = await db.user.update({
    where: { id: userId },
    data: {
      ...(body.username !== undefined && { username: body.username }),
      ...(body.displayName !== undefined && { displayName: body.displayName }),
      ...(body.bio !== undefined && { bio: body.bio }),
      ...(body.xHandle !== undefined && { xHandle: body.xHandle }),
      ...(body.subscriptionPriceMicrocredits !== undefined && {
        subscriptionPriceMicrocredits: BigInt(body.subscriptionPriceMicrocredits),
      }),
    },
    select: {
      id: true,
      email: true,
      username: true,
      displayName: true,
      bio: true,
      xHandle: true,
      aleoAddress: true,
      subscriptionPriceMicrocredits: true,
    },
  });

  return c.json({
    user: {
      ...user,
      subscriptionPriceMicrocredits: user.subscriptionPriceMicrocredits.toString(),
    },
  });
});

// POST /api/profile/connect-wallet
profile.post("/connect-wallet", async (c) => {
  const { userId } = c.get("user");
  const { aleoAddress } = await c.req.json<{ aleoAddress: string }>();

  if (!aleoAddress) {
    return c.json({ error: "Aleo address is required" }, 400);
  }

  const user = await db.user.update({
    where: { id: userId },
    data: { aleoAddress },
    select: { id: true, aleoAddress: true },
  });

  return c.json({ user });
});

// POST /api/profile/connect-evm
profile.post("/connect-evm", async (c) => {
  const { userId } = c.get("user");
  const { evmWallet } = await c.req.json<{ evmWallet: string }>();

  if (!evmWallet) {
    return c.json({ error: "EVM wallet address is required" }, 400);
  }

  // In production, encrypt this before storing
  const user = await db.user.update({
    where: { id: userId },
    data: { evmWalletEncrypted: evmWallet },
    select: { id: true },
  });

  return c.json({ user, message: "EVM wallet connected" });
});

export default profile;
