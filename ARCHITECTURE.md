# AppForge — System Architecture

## Overview

AppForge is an **AI App Compiler** that converts natural language descriptions into complete, validated, executable application configurations. It is architected like a compiler: with distinct stages, strict schema contracts, and a dedicated repair engine.

```
Natural Language Prompt
        │
        ▼
┌───────────────────────────────────────────────────────────────┐
│                    PIPELINE ORCHESTRATOR                        │
│         (retry logic, stage isolation, error handling)          │
└────────┬──────────┬──────────┬──────────┬───────────┬─────────┘
         │          │          │          │           │
         ▼          ▼          ▼          ▼           ▼
    ┌─────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐
    │Stage 1  │ │Stage 2 │ │Stage 3 │ │Stage 4 │ │Stage 5 │
    │Intent   │ │System  │ │Schema  │ │Validate│ │Final   │
    │Extract  │ │Design  │ │Gen     │ │+Repair │ │Assemble│
    └─────────┘ └────────┘ └────────┘ └────────┘ └────────┘
         │          │          │          │           │
         ▼          ▼          ▼          ▼           ▼
    IntentObj  DesignObj  Schemas    ValReport  FinalConfig
                                    +Repairs   +Manifest
        └──────────┴──────────┴──────────┴───────────┘
                              │
                              ▼
                    Complete Executable
                    App Configuration
```

---

## Stage Design

### Stage 1 — Intent Extraction
**Input:** Raw natural language string  
**Output:** Structured `IntentObject`

Responsibilities:
- Parse entities, features, roles, payment model, complexity
- Detect edge cases: vague prompts, conflicting requirements, underspecified inputs
- Document all assumptions made
- Assign `clarity_score` (0–100)

Key design: Low temperature (0.1) for determinism. Pre-processing classifies edge case type before calling Claude so the system prompt can adapt.

### Stage 2 — System Design
**Input:** `IntentObject`  
**Output:** `DesignObject`

Responsibilities:
- Choose architecture (monolith/microservices/serverless)
- Define all pages with paths, auth requirements, and role access
- Define API groups with full endpoint list
- Map entities and their relations
- Define feature flags for gated features
- List external services

Key design: Validates and repairs output before passing forward. Ensures auth pages, admin routes, and Stripe exist if the intent requires them.

### Stage 3 — Schema Generation
**Input:** `IntentObject` + `DesignObject`  
**Output:** `{ ui_schema, api_schema, db_schema, auth_schema }`

Responsibilities:
- Generate complete DB schema (tables, fields, types, PKs, FKs, indexes)
- Generate API schema (endpoints, request/response shapes, status codes)
- Generate UI schema (components, api_bindings, field mappings)
- Generate Auth schema (roles, permissions, middleware, password policy)

**Critical invariants enforced in repair step:**
- Every API field must exist in a DB table
- Every UI component must bind to a real endpoint ID
- All intent roles must appear in auth_schema
- Payment table auto-injected when `has_payments = true`

### Stage 4 — Validation & Repair Engine *(most critical)*
**Input:** All previous stages  
**Output:** `ValidationReport` with repairs applied

Two-layer validation:

**LLM Layer** — semantic checks
- Detects logical inconsistencies a rule engine can't see
- Checks business logic validity
- Scores cross-layer consistency

**Programmatic Layer** — 12 deterministic rules (zero hallucination risk):
1. `users_table_exists` — DB must have users table
2. `all_roles_in_auth` — every intent role must be in auth_schema
3. `unique_endpoint_ids` — no duplicate IDs
4. `tables_have_pk` — every table has a primary key
5. `valid_foreign_keys` — FK targets must exist
6. `ui_api_bindings` — UI components bind to real endpoints
7. `admin_pages_secured` — admin routes require admin role
8. `payment_table_exists` — subscriptions table when has_payments
9. `jwt_config_present` — JWT expiry must be set
10. `entities_have_tables` — design entities have DB tables
11. `auth_endpoints_have_roles` — auth-required endpoints list roles
12. `api_db_table_refs` — API db_tables_used references real tables

**Repair strategy:** Surgical/targeted fixes without full pipeline retry. Only the specific broken field/layer is regenerated. Saves ~60% tokens vs brute-force retry.

### Stage 5 — Final Assembly
**Input:** All stages + validation report  
**Output:** `FinalConfig` with runtime manifest

