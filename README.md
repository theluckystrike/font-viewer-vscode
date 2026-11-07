# Font Viewer & Font Preview (TTF, OTF, WOFF)

Open any TTF, OTF, WOFF, WOFF2 or TTC font in VS Code to test text with its variable axes and OpenType features, see every glyph, and read its license before you ship it.

![JetBrains Mono, a variable font, open in Font Viewer. Sample text at 56 px with the frac feature on, a waterfall of sizes, the weight slider at 700 and the OpenType feature check boxes](images/type-tester.png)

*Screenshots come from a real VS Code 1.142 window running the packaged extension. The fonts are JetBrains Mono and Fraunces (both SIL Open Font License 1.1) and Zovo Test Sans, a small test font made by `scripts/make-fixtures.py`.*

- Test real text. Type a sample, drag the size slider, and check a waterfall from 12 to 96 px. Move the weight, width or any custom axis, and turn features like `liga`, `kern`, `ss01` or `zero` on and off.
- See every glyph, also ligatures and alternates that no key types. Search by name, character, `U+20AC` or glyph id, and copy the character, the code point or the outline as SVG.
- Check the license. The Info tab shows the license, designer, copyright and embedding rights, and gives you a ready `@font-face` rule.

## Quick start

1. Install the extension.
2. Click a `.ttf`, `.otf`, `.woff`, `.woff2` or `.ttc` file in the Explorer.

Font Viewer is the default editor for these files. It's read-only, so it never changes the font.

## What you can do

| Tab | What it shows |
|---|---|
| Type tester | Your sample text in the font, a size slider from 8 to 200 px and a waterfall. A slider for each variable axis, a list of named instances, and a check box for each OpenType feature. Copy CSS gives the `@font-face` rule plus the matching `font-variation-settings` and `font-feature-settings`. |
| Glyphs | Every glyph drawn from its outline, with its name and code point. Glyphs load in pages as you scroll, so a CJK font with 20,000 glyphs opens fast. Click one to see it large with the baseline, x-height, cap height and advance width. |
| Characters | The characters of the font grouped by Unicode block, with coverage such as "Basic Latin 95/128". Turn off "Only characters in the font" to see the gaps. |
| Info | License and credits, the full name table, metrics, axes and instances, GSUB and GPOS feature tags, all tables with sizes, and the `@font-face` rule. |

![The glyph grid of JetBrains Mono with a search for "acute", and the detail panel of one glyph with its metrics lines and copy buttons](images/glyph-grid.png)

![The character map of JetBrains Mono. Unicode blocks with coverage counts on the left, and the Latin-1 Supplement characters on the right](images/character-map.png)

![The Info tab of the test font with the license, designer, copyright and embedding rights at the top](images/font-info.png)

![Fraunces SemiBold (SIL Open Font License 1.1) in the type tester with the Light Modern theme](images/light-theme.png)

## Supported files

| Format | Extensions | Notes |
|---|---|---|
| TrueType | `.ttf` | Also variable fonts. |
| OpenType | `.otf` | CFF outlines. CFF2 variable fonts show their text and metadata, but the glyph grid draws them with the font instead of from outlines. |
| WOFF | `.woff` | Unpacked with Node's zlib. |
| WOFF2 | `.woff2` | Unpacked by our own decoder, which rebuilds the glyf, loca and hmtx tables. |
| Collections | `.ttc`, `.otc` | Pick the font from a list in the header. |

When you save a new build of a font, the open view reloads.

You can also right-click a font in the Explorer and choose Copy CSS @font-face without opening it.

## Settings

| Setting | Default | What it does |
|---|---|---|
| `fontViewer.sampleText` | The quick brown fox jumps over the lazy dog. 0123456789 | Text in the type tester and the waterfall. You can edit it in the view too. |
| `fontViewer.previewSize` | 48 | Starting size in pixels of the large sample. |
| `fontViewer.maxFileMB` | 64 | Larger files show a message instead of opening. |
| `fontViewer.askForRating` | true | One rating request after a few days of use. |
| `fontViewer.showSupportLinks` | true | The small Sponsor and More free viewers links in the status line. |

## Privacy

Font Viewer works offline. It makes no network calls and sends no telemetry. The font is read from disk and loaded into the view from memory, and the view has a strict Content Security Policy with no remote scripts. Font names and other text from the file are shown as plain text.

## Known limits

- Glyph outlines show the default instance of a variable font. The type tester, waterfall and character map follow the axis sliders.
- Color fonts (COLR, SVG, sbix, CBDT) are drawn in color in the type tester and the character map, but the glyph grid shows their plain outlines.
- WOFF2 collections, SVG fonts, `.dfont` and Type 1 fonts aren't supported.
- Shaping in the type tester comes from VS Code's own engine (Chromium), so it matches what a browser shows.

## Support

