'use strict';
// WOFF2 to sfnt. Our own MIT decoder after the W3C WOFF2 spec: Brotli comes from Node's zlib,
// and the glyf/loca and hmtx transforms are rebuilt here.
const zlib = require('zlib');
const { FontError, buildSfnt } = require('./sfnt');

const KNOWN_TAGS = [
  'cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm', 'glyf', 'loca', 'prep', 'CFF ', 'VORG', 'EBDT',
  'EBLC', 'gasp', 'hdmx', 'kern', 'LTSH', 'PCLT', 'VDMX', 'vhea', 'vmtx', 'BASE', 'GDEF', 'GPOS', 'GSUB', 'EBSC', 'JSTF', 'MATH',
  'CBDT', 'CBLC', 'COLR', 'CPAL', 'SVG ', 'sbix', 'acnt', 'avar', 'bdat', 'bloc', 'bsln', 'cvar', 'fdsc', 'feat', 'fmtx', 'fvar',
  'gvar', 'hsty', 'just', 'lcar', 'mort', 'morx', 'opbd', 'prop', 'trak', 'Zapf', 'Silf', 'Glat', 'Gloc', 'Feat', 'Sill',
];

class Reader {
  constructor(buf, start = 0, end = buf.length) {
    this.buf = buf;
    this.pos = start;
    this.end = end;
  }
  need(n) {
    if (this.pos + n > this.end) throw new FontError('The WOFF2 data ends too early. The file may be cut off or damaged.', 'truncated');
  }
  u8() { this.need(1); return this.buf[this.pos++]; }
  u16() { this.need(2); const v = this.buf.readUInt16BE(this.pos); this.pos += 2; return v; }
  i16() { this.need(2); const v = this.buf.readInt16BE(this.pos); this.pos += 2; return v; }
  u32() { this.need(4); const v = this.buf.readUInt32BE(this.pos); this.pos += 4; return v; }
  bytes(n) { this.need(n); const v = this.buf.subarray(this.pos, this.pos + n); this.pos += n; return v; }
  base128() {
    let v = 0;
    for (let i = 0; i < 5; i++) {
      const b = this.u8();
      if (i === 0 && b === 0x80) throw new FontError('Bad number encoding in the WOFF2 table directory.');
      if (v & 0xfe000000) throw new FontError('A number in the WOFF2 table directory is too large.');
      v = (v << 7) | (b & 0x7f);
      if (!(b & 0x80)) return v >>> 0;
    }
    throw new FontError('A number in the WOFF2 table directory is too long.');
  }
  u255() {
    const c = this.u8();
    if (c === 253) return this.u16();
    if (c === 255) return this.u8() + 253;
    if (c === 254) return this.u8() + 506;
    return c;
  }
}

function readHeader(buf) {
  if (buf.length < 48) throw new FontError('The WOFF2 header is cut off.', 'truncated');
  const r = new Reader(buf, 4);
  const h = { flavor: r.u32(), length: r.u32(), numTables: r.u16() };
  r.u16();
  h.totalSfntSize = r.u32();
  h.totalCompressedSize = r.u32();
  r.pos = 48;
  h.tables = [];
  let dataOff = 0;
  for (let i = 0; i < h.numTables; i++) {
    const flags = r.u8();
    const idx = flags & 0x3f;
    const tag = idx === 63 ? r.bytes(4).toString('latin1') : KNOWN_TAGS[idx];
    if (!tag) throw new FontError('Unknown table index in the WOFF2 directory.');
    const version = (flags >> 6) & 3;
    const origLength = r.base128();
    const transformed = tag === 'glyf' || tag === 'loca' ? version === 0 : version !== 0;
    const transformLength = transformed ? r.base128() : origLength;
    h.tables.push({ tag, version, origLength, transformed, length: transformLength, offset: dataOff });
    dataOff += transformLength;
  }
  h.dataLength = dataOff;
  if (h.flavor === 0x74746366) throw new FontError('This is a WOFF2 font collection. Font Viewer opens single WOFF2 fonts and .ttc collections, not WOFF2 collections yet.', 'unsupported');
  h.dataStart = r.pos;
  return h;
}

