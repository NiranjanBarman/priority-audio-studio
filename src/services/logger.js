/**
 * Logger — ring-buffer log with reactive subscribers.
 *
 * DESIGN:
 *   - Fixed 500-entry ring buffer. Old entries evicted when full.
 *   - Every log() call notifies all subscribers with the entry.
 *   - Synchronous, allocation-light, safe to call from anywhere except
 *     the audio callback (Web Audio doesn't call us, so no risk in M1).
 *   - Writes to console.log for dev convenience.
 *
 * WHY NOT A REAL LOGGING LIBRARY:
 *   - Our needs are trivial (one process, one viewer)
 *   - Bundle size matters in Electron
 *   - Zero external deps = zero supply-chain risk
 *
 * LOG LEVELS:
 *   'info'   — normal operation
 *   'warn'   — recoverable issue (sample-rate mismatch, sink failed)
 *   'error'  — hard failure (decode error, addon missing)
 *   'debug'  — verbose dev-only tracing (doesn't persist to ring)
 */

const MAX_ENTRIES = 500;

const ring = [];
const listeners = new Set();

let idCounter = 1;
let minLevel = 'debug'; // 'debug' | 'info' | 'warn' | 'error'

const LEVEL_ORDER = { debug: 0, info: 1, warn: 2, error: 3 };

/**
 * Emit a log entry.
 * @param {string} msg
 * @param {'debug'|'info'|'warn'|'error'} [level='info']
 * @param {object} [ctx] — optional structured context (deviceId, preset, etc.)
 */
export function log(msg, level = 'info', ctx = null) {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[minLevel]) return;

  const entry = {
    id: idCounter++,
    t: Date.now(),
    level,
    msg: String(msg),
    ctx: ctx || null
  };

  ring.push(entry);
  if (ring.length > MAX_ENTRIES) ring.shift();

  // Console mirror — dev terminal output
  const tag = `[${level.toUpperCase()}]`;
  if (level === 'error') console.error(tag, msg, ctx || '');
  else if (level === 'warn') console.warn(tag, msg, ctx || '');
  else console.log(tag, msg, ctx || '');

  for (const fn of listeners) {
    try { fn(entry); } catch { /* subscriber crashed — ignore */ }
  }
}

/** Convenience wrappers. */
export const debug = (msg, ctx) => log(msg, 'debug', ctx);
export const info  = (msg, ctx) => log(msg, 'info',  ctx);
export const warn  = (msg, ctx) => log(msg, 'warn',  ctx);
export const error = (msg, ctx) => log(msg, 'error', ctx);

/**
 * Get a snapshot of all entries. Newest last.
 * @returns {Array<{id, t, level, msg, ctx}>}
 */
export function getLogs() {
  return ring.slice();
}

/**
 * Subscribe to new entries. Returns unsubscribe function.
 * @param {(entry: object) => void} fn
 * @returns {() => void}
 */
export function subscribeLogs(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Wipe the buffer. Subscribers are NOT notified (viewer must refetch). */
export function clearLogs() {
  ring.length = 0;
  info('Log cleared');
}

/**
 * Set the minimum level that reaches the ring buffer.
 * 'debug' logs still go to console even if minLevel is 'warn'.
 * @param {'debug'|'info'|'warn'|'error'} level
 */
export function setLogLevel(level) {
  if (!(level in LEVEL_ORDER)) return;
  minLevel = level;
}

/** Export as a plain string for copy-to-clipboard in Settings. */
export function exportLogs() {
  return ring
    .map(e => {
      const ts = new Date(e.t).toISOString();
      const ctx = e.ctx ? ' ' + JSON.stringify(e.ctx) : '';
      return `${ts} [${e.level.toUpperCase()}] ${e.msg}${ctx}`;
    })
    .join('\n');
}