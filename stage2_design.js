/**
 * Stage 2: System Design Layer
 * Converts structured intent → full app architecture.
 * Defines pages, API groups, entities, flows, roles.
 */

const { callClaude, parseJSON } = require('./claude');

const SYSTEM_PROMPT = `You are Stage 2 of an app compiler: System Design.
You receive a structured intent object and produce a complete system architecture.

RULES:
1. Every page must have a defined path, auth requirement, and allowed roles
2. Every API endpoint must have a method, path, description, and auth info
3. Entities must list their relations (e.g. "User hasMany Contact")
4. Feature flags control premium/gated features
5. Return ONLY valid JSON — no markdown, no explanation

OUTPUT SCHEMA:
{
  "architecture": "monolith|microservices|serverless",
  "reasoning": "1 sentence explaining architecture choice",
  "pages": [
    {
      "name": "string",
      "path": "string (e.g. /dashboard)",
      "auth": true|false,
      "roles": ["which roles can access"],
      "layout": "dashboard|auth|marketing|blank",
      "components": ["list of component types on this page"],
      "description": "what this page does"
    }
  ],
  "api_groups": [
    {
      "group": "string (e.g. auth, users, contacts)",
      "base_path": "/api/v1/...",
      "endpoints": [
        {
          "id": "unique snake_case id",
          "method": "GET|POST|PUT|PATCH|DELETE",
          "path": "string (relative to base_path)",
          "auth": true|false,
          "roles": ["allowed roles, empty = all authenticated"],
          "description": "what this endpoint does",
          "rate_limited": true|false
        }
      ]
    }
  ],
  "entities": [
    {
      "name": "string",
      "description": "what this entity represents",
      "relations": ["User hasMany Contact", "Contact belongsTo User"],
      "soft_delete": true|false
    }
  ],
  "auth_flows": ["login", "register", "password_reset", "oauth_google", etc.],
  "feature_flags": [
    {
      "flag": "snake_case_name",
      "description": "what feature this gates",
      "enabled_for": "all|premium|admin|staff"
    }
  ],
  "external_services": ["stripe", "sendgrid", "s3", etc.],
  "deployment_target": "vercel|aws|gcp|heroku|docker",
  "estimated_complexity_hours": number
}`;

async function stage2_systemDesign(intent) {
  const userMessage = `Design the system architecture for this app:\n\n${JSON.stringify(intent, null, 2)}

Consider:
- clarity_score: ${intent.clarity_score} (lower = be more conservative with features)
- complexity: ${intent.complexity}
- roles: ${intent.roles?.join(', ')}
- has_payments: ${intent.has_payments}`;

  const raw = await callClaude(SYSTEM_PROMPT, userMessage, {
    temperature: 0.1,
    max_tokens: 2000,
  });

  const parsed = parseJSON(raw);
  return validateAndRepair(parsed, intent);
}

