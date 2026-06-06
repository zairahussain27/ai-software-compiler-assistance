/**
 * AppForge Test Suite
 * Tests: JSON repair, programmatic validation, edge case detection,
 * schema validation, and pipeline contracts.
 */

const { repairJSON, parseJSON } = require('./claude');
const { runProgrammaticChecks } = require('./stage4_validation');
const { detectEdgeCase } = require('./stage1_intent');
const { EVAL_DATASET, scoreResult } = require('./evalDataset');

// ── JSON Repair Tests ──────────────────────────────────────────────────────
describe('JSON Repair Engine', () => {
  test('parses clean JSON directly', () => {
    const input = '{"key": "value", "num": 42}';
    expect(parseJSON(input)).toEqual({ key: 'value', num: 42 });
  });

  test('strips markdown code fences', () => {
    const input = '```json\n{"app_name": "TestApp"}\n```';
    expect(parseJSON(input)).toEqual({ app_name: 'TestApp' });
  });

  test('extracts JSON from surrounding text', () => {
    const input = 'Here is the result:\n{"app_name": "TestApp", "type": "crm"}\nDone.';
    expect(parseJSON(input)).toEqual({ app_name: 'TestApp', type: 'crm' });
  });

  test('repairs trailing commas', () => {
    const input = '{"key": "value", "arr": [1, 2, 3,],}';
    const repaired = repairJSON(input);
    expect(() => JSON.parse(repaired)).not.toThrow();
  });

  test('repairs single quotes', () => {
    const input = "{'key': 'value'}";
    const repaired = repairJSON(input);
    expect(() => JSON.parse(repaired)).not.toThrow();
  });

  test('repairs undefined values', () => {
    const input = '{"key": undefined, "other": "ok"}';
    const repaired = repairJSON(input);
    const parsed = JSON.parse(repaired);
    expect(parsed.key).toBeNull();
    expect(parsed.other).toBe('ok');
  });

  test('closes unclosed braces', () => {
    const input = '{"key": "value", "nested": {"a": 1}';
    const repaired = repairJSON(input);
    expect(() => JSON.parse(repaired)).not.toThrow();
  });

  test('closes unclosed arrays', () => {
    const input = '{"items": [1, 2, 3}';
    const repaired = repairJSON(input);
    expect(() => JSON.parse(repaired)).not.toThrow();
  });

  test('throws on completely unparseable input', () => {
    expect(() => parseJSON('this is not json at all')).toThrow();
  });

  test('throws on empty input', () => {
    expect(() => parseJSON('')).toThrow();
    expect(() => parseJSON(null)).toThrow();
  });
});

// ── Edge Case Detection Tests ──────────────────────────────────────────────
describe('Edge Case Detection', () => {
  test('detects vague prompts (< 10 words)', () => {
    const result = detectEdgeCase('build me something for my team');
    expect(result.isEdge).toBe(true);
    expect(result.type).toBe('vague_prompt');
  });

  test('detects conflicting requirements: free vs paid', () => {
    const result = detectEdgeCase('Build an app that is completely free but also has a paid premium tier.');
    expect(result.isEdge).toBe(true);
    expect(result.type).toBe('conflicting_requirements');
  });

  test('detects conflicting: offline + real-time', () => {
    const result = detectEdgeCase('Works fully offline but also needs real-time collaboration.');
    expect(result.isEdge).toBe(true);
    expect(result.type).toBe('conflicting_requirements');
  });

  test('marks clear, detailed prompt as standard', () => {
    const result = detectEdgeCase(
      'Build a CRM with contacts, deals pipeline, role-based access for admin and sales reps, and Stripe payments for premium plan.'
    );
    expect(result.isEdge).toBe(false);
    expect(result.type).toBe('standard');
  });

  test('detects underspecified (short but not vague)', () => {
    const result = detectEdgeCase('I need a dashboard.');
    expect(result.isEdge).toBe(true);
  });
});

