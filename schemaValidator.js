/**
 * AppForge — Schema Validator
 * ============================================================
 * Full-featured schema validation utility used by all 5 pipeline stages.
 *
 * Responsibilities:
 *  1. validateSchema()      — check required fields, types, enums, ranges, patterns
 *  2. assertField()         — safely set a nested field default with repair tracking
 *  3. validateIntentSchema()  — validate Stage 1 IntentObject output
 *  4. validateDesignSchema()  — validate Stage 2 DesignObject output
 *  5. validateSchemasOutput() — validate Stage 3 (UI/API/DB/Auth) output
 *  6. validateValidationReport() — validate Stage 4 output
 *  7. crossLayerCheck()     — verify cross-layer consistency between all schemas
 *  8. sanitizeString()      — clean/truncate string fields
 *  9. coerceType()          — attempt safe type coercion before erroring
 * 10. buildRepairLog()      — structured repair log entry builder
 */

'use strict';

/* ─────────────────────────────────────────────────────────────
   CONSTANTS
───────────────────────────────────────────────────────────── */

const VALID_APP_TYPES    = ['crm','ecommerce','saas','social','marketplace','education','productivity','other'];
const VALID_COMPLEXITY   = ['low','medium','high'];
const VALID_PAY_MODELS   = ['free','freemium','subscription','one-time','none'];
const VALID_PAY_PROVS    = ['stripe','paypal','none'];
const VALID_ARCH         = ['monolith','microservices','serverless'];
const VALID_LAYOUTS      = ['dashboard','auth','marketing','blank'];
const VALID_HTTP_METHODS = ['GET','POST','PUT','PATCH','DELETE'];
const VALID_DEPLOY       = ['vercel','aws','gcp','heroku','docker'];
const VALID_DB_ENGINES   = ['postgresql','mysql','sqlite','mongodb'];
const VALID_AUTH_PROVS   = ['jwt','session','oauth2'];
const VALID_DB_TYPES     = ['uuid','varchar','text','integer','bigint','boolean','timestamp','decimal','jsonb','enum','serial','float'];
const VALID_UI_TYPES     = ['Form','Table','Card','Chart','Modal','Sidebar','Navbar','Button','Input','Select','List','Grid','Tabs','Badge'];
const VALID_FIELD_TYPES  = ['text','email','password','number','select','date','textarea','checkbox','file','phone','url','color'];
const VALID_SEV          = ['critical','major','minor'];
const VALID_ACTIONS      = ['added','removed','modified','regenerated'];
const VALID_LAYERS       = ['ui','api','db','auth','cross','pipeline','system'];
const VALID_STATUSES     = ['pass','warn','fail'];

/* ─────────────────────────────────────────────────────────────
   CORE: validateSchema
   Generic rule-based object validator.
   Rules:
     required  — list of required field names
     types     — { field: 'string'|'number'|'boolean'|'array'|'object' }
     enums     — { field: ['allowed','values'] }
     ranges    — { field: { min, max } }          (numbers)
     patterns  — { field: /regex/ }               (strings)
     minLength — { field: number }                (arrays)
     maxLength — { field: number }                (arrays/strings)
───────────────────────────────────────────────────────────── */

function validateSchema(obj, rules = {}) {
  if (!obj || typeof obj !== 'object') {
    return { valid: false, errors: [{ field: '_root', type: 'not_object', message: 'Input must be a non-null object' }], repairs: [] };
  }

  const errors  = [];
  const repairs = [];

  // ── required ──────────────────────────────────────────────
  (rules.required || []).forEach(field => {
    if (obj[field] === undefined || obj[field] === null || obj[field] === '') {
      errors.push({ field, type: 'missing_required', message: `Required field '${field}' is missing or empty` });
    }
  });

  // ── types ─────────────────────────────────────────────────
  if (rules.types) {
    Object.entries(rules.types).forEach(([field, expected]) => {
      if (obj[field] === undefined || obj[field] === null) return; // let required handle it

      const actual = Array.isArray(obj[field]) ? 'array' : typeof obj[field];
      if (actual !== expected) {
        // Attempt coercion before flagging error
        const coerced = coerceType(obj[field], expected);
        if (coerced !== null) {
          obj[field] = coerced;
          repairs.push(buildRepairLog(field, 'type_coercion', `Coerced ${actual} → ${expected}`, obj[field], coerced));
        } else {
          errors.push({ field, type: 'type_mismatch', message: `'${field}' expected ${expected}, got ${actual}` });
        }
      }
    });
  }

  // ── enums ─────────────────────────────────────────────────
  if (rules.enums) {
    Object.entries(rules.enums).forEach(([field, allowed]) => {
      if (obj[field] === undefined || obj[field] === null) return;
      if (!allowed.includes(obj[field])) {
        errors.push({
          field, type: 'invalid_enum',
          message: `'${field}' value '${obj[field]}' not in [${allowed.join(', ')}]`,
          allowed,
        });
      }
    });
  }

  // ── ranges (numbers) ──────────────────────────────────────
  if (rules.ranges) {
    Object.entries(rules.ranges).forEach(([field, { min, max }]) => {
      if (obj[field] === undefined || obj[field] === null) return;
      if (typeof obj[field] !== 'number') return;
      if (min !== undefined && obj[field] < min) {
        obj[field] = min;
        repairs.push(buildRepairLog(field, 'range_clamp', `Clamped below min ${min}`, obj[field], min));
      }
      if (max !== undefined && obj[field] > max) {
        obj[field] = max;
        repairs.push(buildRepairLog(field, 'range_clamp', `Clamped above max ${max}`, obj[field], max));
      }
    });
  }

  // ── patterns (strings) ────────────────────────────────────
  if (rules.patterns) {
    Object.entries(rules.patterns).forEach(([field, regex]) => {
      if (obj[field] === undefined || typeof obj[field] !== 'string') return;
      if (!regex.test(obj[field])) {
        errors.push({ field, type: 'pattern_mismatch', message: `'${field}' value '${obj[field]}' does not match required pattern ${regex}` });
      }
    });
  }

  // ── minLength / maxLength (arrays and strings) ────────────
  if (rules.minLength) {
    Object.entries(rules.minLength).forEach(([field, min]) => {
      if (obj[field] === undefined) return;
      const len = Array.isArray(obj[field]) ? obj[field].length : (typeof obj[field] === 'string' ? obj[field].length : null);
      if (len !== null && len < min) {
        errors.push({ field, type: 'too_short', message: `'${field}' length ${len} is below minimum ${min}` });
      }
    });
  }
  if (rules.maxLength) {
    Object.entries(rules.maxLength).forEach(([field, max]) => {
      if (obj[field] === undefined) return;
      if (typeof obj[field] === 'string' && obj[field].length > max) {
        obj[field] = obj[field].slice(0, max);
        repairs.push(buildRepairLog(field, 'truncated', `Truncated to ${max} chars`, 'string too long', obj[field]));
      }
    });
  }

  return { valid: errors.length === 0, errors, repairs };
}

