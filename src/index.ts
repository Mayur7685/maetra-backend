import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { serve } from "@hono/node-server";
import { env } from "./lib/env.js";
import auth from "./routes/auth.js";
import profile from "./routes/profile.js";
import leaderboard from "./routes/leaderboard.js";
import posts from "./routes/posts.js";
import subscriptions from "./routes/subscriptions.js";
import exchanges from "./routes/exchanges.js";
import aleoRoutes from "./routes/aleo.js";
import keys from "./routes/keys.js";

const app = new Hono();

// Middleware
app.use("*", logger());
app.use(
  "*",
  cors({
    origin: process.env.CORS_ORIGINS
      ? process.env.CORS_ORIGINS.split(",")
      : ["http://localhost:3000"],
    credentials: true,
  })
);

// BigInt serialization
app.use("*", async (c, next) => {
  await next();
  // Handle BigInt in JSON responses
  const original = JSON.stringify;
  JSON.stringify = function (value, replacer, space) {
    return original(
      value,
      function (key, val) {
        if (typeof val === "bigint") return val.toString();
        if (replacer && typeof replacer === "function") return replacer(key, val);
        return val;
      },
      space
    );
  };
});

// Routes
app.route("/api/auth", auth);
app.route("/api/profile", profile);
app.route("/api/leaderboard", leaderboard);
app.route("/api/posts", posts);
app.route("/api/subscriptions", subscriptions);
app.route("/api/exchanges", exchanges);
app.route("/api/aleo", aleoRoutes);
app.route("/api/keys", keys);

// Health check
app.get("/api/health", (c) => {
  return c.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Start server
console.log(`Maetra API starting on port ${env.PORT}...`);
serve({
  fetch: app.fetch,
  port: env.PORT,
});
console.log(`Maetra API running at http://localhost:${env.PORT}`);
