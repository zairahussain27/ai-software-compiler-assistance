/**
 * AppForge API Server
 * Express backend exposing the pipeline as a REST API.
 * Endpoints:
 *   POST /api/compile       — run the full 5-stage pipeline
 *   GET  /api/health        — health check
 *   GET  /api/metrics       — global evaluation metrics
 *   POST /api/eval/run      — run evaluation dataset
 *   GET  /api/eval/dataset  — get the eval dataset
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const { PipelineOrchestrator } = require('./orchestrator');
const { globalMetrics } = require('./metrics');
const { EVAL_DATASET, scoreResult } = require('./evalDataset');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, './frontend')));

const orchestrator = new PipelineOrchestrator({
  maxRetries: 2,
  timeoutMs: 120000,
  strictMode: false,
});

/* ── Health ────────────────────────────────────────────────────────────── */
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'AppForge',
    version: '1.0.0',
    uptime: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

/* ── Compile ───────────────────────────────────────────────────────────── */
app.post('/api/compile', async (req, res) => {
  const { prompt, options = {} } = req.body;

  if (!prompt || typeof prompt !== 'string') {
    return res.status(400).json({ error: 'prompt is required and must be a string' });
  }
  if (prompt.length > 50000) {
    return res.status(400).json({ error: 'prompt exceeds 2000 character limit' });
  }

  try {
    const result = await orchestrator.compile(prompt, options);
    res.json(result);
  } catch (err) {
    console.error('Compile error:', err);
    res.status(500).json({
      error: 'Pipeline execution failed',
      message: err.message,
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
    });
  }
});

/* ── Metrics ───────────────────────────────────────────────────────────── */
app.get('/api/metrics', (req, res) => {
  res.json(globalMetrics.getGlobalMetrics());
});

/* ── Eval Dataset ──────────────────────────────────────────────────────── */
app.get('/api/eval/dataset', (req, res) => {
  res.json(EVAL_DATASET);
});

/* ── Run Eval ──────────────────────────────────────────────────────────── */
app.post('/api/eval/run', async (req, res) => {
  const { category = 'all', limit = 3 } = req.body;

  let cases = [
    ...EVAL_DATASET.real_product_prompts,
    ...EVAL_DATASET.edge_cases,
  ];

  if (category === 'real') cases = EVAL_DATASET.real_product_prompts;
  if (category === 'edge') cases = EVAL_DATASET.edge_cases;

  cases = cases.slice(0, Math.min(limit, 5)); // cap at 5 for cost

  const results = [];
  for (const evalCase of cases) {
    const start = Date.now();
    try {
      const compiled = await orchestrator.compile(evalCase.prompt);
      const evalScore = scoreResult(compiled, evalCase.expected);
      results.push({
        id: evalCase.id,
        label: evalCase.label,
        category: evalCase.category,
        status: 'success',
        durationMs: Date.now() - start,
        evalScore,
        consistencyScore: compiled.stages?.validate_repair?.consistency_score || 0,
        repairs: compiled.stages?.validate_repair?.repairs?.length || 0,
        isExecutable: compiled.stages?.validate_repair?.is_executable || false,
      });
    } catch (err) {
      results.push({
        id: evalCase.id,
        label: evalCase.label,
        category: evalCase.category,
        status: 'failed',
        durationMs: Date.now() - start,
        error: err.message,
      });
    }
  }

  const successCount = results.filter(r => r.status === 'success').length;
  const avgScore = results.filter(r=>r.evalScore).reduce((a,b)=>a+(b.evalScore||0),0) / Math.max(successCount,1);
  const avgLatency = results.reduce((a,b)=>a+b.durationMs,0) / results.length;

  res.json({
    summary: {
      total: results.length,
      success: successCount,
      failed: results.length - successCount,
      successRate: Math.round(successCount / results.length * 100),
      avgEvalScore: Math.round(avgScore),
      avgLatencyMs: Math.round(avgLatency),
    },
    results,
  });
});

/* ── Serve frontend ───────────────────────────────────────────────────── */
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, './index.html'));
});

app.listen(PORT, () => {
  console.log(`\n🚀 AppForge API running on http://localhost:${PORT}`);
  console.log(`📊 Metrics: http://localhost:${PORT}/api/metrics`);
  console.log(`❤️  Health:  http://localhost:${PORT}/api/health\n`);
});

module.exports = app;
