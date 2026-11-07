'use strict';
// Font Viewer webview. All font text goes in with textContent; styles only through CSSOM.
const { cpLabel, fmtSize, featureSettings, variationSettings, featureName, DEFAULT_ON } = require('../core/protocol');
const { el, clear, glyphSvg, fmtNum, charOf } = require('./view');

const vscode = acquireVsCodeApi();
const app = document.getElementById('app');
const PAGE = 240;
const WATERFALL = [12, 14, 16, 18, 24, 32, 48, 64, 96];

const S = {
  info: null, css: '', fileName: '', blocks: null, family: '', fontOk: false,
  tab: 'tester', query: '', seq: 0, glyphTotal: 0, glyphItems: [], loading: false, selected: null,
  sample: '', size: 48, waterfall: true, axes: {}, features: {}, blockIndex: null, onlyCovered: true,
  rendered: false, face: null,
};
const prev = vscode.getState() || {};
if (prev.tab) S.tab = prev.tab;
if (typeof prev.sample === 'string') S.sample = prev.sample;
if (prev.size) S.size = prev.size;
if (typeof prev.waterfall === 'boolean') S.waterfall = prev.waterfall;
if (typeof prev.onlyCovered === 'boolean') S.onlyCovered = prev.onlyCovered;

function save() {
  vscode.setState({ tab: S.tab, sample: S.sample, size: S.size, waterfall: S.waterfall, onlyCovered: S.onlyCovered });
}

function post(m) { vscode.postMessage(m); }

// ---------- font loading ----------
let faceCounter = 0;
async function loadFace(bytes) {
  const family = `zfv-font-${++faceCounter}`;
  try {
    const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const face = new FontFace(family, buf);
    await face.load();
    document.fonts.add(face);
    if (S.face) document.fonts.delete(S.face);
    S.face = face;
    S.family = family;
    S.fontOk = true;
  } catch (e) {
    S.fontOk = false;
    S.family = '';
    post({ type: 'fontError', message: String((e && e.message) || e) });
  }
}

function applyFont(node, extra) {
  if (!S.fontOk) return node;
  node.style.fontFamily = `"${S.family}", var(--fallback-font)`;
  const fs = featureSettings(S.features);
  const vs = variationSettings(S.axes);
  node.style.fontFeatureSettings = fs || 'normal';
  node.style.fontVariationSettings = vs || 'normal';
  node.style.fontKerning = S.features.kern === false ? 'none' : 'auto';
  if (extra) Object.assign(node.style, extra);
  return node;
}

// ---------- layout ----------
let ui = null;

function header() {
  const i = S.info;
  const title = el('div', { className: 'title' }, [
    el('span', { className: 'family', text: [i.family, i.subfamily].filter(Boolean).join(' ') || S.fileName }),
    el('span', { className: 'badge', text: i.formatLabel }),
    i.axes.length ? el('span', { className: 'badge var', text: 'Variable' }) : null,
    i.color.length ? el('span', { className: 'badge', text: 'Color' }) : null,
  ]);
  const meta = el('div', { className: 'meta', text: `${fmtNum(i.numGlyphs)} glyphs · ${fmtNum(i.codePoints)} characters · ${fmtSize(i.fileSize)}${i.version ? ' · ' + i.version : ''}` });
  const tabs = el('div', { className: 'tabs', role: 'tablist' });
  for (const [id, label] of [['tester', 'Type tester'], ['glyphs', 'Glyphs'], ['chars', 'Characters'], ['info', 'Info']]) {
    const b = el('button', { className: 'tab' + (S.tab === id ? ' on' : ''), text: label, role: 'tab', dataset: { tab: id } });
    b.setAttribute('aria-selected', String(S.tab === id));
    b.addEventListener('click', () => switchTab(id));
    tabs.append(b);
  }
  const row = el('div', { className: 'head' }, [el('div', { className: 'names' }, [title, meta]), tabs]);
  if (i.faces && i.faces.length > 1) {
    const sel = el('select', { className: 'face', title: 'Font in this collection' });
    i.faces.forEach((n, k) => sel.append(el('option', { value: String(k), text: `${k + 1}. ${n}`, selected: k === i.face })));
    sel.addEventListener('change', () => post({ type: 'face', index: Number(sel.value) }));
    row.querySelector('.names').append(sel);
  }
  return row;
}