/* ─────────────────────────────────────────────────────────────
   assertField — safely set nested default, track repair
───────────────────────────────────────────────────────────── */

function assertField(obj, path, fallback, repairs = []) {
  if (!obj || typeof obj !== 'object') return fallback;

  const parts = path.split('.');
  let cur = obj;

  // Navigate / create intermediate objects
  for (let i = 0; i < parts.length - 1; i++) {
    if (cur[parts[i]] === undefined || cur[parts[i]] === null) {
      cur[parts[i]] = {};
      repairs.push(`created missing object at path: ${parts.slice(0, i+1).join('.')}`);
    }
    cur = cur[parts[i]];
  }

  const last = parts[parts.length - 1];
  if (cur[last] === undefined || cur[last] === null) {
    const value = typeof fallback === 'function' ? fallback() : fallback;
    cur[last] = value;
    repairs.push(`defaulted ${path} = ${JSON.stringify(value)}`);
  }
  return cur[last];
}

/* ─────────────────────────────────────────────────────────────
   STAGE 1: validateIntentSchema
───────────────────────────────────────────────────────────── */

function validateIntentSchema(intent) {
  const errors  = [];
  const repairs = [];

  if (!intent || typeof intent !== 'object') {
    return { valid: false, errors: [{ field: '_root', type: 'not_object', message: 'Intent must be an object' }], repairs: [] };
  }

  // ── app_name ──────────────────────────────────────────────
  if (!intent.app_name || typeof intent.app_name !== 'string' || !intent.app_name.trim()) {
    intent.app_name = 'MyApp';
    repairs.push('defaulted app_name to MyApp');
  } else {
    intent.app_name = sanitizeString(intent.app_name, 50);
  }

  // ── app_type ──────────────────────────────────────────────
  if (!VALID_APP_TYPES.includes(intent.app_type)) {
    repairs.push(`corrected invalid app_type '${intent.app_type}' → 'other'`);
    intent.app_type = 'other';
  }

  // ── clarity_score ─────────────────────────────────────────
  if (typeof intent.clarity_score !== 'number' || isNaN(intent.clarity_score)) {
    intent.clarity_score = 50;
    repairs.push('defaulted clarity_score to 50');
  }
  intent.clarity_score = Math.max(0, Math.min(100, Math.round(intent.clarity_score)));

  // ── arrays ────────────────────────────────────────────────
  const arrayFields = ['ambiguities','assumptions','core_entities','core_features','admin_features','tech_constraints','out_of_scope','roles'];
  arrayFields.forEach(f => {
    if (!Array.isArray(intent[f])) {
      intent[f] = [];
      repairs.push(`initialized empty array for ${f}`);
    }
    // Filter out non-strings
    intent[f] = intent[f].filter(v => typeof v === 'string' && v.trim());
  });

  // ── roles must have at least 'user' ───────────────────────
  if (!intent.roles.includes('user')) {
    intent.roles.unshift('user');
    repairs.push('injected missing base role: user');
  }

  // ── core_entities must have 'User' ────────────────────────
  if (!intent.core_entities.some(e => e.toLowerCase() === 'user')) {
    intent.core_entities.unshift('User');
    repairs.push('injected missing core entity: User');
  }

  // ── booleans ──────────────────────────────────────────────
  ['auth_required','has_payments'].forEach(f => {
    if (typeof intent[f] !== 'boolean') {
      intent[f] = false;
      repairs.push(`defaulted boolean ${f} to false`);
    }
  });

  // ── enums ─────────────────────────────────────────────────
  if (!VALID_PAY_MODELS.includes(intent.payment_model)) {
    intent.payment_model = intent.has_payments ? 'subscription' : 'none';
    repairs.push(`corrected payment_model → ${intent.payment_model}`);
  }
  if (!VALID_PAY_PROVS.includes(intent.payment_provider)) {
    intent.payment_provider = intent.has_payments ? 'stripe' : 'none';
    repairs.push(`corrected payment_provider → ${intent.payment_provider}`);
  }
  if (!VALID_COMPLEXITY.includes(intent.complexity)) {
    const fc = intent.core_features.length;
    intent.complexity = fc > 8 ? 'high' : fc > 4 ? 'medium' : 'low';
    repairs.push(`inferred complexity → ${intent.complexity}`);
  }

  // ── logical consistency ───────────────────────────────────
  if (intent.has_payments && intent.payment_model === 'none') {
    intent.payment_model = 'subscription';
    repairs.push('corrected payment_model: has_payments=true but model was none → subscription');
  }
  if (!intent.has_payments && intent.payment_provider !== 'none') {
    intent.payment_provider = 'none';
    repairs.push('corrected payment_provider: has_payments=false → none');
  }
  if (intent.roles.length > 1 && !intent.auth_required) {
    intent.auth_required = true;
    repairs.push('set auth_required=true (multiple roles defined)');
  }

  return { valid: errors.length === 0, errors, repairs, sanitized: intent };
}

