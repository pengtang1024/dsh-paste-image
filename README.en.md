# dsh-paste-image

[![CI](https://github.com/pengtang1024/dsh-paste-image/actions/workflows/ci.yml/badge.svg)](https://github.com/pengtang1024/dsh-paste-image/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![npm](https://img.shields.io/npm/v/dsh-paste-image.svg)](https://www.npmjs.com/package/dsh-paste-image)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](package.json)

[简体中文](docs/DETAIL.zh.md) · [English](docs/DETAIL.en.md) · [Español](docs/DETAIL.es.md) · [Français](docs/DETAIL.fr.md) · [Deutsch](docs/DETAIL.de.md) · [Русский](docs/DETAIL.ru.md) · [Português](docs/DETAIL.pt.md)

Paste or drop almost any image into DeepSeek Harness — even when the clipboard says `image/xpm` or lies about the MIME type.

## Why this exists

The DSH desktop client (Electron/Chromium) accepts exactly four attachment types: `image/png`, `image/jpeg`, `image/webp` and `image/gif`. Anything else is rejected with a red error that lists only PNG, JPG, WebP and GIF.

That whitelist breaks two things that happen all the time on Linux:

- **Screenshots declared as XPM.** Some screenshot tools, notably on Ubuntu/Wayland, put the image on the clipboard with the type `image/xpm`. The pixels are fine; the label is not on the whitelist, so the paste is rejected.
- **BMP bytes wearing a PNG label.** Some applications hand over a BMP (or TIFF) payload while declaring `image/png`. The declared type passes the whitelist check, the decoder later fails, and you get the same red error.

`dsh-paste-image` handles both cases inside the renderer: it looks at the actual bytes, decodes what the clipboard really contains, re-encodes it in the selected output format (PNG by default), and hands the result back to the normal attachment channel.

## How it works

1. **Capture.** `install()` registers `paste` and `drop` listeners on `document` in the capture phase, so the plugin sees the event before the composer does.
2. **Sniff.** `handle()` reads the `File` objects from `clipboardData` or `dataTransfer`, and `sniff()` identifies the real format from magic bytes — not from the declared MIME type.
3. **Re-encode.** `normalize()` lets native files through untouched. Everything else is decoded (dedicated XPM, BMP/DIB and SVG paths, the browser's own codec for the rest), drawn onto a canvas capped at 4096 px on the longest side, and exported in the selected output format (PNG by default); the extension follows the actual encoded MIME (`.png`/`.jpg`/`.webp`).
4. **Reroute.** `handle()` dispatches a synthetic `drop` event carrying the new `File` at `[data-composer-card]`, which is the same path a real drag-and-drop takes. A `__dshPasteImageRerouted` marker stops the plugin from intercepting its own event.

All of this is client-side. There is no host process, no clipboard polling and no network request.

## Supported formats

This table is the short version. The [format support reference](docs/en/formats.md) explains the decision pipeline, the full BMP variant grid, and what is intentionally out of scope.

| Format                       | Typical declared type | What happens                                                                                                                          |
| ---------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| PNG                          | `image/png`           | Passed through unchanged                                                                                                              |
| JPEG / JFIF                  | `image/jpeg`          | Passed through unchanged                                                                                                              |
| WebP                         | `image/webp`          | Passed through unchanged                                                                                                              |
| GIF                          | `image/gif`           | Passed through unchanged                                                                                                              |
| XPM (XPM3 text)              | `image/xpm`           | Decoded by `decodeXpm()`, re-encoded in the selected output format (PNG by default)                                                   |
| BMP / DIB                    | `image/bmp`           | Browser decode first, `decodeBmp()` fallback: 1/4/8/16/24/32-bit, RLE4/RLE8, BITFIELDS, OS/2 headers and headerless DIBs              |
| SVG                          | `image/svg+xml`       | Rasterised through an `<img>` element, re-encoded in the selected output format (PNG by default)                                      |
| ICO / CUR                    | `image/x-icon`        | Browser decode first, then falls back to the largest PNG-compressed entry                                                             |
| TIFF                         | `image/tiff`          | Detected by magic bytes; decoded only if the browser ships a TIFF codec (Chromium does not), otherwise the original is passed through |
| AVIF                         | `image/avif`          | Decoded by Chromium, re-encoded in the selected output format (PNG by default)                                                        |
| HEIC / HEIF, other `image/*` | `image/...`           | Detected by magic bytes; decoded only when the browser has the codec (Chromium does not decode HEIC), otherwise passed through        |

Pass-through only happens when the magic bytes match one of the four native types **and** the declared type agrees. A file whose bytes are JPEG but which claims `image/png` is re-encoded in the selected output format (PNG by default), so the declared type can no longer lie. A native file with no declared type at all is re-wrapped with the sniffed type instead of being re-encoded, and common alias spellings (`image/jpg`, `image/x-png`, `image/x-bmp`, `image/x-xpixmap`, `image/svg+xml`, …) count as agreement.

A file is considered at all when its MIME type starts with `image/` or its name ends in `.png`, `.jpg`, `.jpeg`, `.jfif`, `.gif`, `.webp`, `.bmp`, `.dib`, `.tif`, `.tiff`, `.xpm`, `.avif`, `.ico`, `.cur`, `.svg`, `.heic` or `.heif`. Non-image files in the same paste are forwarded untouched.

## Install

```bash
dsh plugin --profile <profile> add dsh-paste-image
```

The package ships prebuilt — renderer bundle, host entry, loader patch, display metadata and documentation — so the install pulls it straight from the npm registry.

```bash
dsh plugin --profile <profile> add github:pengtang1024/dsh-paste-image
```

For local development, point the profile at your checkout:

```bash
dsh plugin --profile <profile> add file:/absolute/path/to/dsh-paste-image
```

Replace `<profile>` with the profile your app runs. **Reload the page after installing** (`Ctrl+R`, or `Cmd+R` on macOS). The client module is only injected when the renderer loads, so a freshly installed plugin intercepts nothing until you reload.

**Host requirements:** DSH must satisfy the `engines.dsh` range declared in the package (`>=0.2.0-rc.2 || >=0.2.1-rc.2 || >=0.2.2-rc.1`) and Node >= 20. On an unsupported DSH version the plugin is not loaded, and the plugin detail page says so.

## Verify it works

Run the repository checks:

```bash
cd dsh-paste-image
npm test
npm run check
```

`npm test` runs the Node test suite: magic-byte sniffing, candidate detection, every BMP variant, the BMP-labelled-PNG conversion, headerless DIBs, native pass-through, the settings page and its runtime settings, and the display metadata shipped for each language. `npm run check` syntax-checks `client.js` and `lib/index.js`.

Then check the real flow:

1. Reload the DSH window.
2. Take a screenshot with your usual tool and paste it into the composer, or drop an image file onto it.
3. The attachment appears. Open DevTools (`Ctrl+Shift+I`) → Console, switch the level to **Verbose**, and look for a line like:

```text
[dsh-paste-image] image/xpm -> image/png 1440x900
```

If conversion fails, the plugin keeps the original file and logs `keep original (...)` instead.

## Configuration

The plugin ships a runtime settings page under **Settings → Plugins → dsh-paste-image → Configure**. The plugin row also shows a one-line summary (enabled / disabled), and the page behind it is the full form. The defaults match the behaviour before this page existed:

| Field                | Default | Range / behaviour                                                                                                     |
| -------------------- | ------- | --------------------------------------------------------------------------------------------------------------------- |
| Enable plugin        | On      | When off, `handle()` returns immediately and paste/drop goes fully native (listeners stay, so re-enabling is instant) |
| Max files per paste  | 8       | 1–8; a larger batch is handed to the native path as a whole                                                           |
| Long-edge limit (px) | 4096    | 512–8192; applies only to converted images, native pass-through is not resized                                        |
| Output format        | PNG     | PNG / JPEG / WebP; the encoding used for converted output                                                             |
| Quality              | 0.92    | 0.1–1, applies to JPEG / WebP only; the field is disabled while PNG is selected                                       |
| Convert XPM          | On      | When off, `image/xpm` is not converted and goes to the native channel untouched                                       |
| Convert BMP / DIB    | On      | When off, BMP/DIB (including bytes that are BMP but declare PNG) pass through untouched                               |
| Convert SVG          | On      | When off, SVG is not rasterised and goes to the native channel untouched                                              |
| Convert ICO / CUR    | On      | When off, icons are not converted and go to the native channel untouched                                              |
| Log conversions      | On      | When off, the `[dsh-paste-image] ...` `console.debug` lines are not printed                                           |

Only **Save** writes and applies the values; edits stay an in-page draft and are discarded when you leave the page. **Restore defaults** writes every default in the table back and applies them immediately too. Number inputs are rounded and clamped to their range (clearing a field does not overwrite the stored value with 0).

PNG is the default output: it is lossless. JPEG produces smaller files but composites transparent pixels onto white before encoding, and WebP keeps transparency while staying small. When the browser cannot encode the selected format, the plugin falls back to the type it actually produced, and to PNG when that type is unrecognised — the format table above still describes the default PNG output unless you switch formats.

How much you actually save depends on the image content (q=0.92, sizes in KB, 1 KB = 1000 B):

| Content          | Dimensions | PNG    | JPEG                        | WebP  |
| ---------------- | ---------- | ------ | --------------------------- | ----- |
| UI screenshot    | 1440×900   | 69.7   | 103.6                       | 33.9  |
| Photo            | 1600×1200  | 3535.3 | 649.3                       | 628.0 |
| Transparent logo | 512×512    | 349.1  | 25.8 (white bg, alpha lost) | 56.6  |
| Pixel art        | 256×256    | 4.1    | 2.9                         | 2.9   |

JPEG/WebP shrink photos by about 82%, while UI screenshots and pixel art are often smaller as PNG; never pick JPEG when you need transparency. Environment, method, timings and the q=0.8 comparison are in the [full measurements](docs/en/output-formats.md).

Settings live only in this browser, under the `localStorage` key `dsh-paste-image.settings.v1`: nothing is uploaded, nothing is written to the host, and nothing syncs across browsers or profiles. In private mode or when `localStorage` is unavailable they fall back to memory and return to the defaults after a reload. Saved settings apply immediately — no reload needed, and the next paste uses them.

## Limitations

- **XPM:** XPM3 text format only. The parser reads the `c` colour key; other keys such as `m`, `g` and `s` are ignored. Colours are resolved by the browser's CSS parser, so palette names that are not valid CSS colours, such as the multi-word `light gray`, fall back to opaque black.
- **BMP:** 1/4/8/16/24/32-bit, `BI_RGB`, `BI_RLE8`, `BI_RLE4`, `BI_BITFIELDS` and `BI_ALPHABITFIELDS`, with core, extended, V4/V5 or OS/2 headers — plus headerless DIBs. 2-bit and 64-bit-per-pixel variants are not supported. For 32-bit files without a declared alpha mask, an all-zero alpha channel is treated as opaque instead of producing a fully transparent PNG.
- **Other codecs:** SVG is rasterised in-house; ICO/CUR fall back to PNG-compressed entries; AVIF relies on the browser decoder. TIFF and HEIC are detected but Chromium ships no codec for them, so the original is passed through and the host rejects it as before. No third-party decoder is bundled.
- **Size:** converted images are scaled down to at most 4096 px on the longest side by default; adjust it under [Configuration](#configuration). Native files passed through untouched are not resized.
- **File count:** one paste or drop may contain at most 8 files by default; adjust it under [Configuration](#configuration). Larger batches are left entirely to the native path.
- **Flattening:** a converted image becomes a single still frame (PNG by default). Animation, EXIF metadata and embedded colour profiles are not preserved.
- **Scope:** only the `paste` and `drop` paths are covered. The file picker and other insertion paths keep their native behaviour.

## Performance

Version 0.3.1 optimises the hot paths; the numbers come from `bench/bench.mjs` on the same machine under Node 24:

| Case                             | 0.3.0                                            | 0.3.1                                          |
| -------------------------------- | ------------------------------------------------ | ---------------------------------------------- |
| Native PNG pass-through (20 MiB) | 3.803–3.929 ms/op; 20,971,520 bytes read in full | 0.0038–0.0063 ms/op; 0 bytes read in full      |
| XPM decode (512×512, 64 colours) | 4.712–4.837 ms/op                                | 3.35–3.95 ms/op (~-24%, observed -18% to -29%) |
| BMP→PNG conversion (1024×1024)   | ~3.9–4.0 ms/op                                   | ~3.9–4.0 ms/op, unchanged                      |
| `decodeBmp` (24/32-bit, RLE8)    | —                                                | unchanged within run-to-run noise              |

`normalize()` now reads at most a 1 KiB header through `file.slice()` to sniff the type; when the sniffed type is native (PNG/JPEG/WebP/GIF) and the declared MIME agrees, it returns without ever pulling the whole file into memory. It only falls back to a full `arrayBuffer()` read when the bytes need re-typing (empty declaration) or an actual conversion. `resolveColor()` reuses one 1×1 canvas, and XPM uses a character-code map instead of a per-pixel `row.slice()` when the code is a single character. The BMP decoder and the conversion path are untouched.

The optimisation stays inside the synchronous renderer code: no new worker, no network request, and no change to when the plugin runs. Reproduce the numbers with `npm run bench` (or `npm run bench -- --quick`); the recorded figures are reference values, not CI thresholds.

## Compatibility

The plugin targets the renderer APIs modern Chromium/Electron provides: `File`/`Blob`, `TextDecoder`, `createImageBitmap`, `canvas.toBlob`, `DataTransfer`/`DragEvent`, and `addEventListener` with a `signal`. On that baseline four cases degrade explicitly, so a missing API never disables the plugin outright or swallows a native event:

| Missing capability           | Fallback                                                                                                                               |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `AbortController`            | `install()` registers listeners without a `signal`, and the disposer removes them with `removeEventListener`                           |
| `canvas.toBlob`              | `encodeCanvas()` falls back to `toDataURL()` plus base64→`Blob` decoding                                                               |
| `DataTransfer` / `DragEvent` | `handle()` returns before claiming the event or calling `preventDefault()`, so the browser's native paste/drop path is untouched       |
| `[data-composer-card]`       | `handle()` returns as soon as the target is absent: it does not claim, does not call `preventDefault()`, and native paste stays intact |

File-like objects without `slice()`/`size` cannot read just a header and fall back to the original full-read path. CI runs the full suite on Node 20, 22 and 24 plus a `bench/bench.mjs --quick` smoke job; there are currently 90 tests (41 client/locale + 21 compatibility + 28 settings page/runtime settings) covering headerless DIBs, 1/4/8/16/24/32-bit BMP, RLE4/RLE8, BITFIELDS, OS/2 core headers, TIFF/HEIC/AVIF sniffing, MIME aliases, BMP-labelled PNG, the 8-file limit, non-image pass-through, the four fallbacks above, and the settings page's registration contract and behaviour. Per-format platform differences and browser codec dependencies are in [format support](docs/en/formats.md).

## Security and privacy

- Everything runs in the renderer. The plugin makes no network requests, uploads nothing and stores nothing.
- There is no background process, no clipboard polling and no change to DSH host code.
- Image bytes are read only from the paste or drop event, decoded locally, and handed back to the same window.
- The decoders are small, but they do process untrusted input. If you find a crash or a parsing bug, see [SECURITY.md](SECURITY.en.md).

## Languages

The plugin ships display metadata for every language the DSH interface supports — English, Simplified Chinese, Japanese, Spanish, French, German, Russian and Portuguese. Each `locale/<language>.json` carries the localized title and description, and points its detail page at the matching README in this repository, so Plugin Manager and its detail page speak the same language as the app.

**Simplified Chinese is the source language.** `README.md`, the pages under `docs/`, and `CONTRIBUTING.md`, `CHANGELOG.md` and `SECURITY.md` are written in Chinese; this page and `docs/en/` mirror them. Translations are source files next to the code, not generated text. The test suite checks that every advertised language has a locale file, a detail document, and links to the other READMEs. To fix or add a translation, see [Contributing](CONTRIBUTING.en.md#translations).

## Documentation

- [How it works](docs/en/how-it-works.md) — event flow, decoder internals and a function-by-function code map.
- [Format support](docs/en/formats.md) — decision pipeline, format matrix, BMP variants and the checklist for adding a format.
- [Output format measurements](docs/en/output-formats.md) — PNG / JPEG / WebP sizes and encode times, broken down by content type.
- [Troubleshooting](docs/en/troubleshooting.md) — common failures and how to read the logs.
- [Releasing](docs/en/releasing.md) — version policy and the maintainer release checklist.

## Community

- [Contributing](CONTRIBUTING.en.md) — setup, tests, style, translations and what a format contribution needs.
- [Code of Conduct](CODE_OF_CONDUCT.md) — Contributor Covenant 2.1.
- [Security policy](SECURITY.en.md) — private reporting, scope and supported versions.
- [Changelog](CHANGELOG.en.md) and [releases](https://github.com/pengtang1024/dsh-paste-image/releases) — what changed and why.
- [Issues](https://github.com/pengtang1024/dsh-paste-image/issues) — bug reports and format requests.

## License

MIT © 2026 pengtang1024. See [LICENSE](LICENSE).
