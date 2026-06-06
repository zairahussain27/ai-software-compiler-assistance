/**
 * Evaluation Dataset
 * 10 real product prompts + 10 edge cases
 * Used to track: success rate, retries per request, failure types, latency
 */

const EVAL_DATASET = {
  real_product_prompts: [
    {
      id: 'eval_001',
      category: 'real',
      label: 'CRM with payments',
      prompt: 'Build a CRM with login, contacts, deals pipeline, role-based access (admin/sales/viewer), dashboard with analytics, and premium plan with Stripe payments. Admins can see all analytics. Sales reps can only manage their own contacts and deals.',
      expected: {
        app_type: 'crm',
        min_pages: 5,
        min_endpoints: 8,
        min_tables: 4,
        has_payments: true,
        roles: ['admin', 'sales', 'viewer'],
        min_clarity_score: 70,
      },
    },
    {
      id: 'eval_002',
      category: 'real',
      label: 'E-learning platform',
      prompt: 'Build an e-learning platform with courses, video lessons, student progress tracking, instructor dashboard, quiz system, certificates on completion, and subscription billing.',
      expected: {
        app_type: 'education',
        min_pages: 6,
        min_endpoints: 10,
        min_tables: 5,
        has_payments: true,
        roles: ['student', 'instructor', 'admin'],
        min_clarity_score: 75,
      },
    },
    {
      id: 'eval_003',
      category: 'real',
      label: 'Project management tool',
      prompt: 'Create a project management tool like Trello with boards, lists, cards, team members, due dates, file attachments, activity logs, and notifications. Teams can have multiple workspaces.',
      expected: {
        app_type: 'productivity',
        min_pages: 4,
        min_endpoints: 12,
        min_tables: 6,
        has_payments: false,
        roles: ['owner', 'member', 'viewer'],
        min_clarity_score: 80,
      },
    },
    {
      id: 'eval_004',
      category: 'real',
      label: 'Multi-vendor marketplace',
      prompt: 'Build a marketplace where vendors can list products, customers can browse and purchase, and admins can manage users and payouts. Include reviews, search/filter, cart, checkout with Stripe, and vendor analytics.',
      expected: {
        app_type: 'marketplace',
        min_pages: 7,
        min_endpoints: 15,
        min_tables: 7,
        has_payments: true,
        roles: ['customer', 'vendor', 'admin'],
        min_clarity_score: 80,
      },
    },
    {
      id: 'eval_005',
      category: 'real',
      label: 'SaaS analytics dashboard',
      prompt: 'Build a SaaS analytics dashboard where users connect their data sources (CSV upload, API), create custom charts and reports, schedule email reports, and share dashboards with team members.',
      expected: {
        app_type: 'saas',
        min_pages: 5,
        min_endpoints: 10,
        min_tables: 5,
        has_payments: false,
        min_clarity_score: 75,
      },
    },
    {
      id: 'eval_006',
      category: 'real',
      label: 'Healthcare appointment booking',
      prompt: 'Healthcare appointment booking system: patients book appointments with doctors, doctors manage schedules and patient records, admins handle billing. Include reminders, video call links, and prescription management.',
      expected: {
        app_type: 'other',
        min_pages: 6,
        min_endpoints: 12,
        min_tables: 6,
        roles: ['patient', 'doctor', 'admin'],
        min_clarity_score: 78,
      },
    },
    {
      id: 'eval_007',
      category: 'real',
      label: 'Social network',
      prompt: 'Build a social network where users can create profiles, post updates, follow others, like and comment on posts, send messages, join groups, and share media. Include notifications and trending topics.',
      expected: {
        app_type: 'social',
        min_pages: 6,
        min_endpoints: 15,
        min_tables: 7,
        min_clarity_score: 80,
      },
    },
    {
      id: 'eval_008',
      category: 'real',
      label: 'Restaurant management system',
      prompt: 'Restaurant management system: online menu, table reservations, order management (dine-in, takeout, delivery), kitchen display, inventory tracking, staff scheduling, and daily revenue reports.',
      expected: {
        app_type: 'other',
        min_pages: 6,
        min_endpoints: 14,
        min_tables: 7,
        min_clarity_score: 82,
      },
    },
    {
      id: 'eval_009',
      category: 'real',
      label: 'HR management system',
      prompt: 'HR management system: employee onboarding, leave management, payroll processing, performance reviews, org chart, job postings and applicant tracking, and document management.',
      expected: {
        app_type: 'productivity',
        min_pages: 8,
        min_endpoints: 16,
        min_tables: 8,
        roles: ['employee', 'manager', 'hr', 'admin'],
        min_clarity_score: 80,
      },
    },
    {
      id: 'eval_010',
      category: 'real',
      label: 'Real estate listings',
      prompt: 'Real estate platform: agents list properties with photos and details, buyers search with filters (price, location, type), schedule viewings, save favorites, and contact agents. Include a mortgage calculator.',
      expected: {
        app_type: 'marketplace',
        min_pages: 5,
        min_endpoints: 10,
        min_tables: 5,
        min_clarity_score: 78,
      },
    },
  ],

  edge_cases: [
    {
      id: 'edge_001',
      category: 'vague',
      label: 'Extremely vague',
      prompt: 'build me something for my team',
      expected: {
        max_clarity_score: 40,
        should_detect_ambiguity: true,
        should_make_assumptions: true,
      },
    },
    {
      id: 'edge_002',
      category: 'vague',
      label: 'Single word',
      prompt: 'app',
      expected: {
        max_clarity_score: 10,
        should_detect_ambiguity: true,
      },
    },
    {
      id: 'edge_003',
      category: 'vague',
      label: 'Vague with domain hint',
      prompt: 'I need something to track stuff for my company',
      expected: {
        max_clarity_score: 35,
        should_detect_ambiguity: true,
      },
    },
    {
      id: 'edge_004',
      category: 'conflicting',
      label: 'Free AND paid',
      prompt: 'Build an app that is completely free but also has a paid premium tier with exclusive features.',
      expected: {
        should_detect_conflict: true,
        has_payments: true,
        payment_model: 'freemium',
      },
    },
    {
      id: 'edge_005',
      category: 'conflicting',
      label: 'Simple but feature-heavy',
      prompt: 'Build a very simple one-page app with 50 advanced features including AI, blockchain, AR, payments, social network, and real-time collaboration.',
      expected: {
        should_detect_conflict: true,
        complexity: 'high',
      },
    },
    {
      id: 'edge_006',
      category: 'conflicting',
      label: 'Everyone but no one',
      prompt: 'The target audience is everyone in general but specifically only enterprise Fortune 500 developers who use Linux.',
      expected: {
        should_detect_conflict: true,
        should_make_assumptions: true,
      },
    },
    {
      id: 'edge_007',
      category: 'conflicting',
      label: 'Offline real-time',
      prompt: 'Build an app that works fully offline with no internet connection but also has real-time collaboration and live sync.',
      expected: {
        should_detect_conflict: true,
      },
    },
    {
      id: 'edge_008',
      category: 'incomplete',
      label: 'Missing auth info',
      prompt: 'Build a dashboard that shows sales data, customer metrics, and revenue charts.',
      expected: {
        auth_required: true, // Should default to true for dashboards
        should_make_assumptions: true,
      },
    },
    {
      id: 'edge_009',
      category: 'incomplete',
      label: 'No database hint',
      prompt: 'I want a contact form that sends emails.',
      expected: {
        complexity: 'low',
        min_tables: 1,
      },
    },
    {
      id: 'edge_010',
      category: 'incomplete',
      label: 'Ambiguous roles',
      prompt: 'Build a platform where some users can do more than others.',
      expected: {
        should_detect_ambiguity: true,
        min_roles: 2,
      },
    },
  ],
};

