'use strict';
// Font Viewer: a read-only custom editor for TTF, OTF, WOFF, WOFF2 and TTC files.
const vscode = require('vscode');
const path = require('path');
const { openFont, fontFaceCss, MIME } = require('./core/font');
const { validateWebviewMessage, cpLabel, fmtSize } = require('./core/protocol');
const { buildHtml } = require('./html');
const { createRatingPrompt } = require('./rate');
const { registerSupport, commandUris, showLinks } = require('./support');

const VIEW_TYPE = 'fontViewer.editor';
const PREFIX = 'fontViewer';
const SELF_ID = 'zovo.font-viewer-vscode';
const FONT_RE = /\.(ttf|otf|woff2?|ttc|otc)$/i;
const DEFAULT_SAMPLE = 'The quick brown fox jumps over the lazy dog. 0123456789';
const STALE_CHECK_MS = 2000;

let rating = null;

function cfg() {
  const c = vscode.workspace.getConfiguration(PREFIX);
  const maxMB = Number(c.get('maxFileMB', 64));
  return {
    maxBytes: Math.max(1, Math.min(Number.isFinite(maxMB) ? maxMB : 64, 1024)) * 1024 * 1024,
    sampleText: String(c.get('sampleText', DEFAULT_SAMPLE) || DEFAULT_SAMPLE).slice(0, 2000),
    previewSize: Math.max(8, Math.min(Number(c.get('previewSize', 48)) || 48, 300)),
  };
}

function baseName(uri) {
  return path.posix.basename(uri.path);
}

/** Loads a font file with a size check before reading. */
async function loadFont(uri, face, limits) {
  const lim = limits || cfg();
  const st = await vscode.workspace.fs.stat(uri);
  if (st.size > lim.maxBytes) {
    const e = new Error(`This file is ${fmtSize(st.size)}. Font Viewer opens fonts up to ${fmtSize(lim.maxBytes)}. You can raise the limit with the setting fontViewer.maxFileMB.`);
    e.code = 'too-large';
    throw e;
  }
  const bytes = Buffer.from(await vscode.workspace.fs.readFile(uri));
  return openFont(bytes, { face, maxBytes: Math.max(lim.maxBytes * 4, 64 * 1024 * 1024) });
}

class FontEditorProvider {
  constructor(context) {
    this.context = context;
  }

  openCustomDocument(uri) {
    return { uri, dispose() {} };
  }

  async resolveCustomEditor(document, panel) {
    const uri = document.uri;
    const dist = vscode.Uri.joinPath(this.context.extensionUri, 'dist');
    const media = vscode.Uri.joinPath(this.context.extensionUri, 'media');
    // Command links only for the two support commands and the settings page (footer "Hide" link).
    panel.webview.options = { enableScripts: true, localResourceRoots: [dist, media], enableCommandUris: commandUris(PREFIX) };
    panel.webview.html = buildHtml({
      cspSource: panel.webview.cspSource,
      scriptUri: panel.webview.asWebviewUri(vscode.Uri.joinPath(dist, 'webview.js')).toString(),
      styleUri: panel.webview.asWebviewUri(vscode.Uri.joinPath(media, 'webview.css')).toString(),
      title: baseName(uri),
      showSupportLinks: showLinks(vscode, PREFIX),
    });
    const session = new FontSession(uri, panel);
    const disposables = [];
    disposables.push(panel.webview.onDidReceiveMessage((raw) => session.onMessage(raw)));
    try {
      const dir = vscode.Uri.joinPath(uri, '..');
      const w = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(dir, baseName(uri)));
      const reload = () => session.reload();
      disposables.push(w, w.onDidChange(reload), w.onDidCreate(reload));
    } catch (e) {
      // Virtual file systems without watchers still open the font.
    }
    // File watchers can miss a rewrite (some build tools replace the file). While the tab is visible,
    // a local file is also checked every 2 seconds by size and modified time, which costs one stat call.
    const poll = setInterval(() => { if (panel.visible !== false && uri.scheme === 'file') session.checkStale(); }, STALE_CHECK_MS);
    if (poll.unref) poll.unref();
    disposables.push({ dispose: () => clearInterval(poll) });
    panel.onDidDispose(() => disposables.forEach((d) => d.dispose()));
    return session;
  }
}

class FontSession {
  constructor(uri, panel) {
    this.uri = uri;
    this.panel = panel;
    this.font = null;
    this.face = 0;
    this.rated = false;
    this.reloadTimer = null;
    this.stamp = null;
  }

  async statStamp() {
    try {
      const st = await vscode.workspace.fs.stat(this.uri);
      return `${st.size}:${st.mtime}`;
    } catch (e) {
      return null;
    }
  }

  /** Reloads when the file on disk no longer matches what was loaded. */
  async checkStale() {
    if (this.stamp == null || this.checking) return false;
    this.checking = true;
    try {
      const now = await this.statStamp();
      if (now && now !== this.stamp) {
        this.stamp = now;
        this.reload();
        return true;
      }
      return false;
    } finally {
      this.checking = false;
    }
  }

