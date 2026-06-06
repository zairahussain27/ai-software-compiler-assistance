/**
 * AppForge — Logger
 * ============================================================
 * Lightweight structured logger used across all pipeline stages.
 *
 * Features:
 *  - Log levels: DEBUG, INFO, WARN, ERROR, SUCCESS
 *  - Colored terminal output (ANSI codes, auto-disabled in non-TTY)
 *  - Timestamps on every line
 *  - Stage-aware prefix (e.g. [Stage1] [Stage4])
 *  - JSON mode for production log aggregators
 *  - Silent mode for tests
 *  - In-memory log buffer (last 500 entries) accessible via getLog()
 *  - Performance timer helpers: time() / timeEnd()
 */

'use strict';

/* ─── Log Levels ───────────────────────────────────────────── */
const LEVELS = {
  DEBUG:   { rank: 0, label: 'DEBUG',   color: '\x1b[36m', icon: '·'  }, // cyan
  INFO:    { rank: 1, label: 'INFO ',   color: '\x1b[37m', icon: 'i'  }, // white
  SUCCESS: { rank: 2, label: 'OK   ',   color: '\x1b[32m', icon: '✓'  }, // green
  WARN:    { rank: 3, label: 'WARN ',   color: '\x1b[33m', icon: '⚠'  }, // yellow
  ERROR:   { rank: 4, label: 'ERROR',   color: '\x1b[31m', icon: '✗'  }, // red
};

const RESET  = '\x1b[0m';
const DIM    = '\x1b[2m';
const BOLD   = '\x1b[1m';

/* ─── Config ───────────────────────────────────────────────── */
const config = {
  minLevel:   process.env.LOG_LEVEL   || 'INFO',   // minimum level to print
  useColors:  process.stdout.isTTY    || false,     // color only in real terminals
  jsonMode:   process.env.LOG_FORMAT  === 'json',   // structured JSON for prod
  silent:     process.env.NODE_ENV    === 'test',   // suppress all output in Jest
  maxBuffer:  500,                                  // in-memory ring buffer size
};

/* ─── Global state ─────────────────────────────────────────── */
const logBuffer = [];       // ring buffer of last N log entries
const timers    = {};       // perf timer map: label → start ms

/* ─── Core write function ──────────────────────────────────── */
function write(level, namespace, message, meta) {
  const levelDef  = LEVELS[level] || LEVELS.INFO;
  const minRank   = (LEVELS[config.minLevel.toUpperCase()] || LEVELS.INFO).rank;
  if (levelDef.rank < minRank) return;

  const now       = new Date();
  const timestamp = now.toISOString();
  const entry     = { timestamp, level, namespace, message, ...(meta ? { meta } : {}) };

  // Always push to buffer regardless of silent mode
  logBuffer.push(entry);
  if (logBuffer.length > config.maxBuffer) logBuffer.shift();

  if (config.silent) return;

  if (config.jsonMode) {
    process.stdout.write(JSON.stringify(entry) + '\n');
    return;
  }

  // Human-readable format
  const ts    = config.useColors ? `${DIM}${now.toTimeString().slice(0,8)}${RESET}` : now.toTimeString().slice(0,8);
  const lvl   = config.useColors ? `${levelDef.color}${levelDef.label}${RESET}` : levelDef.label;
  const ns    = namespace ? (config.useColors ? `${DIM}[${namespace}]${RESET}` : `[${namespace}]`) : '';
  const icon  = config.useColors ? `${levelDef.color}${levelDef.icon}${RESET}` : levelDef.icon;
  const msg   = (level === 'ERROR') && config.useColors ? `${BOLD}${message}${RESET}` : message;
  const metaStr = meta ? ` ${config.useColors ? DIM : ''}${JSON.stringify(meta)}${config.useColors ? RESET : ''}` : '';

  const line  = `${ts} ${icon} ${lvl} ${ns} ${msg}${metaStr}`;

  if (level === 'ERROR') {
    process.stderr.write(line + '\n');
  } else {
    process.stdout.write(line + '\n');
  }
}

