'use strict';
// The extension host on a mocked VS Code API.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const { fixture } = require('./helpers');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zfv-ext-'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

class Uri {
  constructor(scheme, p) { this.scheme = scheme; this.path = p; }
  static file(p) { return new Uri('file', p); }
  static parse(s) { return new Uri('https', s); }
  static joinPath(u, ...s) { return new Uri(u.scheme, path.posix.join(u.path, ...s)); }
  get fsPath() { return this.path; }
  toString() { return `${this.scheme}://${this.path}`; }
}
const state = { config: {}, clipboard: '', executed: [], infos: [], errors: [], status: [], openDialog: null, watchers: [] };
const vscodeMock = {
  Uri,
  RelativePattern: class { constructor(base, pattern) { this.base = base; this.pattern = pattern; } },
  QuickPickItemKind: { Separator: -1 },
  workspace: {
    getConfiguration: () => ({ get: (k, d) => (k in state.config ? state.config[k] : d) }),
    fs: {
      stat: async (u) => { const st = fs.statSync(u.fsPath); return { size: st.size, mtime: st.mtimeMs }; },
      readFile: async (u) => new Uint8Array(fs.readFileSync(u.fsPath)),
    },
    createFileSystemWatcher(p) {
      const w = { p, h: {}, dispose() {}, onDidChange(f) { w.h.change = f; return { dispose() {} }; }, onDidCreate(f) { w.h.create = f; return { dispose() {} }; } };
      state.watchers.push(w);
      return w;
    },
    isTrusted: true,
  },
  window: {
    registered: [], state: { focused: true }, tabGroups: { activeTabGroup: { activeTab: null } },
    registerCustomEditorProvider(id, p, o) { this.registered.push([id, p, o]); return { dispose() {} }; },
    showOpenDialog: async () => state.openDialog,
    showInformationMessage: async (...a) => { state.infos.push(a[0]); },
    showErrorMessage: async (m) => { state.errors.push(m); },
    setStatusBarMessage: (m) => { state.status.push(m); },
    showQuickPick: async () => undefined,
  },
  commands: {
    list: [], handlers: {},
    registerCommand(id, fn) { this.list.push(id); this.handlers[id] = fn; return { dispose() {} }; },
    executeCommand: async (...a) => { state.executed.push(a); },
  },
  extensions: { getExtension: () => undefined },
  env: { clipboard: { writeText: async (t) => { state.clipboard = t; } }, sessionId: 's1', openExternal: async () => true },
};
const origLoad = Module._load;
Module._load = function (req, ...rest) { return req === 'vscode' ? vscodeMock : origLoad.call(this, req, ...rest); };
const ext = require('../src/extension.js');
const pkg = require('../package.json');

const ctx = { extensionUri: Uri.file('/ext'), subscriptions: [], globalState: { data: new Map(), get(k) { return this.data.get(k); }, async update(k, v) { this.data.set(k, v); } } };
const api = ext.activate(ctx);

function fakePanel() {
  const sent = []; let handler = null; let dispose = null;
  const panel = {
    webview: { options: null, html: '', cspSource: 'https://csp', asWebviewUri: (u) => 'https://res' + u.path, postMessage: async (m) => { sent.push(m); return true; }, onDidReceiveMessage: (h) => { handler = h; return { dispose() {} }; } },
    onDidDispose: (h) => { dispose = h; },
  };
  return { panel, sent, send: (m) => handler(m), close: () => dispose(), last: (t) => sent.filter((m) => m.type === t).pop() };
}
async function openEditor(file) {
  const f = fakePanel();
  f.session = await api.provider.resolveCustomEditor({ uri: Uri.file(file) }, f.panel);
  return f;
}

test('activate: registers the editor and every command in package.json', () => {
  const [id, , opts] = vscodeMock.window.registered[0];
  assert.equal(id, ext.VIEW_TYPE);
  assert.equal(pkg.contributes.customEditors[0].viewType, ext.VIEW_TYPE);
  assert.equal(opts.webviewOptions.retainContextWhenHidden, true);
  assert.deepEqual(pkg.contributes.customEditors[0].selector.map((s) => s.filenamePattern), ['*.ttf', '*.otf', '*.woff', '*.woff2', '*.ttc', '*.otc']);
  for (const c of pkg.contributes.commands) assert.ok(vscodeMock.commands.list.includes(c.command), c.command);
  assert.equal(`${pkg.publisher}.${pkg.name}`, ext.SELF_ID);
});