function build() {
  clear(app);
  ui = {};
  ui.head = header();
  ui.banner = el('div', { className: 'banner', hidden: true });
  if (!S.fontOk) {
    ui.banner.hidden = false;
    ui.banner.textContent = 'The browser engine could not load this font for live text, so the type tester and character map use a fallback font. Glyph outlines and metadata still come from the file.';
  } else if (S.info.outlineError) {
    ui.banner.hidden = false;
    ui.banner.textContent = `Glyph outlines are not available: ${S.info.outlineError} The type tester, waterfall and character map still use the font.`;
  }
  ui.body = el('div', { className: 'body' });
  ui.status = el('div', { className: 'status' }, [el('span', { className: 'status-text', text: S.fileName })]);
  const foot = document.getElementById('zovo-support');
  if (foot) ui.status.append(foot);
  app.append(ui.head, ui.banner, ui.body, ui.status);
  renderTab();
}

function switchTab(id) {
  S.tab = id;
  save();
  for (const b of ui.head.querySelectorAll('.tab')) {
    const on = b.dataset.tab === id;
    b.classList.toggle('on', on);
    b.setAttribute('aria-selected', String(on));
  }
  renderTab();
}

function renderTab() {
  clear(ui.body);
  if (S.tab === 'glyphs') renderGlyphs();
  else if (S.tab === 'chars') renderChars();
  else if (S.tab === 'info') renderInfo();
  else renderTester();
}

// ---------- type tester ----------
function controls(onChange) {
  const i = S.info;
  const box = el('div', { className: 'controls' });
  const axesVisible = i.axes.filter((a) => !a.hidden);
  if (axesVisible.length) {
    const sec = el('div', { className: 'ctl-section' }, [el('h3', { text: 'Variable axes' })]);
    if (i.instances.length) {
      const sel = el('select', { className: 'instance', title: 'Named instance' }, [el('option', { value: '', text: 'Named instance...' })]);
      i.instances.forEach((ins, k) => sel.append(el('option', { value: String(k), text: ins.name })));
      sel.addEventListener('change', () => {
        const ins = i.instances[Number(sel.value)];
        if (!ins) return;
        Object.assign(S.axes, ins.coords);
        for (const r of sec.querySelectorAll('input[type=range]')) {
          r.value = String(S.axes[r.dataset.tag]);
          r.dispatchEvent(new Event('input'));
        }
      });
      sec.append(sel);
    }
    for (const a of axesVisible) {
      if (S.axes[a.tag] == null) S.axes[a.tag] = a.def;
      const step = a.max - a.min > 20 ? 1 : 0.1;
      const val = el('span', { className: 'val', text: fmtNum(S.axes[a.tag]) });
      const r = el('input', { type: 'range', min: String(a.min), max: String(a.max), step: String(step), value: String(S.axes[a.tag]), dataset: { tag: a.tag } });
      r.setAttribute('aria-label', `${a.name} (${a.tag})`);
      r.addEventListener('input', () => { S.axes[a.tag] = Number(r.value); val.textContent = fmtNum(S.axes[a.tag]); onChange(); });
      sec.append(el('label', { className: 'axis' }, [el('span', { className: 'lab', text: `${a.name} `, title: `${a.tag}: ${a.min} to ${a.max}, default ${a.def}` }, [el('code', { text: a.tag })]), r, val]));
    }
    const reset = el('button', { className: 'link', text: 'Reset axes' });
    reset.addEventListener('click', () => {
      for (const a of axesVisible) S.axes[a.tag] = a.def;
      for (const r of sec.querySelectorAll('input[type=range]')) { r.value = String(S.axes[r.dataset.tag]); r.dispatchEvent(new Event('input')); }
    });
    sec.append(reset);
    box.append(sec);
  }
  const feats = [...new Set([...i.gsubFeatures, ...i.gposFeatures])].sort();
  if (feats.length) {
    const sec = el('div', { className: 'ctl-section' }, [el('h3', { text: 'OpenType features' })]);
    const list = el('div', { className: 'features' });
    for (const tag of feats) {
      const on = S.features[tag] != null ? S.features[tag] : DEFAULT_ON.has(tag);
      const cb = el('input', { type: 'checkbox', checked: on });
      cb.addEventListener('change', () => {
        if (cb.checked === DEFAULT_ON.has(tag)) delete S.features[tag];
        else S.features[tag] = cb.checked;
        onChange();
      });
      list.append(el('label', { className: 'feat', title: featureName(tag) || tag }, [cb, el('code', { text: tag }), el('span', { className: 'fname', text: featureName(tag) })]));
    }
    sec.append(list);
    box.append(sec);
  }
  if (!box.childNodes.length) box.append(el('p', { className: 'muted', text: 'This font has no variable axes and no OpenType features.' }));
  return box;
}

