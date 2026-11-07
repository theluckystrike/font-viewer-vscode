# Third-party notices

Font Viewer bundles this code in `dist/extension.js`:

- **opentype.js** 1.3.4, MIT License, Copyright (c) 2020 Frederik De Bleser. https://github.com/opentypejs/opentype.js
  It reads glyph names and outlines. It brings two small MIT dependencies that are bundled too:
  **tiny-inflate** 1.0.3 (Copyright (c) 2015-present Devon Govett) and **string.prototype.codepointat** 0.2.1 (Copyright Mathias Bynens).

Data:

- The Unicode block names and ranges in `src/core/blocks.js` come from Unicode 13.0 `Blocks.txt`, under the Unicode License (https://www.unicode.org/license.txt).

The WOFF2 decoder (`src/core/woff2.js`) is our own code under the MIT License. It follows the W3C WOFF2 specification and uses the Brotli decoder built into Node.js.

Test fonts (in `test/fixtures/`, not shipped in the extension):

- Zovo Test Sans is drawn by `scripts/make-fixtures.py`. It is released under the SIL Open Font License 1.1.
- JetBrains Mono, SIL Open Font License 1.1, Copyright 2020 The JetBrains Mono Project Authors. See `test/fixtures/JETBRAINS-MONO-OFL.txt`.
- Fraunces, SIL Open Font License 1.1, Copyright 2020 The Fraunces Project Authors. See `test/fixtures/Fraunces-OFL.txt`.

## License text (opentype.js; tiny-inflate and string.prototype.codepointat use the same MIT terms)

```
The MIT License (MIT)

Copyright (c) 2020 Frederik De Bleser

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```
