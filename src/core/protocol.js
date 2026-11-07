'use strict';
// Messages between the webview and the extension host. Everything from the webview is checked here first.

const isInt = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;

function validateWebviewMessage(m) {
  if (!m || typeof m !== 'object' || typeof m.type !== 'string') return { ok: false };
  switch (m.type) {
    case 'ready':
    case 'rendered':
      return { ok: true, msg: { type: m.type } };
    case 'glyphs':
      if (typeof m.query !== 'string' || m.query.length > 200) return { ok: false };
      if (!isInt(m.offset, 0, 10000000) || !isInt(m.limit, 1, 1000) || !isInt(m.seq, 0, Number.MAX_SAFE_INTEGER)) return { ok: false };
      return { ok: true, msg: { type: 'glyphs', query: m.query, offset: m.offset, limit: m.limit, seq: m.seq } };
    case 'glyph':
      return isInt(m.id, 0, 0xffff) ? { ok: true, msg: { type: 'glyph', id: m.id } } : { ok: false };
    case 'block':
      return isInt(m.index, 0, 10000) ? { ok: true, msg: { type: 'block', index: m.index } } : { ok: false };
    case 'face':
      return isInt(m.index, 0, 10000) ? { ok: true, msg: { type: 'face', index: m.index } } : { ok: false };
    case 'copy':
      if (typeof m.text !== 'string' || !m.text || m.text.length > 200000 || m.text.includes('\0')) return { ok: false };
      return { ok: true, msg: { type: 'copy', text: m.text, what: typeof m.what === 'string' ? m.what.slice(0, 40) : 'text' } };
    case 'fontError':
      return { ok: true, msg: { type: 'fontError', message: typeof m.message === 'string' ? m.message.slice(0, 300) : '' } };
    default:
      return { ok: false };
  }
}

/** "U+00E9" */
function cpLabel(cp) {
  return 'U+' + cp.toString(16).toUpperCase().padStart(4, '0');
}

/** Human file size. */
function fmtSize(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

// OpenType tags as CSS strings: 4 plain characters, nothing that can end the string.
const TAG_RE = /^[A-Za-z0-9 _.-]{4}$/;

/** CSS settings strings for the current tester state. */
function featureSettings(features) {
  return Object.keys(features || {})
    .filter((t) => TAG_RE.test(t))
    .sort()
    .map((t) => `"${t.replace(/["\\]/g, '')}" ${features[t] ? 1 : 0}`)
    .join(', ');
}

function variationSettings(axes) {
  return Object.keys(axes || {})
    .filter((t) => TAG_RE.test(t) && Number.isFinite(axes[t]))
    .sort()
    .map((t) => `"${t.replace(/["\\]/g, '')}" ${Math.round(axes[t] * 100) / 100}`)
    .join(', ');
}

// Features that browsers turn on by default for horizontal text.
const DEFAULT_ON = new Set(['liga', 'clig', 'calt', 'kern', 'mark', 'mkmk', 'ccmp', 'locl', 'rlig', 'rvrn', 'curs', 'dist', 'abvm', 'blwm', 'init', 'medi', 'fina', 'isol']);

const FEATURE_NAMES = {
  aalt: 'Access all alternates', calt: 'Contextual alternates', case: 'Case-sensitive forms', ccmp: 'Glyph composition', clig: 'Contextual ligatures',
  cpsp: 'Capital spacing', c2sc: 'Small caps from capitals', dlig: 'Discretionary ligatures', dnom: 'Denominators', frac: 'Fractions',
  hist: 'Historical forms', kern: 'Kerning', liga: 'Standard ligatures', lnum: 'Lining figures', locl: 'Localized forms', mark: 'Mark positioning',
  mkmk: 'Mark to mark', numr: 'Numerators', onum: 'Oldstyle figures', ordn: 'Ordinals', pnum: 'Proportional figures', rlig: 'Required ligatures',
  rvrn: 'Variation alternates', salt: 'Stylistic alternates', sinf: 'Scientific inferiors', smcp: 'Small caps', subs: 'Subscript', sups: 'Superscript',
  swsh: 'Swash', titl: 'Titling', tnum: 'Tabular figures', zero: 'Slashed zero', size: 'Optical size', cpct: 'Centered punctuation',
};

function featureName(tag) {
  if (FEATURE_NAMES[tag]) return FEATURE_NAMES[tag];
  let m = /^ss(\d\d)$/.exec(tag);
  if (m) return `Stylistic set ${Number(m[1])}`;
  m = /^cv(\d\d)$/.exec(tag);
  if (m) return `Character variant ${Number(m[1])}`;
  return '';
}

module.exports = { validateWebviewMessage, cpLabel, fmtSize, featureSettings, variationSettings, featureName, DEFAULT_ON, FEATURE_NAMES };