/* ─────────────────────────────────────────────────────────────
   STAGE 2: validateDesignSchema
───────────────────────────────────────────────────────────── */

function validateDesignSchema(design, intent) {
  const errors  = [];
  const repairs = [];

  if (!design || typeof design !== 'object') {
    return { valid: false, errors: [{ field: '_root', type: 'not_object', message: 'Design must be an object' }], repairs: [] };
  }

  // ── architecture ──────────────────────────────────────────
  if (!VALID_ARCH.includes(design.architecture)) {
    design.architecture = 'monolith';
    repairs.push('defaulted architecture to monolith');
  }

  // ── pages ─────────────────────────────────────────────────
  if (!Array.isArray(design.pages) || design.pages.length === 0) {
    design.pages = [];
    repairs.push('initialized empty pages array');
  }

  design.pages = design.pages.map((page, i) => {
    if (!page.name)  { page.name = `Page${i+1}`; repairs.push(`defaulted page[${i}].name`); }
    if (!page.path)  { page.path = '/' + page.name.toLowerCase().replace(/\s+/g,'-'); repairs.push(`inferred page[${i}].path`); }
    if (typeof page.auth !== 'boolean') { page.auth = false; repairs.push(`defaulted page[${i}].auth`); }
    if (!Array.isArray(page.roles))     { page.roles = []; repairs.push(`initialized page[${i}].roles`); }
    if (!VALID_LAYOUTS.includes(page.layout)) { page.layout = page.auth ? 'dashboard' : 'marketing'; repairs.push(`fixed page[${i}].layout`); }
    if (!Array.isArray(page.components)) { page.components = []; }
    if (!page.description) { page.description = `${page.name} page`; }
    // Admin pages must require admin role
    if (page.name.toLowerCase().includes('admin') && page.auth && !page.roles.includes('admin')) {
      page.roles.push('admin');
      repairs.push(`added admin role to admin page: ${page.path}`);
    }
    return page;
  });

  // Ensure login page if auth required
  if (intent?.auth_required && !design.pages.some(p => p.path === '/login')) {
    design.pages.unshift({ name: 'Login', path: '/login', auth: false, roles: [], layout: 'auth', components: ['LoginForm'], description: 'Sign in page' });
    repairs.push('injected missing /login page');
  }

  // ── api_groups ────────────────────────────────────────────
  if (!Array.isArray(design.api_groups)) {
    design.api_groups = [];
    repairs.push('initialized empty api_groups');
  }

  const allEndpointIds = new Set();
  design.api_groups = design.api_groups.map((group, gi) => {
    if (!group.group) { group.group = `group${gi}`; repairs.push(`defaulted api_groups[${gi}].group`); }
    if (!group.base_path) { group.base_path = `/api/v1/${group.group}`; repairs.push(`inferred api_groups[${gi}].base_path`); }
    if (!Array.isArray(group.endpoints)) { group.endpoints = []; }

    group.endpoints = group.endpoints.map((ep, ei) => {
      // Ensure ID is unique
      if (!ep.id) {
        ep.id = `${group.group}_${(ep.method||'get').toLowerCase()}_${ei}`;
        repairs.push(`generated endpoint id for ${group.group}[${ei}]`);
      }
      // Deduplicate IDs
      if (allEndpointIds.has(ep.id)) {
        const newId = `${ep.id}_${ei}`;
        repairs.push(`renamed duplicate endpoint id ${ep.id} → ${newId}`);
        ep.id = newId;
      }
      allEndpointIds.add(ep.id);

      if (!VALID_HTTP_METHODS.includes(ep.method)) { ep.method = 'GET'; repairs.push(`fixed method for ${ep.id}`); }
      if (!ep.path) { ep.path = `/${ep.id}`; repairs.push(`inferred path for ${ep.id}`); }
      if (typeof ep.auth !== 'boolean') { ep.auth = true; repairs.push(`defaulted auth for ${ep.id}`); }
      if (!Array.isArray(ep.roles)) { ep.roles = []; }
      if (typeof ep.rate_limited !== 'boolean') { ep.rate_limited = ep.method === 'POST'; }
      if (!ep.description) { ep.description = `${ep.method} ${ep.path}`; }
      return ep;
    });
    return group;
  });

  // ── entities ──────────────────────────────────────────────
  if (!Array.isArray(design.entities)) {
    design.entities = intent?.core_entities?.map(name => ({ name, description: `${name} entity`, relations: [], soft_delete: false })) || [];
    repairs.push('generated entities from core_entities');
  }
  if (!design.entities.some(e => e.name === 'User')) {
    design.entities.unshift({ name: 'User', description: 'Application user', relations: [], soft_delete: false });
    repairs.push('injected missing User entity');
  }

  // ── misc arrays ───────────────────────────────────────────
  ['auth_flows','feature_flags','external_services'].forEach(f => {
    if (!Array.isArray(design[f])) { design[f] = []; repairs.push(`initialized ${f}`); }
  });

  if (!VALID_DEPLOY.includes(design.deployment_target)) {
    design.deployment_target = 'vercel';
    repairs.push('defaulted deployment_target to vercel');
  }

  if (typeof design.estimated_complexity_hours !== 'number') {
    const base = { low: 40, medium: 120, high: 300 };
    design.estimated_complexity_hours = base[intent?.complexity || 'medium'];
    repairs.push('estimated complexity_hours from intent.complexity');
  }

  return { valid: errors.length === 0, errors, repairs, sanitized: design };
}