function withSign(flag, v) {
  return flag & 1 ? v : -v;
}

/** Rebuilds glyf and loca from the WOFF2 transformed glyf table. */
function rebuildGlyf(data, locaOrigLength) {
  const r = new Reader(data);
  r.u16(); // reserved
  const optionFlags = r.u16();
  const numGlyphs = r.u16();
  const indexFormat = r.u16();
  const sizes = [];
  for (let i = 0; i < 7; i++) sizes.push(r.u32());
  let off = r.pos;
  const streams = sizes.map((s) => {
    const st = new Reader(data, off, off + s);
    if (off + s > data.length) throw new FontError('The WOFF2 glyph data is cut off.', 'truncated');
    off += s;
    return st;
  });
  const [nContourS, nPointsS, flagS, glyphS, compositeS, bboxS, instrS] = streams;
  let overlap = null;
  if (optionFlags & 1) overlap = data.subarray(off, off + ((numGlyphs + 7) >> 3));
  const bitmapLen = 4 * Math.floor((numGlyphs + 31) / 32);
  const bboxBitmap = bboxS.bytes(bitmapLen);
  const hasBbox = (i) => (bboxBitmap[i >> 3] & (0x80 >> (i & 7))) !== 0;
  const xMins = new Int16Array(numGlyphs);
  const parts = [];
  const loca = new Array(numGlyphs + 1);
  let pos = 0;
  const pad = indexFormat ? 4 : 2;
  for (let g = 0; g < numGlyphs; g++) {
    loca[g] = pos;
    const nContours = nContourS.i16();
    let glyph;
    if (nContours === 0) {
      if (hasBbox(g)) throw new FontError(`WOFF2 glyph ${g} is empty but has a bounding box.`);
      glyph = Buffer.alloc(0);
    } else if (nContours === -1) {
      if (!hasBbox(g)) throw new FontError(`WOFF2 composite glyph ${g} has no bounding box.`);
      const start = compositeS.pos;
      let haveInstr = false;
      let flags;
      do {
        flags = compositeS.u16();
        compositeS.u16();
        compositeS.bytes(flags & 1 ? 4 : 2);
        if (flags & 8) compositeS.bytes(2);
        else if (flags & 0x40) compositeS.bytes(4);
        else if (flags & 0x80) compositeS.bytes(8);
        if (flags & 0x100) haveInstr = true;
      } while (flags & 0x20);
      const comp = data.subarray(start, compositeS.pos);
      const bbox = bboxS.bytes(8);
      let instr = null;
      if (haveInstr) instr = instrS.bytes(glyphS.u255());
      glyph = Buffer.alloc(2 + 8 + comp.length + (instr ? 2 + instr.length : 0));
      glyph.writeInt16BE(-1, 0);
      bbox.copy(glyph, 2);
      comp.copy(glyph, 10);
      if (instr) {
        glyph.writeUInt16BE(instr.length, 10 + comp.length);
        instr.copy(glyph, 12 + comp.length);
      }
      xMins[g] = bbox.readInt16BE(0);
    } else if (nContours > 0) {
      const ends = [];
      let total = 0;
      for (let c = 0; c < nContours; c++) {
        total += nPointsS.u255();
        ends.push(total - 1);
      }
      const xs = new Int32Array(total), ys = new Int32Array(total), on = new Uint8Array(total);
      let x = 0, y = 0;
      for (let p = 0; p < total; p++) {
        let flag = flagS.u8();
        on[p] = flag >> 7 ? 0 : 1;
        flag &= 0x7f;
        let dx, dy;
        if (flag < 10) {
          dx = 0;
          dy = withSign(flag, ((flag & 14) << 7) + glyphS.u8());
        } else if (flag < 20) {
          dx = withSign(flag, (((flag - 10) & 14) << 7) + glyphS.u8());
          dy = 0;
        } else if (flag < 84) {
          const b0 = flag - 20, b1 = glyphS.u8();
          dx = withSign(flag, 1 + (b0 & 0x30) + (b1 >> 4));
          dy = withSign(flag >> 1, 1 + ((b0 & 0x0c) << 2) + (b1 & 0x0f));
        } else if (flag < 120) {
          const b0 = flag - 84, b1 = glyphS.u8(), b2 = glyphS.u8();
          dx = withSign(flag, 1 + (Math.floor(b0 / 12) << 8) + b1);
          dy = withSign(flag >> 1, 1 + (((b0 % 12) >> 2) << 8) + b2);
        } else if (flag < 124) {
          const b1 = glyphS.u8(), b2 = glyphS.u8(), b3 = glyphS.u8();
          dx = withSign(flag, (b1 << 4) + (b2 >> 4));
          dy = withSign(flag >> 1, ((b2 & 0x0f) << 8) + b3);
        } else {
          const b1 = glyphS.u8(), b2 = glyphS.u8(), b3 = glyphS.u8(), b4 = glyphS.u8();
          dx = withSign(flag, (b1 << 8) + b2);
          dy = withSign(flag >> 1, (b3 << 8) + b4);
        }
        x += dx;
        y += dy;
        xs[p] = x;
        ys[p] = y;
      }
      const instr = instrS.bytes(glyphS.u255());
      let bbox;
      if (hasBbox(g)) {
        const b = bboxS.bytes(8);
        bbox = [b.readInt16BE(0), b.readInt16BE(2), b.readInt16BE(4), b.readInt16BE(6)];
      } else {
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (let p = 0; p < total; p++) {
          if (xs[p] < x0) x0 = xs[p];
          if (xs[p] > x1) x1 = xs[p];
          if (ys[p] < y0) y0 = ys[p];
          if (ys[p] > y1) y1 = ys[p];
        }
        bbox = total ? [x0, y0, x1, y1] : [0, 0, 0, 0];
      }
      xMins[g] = bbox[0];
      // Encode flags and coordinates in the normal glyf form.
      const fl = [], xb = [], yb = [];
      let px = 0, py = 0;
      const overlapFirst = overlap && (overlap[g >> 3] & (0x80 >> (g & 7)));
      for (let p = 0; p < total; p++) {
        let f = on[p] ? 1 : 0;
        if (p === 0 && overlapFirst) f |= 0x40;
        const dx = xs[p] - px, dy = ys[p] - py;
        px = xs[p];
        py = ys[p];
        if (dx === 0) f |= 0x10;
        else if (dx >= -255 && dx <= 255) { f |= 0x02 | (dx > 0 ? 0x10 : 0); xb.push(Math.abs(dx)); }
        else xb.push((dx >> 8) & 0xff, dx & 0xff);
        if (dy === 0) f |= 0x20;
        else if (dy >= -255 && dy <= 255) { f |= 0x04 | (dy > 0 ? 0x20 : 0); yb.push(Math.abs(dy)); }
        else yb.push((dy >> 8) & 0xff, dy & 0xff);
        fl.push(f);
      }
      glyph = Buffer.alloc(10 + nContours * 2 + 2 + instr.length + fl.length + xb.length + yb.length);
      let o = glyph.writeInt16BE(nContours, 0);
      for (const v of bbox) o = glyph.writeInt16BE(v, o);
      for (const e of ends) o = glyph.writeUInt16BE(e, o);
      o = glyph.writeUInt16BE(instr.length, o);
      instr.copy(glyph, o);
      o += instr.length;
      for (const arr of [fl, xb, yb]) { Buffer.from(arr).copy(glyph, o); o += arr.length; }
    } else {
      throw new FontError(`WOFF2 glyph ${g} has an invalid contour count (${nContours}).`);
    }
    parts.push(glyph);
    pos += glyph.length;
    const extra = (pad - (glyph.length % pad)) % pad;
    if (extra) { parts.push(Buffer.alloc(extra)); pos += extra; }
  }
  loca[numGlyphs] = pos;
  const glyf = Buffer.concat(parts);
  const locaBuf = Buffer.alloc((numGlyphs + 1) * (indexFormat ? 4 : 2));
  for (let i = 0; i <= numGlyphs; i++) {
    if (indexFormat) locaBuf.writeUInt32BE(loca[i], i * 4);
    else locaBuf.writeUInt16BE(loca[i] / 2, i * 2);
  }
  if (locaOrigLength != null && locaOrigLength !== locaBuf.length) throw new FontError('The rebuilt loca table has the wrong size.');
  return { glyf, loca: locaBuf, numGlyphs, xMins };
}

