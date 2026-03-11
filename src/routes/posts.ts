import { Hono } from "hono";
import { db } from "../lib/db.js";
import { authMiddleware } from "../middleware/auth.js";

const posts = new Hono();

// POST /api/posts — Create a new post (auth required)
// Content arrives pre-encrypted from the client. Server stores it as-is.
posts.post("/", authMiddleware, async (c) => {
  const { userId } = c.get("user");
  const { title, content } = await c.req.json<{ title: string; content: string }>();

  if (!title || !content) {
    return c.json({ error: "Title and content are required" }, 400);
  }

  // Store content as-is — it's already encrypted client-side with the creator's CEK.
  // The server never sees plaintext.
  const post = await db.post.create({
    data: {
      creatorId: userId,
      title,
      contentEncrypted: content,
    },
  });

  return c.json({ post }, 201);
});

// GET /api/posts/:id — Get a single post (subscription check)
// Returns ciphertext — client decrypts with CEK
posts.get("/:id", authMiddleware, async (c) => {
  const { userId } = c.get("user");
  const postId = c.req.param("id");

  const post = await db.post.findUnique({
    where: { id: postId },
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
  });

  if (!post) {
    return c.json({ error: "Post not found" }, 404);
  }

  // Creator can always see their own posts (they have the CEK to decrypt)
  if (post.creatorId === userId) {
    return c.json({ post });
  }

  // Check if user has active subscription
  const subscription = await db.subscription.findUnique({
    where: {
      subscriberId_creatorId: {
        subscriberId: userId,
        creatorId: post.creatorId,
      },
    },
  });

  if (!subscription || subscription.status !== "active") {
    return c.json({
      post: {
        id: post.id,
        title: post.title,
        creatorId: post.creatorId,
        creator: post.creator,
        publishedAt: post.publishedAt,
        locked: true,
      },
    });
  }

  // Subscriber with active access — return ciphertext (client decrypts with CEK)
  return c.json({ post });
});

// GET /api/creator/:username/posts — Get creator's posts
posts.get("/creator/:username/posts", authMiddleware, async (c) => {
  const { userId } = c.get("user");
  const username = c.req.param("username");

  const creator = await db.user.findUnique({ where: { username } });
  if (!creator) {
    return c.json({ error: "Creator not found" }, 404);
  }

  // Check subscription
  const isCreator = creator.id === userId;
  const subscription = isCreator
    ? null
    : await db.subscription.findUnique({
        where: {
          subscriberId_creatorId: {
            subscriberId: userId,
            creatorId: creator.id,
          },
        },
      });

  const hasAccess = isCreator || subscription?.status === "active";

  const creatorPosts = await db.post.findMany({
    where: { creatorId: creator.id },
    orderBy: { publishedAt: "desc" },
    select: {
      id: true,
      title: true,
      contentEncrypted: hasAccess, // Only fetch ciphertext if user has access
      publishedAt: true,
    },
  });

  return c.json({ posts: creatorPosts, hasAccess });
});

export default posts;
