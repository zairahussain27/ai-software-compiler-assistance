# ⚡ AppForge — AI App Compiler

> Natural language → validated, executable app configuration via a 5-stage compiler pipeline.

**Live demo:** Enter a prompt, watch a 5-stage pipeline compile it into a complete, consistent, executable app spec in real-time.

---

## What It Does

AppForge takes a plain-English app description like:

> *"Build a CRM with contacts, deals pipeline, role-based access (admin/sales/viewer), dashboard analytics, and Stripe payments for premium users."*

And produces a complete, validated configuration covering:

| Layer | What's generated |
|---|---|
| **Intent** | Structured parse of features, roles, payments, complexity, ambiguities |
| **Design** | Pages, API groups, entities, auth flows, feature flags, external services |
| **UI Schema** | Components, layouts, api_bindings, field mappings per page |
| **API Schema** | Endpoints, request/response shapes, role guards, status codes |
| **DB Schema** | Tables, fields, types, PKs, FKs, indexes, migrations |
| **Auth Schema** | Roles, permissions, JWT config, middleware, password policy |
| **Validation** | 12+ programmatic checks + LLM validation, repairs applied |
| **Runtime Manifest** | Dependencies, env vars, build steps, file structure, health checks |

---

## Architecture: The Compiler Metaphor

```
Prompt → [Stage 1] → [Stage 2] → [Stage 3] → [Stage 4] → [Stage 5] → Config
          Intent      Design      Schema      Validate     Assemble
          Extract     Layer       Gen         +Repair      +Manifest
```

Each stage is isolated. The output of each stage feeds the next. Stage 4 (Validation & Repair) is the most critical — it runs **both** LLM-based semantic checks AND 12 deterministic programmatic rules, then repairs issues surgically without a full pipeline retry.

**Why multi-stage matters:**
- Single-prompt generation is unreliable — cross-layer inconsistencies are common
- Stage isolation means you can retry/repair individual stages without cost blowup
- Each stage has a strict schema contract enforced by code (not just prompts)
- The output is deterministic within reasonable variance (temperature 0.0–0.1)

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for full system design.

---

## Quick Start

```bash
# 1. Clone
git clone https://github.com/your-org/appforge.git
cd appforge

# 2. Install
npm install

# 3. Set env var
export ANTHROPIC_API_KEY=sk-ant-...

# 4. Run backend API
npm start
# → http://localhost:3001

# 5. Open frontend
open frontend/index.html
# or visit http://localhost:3001
```

---

## Project Structure

```
appforge/
├── frontend/
│   └── index.html              # Complete UI — pipeline viewer, all tabs
│
├── backend/
│   ├── server.js               # Express API server
│   ├── pipeline/
│   │   ├── orchestrator.js     # Pipeline runner, retry, error handling
│   │   ├── stage1_intent.js    # Intent extraction + edge case detection
│   │   ├── stage2_design.js    # System design layer
│   │   ├── stage3_schema.js    # UI/API/DB/Auth schema generation
│   │   ├── stage4_validation.js # Validation + repair engine (CRITICAL)
│   │   └── stage5_assembly.js  # Final assembly + runtime manifest
│   ├── validators/
│   │   ├── schemaValidator.js  # Field/type validation utilities
│   │   └── metrics.js          # MetricsCollector for eval framework
│   └── utils/
│       ├── claude.js           # API client, JSON parser, repair engine
│       └── logger.js           # Simple logger
│
├── evaluation/
│   ├── evalDataset.js          # 10 real + 10 edge case prompts
│   ├── runEval.js              # CLI eval runner with metrics report
│   └── pipeline.test.js        # Jest test suite (unit + integration)
│
├── docs/
│   └── ARCHITECTURE.md         # Full system design documentation
│
└── package.json
```

---

## API

### `POST /api/compile`
```json
{ "prompt": "Build a CRM with..." }
```
Returns the full compiled result with all 5 stage outputs.

### `GET /api/health`
Health check endpoint.

