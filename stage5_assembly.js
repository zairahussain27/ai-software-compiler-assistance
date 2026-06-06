/**
 * Stage 5: Final Assembly
 * Assembles the complete, execution-ready configuration.
 * Generates runtime manifest, dependency list, build steps, env vars.
 * This is the OUTPUT that can directly power code generation.
 */

const { callClaude, parseJSON } = require('./claude');

const SYSTEM_PROMPT = `You are Stage 5 of an app compiler: Final Assembly.
You receive all compiled + validated layers and produce the final executable configuration.

This output must be directly usable to generate a working application.
Include everything a runtime code generator would need.

Return ONLY valid JSON — no markdown, no explanation:
{
  "app_config": {
    "name": "string",
    "slug": "kebab-case",
    "version": "1.0.0",
    "type": "string",
    "generated_at": "ISO timestamp",
    "compiler_version": "AppForge/1.0",
    "run_id": "string"
  },
  "runtime_manifest": {
    "framework": "nextjs|express|fastapi|rails",
    "language": "typescript|javascript|python|ruby",
    "entry_point": "string (e.g. src/index.ts)",
    "port": 3000,
    "env_vars": [
      {
        "key": "SCREAMING_SNAKE_CASE",
        "required": true|false,
        "description": "what it's for",
        "example": "example value (no real secrets)"
      }
    ],
    "dependencies": [
      {
        "package": "npm package name",
        "version": "^x.y.z",
        "reason": "why it's needed"
      }
    ],
    "dev_dependencies": [
      {"package": "string", "version": "string", "reason": "string"}
    ],
    "build_steps": ["ordered list of commands to build the app"],
    "start_command": "string",
    "health_check_endpoint": "/health",
    "health_checks": ["list of things to verify at startup"]
  },
  "file_structure": [
    {"path": "relative/path/file.ts", "description": "what this file contains", "generated_from": "which schema/layer"}
  ],
  "code_generation_hints": {
    "orm": "prisma|typeorm|sequelize|drizzle",
    "auth_library": "next-auth|passport|jose",
    "ui_library": "shadcn|mui|chakra|tailwind",
    "payment_library": "stripe-js|null",
    "api_style": "rest|graphql|trpc"
  },
  "summary": {
    "total_pages": number,
    "total_endpoints": number,
    "total_tables": number,
    "total_roles": number,
    "total_components": number,
    "assumptions_count": number,
    "repairs_count": number,
    "validation_score": number,
    "is_production_ready": true|false,
    "production_readiness_notes": ["list of things needed before production"]
  },
  "next_steps": ["ordered list of actions to take this config to a running app"]
}`;

async function stage5_finalAssembly(intent, design, schemas, validation, runId) {
  const summary = {
    total_pages: design.pages?.length || 0,
    total_endpoints: schemas.api_schema?.endpoints?.length || 0,
    total_tables: schemas.db_schema?.tables?.length || 0,
    total_roles: schemas.auth_schema?.roles?.length || 0,
    total_components: schemas.ui_schema?.components?.length || 0,
    assumptions_count: intent.assumptions?.length || 0,
    repairs_count: validation.repairs?.length || 0,
    validation_score: validation.consistency_score || 0,
  };

  const userMessage = `Assemble the final config for run ${runId}:

INTENT: ${JSON.stringify(intent, null, 2)}
DESIGN: ${JSON.stringify(design, null, 2)}
SCHEMAS: ${JSON.stringify(schemas, null, 2)}
VALIDATION: ${JSON.stringify({ consistency_score: validation.consistency_score, execution_blockers: validation.execution_blockers, warnings: validation.warnings }, null, 2)}
SUMMARY_SO_FAR: ${JSON.stringify(summary, null, 2)}`;

  const raw = await callClaude(SYSTEM_PROMPT, userMessage, {
    temperature: 0.1,
    max_tokens: 2000,
  });

  const parsed = parseJSON(raw);
  return repairAndEnrich(parsed, intent, design, schemas, validation, summary, runId);
}

