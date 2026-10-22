/**
 * pas-audio:// custom protocol — streaming local audio files.
 *
 * WHY THIS EXISTS:
 *   The `pas-audio://` protocol streams selected files from disk on demand.
 *   The <audio> element handles seeking natively via
 *   Range requests, so we only read what's needed.
 *
 * URL FORMAT:
 *   pas-audio://local/<url-encoded-absolute-path>
 *   Example: pas-audio://local/C%3A%5CMusic%5Ctrack.mp3
 *
 *   On Windows the decoded path is `/C:\Music\track.mp3`, so we strip the
 *   leading `/` to get `C:\Music\track.mp3`.
 *
 * SECURITY:
 *   Only paths in the authorized set (from files.js) can be served. Any
 *   unauthorized path → 403. This makes path-traversal attacks useless
 *   (an attacker can't guess-and-serve `pas-audio://local/C:/Windows/...`).
 *
 * RANGE SUPPORT:
 *   <audio> sends `Range: bytes=START-END` when seeking. We return
 *   status 206 with Content-Range and a stream of just that byte range.
 *   Chromium's media stack depends on this for seeking to work.
 */

const { protocol, net } = require('electron');
const { Readable } = require('stream');
const path = require('path');
const fs = require('fs');
const { isAuthorized } = require('./files.js');

const SCHEME = 'pas-audio';
const AUDIO_HOST = 'local';

const MIME_TYPES = {
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  flac: 'audio/flac',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  opus: 'audio/opus',
  webm: 'audio/webm'
};

function getMimeType(filePath) {
  const ext = path.extname(filePath).replace('.', '').toLowerCase();
  return MIME_TYPES[ext] || 'application/octet-stream';
}

/**
 * Parse a Range header like "bytes=1000-2000", "bytes=1000-", or "bytes=-128".
 * @returns {{ start: number, end: number } | null}
 */
function parseRange(rangeHeader, fileSize) {
  if (!rangeHeader) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if (!match) return null;

  const startStr = match[1];
  const endStr = match[2];
  if (!startStr && !endStr) return null;

  let start;
  let end;
  if (!startStr) {
    const suffixLength = parseInt(endStr, 10);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0 || fileSize <= 0) {
      return null;
    }
    start = Math.max(fileSize - suffixLength, 0);
    end = fileSize - 1;
  } else {
    start = parseInt(startStr, 10);
    end = endStr === '' ? fileSize - 1 : parseInt(endStr, 10);
  }

  if (!Number.isSafeInteger(start) || start < 0 || start >= fileSize) return null;
  if (!Number.isSafeInteger(end) || end < start) return null;
  return { start, end: Math.min(end, fileSize - 1) };
}

/**
 * Register the pas-audio:// scheme. MUST be called BEFORE app.whenReady().
 * (Called from main.js — see the delta section at the bottom.)
 */
function registerSchemePrivileged() {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        bypassCSP: false
      }
    }
  ]);
}

/**
 * Register the actual handler. MUST be called AFTER app.whenReady().
 */
function registerProtocol() {
  protocol.handle(SCHEME, async (request) => {
    try {
      const url = new URL(request.url);
      if (url.hostname !== AUDIO_HOST) {
        return new Response('Not found', { status: 404 });
      }
      // url.pathname is like "/C%3A%5CMusic%5Ctrack.mp3"
      const decoded = decodeURIComponent(url.pathname);
      // Windows: strip leading "/" → "C:\Music\track.mp3"
      // Linux/macOS: "/home/user/..." already correct
      const filePath = process.platform === 'win32'
        ? decoded.replace(/^\//, '')
        : decoded;

      // ── SECURITY CHECK ──────────────────────────────────────────────
      if (!isAuthorized(filePath)) {
        return new Response('Forbidden: path not authorized', { status: 403 });
      }

      // ── STAT ────────────────────────────────────────────────────────
      let stat;
      try {
        stat = await fs.promises.stat(filePath);
      } catch {
        return new Response('Not found', { status: 404 });
      }
      if (!stat.isFile()) {
        return new Response('Not a file', { status: 400 });
      }

      const mime = getMimeType(filePath);
      const rangeHeader = request.headers.get('range');

      // ── RANGE REQUEST (seeking) ─────────────────────────────────────
      if (rangeHeader) {
        const range = parseRange(rangeHeader, stat.size);
        if (!range) {
          return new Response('Invalid range', {
            status: 416,
            headers: { 'Content-Range': `bytes */${stat.size}` }
          });
        }

        const stream = fs.createReadStream(filePath, {
          start: range.start,
          end: range.end
        });

        return new Response(Readable.toWeb(stream), {
          status: 206,
          headers: {
            'Content-Type': mime,
            'Content-Length': String(range.end - range.start + 1),
            'Content-Range': `bytes ${range.start}-${range.end}/${stat.size}`,
            'Accept-Ranges': 'bytes',
            'Cache-Control': 'no-store'
          }
        });
      }

      // ── FULL FILE ───────────────────────────────────────────────────
      const stream = fs.createReadStream(filePath);
      return new Response(Readable.toWeb(stream), {
        status: 200,
        headers: {
          'Content-Type': mime,
          'Content-Length': String(stat.size),
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'no-store'
        }
      });
    } catch (e) {
      console.error('[pas-audio] handler error:', e);
      return new Response(`Internal error: ${e.message}`, { status: 500 });
    }
  });

  console.log(`[ipc] protocol "${SCHEME}://" registered`);
}

module.exports = { registerSchemePrivileged, registerProtocol, SCHEME };