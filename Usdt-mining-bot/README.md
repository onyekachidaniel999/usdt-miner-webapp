# ⚡ USDT Mining Bot (Node.js)

A Telegram bot where users mine simulated USDT, boost hashrate by watching Monetag ads, and earn referral bonuses.

---

## 📁 Project Structure

```
mining_bot_node/
├── bot.js            ← Main bot (Telegraf)
├── database.js       ← SQLite database (better-sqlite3)
├── package.json      ← Dependencies
├── .env.example      ← Environment variable template
├── webapp/
│   └── index.html    ← Telegram Mini App for Monetag ads
└── README.md
```

---

## 🚀 Setup Guide

### 1. Prerequisites
- [Node.js](https://nodejs.org) v18 or higher
- A server or PC to run the bot (or use a free service like Railway/Render)

### 2. Create Your Bot
1. Open Telegram → search **@BotFather**
2. Send `/newbot` and follow prompts
3. Copy your **Bot Token**

### 3. Get Your Telegram Admin ID
1. Search **@userinfobot** on Telegram
2. Send `/start` → copy your numeric user ID

### 4. Configure Environment
```bash
cp .env.example .env
```
Edit `.env`:
```env
BOT_TOKEN=your_bot_token_here
ADMIN_IDS=123456789
WEBAPP_URL=https://yourdomain.com
```
For multiple admins: `ADMIN_IDS=111111111,222222222`

### 5. Install Dependencies
```bash
npm install
```

### 6. Host the Web App (`webapp/index.html`)
The Mini App **must be served over HTTPS**. Free options:
- [Netlify](https://netlify.com) — drag & drop the `webapp/` folder
- [Vercel](https://vercel.com)
- [GitHub Pages](https://pages.github.com)

After hosting, update `WEBAPP_URL` in your `.env` file.

### 7. Integrate Monetag Ads
1. Sign up at [monetag.com](https://monetag.com)
2. Create an **Interstitial** ad zone and get your zone script/ID
3. Open `webapp/index.html`
4. Find the comment block `── Monetag integration ──`
5. Replace `simulateAd()` with your Monetag code
6. Call `onAdComplete(fill, status)` in Monetag's completion callback

### 8. Run the Bot
```bash
# Development (auto-restarts on file change)
npm run dev

# Production
npm start
```

---

## ⚙️ Key Settings (in `bot.js`)

| Constant | Value | Description |
|---|---|---|
| `MINING_DURATION` | 10800 (3hrs) | Mining session length in seconds |
| `USDT_PER_SEC_GHS` | 0.000018 | USDT earned per GH/s per second |
| `AD_COOLDOWN` | 1800 (30min) | Cooldown between ad-watch rewards |
| `AD_GHS_REWARD` | 1 | GH/s for cooldown ad |
| `BOOST_GHS_REWARD` | 3 | GH/s for boost ad |
| `MIN_WITHDRAWAL` | 20.0 | Minimum USDT to withdraw |

---

## 👑 Admin Commands

| Command | Description |
|---|---|
| `/withdrawals` | View pending withdrawals with approve/reject buttons |

---

## 🎯 Referral System

- **Per referral:** +15 GH/s instantly credited to referrer

| Milestone | Bonus GH/s |
|---|---|
| 3 referrals | +50 |
| 5 referrals | +90 |
| 10 referrals | +220 |
| 20 referrals | +470 |
| 50 referrals | +1,200 |
| 100 referrals | +2,500 |
| 200 referrals | +5,000 |
| 500 referrals | +10,000 |

Milestones are granted **once only** and stack with per-referral bonuses.

---

## 🖥️ Production Deployment

### Option A — Free (Railway)
1. Push code to GitHub
2. Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub
3. Add environment variables in Railway dashboard
4. Done — Railway keeps it running 24/7

### Option B — VPS (Ubuntu) with PM2
```bash
npm install -g pm2
pm2 start bot.js --name mining-bot
pm2 save
pm2 startup
```

---

## 📝 Notes
- All USDT balances are **simulated** — no real crypto is involved
- Withdrawals are **manually processed** by the admin
- Database is SQLite — fine for thousands of users; switch to PostgreSQL for very large scale
- The Mini App requires **HTTPS** to work inside Telegram