/* ─────────────────────────────────────────────────────────────
   STAGE 3: validateSchemasOutput
   Validates { ui_schema, api_schema, db_schema, auth_schema }
───────────────────────────────────────────────────────────── */

function validateSchemasOutput(schemas, intent, design) {
  const errors  = [];
  const repairs = [];

  if (!schemas || typeof schemas !== 'object') {
    return { valid: false, errors: [{ field: '_root', message: 'Schemas must be an object' }], repairs: [] };
  }

  /* ── DB Schema ─────────────────────────────────────────── */
  schemas.db_schema = schemas.db_schema || {};
  if (!VALID_DB_ENGINES.includes(schemas.db_schema.engine)) {
    schemas.db_schema.engine = 'postgresql';
    repairs.push('defaulted db engine to postgresql');
  }
  if (!Array.isArray(schemas.db_schema.tables)) {
    schemas.db_schema.tables = [];
    repairs.push('initialized db tables array');
  }
  if (!Array.isArray(schemas.db_schema.migrations)) {
    schemas.db_schema.migrations = [];
  }

  // Ensure users table
  if (!schemas.db_schema.tables.some(t => t.name === 'users')) {
    schemas.db_schema.tables.unshift(buildUsersTable(intent));
    repairs.push('injected missing users table');
  }

  // Validate each table
  const allTableNames = new Set(schemas.db_schema.tables.map(t => t.name));
  schemas.db_schema.tables = schemas.db_schema.tables.map((table, ti) => {
    if (!table.name) { table.name = `table_${ti}`; repairs.push(`defaulted table[${ti}].name`); }
    table.name = table.name.toLowerCase().replace(/\s+/g,'_');
    if (!Array.isArray(table.fields)) { table.fields = []; repairs.push(`initialized ${table.name}.fields`); }

    // Ensure primary key
    if (!table.fields.some(f => f.primary_key || f.name === 'id')) {
      table.fields.unshift({ name: 'id', type: 'uuid', required: true, unique: true, primary_key: true, foreign_key: null, default: 'gen_random_uuid()', enum_values: null });
      repairs.push(`injected id PK into table ${table.name}`);
    }

    // Validate each field
    table.fields = table.fields.map((field, fi) => {
      if (!field.name) { field.name = `field_${fi}`; repairs.push(`defaulted ${table.name}.field[${fi}].name`); }
      field.name = field.name.toLowerCase().replace(/\s+/g,'_');
      if (!VALID_DB_TYPES.includes(field.type)) { field.type = 'varchar'; repairs.push(`corrected ${table.name}.${field.name}.type → varchar`); }
      if (typeof field.required !== 'boolean') { field.required = false; }
      if (typeof field.unique !== 'boolean') { field.unique = false; }
      if (typeof field.primary_key !== 'boolean') { field.primary_key = false; }
      // Validate foreign key target exists
      if (field.foreign_key && typeof field.foreign_key === 'string') {
        const refTable = field.foreign_key.split('.')[0];
        if (!allTableNames.has(refTable)) {
          const oldFK = field.foreign_key;
          field.foreign_key = null;
          repairs.push(`removed invalid FK ${table.name}.${field.name}: target table '${refTable}' does not exist`);
          errors.push({ field: `${table.name}.${field.name}.foreign_key`, type: 'invalid_fk', message: `FK '${oldFK}' references non-existent table '${refTable}'` });
        }
      }
      return field;
    });

    if (!Array.isArray(table.indexes)) { table.indexes = []; }
    if (typeof table.timestamps !== 'boolean') { table.timestamps = true; }
    if (!table.description) { table.description = `${table.name} records`; }
    return table;
  });

  // Payment table if needed
  if (intent?.has_payments && !schemas.db_schema.tables.some(t => t.name === 'subscriptions' || t.name === 'payments')) {
    schemas.db_schema.tables.push(buildSubscriptionsTable());
    repairs.push('injected subscriptions table (has_payments=true)');
  }

  /* ── Auth Schema ───────────────────────────────────────── */
  schemas.auth_schema = schemas.auth_schema || {};
  if (!VALID_AUTH_PROVS.includes(schemas.auth_schema.provider)) {
    schemas.auth_schema.provider = 'jwt';
    repairs.push('defaulted auth provider to jwt');
  }
  if (!schemas.auth_schema.jwt_expiry)          { schemas.auth_schema.jwt_expiry = '15m'; repairs.push('set jwt_expiry to 15m'); }
  if (!schemas.auth_schema.refresh_token_expiry) { schemas.auth_schema.refresh_token_expiry = '30d'; }
  if (!Array.isArray(schemas.auth_schema.roles)) { schemas.auth_schema.roles = []; repairs.push('initialized auth roles'); }
  if (!Array.isArray(schemas.auth_schema.middleware)) { schemas.auth_schema.middleware = ['auth_required','role_check']; }
  if (!schemas.auth_schema.password_policy) {
    schemas.auth_schema.password_policy = { min_length: 8, require_uppercase: true, require_number: true };
  }

  // Sync roles with intent
  const existingRoleNames = new Set(schemas.auth_schema.roles.map(r => r.name));
  (intent?.roles || ['user','admin']).forEach(roleName => {
    if (!existingRoleNames.has(roleName)) {
      schemas.auth_schema.roles.push({
        name: roleName,
        description: `${roleName} role`,
        permissions: roleName === 'admin' ? ['*:*'] : ['profile:read','profile:write'],
      });
      repairs.push(`injected missing auth role: ${roleName}`);
    }
  });

  // Validate each role
  schemas.auth_schema.roles = schemas.auth_schema.roles.map(role => {
    if (!role.name) { role.name = 'unknown'; }
    if (!role.description) { role.description = `${role.name} role`; }
    if (!Array.isArray(role.permissions)) { role.permissions = []; }
    return role;
  });

  /* ── API Schema ────────────────────────────────────────── */
  schemas.api_schema = schemas.api_schema || {};
  schemas.api_schema.version  = schemas.api_schema.version  || 'v1';
  schemas.api_schema.base_url = schemas.api_schema.base_url || '/api/v1';
  if (!Array.isArray(schemas.api_schema.endpoints)) { schemas.api_schema.endpoints = []; repairs.push('initialized api endpoints'); }

  const seenEpIds = new Set();
  schemas.api_schema.endpoints = schemas.api_schema.endpoints.map((ep, i) => {
    if (!ep.id) { ep.id = `endpoint_${i}`; repairs.push(`generated id for endpoint[${i}]`); }
    if (seenEpIds.has(ep.id)) { ep.id = `${ep.id}_${i}`; repairs.push(`deduplicated endpoint id → ${ep.id}`); }
    seenEpIds.add(ep.id);
    if (!VALID_HTTP_METHODS.includes(ep.method)) { ep.method = 'GET'; repairs.push(`fixed method for ${ep.id}`); }
    if (!ep.path)        { ep.path = `/${ep.id}`; }
    if (!ep.description) { ep.description = `${ep.method} ${ep.path}`; }
    if (typeof ep.auth !== 'boolean') { ep.auth = true; }
    if (!Array.isArray(ep.roles)) { ep.roles = []; }
    if (!Array.isArray(ep.db_tables_used)) { ep.db_tables_used = []; }
    if (!ep.request_body)  { ep.request_body = null; }
    if (!ep.response)      { ep.response = { success: 'boolean', data: 'object' }; }
    if (!ep.status_codes)  { ep.status_codes = { '200': 'Success', '400': 'Validation error', '401': 'Unauthorized', '404': 'Not found', '500': 'Server error' }; }

    // Validate db_tables_used reference real tables
    const tableNames = new Set(schemas.db_schema.tables.map(t => t.name));
    ep.db_tables_used = ep.db_tables_used.filter(tbl => {
      if (!tableNames.has(tbl)) {
        repairs.push(`removed phantom table ref '${tbl}' from endpoint ${ep.id}`);
        return false;
      }
      return true;
    });
    return ep;
  });

  /* ── UI Schema ─────────────────────────────────────────── */
  schemas.ui_schema = schemas.ui_schema || {};
  schemas.ui_schema.theme = schemas.ui_schema.theme || {};
  if (!schemas.ui_schema.theme.primary)     { schemas.ui_schema.theme.primary = '#6366f1'; }
  if (!schemas.ui_schema.theme.secondary)   { schemas.ui_schema.theme.secondary = '#8b5cf6'; }
  if (!['light','dark'].includes(schemas.ui_schema.theme.mode)) { schemas.ui_schema.theme.mode = 'light'; }
  if (!schemas.ui_schema.theme.font_family) { schemas.ui_schema.theme.font_family = 'Inter'; }
  if (!Array.isArray(schemas.ui_schema.components)) { schemas.ui_schema.components = []; }

  const validEpIds = new Set(schemas.api_schema.endpoints.map(e => e.id));
  const seenCompIds = new Set();

  schemas.ui_schema.components = schemas.ui_schema.components.map((comp, ci) => {
    if (!comp.id) { comp.id = `component_${ci}`; repairs.push(`generated component[${ci}].id`); }
    if (seenCompIds.has(comp.id)) { comp.id = `${comp.id}_${ci}`; repairs.push(`deduplicated component id → ${comp.id}`); }
    seenCompIds.add(comp.id);

    if (!VALID_UI_TYPES.includes(comp.type)) { comp.type = 'Card'; repairs.push(`fixed component ${comp.id} type → Card`); }
    if (!comp.label)   { comp.label = comp.id; }
    if (!comp.page)    { comp.page = '/'; }
    if (!Array.isArray(comp.fields))        { comp.fields = []; }
    if (!Array.isArray(comp.roles_visible)) { comp.roles_visible = []; }

    // Validate api_binding
    if (comp.api_binding && !validEpIds.has(comp.api_binding)) {
      const fuzzyMatch = [...validEpIds].find(id => id.includes(comp.api_binding?.split('_')[0]));
      if (fuzzyMatch) {
        repairs.push(`corrected component ${comp.id} api_binding: '${comp.api_binding}' → '${fuzzyMatch}'`);
        comp.api_binding = fuzzyMatch;
      } else {
        repairs.push(`removed unresolvable api_binding '${comp.api_binding}' from component ${comp.id}`);
        comp.api_binding = null;
      }
    }

    // Validate field types
    comp.fields = comp.fields.map(f => {
      if (!VALID_FIELD_TYPES.includes(f.type)) { f.type = 'text'; }
      if (typeof f.required !== 'boolean') { f.required = false; }
      return f;
    });
    return comp;
  });

  return { valid: errors.length === 0, errors, repairs, sanitized: schemas };
}

