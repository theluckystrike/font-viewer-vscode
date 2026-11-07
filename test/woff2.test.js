'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { read, allPaths } = require('./helpers');
const S = require('../src/core/sfnt');
const { decodeWoff2, readHeader } = require('../src/core/woff2');
const { openFont } = require('../src/core/font');

function sameTables(a, b, skip) {
  const da = S.readDirectory(a), db = S.readDirectory(b);
  assert.deepEqual([...db.tables.keys()].sort(), [...da.tables.keys()].sort());
  for (const tag of da.tables.keys()) {
    if (skip.includes(tag)) continue;
    assert.ok(S.tableData(a, da, tag).equals(S.tableData(b, db, tag)), `table ${tag}`);
  }
}

test('WOFF2: Zovo Test Sans (glyf/loca transform) gives the same outlines as the TTF', () => {
  const h = readHeader(read('zovo-test.woff2'));
  assert.ok(h.tables.find((t) => t.tag === 'glyf').transformed);
  const sf = decodeWoff2(read('zovo-test.woff2'));
  sameTables(read('zovo-test.ttf'), sf, ['head', 'glyf', 'loca']);
  assert.deepEqual(allPaths(openFont(read('zovo-test.woff2'))), allPaths(openFont(read('zovo-test.ttf'))));
});

test('WOFF2: the hmtx transform is rebuilt byte for byte', () => {
  const h = readHeader(read('zovo-test-hmtx.woff2'));
  assert.ok(h.tables.find((t) => t.tag === 'hmtx').transformed);
  const sf = decodeWoff2(read('zovo-test-hmtx.woff2'));
  sameTables(read('zovo-test.ttf'), sf, ['head', 'glyf', 'loca']);
});

test('WOFF2: JetBrains Mono variable font (394 glyphs, composites) matches its TTF', () => {
  const w = openFont(read('jetbrains-mono-latin-wght-normal.woff2'));
  const t = openFont(read('jetbrains-mono-var.ttf'));
  assert.equal(w.numGlyphs, 394);
  sameTables(t.sfnt, w.sfnt, ['head', 'glyf', 'loca']);
  assert.deepEqual(allPaths(w), allPaths(t));
});

test('WOFF2: cut, damaged and oversized files are refused with a message', () => {
  const buf = read('zovo-test.woff2');
  assert.throws(() => decodeWoff2(buf.subarray(0, 40)), (e) => e.code === 'truncated');
  assert.throws(() => decodeWoff2(buf.subarray(0, buf.length - 200)), (e) => e.code === 'truncated');
  const bad = Buffer.from(buf);
  for (let i = bad.length - 300; i < bad.length - 100; i++) bad[i] ^= 0x5a;
  assert.throws(() => decodeWoff2(bad), /WOFF2/);
  const big = Buffer.from(buf);
  big.writeUInt32BE(0x7fffffff, 16); // totalSfntSize
  assert.throws(() => decodeWoff2(big, { maxBytes: 1024 * 1024 }), (e) => e.code === 'too-large');
});