// ── Programmatic Validation Tests ─────────────────────────────────────────
describe('Programmatic Validation', () => {
  const mockIntent = {
    roles: ['admin', 'user'],
    has_payments: true,
  };

  const mockDesign = {
    pages: [
      { name: 'Admin', path: '/admin', auth: true, roles: ['admin'] },
      { name: 'Dashboard', path: '/dashboard', auth: true, roles: ['user', 'admin'] },
    ],
    entities: [{ name: 'Contact' }, { name: 'User' }],
  };

  const goodSchemas = {
    db_schema: {
      tables: [
        {
          name: 'users',
          fields: [
            { name: 'id', type: 'uuid', primary_key: true, required: true },
            { name: 'email', type: 'varchar', required: true },
          ],
        },
        {
          name: 'subscriptions',
          fields: [
            { name: 'id', type: 'uuid', primary_key: true, required: true },
            { name: 'user_id', type: 'uuid', foreign_key: 'users.id', required: true },
          ],
        },
        { name: 'contacts', fields: [{ name: 'id', type: 'uuid', primary_key: true, required: true }] },
      ],
    },
    api_schema: {
      endpoints: [
        { id: 'get_contacts', method: 'GET', path: '/contacts', auth: true, roles: ['user'], db_tables_used: ['contacts'] },
        { id: 'create_contact', method: 'POST', path: '/contacts', auth: true, roles: ['user'], db_tables_used: ['contacts'] },
      ],
    },
    auth_schema: {
      provider: 'jwt',
      jwt_expiry: '15m',
      roles: [
        { name: 'admin', permissions: ['*:*'] },
        { name: 'user', permissions: ['contacts:read'] },
      ],
    },
    ui_schema: {
      components: [
        { id: 'contact_table', api_binding: 'get_contacts', roles_visible: ['user'] },
      ],
    },
  };

  test('passes when all constraints satisfied', () => {
    const { results, score } = runProgrammaticChecks(mockIntent, mockDesign, goodSchemas);
    const fails = results.filter(r => r.status === 'fail');
    expect(fails.length).toBe(0);
    expect(score).toBeGreaterThanOrEqual(80);
  });

  test('fails when users table is missing', () => {
    const schemas = { ...goodSchemas, db_schema: { tables: [] } };
    const { results } = runProgrammaticChecks(mockIntent, mockDesign, schemas);
    const usersCheck = results.find(r => r.rule === 'users_table_exists');
    expect(usersCheck?.status).toBe('fail');
  });

  test('fails when intent roles missing from auth_schema', () => {
    const schemas = {
      ...goodSchemas,
      auth_schema: { ...goodSchemas.auth_schema, roles: [{ name: 'user', permissions: [] }] }, // missing admin
    };
    const { results } = runProgrammaticChecks(mockIntent, mockDesign, schemas);
    const rolesCheck = results.find(r => r.rule === 'all_roles_in_auth');
    expect(rolesCheck?.status).toBe('fail');
    expect(rolesCheck?.message).toContain('admin');
  });

  test('detects duplicate endpoint IDs', () => {
    const schemas = {
      ...goodSchemas,
      api_schema: {
        endpoints: [
          { id: 'get_contacts', method: 'GET', path: '/contacts', auth: true, roles: [], db_tables_used: [] },
          { id: 'get_contacts', method: 'POST', path: '/contacts', auth: true, roles: [], db_tables_used: [] }, // duplicate!
        ],
      },
    };
    const { results } = runProgrammaticChecks(mockIntent, mockDesign, schemas);
    const dupeCheck = results.find(r => r.rule === 'unique_endpoint_ids');
    expect(dupeCheck?.status).toBe('fail');
  });

  test('warns on orphaned UI component binding', () => {
    const schemas = {
      ...goodSchemas,
      ui_schema: {
        components: [{ id: 'ghost_form', api_binding: 'nonexistent_endpoint_id', roles_visible: [] }],
      },
    };
    const { results } = runProgrammaticChecks(mockIntent, mockDesign, schemas);
    const uiCheck = results.find(r => r.rule === 'ui_api_bindings');
    expect(uiCheck?.status).not.toBe('pass');
  });

  test('fails when payment table missing and has_payments=true', () => {
    const schemas = {
      ...goodSchemas,
      db_schema: { tables: [{ name: 'users', fields: [{ name: 'id', primary_key: true }] }] },
    };
    const { results } = runProgrammaticChecks(mockIntent, mockDesign, schemas);
    const payCheck = results.find(r => r.rule === 'payment_table_exists');
    expect(payCheck?.status).toBe('fail');
  });

  test('detects tables without primary keys', () => {
    const schemas = {
      ...goodSchemas,
      db_schema: {
        tables: [
          { name: 'users', fields: [{ name: 'email', type: 'varchar', primary_key: false, required: true }] }, // no PK!
        ],
      },
    };
    const { results } = runProgrammaticChecks(mockIntent, mockDesign, schemas);
    const pkCheck = results.find(r => r.rule === 'tables_have_pk');
    expect(pkCheck?.status).toBe('fail');
  });
});