/* ─────────────────────────────────────────────────────────────
   STAGE 4: validateValidationReport
───────────────────────────────────────────────────────────── */

function validateValidationReport(report) {
  const repairs = [];

  if (!report || typeof report !== 'object') {
    return {
      valid: false,
      errors: [{ field: '_root', message: 'Validation report must be an object' }],
      repairs: [],
    };
  }

  if (!Array.isArray(report.validation_results)) { report.validation_results = []; repairs.push('initialized validation_results'); }
  if (!Array.isArray(report.repairs))            { report.repairs = []; repairs.push('initialized repairs'); }
  if (!Array.isArray(report.execution_blockers)) { report.execution_blockers = []; }
  if (!Array.isArray(report.warnings))           { report.warnings = []; }

  if (typeof report.consistency_score !== 'number' || isNaN(report.consistency_score)) {
    report.consistency_score = 0;
    repairs.push('defaulted consistency_score to 0');
  }
  report.consistency_score = Math.max(0, Math.min(100, Math.round(report.consistency_score)));

  if (typeof report.is_executable !== 'boolean') {
    report.is_executable = report.execution_blockers.length === 0;
    repairs.push('inferred is_executable from execution_blockers');
  }

  // Validate each result entry
  report.validation_results = report.validation_results.map((r, i) => {
    if (!r.rule)    { r.rule = `rule_${i}`; }
    if (!VALID_LAYERS.includes(r.layer)) { r.layer = 'system'; }
    if (!VALID_STATUSES.includes(r.status)) { r.status = 'warn'; }
    if (!r.message) { r.message = r.rule; }
    if (typeof r.auto_repaired !== 'boolean') { r.auto_repaired = false; }
    return r;
  });

  // Validate each repair entry
  report.repairs = report.repairs.map((r, i) => {
    if (!r.issue)  { r.issue = `repair_${i}`; }
    if (!VALID_LAYERS.includes(r.layer))  { r.layer = 'system'; }
    if (!VALID_SEV.includes(r.severity))  { r.severity = 'minor'; }
    if (!VALID_ACTIONS.includes(r.action)) { r.action = 'modified'; }
    if (!r.before) { r.before = '-'; }
    if (!r.after)  { r.after  = '-'; }
    return r;
  });

  return { valid: true, errors: [], repairs, sanitized: report };
}

