// Release check in a real VS Code: installs the .vsix into an isolated profile, opens the sample fonts,
// drives the webview with real mouse and key events, saves screenshots and a JSON report.
// usage: node scripts/e2e-vscode.mjs <work> <port> <vsix> <samplesDir> <shotDir> <outJson>
import { launch, installVsix, sleep } from './vsc.mjs';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';

const [work0, port, vsix, ws0, shotDir, outJson] = process.argv.slice(2);
const work = path.resolve(work0), ws = path.resolve(ws0);
const R = { install: null, steps: [], console: [], hashes: {}, unchanged: null };
const hash = (f) => crypto.createHash('sha1').update(fs.readFileSync(f)).digest('hex');
const walk = (d, acc = []) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p, acc); else acc.push(p); } return acc; };
const LIVE = 'live-build.ttf';
for (const f of walk(ws)) if (!f.endsWith(LIVE)) R.hashes[path.relative(ws, f)] = hash(f);
fs.rmSync(path.join(work, 'ud'), { recursive: true, force: true });
R.install = installVsix(work, vsix);
const clipBefore = (() => { try { return execSync('pbpaste', { encoding: 'utf8' }); } catch { return null; } })();
const vs = await launch(work, Number(port), ws, { 'workbench.secondarySideBar.defaultVisibility': 'hidden', 'workbench.auxiliaryBar.visible': false,
  'window.titleBarStyle': 'custom', 'workbench.sideBar.location': 'left', 'explorer.compactFolders': false, 'workbench.editor.enablePreview': false });
const shots = [];
const shot = async (name) => { const f = path.join(shotDir, `font-${String(shots.length + 1).padStart(2, '0')}-${name}.png`); await vs.shot(f); shots.push(f); return f; };
const step = async (name, fn) => {
  const t0 = Date.now();
  try { const v = await fn(); R.steps.push({ name, ok: v !== false, value: v, ms: Date.now() - t0 }); }
  catch (e) { R.steps.push({ name, ok: false, error: String(e.message || e).slice(0, 500), ms: Date.now() - t0 }); try { await shot('FAIL-' + name.replace(/\W+/g, '_').slice(0, 40)); } catch {} }
};
let wv;
const E = (expr) => vs.wvEval(wv, expr);
const getWv = async (title) => vs.waitFor(async () => (await vs.webviews()).find((w) => w.title === title && w.w > 0), 20000);
const ready = () => vs.waitFor(() => E(`!!document.querySelector('.tabs') || (document.querySelector('.error') ? 'error' : false)`), 20000, 150);
const open = async (file) => {
  const t0 = Date.now(); vs.open(path.join(ws, file)); await sleep(700);
  wv = await getWv(path.basename(file)); if (!wv) throw new Error('no webview for ' + file);
  const r = await ready(); if (!r) throw new Error('view did not render for ' + file);
  return Date.now() - t0;
};
const tab = async (label) => { await vs.wvClick(wv, `[...document.querySelectorAll('.tab')].find(b => b.textContent === ${JSON.stringify(label)})`); await sleep(400); };
const btn = (t) => `[...document.querySelectorAll('button')].find(b => b.textContent === ${JSON.stringify(t)})`;
const notes = async () => (await vs.notifications()).join(' | ');
const clearNotes = () => vs.command('Notifications: Clear All Notifications').catch(() => {});
const clip = () => execSync('pbpaste', { encoding: 'utf8' });
const textWidth = () => E(`(() => { const r = document.createRange(); r.selectNodeContents(document.querySelector('.big')); return Math.round(r.getBoundingClientRect().width * 10) / 10; })()`);
const setSample = async (text) => {
  await vs.wvClick(wv, `document.querySelector('.sample-input')`);
  await vs.key('a', 'KeyA', 4, 65); await vs.type(text); await sleep(300);
};
const setSize = (px) => E(`(() => { const r = document.querySelector('.size input'); r.value = '${px}'; r.dispatchEvent(new Event('input')); return r.value; })()`);
const feature = (tag) => vs.wvClick(wv, `[...document.querySelectorAll('.feat')].find(l => l.querySelector('code').textContent === ${JSON.stringify(tag)}).querySelector('input')`);
const fontLoaded = () => E(`[...document.fonts].filter(f => f.family.startsWith('zfv-font') && f.status === 'loaded').length`);

