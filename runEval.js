#!/usr/bin/env node
/**
 * AppForge Evaluation Runner
 * 
 * Runs the 20-case evaluation dataset (10 real + 10 edge cases)
 * and produces a detailed metrics report.
 *
 * Usage:
 *   node evaluation/runEval.js              # runs 5 cases (fast)
 *   node evaluation/runEval.js --full       # runs all 20 cases
 *   node evaluation/runEval.js --category real
 *   node evaluation/runEval.js --category edge
 *   node evaluation/runEval.js --id eval_001
 */

require('dotenv').config();
const { PipelineOrchestrator } = require('./orchestrator');
const { EVAL_DATASET, scoreResult } = require('./evalDataset');

// ── CLI args ──────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const isFull = args.includes('--full');
const categoryArg = args.find(a => a.startsWith('--category'))?.split('=')[1] || args[args.indexOf('--category') + 1];
const idArg = args.find(a => a.startsWith('--id'))?.split('=')[1] || args[args.indexOf('--id') + 1];

// ── Setup ──────────────────────────────────────────────────────────────────
const orchestrator = new PipelineOrchestrator({
  maxRetries: 2,
  timeoutMs: 120000,
  strictMode: false,
});

// ── Select cases ───────────────────────────────────────────────────────────
let cases = [...EVAL_DATASET.real_product_prompts, ...EVAL_DATASET.edge_cases];
if (categoryArg === 'real') cases = EVAL_DATASET.real_product_prompts;
if (categoryArg === 'edge') cases = EVAL_DATASET.edge_cases;
if (idArg) cases = cases.filter(c => c.id === idArg);
if (!isFull && !idArg) cases = cases.slice(0, 5); // default: 5 cases

// ── Colors ────────────────────────────────────────────────────────────────
const c = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m',
  blue: '\x1b[34m', cyan: '\x1b[36m', magenta: '\x1b[35m',
  white: '\x1b[37m',
};

function col(color, text) { return `${c[color]}${text}${c.reset}`; }
function pad(s, n) { return String(s).padEnd(n, ' ').slice(0, n); }

// ── Banner ────────────────────────────────────────────────────────────────
console.log('\n' + col('bold', col('cyan', '╔══════════════════════════════════════════════════╗')));
console.log(col('bold', col('cyan', '║          AppForge Evaluation Framework           ║')));
console.log(col('bold', col('cyan', '╚══════════════════════════════════════════════════╝')));
console.log(`\n${col('dim', '// Running')} ${col('white', cases.length)} ${col('dim', 'test cases')} ${isFull ? col('yellow', '[full suite]') : col('dim', '[quick mode]')}\n`);