/* ─────────────────────────────────────────────────────────────
   crossLayerCheck — programmatic cross-layer consistency check
   Returns array of { rule, layer, status, message }
───────────────────────────────────────────────────────────── */

function crossLayerCheck(intent, design, schemas) {
  const results = [];
  const tableNames = new Set((schemas?.db_schema?.tables || []).map(t => t.name));
  const epIds      = new Set((schemas?.api_schema?.endpoints || []).map(e => e.id));
  const authRoles  = new Set((schemas?.auth_schema?.roles || []).map(r => r.name));
  const intentRoles = new Set(intent?.roles || []);

  const pass = (rule, layer, msg) => results.push({ rule, layer, status: 'pass', message: msg });
  const warn = (rule, layer, msg) => results.push({ rule, layer, status: 'warn', message: msg });
  const fail = (rule, layer, msg) => results.push({ rule, layer, status: 'fail', message: msg });

  // Rule 1: users table
  tableNames.has('users') ? pass('users_table','db','users table present') : fail('users_table','db','users table is missing');

  // Rule 2: all intent roles in auth
  const missingRoles = [...intentRoles].filter(r => !authRoles.has(r));
  missingRoles.length === 0
    ? pass('roles_in_auth','auth','all intent roles defined in auth_schema')
    : fail('roles_in_auth','auth',`roles missing from auth_schema: ${missingRoles.join(', ')}`);

  // Rule 3: unique endpoint IDs
  const epIdArr = (schemas?.api_schema?.endpoints || []).map(e => e.id);
  const dupes   = epIdArr.filter((id,i) => epIdArr.indexOf(id) !== i);
  dupes.length === 0
    ? pass('unique_ep_ids','api','all endpoint IDs are unique')
    : fail('unique_ep_ids','api',`duplicate endpoint IDs: ${dupes.join(', ')}`);

  // Rule 4: all tables have PK
  const noPK = (schemas?.db_schema?.tables || []).filter(t => !t.fields?.some(f => f.primary_key || f.name === 'id'));
  noPK.length === 0
    ? pass('tables_have_pk','db','all tables have a primary key')
    : fail('tables_have_pk','db',`tables without PK: ${noPK.map(t=>t.name).join(', ')}`);

  // Rule 5: no phantom FK targets
  const badFKs = [];
  (schemas?.db_schema?.tables || []).forEach(t =>
    (t.fields || []).forEach(f => {
      if (f.foreign_key) {
        const ref = f.foreign_key.split('.')[0];
        if (!tableNames.has(ref)) badFKs.push(`${t.name}.${f.name} → ${ref}`);
      }
    })
  );
  badFKs.length === 0
    ? pass('valid_fks','db','all foreign keys reference existing tables')
    : warn('valid_fks','db',`invalid FK targets: ${badFKs.slice(0,3).join(', ')}`);

  // Rule 6: UI components bind to real endpoints
  const orphanUI = (schemas?.ui_schema?.components || []).filter(c => c.api_binding && !epIds.has(c.api_binding));
  orphanUI.length === 0
    ? pass('ui_bindings','cross','all UI components bound to existing endpoints')
    : warn('ui_bindings','cross',`orphaned bindings: ${orphanUI.map(c=>c.api_binding).join(', ')}`);

  // Rule 7: admin pages locked to admin role
  const openAdmin = (design?.pages || []).filter(p => p.name?.toLowerCase().includes('admin') && p.auth && !p.roles?.includes('admin'));
  openAdmin.length === 0
    ? pass('admin_secured','cross','all admin pages require admin role')
    : warn('admin_secured','cross',`admin pages missing role gate: ${openAdmin.map(p=>p.path).join(', ')}`);

  // Rule 8: payment table when has_payments
  if (intent?.has_payments) {
    const hasPT = tableNames.has('subscriptions') || tableNames.has('payments') || tableNames.has('orders');
    hasPT
      ? pass('payment_table','db','payment table exists')
      : fail('payment_table','db','no payment/subscription table despite has_payments=true');
  }

  // Rule 9: JWT config
  schemas?.auth_schema?.jwt_expiry
    ? pass('jwt_config','auth','JWT expiry is configured')
    : warn('jwt_config','auth','JWT expiry is not set');

  // Rule 10: entities have DB tables
  const orphanEntities = (design?.entities || []).filter(e =>
    !tableNames.has(e.name.toLowerCase() + 's') && !tableNames.has(e.name.toLowerCase())
  );
  orphanEntities.length === 0
    ? pass('entities_mapped','cross','all design entities have DB tables')
    : warn('entities_mapped','cross',`entities without tables: ${orphanEntities.map(e=>e.name).join(', ')}`);

  // Rule 11: API endpoints reference real DB tables
  const phantomTblRefs = [];
  (schemas?.api_schema?.endpoints || []).forEach(ep =>
    (ep.db_tables_used || []).forEach(tbl => {
      if (!tableNames.has(tbl)) phantomTblRefs.push(`${ep.id} → ${tbl}`);
    })
  );
  phantomTblRefs.length === 0
    ? pass('api_table_refs','cross','all API db_tables_used reference real tables')
    : warn('api_table_refs','cross',`phantom table refs: ${phantomTblRefs.slice(0,3).join(', ')}`);

  // Rule 12: each page that is auth=true has at least one role
  const authPagesNoRoles = (design?.pages || []).filter(p => p.auth && (!p.roles || p.roles.length === 0));
  authPagesNoRoles.length === 0
    ? pass('auth_pages_have_roles','cross','all auth-protected pages specify roles')
    : warn('auth_pages_have_roles','cross',`auth pages missing roles: ${authPagesNoRoles.map(p=>p.path).join(', ')}`);

  const passed = results.filter(r => r.status === 'pass').length;
  const score  = Math.round((passed / Math.max(results.length, 1)) * 100);

  return { results, score, passed, total: results.length };
}

