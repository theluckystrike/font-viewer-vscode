'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { read } = require('./helpers');
const S = require('../src/core/sfnt');
const { openFont } = require('../src/core/font');

test('detect: every container signature, and null for other files', () => {
  assert.equal(S.detect(read('zovo-test.ttf')), 'ttf');
  assert.equal(S.detect(read('zovo-test.otf')), 'otf');
  assert.equal(S.detect(read('zovo-test.woff')), 'woff');
  assert.equal(S.detect(read('zovo-test.woff2')), 'woff2');
  assert.equal(S.detect(read('zovo-test.ttc')), 'ttc');
  assert.equal(S.detect(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), null);
  assert.equal(S.detect(Buffer.alloc(3)), null);
});

test('buildSfnt: table checksums and head checksumAdjustment are valid', () => {
  const out = S.buildSfnt(0x00010000, [{ tag: 'name', data: Buffer.from([0, 0, 0, 0, 0, 6]) }, { tag: 'head', data: read('zovo-test.ttf').subarray(0, 54) }]);
  const dir = S.readDirectory(out);
  assert.deepEqual([...dir.tables.keys()], ['head', 'name']);
  for (const [tag, t] of dir.tables) {
    const data = Buffer.from(out.subarray(t.offset, t.offset + t.length));
    if (tag === 'head') data.writeUInt32BE(0, 8);
    assert.equal(S.checksum(data), t.checksum, tag);
  }
  assert.equal(S.checksum(out), 0xb1b0afba);
});

test('WOFF 1.0 unpacks to the same tables as the TTF', () => {
  const ttf = read('zovo-test.ttf');
  const sf = S.decodeWoff(read('zovo-test.woff'));
  const a = S.readDirectory(ttf), b = S.readDirectory(sf);
  assert.deepEqual([...b.tables.keys()].sort(), [...a.tables.keys()].sort());
  for (const tag of a.tables.keys()) {
    if (tag === 'head') continue; // checksumAdjustment differs
    assert.ok(S.tableData(ttf, a, tag).equals(S.tableData(sf, b, tag)), tag);
  }
});

test('TTC: lists both faces and extracts each one as a standalone font', () => {
  const buf = read('zovo-test.ttc');
  assert.equal(S.ttcOffsets(buf).length, 2);
  const f0 = openFont(buf, { face: 0 }), f1 = openFont(buf, { face: 1 });
  assert.deepEqual(f0.info.faces, ['Zovo Test Sans Regular', 'Zovo Test Sans Bold']);
  assert.equal(f0.info.subfamily, 'Regular');
  assert.equal(f1.info.subfamily, 'Bold');
  assert.equal(f1.info.weightClass, 700);
  assert.equal(S.detect(f1.webBytes), 'ttf', 'the webview gets a plain sfnt for the chosen face');
  assert.equal(openFont(buf, { face: 99 }).info.face, 1, 'out-of-range face is clamped');
  assert.throws(() => S.extractTtc(buf, 5), /2 fonts/);
});

test('errors: text, SVG, empty, cut and damaged files give clear messages', () => {
  assert.throws(() => openFont(Buffer.from('hello world, not a font at all')), (e) => e.code === 'not-font' && /not a font/.test(e.message));
  assert.throws(() => openFont(Buffer.from('<?xml version="1.0"?><svg/>')), (e) => e.code === 'not-font' && /SVG fonts/.test(e.message));
  assert.throws(() => openFont(Buffer.alloc(0)), (e) => e.code === 'not-font');
  const ttf = read('zovo-test.ttf');
  assert.throws(() => openFont(ttf.subarray(0, 100)), (e) => e.code === 'truncated');
  assert.throws(() => openFont(read('zovo-test.woff').subarray(0, 300)), (e) => e.code === 'truncated');
  const bad = Buffer.from(ttf); bad.writeUInt16BE(0, 4);
  assert.throws(() => openFont(bad), /0 tables/);
});
