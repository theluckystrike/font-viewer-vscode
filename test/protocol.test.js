'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const P = require('../src/core/protocol');
const { buildHtml } = require('../src/html');

test('protocol: valid messages pass and are copied field by field', () => {
  assert.deepEqual(P.validateWebviewMessage({ type: 'ready', extra: 1 }), { ok: true, msg: { type: 'ready' } });
  assert.deepEqual(P.validateWebviewMessage({ type: 'glyphs', query: 'a', offset: 0, limit: 240, seq: 3, x: 1 }).msg, { type: 'glyphs', query: 'a', offset: 0, limit: 240, seq: 3 });
  assert.deepEqual(P.validateWebviewMessage({ type: 'glyph', id: 5 }).msg, { type: 'glyph', id: 5 });
  assert.deepEqual(P.validateWebviewMessage({ type: 'copy', text: 'U+0041', what: 'code point' }).msg, { type: 'copy', text: 'U+0041', what: 'code point' });
  assert.equal(P.validateWebviewMessage({ type: 'face', index: 1 }).ok, true);
  assert.equal(P.validateWebviewMessage({ type: 'block', index: 0 }).ok, true);
});

test('protocol: unknown types and bad values are dropped', () => {
  for (const m of [null, 'ready', {}, { type: 'openExternal', url: 'https://x' }, { type: 'writeFile' }, { type: 'glyphs', query: 'x'.repeat(201), offset: 0, limit: 1, seq: 0 },
    { type: 'glyphs', query: '', offset: -1, limit: 1, seq: 0 }, { type: 'glyphs', query: '', offset: 0, limit: 5000, seq: 0 }, { type: 'glyph', id: 1.5 }, { type: 'glyph', id: 70000 },
    { type: 'copy', text: '' }, { type: 'copy', text: 'a\0b' }, { type: 'copy', text: 'x'.repeat(200001) }, { type: 'face', index: '1' }]) {
    assert.equal(P.validateWebviewMessage(m).ok, false, JSON.stringify(m && m.type));
  }
});

test('protocol: CSS settings strings and feature names', () => {
  assert.equal(P.featureSettings({ liga: false, ss01: true }), '"liga" 0, "ss01" 1');
  assert.equal(P.featureSettings({ 'x"yz': true }), '');
  assert.equal(P.variationSettings({ wght: 650.123, wdth: 87.5 }), '"wdth" 87.5, "wght" 650.12');
  assert.equal(P.variationSettings({ wght: NaN }), '');
  assert.equal(P.featureName('ss03'), 'Stylistic set 3');
  assert.equal(P.featureName('cv11'), 'Character variant 11');
  assert.equal(P.featureName('liga'), 'Standard ligatures');
  assert.equal(P.featureName('zzzz'), '');
  assert.equal(P.cpLabel(0x41), 'U+0041');
  assert.equal(P.cpLabel(0x1f600), 'U+1F600');
  assert.equal(P.fmtSize(40404), '39.5 KB');
});

test('html: strict CSP with a nonce, no remote origins, escaped title', () => {
  const html = buildHtml({ cspSource: 'https://csp', scriptUri: 'https://res/w.js', styleUri: 'https://res/w.css', title: '<img src=x onerror=alert(1)>.ttf', nonce: 'NONCE' });
  const csp = /content="([^"]+)"/.exec(html)[1];
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /script-src 'nonce-NONCE'/);
  assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval|https?:\/\/(?!csp)/);
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;.ttf'));
  assert.ok(!html.includes('<img'));
  assert.equal((html.match(/<script/g) || []).length, 1);
});

test('safety: webview code has no innerHTML or eval, host code has no network modules', () => {
  const src = (p) => fs.readFileSync(path.join(__dirname, '..', 'src', p), 'utf8');
  for (const f of ['webview/main.js', 'webview/view.js']) {
    const s = src(f);
    assert.doesNotMatch(s, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function|fetch\(|XMLHttpRequest|setAttribute\('style'/, f);
  }
  for (const f of ['extension.js', 'core/font.js', 'core/sfnt.js', 'core/woff2.js', 'core/info.js']) {
    assert.doesNotMatch(src(f), /require\(['"](https?|net|tls|dgram|child_process)['"]\)/, f);
  }
  const bundle = fs.readFileSync(path.join(__dirname, '..', 'dist', 'extension.js'), 'utf8');
  assert.doesNotMatch(bundle, /require\("(https?|net|tls|child_process)"\)/);
});