Responsibilities:
- Produce app_config (name, slug, version, run_id)
- Generate runtime_manifest (env_vars, dependencies, build steps, health checks)
- Generate file_structure (every file the code generator would produce)
- Include code_generation_hints (ORM, auth library, UI library, API style)
- Produce summary and next_steps
- Inject all required env vars (DATABASE_URL, JWT_SECRET, STRIPE_* if payments)

---

## Schema Contracts

### IntentObject
```typescript
{
  app_name: string;
  app_type: 'crm' | 'ecommerce' | 'saas' | 'social' | 'marketplace' | 'education' | 'productivity' | 'other';
  clarity_score: number;        // 0-100
  ambiguities: string[];
  assumptions: string[];
  core_entities: string[];
  core_features: string[];
  auth_required: boolean;
  roles: string[];
  admin_features: string[];
  has_payments: boolean;
  payment_model: 'free' | 'freemium' | 'subscription' | 'one-time' | 'none';
  payment_provider: 'stripe' | 'paypal' | 'none';
  complexity: 'low' | 'medium' | 'high';
  tech_constraints: string[];
  out_of_scope: string[];
}
```

### Cross-layer consistency guarantee
```
API endpoint.request_body.{field} ← must exist in → DB table.fields[].name
UI component.fields[].maps_to_db  ← must exist in → DB table.name.fields[].name
UI component.api_binding           ← must exist in → api_schema.endpoints[].id
auth_schema.roles[].name           ← must cover  → intent.roles[]
```

---

## Determinism Strategy

To achieve consistent outputs for the same input:

1. **Temperature = 0.0–0.1** on all stages. Validation stage uses 0.0.
2. **Strict JSON-only system prompts** — no free-form text possible
3. **Schema enforcement in repair** — every stage validates its own output before returning
4. **Programmatic post-processing** — fills missing required fields with deterministic defaults
5. **Enum validation** — invalid enum values are corrected, never passed forward

---

## Failure Handling

| Scenario | Handling |
|---|---|
| Vague prompt | Detected in Stage 1, clarity_score < 40, assumptions documented |
| Conflicting requirements | Detected in Stage 1, listed in ambiguities, most reasonable interpretation applied |
| LLM returns invalid JSON | JSON repair engine (5 strategies), then targeted retry if needed |
| Stage timeout | Orchestrator catches, records in repair log, uses fallback stub |
| Missing required field | Repair layer injects sensible default with documentation |
| Cross-layer mismatch | Stage 4 detects and applies targeted surgical repair |
| Fatal stage failure | Strict mode: abort with partial output. Lenient mode: continue with stub |

---

## Cost vs Quality Tradeoffs

| Approach | Quality | Cost | Latency |
|---|---|---|---|
| Multi-stage (AppForge) | High | ~$0.02/compile | 20–45s |
| Single-stage | Low–Medium | ~$0.005/compile | 5–10s |
| Multi-stage + caching | High | ~$0.008 avg | 10–20s avg |

**Key optimizations:**
- Stage 1-2 outputs can be cached for semantically similar prompts (saves ~40% cost)
- Targeted repair (not full retry) saves ~60% tokens on average
- Programmatic validation is free (0 tokens, purely JavaScript)
- Stage 3 (schema generation) is the most expensive — consider streaming for UI feedback

---

## Execution Awareness

The output is directly usable to generate a working application:

- `db_schema.tables` → `prisma/schema.prisma` (1:1 mapping)
- `api_schema.endpoints` → Next.js `src/app/api/[route]/route.ts` files
- `ui_schema.components` → React component files with prop types
- `auth_schema.roles` → middleware role checks
- `runtime_manifest.env_vars` → `.env.example` file
- `runtime_manifest.dependencies` → `package.json`
- `runtime_manifest.build_steps` → CI/CD pipeline
- `file_structure` → complete project scaffold

---

## Evaluation Framework

**20 test cases:**
- 10 real product prompts (CRM, e-learning, marketplace, etc.)
- 10 edge cases (vague, conflicting, incomplete)

**Metrics tracked:**
- Success rate (target: ≥ 80%)
- Avg eval score vs expected output (target: ≥ 80/100)
- Avg consistency score (target: ≥ 80/100)
- Avg latency per compile
- Avg retries per run (target: < 0.5)
- Total auto-repairs applied
- Failure types (json_parse_error, timeout, api_error, etc.)
- Executable output rate (target: ≥ 90% of successes)

**Run eval:**
```bash
node evaluation/runEval.js          # quick (5 cases)
node evaluation/runEval.js --full   # all 20 cases
node evaluation/runEval.js --category edge
```