function repairAndEnrich(parsed, intent, design, schemas, validation, summary, runId) {
  // Ensure app_config
  if (!parsed.app_config) parsed.app_config = {};
  parsed.app_config.name = parsed.app_config.name || intent.app_name || 'MyApp';
  parsed.app_config.slug = parsed.app_config.slug || toSlug(parsed.app_config.name);
  parsed.app_config.version = '1.0.0';
  parsed.app_config.generated_at = new Date().toISOString();
  parsed.app_config.compiler_version = 'AppForge/1.0';
  parsed.app_config.run_id = runId;
  parsed.app_config.type = intent.app_type;

  // Ensure runtime_manifest
  if (!parsed.runtime_manifest) parsed.runtime_manifest = {};
  parsed.runtime_manifest.framework = parsed.runtime_manifest.framework || 'nextjs';
  parsed.runtime_manifest.language = parsed.runtime_manifest.language || 'typescript';
  parsed.runtime_manifest.entry_point = parsed.runtime_manifest.entry_point || 'src/app/page.tsx';
  parsed.runtime_manifest.port = parsed.runtime_manifest.port || 3000;
  parsed.runtime_manifest.health_check_endpoint = '/api/health';

  // Always inject critical env vars
  const envVars = parsed.runtime_manifest.env_vars || [];
  const envKeys = new Set(envVars.map(e => e.key));

  const requiredEnvVars = [
    { key: 'DATABASE_URL', required: true, description: 'PostgreSQL connection string', example: 'postgresql://user:pass@localhost:5432/dbname' },
    { key: 'JWT_SECRET', required: true, description: '256-bit secret for JWT signing', example: 'openssl rand -base64 32' },
    { key: 'NEXT_PUBLIC_APP_URL', required: true, description: 'Public URL of the application', example: 'https://myapp.com' },
    { key: 'NODE_ENV', required: false, description: 'Environment', example: 'production' },
  ];

  if (intent.has_payments) {
    requiredEnvVars.push(
      { key: 'STRIPE_SECRET_KEY', required: true, description: 'Stripe secret key', example: 'sk_live_...' },
      { key: 'STRIPE_WEBHOOK_SECRET', required: true, description: 'Stripe webhook signing secret', example: 'whsec_...' },
      { key: 'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY', required: true, description: 'Stripe publishable key', example: 'pk_live_...' }
    );
  }

  if (design.external_services?.includes('sendgrid') || design.external_services?.includes('email')) {
    requiredEnvVars.push({ key: 'SENDGRID_API_KEY', required: true, description: 'SendGrid API key for emails', example: 'SG.xxx...' });
  }

  requiredEnvVars.forEach(ev => {
    if (!envKeys.has(ev.key)) envVars.push(ev);
  });
  parsed.runtime_manifest.env_vars = envVars;

  // Ensure dependencies
  if (!Array.isArray(parsed.runtime_manifest.dependencies)) parsed.runtime_manifest.dependencies = [];
  const depNames = new Set(parsed.runtime_manifest.dependencies.map(d => d.package));

  const coreDeps = [
    { package: 'next', version: '^14.2.0', reason: 'React framework' },
    { package: 'react', version: '^18.3.0', reason: 'UI library' },
    { package: 'react-dom', version: '^18.3.0', reason: 'React DOM' },
    { package: '@prisma/client', version: '^5.14.0', reason: 'ORM for DB access' },
    { package: 'zod', version: '^3.23.0', reason: 'Schema validation' },
    { package: 'bcryptjs', version: '^2.4.3', reason: 'Password hashing' },
    { package: 'jose', version: '^5.2.0', reason: 'JWT handling' },
  ];

  if (intent.has_payments) {
    coreDeps.push({ package: 'stripe', version: '^15.7.0', reason: 'Stripe payment processing' });
    coreDeps.push({ package: '@stripe/stripe-js', version: '^3.4.0', reason: 'Stripe.js client' });
  }

  coreDeps.forEach(dep => {
    if (!depNames.has(dep.package)) parsed.runtime_manifest.dependencies.push(dep);
  });

  if (!Array.isArray(parsed.runtime_manifest.dev_dependencies)) {
    parsed.runtime_manifest.dev_dependencies = [
      { package: 'prisma', version: '^5.14.0', reason: 'Prisma CLI for migrations' },
      { package: 'typescript', version: '^5.4.0', reason: 'TypeScript compiler' },
      { package: '@types/node', version: '^20.0.0', reason: 'Node.js type definitions' },
      { package: '@types/react', version: '^18.3.0', reason: 'React type definitions' },
      { package: 'tailwindcss', version: '^3.4.0', reason: 'Utility-first CSS' },
    ];
  }

  // Build steps
  if (!Array.isArray(parsed.runtime_manifest.build_steps)) {
    parsed.runtime_manifest.build_steps = [
      'npm install',
      'npx prisma generate',
      'npx prisma migrate deploy',
      'npm run build',
    ];
  }

  parsed.runtime_manifest.start_command = parsed.runtime_manifest.start_command || 'npm start';
  parsed.runtime_manifest.health_checks = [
    'Database connection established',
    'JWT secret loaded',
    ...(intent.has_payments ? ['Stripe API key valid'] : []),
    'All required env vars present',
  ];

  // Code generation hints
  if (!parsed.code_generation_hints) {
    parsed.code_generation_hints = {
      orm: 'prisma',
      auth_library: 'jose',
      ui_library: 'tailwind',
      payment_library: intent.has_payments ? 'stripe-js' : null,
      api_style: 'rest',
    };
  }

  // File structure
  if (!Array.isArray(parsed.file_structure)) {
    parsed.file_structure = generateFileStructure(design, schemas);
  }

  // Summary
  const isProductionReady = validation.is_executable && validation.consistency_score >= 70 && validation.execution_blockers.length === 0;
  parsed.summary = {
    ...summary,
    is_production_ready: isProductionReady,
    production_readiness_notes: isProductionReady ? [] : [
      ...(validation.execution_blockers || []),
      ...((validation.consistency_score || 0) < 70 ? [`Consistency score ${validation.consistency_score}/100 is below threshold (70)`] : []),
    ],
  };

  // Next steps
  if (!Array.isArray(parsed.next_steps)) {
    parsed.next_steps = [
      '1. Set all required environment variables from runtime_manifest.env_vars',
      '2. Run npm install to install all dependencies',
      '3. Run npx prisma migrate dev to create database tables',
      '4. Run npm run dev to start the development server',
      ...(intent.has_payments ? ['5. Configure Stripe webhook endpoint at /api/webhooks/stripe'] : []),
      `${intent.has_payments ? '6' : '5'}. Deploy to ${design.deployment_target || 'Vercel'} using the build steps in runtime_manifest`,
    ];
  }

  return parsed;
}

