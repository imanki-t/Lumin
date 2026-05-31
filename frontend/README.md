# Lumin — Next.js Control Panel v2

A full Next.js 14 rebuild of the Lumin dashboard, designed with the Vercel/Geist design system.

## Routes

| Path | Description |
|---|---|
| `/gate` | Login page (Google OAuth) |
| `/app` | Overview — stats, bot identity, quick actions |
| `/app/servers` | Server list with guild cards |
| `/app/users` | User lookup, DM, blacklist, chat history |
| `/app/models` | AI model selection + API key management |
| `/app/models/settings` | Generation flags & bot config |
| `/app/models/media` | Media processing toggles |
| `/app/models/rate-limits` | RPM, cooldown & retry config |
| `/app/models/migration` | Push default settings to users/servers |
| `/app/commands` | Admin command buttons |
| `/app/presence` | Bot presence & activity |
| `/app/announce` | Global announce + DM owners |
| `/app/lockdown` | Global lockdown toggle |
| `/app/config` | Runtime config & raw file editors |
| `/app/database` | MongoDB collection browser |
| `/app/files` | File system browser & editor |
| `/app/terminals` | Node.js REPL / MongoDB / Bash |

## Setup

```bash
# 1. Install dependencies
npm install

# 2. Copy environment file
cp .env.example .env.local

# 3. Edit .env.local — point BACKEND_URL at your existing bot backend
#    BACKEND_URL=http://localhost:3000

# 4. Start dev server
npm run dev
# → http://localhost:3001/gate
```

## Production

```bash
npm run build
npm start
```

## Design System

- **Dark mode:** Pure black (`#000000`) background, Geist grays
- **Light mode:** Pure white (`#ffffff`) background, Geist grays
- **Accent:** `#6D5AE6` (light) / `#8B77FF` (dark) — Lumin purple
- **Font:** Geist Sans + Geist Mono
- **Logo:** Vercel triangle ▲
- **Toasts:** Bottom-right, no `alert()` anywhere
- **Dropdowns:** Radix UI (no native `<select>`)
