/**
 * Stage 3: Schema Generation
 * Generates complete, cross-consistent schemas for all four layers:
 * UI (components/pages), API (endpoints/request-response), DB (tables/fields), Auth (roles/permissions)
 *
 * CRITICAL INVARIANT: API fields must match DB schema. UI fields must map to API.
 */

const { callClaude, parseJSON } = require('./claude');

const SYSTEM_PROMPT = `You are Stage 3 of an app compiler: Schema Generation.
You receive intent + design objects and produce four complete, cross-consistent schemas.

CRITICAL CONSISTENCY RULES:
1. DB table fields must match what API endpoints accept/return
2. API request/response bodies must reference fields that exist in DB tables
3. UI components must map to specific API endpoints (no orphaned UI)
4. Auth roles in schemas must exactly match the roles defined in intent
5. Every API endpoint that creates/updates must have a matching DB table
6. Return ONLY valid JSON — no markdown, no explanation, no backticks

OUTPUT SCHEMA:
{
  "ui_schema": {
    "theme": {
      "primary": "#hex",
      "secondary": "#hex",
      "mode": "light",
      "font_family": "string"
    },
    "components": [
      {
        "id": "snake_case_unique",
        "type": "Form|Table|Card|Chart|Modal|Sidebar|Navbar|Button|Input|Select",
        "page": "page_path",
        "label": "Human readable label",
        "api_binding": "endpoint_id it calls",
        "fields": [{"name": "string", "type": "text|email|password|number|select|date|textarea|checkbox", "required": true|false, "maps_to_db": "table.field"}],
        "roles_visible": ["which roles see this component"]
      }
    ]
  },
  "api_schema": {
    "version": "v1",
    "base_url": "/api/v1",
    "endpoints": [
      {
        "id": "matches design endpoint id",
        "method": "GET|POST|PUT|PATCH|DELETE",
        "path": "full path",
        "description": "string",
        "auth": true|false,
        "roles": ["allowed roles"],
        "request_body": {"field": "type — must match db schema"},
        "response": {"field": "type"},
        "db_tables_used": ["table names this endpoint reads/writes"],
        "status_codes": {"200": "description", "400": "validation error", "401": "unauthorized", "404": "not found"}
      }
    ]
  },
  "db_schema": {
    "engine": "postgresql|mysql|sqlite",
    "tables": [
      {
        "name": "snake_case_plural",
        "description": "what this table stores",
        "fields": [
          {
            "name": "snake_case",
            "type": "uuid|varchar|text|integer|bigint|boolean|timestamp|decimal|jsonb|enum",
            "required": true|false,
            "unique": false,
            "primary_key": false,
            "foreign_key": null,
            "default": null,
            "enum_values": null
          }
        ],
        "indexes": ["field_names to index"],
        "timestamps": true
      }
    ],
    "migrations": ["CREATE TABLE ... (pseudocode, one per table)"]
  },
  "auth_schema": {
    "provider": "jwt|session|oauth2",
    "jwt_expiry": "15m|1h|7d",
    "refresh_token_expiry": "30d",
    "roles": [
      {
        "name": "role_name",
        "description": "what this role can do",
        "permissions": ["resource:action pairs, e.g. contacts:read, contacts:write, analytics:view"]
      }
    ],
    "middleware": ["auth_required", "role_check", "rate_limit"],
    "password_policy": {
      "min_length": 8,
      "require_uppercase": true,
      "require_number": true
    }
  }
}`;

async function stage3_schemaGeneration(intent, design) {
  const userMessage = `Generate complete schemas for:\n\nINTENT:\n${JSON.stringify(intent, null, 2)}\n\nDESIGN:\n${JSON.stringify(design, null, 2)}

Ensure:
- Every API endpoint in the design has a corresponding schema entry
- Every entity in the design maps to a DB table
- All roles from intent.roles appear in auth_schema.roles
- UI components have api_binding pointing to real endpoint IDs`;

  const raw = await callClaude(SYSTEM_PROMPT, userMessage, {
    temperature: 0.1,
    max_tokens: 3000,
  });

  const parsed = parseJSON(raw);
  return validateAndRepair(parsed, intent, design);
}

