'use strict';
// Test fonts live in test/fixtures (built by scripts/make-fixtures.py). Zovo Test Sans is our own
// OFL font; JetBrains Mono and Fraunces are SIL OFL 1.1 subsets (license texts next to them).
const fs = require('fs');
const path = require('path');

const FIX = path.join(__dirname, 'fixtures');
const fixture = (n) => path.join(FIX, n);
const read = (n) => fs.readFileSync(fixture(n));

/** Glyph outlines of an opened font, as path strings, for comparisons. */
function allPaths(font) {
  const out = [];
  for (let i = 0; i < font.numGlyphs; i++) out.push(font.glyph(i).d);
  return out;
}

module.exports = { FIX, fixture, read, allPaths };