function renderTester() {
  const text = el('textarea', { className: 'sample-input', rows: 2, value: S.sample, spellcheck: false });
  text.setAttribute('aria-label', 'Sample text');
  const size = el('input', { type: 'range', min: '8', max: '200', step: '1', value: String(S.size) });
  size.setAttribute('aria-label', 'Font size');
  const sizeVal = el('span', { className: 'val', text: `${S.size}px` });
  const wf = el('input', { type: 'checkbox', checked: S.waterfall });
  const copyCss = el('button', { className: 'btn', text: 'Copy CSS' });
  const bar = el('div', { className: 'toolbar' }, [
    el('label', { className: 'size' }, [el('span', { text: 'Size ' }), size, sizeVal]),
    el('label', { className: 'chk' }, [wf, el('span', { text: 'Waterfall' })]),
    copyCss,
  ]);
  const preview = el('div', { className: 'preview' });
  const big = el('div', { className: 'big', text: S.sample });
  const fall = el('div', { className: 'waterfall' });
  preview.append(big, fall);
  const paint = () => {
    big.textContent = S.sample || ' ';
    applyFont(big, { fontSize: `${S.size}px` });
    clear(fall);
    fall.hidden = !S.waterfall;
    if (S.waterfall) {
      for (const px of WATERFALL) {
        const line = el('div', { className: 'wf-line' }, [el('span', { className: 'wf-size', text: `${px}` }), applyFont(el('span', { className: 'wf-text', text: S.sample || ' ' }), { fontSize: `${px}px` })]);
        fall.append(line);
      }
    }
  };
  text.addEventListener('input', () => { S.sample = text.value.slice(0, 2000); save(); paint(); });
  size.addEventListener('input', () => { S.size = Number(size.value); sizeVal.textContent = `${S.size}px`; save(); paint(); });
  wf.addEventListener('change', () => { S.waterfall = wf.checked; save(); paint(); });
  copyCss.addEventListener('click', () => post({ type: 'copy', what: 'css', text: currentCss() }));
  const left = el('div', { className: 'tester-main' }, [text, bar, preview]);
  const side = controls(paint);
  ui.body.append(el('div', { className: 'tester' }, [left, side]));
  paint();
}

function currentCss() {
  const fam = S.info.family || 'My Font';
  const lines = [S.css, '', '.sample {', `  font-family: "${fam.replace(/["\\]/g, '')}", sans-serif;`];
  const fs = featureSettings(S.features);
  const vs = variationSettings(S.axes);
  if (fs) lines.push(`  font-feature-settings: ${fs};`);
  if (vs) lines.push(`  font-variation-settings: ${vs};`);
  lines.push('}');
  return lines.join('\n');
}