function validateAndRepair(parsed, intent, design) {
  const repairs = [];

  // ─── DB Schema repairs ───────────────────────────────────────────────────
  if (!parsed.db_schema || !Array.isArray(parsed.db_schema.tables)) {
    parsed.db_schema = { engine: 'postgresql', tables: [], migrations: [] };
    repairs.push('initialized empty db_schema');
  }

  // Ensure users table always exists
  if (!parsed.db_schema.tables.some(t => t.name === 'users')) {
    parsed.db_schema.tables.unshift({
      name: 'users',
      description: 'Application users',
      fields: [
        { name: 'id', type: 'uuid', required: true, unique: true, primary_key: true, foreign_key: null, default: 'gen_random_uuid()', enum_values: null },
        { name: 'email', type: 'varchar', required: true, unique: true, primary_key: false, foreign_key: null, default: null, enum_values: null },
        { name: 'password_hash', type: 'varchar', required: true, unique: false, primary_key: false, foreign_key: null, default: null, enum_values: null },
        { name: 'role', type: 'enum', required: true, unique: false, primary_key: false, foreign_key: null, default: 'user', enum_values: intent.roles || ['user', 'admin'] },
        { name: 'is_active', type: 'boolean', required: true, unique: false, primary_key: false, foreign_key: null, default: true, enum_values: null },
      ],
      indexes: ['email', 'role'],
      timestamps: true,
    });
    repairs.push('added missing users table');
  }

  // Ensure every table has id + timestamps
  parsed.db_schema.tables = parsed.db_schema.tables.map(table => {
    if (!Array.isArray(table.fields)) { table.fields = []; }

    if (!table.fields.some(f => f.primary_key || f.name === 'id')) {
      table.fields.unshift({ name: 'id', type: 'uuid', required: true, unique: true, primary_key: true, foreign_key: null, default: 'gen_random_uuid()', enum_values: null });
      repairs.push(`added missing id to table ${table.name}`);
    }

    if (table.timestamps === undefined) table.timestamps = true;
    if (!Array.isArray(table.indexes)) table.indexes = [];
    return table;
  });

  // Add payments table if payments enabled
  if (intent.has_payments && !parsed.db_schema.tables.some(t => t.name === 'subscriptions' || t.name === 'payments')) {
    parsed.db_schema.tables.push({
      name: 'subscriptions',
      description: 'User payment subscriptions',
      fields: [
        { name: 'id', type: 'uuid', required: true, unique: true, primary_key: true, foreign_key: null, default: 'gen_random_uuid()', enum_values: null },
        { name: 'user_id', type: 'uuid', required: true, unique: false, primary_key: false, foreign_key: 'users.id', default: null, enum_values: null },
        { name: 'stripe_subscription_id', type: 'varchar', required: false, unique: true, primary_key: false, foreign_key: null, default: null, enum_values: null },
        { name: 'stripe_customer_id', type: 'varchar', required: false, unique: false, primary_key: false, foreign_key: null, default: null, enum_values: null },
        { name: 'plan', type: 'enum', required: true, unique: false, primary_key: false, foreign_key: null, default: 'free', enum_values: ['free', 'premium', 'enterprise'] },
        { name: 'status', type: 'enum', required: true, unique: false, primary_key: false, foreign_key: null, default: 'active', enum_values: ['active', 'cancelled', 'past_due', 'trialing'] },
        { name: 'current_period_end', type: 'timestamp', required: false, unique: false, primary_key: false, foreign_key: null, default: null, enum_values: null },
      ],
      indexes: ['user_id', 'stripe_subscription_id'],
      timestamps: true,
    });
    repairs.push('added subscriptions table (payments enabled)');
  }

  // ─── Auth Schema repairs ──────────────────────────────────────────────────
  if (!parsed.auth_schema) {
    parsed.auth_schema = { provider: 'jwt', jwt_expiry: '15m', refresh_token_expiry: '30d', roles: [], middleware: [], password_policy: { min_length: 8, require_uppercase: true, require_number: true } };
    repairs.push('initialized empty auth_schema');
  }
  if (!Array.isArray(parsed.auth_schema.roles)) parsed.auth_schema.roles = [];

  // Ensure every role from intent exists in auth_schema
  const existingRoles = new Set(parsed.auth_schema.roles.map(r => r.name));
  (intent.roles || ['user', 'admin']).forEach(roleName => {
    if (!existingRoles.has(roleName)) {
      const defaultPermissions = roleName === 'admin'
        ? ['*:*'] // Admin gets all
        : ['profile:read', 'profile:write'];
      parsed.auth_schema.roles.push({ name: roleName, description: `${roleName} role`, permissions: defaultPermissions });
      repairs.push(`added missing auth role: ${roleName}`);
    }
  });

  // ─── API Schema repairs ───────────────────────────────────────────────────
  if (!parsed.api_schema || !Array.isArray(parsed.api_schema.endpoints)) {
    parsed.api_schema = { version: 'v1', base_url: '/api/v1', endpoints: [] };
    repairs.push('initialized empty api_schema');
  }

  // Validate each endpoint has db_tables_used
  parsed.api_schema.endpoints = parsed.api_schema.endpoints.map(ep => {
    if (!Array.isArray(ep.db_tables_used)) {
      ep.db_tables_used = [];
      // Try to infer from path
      const pathParts = ep.path.split('/').filter(Boolean);
      if (pathParts.length > 0) {
        const tableName = pathParts[pathParts.length > 1 ? 1 : 0].replace(/:/g, '').toLowerCase();
        ep.db_tables_used = [tableName + 's'];
      }
    }
    if (!ep.status_codes) ep.status_codes = { '200': 'Success', '400': 'Validation error', '401': 'Unauthorized', '500': 'Server error' };
    if (!ep.request_body) ep.request_body = null;
    if (!ep.response) ep.response = { success: 'boolean', data: 'object' };
    return ep;
  });

  // ─── UI Schema repairs ────────────────────────────────────────────────────
  if (!parsed.ui_schema) {
    parsed.ui_schema = { theme: { primary: '#6366f1', secondary: '#8b5cf6', mode: 'light', font_family: 'Inter' }, components: [] };
    repairs.push('initialized empty ui_schema');
  }
  if (!parsed.ui_schema.theme) {
    parsed.ui_schema.theme = { primary: '#6366f1', secondary: '#8b5cf6', mode: 'light', font_family: 'Inter' };
    repairs.push('added missing ui theme');
  }
  if (!Array.isArray(parsed.ui_schema.components)) parsed.ui_schema.components = [];

  // Validate all components have api_binding that exists in api endpoints
  const endpointIds = new Set(parsed.api_schema.endpoints.map(ep => ep.id));
  parsed.ui_schema.components = parsed.ui_schema.components.map(comp => {
    if (comp.api_binding && !endpointIds.has(comp.api_binding)) {
      // Find closest matching endpoint
      const similar = [...endpointIds].find(id => id.includes(comp.api_binding?.split('_')[0]));
      if (similar) {
        const old = comp.api_binding;
        comp.api_binding = similar;
        repairs.push(`corrected api_binding ${old} → ${similar}`);
      } else {
        comp.api_binding = null;
        repairs.push(`removed unresolvable api_binding: ${comp.api_binding}`);
      }
    }
    if (!Array.isArray(comp.fields)) comp.fields = [];
    if (!Array.isArray(comp.roles_visible)) comp.roles_visible = [];
    return comp;
  });

  if (repairs.length > 0) parsed._stage3_repairs = repairs;

  return parsed;
}

module.exports = { stage3_schemaGeneration };
