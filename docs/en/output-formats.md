# Output format measurements

This page records what `dsh-paste-image` really produces when it re-encodes an image as PNG, JPEG or WebP: file sizes and encode times, measured on one set of fixtures, one real Chromium build and the same `normalize()` code users paste through. The short version for users is in the [README's configuration section](../../README.en.md#configuration); the type-detection rules are in [format support](formats.md).

The headline first: **size ratios depend on content, and no single percentage is a promise.** JPEG and WebP shrink photos by roughly 82%, but with the same settings JPEG makes a UI screenshot 49% larger than PNG; pixel art and small icons are better served by PNG or WebP than by JPEG.

## Environment

| Item               | Value                                                                                             |
| ------------------ | ------------------------------------------------------------------------------------------------- |
| Browser            | Chromium 156.0.8078.4 (real Chromium driven by Playwright 1.65.1, headless)                       |
| OS                 | Ubuntu 26.04.1                                                                                    |
| CPU                | Intel Core i7-13700K                                                                              |
| Device pixel ratio | 1                                                                                                 |
| Quality            | q=0.92 (the plugin default), plus a second run at q=0.8                                           |
| Encoding path      | `normalize()` in `client.js` — the same code a real paste goes through                            |
| Size limit         | `maxSide` defaults to 4096 px; no fixture triggered scaling, so output dimensions match the input |
| Size units         | 1 KB = 1000 B (every KB on this page uses that conversion)                                        |

## Method

1. Each fixture is drawn to a canvas in the page and exported with `canvas.toBlob('image/png')` to get PNG bytes.
2. Those PNG bytes are wrapped in a `File` whose **declared type is `image/bmp`**. This step is essential: the same bytes declared as `image/png` are treated as a native format and passed straight through, so `normalize()` returns without encoding anything; declaring BMP forces the real "decode → canvas → re-encode" path. The decoded pixels are identical to the original PNG, so only the output codec differs.
3. Each format gets one warm-up run and then nine timed runs; the report uses the median. The timer wraps the whole `normalize()` `await`.
4. Size comes from the output `File.size`, type from `File.type` — confirming the browser did not fall back to another codec.
5. Each fixture is also checked for correctness: the plugin's PNG output is byte-identical to a direct `canvas.toBlob('image/png')`, on all five fixtures.
6. The q=0.92 and q=0.8 runs are separate; PNG takes no quality argument, so its numbers are the same in both tables.

## Fixtures

| Fixture              | Dimensions | Contents                                                                   |
| -------------------- | ---------- | -------------------------------------------------------------------------- |
| UI screenshot        | 1440×900   | Interface screenshot: text, panels, icons, large flat areas and hard edges |
| Photo                | 1600×1200  | Gradient plus noise, standing in for a continuous-tone photo               |
| Transparent logo     | 512×512    | Graphic mark with an alpha channel and a large transparent area            |
| Pixel art            | 256×256    | Low resolution, limited palette, hard pixel edges                          |
| Real repository icon | 180×180    | The repository's own `assets/icon-180.png`                                 |

The first four are synthetic, covering both ends of the content spectrum — hard edges and flat colour (UI screenshot, pixel art) versus continuous tone (photo) — with the transparent logo isolating the alpha channel. The fifth is a real file, confirming the synthetic results hold for real artwork. The synthetic fixtures model content structure, not any particular photo.

## q=0.92 (default quality)

Percentages are relative to the same fixture's PNG.

| Fixture              | Dimensions | PNG                     | JPEG                 | JPEG vs PNG                              | WebP                 | WebP vs PNG | PNG ms | JPEG ms | WebP ms |
| -------------------- | ---------- | ----------------------- | -------------------- | ---------------------------------------- | -------------------- | ----------- | ------ | ------- | ------- |
| UI screenshot        | 1440×900   | 69.7 KB (71,364 B)      | 103.6 KB (106,108 B) | +48.7%                                   | 33.9 KB (34,752 B)   | -51.3%      | 10.7   | 14.8    | 65.0    |
| Photo                | 1600×1200  | 3535.3 KB (3,620,108 B) | 649.3 KB (664,879 B) | -81.6%                                   | 628.0 KB (643,026 B) | -82.2%      | 90.2   | 49.9    | 224.8   |
| Transparent logo     | 512×512    | 349.1 KB (357,484 B)    | 25.8 KB (26,424 B)   | -92.6% (alpha lost, composited on white) | 56.6 KB (57,992 B)   | -83.8%      | 11.3   | 5.9     | 48.8    |
| Pixel art            | 256×256    | 4.1 KB (4,148 B)        | 2.9 KB (3,008 B)     | -27.5%                                   | 2.9 KB (2,980 B)     | -28.2%      | 1.6    | 1.7     | 2.5     |
| Real repository icon | 180×180    | 4.4 KB (4,469 B)        | 5.6 KB (5,746 B)     | +28.6%                                   | 2.8 KB (2,852 B)     | -36.2%      | 0.8    | 0.8     | 2.1     |

## q=0.8 (comparison)

JPEG and WebP run again at a lower quality. Percentages still use the q=0.92 PNG as the baseline — PNG ignores the quality setting.

| Fixture              | JPEG q0.8            | vs PNG | ms   | WebP q0.8            | vs PNG | ms    |
| -------------------- | -------------------- | ------ | ---- | -------------------- | ------ | ----- |
| UI screenshot        | 75.8 KB (77,640 B)   | +8.8%  | 15.2 | 24.2 KB (24,748 B)   | -65.3% | 58.4  |
| Photo                | 317.9 KB (325,500 B) | -91.0% | 46.9 | 339.7 KB (347,850 B) | -90.4% | 193.2 |
| Transparent logo     | 17.1 KB (17,504 B)   | -95.1% | 7.1  | 39.6 KB (40,562 B)   | -88.7% | 44.3  |
| Pixel art            | 2.5 KB (2,539 B)     | -38.8% | 1.1  | 2.5 KB (2,584 B)     | -37.7% | 3.6   |
| Real repository icon | 4.3 KB (4,421 B)     | -1.1%  | 1.0  | 2.1 KB (2,182 B)     | -51.2% | 2.7   |

## How to read the numbers

- **Size ratios depend on content, not a universal constant.** JPEG is +49% on UI text and -82% on photos; quoting a single percentage as a promise will bite.
- **UI/text: PNG can be the smaller choice.** Here PNG is 69.7 KB against JPEG's 103.6 KB. WebP is smallest (33.9 KB) but takes about 65 ms to encode — roughly 6× PNG.
- **Photos: JPEG and WebP both land around -82%.** At q=0.92 WebP is only about 3% smaller than JPEG while encoding 4.5× slower (224.8 ms vs 49.9 ms); at q=0.8 JPEG is actually smaller than WebP (317.9 KB vs 339.7 KB).
- **Transparency: JPEG has no alpha.** Transparent pixels are composited onto white — that is the price of the `-92.6%` — so pick PNG or WebP when alpha matters. Here WebP at q=0.92 keeps alpha and is still 84% smaller than PNG.
- **Pixel art: PNG is already 4.1 KB.** JPEG/WebP save about 28%, but both are lossy and can ring or bleed on hard edges; a few hundred bytes is rarely worth edge artefacts.
- **Small icons: WebP saves 36%, JPEG is 28% larger than PNG.** At icon sizes JPEG's blockiness and header overhead win nothing.
- **Correctness checks pass:** the plugin's PNG output is byte-identical to a direct `canvas.toBlob('image/png')` (5/5 fixtures), and output dimensions match the input (`maxSide` defaults to 4096, which none of these fixtures reached).

## What these numbers do not promise

- **Synthetic fixtures, one machine, one browser.** The five fixtures cover content types, not every real-world asset; change the content, resolution or browser version and the ratios move.
- **Timings describe only this machine.** Ubuntu 26.04.1, i7-13700K, Chromium 156, headless, DPR 1; ±10% elsewhere is normal. Sizes are deterministic: the same input, encoder and parameters produce the same byte count.
- **A median is not a ceiling.** Nine timed runs, median reported; cold start, GC and system load can push a single run well above the table.
- **Not a quality guarantee.** The visual quality of lossy encoding is subjective; q=0.92 is the plugin default, not a quality that suits every image.

## Reproducing the measurement

No measurement script is committed to this repository: it needs a real Chromium and a Playwright install, which do not belong in a zero-dependency plugin repo. Write a one-off script instead:

1. Launch headless Chromium through Playwright with `deviceScaleFactor: 1` and open a blank page.
2. Build the fixtures in the page: draw to a canvas, or load `assets/icon-180.png` and draw it to a canvas.
3. Inject `client.js` as a script with a minimal `window.__ModuleLoader__` stub that captures the factory, then take the returned `api`.
4. Call `api.applySettings({ outputFormat, quality })`, then `api.normalize(file)`, where `file` is a `File` holding PNG bytes and declaring `image/bmp`.
5. One warm-up plus nine timed runs per format, median; size from `file.size`, type from `file.type`. Also run `canvas.toBlob('image/png')` once per fixture for the byte-for-byte comparison.

Pin the browser version and DPR when reproducing, or the numbers are not comparable. The codec implementation and settings are described in [How it works · 13. Settings and the configuration page](how-it-works.md#13-settings-and-the-configuration-page); defaults and ranges are in the [README configuration table](../../README.en.md#configuration).