// ---------- glyph grid ----------
function renderGlyphs() {
  const search = el('input', { type: 'search', className: 'search', placeholder: 'Search by name, character, U+0041 or #id', value: S.query });
  search.setAttribute('aria-label', 'Search glyphs');
  const count = el('span', { className: 'count' });
  const grid = el('div', { className: 'grid', role: 'list' });
  const more = el('div', { className: 'more muted' });
  const scroller = el('div', { className: 'grid-scroll' }, [grid, more]);
  const detail = el('div', { className: 'detail' }, [el('p', { className: 'muted', text: 'Select a glyph to see it large, with its metrics and copy buttons.' })]);
  ui.glyphs = { grid, count, more, detail, scroller };
  let timer = null;
  search.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => { S.query = search.value.trim(); requestGlyphs(true); }, 150);
  });
  scroller.addEventListener('scroll', () => {
    if (scroller.scrollTop + scroller.clientHeight > scroller.scrollHeight - 400) requestGlyphs(false);
  });
  grid.addEventListener('click', (e) => {
    const cell = e.target.closest('.cell');
    if (cell) selectGlyph(Number(cell.dataset.id));
  });
  grid.addEventListener('keydown', (e) => {
    const cell = e.target.closest('.cell');
    if (!cell) return;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectGlyph(Number(cell.dataset.id)); }
    const cells = [...grid.children];
    const k = cells.indexOf(cell);
    const perRow = Math.max(1, Math.round(grid.clientWidth / cell.offsetWidth));
    const to = { ArrowRight: k + 1, ArrowLeft: k - 1, ArrowDown: k + perRow, ArrowUp: k - perRow }[e.key];
    if (to != null && cells[to]) { e.preventDefault(); cells[to].focus(); }
  });
  ui.body.append(el('div', { className: 'glyphs' }, [el('div', { className: 'toolbar' }, [search, count]), el('div', { className: 'glyph-split' }, [scroller, detail])]));
  if (S.glyphItems.length && S.glyphQuery === S.query) drawGlyphCells(S.glyphItems, true);
  else requestGlyphs(true);
  if (S.selected) showDetail(S.selected);
}

function requestGlyphs(reset) {
  if (reset) {
    S.seq++;
    S.glyphItems = [];
    S.glyphTotal = 0;
    S.loading = false;
    S.glyphQuery = S.query;
    if (ui.glyphs) { clear(ui.glyphs.grid); ui.glyphs.scroller.scrollTop = 0; }
  }
  if (S.loading) return;
  if (!reset && S.glyphItems.length >= S.glyphTotal) return;
  S.loading = true;
  post({ type: 'glyphs', query: S.query, offset: S.glyphItems.length, limit: PAGE, seq: S.seq });
}

function onGlyphs(m) {
  if (m.seq !== S.seq) return;
  S.loading = false;
  S.glyphTotal = m.total;
  S.glyphItems.push(...m.items);
  drawGlyphCells(m.items, false);
}

function drawGlyphCells(items, all) {
  const g = ui.glyphs;
  if (!g || S.tab !== 'glyphs') return;
  if (all) clear(g.grid);
  const frag = document.createDocumentFragment();
  for (const it of items) {
    const cell = el('div', { className: 'cell', tabIndex: 0, role: 'listitem', dataset: { id: String(it.id) }, title: `${it.name} · #${it.id}${it.cps.length ? ' · ' + it.cps.map(cpLabel).join(' ') : ''}` });
    cell.append(glyphCanvas(it, 56), el('div', { className: 'gname', text: it.name }), el('div', { className: 'gcp', text: it.cps.length ? cpLabel(it.cps[0]) : `#${it.id}` }));
    if (S.selected && S.selected.id === it.id) cell.classList.add('sel');
    frag.append(cell);
  }
  g.grid.append(frag);
  const shown = S.glyphItems.length;
  g.count.textContent = S.query ? `${fmtNum(S.glyphTotal)} of ${fmtNum(S.info.numGlyphs)} glyphs match` : `${fmtNum(S.glyphTotal)} glyphs`;
  g.more.textContent = shown < S.glyphTotal ? `Showing ${fmtNum(shown)} of ${fmtNum(S.glyphTotal)}. Scroll for more.` : S.glyphTotal === 0 ? 'No glyph matches this search.' : '';
  // Fill the view when the first page does not make it scroll.
  if (shown < S.glyphTotal && g.scroller.scrollHeight <= g.scroller.clientHeight + 50) requestGlyphs(false);
  markRendered();
}

function glyphCanvas(it, h) {
  if (it.d != null) return glyphSvg(it, S.info, h);
  // No outline (CFF2 or a parse problem): draw the character with the font if it has one.
  const box = el('div', { className: 'gchar' });
  box.append(it.cps.length ? applyFont(el('span', { text: charOf(it.cps[0]) }), { fontSize: `${Math.round(h * 0.7)}px` }) : el('span', { className: 'muted', text: '—' }));
  box.style.height = `${h}px`;
  return box;
}

