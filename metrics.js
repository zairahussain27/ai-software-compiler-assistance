/**
 * MetricsCollector — Evaluation Framework
 * Tracks: success rate, retries, failure types, latency, consistency scores.
 * Powers the /eval endpoint and evaluation dataset.
 */

class MetricsCollector {
  constructor() {
    this.runs = new Map();
    this.aggregates = {
      totalRuns: 0,
      successfulRuns: 0,
      failedRuns: 0,
      totalRetries: 0,
      totalLatencyMs: 0,
      consistencyScores: [],
      failureTypes: {},
      stageLatencies: {},
    };
  }

  startRun(runId, prompt) {
    this.runs.set(runId, {
      runId,
      prompt: prompt.slice(0, 100),
      startTime: Date.now(),
      stages: {},
      status: 'running',
      retries: 0,
      errors: [],
    });
    this.aggregates.totalRuns++;
  }

  recordStage(runId, stageName, durationMs, attempts, success) {
    const run = this.runs.get(runId);
    if (!run) return;

    const retries = Math.max(0, attempts - 1);
    run.stages[stageName] = { durationMs, attempts, retries, success };
    run.retries += retries;
    this.aggregates.totalRetries += retries;

    if (!this.aggregates.stageLatencies[stageName]) {
      this.aggregates.stageLatencies[stageName] = [];
    }
    this.aggregates.stageLatencies[stageName].push(durationMs);
  }

  recordSuccess(runId, totalDurationMs, consistencyScore) {
    const run = this.runs.get(runId);
    if (!run) return;
    run.status = 'success';
    run.totalDurationMs = totalDurationMs;
    run.consistencyScore = consistencyScore;
    this.aggregates.successfulRuns++;
    this.aggregates.totalLatencyMs += totalDurationMs;
    this.aggregates.consistencyScores.push(consistencyScore);
  }

  recordFailure(runId, failedStage, errorMessage) {
    const run = this.runs.get(runId);
    if (!run) return;
    run.status = 'failed';
    run.failedAt = failedStage;
    run.errorMessage = errorMessage;
    this.aggregates.failedRuns++;

    const errorType = categorizeError(errorMessage);
    this.aggregates.failureTypes[errorType] = (this.aggregates.failureTypes[errorType] || 0) + 1;
  }

  getSummary(runId) {
    const run = this.runs.get(runId);
    return run ? { ...run } : null;
  }

  getGlobalMetrics() {
    const successRate = this.aggregates.totalRuns > 0
      ? (this.aggregates.successfulRuns / this.aggregates.totalRuns * 100).toFixed(1)
      : 0;

    const avgLatency = this.aggregates.successfulRuns > 0
      ? Math.round(this.aggregates.totalLatencyMs / this.aggregates.successfulRuns)
      : 0;

    const avgScore = this.aggregates.consistencyScores.length > 0
      ? Math.round(this.aggregates.consistencyScores.reduce((a, b) => a + b, 0) / this.aggregates.consistencyScores.length)
      : 0;

    const avgRetriesPerRun = this.aggregates.totalRuns > 0
      ? (this.aggregates.totalRetries / this.aggregates.totalRuns).toFixed(2)
      : 0;

    const stageAvgLatencies = {};
    Object.entries(this.aggregates.stageLatencies).forEach(([stage, latencies]) => {
      stageAvgLatencies[stage] = Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length);
    });

    return {
      successRate: parseFloat(successRate),
      totalRuns: this.aggregates.totalRuns,
      successfulRuns: this.aggregates.successfulRuns,
      failedRuns: this.aggregates.failedRuns,
      avgLatencyMs: avgLatency,
      avgConsistencyScore: avgScore,
      avgRetriesPerRun: parseFloat(avgRetriesPerRun),
      totalRetries: this.aggregates.totalRetries,
      failureTypes: this.aggregates.failureTypes,
      stageAvgLatencies,
    };
  }
}

function categorizeError(message = '') {
  const lower = message.toLowerCase();
  if (lower.includes('json') || lower.includes('parse')) return 'json_parse_error';
  if (lower.includes('timeout')) return 'timeout';
  if (lower.includes('api') || lower.includes('anthropic')) return 'api_error';
  if (lower.includes('validation') || lower.includes('schema')) return 'validation_error';
  if (lower.includes('empty')) return 'empty_response';
  return 'unknown_error';
}

// Singleton
const globalMetrics = new MetricsCollector();

module.exports = { MetricsCollector, globalMetrics };