function toSlug(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function generateFileStructure(design, schemas) {
  const files = [
    { path: 'src/app/page.tsx', description: 'Landing page', generated_from: 'ui_schema' },
    { path: 'src/app/layout.tsx', description: 'Root layout', generated_from: 'ui_schema.theme' },
    { path: 'src/app/api/health/route.ts', description: 'Health check endpoint', generated_from: 'runtime_manifest' },
    { path: 'prisma/schema.prisma', description: 'Prisma database schema', generated_from: 'db_schema' },
    { path: 'src/lib/auth.ts', description: 'JWT auth utilities', generated_from: 'auth_schema' },
    { path: 'src/lib/db.ts', description: 'Prisma client singleton', generated_from: 'db_schema' },
    { path: 'src/middleware.ts', description: 'Auth middleware', generated_from: 'auth_schema.middleware' },
    { path: 'src/types/index.ts', description: 'TypeScript type definitions', generated_from: 'all schemas' },
  ];

  // Add page files
  (design.pages || []).forEach(page => {
    const slug = page.path.replace(/^\//, '') || 'home';
    files.push({
      path: `src/app/${slug}/page.tsx`,
      description: page.description || `${page.name} page`,
      generated_from: 'ui_schema',
    });
  });

  // Add API route files
  const groups = new Set();
  (schemas.api_schema?.endpoints || []).forEach(ep => {
    const parts = ep.path.split('/').filter(Boolean);
    if (parts.length > 0) groups.add(parts[0]);
  });
  groups.forEach(group => {
    files.push({ path: `src/app/api/${group}/route.ts`, description: `${group} API routes`, generated_from: 'api_schema' });
  });

  // Add component files
  (schemas.ui_schema?.components || []).slice(0, 10).forEach(comp => {
    files.push({ path: `src/components/${comp.id}.tsx`, description: comp.label || comp.type, generated_from: 'ui_schema.components' });
  });

  return files;
}

module.exports = { stage5_finalAssembly };
