# Mono font files

- `jetbrains-mono-latin-wght-normal.woff2` (40,404 bytes). The latin subset from the npm package
  `@fontsource-variable/jetbrains-mono` 5.3.0. Used at build time only, to draw the Open Graph images.
- `jetbrains-mono-basic-latin-wght.woff2` (12,360 bytes). The file that the site ships. Made on 2026-10-10 from the
  file above with fontTools 4.60.2 (`fontTools.subset`, layout features dropped, hinting dropped, all name records kept,
  weight axis 100 to 800 kept). Characters: U+0020 to U+007E, U+00A0, U+00B7, U+00D7, U+2018, U+2019, U+201C, U+201D,
  U+2026, U+2212. A character outside this set falls back to the system mono face, one glyph at a time.
- License: SIL Open Font License 1.1, copyright 2020 The JetBrains Mono Project Authors. The font has no reserved
  font name. `JETBRAINS-MONO-OFL.txt` holds the license text, and the site ships it at `/licenses/JetBrainsMono-OFL`.