/* ─────────────────────────────────────────────────────────────
   UTILITIES
───────────────────────────────────────────────────────────── */

/** Clean a string: trim, remove control chars, enforce max length */
function sanitizeString(str, maxLen = 255) {
  if (typeof str !== 'string') return '';
  return str.replace(/[\x00-\x1F\x7F]/g, '').trim().slice(0, maxLen);
}

/** Safe type coercion — returns null if impossible */
function coerceType(value, targetType) {
  try {
    if (targetType === 'string')  return String(value);
    if (targetType === 'number')  { const n = Number(value); return isNaN(n) ? null : n; }
    if (targetType === 'boolean') {
      if (value === 'true'  || value === 1) return true;
      if (value === 'false' || value === 0) return false;
      return null;
    }
    if (targetType === 'array')  return Array.isArray(value) ? value : (value ? [value] : []);
    if (targetType === 'object') return (typeof value === 'object' && !Array.isArray(value) && value !== null) ? value : null;
  } catch (_) {}
  return null;
}

/** Build a structured repair log entry */
function buildRepairLog(field, type, message, before, after) {
  return { field, type, message, before: String(before).slice(0, 80), after: String(after).slice(0, 80), timestamp: Date.now() };
}

/** Build a default users table */
function buildUsersTable(intent) {
  return {
    name: 'users',
    description: 'Application users',
    fields: [
      { name: 'id',            type: 'uuid',    required: true,  unique: true,  primary_key: true,  foreign_key: null, default: 'gen_random_uuid()', enum_values: null },
      { name: 'email',         type: 'varchar', required: true,  unique: true,  primary_key: false, foreign_key: null, default: null, enum_values: null },
      { name: 'password_hash', type: 'varchar', required: true,  unique: false, primary_key: false, foreign_key: null, default: null, enum_values: null },
      { name: 'role',          type: 'enum',    required: true,  unique: false, primary_key: false, foreign_key: null, default: 'user', enum_values: intent?.roles || ['user','admin'] },
      { name: 'is_active',     type: 'boolean', required: true,  unique: false, primary_key: false, foreign_key: null, default: true,   enum_values: null },
      { name: 'last_login_at', type: 'timestamp',required:false, unique: false, primary_key: false, foreign_key: null, default: null, enum_values: null },
    ],
    indexes: ['email', 'role'],
    timestamps: true,
  };
}

