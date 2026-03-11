# Maetra Backend

REST API for the Maetra privacy-preserving trading reputation platform. Built with Hono, Prisma 7, and PostgreSQL.

**Production**: 

---

## Tech Stack

| Technology | Version | Purpose |
|-----------|---------|---------|
| Hono | 4.x | HTTP framework |
| Prisma | 7.x | ORM + query builder |
| PostgreSQL | 15+ | Database |
| tsx | 4.x | TypeScript runtime (dev + prod) |
| JSON Web Token | 9.x | Authentication |
| bcryptjs | 3.x | Password hashing |

---

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Set up environment
cp .env.example .env
# Edit .env with your database URL and JWT secret

# 3. Generate Prisma client
npm run build

# 4. Push schema to database
npm run db:push

# 5. Start dev server (hot reload)
npm run dev
```

The API runs on `http://localhost:3002` by default.

---

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server with hot reload (tsx watch) |
| `npm run build` | Generate Prisma client |
| `npm start` | Start production server (tsx) |
| `npm run db:generate` | Regenerate Prisma client |
| `npm run db:push` | Push schema changes to database |
| `npm run db:migrate` | Create and apply migration |
| `npm run db:studio` | Open Prisma Studio GUI |

---

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | Yes | - | PostgreSQL connection string |
| `JWT_SECRET` | Yes | `maetra-dev-secret` | JWT signing secret (use a strong key in production) |
| `PORT` | No | `3001` | Server port |
| `CORS_ORIGINS` | No | `http://localhost:3000` | Comma-separated allowed origins |

**Production values on Render:**

```env
DATABASE_URL=postgresql://user:pass@host:5432/maetra
JWT_SECRET=<generated-secret>
PORT=3002
CORS_ORIGINS=https://maetra.vercel.app
```

---

## Project Structure

```
maetra-backend/
  prisma/
    schema.prisma          Schema definition (5 models)
    prisma.config.ts       Prisma config
  generated/
    prisma/                Auto-generated Prisma client (gitignored)
  src/
    index.ts               App entry point, middleware, route mounting
    lib/
      db.ts                Prisma client instance (pg adapter)
      env.ts               Environment variable loader
      jwt.ts               JWT sign/verify helpers
      exchanges/
        pipeline.ts        Exchange data fetching + Leo input formatting
    middleware/
      auth.ts              JWT auth middleware
    routes/
      auth.ts              Register, login
      profile.ts           User profile CRUD, wallet connection
      leaderboard.ts       Public leaderboard + creator profiles
      posts.ts             Content creation + gated access
      subscriptions.ts     Subscribe, cancel, list subscriptions
      exchanges.ts         Exchange connection, sync, mock data
      aleo.ts              On-chain transaction helpers
```

---

## API Endpoints

Base URL: `https://maetra-api.onrender.com`

### Authentication

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/auth/register` | No | Create account (email + password) |
| POST | `/api/auth/login` | No | Login, returns JWT token |

### Profile

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/profile/me` | Yes | Get current user profile |
| PUT | `/api/profile/me` | Yes | Update profile (username, bio, price) |
| POST | `/api/profile/connect-wallet` | Yes | Save Aleo wallet address |
| POST | `/api/profile/connect-evm` | Yes | Save EVM wallet address |

### Leaderboard

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/leaderboard?period=30D` | No | Get ranked traders |
| GET | `/api/leaderboard/creator/:username` | No | Get creator profile + stats |

### Posts (Alpha Content)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/posts` | Yes | Create a new post |
| GET | `/api/posts/:id` | Yes | Get post (subscription gated) |
| GET | `/api/posts/creator/:username/posts` | Yes | List creator's posts |

Content gating logic:
- Creator always sees their own posts
- Subscribers with `status: "active"` see full content
- Others see title only with `locked: true`

### Subscriptions

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/subscriptions` | Yes | List my subscriptions |
| POST | `/api/subscriptions/subscribe/:creatorId` | Yes | Subscribe (with optional Aleo tx ID) |
| DELETE | `/api/subscriptions/subscribe/:creatorId` | Yes | Cancel subscription |

### Exchanges

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/exchanges` | Yes | List connected exchanges |
| POST | `/api/exchanges/connect` | Yes | Connect exchange API key |
| DELETE | `/api/exchanges/:id` | Yes | Disconnect exchange |
| POST | `/api/exchanges/sync` | Yes | Fetch + cache trade metrics |
| GET | `/api/exchanges/proof-inputs?period=30D` | Yes | Get cached Leo program inputs |
| POST | `/api/exchanges/mock-sync` | Yes | Generate demo trade data |

### Aleo On-Chain

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/aleo/set-price` | Yes | Record subscription price on-chain |
| POST | `/api/aleo/publish` | Yes | Record content hash on-chain |
| POST | `/api/aleo/submit-performance` | Yes | Submit trust score proof on-chain |

### Health

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/health` | No | Health check |

**Total: 22 endpoints** (18 authenticated, 4 public)

---

## Database Schema

5 models in PostgreSQL:

```
users                 — Email, password hash, Aleo address, profile, subscription price
performance_cache     — Cached trust scores per period (mirrors Aleo on-chain data)
posts                 — Alpha content (encrypted), content hash, Aleo post ID
subscriptions         — Subscriber-creator relationships, status, Aleo tx ID
exchange_connections  — Exchange API keys, sync timestamps
```

Key relationships:
- User -> Posts (one-to-many)
- User -> Subscriptions (many-to-many via subscriber/creator)
- User -> ExchangeConnections (one-to-many)
- User -> PerformanceCache (one-to-many, keyed by period)

---

## Authentication Flow

1. User registers with email + password (bcrypt hashed)
2. Server returns a JWT token (7-day expiry)
3. Client sends `Authorization: Bearer <token>` on every request
4. `authMiddleware` verifies token and injects `userId` into context

---

## Data Privacy

The backend is a **performance layer** — not the source of truth for reputation.

| Data | Stored In | Privacy |
|------|-----------|---------|
| Trust scores | PostgreSQL (cache) + Aleo (source of truth) | Public |
| Raw trade metrics | Never stored — private ZK inputs | Hidden |
| Subscription records | PostgreSQL + Aleo private records | Subscriber identity hidden on-chain |
| Content body | PostgreSQL (encrypted column) | Gated by subscription |
| Content hashes | Aleo on-chain | Public (timestamp proof) |
| Passwords | PostgreSQL (bcrypt hash) | Irreversible |
| Exchange API keys | PostgreSQL | Server-only access |



