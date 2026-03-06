import { Hono } from "hono";
import { authMiddleware } from "../middleware/auth.js";
import { aleo } from "../lib/aleo.js";

const aleoRoutes = new Hono();

// POST /api/aleo/set-price — Execute set_price on-chain
aleoRoutes.post("/set-price", authMiddleware, async (c) => {
  const { price } = await c.req.json<{ price: number }>();

  if (!price || price <= 0) {
    return c.json({ error: "Invalid price" }, 400);
  }

  try {
    const result = await aleo.setPrice(price);
    return c.json({ transactionId: result.transactionId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: msg }, 500);
  }
});

// POST /api/aleo/publish — Execute publish on-chain
aleoRoutes.post("/publish", authMiddleware, async (c) => {
  const { postId, contentHash } = await c.req.json<{
    postId: string;
    contentHash: string;
  }>();

  if (!postId || !contentHash) {
    return c.json({ error: "postId and contentHash required" }, 400);
  }

  try {
    const result = await aleo.publishContent(postId, contentHash);
    return c.json({ transactionId: result.transactionId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: msg }, 500);
  }
});

// POST /api/aleo/submit-performance — Execute submit_performance on-chain
aleoRoutes.post("/submit-performance", authMiddleware, async (c) => {
  const { leoInputs } = await c.req.json<{
    leoInputs: {
      profitable_days: string;
      total_days: string;
      trade_count: string;
      current_streak: string;
      avg_volume_usd: string;
    };
  }>();

  if (!leoInputs) {
    return c.json({ error: "leoInputs required" }, 400);
  }

  try {
    const result = await aleo.submitPerformance(leoInputs);
    return c.json({ transactionId: result.transactionId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: msg }, 500);
  }
});

export default aleoRoutes;