function selectGlyph(id) {
  if (!ui.glyphs) return;
  for (const c of ui.glyphs.grid.querySelectorAll('.cell.sel')) c.classList.remove('sel');
  const cell = ui.glyphs.grid.querySelector(`.cell[data-id="${id}"]`);
  if (cell) cell.classList.add('sel');
  const it = S.glyphItems.find((x) => x.id === id);
  if (it) showDetail(it);
  else post({ type: 'glyph', id });
}

function copyBtn(label, text, what) {
  const b = el('button', { className: 'btn', text: label });
  b.addEventListener('click', () => post({ type: 'copy', text, what }));
  return b;
}

function showDetail(it) {
  S.selected = it;
  const g = ui.glyphs;
  if (!g) return;
  clear(g.detail);
  const i = S.info;
  g.detail.append(el('div', { className: 'detail-glyph' }, [glyphSvg(it, i, 220, true)]));
  const rows = [['Name', it.name], ['Glyph id', `#${it.id}`], ['Code points', it.cps.length ? it.cps.map(cpLabel).join(', ') : 'none (reached through features)'], ['Advance width', it.adv != null ? `${it.adv} units` : 'unknown'], ['Units per em', String(i.unitsPerEm)]];
  g.detail.append(el('table', { className: 'kv' }, rows.map(([k, v]) => el('tr', {}, [el('th', { text: k }), el('td', { text: v })]))));
  const btns = el('div', { className: 'btns' });
  if (it.cps.length) {
    btns.append(copyBtn('Copy character', charOf(it.cps[0]), 'character'), copyBtn('Copy code point', cpLabel(it.cps[0]), 'code point'));
    btns.append(copyBtn('Copy CSS escape', `\\${it.cps[0].toString(16).toUpperCase()}`, 'CSS escape'));
  }
  btns.append(copyBtn('Copy name', it.name, 'glyph name'));
  if (it.d) btns.append(copyBtn('Copy SVG', svgSource(it), 'SVG'));
  g.detail.append(btns);
}

function svgSource(it) {
  const i = S.info;
  const adv = it.adv || i.unitsPerEm;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 ${-i.ascender} ${adv} ${i.ascender - i.descender}"><path d="${it.d}"/></svg>`;
}

// ---------- character map ----------
function renderChars() {
  const b = S.blocks;
  const list = el('div', { className: 'blocks', role: 'listbox' });
  const only = el('input', { type: 'checkbox', checked: S.onlyCovered });
  const head = el('div', { className: 'toolbar' }, [el('span', { className: 'count', text: `${fmtNum(S.info.codePoints)} characters in ${b.list.length} Unicode blocks` }), el('label', { className: 'chk' }, [only, el('span', { text: 'Only characters in the font' })])]);
  const grid = el('div', { className: 'chargrid' });
  const pane = el('div', { className: 'char-pane' }, [el('div', { className: 'char-title' }), grid, el('div', { className: 'char-info muted', text: 'Click a character to copy it or its code point.' })]);
  ui.chars = { list, grid, pane };
  for (const blk of b.list) {
    const item = el('button', { className: 'block' + (S.blockIndex === blk.index ? ' on' : ''), dataset: { index: String(blk.index) } }, [
      el('span', { className: 'bname', text: blk.name }), el('span', { className: 'bcount', text: `${blk.covered}/${blk.size}` }),
    ]);
    item.addEventListener('click', () => { S.blockIndex = blk.index; for (const x of list.children) x.classList.toggle('on', x === item); post({ type: 'block', index: blk.index }); });
    list.append(item);
  }
  if (b.other) list.append(el('div', { className: 'muted small', text: `${b.other} characters outside the listed blocks` }));
  only.addEventListener('change', () => { S.onlyCovered = only.checked; save(); if (S.lastBlock) drawBlock(S.lastBlock); });
  ui.body.append(el('div', { className: 'chars' }, [head, el('div', { className: 'char-split' }, [list, pane])]));
  if (S.blockIndex == null && b.list.length) S.blockIndex = b.list[0].index;
  if (S.blockIndex != null) {
    const btn = list.querySelector(`[data-index="${S.blockIndex}"]`);
    if (btn) btn.classList.add('on');
    if (S.lastBlock && S.lastBlock.index === S.blockIndex) drawBlock(S.lastBlock);
    else post({ type: 'block', index: S.blockIndex });
  }
}

