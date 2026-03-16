import { Hono } from "hono";
import bcrypt from "bcryptjs";
import { db } from "../lib/db.js";
import { signToken } from "../lib/jwt.js";

const auth = new Hono();

// POST /api/auth/register
auth.post("/register", async (c) => {
  const { email, password, username } = await c.req.json<{ email: string; password: string; username: string }>();

  if (!email || !password || !username) {
    return c.json({ error: "Email, password, and username are required" }, 400);
  }

  if (password.length < 8) {
    return c.json({ error: "Password must be at least 8 characters" }, 400);
  }

  const existing = await db.user.findUnique({ where: { email } });
  if (existing) {
    return c.json({ error: "Email already registered" }, 409);
  }

  const existingUsername = await db.user.findUnique({ where: { username } });
  if (existingUsername) {
    return c.json({ error: "Username already taken" }, 409);
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await db.user.create({
    data: { email, passwordHash, username },
  });

  const token = signToken({ userId: user.id, email: user.email });

  return c.json({
    token,
    user: {
      id: user.id,
      email: user.email,
      username: user.username,
      displayName: user.displayName,
      bio: user.bio,
      xHandle: user.xHandle,
      aleoAddress: user.aleoAddress,
      subscriptionPriceMicrocredits: user.subscriptionPriceMicrocredits.toString(),
    },
  }, 201);
});

// POST /api/auth/login
auth.post("/login", async (c) => {
  const { email, password } = await c.req.json<{ email: string; password: string }>();

  if (!email || !password) {
    return c.json({ error: "Email and password are required" }, 400);
  }

  const user = await db.user.findUnique({ where: { email } });
  if (!user) {
    return c.json({ error: "Invalid email or password" }, 401);
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    return c.json({ error: "Invalid email or password" }, 401);
  }

  const token = signToken({ userId: user.id, email: user.email });

  return c.json({
    token,
    user: {
      id: user.id,
      email: user.email,
      username: user.username,
      displayName: user.displayName,
      bio: user.bio,
      xHandle: user.xHandle,
      aleoAddress: user.aleoAddress,
      subscriptionPriceMicrocredits: user.subscriptionPriceMicrocredits.toString(),
    },
  });
});

export default auth;