/* ─── Logger class ─────────────────────────────────────────── */
class Logger {
  /**
   * @param {string} namespace  — shown as [Stage1], [Orchestrator], etc.
   */
  constructor(namespace = '') {
    this.namespace = namespace;
  }

  debug(msg, meta)   { write('DEBUG',   this.namespace, String(msg), meta); }
  info(msg, meta)    { write('INFO',    this.namespace, String(msg), meta); }
  success(msg, meta) { write('SUCCESS', this.namespace, String(msg), meta); }
  warn(msg, meta)    { write('WARN',    this.namespace, String(msg), meta); }
  error(msg, meta)   { write('ERROR',   this.namespace, String(msg), meta); }

  /**
   * Start a named performance timer.
   * @example logger.time('stage3')
   */
  time(label) {
    timers[`${this.namespace}:${label}`] = Date.now();
  }

  /**
   * Stop timer and log the elapsed time.
   * @returns {number} elapsed milliseconds
   */
  timeEnd(label) {
    const key     = `${this.namespace}:${label}`;
    const started = timers[key];
    if (!started) {
      this.warn(`timeEnd called for '${label}' but timer was never started`);
      return 0;
    }
    const elapsed = Date.now() - started;
    delete timers[key];
    this.info(`${label} completed in ${elapsed}ms`);
    return elapsed;
  }

  /**
   * Log an object nicely — useful for debugging stage outputs.
   */
  inspect(label, obj) {
    this.debug(`${label}:`, obj);
  }

  /**
   * Create a child logger with a sub-namespace.
   * @example logger.child('repair') → [Stage4:repair]
   */
  child(sub) {
    return new Logger(this.namespace ? `${this.namespace}:${sub}` : sub);
  }

  /**
   * Log a pipeline stage transition banner.
   */
  stage(num, name, status = 'start') {
    const icons  = { start: '▶', done: '✓', error: '✗', retry: '↺' };
    const colors = { start: LEVELS.INFO.color, done: LEVELS.SUCCESS.color, error: LEVELS.ERROR.color, retry: LEVELS.WARN.color };
    const icon   = icons[status]  || '·';
    const color  = colors[status] || '';
    const msg    = `Stage ${num} · ${name}`;
    if (config.useColors && !config.silent) {
      process.stdout.write(`${color}${icon} ${BOLD}${msg}${RESET}\n`);
    } else {
      write('INFO', this.namespace, `[${icon}] ${msg}`);
    }
  }

  /**
   * Log a repair action — used by validation engine.
   */
  repair(field, action, before, after) {
    this.warn(`REPAIR [${field}] ${action}`, { before: String(before).slice(0,60), after: String(after).slice(0,60) });
  }

  /**
   * Log a validation check result.
   */
  check(rule, status, message) {
    const levelMap = { pass: 'SUCCESS', warn: 'WARN', fail: 'ERROR' };
    const level = levelMap[status] || 'INFO';
    write(level, this.namespace, `CHECK [${rule}] ${message}`);
  }
}

/* ─── Global accessors ─────────────────────────────────────── */

/** Returns the in-memory log buffer (last N entries). */
function getLog(n) {
  return n ? logBuffer.slice(-n) : [...logBuffer];
}

/** Clear the in-memory log buffer. */
function clearLog() {
  logBuffer.length = 0;
}

/** Override config at runtime (useful for tests). */
function configure(overrides = {}) {
  Object.assign(config, overrides);
}

/** Get all logs for a specific namespace */
function getNamespaceLogs(namespace) {
  return logBuffer.filter(e => e.namespace === namespace);
}

/** Singleton root logger */
const rootLogger = new Logger('AppForge');

/* ─── Exports ──────────────────────────────────────────────── */
module.exports = {
  Logger,         // class — instantiate per module: new Logger('Stage1')
  rootLogger,     // singleton — import and use directly
  getLog,         // get in-memory buffer
  clearLog,       // clear buffer
  configure,      // override config
  getNamespaceLogs,
};
