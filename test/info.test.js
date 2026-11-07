'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { read } = require('./helpers');
const { openFont, unicodeRange, fontFaceCss } = require('../src/core/font');
const { EMBEDDING } = require('../src/core/info');

test('info: name table, license fields, designer and metrics of Zovo Test Sans', () => {
  const { info } = openFont(read('zovo-test.ttf'));
  const byId = Object.fromEntries(info.names.map((n) => [n.id, n]));
  assert.equal(info.family, 'Zovo Test Sans');
  assert.equal(info.subfamily, 'Regular');
  assert.equal(info.version, 'Version 1.002');
  assert.equal(byId[9].label, 'Designer');
  assert.equal(byId[9].value, 'Zovo Font Lab');
  assert.match(byId[13].value, /SIL Open Font License/);
  assert.equal(byId[14].label, 'License URL');
  assert.equal(byId[12].value, 'https://zovo.one/fonts');
  assert.equal(info.unitsPerEm, 1000);
  assert.equal(info.ascender, 800);
  assert.equal(info.descender, -200);
  assert.equal(info.outlines, 'TrueType');
  assert.equal(info.numGlyphs, 14);
  assert.equal(info.codePoints, 10);
  assert.equal(info.vendor, 'ZOVO');
  assert.equal(info.embedding, 'Installable embedding');
  assert.deepEqual(info.gsubFeatures, ['liga', 'ss01']);
  assert.deepEqual(info.gposFeatures, ['kern']);
  assert.deepEqual(info.axes, []);
});

test('info: CFF outlines, WOFF2 and WOFF give the same metadata', () => {
  const ttf = openFont(read('zovo-test.ttf')).info;
  for (const f of ['zovo-test.otf', 'zovo-test.woff', 'zovo-test.woff2']) {
    const i = openFont(read(f)).info;
    assert.equal(i.family, ttf.family, f);
    assert.deepEqual(i.names.map((n) => n.value), ttf.names.map((n) => n.value), f);
    assert.deepEqual(i.gsubFeatures, ttf.gsubFeatures, f);
  }
  assert.equal(openFont(read('zovo-test.otf')).info.outlines, 'CFF');
  assert.equal(openFont(read('zovo-test.woff2')).info.formatLabel, 'WOFF2');
});

test('info: variable axes and named instances of JetBrains Mono', () => {
  const { info } = openFont(read('jetbrains-mono-latin-wght-normal.woff2'));
  assert.equal(info.axes.length, 1);
  assert.deepEqual({ ...info.axes[0] }, { tag: 'wght', min: 100, def: 400, max: 800, hidden: false, name: 'Weight' });
  assert.deepEqual(info.instances.map((x) => x.name), ['Thin', 'ExtraLight', 'Light', 'Regular', 'Medium', 'Bold', 'ExtraBold']);
  assert.equal(info.instances[5].coords.wght, 700);
  assert.deepEqual(info.gsubFeatures, ['calt', 'ccmp', 'frac', 'locl']);
  assert.equal(info.fixedPitch, true);
  assert.match(info.names.find((n) => n.id === 14).value, /OFL/);
});

test('info: embedding rights from OS/2 fsType', () => {
  assert.equal(EMBEDDING(0), 'Installable embedding');
  assert.equal(EMBEDDING(2), 'Restricted license embedding');
  assert.equal(EMBEDDING(4 | 0x100), 'Preview and print embedding, no subsetting');
  assert.equal(EMBEDDING(8 | 0x200), 'Editable embedding, bitmap embedding only');
});

test('glyphs: names, code points, advance and outline for each glyph', () => {
  const f = openFont(read('zovo-test.ttf'));
  const a = f.glyph(2);
  assert.equal(a.name, 'A');
  assert.deepEqual(a.cps, [0x41]);
  assert.equal(a.adv, 600);
  assert.match(a.d, /^M/);
  const lig = f.glyph(f.names().indexOf('f_i'));
  assert.deepEqual(lig.cps, [], 'ligature glyph has no code point but is listed');
  assert.equal(f.glyph(f.names().indexOf('space')).d, '');
});

test('search: by name, by character, by U+ code point, by hex and by glyph id', () => {
  const f = openFont(read('zovo-test.ttf'));
  const names = (q) => f.search(q).ids.map((i) => f.glyphName(i));
  assert.equal(f.search('').ids, null);
  assert.equal(f.search('').total, 14);
  assert.deepEqual(names('ss01'), ['A.ss01']);
  assert.deepEqual(names('€'), ['Euro']);
  assert.deepEqual(names('U+20AC'), ['Euro']);
  assert.deepEqual(names('0x3a9'), ['Omega']);
  assert.deepEqual(names('20AC'), ['Euro']);
  assert.deepEqual(names('#3'), [f.glyphName(3)]);
  assert.deepEqual(names('nothing-like-this'), []);
  assert.equal(names('A')[0], 'A', 'the typed character comes first');
});

test('page: paging over all glyphs and over a search', () => {
  const f = openFont(read('jetbrains-mono-latin-wght-normal.woff2'));
  const p1 = f.page('', 0, 100), p4 = f.page('', 300, 100);
  assert.equal(p1.total, 394);
  assert.equal(p1.items.length, 100);
  assert.equal(p4.items.length, 94);
  assert.equal(p4.items[0].id, 300);
  const s = f.page('acute', 0, 5);
  assert.ok(s.total > 5);
  assert.equal(s.items.length, 5);
  assert.ok(s.items.every((g) => /acute/i.test(g.name)));
  assert.equal(f.page('', 0, 99999).items.length, 394, 'limit is capped at 1000');
});

test('character map: coverage per Unicode block and the cells of one block', () => {
  const f = openFont(read('zovo-test.ttf'));
  const b = f.blocks();
  assert.deepEqual(b.list.map((x) => [x.name, x.covered]), [['Basic Latin', 7], ['Latin-1 Supplement', 1], ['Greek and Coptic', 1], ['Currency Symbols', 1]]);
  const basic = f.blockChars(b.list[0].index);
  assert.equal(basic.cells.length, 128);
  assert.deepEqual(basic.cells.find((c) => c[0] === 0x41), [0x41, 2]);
  assert.equal(basic.cells.find((c) => c[0] === 0x5a)[1], -1, 'Z is not in the font');
  assert.deepEqual(f.blockChars(99999).cells, []);
});

test('CSS: unicode-range is compact and @font-face uses the axis ranges', () => {
  assert.equal(unicodeRange([0x41, 0x42, 0x43, 0x45]), 'U+0041-0043, U+0045');
  const many = Array.from({ length: 200 }, (_, i) => i * 3);
  assert.equal(unicodeRange(many, 10).split(', ').length, 10);
  const v = openFont(read('jetbrains-mono-latin-wght-normal.woff2'));
  const css = fontFaceCss(v.info, 'mono.woff2', v.cmap);
  assert.match(css, /font-family: "JetBrains Mono";/);
  assert.match(css, /format\("woff2-variations"\)/);
  assert.match(css, /font-weight: 100 800;/);
  assert.match(css, /unicode-range: U\+000D, U\+0020-007E/);
  const s = openFont(read('zovo-test.otf'));
  const css2 = fontFaceCss(s.info, 'a "quoted" name.otf', s.cmap);
  assert.match(css2, /src: url\("\.\/a \\"quoted\\" name\.otf"\) format\("opentype"\);/);
  assert.match(css2, /font-weight: 400;/);
  assert.match(css2, /font-style: normal;/);
});