try {
  await sleep(2500);
  await clearNotes();
  await step('WOFF2 variable font opens as the default editor and its FontFace loads', async () => {
    const ms = await open('jetbrains-mono-latin-wght-normal.woff2');
    const head = await E(`document.querySelector('.head').innerText`);
    const loaded = await fontLoaded();
    const banner = await E(`document.querySelector('.banner').hidden`);
    const fam = await E(`getComputedStyle(document.querySelector('.big')).fontFamily`);
    const n = await notes();
    if (!/JetBrains Mono/.test(head) || !/WOFF2/i.test(head) || !/394 glyphs/.test(head) || loaded < 1 || !banner || !/zfv-font/.test(fam)) throw new Error(JSON.stringify({ head, loaded, banner, fam }));
    if (/multiple default editors/i.test(n)) throw new Error('multiple default editors: ' + n);
    return { ms, head: head.replace(/\n/g, ' | '), fam };
  });
  await step('Type tester: real typing, size, weight axis by mouse, feature toggle', async () => {
    await setSample('Hello Font Viewer 1/2 0O {}=> != 0123');
    const big = await E(`document.querySelector('.big').textContent`);
    await setSize(56);
    const slider = `document.querySelector('.axis input[data-tag="wght"]')`;
    await vs.wvClick(wv, slider, { dx: 'b.width * 6 / 7' });
    // a click lands near 700 (the thumb has a width); real arrow keys move it to exactly 700
    for (let k = 0, v = Number(await E(`${slider}.value`)); v !== 700 && k < 60; k++, v = Number(await E(`${slider}.value`))) await vs.key(v > 700 ? 'ArrowLeft' : 'ArrowRight', v > 700 ? 'ArrowLeft' : 'ArrowRight');
    const wght = Number(await E(`${slider}.value`));
    const fvs = await E(`getComputedStyle(document.querySelector('.big')).fontVariationSettings`);
    const wfLines = await E(`document.querySelectorAll('.wf-line').length`);
    await feature('frac');
    const ffs = await E(`getComputedStyle(document.querySelector('.big')).fontFeatureSettings`);
    if (!big.startsWith('Hello Font Viewer') || Math.abs(wght - 700) > 15 || !/wght/.test(fvs) || wfLines !== 9 || !/frac/.test(ffs)) throw new Error(JSON.stringify({ big, wght, fvs, wfLines, ffs }));
    await vs.wvClick(wv, `document.querySelector('.sample-input')`); await sleep(200);
    await shot('type-tester-variable');
    return { wght, fvs, ffs, wfLines };
  });
  await step('Named instance select moves the axis slider', async () => {
    await E(`(() => { const s = document.querySelector('.instance'); s.value = String([...s.options].findIndex(o => o.text === 'Thin') - 1); s.dispatchEvent(new Event('change')); })()`);
    const v = await E(`document.querySelector('.axis input[data-tag="wght"]').value`);
    if (Number(v) !== 100) throw new Error('wght ' + v);
    await vs.wvClick(wv, btn('Reset axes'));
    const v2 = await E(`document.querySelector('.axis input[data-tag="wght"]').value`);
    if (Number(v2) !== 400) throw new Error('reset wght ' + v2);
    return { thin: v, reset: v2 };
  });
  await step('Copy CSS from the tester includes font-variation-settings', async () => {
    await vs.wvClick(wv, `document.querySelector('.axis input[data-tag="wght"]')`, { dx: 'b.width * 6 / 7' });
    await vs.wvClick(wv, btn('Copy CSS')); await sleep(500);
    const c = clip();
    if (!/@font-face/.test(c) || !/font-weight: 100 800/.test(c) || !/font-variation-settings: "wght" \d+/.test(c) || !/"frac" 1/.test(c)) throw new Error(c.slice(0, 400));
    return c.split('\n').filter((l) => /variation|feature|weight/.test(l));
  });
  await step('Glyphs tab: grid pages, search, detail, copy character', async () => {
    await tab('Glyphs');
    const first = await vs.waitFor(() => E(`document.querySelectorAll('.cell').length`), 10000);
    await E(`(() => { const s = document.querySelector('.grid-scroll'); s.scrollTop = s.scrollHeight; })()`); await sleep(800);
    const afterScroll = await E(`document.querySelectorAll('.cell').length`);
    await vs.wvClick(wv, `document.querySelector('.search')`);
    await vs.type('acute'); await sleep(900);
    const count = await E(`document.querySelector('.count').textContent`);
    const names = await E(`[...document.querySelectorAll('.cell .gname')].map(e => e.textContent)`);
    await vs.wvClick(wv, `[...document.querySelectorAll('.cell')].find(c => c.querySelector('.gname').textContent === 'eacute')`);
    await sleep(400);
    const detail = await E(`document.querySelector('.detail').innerText`);
    const guides = await E(`document.querySelectorAll('.detail svg .guide').length`);
    await vs.wvClick(wv, btn('Copy character')); await sleep(400);
    const c = clip();
    if (first < 200 || afterScroll !== 394 || !names.length || !names.every((n) => /acute/i.test(n)) || !/U\+00E9/.test(detail) || guides < 4 || c !== 'é') throw new Error(JSON.stringify({ first, afterScroll, count, names: names.slice(0, 5), detail: detail.slice(0, 200), guides, c }));
    await shot('glyph-grid-search');
    return { first, afterScroll, count, matches: names.length, clip: c };
  });
  await step('Glyph search by U+ code point and keyboard selection', async () => {
    await vs.wvClick(wv, `document.querySelector('.search')`);
    await vs.key('a', 'KeyA', 4, 65); await vs.type('U+20AC'); await sleep(900);
    const names = await E(`[...document.querySelectorAll('.cell .gname')].map(e => e.textContent)`);
    await vs.wvClick(wv, `document.querySelector('.search')`);
    await vs.key('a', 'KeyA', 4, 65); await vs.key('Backspace', 'Backspace'); await sleep(900);
    await vs.wvClick(wv, `document.querySelector('.cell')`);
    await vs.key('ArrowRight', 'ArrowRight'); await vs.key('Enter', 'Enter'); await sleep(300);
    const sel = await E(`document.querySelector('.detail table').innerText`);
    if (names.join() !== 'Euro' || !/#1\b/.test(sel)) throw new Error(JSON.stringify({ names, sel }));
    return { names, sel: sel.split('\n').slice(0, 2) };
  });
  await step('Characters tab: blocks with coverage, Latin-1 cells, copy code point', async () => {
    await tab('Characters');
    const blocks = await E(`[...document.querySelectorAll('.block')].map(b => b.innerText.replace(/\\n/g, ' '))`);
    await vs.wvClick(wv, `[...document.querySelectorAll('.block')].find(b => b.querySelector('.bname').textContent === 'Latin-1 Supplement')`);
    await sleep(500);
    const cells = await E(`document.querySelectorAll('.ch').length`);
    await vs.wvClick(wv, `[...document.querySelectorAll('.ch')].find(c => c.querySelector('.chcp').textContent === '00C6')`);
    await vs.wvClick(wv, btn('Copy code point')); await sleep(400);
    const c = clip();
    const fam = await E(`getComputedStyle(document.querySelector('.ch .chg')).fontFamily`);
    if (!blocks.some((b) => /Basic Latin 96\/128/.test(b)) || cells !== 96 || c !== 'U+00C6' || !/zfv-font/.test(fam)) throw new Error(JSON.stringify({ blocks, cells, c, fam }));
    await shot('character-map');
    await vs.wvClick(wv, `document.querySelector('.chars .chk input')`); await sleep(300);
    const all = await E(`document.querySelectorAll('.ch').length`);
    const missing = await E(`document.querySelectorAll('.ch.missing').length`);
    await vs.wvClick(wv, `document.querySelector('.chars .chk input')`);
    return { blocks: blocks.slice(0, 4), cells, all, missing, clip: c };
  });
  await step('Info tab of the test font: license, designer, embedding, @font-face copy', async () => {
    await open('zovo-test.ttf');
    await tab('Info');
    const t = await E(`document.querySelector('.info').innerText`);
    await vs.wvClick(wv, btn('Copy @font-face')); await sleep(400);
    const c = clip();
    if (!/SIL Open Font License/.test(t) || !/Zovo Font Lab/.test(t) || !/Installable embedding/.test(t) || !/liga/.test(t) || !/font-family: "Zovo Test Sans"/.test(c) || !/unicode-range/.test(c)) throw new Error(JSON.stringify({ t: t.slice(0, 500), c }));
    await E(`document.querySelector('.info').scrollTop = 0`); await sleep(200);
    await shot('font-info');
    return { lines: t.split('\n').length, css: c.split('\n')[1] };
  });
  await step('Real shaping: liga, kern and ss01 change the rendered text', async () => {
    await tab('Type tester');
    await setSample('fiAV'); await setSize(100); await sleep(200);
    const base = await textWidth();
    await feature('liga'); await sleep(200);
    const noLiga = await textWidth();
    await feature('liga'); await feature('kern'); await sleep(200);
    const noKern = await textWidth();
    await feature('kern'); await feature('ss01'); await sleep(200);
    const ss01 = await textWidth();
    const ffs = await E(`getComputedStyle(document.querySelector('.big')).fontFeatureSettings`);
    // units at 100px on a 1000-unit em: f_i 56 vs f+i 61, kern AV -8
    if (!(Math.abs(noLiga - base - 5) < 1.5 && Math.abs(noKern - base - 8) < 1.5 && /ss01/.test(ffs))) throw new Error(JSON.stringify({ base, noLiga, noKern, ss01, ffs }));
    await shot('test-font-ss01');
    await feature('ss01');
    return { base, noLiga, noKern, ss01, ffs };
  });
  await step('OTF (CFF), WOFF and TTC open; the TTC face picker switches to Bold', async () => {
    const r = {};
    for (const f of ['zovo-test.otf', 'zovo-test.woff']) {
      await open(f);
      r[f] = await E(`document.querySelector('.head').innerText.replace(/\\n/g, ' | ')`);
      if (!/Zovo Test Sans/.test(r[f]) || (await fontLoaded()) < 1) throw new Error(f + ' ' + r[f]);
    }
    await open('zovo-test.ttc');
    const opts = await E(`[...document.querySelectorAll('.face option')].map(o => o.text)`);
    await E(`(() => { const s = document.querySelector('.face'); s.value = '1'; s.dispatchEvent(new Event('change')); })()`);
    const bold = await vs.waitFor(() => E(`/Bold/.test(document.querySelector('.family').textContent) && document.querySelector('.family').textContent`), 8000);
    if (opts.length !== 2 || !bold) throw new Error(JSON.stringify({ opts, bold }));
    r.ttc = { opts, bold };
    return r;
  });
  await step('Damaged and non-font files show a clear error', async () => {
    const r = {};
    for (const f of ['broken/not-a-font.ttf', 'broken/cut-off.woff2', 'broken/empty.otf']) {
      await open(f);
      r[f] = await E(`(document.querySelector('.error') || {}).innerText || ''`);
      if (!/cannot open this file/.test(r[f])) throw new Error(f + ': ' + r[f]);
    }
    return r;
  });
  await step('Saving a new build of the font reloads the open view', async () => {
    await open(LIVE);
    const before = await E(`document.querySelector('.family').textContent`);
    fs.copyFileSync(path.join(ws, 'jetbrains-mono-var.ttf'), path.join(ws, LIVE));
    const after = await vs.waitFor(() => E(`/JetBrains/.test(document.querySelector('.family').textContent) && document.querySelector('.family').textContent`), 10000);
    if (!/Zovo Test Sans/.test(before) || !after) throw new Error(JSON.stringify({ before, after }));
    return { before, after };
  });
  await step('Narrow editor (900 px window)', async () => {
    await vs.s.send('Emulation.setDeviceMetricsOverride', { width: 900, height: 800, deviceScaleFactor: 1, mobile: false }, vs.wb);
    await sleep(1500);
    await open('jetbrains-mono-latin-wght-normal.woff2');
    await sleep(800);
    await tab('Type tester');
    await vs.waitFor(() => E(`!!document.querySelector('.controls')`), 5000);
    const tabsVisible = await E(`[...document.querySelectorAll('.tab')].every(t => t.getBoundingClientRect().width > 30)`);
    const controls = await E(`document.querySelector('.controls').getBoundingClientRect().width`);
    await shot('narrow-900');
    await vs.s.send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false }, vs.wb);
    if (!tabsVisible || controls < 150) throw new Error(JSON.stringify({ tabsVisible, controls }));
    return { tabsVisible, controls };
  });
  await step('light theme', async () => {
    const sf = path.join(work, 'ud', 'User', 'settings.json');
    fs.writeFileSync(sf, JSON.stringify({ ...JSON.parse(fs.readFileSync(sf, 'utf8')), 'workbench.colorTheme': 'Default Light Modern' }, null, 1));
    const light = await vs.waitFor(() => vs.wbEval(`document.body.classList.contains('vs') || !!document.querySelector('.monaco-workbench.vs')`), 10000, 300);
    if (!light) throw new Error('theme did not switch');
    await open('fraunces-latin-600-normal.woff2');
    await tab('Type tester');
    await setSample('Fraunces SemiBold, a soft serif with ligatures fi fl'); await setSize(44);
    await sleep(400);
    await shot('fraunces-light');
    return true;
  });
} finally {
  R.console = vs.console.filter((c) => !/copilot|CloudSandboxApi|LESS API|reading 'selection'/i.test(c.text));
  R.logErrors = [];
  for (const f of vs.extHostLogs()) { const t = fs.readFileSync(f, 'utf8'); for (const l of t.split('\n')) if (/\[error\]/.test(l) && /font|zovo/i.test(l)) R.logErrors.push(l.slice(0, 300)); }
  await vs.close();
  if (clipBefore !== null) try { execSync('pbcopy', { input: clipBefore }); } catch {}
  R.unchanged = Object.entries(R.hashes).every(([f, h]) => hash(path.join(ws, f)) === h);
  R.shots = shots;
  fs.writeFileSync(outJson, JSON.stringify(R, null, 1));
  console.log(JSON.stringify({ steps: R.steps.map((s) => [s.ok ? 'PASS' : 'FAIL', s.name, s.error || '']), console: R.console, logErrors: R.logErrors, unchanged: R.unchanged, install: R.install.code }, null, 1));
}