// ── Run ────────────────────────────────────────────────────────────────────
async function runEval() {
  const results = [];
  let caseNum = 0;

  for (const evalCase of cases) {
    caseNum++;
    const prefix = `[${String(caseNum).padStart(2,'0')}/${cases.length}]`;
    const catTag = evalCase.category === 'real' ? col('blue', 'REAL') : col('yellow', 'EDGE');

    process.stdout.write(
      `${col('dim', prefix)} ${catTag} ${col('white', pad(evalCase.label, 35))} `
    );

    const start = Date.now();
    let status = 'success';
    let compiled = null;
    let error = null;

    try {
      compiled = await orchestrator.compile(evalCase.prompt);
    } catch (err) {
      status = 'failed';
      error = err.message;
    }

    const duration = Date.now() - start;
    const evalScore = compiled ? scoreResult(compiled, evalCase.expected) : 0;
    const consistency = compiled?.stages?.validate_repair?.consistency_score || 0;
    const repairs = compiled?.stages?.validate_repair?.repairs?.length || 0;
    const executable = compiled?.stages?.validate_repair?.is_executable || false;
    const retries = compiled?.repairLog?.length || 0;

    // Print result line
    if (status === 'success') {
      const scoreColor = evalScore >= 80 ? 'green' : evalScore >= 60 ? 'yellow' : 'red';
      const consColor = consistency >= 80 ? 'green' : consistency >= 60 ? 'yellow' : 'red';
      console.log(
        col('green', '✓') +
        `  eval:${col(scoreColor, String(evalScore).padStart(3))}` +
        `  cons:${col(consColor, String(consistency).padStart(3))}` +
        `  repairs:${col(repairs > 0 ? 'yellow' : 'green', String(repairs).padStart(2))}` +
        `  ${executable ? col('green', 'exec✓') : col('red', 'exec✗')}` +
        `  retries:${col(retries > 0 ? 'yellow' : 'green', String(retries))}` +
        `  ${col('dim', duration + 'ms')}`
      );
    } else {
      console.log(col('red', '✗') + `  ${col('red', error?.slice(0, 60))}`);
    }

    results.push({
      ...evalCase,
      status,
      durationMs: duration,
      evalScore,
      consistency,
      repairs,
      executable,
      retries,
      error,
    });
  }

  // ── Summary ──────────────────────────────────────────────────────────────
  const succeeded = results.filter(r => r.status === 'success');
  const failed = results.filter(r => r.status === 'failed');
  const successRate = Math.round(succeeded.length / results.length * 100);
  const avgEval = succeeded.length ? Math.round(succeeded.reduce((a,b) => a + b.evalScore, 0) / succeeded.length) : 0;
  const avgCons = succeeded.length ? Math.round(succeeded.reduce((a,b) => a + b.consistency, 0) / succeeded.length) : 0;
  const avgLatency = Math.round(results.reduce((a,b) => a + b.durationMs, 0) / results.length);
  const totalRepairs = results.reduce((a,b) => a + b.repairs, 0);
  const executableCount = succeeded.filter(r => r.executable).length;
  const totalRetries = results.reduce((a,b) => a + b.retries, 0);
  const avgRetriesPerRun = (totalRetries / results.length).toFixed(2);

  // Breakdown by category
  const realResults = results.filter(r => r.category === 'real');
  const edgeResults = results.filter(r => r.category === 'edge');
  const realSuccess = realResults.filter(r => r.status === 'success').length;
  const edgeSuccess = edgeResults.filter(r => r.status === 'success').length;

  // Failure types
  const failureTypes = {};
  failed.forEach(r => {
    const type = categorizeError(r.error || '');
    failureTypes[type] = (failureTypes[type] || 0) + 1;
  });

  console.log('\n' + col('dim', '─'.repeat(60)));
  console.log(col('bold', '\n  📊 EVALUATION RESULTS\n'));

  const metricRow = (label, value, note = '') =>
    console.log(`  ${col('dim', pad(label + ':', 28))} ${col('white', String(value))} ${col('dim', note)}`);

  metricRow('Success Rate', `${successRate}%`, `(${succeeded.length}/${results.length})`);
  metricRow('Avg Eval Score', `${avgEval}/100`, `(threshold ≥ 80)`);;
  metricRow('Avg Consistency Score', `${avgCons}/100`, `(threshold ≥ 80)`);
  metricRow('Avg Latency', `${(avgLatency/1000).toFixed(1)}s`, `per compile`);
  metricRow('Avg Retries Per Run', avgRetriesPerRun, '(targeted, not full retry)');
  metricRow('Total Auto-Repairs', totalRepairs, `across ${results.length} runs`);
  metricRow('Executable Outputs', `${executableCount}/${succeeded.length}`, `(${Math.round(executableCount/Math.max(succeeded.length,1)*100)}%)`);

  if (realResults.length) metricRow('Real Prompt Success', `${realSuccess}/${realResults.length}`, `(${Math.round(realSuccess/realResults.length*100)}%)`);
  if (edgeResults.length) metricRow('Edge Case Success', `${edgeSuccess}/${edgeResults.length}`, `(${Math.round(edgeSuccess/edgeResults.length*100)}%)`);

  if (Object.keys(failureTypes).length) {
    console.log(`\n  ${col('red', 'Failure Types:')}`);
    Object.entries(failureTypes).forEach(([type, count]) => {
      console.log(`    ${col('dim', '·')} ${col('yellow', type)}: ${count}`);
    });
  }

  // Per-case table
  console.log('\n' + col('dim', '─'.repeat(60)));
  console.log(col('bold', '\n  📋 PER-CASE RESULTS\n'));
  console.log(
    col('dim',
      `  ${'ID'.padEnd(10)} ${'Label'.padEnd(28)} ${'Cat'.padEnd(5)} ${'Eval'.padEnd(5)} ${'Cons'.padEnd(5)} ${'Rep'.padEnd(4)} ${'Exec'.padEnd(5)} ${'ms'.padEnd(6)} Status`
    )
  );
  console.log(col('dim', '  ' + '─'.repeat(80)));

  results.forEach(r => {
    const scoreColor = r.evalScore >= 80 ? 'green' : r.evalScore >= 60 ? 'yellow' : 'red';
    const consColor = r.consistency >= 80 ? 'green' : r.consistency >= 60 ? 'yellow' : 'red';
    const statusIcon = r.status === 'success' ? col('green', '✓') : col('red', '✗');
    console.log(
      `  ${col('dim', pad(r.id, 10))} ` +
      `${pad(r.label, 28)} ` +
      `${r.category === 'real' ? col('blue', 'real ') : col('yellow', 'edge ')} ` +
      `${col(scoreColor, String(r.evalScore || 0).padEnd(5))} ` +
      `${col(consColor, String(r.consistency || 0).padEnd(5))} ` +
      `${col(r.repairs > 0 ? 'yellow' : 'dim', String(r.repairs || 0).padEnd(4))} ` +
      `${r.executable ? col('green', 'yes  ') : col('red', 'no   ')} ` +
      `${col('dim', String(r.durationMs).padEnd(6))} ` +
      `${statusIcon}`
    );
  });

  // Final verdict
  console.log('\n' + col('dim', '─'.repeat(60)) + '\n');
  const passing = successRate >= 80 && avgEval >= 60;
  if (passing) {
    console.log(col('green', col('bold', '  ✅ EVAL SUITE PASSED')));
  } else {
    console.log(col('red', col('bold', '  ❌ EVAL SUITE NEEDS IMPROVEMENT')));
  }
  console.log(col('dim', `  ${new Date().toISOString()}\n`));

  // Write results to file
  const fs = require('fs');
  const outPath = `evaluation/results_${Date.now()}.json`;
  fs.writeFileSync(outPath, JSON.stringify({
    runAt: new Date().toISOString(),
    summary: { successRate, avgEvalScore: avgEval, avgConsistencyScore: avgCons, avgLatencyMs: avgLatency, avgRetriesPerRun: parseFloat(avgRetriesPerRun), totalAutoRepairs: totalRepairs, executableCount, failureTypes },
    cases: results.map(r => ({
      id: r.id, label: r.label, category: r.category, status: r.status,
      evalScore: r.evalScore, consistency: r.consistency, repairs: r.repairs,
      executable: r.executable, retries: r.retries, durationMs: r.durationMs,
      error: r.error || null,
    })),
  }, null, 2));
  console.log(col('dim', `  Results saved to ${outPath}\n`));
}

function categorizeError(msg) {
  const m = msg.toLowerCase();
  if (m.includes('json') || m.includes('parse')) return 'json_parse_error';
  if (m.includes('timeout')) return 'timeout';
  if (m.includes('api') || m.includes('anthropic')) return 'api_error';
  if (m.includes('empty')) return 'empty_response';
  return 'unknown_error';
}

runEval().catch(err => {
  console.error(col('red', '\n  Fatal eval error: ' + err.message));
  process.exit(1);
});
