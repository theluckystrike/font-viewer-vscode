'use strict';
// Reads metadata from a plain sfnt: name table, head, OS/2, hhea, post, maxp, fvar, cmap and the
// OpenType feature tags of GSUB and GPOS. No outlines here (see glyphs.js).
const { FontError, readDirectory, tableData } = require('./sfnt');

const NAME_LABELS = {
  0: 'Copyright', 1: 'Family', 2: 'Subfamily', 3: 'Unique ID', 4: 'Full name', 5: 'Version', 6: 'PostScript name',
  7: 'Trademark', 8: 'Manufacturer', 9: 'Designer', 10: 'Description', 11: 'Vendor URL', 12: 'Designer URL',
  13: 'License', 14: 'License URL', 16: 'Typographic family', 17: 'Typographic subfamily', 18: 'Compatible full name',
  19: 'Sample text', 20: 'PostScript CID name', 21: 'WWS family', 22: 'WWS subfamily', 25: 'Variations PostScript prefix',
};

// Mac Roman upper half, for platform 1 names.
const MAC_ROMAN = 'ÄÅÇÉÑÖÜáàâäãåçéèêëíìîïñóòôöõúùûü†°¢£§•¶ß®©™´¨≠ÆØ∞±≤≥¥µ∂∑∏π∫ªºΩæø¿¡¬√ƒ≈∆«»… ÀÃÕŒœ–—“”‘’÷◊ÿŸ⁄€‹›ﬁﬂ‡·‚„‰ÂÊÁËÈÍÎÏÌÓÔÒÚÛÙıˆ˜¯˘˙˚¸˝˛ˇ';

function utf16be(b) {
  let s = '';
  for (let i = 0; i + 1 < b.length; i += 2) s += String.fromCharCode((b[i] << 8) | b[i + 1]);
  return s;
}

function macRoman(b) {
  let s = '';
  for (const c of b) s += c < 128 ? String.fromCharCode(c) : MAC_ROMAN[c - 128];
  return s;
}

/** All name records, best English string per name ID. Returns { byId: {id: string}, records: number, languages: number }. */
function parseName(data) {
  if (!data || data.length < 6) return { byId: {}, records: 0, languages: 0 };
  const count = data.readUInt16BE(2);
  const strOff = data.readUInt16BE(4);
  const best = {};
  const langs = new Set();
  for (let i = 0; i < count; i++) {
    const r = 6 + i * 12;
    if (r + 12 > data.length) break;
    const pid = data.readUInt16BE(r), eid = data.readUInt16BE(r + 2), lid = data.readUInt16BE(r + 4);
    const nid = data.readUInt16BE(r + 6), len = data.readUInt16BE(r + 8), off = data.readUInt16BE(r + 10);
    const s0 = strOff + off;
    if (s0 + len > data.length) continue;
    const raw = data.subarray(s0, s0 + len);
    let text, score;
    if (pid === 3 && (eid === 1 || eid === 10 || eid === 0)) {
      text = utf16be(raw);
      score = lid === 0x409 ? 4 : 2;
      langs.add('w' + lid);
    } else if (pid === 0) {
      text = utf16be(raw);
      score = 3;
    } else if (pid === 1 && eid === 0) {
      text = macRoman(raw);
      score = lid === 0 ? 1 : 0;
      langs.add('m' + lid);
    } else continue;
    text = text.replace(/\u0000/g, '');
    if (!best[nid] || score > best[nid].score) best[nid] = { text, score };
  }
  const byId = {};
  for (const k of Object.keys(best)) byId[k] = best[k].text;
  return { byId, records: count, languages: langs.size };
}

function fixed(d, o) {
  return d.readInt32BE(o) / 65536;
}

function longDate(d, o) {
  const secs = d.readUInt32BE(o) * 4294967296 + d.readUInt32BE(o + 4);
  if (!secs) return null;
  const ms = (secs - 2082844800) * 1000;
  const dt = new Date(ms);
  return isNaN(dt.getTime()) || dt.getUTCFullYear() < 1970 || dt.getUTCFullYear() > 2200 ? null : dt.toISOString().slice(0, 10);
}

function tagList(data) {
  // GSUB / GPOS header: version (4), scriptList (2), featureList (2), lookupList (2)
  if (!data || data.length < 10) return [];
  const fl = data.readUInt16BE(6);
  if (!fl || fl + 2 > data.length) return [];
  const n = data.readUInt16BE(fl);
  const tags = new Set();
  for (let i = 0; i < n; i++) {
    const r = fl + 2 + i * 6;
    if (r + 6 > data.length) break;
    tags.add(data.toString('latin1', r, r + 4));
  }
  return [...tags].filter((t) => /^[\x20-\x7e]{4}$/.test(t)).sort();
}

