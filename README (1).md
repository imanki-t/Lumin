<div align="center">

```
██╗     ██╗   ██╗███╗   ███╗██╗███╗   ██╗
██║     ██║   ██║████╗ ████║██║████╗  ██║
██║     ██║   ██║██╔████╔██║██║██╔██╗ ██║
██║     ██║   ██║██║╚██╔╝██║██║██║╚██╗██║
███████╗╚██████╔╝██║ ╚═╝ ██║██║██║ ╚████║
╚══════╝ ╚═════╝ ╚═╝     ╚═╝╚═╝╚═╝  ╚═══╝
```

**An intelligent Discord bot powered by Google Gemini AI**  
*RAG memory · multi-key rotation · real-time admin dashboard*

[![Node.js](https://img.shields.io/badge/Node.js-20%2B-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![Discord.js](https://img.shields.io/badge/Discord.js-v14-5865F2?style=flat-square&logo=discord&logoColor=white)](https://discord.js.org)
[![MongoDB](https://img.shields.io/badge/MongoDB-Atlas-47A248?style=flat-square&logo=mongodb&logoColor=white)](https://mongodb.com)
[![Gemini](https://img.shields.io/badge/Google-Gemini_AI-4285F4?style=flat-square&logo=google&logoColor=white)](https://ai.google.dev)
[![License](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)

</div>

---

## What is Lumin?

Lumin is a full-featured AI Discord bot built on Google Gemini. It maintains persistent per-user and per-server conversation memory using a RAG (Retrieval-Augmented Generation) pipeline, supports file and image analysis, and ships with a real-time admin dashboard secured via Google OAuth.

---

## Features

### AI & Conversation
- **Persistent Memory** — RAG pipeline with MongoDB Atlas Vector Search. Lumin retrieves semantically relevant past messages before every response using 3072-dimensional embeddings (`gemini-embedding-2-preview`).
- **Multi-Model Support** — Users can switch between Gemini 3 Flash, Gemini 2.5 Pro, Gemini 2.0 Flash, and more from their personal settings.
- **Multi-Key Rotation** — Supports unlimited Gemini API keys (`GOOGLE_API_KEY1`, `GOOGLE_API_KEY2`, …) with automatic rate-limit detection and per-key cooldowns.
- **File & Image Analysis** — Attach PDFs, images, and documents directly in chat. Lumin processes them via the Gemini Files API.
- **Custom Personalities** — Each user and server can set a custom system prompt that shapes how Lumin responds.
- **Response Formats** — Toggle between plain text, markdown, or embed-based responses per user.

### Slash Commands

| Command | Description |
|---|---|
| `/settings` | Open the full user/server settings dashboard |
| `/search` | AI-powered web search with optional file attachment |
| `/summary` | Summarize a Discord conversation or YouTube video |
| `/reminder` | Set one-time, daily, weekly, or monthly reminders |
| `/birthday` | Track and announce server birthdays |
| `/quote` | Daily inspirational quotes |
| `/digest` | AI-generated weekly summary of server activity |
| `/compliment` | Send anonymous compliments to other users |
| `/roulette` | Bot randomly reacts to messages in a channel |
| `/realive` | Auto-send messages to revive inactive channels |
| `/anniversary` | View bot's server anniversary info |
| `/starter` | Generate conversation starters |
| `/timezone` | Set your timezone for time-based features |

### Admin Dashboard (LuminDash)
- Live at `/dashboard` on your deployment URL
- Google OAuth login — only authorized accounts can access
- reCAPTCHA v3 bot protection running silently in the background
- Real-time stats via WebSocket (1-second updates): ping, memory, uptime, server count
- Live Node.js REPL — execute code directly on the running instance
- Live MongoDB shell — query your database in-browser
- 25 admin commands: blacklist users, broadcast announcements, force saves, API key stats, set presence, send DMs, purge memory, and more
- Global lockdown toggle — stop the bot from responding across all servers instantly

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 20+ (ESM) |
| Discord | Discord.js v14 |
| AI | Google Gemini (`@google/genai`) |
| Database | MongoDB Atlas |
| Vector Search | MongoDB Atlas Vector Search |
| Caching | Redis (optional, falls back gracefully) |
| Dashboard | Express.js + native WebSocket |
| Auth | Google OAuth 2.0 + reCAPTCHA v3 |
| Hosting | Render |

---

## Project Structure

```
lumin/
├── index.js                    # Entry point — Discord client + Express server
├── commands.js                 # Slash command definitions
├── config.js                   # Bot configuration constants
├── database.js                 # Database shim (re-exports from database/)
│
├── managers/
│   ├── BotManager.js           # Initialization, state, Gemini client proxy
│   ├── ApiKeyManager.js        # Multi-key rotation + rate-limit tracking
│   └── StateManager.js         # State persistence + DB load/save
│
├── modules/
│   ├── message/                # Message processing pipeline
│   ├── settings/               # User & server settings UI (Discord embeds)
│   └── shared/                 # Embed builders, utilities
│
├── commands/
│   ├── birthday/               # Birthday tracking & announcements
│   ├── reminder/               # Reminder system (once/daily/weekly/monthly)
│   ├── fun/                    # Digest, quote, compliment, roulette, realive
│   ├── summary/                # Conversation & YouTube summarization
│   └── timezone/               # Timezone management
│
├── memory/
│   ├── MemorySystem.js         # RAG pipeline facade
│   ├── EmbeddingService.js     # Gemini embeddings + MRL (3072-dim)
│   ├── ClusterEngine.js        # K-means clustering for fast vector search
│   ├── MemoryStore.js          # Background indexing
│   ├── MemoryCache.js          # L1/L2 semantic cache
│   └── RedisCache.js           # L3 Redis cache
│
├── database/
│   ├── connection.js           # MongoDB connection + collection registry
│   ├── index.js                # Barrel export
│   └── collections/
│       ├── settingsRepo.js     # User & server settings
│       ├── historyRepo.js      # Chat history
│       ├── usageRepo.js        # Usage tracking (images, quotes, summaries)
│       ├── reminderRepo.js     # Reminders & birthdays
│       └── vectorSearch.js     # Atlas Vector Search queries
│
├── core/
│   └── Logger.js               # Structured logger with file sink support
│
└── dashboard/
    ├── server.js               # Express router + OAuth + WebSocket terminals
    └── public/
        ├── index.html          # Dashboard SPA shell
        ├── lumin.png           # Favicon
        ├── css/
        │   └── main.css        # Complete design system
        └── js/
            ├── app.js          # Boot, OAuth flow, real-time stats stream
            ├── config.js       # Token management + page definitions
            ├── router.js       # Client-side navigation
            ├── terminals.js    # xterm.js REPL terminals (Node + Mongo)
            ├── servers.js      # Servers page
            ├── commands.js     # Admin command cards
            ├── announce.js     # Announcement page
            ├── lockdown.js     # Lockdown page
            ├── api.js          # Fetch wrapper
            └── toast.js        # Toast notifications
```

---

## Setup

### Prerequisites

- Node.js 20 or higher
- A MongoDB Atlas cluster (free tier works)
- A Discord application with a bot token
- At least one Google Gemini API key

### 1. Clone & Install

```bash
git clone https://github.com/imanki-t/Lumin.git
cd lumin
npm install
```

### 2. Environment Variables

Create a `.env` file in the root directory:

```env
# ── Discord ──────────────────────────────────────────────────────────────────
DISCORD_BOT_TOKEN=your_discord_bot_token

# ── Google Gemini (supports multiple keys for rotation) ──────────────────────
GOOGLE_API_KEY1=your_first_gemini_key
GOOGLE_API_KEY2=your_second_gemini_key   # optional, add as many as needed

# ── MongoDB ───────────────────────────────────────────────────────────────────
MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/lumin

# ── Dashboard — Google OAuth ──────────────────────────────────────────────────
GOOGLE_CLIENT_ID=your_client_id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-your_client_secret

# ── Dashboard — reCAPTCHA v3 ──────────────────────────────────────────────────
RECAPTCHA_SITE_KEY=6Lc_your_site_key
RECAPTCHA_SECRET_KEY=6Lc_your_secret_key

# ── Dashboard — Session ───────────────────────────────────────────────────────
SESSION_SECRET=your_64_char_random_string

# ── Optional ──────────────────────────────────────────────────────────────────
REDIS_URL=redis://...          # L3 cache layer (falls back gracefully if absent)
LOG_FILE=/var/log/lumin.log    # Persist error logs to file
PORT=3000                      # HTTP server port (default: 3000)
NODE_ENV=production
```

### 3. Register Slash Commands

```bash
node deploy-commands.js
```

### 4. Start

```bash
# Development
node index.js

# Production (with process manager)
pm2 start index.js --name lumin
```

The bot starts, connects to MongoDB, loads all state into memory, and the dashboard becomes available at `http://localhost:3000/dashboard`.

---

## Dashboard Setup

The admin dashboard requires a Google OAuth app. See [lumindash-env-guide.md](lumindash-env-guide.md) for a complete step-by-step walkthrough covering:

- Creating a Google Cloud project and OAuth credentials
- Setting the correct redirect URI (`/dashboard/auth/google/callback`)
- Registering your reCAPTCHA v3 site
- Adding all variables to Render

---

## MongoDB Atlas Vector Search

For the RAG memory system to work at full capacity, create a vector search index on your `memoryEntries` collection:

```json
{
  "mappings": {
    "dynamic": false,
    "fields": {
      "embedding": {
        "type": "knnVector",
        "dimensions": 3072,
        "similarity": "cosine"
      },
      "metadata.historyId": {
        "type": "string"
      }
    }
  }
}
```

Name the index `vector_index`. Without this, Lumin falls back to keyword search automatically — it still works, just without semantic retrieval.

---

## Configuration

Key settings live in `config.js` and `modules/config.js`:

- **Default model** — Set `DEFAULT_MODEL` to change which Gemini model is used by default
- **Model list** — Add or remove models from `MODELS` to control what users can pick
- **Safety settings** — All harm categories are set to `BLOCK_NONE` by default; adjust in `modules/config.js`
- **Rate limits** — Per-model and per-key thresholds are tuned in `managers/ApiKeyManager.js`

---

## Deploying to Render

1. Push to GitHub
2. Create a new **Web Service** on Render pointing to your repo
3. Set **Build Command:** `npm install`
4. Set **Start Command:** `node index.js`
5. Add all environment variables from the Setup section above
6. Deploy — Render will auto-restart on crashes

> **Note:** Render free tier spins down after 15 minutes of inactivity. Upgrade to a paid plan for always-on hosting if you need consistent reminder delivery.

---

## License

MIT — see [LICENSE](LICENSE) for details.

---

<div align="center">
  Built with Node.js · Discord.js · Google Gemini · MongoDB
</div>
