/**
 * AppForge Pipeline Orchestrator
 * The compiler core — runs all 5 stages sequentially with error isolation,
 * targeted repair, and state management.
 */

const { stage1_intentExtraction } = require('./stage1_intent');
const { stage2_systemDesign } = require('./stage2_design');
const { stage3_schemaGeneration } = require('./stage3_schema');
const { stage4_validateRepair } = require('./stage4_validation');
const { stage5_finalAssembly } = require('./stage5_assembly');
const { MetricsCollector } = require('./metrics');
const { Logger } = require('./logger');

class PipelineOrchestrator {
  constructor(options = {}) {
    this.options = {
      maxRetries: options.maxRetries || 2,
      timeoutMs: options.timeoutMs || 120000,
      strictMode: options.strictMode || false,
      ...options,
    };
    this.metrics = new MetricsCollector();
    this.logger = new Logger('Orchestrator');
  }

  /**
   * Main compile entry point.
   * Natural language prompt → complete, validated app config.
   */
  async compile(prompt) {
    const runId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    this.logger.info(`[${runId}] Starting compilation`);
    this.metrics.startRun(runId, prompt);

    const state = {
      runId,
      prompt,
      stages: {},
      errors: [],
      repairLog: [],
      startTime: Date.now(),
    };

    const stages = [
      { name: 'intent_extraction', fn: stage1_intentExtraction, input: () => [prompt] },
      { name: 'system_design',     fn: stage2_systemDesign,     input: () => [state.stages.intent_extraction] },
      { name: 'schema_generation', fn: stage3_schemaGeneration, input: () => [state.stages.intent_extraction, state.stages.system_design] },
      { name: 'validate_repair',   fn: stage4_validateRepair,   input: () => [state.stages.intent_extraction, state.stages.system_design, state.stages.schema_generation, state.repairLog] },
      { name: 'final_assembly',    fn: stage5_finalAssembly,    input: () => [state.stages.intent_extraction, state.stages.system_design, state.stages.schema_generation, state.stages.validate_repair, runId] },
    ];

    for (const stage of stages) {
      const stageStart = Date.now();
      this.logger.info(`[${runId}] Running stage: ${stage.name}`);

      let result = null;
      let lastError = null;
      let attempts = 0;

      while (attempts <= this.options.maxRetries) {
        try {
          result = await this._withTimeout(
            stage.fn(...stage.input()),
            this.options.timeoutMs,
            stage.name
          );

          // Validate the result is not null/undefined
          if (!result) throw new Error(`Stage ${stage.name} returned empty result`);

          this.logger.info(`[${runId}] Stage ${stage.name} succeeded on attempt ${attempts + 1}`);
          break;
        } catch (err) {
          lastError = err;
          attempts++;
          this.logger.warn(`[${runId}] Stage ${stage.name} attempt ${attempts} failed: ${err.message}`);

          if (attempts <= this.options.maxRetries) {
            // Targeted retry: only re-run this stage, not the whole pipeline
            this.logger.info(`[${runId}] Retrying stage ${stage.name}...`);
            state.repairLog.push({
              stage: stage.name,
              attempt: attempts,
              error: err.message,
              action: 'targeted_retry',
            });
            await this._sleep(500 * attempts); // backoff
          }
        }
      }

      if (!result) {
        const error = {
          stage: stage.name,
          error: lastError?.message || 'Unknown error',
          fatal: this.options.strictMode,
        };
        state.errors.push(error);
        this.logger.error(`[${runId}] Stage ${stage.name} permanently failed after ${attempts} attempts`);

        if (this.options.strictMode) {
          this.metrics.recordFailure(runId, stage.name, lastError?.message);
          return this._buildErrorResponse(state, stage.name, lastError);
        }
        // In lenient mode, inject a fallback stub and continue
        result = this._fallbackStub(stage.name, state);
      }

      state.stages[stage.name] = result;
      const stageDuration = Date.now() - stageStart;
      this.metrics.recordStage(runId, stage.name, stageDuration, attempts, !!result);
    }

    const totalDuration = Date.now() - state.startTime;
    this.metrics.recordSuccess(runId, totalDuration, state.stages.validate_repair?.consistency_score || 0);

    return {
      success: true,
      runId,
      totalDurationMs: totalDuration,
      stages: state.stages,
      repairLog: [...state.repairLog, ...(state.stages.validate_repair?.repairs || [])],
      errors: state.errors,
      metrics: this.metrics.getSummary(runId),
    };
  }

  _withTimeout(promise, ms, label) {
    return Promise.race([
      promise,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`Stage ${label} timed out after ${ms}ms`)), ms)
      ),
    ]);
  }

  _sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  _fallbackStub(stageName, state) {
    const stubs = {
      intent_extraction: {
        app_name: 'Unknown App', app_type: 'other', clarity_score: 0,
        ambiguities: ['Could not parse prompt'], assumptions: [],
        core_entities: [], core_features: [], auth_required: false,
        roles: ['user'], has_payments: false, payment_model: 'none', complexity: 'low',
      },
      system_design: {
        architecture: 'monolith', pages: [{ name: 'Home', path: '/', auth: false, roles: [], components: [] }],
        api_groups: [], entities: [], auth_flows: [], feature_flags: [], external_services: [],
      },
      schema_generation: {
        ui_schema: { theme: { primary: '#6366f1', mode: 'light' }, components: [] },
        api_schema: { version: 'v1', base_url: '/api/v1', endpoints: [] },
        db_schema: { tables: [] },
        auth_schema: { provider: 'jwt', roles: [{ name: 'user', permissions: [] }], middleware: [] },
      },
      validate_repair: {
        validation_results: [{ rule: 'fallback', layer: 'system', status: 'warn', message: 'Stage failed, using stub', auto_repaired: false }],
        repairs: [], consistency_score: 0, is_executable: false, execution_blockers: ['Stage failed'], warnings: [],
      },
    };
    return stubs[stageName] || {};
  }

  _buildErrorResponse(state, failedStage, error) {
    return {
      success: false,
      runId: state.runId,
      failedAt: failedStage,
      error: error?.message || 'Pipeline failed',
      partialStages: state.stages,
      repairLog: state.repairLog,
      metrics: this.metrics.getSummary(state.runId),
    };
  }
}

module.exports = { PipelineOrchestrator };