function drawBlock(m) {
  S.lastBlock = m;
  const c = ui.chars;
  if (!c || S.tab !== 'chars') return;
  c.pane.querySelector('.char-title').textContent = `${m.name} · ${cpLabel(m.start)} to ${cpLabel(m.end)}`;
  clear(c.grid);
  const frag = document.createDocumentFragment();
  for (const [cp, gid] of m.cells) {
    if (S.onlyCovered && gid < 0) continue;
    const cell = el('button', { className: 'ch' + (gid < 0 ? ' missing' : ''), title: `${cpLabel(cp)}${gid >= 0 ? ' · glyph #' + gid : ' · not in this font'}` });
    const glyph = el('span', { className: 'chg', text: charOf(cp) });
    if (gid >= 0) applyFont(glyph);
    cell.append(glyph, el('span', { className: 'chcp', text: cp.toString(16).toUpperCase().padStart(4, '0') }));
    cell.addEventListener('click', () => {
      const info = c.pane.querySelector('.char-info');
      clear(info);
      info.classList.remove('muted');
      info.append(el('strong', { text: `${cpLabel(cp)} ` }), el('span', { text: gid >= 0 ? `glyph #${gid}` : 'not in this font' }), copyBtn('Copy character', charOf(cp), 'character'), copyBtn('Copy code point', cpLabel(cp), 'code point'));
      if (gid >= 0) {
        const show = el('button', { className: 'btn', text: 'Show glyph' });
        show.addEventListener('click', () => { S.query = `#${gid}`; S.selected = null; switchTab('glyphs'); });
        info.append(show);
      }
    });
    frag.append(cell);
  }
  c.grid.append(frag);
  if (!c.grid.childNodes.length) c.grid.append(el('p', { className: 'muted', text: 'This font has no characters in this block.' }));
}