/** Rebuilds hmtx from the WOFF2 transformed form (version 1). */
function rebuildHmtx(data, numHMetrics, numGlyphs, xMins) {
  const r = new Reader(data);
  const flags = r.u8();
  const adv = [];
  for (let i = 0; i < numHMetrics; i++) adv.push(r.u16());
  const lsb = [];
  for (let i = 0; i < numHMetrics; i++) lsb.push(flags & 1 ? xMins[i] : r.i16());
  for (let i = numHMetrics; i < numGlyphs; i++) lsb.push(flags & 2 ? xMins[i] : r.i16());
  const out = Buffer.alloc(numHMetrics * 4 + (numGlyphs - numHMetrics) * 2);
  let o = 0;
  for (let i = 0; i < numHMetrics; i++) { o = out.writeUInt16BE(adv[i], o); o = out.writeInt16BE(lsb[i], o); }
  for (let i = numHMetrics; i < numGlyphs; i++) o = out.writeInt16BE(lsb[i], o);
  return out;
}

/**
 * Unpacks a WOFF2 file into a plain sfnt Buffer.
 * @param {Buffer} buf
 * @param {{maxBytes?:number}} [limits]
 */
function decodeWoff2(buf, limits = {}) {
  const h = readHeader(buf);
  const max = limits.maxBytes || 256 * 1024 * 1024;
  if (h.totalSfntSize > max || h.dataLength > max) throw new FontError('This WOFF2 file says it unpacks to more than the size limit.', 'too-large');
  if (h.dataStart + h.totalCompressedSize > buf.length) throw new FontError('The WOFF2 data is cut off.', 'truncated');
  let raw;
  try {
    raw = zlib.brotliDecompressSync(buf.subarray(h.dataStart, h.dataStart + h.totalCompressedSize), { maxOutputLength: Math.max(h.dataLength, 1) });
  } catch (e) {
    throw new FontError(`The WOFF2 data could not be unpacked (${e.code || e.message}).`, 'truncated');
  }
  if (raw.length < h.dataLength) throw new FontError('The WOFF2 data is shorter than its table directory says.', 'truncated');
  const get = (t) => raw.subarray(t.offset, t.offset + t.length);
  const byTag = new Map(h.tables.map((t) => [t.tag, t]));
  const out = [];
  let rebuilt = null;
  const glyfT = byTag.get('glyf');
  if (glyfT && glyfT.transformed) {
    const locaT = byTag.get('loca');
    rebuilt = rebuildGlyf(get(glyfT), locaT ? locaT.origLength : null);
  }
  for (const t of h.tables) {
    if (t.tag === 'glyf' && rebuilt) out.push({ tag: 'glyf', data: rebuilt.glyf });
    else if (t.tag === 'loca' && rebuilt) out.push({ tag: 'loca', data: rebuilt.loca });
    else if (t.tag === 'hmtx' && t.transformed) {
      if (!rebuilt) throw new FontError('The WOFF2 hmtx table is transformed but there is no transformed glyf table.');
      const hhea = byTag.get('hhea');
      if (!hhea) throw new FontError('The WOFF2 font has no hhea table.');
      const numHMetrics = get(hhea).readUInt16BE(34);
      out.push({ tag: 'hmtx', data: rebuildHmtx(get(t), numHMetrics, rebuilt.numGlyphs, rebuilt.xMins) });
    } else if (t.transformed) {
      throw new FontError(`WOFF2 table '${t.tag.trim()}' uses a transform this viewer does not know.`, 'unsupported');
    } else out.push({ tag: t.tag, data: get(t) });
  }
  return buildSfnt(h.flavor, out);
}

module.exports = { decodeWoff2, readHeader, KNOWN_TAGS };
