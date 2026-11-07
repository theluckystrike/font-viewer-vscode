'use strict';
// Small DOM helpers for the webview. No HTML strings: text goes in with textContent.
const SVG_NS = 'http://www.w3.org/2000/svg';

function el(tag, props, children) {
  const n = document.createElement(tag);
  if (props) {
    for (const k of Object.keys(props)) {
      const v = props[k];
      if (v == null) continue;
      if (k === 'text') n.textContent = String(v);
      else if (k === 'dataset') Object.assign(n.dataset, v);
      else if (k === 'role') n.setAttribute('role', v);
      else n[k] = v;
    }
  }
  if (children) for (const c of children) if (c != null) n.append(c);
  return n;
}

function clear(n) {
  while (n.firstChild) n.removeChild(n.firstChild);
}

function fmtNum(n) {
  if (typeof n !== 'number') return String(n);
  return Number.isInteger(n) ? n.toLocaleString('en-US') : String(Math.round(n * 100) / 100);
}

function charOf(cp) {
  try {
    return String.fromCodePoint(cp);
  } catch (e) {
    return '';
  }
}

/** Bounds of an SVG path made of absolute M/L/Q/C/Z commands (control points included). */
function pathBounds(d) {
  const nums = String(d).match(/-?\d+(?:\.\d+)?/g);
  if (!nums || nums.length < 2) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i + 1 < nums.length; i += 2) {
    const x = +nums[i], y = +nums[i + 1];
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  return { x0, y0, x1, y1 };
}

function svgEl(tag, attrs) {
  const n = document.createElementNS(SVG_NS, tag);
  for (const k of Object.keys(attrs)) n.setAttribute(k, String(attrs[k]));
  return n;
}

/**
 * Draws one glyph outline. Every glyph in the grid uses the same vertical scale (ascender to descender),
 * so glyphs line up on the baseline. With guides, it also draws the baseline, metrics and the advance box.
 */
function glyphSvg(it, info, height, guides) {
  const asc = Math.max(info.ascender || 0, info.capHeight || 0), desc = Math.min(info.descender || 0, 0);
  const b = pathBounds(it.d);
  let top = -asc, bottom = -desc;
  const adv = it.adv || 0;
  let left = Math.min(0, b ? b.x0 : 0), right = Math.max(adv, b ? b.x1 : 0, 1);
  if (b) { top = Math.min(top, b.y0); bottom = Math.max(bottom, b.y1); }
  const pad = (bottom - top) * 0.06;
  top -= pad; bottom += pad; left -= pad; right += pad;
  const h = bottom - top;
  let w = right - left;
  if (!guides && w < h * 0.6) { const extra = (h * 0.6 - w) / 2; left -= extra; right += extra; w = right - left; }
  const svg = svgEl('svg', { viewBox: `${left} ${top} ${w} ${h}`, class: guides ? 'glyph big' : 'glyph', role: 'img' });
  svg.setAttribute('aria-label', it.name);
  svg.style.height = `${height}px`;
  svg.style.width = guides ? `${Math.min(height * (w / h), 520)}px` : `${height}px`;
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  if (guides) {
    const sw = h / 300;
    const line = (y, cls, label) => {
      svg.append(svgEl('line', { x1: left, x2: right, y1: y, y2: y, class: `guide ${cls}`, 'stroke-width': sw }));
      if (label) {
        const t = svgEl('text', { x: left + sw * 4, y: y - sw * 4, class: 'guide-label', 'font-size': h / 28 });
        t.textContent = label;
        svg.append(t);
      }
    };
    line(0, 'base', 'baseline');
    line(-info.ascender, 'metric', 'ascender');
    line(-info.descender, 'metric', 'descender');
    if (info.xHeight) line(-info.xHeight, 'metric', 'x-height');
    if (info.capHeight) line(-info.capHeight, 'metric', 'cap height');
    svg.append(svgEl('rect', { x: 0, y: top, width: Math.max(adv, 0), height: h, class: 'advance', 'stroke-width': sw }));
  }
  if (it.d) svg.append(svgEl('path', { d: it.d, class: 'outline' }));
  return svg;
}

module.exports = { el, clear, fmtNum, charOf, glyphSvg, pathBounds };