Zovo extensions have no ads and no tracking, and sponsors pay for the time that goes into fixes and new viewers. You can sponsor the work on [GitHub Sponsors](https://github.com/sponsors/theluckystrike).

## More viewers by Zovo

- [PDF Viewer & PDF Reader with Dark Mode](https://marketplace.visualstudio.com/items?itemName=zovo.pdf-viewer-dark) reads PDFs with a real dark mode, search, an outline and thumbnails.
- [CSV Viewer, Excel Viewer & Parquet Viewer](https://marketplace.visualstudio.com/items?itemName=zovo.table-viewer-vscode) opens CSV, TSV, Excel and Parquet files as a sortable, filterable table.
- [DOCX Viewer & Word Viewer with Dark Mode](https://marketplace.visualstudio.com/items?itemName=zovo.docx-viewer-vscode) previews Word and ODT files with dark mode, an outline and search.
- [PPTX Viewer & PowerPoint Viewer](https://marketplace.visualstudio.com/items?itemName=zovo.pptx-slide-viewer) shows PowerPoint slides, thumbnails and speaker notes.
- [Large JSON Viewer & JSON Tree](https://marketplace.visualstudio.com/items?itemName=zovo.zovo-json-tree-viewer) shows large JSON files as a searchable tree, copies JSONPath and turns arrays of objects into a table.
- [JSONL Viewer & NDJSON Table Viewer](https://marketplace.visualstudio.com/items?itemName=zovo.zovo-jsonl-viewer) opens JSONL and NDJSON files as a table, as records or as a chat view.
- [SQLite Viewer & DB Viewer (Read-Only)](https://marketplace.visualstudio.com/items?itemName=zovo.sqlite-table-viewer) browses SQLite tables read-only and runs SELECT queries.
- [HDF5 & NetCDF Explorer (H5 Viewer)](https://marketplace.visualstudio.com/items?itemName=zovo.hdf5-netcdf-explorer) browses groups, attributes and values in HDF5 and NetCDF files and plots slices.
- [GGUF, Safetensors & NPY Viewer (NumPy Viewer)](https://marketplace.visualstudio.com/items?itemName=zovo.tensor-viewer) shows NPY, NPZ, Safetensors and GGUF tensors with stats and heatmaps.
- [MP4 Video Player & Video Preview with Sound](https://marketplace.visualstudio.com/items?itemName=zovo.video-preview-with-sound) plays MP4, MOV, MKV and WebM files with their sound.
- [DXF Viewer & CAD Viewer for 2D Drawings](https://marketplace.visualstudio.com/items?itemName=zovo.dxf-viewer) opens ASCII and binary DXF drawings with layers, measuring and PNG or SVG export.
- [AGENTS.md & CLAUDE.md Linter (Context Drift)](https://marketplace.visualstudio.com/items?itemName=zovo.context-drift) finds stale commands, paths and versions in AGENTS.md and CLAUDE.md files.
- [Agent Skills & Claude Skills (Skill Shelf)](https://marketplace.visualstudio.com/items?itemName=zovo.skill-shelf) lists, checks and toggles the Agent Skills that Claude Code, Codex and Cursor load.
- [Claude Code History & Codex History Viewer](https://marketplace.visualstudio.com/items?itemName=zovo.agent-session-viewer) browses and searches your local Claude Code and Codex sessions.
- [Claude Code Usage & Codex Usage Cost Meter](https://marketplace.visualstudio.com/items?itemName=zovo.ai-usage-meter) shows Claude Code and Codex tokens and estimated cost from your local session files.

Coming soon to the Marketplace, with the code on GitHub now.

- [Audio Preview & Loudness Meter](https://github.com/theluckystrike/audio-preview-vscode) plays audio files with a waveform, a spectrogram and LUFS loudness.
- [Graphviz Preview & DOT Viewer](https://github.com/theluckystrike/graphviz-preview-vscode) shows a live preview of DOT files and exports SVG or PNG.
- [TIFF Viewer (16-bit, Float, GeoTIFF)](https://github.com/theluckystrike/tiff-viewer-vscode) opens 16-bit, float, multi-page and GeoTIFF images.
- [Avro Viewer, Arrow Viewer & Feather Viewer](https://github.com/theluckystrike/arrow-avro-viewer-vscode) opens Avro, Arrow and Feather files as a paged table.
- [EML Viewer & MBOX Email Viewer](https://github.com/theluckystrike/eml-viewer-vscode) reads EML, EMLX and MBOX email files with remote images blocked.
- [3D Model Viewer (GLB, glTF, STL, OBJ, PLY)](https://github.com/theluckystrike/model-viewer-vscode) views GLB, glTF, STL, OBJ, PLY and 3MF models.
- [PKL Viewer & Pickle Viewer](https://github.com/theluckystrike/pickle-viewer-vscode) opens Python pickle files without Python and never runs their code.
- [DICOM Viewer & NIfTI Viewer for CT and MRI](https://github.com/theluckystrike/dicom-nifti-viewer-vscode) opens CT and MRI scans, DICOM folders and NIfTI volumes with window presets and three views.
- [ZIP Viewer & Archive Explorer (JAR, TAR, GZ)](https://github.com/theluckystrike/archive-explorer-vscode) browses ZIP, JAR, VSIX, TAR and GZ files, opens entries in tabs and extracts them safely.
- [GCode Viewer & 3D Print Preview](https://github.com/theluckystrike/gcode-viewer-vscode) shows GCode toolpaths in 3D layer by layer, with print time and filament use.
- [EPUB Reader & EPUB Viewer](https://github.com/theluckystrike/epub-reader-vscode) reads EPUB books with a table of contents, search and light, sepia or dark themes.
- [HAR Viewer & HTTP Archive Viewer](https://github.com/theluckystrike/har-viewer-vscode) opens HAR files from browser DevTools with a timing waterfall, filters and a redacted copy for sharing.
- [File Viewers Pack](https://github.com/theluckystrike/zovo-file-viewers) installs the PDF, table, Word, PowerPoint, HDF5 and tensor viewers in one step.

## License

MIT. Font Viewer bundles opentype.js (MIT). See THIRD-PARTY-NOTICES.md.