test('editor: ready sends init with metadata, CSS, blocks and the font bytes', async () => {
  const f = await openEditor(fixture('jetbrains-mono-latin-wght-normal.woff2'));
  assert.match(f.panel.webview.html, /Content-Security-Policy/);
  await f.send({ type: 'ready' });
  const init = f.last('init');
  assert.equal(init.fileName, 'jetbrains-mono-latin-wght-normal.woff2');
  assert.equal(init.info.family, 'JetBrains Mono');
  assert.equal(init.info.axes[0].tag, 'wght');
  assert.equal(init.mime, 'font/woff2');
  assert.ok(init.font instanceof Uint8Array);
  assert.equal(init.font.length, fs.statSync(fixture('jetbrains-mono-latin-wght-normal.woff2')).size, 'the original WOFF2 bytes go to FontFace');
  assert.match(init.css, /@font-face/);
  assert.ok(init.blocks.list.length > 3);
  assert.equal(init.sampleText, 'The quick brown fox jumps over the lazy dog. 0123456789');
  assert.equal(state.watchers.at(-1).p.pattern, 'jetbrains-mono-latin-wght-normal.woff2');
});

test('editor: glyph pages, glyph detail, block cells and copy', async () => {
  const f = await openEditor(fixture('zovo-test.otf'));
  await f.send({ type: 'ready' });
  await f.send({ type: 'glyphs', query: '', offset: 0, limit: 240, seq: 1 });
  const g = f.last('glyphs');
  assert.equal(g.seq, 1);
  assert.equal(g.total, 14);
  assert.equal(g.items[2].name, 'A');
  await f.send({ type: 'glyphs', query: 'U+20AC', offset: 0, limit: 240, seq: 2 });
  assert.deepEqual(f.last('glyphs').items.map((x) => x.name), ['Euro']);
  await f.send({ type: 'glyph', id: 9 });
  assert.equal(f.last('glyph').item.name, 'f_i');
  await f.send({ type: 'glyph', id: 999 });
  assert.equal(f.sent.filter((m) => m.type === 'glyph').length, 1, 'out-of-range glyph id is ignored');
  await f.send({ type: 'block', index: 0 });
  assert.equal(f.last('block').name, 'Basic Latin');
  await f.send({ type: 'copy', text: 'U+0041', what: 'code point' });
  assert.equal(state.clipboard, 'U+0041');
  assert.equal(f.last('copied').what, 'code point');
  await f.send({ type: 'evil', text: 'x' });
  await f.send({ type: 'copy', text: '' });
  assert.equal(state.clipboard, 'U+0041');
});

test('editor: TTC face switch re-sends init with the other face', async () => {
  const f = await openEditor(fixture('zovo-test.ttc'));
  await f.send({ type: 'ready' });
  assert.equal(f.last('init').info.subfamily, 'Regular');
  assert.equal(f.last('init').mime, 'font/ttf');
  await f.send({ type: 'face', index: 1 });
  assert.equal(f.last('init').info.subfamily, 'Bold');
  assert.equal(f.sent.filter((m) => m.type === 'init').length, 2);
  await f.send({ type: 'face', index: 7 });
  assert.equal(f.sent.filter((m) => m.type === 'init').length, 2);
});

test('editor: file changes on disk reload the font', async () => {
  const p = path.join(tmp, 'live.ttf');
  fs.copyFileSync(fixture('zovo-test.ttf'), p);
  const f = await openEditor(p);
  await f.send({ type: 'ready' });
  fs.copyFileSync(fixture('jetbrains-mono-var.ttf'), p);
  state.watchers.at(-1).h.change();
  await new Promise((r) => setTimeout(r, 450));
  assert.equal(f.last('init').info.family, 'JetBrains Mono');
});