/**
 * Score a compiled result against expected values.
 * Returns 0-100 score.
 */
function scoreResult(compiled, expected) {
  if (!compiled || !compiled.stages) return 0;

  const intent = compiled.stages.intent_extraction || {};
  const design = compiled.stages.system_design || {};
  const schemas = compiled.stages.schema_generation || {};
  const validation = compiled.stages.validate_repair || {};

  const checks = [];

  if (expected.app_type) checks.push(intent.app_type === expected.app_type);
  if (expected.min_pages) checks.push((design.pages?.length || 0) >= expected.min_pages);
  if (expected.min_endpoints) checks.push((schemas.api_schema?.endpoints?.length || 0) >= expected.min_endpoints);
  if (expected.min_tables) checks.push((schemas.db_schema?.tables?.length || 0) >= expected.min_tables);
  if (expected.has_payments !== undefined) checks.push(intent.has_payments === expected.has_payments);
  if (expected.min_clarity_score) checks.push((intent.clarity_score || 0) >= expected.min_clarity_score);
  if (expected.max_clarity_score) checks.push((intent.clarity_score || 100) <= expected.max_clarity_score);
  if (expected.should_detect_ambiguity) checks.push((intent.ambiguities?.length || 0) > 0);
  if (expected.should_detect_conflict) checks.push((intent.ambiguities?.length || 0) > 0);
  if (expected.should_make_assumptions) checks.push((intent.assumptions?.length || 0) > 0);
  if (expected.min_roles) checks.push((intent.roles?.length || 0) >= expected.min_roles);

  if (checks.length === 0) return 75; // Default score if no checks
  return Math.round((checks.filter(Boolean).length / checks.length) * 100);
}

module.exports = { EVAL_DATASET, scoreResult };