// ---------- info ----------
function renderInfo() {
  const i = S.info;
  const box = el('div', { className: 'info' });
  const byId = Object.fromEntries(i.names.map((n) => [n.id, n.value]));
  const sec = (title, rows) => {
    const r = rows.filter((x) => x[1] != null && x[1] !== '');
    if (!r.length) return null;
    return el('section', {}, [el('h3', { text: title }), el('table', { className: 'kv' }, r.map(([k, v]) => el('tr', {}, [el('th', { text: k }), el('td', { text: String(v) })])))]);
  };
  box.append(
    sec('License and credits', [['License', byId[13]], ['License URL', byId[14]], ['Copyright', byId[0]], ['Trademark', byId[7]], ['Designer', byId[9]], ['Designer URL', byId[12]], ['Manufacturer', byId[8]], ['Vendor URL', byId[11]], ['Vendor ID', i.vendor], ['Embedding', i.embedding]]) || el('p', { className: 'muted', text: 'No license fields in the name table.' }),
    sec('Font', [['Family', i.family], ['Style', i.subfamily], ['Full name', i.fullName], ['PostScript name', i.postscriptName], ['Version', i.version], ['Format', i.formatLabel === i.outlines ? `${i.outlines} outlines` : `${i.formatLabel} file, ${i.outlines} outlines`], ['File size', fmtSize(i.fileSize)], ['Glyphs', fmtNum(i.numGlyphs)], ['Characters', fmtNum(i.codePoints)], ['Weight class', i.weightClass], ['Width class', i.widthClass], ['Italic', i.italic ? 'yes' : 'no'], ['Monospaced', i.fixedPitch ? 'yes' : 'no'], ['Color tables', i.color.join(', ')], ['Created', i.created], ['Modified', i.modified]]),
    sec('Metrics (font units)', [['Units per em', i.unitsPerEm], ['Ascender', i.ascender], ['Descender', i.descender], ['Line gap', i.lineGap], ['Typo ascender', i.typoAscender], ['Typo descender', i.typoDescender], ['x-height', i.xHeight], ['Cap height', i.capHeight], ['Italic angle', i.italicAngle], ['Bounding box', i.bbox ? i.bbox.join(', ') : null]]),
  );
  if (i.axes.length) {
    box.append(el('section', {}, [el('h3', { text: 'Variable axes' }), el('table', { className: 'grid-table' }, [
      el('tr', {}, ['Axis', 'Tag', 'Min', 'Default', 'Max'].map((h) => el('th', { text: h }))),
      ...i.axes.map((a) => el('tr', {}, [a.name + (a.hidden ? ' (hidden)' : ''), a.tag, a.min, a.def, a.max].map((v) => el('td', { text: String(v) })))),
    ])]));
    if (i.instances.length) box.append(el('section', {}, [el('h3', { text: `Named instances (${i.instances.length})` }), el('p', { className: 'wrap', text: i.instances.map((x) => x.name).join(' · ') })]));
  }
  const featRow = (label, tags) => (tags.length ? el('tr', {}, [el('th', { text: label }), el('td', {}, tags.map((t) => el('code', { className: 'tagchip', text: t, title: featureName(t) })))]) : null);
  const fr = [featRow('GSUB', i.gsubFeatures), featRow('GPOS', i.gposFeatures)].filter(Boolean);
  if (fr.length) box.append(el('section', {}, [el('h3', { text: 'OpenType features' }), el('table', { className: 'kv' }, fr)]));
  const other = i.names.filter((n) => ![0, 7, 8, 9, 11, 12, 13, 14].includes(n.id));
  box.append(el('section', {}, [el('h3', { text: `Name table (${i.nameRecords} records${i.nameLanguages > 1 ? `, ${i.nameLanguages} languages` : ''})` }), el('table', { className: 'kv' }, other.map((n) => el('tr', {}, [el('th', { text: `${n.id} ${n.label}` }), el('td', { text: n.value })])))]));
  const copy = el('button', { className: 'btn', text: 'Copy @font-face' });
  copy.addEventListener('click', () => post({ type: 'copy', what: 'css', text: S.css }));
  box.append(el('section', {}, [el('h3', {}, [el('span', { text: 'CSS @font-face ' }), copy]), el('pre', { className: 'css', text: S.css })]));
  box.append(el('section', {}, [el('h3', { text: `Tables (${i.tables.length})` }), el('p', { className: 'wrap' }, i.tables.map((t) => el('code', { className: 'tagchip', text: `${t.tag.trim()} ${fmtSize(t.length)}` })))]));
  ui.body.append(box);
}

// ---------- messages ----------
function markRendered() {
  if (S.rendered) return;
  S.rendered = true;
  post({ type: 'rendered' });
}

function showError(message) {
  clear(app);
  const foot = document.getElementById('zovo-support');
  app.append(el('div', { className: 'error' }, [el('h2', { text: 'Font Viewer cannot open this file' }), el('p', { text: message })]));
  if (foot) app.append(el('div', { className: 'status' }, [foot]));
}

window.addEventListener('message', async (ev) => {
  const m = ev.data;
  if (!m || typeof m.type !== 'string') return;
  if (m.type === 'init') {
    S.info = m.info;
    S.css = m.css;
    S.fileName = m.fileName;
    S.blocks = m.blocks;
    S.axes = {};
    S.features = {};
    S.glyphItems = [];
    S.selected = null;
    S.lastBlock = null;
    S.blockIndex = null;
    if (!S.sample) S.sample = m.sampleText;
    if (!prev.size) S.size = m.previewSize;
    await loadFace(m.font);
    build();
    if (S.tab !== 'glyphs') requestAnimationFrame(() => markRendered());
  } else if (m.type === 'glyphs') onGlyphs(m);
  else if (m.type === 'glyph') { if (m.item) showDetail(m.item); }
  else if (m.type === 'block') drawBlock(m);
  else if (m.type === 'error') showError(m.message);
  else if (m.type === 'copied') {
    const t = ui && ui.status && ui.status.querySelector('.status-text');
    if (t) { t.textContent = `Copied ${m.what === 'css' ? 'the CSS' : m.what}`; setTimeout(() => { t.textContent = S.fileName; }, 1800); }
  }
});

post({ type: 'ready' });
