/**
 * Stage 1: Intent Extraction
 * Converts raw natural language into a structured intermediate representation.
 * Handles vague prompts, detects ambiguities, and documents assumptions.
 */

const { callClaude, parseJSON } = require('./claude');
const { validateSchema } = require('./schemaValidator');

const INTENT_SCHEMA = {
  required: ['app_name','app_type','clarity_score','core_entities','core_features','auth_required','roles'],
  types: {
    app_name: 'string', app_type: 'string', clarity_score: 'number',
    ambiguities: 'array', assumptions: 'array', core_entities: 'array',
    core_features: 'array', auth_required: 'boolean', roles: 'array',
    has_payments: 'boolean', payment_model: 'string', complexity: 'string',
  },
  enums: {
    app_type: ['crm','ecommerce','saas','social','marketplace','education','productivity','other'],
    payment_model: ['free','freemium','subscription','one-time','none'],
    complexity: ['low','medium','high'],
  },
};

const SYSTEM_PROMPT = `You are Stage 1 of an app compiler: Intent Extraction.
Your job is to parse natural language app descriptions into a strict intermediate representation.

RULES:
1. If the prompt is vague, set clarity_score < 40 and list all ambiguities
2. If there are conflicting requirements, list them in ambiguities and pick the most reasonable interpretation
3. Always document every assumption you make
4. Never hallucinate features not implied by the prompt
5. Return ONLY valid JSON — no markdown, no explanation, no backticks

OUTPUT SCHEMA (strict — every field required):
{
  "app_name": "string — inferred name, max 4 words",
  "app_type": "crm|ecommerce|saas|social|marketplace|education|productivity|other",
  "clarity_score": 0-100,
  "ambiguities": ["list of unclear or conflicting requirements"],
  "assumptions": ["list of reasonable defaults you are applying"],
  "core_entities": ["list of main data entities, e.g. User, Contact, Order"],
  "core_features": ["list of distinct features"],
  "auth_required": true|false,
  "roles": ["list of user roles, always includes at least 'user'"],
  "admin_features": ["features only admins can access"],
  "has_payments": true|false,
  "payment_model": "free|freemium|subscription|one-time|none",
  "payment_provider": "stripe|paypal|none",
  "complexity": "low|medium|high",
  "tech_constraints": ["any mentioned tech requirements"],
  "out_of_scope": ["things explicitly excluded or clearly not needed"]
}`;

async function stage1_intentExtraction(prompt) {
  // Pre-process: detect edge cases
  const edgeCase = detectEdgeCase(prompt);

  const userMessage = edgeCase.isEdge
    ? `Parse this app description (note: ${edgeCase.type} detected):\n\n${prompt}\n\nApply reasonable defaults where needed and document all assumptions.`
    : `Parse this app description:\n\n${prompt}`;

  const raw = await callClaude(SYSTEM_PROMPT, userMessage, {
    temperature: 0.1, // Low temp for determinism
    max_tokens: 1200,
  });

  const parsed = parseJSON(raw);

  // Schema validation & field repair
  const validated = validateAndRepair(parsed, prompt, edgeCase);

  return validated;
}

function detectEdgeCase(prompt) {
  const lower = prompt.toLowerCase();
  const wordCount = prompt.split(/\s+/).length;

  if (wordCount < 10) {
    return { isEdge: true, type: 'vague_prompt', severity: 'high' };
  }

  const conflictPatterns = [
    [/free/i, /paid/i],
    [/simple/i, /complex|50 features|many features/i],
    [/everyone/i, /specific|only|enterprise/i],
    [/offline/i, /real.?time/i],
  ];
  for (const [a, b] of conflictPatterns) {
    if (a.test(prompt) && b.test(prompt)) {
      return { isEdge: true, type: 'conflicting_requirements', severity: 'medium' };
    }
  }

  if (wordCount < 25 || !/(app|system|platform|tool|site|build|create)/i.test(prompt)) {
    return { isEdge: true, type: 'underspecified', severity: 'low' };
  }

  return { isEdge: false, type: 'standard', severity: 'none' };
}

function validateAndRepair(parsed, originalPrompt, edgeCase) {
  const repairs = [];

  // Ensure required fields
  if (!parsed.app_name || parsed.app_name.length === 0) {
    parsed.app_name = inferAppName(originalPrompt);
    repairs.push('inferred app_name from prompt');
  }

  if (!Array.isArray(parsed.roles) || parsed.roles.length === 0) {
    parsed.roles = ['user', 'admin'];
    repairs.push('defaulted roles to [user, admin]');
  }

  if (!parsed.roles.includes('user')) {
    parsed.roles.unshift('user');
    repairs.push('added missing base role: user');
  }

  if (typeof parsed.clarity_score !== 'number') {
    parsed.clarity_score = edgeCase.isEdge ? 30 : 70;
    repairs.push('defaulted clarity_score');
  }
  parsed.clarity_score = Math.max(0, Math.min(100, Math.round(parsed.clarity_score)));

  if (!Array.isArray(parsed.ambiguities)) {
    parsed.ambiguities = [];
    if (edgeCase.isEdge) parsed.ambiguities.push(`Detected ${edgeCase.type}`);
  }

  if (!Array.isArray(parsed.assumptions)) parsed.assumptions = [];
  if (!Array.isArray(parsed.core_entities)) parsed.core_entities = ['User'];
  if (!Array.isArray(parsed.core_features)) parsed.core_features = [];
  if (!Array.isArray(parsed.admin_features)) parsed.admin_features = [];
  if (!Array.isArray(parsed.tech_constraints)) parsed.tech_constraints = [];
  if (!Array.isArray(parsed.out_of_scope)) parsed.out_of_scope = [];

  if (typeof parsed.auth_required !== 'boolean') {
    parsed.auth_required = parsed.roles.length > 1 || parsed.has_payments;
    repairs.push('inferred auth_required from roles/payments');
  }

  if (typeof parsed.has_payments !== 'boolean') {
    const paymentKeywords = /payment|stripe|billing|subscription|purchase|buy|checkout|paid/i;
    parsed.has_payments = paymentKeywords.test(JSON.stringify(parsed));
    repairs.push('inferred has_payments from keywords');
  }

  if (!parsed.payment_model) {
    parsed.payment_model = parsed.has_payments ? 'subscription' : 'none';
    repairs.push('defaulted payment_model');
  }

  if (!parsed.payment_provider) {
    parsed.payment_provider = parsed.has_payments ? 'stripe' : 'none';
    repairs.push('defaulted payment_provider to stripe');
  }

  if (!INTENT_SCHEMA.enums.app_type.includes(parsed.app_type)) {
    parsed.app_type = 'other';
    repairs.push('corrected invalid app_type to other');
  }

  if (!INTENT_SCHEMA.enums.complexity.includes(parsed.complexity)) {
    parsed.complexity = parsed.core_features.length > 8 ? 'high' : parsed.core_features.length > 4 ? 'medium' : 'low';
    repairs.push('inferred complexity from feature count');
  }

  if (repairs.length > 0) {
    parsed._stage1_repairs = repairs;
  }

  parsed._edge_case = edgeCase;

  return parsed;
}

function inferAppName(prompt) {
  // Try to extract a name from the prompt
  const match = prompt.match(/build\s+(?:a|an|the)?\s*([a-zA-Z\s]{3,30}?)(?:\s+with|\s+for|\s+that|\s+app|\.|,|$)/i);
  if (match) {
    return match[1].trim().split(' ').slice(0, 3).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('');
  }
  return 'MyApp';
}

module.exports = { stage1_intentExtraction, detectEdgeCase, INTENT_SCHEMA };