// ── Eval Dataset Tests ─────────────────────────────────────────────────────
describe('Eval Dataset', () => {
  test('has 10 real product prompts', () => {
    expect(EVAL_DATASET.real_product_prompts.length).toBe(10);
  });

  test('has 10 edge cases', () => {
    expect(EVAL_DATASET.edge_cases.length).toBe(10);
  });

  test('all cases have required fields', () => {
    const allCases = [...EVAL_DATASET.real_product_prompts, ...EVAL_DATASET.edge_cases];
    allCases.forEach(c => {
      expect(c.id).toBeDefined();
      expect(c.label).toBeDefined();
      expect(c.prompt).toBeDefined();
      expect(c.category).toBeDefined();
      expect(c.expected).toBeDefined();
    });
  });

  test('all IDs are unique', () => {
    const allCases = [...EVAL_DATASET.real_product_prompts, ...EVAL_DATASET.edge_cases];
    const ids = allCases.map(c => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('edge cases have appropriate expectations', () => {
    const vague = EVAL_DATASET.edge_cases.find(c => c.category === 'vague');
    expect(vague?.expected?.max_clarity_score).toBeLessThan(50);
  });

  test('scoreResult returns 0-100 range', () => {
    const fakeResult = { stages: { intent_extraction: { app_type: 'crm', clarity_score: 85, has_payments: true, roles: ['admin', 'sales', 'viewer'] }, system_design: { pages: new Array(6).fill({}) }, schema_generation: { api_schema: { endpoints: new Array(9).fill({}) }, db_schema: { tables: new Array(4).fill({}) } } } };
    const score = scoreResult(fakeResult, EVAL_DATASET.real_product_prompts[0].expected);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });
});

// ── Pipeline Contract Tests ────────────────────────────────────────────────
describe('Pipeline Stage Contracts', () => {
  test('stage1 export exists and is a function', () => {
    const { stage1_intentExtraction } = require('./stage1_intent');
    expect(typeof stage1_intentExtraction).toBe('function');
  });

  test('stage2 export exists and is a function', () => {
    const { stage2_systemDesign } = require('./stage2_design');
    expect(typeof stage2_systemDesign).toBe('function');
  });

  test('stage3 export exists and is a function', () => {
    const { stage3_schemaGeneration } = require('./stage3_schema');
    expect(typeof stage3_schemaGeneration).toBe('function');
  });

  test('stage4 export exists and is a function', () => {
    const { stage4_validateRepair } = require('./stage4_validation');
    expect(typeof stage4_validateRepair).toBe('function');
  });

  test('stage5 export exists and is a function', () => {
    const { stage5_finalAssembly } = require('./stage5_assembly');
    expect(typeof stage5_finalAssembly).toBe('function');
  });

  test('orchestrator compile is a function', () => {
    const { PipelineOrchestrator } = require('./orchestrator');
    const orch = new PipelineOrchestrator();
    expect(typeof orch.compile).toBe('function');
  });

  test('metrics collector records runs', () => {
    const { MetricsCollector } = require('./metrics');
    const m = new MetricsCollector();
    m.startRun('test-123', 'test prompt');
    m.recordStage('test-123', 'intent_extraction', 500, 1, true);
    m.recordSuccess('test-123', 2000, 85);
    const summary = m.getSummary('test-123');
    expect(summary.status).toBe('success');
    expect(summary.stages.intent_extraction.durationMs).toBe(500);
  });
});
