'use strict';
// Opens any supported font file into a plain sfnt plus metadata, and serves glyph pages.
const opentype = require('opentype.js');
const { FontError, detect, ttcOffsets, extractTtc, decodeWoff, readDirectory, tableData } = require('./sfnt');
const { decodeWoff2 } = require('./woff2');
const { readInfo, parseName } = require('./info');

const FORMAT_LABEL = { ttf: 'TrueType', otf: 'OpenType (CFF)', woff: 'WOFF', woff2: 'WOFF2', ttc: 'TrueType Collection' };
const MIME = { ttf: 'font/ttf', otf: 'font/otf', woff: 'font/woff', woff2: 'font/woff2', ttc: 'font/collection' };
const CSS_FORMAT = { ttf: 'truetype', otf: 'opentype', woff: 'woff', woff2: 'woff2', ttc: 'collection' };

/** Names of the faces in a TTC, for the face picker. */
function ttcFaceNames(buf) {
  return ttcOffsets(buf).map((off, i) => {
    try {
      const dir = readDirectory(buf, off);
      const n = parseName(tableData(buf, dir, 'name')).byId;
      return n[4] || [n[1], n[2]].filter(Boolean).join(' ') || `Font ${i + 1}`;
    } catch (e) {
      return `Font ${i + 1} (damaged)`;
    }
  });
}

/**
 * Opens a font file.
 * @param {Buffer} buf whole file
 * @param {{face?:number, maxBytes?:number}} [opts]
 */
function openFont(buf, opts = {}) {
  const format = detect(buf);
  if (!format) {
    const head = buf.subarray(0, 64).toString('latin1');
    if (/^\s*</.test(head)) throw new FontError('This file is text or XML, not a binary font. SVG fonts and .ttx files are not supported.', 'not-font');
    throw new FontError('This file does not start with a TrueType, OpenType, WOFF, WOFF2 or TTC signature, so it is not a font Font Viewer can read.', 'not-font');
  }
  let sfnt, faces = null, face = 0;
  const limits = { maxBytes: opts.maxBytes };
  if (format === 'woff') sfnt = decodeWoff(buf, limits);
  else if (format === 'woff2') sfnt = decodeWoff2(buf, limits);
  else if (format === 'ttc') {
    faces = ttcFaceNames(buf);
    face = Math.min(Math.max(0, opts.face | 0), faces.length - 1);
    sfnt = extractTtc(buf, face);
  } else sfnt = buf;
  const { info, cmap } = readInfo(sfnt);
  let ot = null, otError = null;
  if (info.outlines !== 'CFF2' && info.outlines !== 'none') {
    try {
      const ab = sfnt.buffer.slice(sfnt.byteOffset, sfnt.byteOffset + sfnt.byteLength);
      ot = opentype.parse(ab, { lowMemory: true });
    } catch (e) {
      otError = String((e && e.message) || e).slice(0, 200);
    }
  } else if (info.outlines === 'CFF2') otError = 'CFF2 outlines are drawn by the font itself in the type tester, not as glyph outlines.';
  info.format = format;
  info.formatLabel = FORMAT_LABEL[format];
  info.fileSize = buf.length;
  info.faces = faces;
  info.face = face;
  info.outlineError = otError;
  // The webview loads the face with the FontFace API. A TTC face is sent as its own sfnt.
  const webBytes = format === 'ttc' ? sfnt : buf;
  return new OpenedFont({ format, sfnt, info, cmap, ot, webBytes });
}

class OpenedFont {
  constructor(p) {
    Object.assign(this, p);
    // glyph id -> code points
    this.glyphCps = new Map();
    for (const [cp, g] of this.cmap) {
      const a = this.glyphCps.get(g);
      if (a) a.push(cp); else this.glyphCps.set(g, [cp]);
    }
    this._names = null;
  }

  get numGlyphs() {
    return this.ot ? this.ot.numGlyphs : this.info.numGlyphs;
  }

  glyphName(id) {
    if (this.ot) {
      try {
        const g = this.ot.glyphs.get(id);
        if (g && g.name) return String(g.name);
      } catch (e) { /* fall through */ }
    }
    const cps = this.glyphCps.get(id);
    if (cps && cps.length) return 'uni' + cps[0].toString(16).toUpperCase().padStart(4, '0');
    return id === 0 ? '.notdef' : `glyph${id}`;
  }

  /** All glyph names (computed once, for search). */
  names() {
    if (!this._names) {
      this._names = [];
      for (let i = 0; i < this.numGlyphs; i++) this._names.push(this.glyphName(i));
    }
    return this._names;
  }

  /** One glyph for the grid or the detail panel. */
  glyph(id, withPath = true) {
    const cps = (this.glyphCps.get(id) || []).slice().sort((a, b) => a - b);
    const out = { id, name: this.glyphName(id), cps, adv: null, d: null };
    if (this.ot) {
      try {
        const g = this.ot.glyphs.get(id);
        out.adv = g.advanceWidth != null ? Math.round(g.advanceWidth) : null;
        if (withPath) {
          // Font units with y flipped (SVG y goes down), baseline at y = 0.
          const p = g.getPath(0, 0, this.info.unitsPerEm);
          out.d = p.toPathData(1);
          if (out.d.length > 200000) out.d = null; // pathological glyphs are drawn from the font instead
        }
      } catch (e) {
        out.d = null;
      }
    }
    return out;
  }

