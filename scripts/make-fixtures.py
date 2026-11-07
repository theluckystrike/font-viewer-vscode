#!/usr/bin/env python3
"""Builds the test and sample fonts in test/fixtures/. Dev only, not shipped in the VSIX.

Needs fontTools and brotli (pip install fonttools brotli). Run: python3 scripts/make-fixtures.py

What it writes:
- zovo-test.ttf / .otf / .woff / .woff2 / -hmtx.woff2: "Zovo Test Sans", a tiny font drawn here from
  rectangles and triangles. Its glyphs are our own and are released under the SIL Open Font License 1.1.
  It has liga (f i -> f_i), ss01 (A -> A.ss01), kern (A V), an unmapped glyph and full name records.
- zovo-test.ttc: a collection of Zovo Test Sans Regular and Bold.
- jetbrains-mono-var.ttf: JetBrains Mono (SIL OFL 1.1, see JETBRAINS-MONO-OFL.txt), the variable latin
  subset from jetbrains-mono-latin-wght-normal.woff2, unpacked to TrueType.
"""
import os
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.pens.t2CharStringPen import T2CharStringPen
from fontTools.feaLib.builder import addOpenTypeFeaturesFromString
from fontTools.ttLib import TTFont, TTCollection
from fontTools.ttLib import woff2

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'test', 'fixtures')

UPM = 1000
# name -> (codepoint or None, advance, list of polygons)
def rect(x0, y0, x1, y1):
    return [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]

GLYPHS = {
    '.notdef': (None, 500, [rect(50, 0, 450, 700), rect(100, 50, 400, 650)[::-1]]),
    'space': (0x20, 250, []),
    'A': (0x41, 600, [[(20, 0), (120, 0), (300, 560), (480, 0), (580, 0), (340, 700), (260, 700)], rect(170, 200, 430, 280)]),
    'A.ss01': (None, 600, [rect(40, 0, 140, 700), rect(460, 0, 560, 700), rect(40, 600, 560, 700), rect(140, 300, 460, 380)]),
    'B': (0x42, 600, [rect(60, 0, 160, 700), rect(60, 0, 500, 90), rect(60, 310, 470, 390), rect(60, 610, 480, 700), rect(420, 0, 520, 380), rect(400, 380, 500, 700)]),
    'C': (0x43, 600, [rect(60, 0, 160, 700), rect(60, 0, 540, 100), rect(60, 600, 540, 700)]),
    'V': (0x56, 600, [[(20, 700), (260, 0), (340, 0), (580, 700), (480, 700), (300, 140), (120, 700)]]),
    'f': (0x66, 350, [rect(80, 0, 170, 640), rect(80, 560, 330, 640), rect(20, 380, 300, 450)]),
    'i': (0x69, 260, [rect(85, 0, 175, 480), rect(85, 580, 175, 680)]),
    'f_i': (None, 560, [rect(80, 0, 170, 640), rect(80, 560, 470, 640), rect(20, 380, 300, 450), rect(380, 0, 470, 640)]),
    'eacute': (0xE9, 520, [rect(60, 0, 460, 90), rect(60, 0, 150, 480), rect(60, 390, 460, 480), rect(60, 200, 430, 280), [(220, 560), (320, 560), (380, 700), (300, 700)]]),
    'Omega': (0x3A9, 700, [rect(40, 0, 260, 90), rect(440, 0, 660, 90), rect(160, 0, 250, 600), rect(450, 0, 540, 600), rect(160, 600, 540, 700)]),
    'Euro': (0x20AC, 600, [rect(140, 0, 230, 700), rect(140, 0, 560, 90), rect(140, 610, 560, 700), rect(40, 280, 420, 340), rect(40, 380, 420, 440)]),
    'ornament': (None, 700, [[(350, 0), (700, 350), (350, 700), (0, 350)], [(350, 150), (150, 350), (350, 550), (550, 350)]]),
}

FEA = """
languagesystem DFLT dflt;
languagesystem latn dflt;
feature liga { sub f i by f_i; } liga;
feature ss01 { sub A by A.ss01; } ss01;
feature kern { pos A V -80; pos V A -80; } kern;
"""