function parseFvar(data, names) {
  if (!data || data.length < 16) return { axes: [], instances: [] };
  const axesOff = data.readUInt16BE(4);
  const axisCount = data.readUInt16BE(8), axisSize = data.readUInt16BE(10);
  const instCount = data.readUInt16BE(12), instSize = data.readUInt16BE(14);
  const axes = [];
  for (let i = 0; i < axisCount; i++) {
    const r = axesOff + i * axisSize;
    if (r + 20 > data.length) break;
    const tag = data.toString('latin1', r, r + 4);
    const nameId = data.readUInt16BE(r + 18);
    axes.push({ tag, min: fixed(data, r + 4), def: fixed(data, r + 8), max: fixed(data, r + 12), hidden: (data.readUInt16BE(r + 16) & 1) === 1, name: names[nameId] || AXIS_NAMES[tag] || tag });
  }
  const instances = [];
  let r = axesOff + axisCount * axisSize;
  for (let i = 0; i < instCount; i++, r += instSize) {
    if (r + 4 + axisCount * 4 > data.length) break;
    const nameId = data.readUInt16BE(r);
    const coords = {};
    axes.forEach((a, j) => { coords[a.tag] = fixed(data, r + 4 + j * 4); });
    instances.push({ name: names[nameId] || `Instance ${i + 1}`, coords });
  }
  return { axes, instances };
}

const AXIS_NAMES = { wght: 'Weight', wdth: 'Width', ital: 'Italic', slnt: 'Slant', opsz: 'Optical size' };

/** Best cmap as a Map(codePoint -> glyphId). */
function parseCmap(data) {
  const map = new Map();
  if (!data || data.length < 4) return map;
  const n = data.readUInt16BE(2);
  const subs = [];
  for (let i = 0; i < n; i++) {
    const r = 4 + i * 8;
    if (r + 8 > data.length) break;
    const pid = data.readUInt16BE(r), eid = data.readUInt16BE(r + 2), off = data.readUInt32BE(r + 4);
    if (off + 2 > data.length) continue;
    const fmt = data.readUInt16BE(off);
    let score = 0;
    if (fmt === 12 && (pid === 3 && eid === 10 || pid === 0)) score = 6;
    else if (fmt === 4 && (pid === 3 && eid === 1 || pid === 0)) score = 5;
    else if (fmt === 12 || fmt === 4) score = 4;
    else if (fmt === 6 || fmt === 0) score = pid === 3 && eid === 0 ? 2 : 1; // symbol fonts or Mac Roman
    if (score) subs.push({ off, fmt, score, symbol: pid === 3 && eid === 0 });
  }
  subs.sort((a, b) => b.score - a.score);
  const s = subs[0];
  if (!s) return map;
  const d = data, o = s.off;
  try {
    if (s.fmt === 4) {
      const segX2 = d.readUInt16BE(o + 6);
      const ends = o + 14, starts = ends + segX2 + 2, deltas = starts + segX2, ranges = deltas + segX2;
      for (let i = 0; i < segX2; i += 2) {
        const end = d.readUInt16BE(ends + i), start = d.readUInt16BE(starts + i);
        const delta = d.readInt16BE(deltas + i), ro = d.readUInt16BE(ranges + i);
        for (let c = start; c <= end && c !== 0xffff; c++) {
          let g;
          if (ro === 0) g = (c + delta) & 0xffff;
          else {
            const p = ranges + i + ro + (c - start) * 2;
            if (p + 2 > d.length) break;
            g = d.readUInt16BE(p);
            if (g) g = (g + delta) & 0xffff;
          }
          if (g) map.set(c, g);
        }
      }
    } else if (s.fmt === 12) {
      const groups = d.readUInt32BE(o + 12);
      for (let i = 0; i < groups && o + 16 + i * 12 + 12 <= d.length; i++) {
        const r = o + 16 + i * 12;
        const a = d.readUInt32BE(r), b = d.readUInt32BE(r + 4), g0 = d.readUInt32BE(r + 8);
        if (b - a > 0x110000) continue;
        for (let c = a; c <= b && c <= 0x10ffff; c++) map.set(c, g0 + (c - a));
      }
    } else if (s.fmt === 6) {
      const first = d.readUInt16BE(o + 6), count = d.readUInt16BE(o + 8);
      for (let i = 0; i < count; i++) { const g = d.readUInt16BE(o + 10 + i * 2); if (g) map.set(first + i, g); }
    } else if (s.fmt === 0) {
      for (let c = 0; c < 256; c++) { const g = d[o + 6 + c]; if (g) map.set(c, g); }
    }
  } catch (e) {
    // A cut-off cmap keeps what was read so far.
  }
  // Symbol fonts map their glyphs at U+F0xx. Also map them at U+00xx so typing works in the tester.
  if (s.symbol) for (const [c, g] of [...map]) if (c >= 0xf020 && c <= 0xf0ff && !map.has(c - 0xf000)) map.set(c - 0xf000, g);
  return map;
}