/** Build a default subscriptions table */
function buildSubscriptionsTable() {
  return {
    name: 'subscriptions',
    description: 'User payment subscriptions via Stripe',
    fields: [
      { name: 'id',                      type: 'uuid',      required: true,  unique: true,  primary_key: true,  foreign_key: null,     default: 'gen_random_uuid()', enum_values: null },
      { name: 'user_id',                 type: 'uuid',      required: true,  unique: false, primary_key: false, foreign_key: 'users.id', default: null, enum_values: null },
      { name: 'stripe_subscription_id',  type: 'varchar',   required: false, unique: true,  primary_key: false, foreign_key: null,     default: null, enum_values: null },
      { name: 'stripe_customer_id',      type: 'varchar',   required: false, unique: false, primary_key: false, foreign_key: null,     default: null, enum_values: null },
      { name: 'plan',                    type: 'enum',      required: true,  unique: false, primary_key: false, foreign_key: null,     default: 'free', enum_values: ['free','premium','enterprise'] },
      { name: 'status',                  type: 'enum',      required: true,  unique: false, primary_key: false, foreign_key: null,     default: 'active', enum_values: ['active','cancelled','past_due','trialing'] },
      { name: 'current_period_start',    type: 'timestamp', required: false, unique: false, primary_key: false, foreign_key: null,     default: null, enum_values: null },
      { name: 'current_period_end',      type: 'timestamp', required: false, unique: false, primary_key: false, foreign_key: null,     default: null, enum_values: null },
    ],
    indexes: ['user_id', 'stripe_subscription_id', 'status'],
    timestamps: true,
  };
}

/* ─────────────────────────────────────────────────────────────
   EXPORTS
───────────────────────────────────────────────────────────── */

module.exports = {
  // Core
  validateSchema,
  assertField,
  // Stage-specific
  validateIntentSchema,
  validateDesignSchema,
  validateSchemasOutput,
  validateValidationReport,
  // Cross-layer
  crossLayerCheck,
  // Utilities
  sanitizeString,
  coerceType,
  buildRepairLog,
  buildUsersTable,
  buildSubscriptionsTable,
  // Constants (exported for testing)
  VALID_APP_TYPES,
  VALID_COMPLEXITY,
  VALID_PAY_MODELS,
  VALID_HTTP_METHODS,
  VALID_DB_TYPES,
  VALID_UI_TYPES,
  VALID_LAYERS,
  VALID_STATUSES,
};
