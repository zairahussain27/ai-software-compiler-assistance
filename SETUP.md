# AppForge — Setup & Installation Guide

---

## ❓ Does the Anthropic API require payment?

| Method | Cost | Notes |
|---|---|---|
| `api.anthropic.com` (direct) | **Paid** — needs API key + credits | Required for backend pipeline |
| Free trial credits | **~$5 free** on first signup | Enough for ~200 compiles |
| Claude.ai chat interface | **Free tier** | Cannot call the API from here |
| **Demo mode (no API key)** | **100% Free** | Open `frontend/index.html` → click "Demo Mode" |

### How to get a free API key
1. Go to → https://console.anthropic.com/
2. Sign up with email
3. You get **~$5 in free credits** automatically (no card needed initially)
4. Go to **API Keys** → **Create Key** → copy it
5. That's it — ~$5 covers roughly **200+ full pipeline compilations**

---

## Requirements

| Requirement | Version | Why |
|---|---|---|
| **Node.js** | `>= 18.0.0` | ES2022 features, fetch built-in |
| **npm** | `>= 9.0.0` | Comes with Node 18+ |
| **Anthropic API Key** | any | For real AI pipeline (optional — demo mode works without) |

### Check your versions
```bash
node --version    # must show v18.x.x or higher
npm --version     # must show 9.x.x or higher
```

### Install Node.js if missing
- **Windows / Mac:** https://nodejs.org → download LTS
- **Ubuntu/Debian:**
  ```bash
  curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
  sudo apt-get install -y nodejs
  ```
- **Mac (Homebrew):**
  ```bash
  brew install node
  ```

---

## Installation

### Step 1 — Clone or download the project
```bash
git clone https://github.com/your-org/appforge.git
cd appforge
```
Or unzip the downloaded folder, then open terminal inside it.

### Step 2 — Install dependencies
```bash
npm install
```
This installs:
- `express` — web server
- `cors` — cross-origin requests
- `dotenv` — loads `.env` file
- `jest` — test runner (dev)
- `nodemon` — auto-restart on change (dev)

### Step 3 — Set your API key

**Option A: `.env` file (recommended)**
```bash
cp .env.example .env
```
Open `.env` and fill in:
```
ANTHROPIC_API_KEY=sk-ant-api03-xxxxxxxxxxxxxxxx
PORT=3001
NODE_ENV=development
```

**Option B: Export in terminal (temporary)**
```bash
# Mac / Linux
export ANTHROPIC_API_KEY=sk-ant-api03-xxxxxxxxxxxxxxxx

# Windows CMD
set ANTHROPIC_API_KEY=sk-ant-api03-xxxxxxxxxxxxxxxx

# Windows PowerShell
$env:ANTHROPIC_API_KEY="sk-ant-api03-xxxxxxxxxxxxxxxx"
```

### Step 4 — Run the server
```bash
npm start
```
You should see:
```
🚀 AppForge API running on http://localhost:3001
📊 Metrics: http://localhost:3001/api/metrics
❤️  Health:  http://localhost:3001/api/health
```

### Step 5 — Open the app
- Open your browser → http://localhost:3001
- Or open `frontend/index.html` directly (for frontend-only / demo mode)

---

## Running Without an API Key (Demo Mode)

The `frontend/index.html` has a built-in **Demo Mode** that runs the full
5-stage pipeline with realistic pre-generated data — no API key needed.

1. Open `frontend/index.html` in any browser (double-click it)
2. Check the **"Demo Mode"** toggle at the top
3. Enter any prompt and click **Compile App**
4. All 5 stages run with simulated data and realistic timings

This is useful for:
- Demoing the UI to others
- Testing the interface
- Understanding the output format before spending API credits

---

## All Commands

```bash
# Start production server
npm start

# Start dev server (auto-restarts on file change)
npm run dev

# Run tests
npm test

# Run tests in watch mode
npm run test:watch

# Run evaluation suite — quick (5 cases)
npm run eval

# Run full evaluation suite (all 20 cases — uses API credits)
npm run eval:full

# Run only edge case evaluations
npm run eval:edge

# Run only real product prompt evaluations
npm run eval:real
```

---

## Project Structure

```
appforge/
├── frontend/
│   └── index.html              ← Open this directly OR visit localhost:3001
│
├── backend/
│   ├── server.js               ← Express API (POST /api/compile, GET /api/health)
│   ├── pipeline/
│   │   ├── orchestrator.js     ← Runs all 5 stages, handles retries
│   │   ├── stage1_intent.js    ← NL → structured intent
│   │   ├── stage2_design.js    ← Intent → architecture + pages + API groups
│   │   ├── stage3_schema.js    ← Generates UI/API/DB/Auth schemas
│   │   ├── stage4_validation.js← Dual-layer validation + surgical repair
│   │   └── stage5_assembly.js  ← Runtime manifest + final config
│   ├── validators/
│   │   ├── schemaValidator.js  ← 10 validation functions, 12 cross-layer rules
│   │   └── metrics.js          ← Tracks success rate, latency, retries
│   └── utils/
│       ├── claude.js           ← Anthropic API client + JSON repair engine
│       └── logger.js           ← Structured logger with levels + timers
│
├── evaluation/
│   ├── evalDataset.js          ← 10 real + 10 edge case prompts
│   ├── runEval.js              ← CLI eval runner
│   └── pipeline.test.js        ← 35 Jest unit tests
│
├── docs/
│   └── ARCHITECTURE.md         ← Full system design
│
├── .env.example                ← Copy to .env and add your API key
├── package.json
└── SETUP.md                    ← This file
```

---

## API Endpoints

Once the server is running:

| Method | URL | Description |
|---|---|---|
| `POST` | `/api/compile` | Run full pipeline. Body: `{ "prompt": "..." }` |
| `GET`  | `/api/health` | Health check |
| `GET`  | `/api/metrics` | Global metrics across all runs |
| `GET`  | `/api/eval/dataset` | View the 20 eval test cases |
| `POST` | `/api/eval/run` | Run eval cases. Body: `{ "category": "real", "limit": 3 }` |

### Example API call
```bash
curl -X POST http://localhost:3001/api/compile \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Build a CRM with contacts, roles, and Stripe payments"}'
```

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `node: command not found` | Install Node.js 18+ from nodejs.org |
| `npm install` fails | Run `npm cache clean --force` then retry |
| `401 Unauthorized` from API | Check your `ANTHROPIC_API_KEY` in `.env` |
| `EADDRINUSE port 3001` | Change `PORT=3002` in `.env` or kill the other process |
| `Cannot find module 'express'` | Run `npm install` again |
| Pipeline times out | Normal for slow networks — timeout is 120s per stage |
| JSON parse error in output | Built-in repair engine handles this — check Repair Log tab |