  /**
   * Glyph ids matching a query. Query forms: empty (all), a glyph name part, "U+0041", "0x41", "#65" (glyph id),
   * or one typed character.
   */
  search(query, cap = 100000) {
    const q = String(query || '').trim();
    const n = this.numGlyphs;
    if (!q) return { ids: null, total: n };
    const ids = [];
    const seen = new Set();
    const add = (id) => { if (id >= 0 && id < n && !seen.has(id)) { seen.add(id); ids.push(id); } };
    const cpm = /^(?:u\+|0x)([0-9a-f]{1,6})$/i.exec(q);
    const gid = /^#(\d{1,6})$/.exec(q);
    if (cpm) {
      const cp = parseInt(cpm[1], 16);
      if (this.cmap.has(cp)) add(this.cmap.get(cp));
    } else if (gid) add(parseInt(gid[1], 10));
    else {
      const chars = [...q];
      if (chars.length <= 2) for (const ch of chars) { const g = this.cmap.get(ch.codePointAt(0)); if (g != null) add(g); }
      const ql = q.toLowerCase();
      const names = this.names();
      for (let i = 0; i < n && ids.length < cap; i++) if (names[i].toLowerCase().includes(ql)) add(i);
      if (/^[0-9a-f]{4,6}$/i.test(q)) {
        const cp = parseInt(q, 16);
        if (this.cmap.has(cp)) add(this.cmap.get(cp));
      }
    }
    return { ids, total: ids.length };
  }

  /** A page of glyphs for the grid. */
  page(query, offset, limit) {
    const s = this.search(query);
    const lim = Math.max(1, Math.min(limit | 0 || 200, 1000));
    const off = Math.max(0, offset | 0);
    const ids = s.ids ? s.ids.slice(off, off + lim) : Array.from({ length: Math.max(0, Math.min(lim, s.total - off)) }, (_, i) => off + i);
    return { total: s.total, offset: off, items: ids.map((id) => this.glyph(id)) };
  }

  /** Coverage per Unicode block, and the covered code points of one block. */
  blocks() {
    const { BLOCKS, blockIndex } = require('./blocks');
    const counts = new Map();
    let other = 0;
    for (const cp of this.cmap.keys()) {
      const i = blockIndex(cp);
      if (i < 0) other++;
      else counts.set(i, (counts.get(i) || 0) + 1);
    }
    const list = [...counts].sort((a, b) => a[0] - b[0]).map(([i, c]) => ({ index: i, name: BLOCKS[i][2], start: BLOCKS[i][0], end: BLOCKS[i][1], covered: c, size: BLOCKS[i][1] - BLOCKS[i][0] + 1 }));
    return { list, other };
  }

  blockChars(index, cap = 4096) {
    const { BLOCKS } = require('./blocks');
    const b = BLOCKS[index];
    if (!b) return { index, start: 0, end: -1, cells: [] };
    const cells = [];
    for (let cp = b[0]; cp <= b[1] && cells.length < cap; cp++) {
      const g = this.cmap.get(cp);
      cells.push(g == null ? [cp, -1] : [cp, g]);
    }
    return { index, name: b[2], start: b[0], end: b[1], cells };
  }
}

/** unicode-range value from the cmap, as compact ranges. */
function unicodeRange(cps, maxRanges = 60) {
  const sorted = [...cps].sort((a, b) => a - b);
  const ranges = [];
  for (const c of sorted) {
    const last = ranges[ranges.length - 1];
    if (last && c === last[1] + 1) last[1] = c;
    else ranges.push([c, c]);
  }
  // Merge the closest neighbours until the list is short enough.
  while (ranges.length > maxRanges) {
    let bi = 0, bg = Infinity;
    for (let i = 0; i + 1 < ranges.length; i++) {
      const gap = ranges[i + 1][0] - ranges[i][1];
      if (gap < bg) { bg = gap; bi = i; }
    }
    ranges[bi][1] = ranges[bi + 1][1];
    ranges.splice(bi + 1, 1);
  }
  const hex = (n) => n.toString(16).toUpperCase().padStart(4, '0');
  return ranges.map(([a, b]) => (a === b ? `U+${hex(a)}` : `U+${hex(a)}-${hex(b)}`)).join(', ');
}

function cssString(s) {
  return '"' + String(s).replace(/[\\"]/g, '\\$&').replace(/[\r\n]/g, ' ') + '"';
}

/** CSS @font-face snippet for this font. */
function fontFaceCss(info, fileName, cmapKeys) {
  const family = info.family || info.postscriptName || 'My Font';
  const lines = ['@font-face {', `  font-family: ${cssString(family)};`];
  const fmt = CSS_FORMAT[info.format] || 'truetype';
  const varSuffix = info.axes && info.axes.length && info.format !== 'ttc' ? '-variations' : '';
  lines.push(`  src: url(${cssString('./' + fileName)}) format(${cssString(fmt + varSuffix)});`);
  const ax = (tag) => (info.axes || []).find((a) => a.tag === tag);
  const w = ax('wght');
  lines.push(`  font-weight: ${w ? `${Math.round(w.min)} ${Math.round(w.max)}` : info.weightClass || 400};`);
  const wd = ax('wdth');
  if (wd) lines.push(`  font-stretch: ${wd.min}% ${wd.max}%;`);
  const sl = ax('slnt');
  if (sl) lines.push(`  font-style: oblique ${-sl.max}deg ${-sl.min}deg;`);
  else lines.push(`  font-style: ${info.italic ? 'italic' : 'normal'};`);
  lines.push('  font-display: swap;');
  if (cmapKeys && cmapKeys.size) lines.push(`  unicode-range: ${unicodeRange(cmapKeys.keys ? cmapKeys.keys() : cmapKeys)};`);
  lines.push('}');
  return lines.join('\n');
}

module.exports = { openFont, OpenedFont, unicodeRange, fontFaceCss, cssString, FORMAT_LABEL, MIME, CSS_FORMAT, ttcFaceNames, FontError };