test('editor: a rewrite the watcher missed is found by the size and time check', async () => {
  const p = path.join(tmp, 'rebuilt.ttf');
  fs.copyFileSync(fixture('zovo-test.ttf'), p);
  const f = await openEditor(p);
  const session = f.session;
  await f.send({ type: 'ready' });
  assert.equal(await session.checkStale(), false, 'unchanged file is not reloaded');
  fs.copyFileSync(fixture('zovo-test.otf'), p);
  assert.equal(await session.checkStale(), true);
  await new Promise((r) => setTimeout(r, 450));
  assert.equal(f.last('init').info.outlines, 'CFF');
  assert.equal(await session.checkStale(), false);
  f.close();
});

test('editor: not-a-font and over-limit files show an error, not a crash', async () => {
  const txt = path.join(tmp, 'notes.ttf');
  fs.writeFileSync(txt, 'This is not a font.');
  const f = await openEditor(txt);
  await f.send({ type: 'ready' });
  assert.match(f.last('error').message, /not a font/);
  try {
    state.config.maxFileMB = 1;
    const big = path.join(tmp, 'big.woff2');
    fs.writeFileSync(big, Buffer.alloc(1024 * 1024 + 10));
    const g = await openEditor(big);
    await g.send({ type: 'ready' });
    assert.equal(g.last('error').code, 'too-large');
    assert.match(g.last('error').message, /fontViewer\.maxFileMB/);
  } finally { delete state.config.maxFileMB; }
});

test('commands: Copy CSS @font-face from the Explorer and Open in Font Viewer', async () => {
  await vscodeMock.commands.handlers['fontViewer.copyFontFace'](Uri.file(fixture('zovo-test.woff')));
  assert.match(state.clipboard, /font-family: "Zovo Test Sans";[\s\S]*format\("woff"\)/);
  await vscodeMock.commands.handlers['fontViewer.openWith'](Uri.file(fixture('zovo-test.ttf')));
  assert.deepEqual(state.executed.at(-1).slice(0, 1).concat(state.executed.at(-1)[2]), ['vscode.openWith', ext.VIEW_TYPE]);
  await vscodeMock.commands.handlers['fontViewer.copyFontFace'](undefined);
  assert.match(state.infos.at(-1), /Open or select a font/);
});

test('rating: one success per tab, on the first rendered message', async () => {
  const before = (ctx.globalState.get('zovo.rating.v1') || { count: 0 }).count;
  const f = await openEditor(fixture('zovo-test.ttf'));
  await f.send({ type: 'ready' });
  await f.send({ type: 'rendered' });
  await f.send({ type: 'rendered' });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(ctx.globalState.get('zovo.rating.v1').count, before + 1);
});

// ---------- support links (Sponsor, More free viewers) ----------
test('support: package.json has the sponsor field, the two commands and the setting', () => {
  const support = require('../src/support');
  assert.equal(pkg.sponsor.url, support.sponsorUrl());
  const ids = pkg.contributes.commands.map((c) => c.command);
  assert.ok(ids.includes('fontViewer.supportDeveloper') && ids.includes('fontViewer.moreViewers'));
  assert.equal(pkg.contributes.configuration.properties['fontViewer.showSupportLinks'].default, true);
});

test('support: the footer shows by default and fontViewer.showSupportLinks=false hides it', async () => {
  try {
    for (const [val, shown] of [[undefined, true], [true, true], [false, false]]) {
      if (val === undefined) delete state.config.showSupportLinks; else state.config.showSupportLinks = val;
      const f = await openEditor(fixture('zovo-test.ttf'));
      const html = f.panel.webview.html;
      assert.equal(/id="zovo-support"/.test(html), shown, String(val));
      assert.equal(html.includes('command:fontViewer.supportDeveloper'), shown);
      assert.deepEqual(f.panel.webview.options.enableCommandUris, ['fontViewer.supportDeveloper', 'fontViewer.moreViewers', 'workbench.action.openSettings']);
    }
  } finally { delete state.config.showSupportLinks; }
});