const EMBEDDING = (fsType) => {
  const t = fsType & 0x0f;
  let s = t & 2 ? 'Restricted license embedding' : t & 4 ? 'Preview and print embedding' : t & 8 ? 'Editable embedding' : 'Installable embedding';
  if (fsType & 0x100) s += ', no subsetting';
  if (fsType & 0x200) s += ', bitmap embedding only';
  return s;
};

/**
 * Reads the font metadata from a plain sfnt.
 * @param {Buffer} sfnt
 */
function readInfo(sfnt) {
  const dir = readDirectory(sfnt, 0);
  const t = (tag) => tableData(sfnt, dir, tag);
  if (!dir.tables.has('cmap') && !dir.tables.has('head')) throw new FontError('This file has no cmap or head table, so it is not a usable font.');
  const name = parseName(t('name'));
  const n = name.byId;
  const info = {
    outlines: dir.tables.has('CFF2') ? 'CFF2' : dir.tables.has('CFF ') ? 'CFF' : dir.tables.has('glyf') ? 'TrueType' : 'none',
    tables: [...dir.tables].map(([tag, v]) => ({ tag, length: v.length })).sort((a, b) => (a.tag < b.tag ? -1 : 1)),
    names: [],
    family: n[16] || n[1] || '',
    subfamily: n[17] || n[2] || '',
    fullName: n[4] || [n[1], n[2]].filter(Boolean).join(' '),
    postscriptName: n[6] || '',
    version: n[5] || '',
    nameRecords: name.records,
    nameLanguages: name.languages,
    color: ['COLR', 'SVG ', 'sbix', 'CBDT'].filter((x) => dir.tables.has(x)).map((x) => x.trim()),
  };
  for (const id of Object.keys(n).map(Number).sort((a, b) => a - b)) {
    if (id < 256 && n[id]) info.names.push({ id, label: NAME_LABELS[id] || `Name ${id}`, value: n[id] });
  }
  const head = t('head');
  if (head && head.length >= 54) {
    info.unitsPerEm = head.readUInt16BE(18);
    info.fontRevision = Math.round(fixed(head, 4) * 1000) / 1000;
    info.created = longDate(head, 20);
    info.modified = longDate(head, 28);
    info.bbox = [head.readInt16BE(36), head.readInt16BE(38), head.readInt16BE(40), head.readInt16BE(42)];
    info.macStyle = head.readUInt16BE(44);
  }
  if (!info.unitsPerEm || info.unitsPerEm < 16 || info.unitsPerEm > 16384) info.unitsPerEm = 1000;
  const hhea = t('hhea');
  if (hhea && hhea.length >= 36) {
    info.ascender = hhea.readInt16BE(4);
    info.descender = hhea.readInt16BE(6);
    info.lineGap = hhea.readInt16BE(8);
  }
  const os2 = t('OS/2');
  if (os2 && os2.length >= 68) {
    info.os2Version = os2.readUInt16BE(0);
    info.weightClass = os2.readUInt16BE(4);
    info.widthClass = os2.readUInt16BE(6);
    info.fsType = os2.readUInt16BE(8);
    info.embedding = EMBEDDING(info.fsType);
    info.vendor = os2.toString('latin1', 58, 62).replace(/[^\x20-\x7e]/g, '').trim();
    info.fsSelection = os2.readUInt16BE(62);
    info.italic = (info.fsSelection & 1) === 1;
    if (os2.length >= 74) {
      info.typoAscender = os2.readInt16BE(68);
      info.typoDescender = os2.readInt16BE(70);
      info.typoLineGap = os2.readInt16BE(72);
    }
    if (info.os2Version >= 2 && os2.length >= 90) {
      info.xHeight = os2.readInt16BE(86);
      info.capHeight = os2.readInt16BE(88);
    }
  } else if (info.macStyle != null) info.italic = (info.macStyle & 2) === 2;
  const post = t('post');
  if (post && post.length >= 16) {
    info.italicAngle = fixed(post, 4);
    info.fixedPitch = post.readUInt32BE(12) !== 0;
  }
  const maxp = t('maxp');
  info.numGlyphs = maxp && maxp.length >= 6 ? maxp.readUInt16BE(4) : 0;
  const fvar = parseFvar(t('fvar'), n);
  info.axes = fvar.axes;
  info.instances = fvar.instances;
  info.gsubFeatures = tagList(t('GSUB'));
  info.gposFeatures = tagList(t('GPOS'));
  if (dir.tables.has('kern') && !info.gposFeatures.includes('kern')) info.gposFeatures.push('kern');
  const cmap = parseCmap(t('cmap'));
  info.codePoints = cmap.size;
  if (info.ascender == null) {
    info.ascender = info.typoAscender != null ? info.typoAscender : Math.round(info.unitsPerEm * 0.8);
    info.descender = info.typoDescender != null ? info.typoDescender : -Math.round(info.unitsPerEm * 0.2);
  }
  return { info, cmap, dir };
}

module.exports = { readInfo, parseName, parseCmap, parseFvar, tagList, NAME_LABELS, EMBEDDING };