function validateAndRepair(parsed, intent) {
  const repairs = [];

  // Architecture default
  if (!['monolith','microservices','serverless'].includes(parsed.architecture)) {
    parsed.architecture = 'monolith';
    repairs.push('defaulted architecture to monolith');
  }

  // Ensure pages array
  if (!Array.isArray(parsed.pages) || parsed.pages.length === 0) {
    parsed.pages = buildDefaultPages(intent);
    repairs.push('generated default pages from intent');
  }

  // Ensure every page has required fields
  parsed.pages = parsed.pages.map(page => {
    if (!page.path) page.path = '/' + page.name.toLowerCase().replace(/\s+/g, '-');
    if (!Array.isArray(page.roles)) page.roles = page.auth ? ['user'] : [];
    if (!Array.isArray(page.components)) page.components = [];
    if (!page.layout) page.layout = page.auth ? 'dashboard' : 'marketing';
    return page;
  });

  // Ensure auth page exists if auth_required
  if (intent.auth_required && !parsed.pages.some(p => p.path === '/login')) {
    parsed.pages.unshift({ name: 'Login', path: '/login', auth: false, roles: [], layout: 'auth', components: ['LoginForm'], description: 'User authentication' });
    repairs.push('added missing login page');
  }

  // Ensure API groups
  if (!Array.isArray(parsed.api_groups)) {
    parsed.api_groups = [];
    repairs.push('initialized empty api_groups');
  }

  // Ensure auth API group exists
  if (intent.auth_required && !parsed.api_groups.some(g => g.group === 'auth')) {
    parsed.api_groups.unshift({
      group: 'auth',
      base_path: '/api/v1/auth',
      endpoints: [
        { id: 'auth_login', method: 'POST', path: '/login', auth: false, roles: [], description: 'Authenticate user', rate_limited: true },
        { id: 'auth_register', method: 'POST', path: '/register', auth: false, roles: [], description: 'Register new user', rate_limited: true },
        { id: 'auth_refresh', method: 'POST', path: '/refresh', auth: true, roles: [], description: 'Refresh JWT token', rate_limited: false },
        { id: 'auth_logout', method: 'POST', path: '/logout', auth: true, roles: [], description: 'Logout user', rate_limited: false },
      ],
    });
    repairs.push('added missing auth API group');
  }

  // Validate all endpoints have IDs
  parsed.api_groups.forEach(group => {
    if (!Array.isArray(group.endpoints)) { group.endpoints = []; return; }
    group.endpoints = group.endpoints.map((ep, i) => {
      if (!ep.id) {
        ep.id = `${group.group}_${ep.method?.toLowerCase()}_${i}`;
        repairs.push(`generated missing endpoint id for ${ep.path}`);
      }
      if (!Array.isArray(ep.roles)) ep.roles = [];
      if (typeof ep.rate_limited !== 'boolean') ep.rate_limited = ep.method === 'POST';
      return ep;
    });
  });

  // Ensure entities
  if (!Array.isArray(parsed.entities) || parsed.entities.length === 0) {
    parsed.entities = intent.core_entities.map(name => ({
      name, description: `${name} entity`, relations: [], soft_delete: false,
    }));
    repairs.push('generated entities from core_entities');
  }

  // Ensure User entity always exists
  if (!parsed.entities.some(e => e.name === 'User')) {
    parsed.entities.unshift({ name: 'User', description: 'Application user', relations: [], soft_delete: false });
    repairs.push('added missing User entity');
  }

  if (!Array.isArray(parsed.auth_flows)) parsed.auth_flows = intent.auth_required ? ['login', 'register', 'password_reset'] : [];
  if (!Array.isArray(parsed.feature_flags)) parsed.feature_flags = [];
  if (!Array.isArray(parsed.external_services)) parsed.external_services = [];

  // Add Stripe if payments
  if (intent.has_payments && !parsed.external_services.includes('stripe')) {
    parsed.external_services.push('stripe');
    repairs.push('added stripe to external_services (payments detected)');
  }

  if (!parsed.deployment_target) parsed.deployment_target = 'vercel';
  if (!parsed.estimated_complexity_hours) {
    const base = { low: 40, medium: 120, high: 300 };
    parsed.estimated_complexity_hours = base[intent.complexity] || 120;
  }

  if (repairs.length > 0) parsed._stage2_repairs = repairs;

  return parsed;
}

function buildDefaultPages(intent) {
  const pages = [
    { name: 'Landing', path: '/', auth: false, roles: [], layout: 'marketing', components: ['HeroSection', 'FeatureList', 'CTA'], description: 'Public landing page' },
    { name: 'Dashboard', path: '/dashboard', auth: true, roles: ['user', 'admin'], layout: 'dashboard', components: ['StatsCards', 'RecentActivity'], description: 'Main dashboard' },
  ];
  if (intent.auth_required) {
    pages.push({ name: 'Login', path: '/login', auth: false, roles: [], layout: 'auth', components: ['LoginForm'], description: 'Sign in' });
    pages.push({ name: 'Register', path: '/register', auth: false, roles: [], layout: 'auth', components: ['RegisterForm'], description: 'Sign up' });
  }
  if (intent.admin_features?.length > 0 || intent.roles?.includes('admin')) {
    pages.push({ name: 'Admin', path: '/admin', auth: true, roles: ['admin'], layout: 'dashboard', components: ['Analytics', 'UserManagement'], description: 'Admin panel' });
  }
  return pages;
}

module.exports = { stage2_systemDesign };