def names(style):
    return {
        'copyright': 'Copyright 2026 Zovo. Test font for Font Viewer.',
        'familyName': 'Zovo Test Sans',
        'styleName': style,
        'uniqueFontIdentifier': f'1.002;ZOVO;ZovoTestSans-{style}',
        'fullName': f'Zovo Test Sans {style}',
        'version': 'Version 1.002',
        'psName': f'ZovoTestSans-{style}',
        'trademark': 'Zovo Test Sans is not a trademark.',
        'manufacturer': 'Zovo',
        'designer': 'Zovo Font Lab',
        'description': 'A tiny test font with ligatures, a stylistic set and kerning.',
        'vendorURL': 'https://zovo.one',
        'designerURL': 'https://zovo.one/fonts',
        'licenseDescription': 'This Font Software is licensed under the SIL Open Font License, Version 1.1.',
        'licenseInfoURL': 'https://openfontlicense.org',
        'sampleText': 'Fi AV B C',
    }

def build(style='Regular', cff=False, weight=400):
    order = list(GLYPHS.keys())
    fb = FontBuilder(UPM, isTTF=not cff)
    fb.setupGlyphOrder(order)
    fb.setupCharacterMap({cp: g for g, (cp, _, _) in GLYPHS.items() if cp is not None})
    metrics = {}
    if cff:
        charstrings = {}
        for g, (_, adv, polys) in GLYPHS.items():
            pen = T2CharStringPen(adv, None)
            for poly in polys:
                pen.moveTo(poly[0])
                for pt in poly[1:]:
                    pen.lineTo(pt)
                pen.closePath()
            charstrings[g] = pen.getCharString()
            metrics[g] = (adv, min((p[0] for poly in polys for p in poly), default=0))
        fb.setupCFF(f'ZovoTestSans-{style}', {'FullName': f'Zovo Test Sans {style}'}, charstrings, {})
    else:
        glyphs = {}
        for g, (_, adv, polys) in GLYPHS.items():
            pen = TTGlyphPen(None)
            for poly in polys:
                pen.moveTo(poly[0])
                for pt in poly[1:]:
                    pen.lineTo(pt)
                pen.closePath()
            glyphs[g] = pen.glyph()
            metrics[g] = (adv, min((p[0] for poly in polys for p in poly), default=0))
        fb.setupGlyf(glyphs)
    fb.setupHorizontalMetrics(metrics)
    fb.setupHorizontalHeader(ascent=800, descent=-200)
    fb.setupNameTable(names(style))
    fb.setupOS2(sTypoAscender=800, sTypoDescender=-200, usWinAscent=800, usWinDescent=200, usWeightClass=weight,
                achVendID='ZOVO', fsType=0)
    fb.setupPost()
    addOpenTypeFeaturesFromString(fb.font, FEA)
    return fb.font

def main():
    os.makedirs(OUT, exist_ok=True)
    ttf = os.path.join(OUT, 'zovo-test.ttf')
    build().save(ttf)
    build(cff=True).save(os.path.join(OUT, 'zovo-test.otf'))
    f = TTFont(ttf); f.flavor = 'woff'; f.save(os.path.join(OUT, 'zovo-test.woff'))
    f = TTFont(ttf); f.flavor = 'woff2'; f.save(os.path.join(OUT, 'zovo-test.woff2'))
    woff2.compress(ttf, os.path.join(OUT, 'zovo-test-hmtx.woff2'), transform_tables={'glyf', 'loca', 'hmtx'})
    col = TTCollection()
    col.fonts = [build(), build('Bold', weight=700)]
    col.save(os.path.join(OUT, 'zovo-test.ttc'))
    jb = TTFont(os.path.join(OUT, 'jetbrains-mono-latin-wght-normal.woff2'))
    jb.flavor = None
    jb.save(os.path.join(OUT, 'jetbrains-mono-var.ttf'))
    for n in sorted(os.listdir(OUT)):
        print(n, os.path.getsize(os.path.join(OUT, n)))

if __name__ == '__main__':
    main()