  post(m) {
    return this.panel.webview.postMessage(m);
  }

  async sendInit() {
    const c = cfg();
    this.stamp = await this.statStamp();
    try {
      this.font = await loadFont(this.uri, this.face, c);
    } catch (e) {
      this.font = null;
      await this.post({ type: 'error', message: e && e.message ? e.message : String(e), code: e && e.code });
      return;
    }
    const f = this.font;
    const name = baseName(this.uri);
    const bytes = f.webBytes;
    await this.post({
      type: 'init',
      fileName: name,
      info: f.info,
      css: fontFaceCss(f.info, name, f.cmap),
      blocks: f.blocks(),
      mime: f.format === 'ttc' ? MIME.ttf : MIME[f.format],
      font: new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength),
      sampleText: c.sampleText,
      previewSize: c.previewSize,
      numGlyphs: f.numGlyphs,
    });
  }

  reload() {
    clearTimeout(this.reloadTimer);
    this.reloadTimer = setTimeout(() => { this.sendInit(); }, 300);
  }

  async onMessage(raw) {
    const v = validateWebviewMessage(raw);
    if (!v.ok) return;
    const m = v.msg;
    const f = this.font;
    switch (m.type) {
      case 'ready':
        await this.sendInit();
        break;
      case 'rendered':
        if (!this.rated && rating) {
          this.rated = true;
          rating.success();
        }
        break;
      case 'glyphs':
        if (f) await this.post({ type: 'glyphs', seq: m.seq, query: m.query, ...f.page(m.query, m.offset, m.limit) });
        break;
      case 'glyph':
        if (f && m.id < f.numGlyphs) await this.post({ type: 'glyph', item: f.glyph(m.id) });
        break;
      case 'block':
        if (f) await this.post({ type: 'block', ...f.blockChars(m.index) });
        break;
      case 'face':
        if (f && f.info.faces && m.index < f.info.faces.length && m.index !== this.face) {
          this.face = m.index;
          await this.sendInit();
        }
        break;
      case 'copy':
        await vscode.env.clipboard.writeText(m.text);
        vscode.window.setStatusBarMessage(`Copied ${m.what === 'css' ? 'the CSS' : m.text.length > 40 ? m.what : m.text}`, 2500);
        await this.post({ type: 'copied', what: m.what });
        break;
      case 'fontError':
        // The browser engine refused the font; the webview shows its own banner.
        break;
      default:
        break;
    }
  }
}

function activeFontUri(arg) {
  if (arg && arg.scheme) return arg;
  const tab = vscode.window.tabGroups && vscode.window.tabGroups.activeTabGroup && vscode.window.tabGroups.activeTabGroup.activeTab;
  const input = tab && tab.input;
  if (input && input.uri && FONT_RE.test(input.uri.path)) return input.uri;
  return undefined;
}

function activate(context) {
  rating = createRatingPrompt({ vscode, context, extensionId: SELF_ID, section: PREFIX, message: (n) => `Font Viewer has opened ${n} fonts for you. A rating helps other people find it.` });
  registerSupport({ vscode, context, prefix: PREFIX, selfId: SELF_ID });
  const provider = new FontEditorProvider(context);
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(VIEW_TYPE, provider, { supportsMultipleEditorsPerDocument: true, webviewOptions: { retainContextWhenHidden: true } }),
    vscode.commands.registerCommand('fontViewer.openWith', async (uri) => {
      let target = activeFontUri(uri);
      if (!target) {
        const r = await vscode.window.showOpenDialog({ canSelectMany: false, openLabel: 'Open font', filters: { Fonts: ['ttf', 'otf', 'woff', 'woff2', 'ttc', 'otc'] } });
        target = r && r[0];
      }
      if (target) await vscode.commands.executeCommand('vscode.openWith', target, VIEW_TYPE);
    }),
    vscode.commands.registerCommand('fontViewer.copyFontFace', async (uri) => {
      const target = activeFontUri(uri);
      if (!target) {
        vscode.window.showInformationMessage('Open or select a font file first.');
        return;
      }
      try {
        const f = await loadFont(target, 0);
        await vscode.env.clipboard.writeText(fontFaceCss(f.info, baseName(target), f.cmap));
        vscode.window.setStatusBarMessage(`Copied @font-face for ${f.info.family || baseName(target)}`, 2500);
      } catch (e) {
        vscode.window.showErrorMessage(e && e.message ? e.message : String(e));
      }
    }),
    vscode.commands.registerCommand('fontViewer.openWalkthrough', () =>
      vscode.commands.executeCommand('workbench.action.openWalkthrough', `${SELF_ID}#fontViewer.start`, false)),
  );
  return { provider };
}

function deactivate() {}

module.exports = { activate, deactivate, FontEditorProvider, FontSession, loadFont, activeFontUri, VIEW_TYPE, PREFIX, SELF_ID, cpLabel };
