'use strict';
// Font containers: detect the format, read the table directory, split a TTC, unpack WOFF,
// and write a plain sfnt (TrueType/OpenType) file from a list of tables.
const zlib = require('zlib');

class FontError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code || 'bad-font';
  }
}

const SIG = {
  0x00010000: 'ttf',
  0x74727565: 'ttf', // 'true' (old Apple TrueType)
  0x4f54544f: 'otf', // 'OTTO' (CFF outlines)
  0x774f4646: 'woff', // 'wOFF'
  0x774f4632: 'woff2', // 'wOF2'
  0x74746366: 'ttc', // 'ttcf'
};

/** Returns 'ttf' | 'otf' | 'woff' | 'woff2' | 'ttc' | null from the first 4 bytes. */
function detect(buf) {
  if (!buf || buf.length < 12) return null;
  return SIG[buf.readUInt32BE(0)] || null;
}

function tagAt(buf, off) {
  return buf.toString('latin1', off, off + 4);
}

/** Reads an sfnt table directory at `off`. Returns { flavor, tables: Map(tag -> {offset, length, checksum}) }. */
function readDirectory(buf, off = 0) {
  if (off + 12 > buf.length) throw new FontError('The file ends inside the font header.', 'truncated');
  const flavor = buf.readUInt32BE(off);
  const numTables = buf.readUInt16BE(off + 4);
  if (numTables === 0 || numTables > 1000) throw new FontError(`The font header lists ${numTables} tables, which is not valid.`);
  if (off + 12 + numTables * 16 > buf.length) throw new FontError('The file ends inside the table directory.', 'truncated');
  const tables = new Map();
  for (let i = 0; i < numTables; i++) {
    const r = off + 12 + i * 16;
    const tag = tagAt(buf, r);
    const offset = buf.readUInt32BE(r + 8);
    const length = buf.readUInt32BE(r + 12);
    if (offset + length > buf.length) throw new FontError(`Table '${tag.trim()}' points past the end of the file. The file may be cut off.`, 'truncated');
    tables.set(tag, { offset, length, checksum: buf.readUInt32BE(r + 4) });
  }
  return { flavor, tables };
}

/** Table data (a Buffer view) from a directory entry. */
function tableData(buf, dir, tag) {
  const t = dir.tables.get(tag);
  return t ? buf.subarray(t.offset, t.offset + t.length) : null;
}

function checksum(data) {
  let sum = 0;
  const n = data.length;
  for (let i = 0; i < n; i += 4) {
    const b0 = data[i], b1 = i + 1 < n ? data[i + 1] : 0, b2 = i + 2 < n ? data[i + 2] : 0, b3 = i + 3 < n ? data[i + 3] : 0;
    sum = (sum + ((b0 << 24) >>> 0) + (b1 << 16) + (b2 << 8) + b3) >>> 0;
  }
  return sum >>> 0;
}

/**
 * Writes a plain sfnt from tables.
 * @param {number} flavor 0x00010000 or 'OTTO'
 * @param {{tag:string, data:Buffer}[]} tables
 */
function buildSfnt(flavor, tables) {
  const list = tables.slice().sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));
  const n = list.length;
  let es = 0;
  while (1 << (es + 1) <= n) es++;
  const searchRange = (1 << es) * 16;
  const headerLen = 12 + n * 16;
  let total = headerLen;
  for (const t of list) total += (t.data.length + 3) & ~3;
  const out = Buffer.alloc(total);
  out.writeUInt32BE(flavor >>> 0, 0);
  out.writeUInt16BE(n, 4);
  out.writeUInt16BE(searchRange, 6);
  out.writeUInt16BE(es, 8);
  out.writeUInt16BE(n * 16 - searchRange, 10);
  let off = headerLen;
  let headOff = -1;
  list.forEach((t, i) => {
    const r = 12 + i * 16;
    let data = t.data;
    if (t.tag === 'head' && data.length >= 12) {
      data = Buffer.from(data);
      data.writeUInt32BE(0, 8); // checksumAdjustment is computed below
      headOff = off;
    }
    out.write(t.tag, r, 4, 'latin1');
    out.writeUInt32BE(checksum(data), r + 4);
    out.writeUInt32BE(off, r + 8);
    out.writeUInt32BE(data.length, r + 12);
    data.copy(out, off);
    off += (data.length + 3) & ~3;
  });
  if (headOff >= 0) out.writeUInt32BE((0xb1b0afba - checksum(out)) >>> 0, headOff + 8);
  return out;
}

/** Offsets of the fonts in a TTC. */
function ttcOffsets(buf) {
  if (buf.length < 12) throw new FontError('The collection header is cut off.', 'truncated');
  const num = buf.readUInt32BE(8);
  if (num === 0 || num > 10000 || 12 + num * 4 > buf.length) throw new FontError(`The collection header lists ${num} fonts, which is not valid.`);
  const offs = [];
  for (let i = 0; i < num; i++) offs.push(buf.readUInt32BE(12 + i * 4));
  return offs;
}

/** Copies one font of a TTC into a standalone sfnt. */
function extractTtc(buf, index) {
  const offs = ttcOffsets(buf);
  if (index < 0 || index >= offs.length) throw new FontError(`The collection has ${offs.length} fonts; font ${index + 1} does not exist.`);
  const dir = readDirectory(buf, offs[index]);
  const tables = [];
  for (const [tag] of dir.tables) tables.push({ tag, data: tableData(buf, dir, tag) });
  return buildSfnt(dir.flavor, tables);
}

/** Unpacks a WOFF 1.0 file into a plain sfnt. */
function decodeWoff(buf, limits = {}) {
  if (buf.length < 44) throw new FontError('The WOFF header is cut off.', 'truncated');
  const flavor = buf.readUInt32BE(4);
  const numTables = buf.readUInt16BE(12);
  const totalSfntSize = buf.readUInt32BE(16);
  const max = limits.maxBytes || 256 * 1024 * 1024;
  if (totalSfntSize > max) throw new FontError(`The WOFF file says it unpacks to ${totalSfntSize} bytes, over the limit.`, 'too-large');
  if (44 + numTables * 20 > buf.length) throw new FontError('The file ends inside the WOFF table directory.', 'truncated');
  const tables = [];
  for (let i = 0; i < numTables; i++) {
    const r = 44 + i * 20;
    const tag = tagAt(buf, r);
    const offset = buf.readUInt32BE(r + 4);
    const compLength = buf.readUInt32BE(r + 8);
    const origLength = buf.readUInt32BE(r + 12);
    if (offset + compLength > buf.length) throw new FontError(`WOFF table '${tag.trim()}' points past the end of the file.`, 'truncated');
    let data = buf.subarray(offset, offset + compLength);
    if (compLength < origLength) {
      try {
        data = zlib.inflateSync(data, { maxOutputLength: origLength });
      } catch (e) {
        throw new FontError(`WOFF table '${tag.trim()}' could not be unpacked (${e.code || e.message}).`);
      }
    }
    if (data.length !== origLength) throw new FontError(`WOFF table '${tag.trim()}' unpacked to the wrong size.`);
    tables.push({ tag, data });
  }
  return buildSfnt(flavor, tables);
}

module.exports = { FontError, detect, readDirectory, tableData, buildSfnt, checksum, ttcOffsets, extractTtc, decodeWoff };