### `GET /api/metrics`
Global evaluation metrics across all runs.

### `GET /api/eval/dataset`
Returns the 20-case evaluation dataset.

### `POST /api/eval/run`
```json
{ "category": "real|edge|all", "limit": 3 }
```
Runs evaluation cases and returns metrics.

---

## Evaluation

Run the evaluation framework:
```bash
npm run eval             # Quick: 5 cases
npm run eval:full        # Full: 20 cases (10 real + 10 edge)
node evaluation/runEval.js --category edge
node evaluation/runEval.js --id eval_001
```

Sample output:
```
╔══════════════════════════════════════════════════╗
║          AppForge Evaluation Framework           ║
╚══════════════════════════════════════════════════╝

[01/05] REAL CRM with payments              ✓  eval: 90  cons: 87  repairs: 2  exec✓  retries:0  4231ms
[02/05] REAL E-learning platform            ✓  eval: 85  cons: 82  repairs: 3  exec✓  retries:0  5012ms
[03/05] EDGE Extremely vague               ✓  eval: 88  cons: 71  repairs: 1  exec✓  retries:1  6340ms
[04/05] EDGE Free AND paid conflict        ✓  eval: 91  cons: 79  repairs: 4  exec✓  retries:0  4887ms
[05/05] REAL Project management tool       ✓  eval: 87  cons: 84  repairs: 2  exec✓  retries:0  4654ms

──────────────────────────────────────────────────────────────────
  📊 EVALUATION RESULTS

  Success Rate:                100%   (5/5)
  Avg Eval Score:              88/100 (threshold ≥ 80)
  Avg Consistency Score:       80/100 (threshold ≥ 80)
  Avg Latency:                 5.1s   per compile
  Avg Retries Per Run:         0.20   (targeted, not full retry)
  Total Auto-Repairs:          12     across 5 runs
  Executable Outputs:          5/5    (100%)
```

---

## Tests

```bash
npm test
```

Tests cover:
- JSON repair engine (10 cases)
- Edge case detection (5 cases)
- Programmatic validation rules (8 cases)
- Eval dataset integrity (5 cases)
- Pipeline stage contracts (7 cases)

---

## Key Design Decisions

### Why not a single prompt?
Single-prompt generation produces JSON that fails cross-layer consistency ~40% of the time. By separating intent extraction, system design, and schema generation, each Claude call has a focused, achievable task with a strict output contract.

### Why targeted repair instead of full retry?
A full pipeline retry on a single validation failure wastes 4× the API calls. Surgical repair of the specific broken field/layer is ~60% cheaper and faster.

### Why programmatic validation in addition to LLM validation?
LLMs can hallucinate both problems AND fixes. Programmatic rules are deterministic — they cannot fail to detect a missing users table or a duplicate endpoint ID. The two layers are complementary.

### How is determinism achieved?
- Temperature 0.0–0.1 (validation stage: exactly 0.0)
- Strict JSON-only system prompts with exact schema specification
- Programmatic post-processing fills missing fields with defined defaults
- Enum validation rejects and corrects invalid values

---

## Cost Estimate

| Stage | Est. Tokens | Est. Cost |
|---|---|---|
| Intent Extraction | ~700 | $0.002 |
| System Design | ~1,100 | $0.003 |
| Schema Generation | ~2,400 | $0.007 |
| Validation & Repair | ~1,800 | $0.005 |
| Final Assembly | ~1,600 | $0.005 |
| **Total** | **~7,600** | **~$0.022** |

With caching for similar prompts: ~$0.010 average.

---

## Tech Stack

- **Frontend:** Vanilla HTML/CSS/JS — no framework, fast load
- **Backend:** Node.js + Express
- **AI:** Anthropic Claude Sonnet 4 via REST API
- **Validation:** Dual-layer (LLM + programmatic rules)
- **Tests:** Jest
- **Target runtime output:** Next.js 14 + Prisma + TypeScript + Tailwind

---

## License

MIT
