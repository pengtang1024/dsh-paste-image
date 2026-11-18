# dsh-paste-image

[![CI](https://github.com/pengtang1024/dsh-paste-image/actions/workflows/ci.yml/badge.svg)](https://github.com/pengtang1024/dsh-paste-image/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![npm](https://img.shields.io/npm/v/dsh-paste-image.svg)](https://www.npmjs.com/package/dsh-paste-image)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](package.json)

Paste or drop almost any image into DeepSeek Harness — even when the clipboard says `image/xpm` or lies about the MIME type.

## Why this exists

The DSH desktop client (Electron/Chromium) accepts exactly four attachment types: `image/png`, `image/jpeg`, `image/webp` and `image/gif`. Anything else gives you the red rejection:

> 仅支持 PNG、JPG、WebP、GIF

That whitelist breaks two things that happen all the time on Linux:

- **Screenshots declared as XPM.** Some screenshot tools, notably on Ubuntu/Wayland, put the image on the clipboard with the type `image/xpm`. The pixels are fine; the label is not on the whitelist, so the paste is rejected.
- **BMP bytes wearing a PNG label.** Some applications hand over a BMP (or TIFF) payload while declaring `image/png`. The declared type passes the whitelist check, the decoder later fails, and you get the same red error.

`dsh-paste-image` handles both cases inside the renderer: it looks at the actual bytes, decodes what the clipboard really contains, re-encodes it as PNG, and hands the result back to the normal attachment channel.

## How it works

1. **Capture.** `install()` registers `paste` and `drop` listeners on `document` in the capture phase, so the plugin sees the event before the composer does.
2. **Sniff.** `handle()` reads the `File` objects from `clipboardData` or `dataTransfer`, and `sniff()` identifies the real format from magic bytes — not from the declared MIME type.
3. **Re-encode.** `normalize()` lets native files through untouched. Everything else is decoded (dedicated XPM, BMP/DIB and SVG paths, the browser's own codec for the rest), drawn onto a canvas capped at 4096 px on the longest side, and exported as `image/png` with a `.png` file name.
4. **Reroute.** `handle()` dispatches a synthetic `drop` event carrying the new `File` at `[data-composer-card]`, which is the same path a real drag-and-drop takes. A `__dshPasteImageRerouted` marker stops the plugin from intercepting its own event.

All of this is client-side. There is no host process, no clipboard polling and no network request.

## Supported formats

This table is the short version. The [format support reference](docs/formats.md) explains the decision pipeline, the full BMP variant grid, and what is intentionally out of scope.

| Format                       | Typical declared type | What happens                                                                                                                          |
| ---------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| PNG                          | `image/png`           | Passed through unchanged                                                                                                              |
| JPEG / JFIF                  | `image/jpeg`          | Passed through unchanged                                                                                                              |
| WebP                         | `image/webp`          | Passed through unchanged                                                                                                              |
| GIF                          | `image/gif`           | Passed through unchanged                                                                                                              |
| XPM (XPM3 text)              | `image/xpm`           | Decoded by `decodeXpm()`, re-encoded as PNG                                                                                           |
| BMP / DIB                    | `image/bmp`           | Browser decode first, `decodeBmp()` fallback: 1/4/8/16/24/32-bit, RLE4/RLE8, BITFIELDS, OS/2 headers and headerless DIBs              |
| SVG                          | `image/svg+xml`       | Rasterised through an `<img>` element, re-encoded as PNG                                                                              |
| ICO / CUR                    | `image/x-icon`        | Browser decode first, then falls back to the largest PNG-compressed entry                                                             |
| TIFF                         | `image/tiff`          | Detected by magic bytes; decoded only if the browser ships a TIFF codec (Chromium does not), otherwise the original is passed through |
| AVIF                         | `image/avif`          | Decoded by Chromium, re-encoded as PNG                                                                                                |
| HEIC / HEIF, other `image/*` | `image/...`           | Detected by magic bytes; decoded only when the browser has the codec (Chromium does not decode HEIC), otherwise passed through        |

Pass-through only happens when the magic bytes match one of the four native types **and** the declared type agrees. A file whose bytes are JPEG but which claims `image/png` is re-encoded as a real PNG, so the declared type can no longer lie. A native file with no declared type at all is re-wrapped with the sniffed type instead of being re-encoded, and common alias spellings (`image/jpg`, `image/x-png`, `image/x-bmp`, `image/x-xpixmap`, `image/svg+xml`, …) count as agreement.

A file is considered at all when its MIME type starts with `image/` or its name ends in `.png`, `.jpg`, `.jpeg`, `.jfif`, `.gif`, `.webp`, `.bmp`, `.dib`, `.tif`, `.tiff`, `.xpm`, `.avif`, `.ico`, `.cur`, `.svg`, `.heic` or `.heif`. Non-image files in the same paste are forwarded untouched.

## Install

```bash
dsh plugin --profile <profile> add dsh-paste-image
```

The package ships prebuilt, so the install pulls eight small files through the npm registry. GitHub installs work too and skip the registry:

```bash
dsh plugin --profile <profile> add github:pengtang1024/dsh-paste-image
```

For local development, point the profile at your checkout:

```bash
dsh plugin --profile <profile> add file:/absolute/path/to/dsh-paste-image
```

Replace `<profile>` with the profile your app runs. **Reload the page after installing** (`Ctrl+R`, or `Cmd+R` on macOS). The client module is only injected when the renderer loads, so a freshly installed plugin intercepts nothing until you reload.

## Verify it works

Run the repository checks:

```bash
cd dsh-paste-image
npm test
npm run check
```

`npm test` runs the Node test suite (20 tests at 0.2.2) covering magic-byte sniffing, candidate detection, every BMP variant, the BMP-labelled-PNG conversion, headerless DIBs and native pass-through. `npm run check` syntax-checks `client.js` and `lib/index.js`.

Then check the real flow:

1. Reload the DSH window.
2. Take a screenshot with your usual tool and paste it into the composer, or drop an image file onto it.
3. The attachment appears. Open DevTools (`Ctrl+Shift+I`) → Console, switch the level to **Verbose**, and look for a line like:

```text
[dsh-paste-image] image/xpm -> image/png 1440x900
```

If conversion fails, the plugin keeps the original file and logs `keep original (...)` instead.

## Limitations

- **XPM:** XPM3 text format only. The parser reads the `c` colour key; other keys such as `m`, `g` and `s` are ignored. Colours are resolved by the browser's CSS parser, so palette names that are not valid CSS colours, such as the multi-word `light gray`, fall back to opaque black.
- **BMP:** 1/4/8/16/24/32-bit, `BI_RGB`, `BI_RLE8`, `BI_RLE4`, `BI_BITFIELDS` and `BI_ALPHABITFIELDS`, with core, extended, V4/V5 or OS/2 headers — plus headerless DIBs. 2-bit and 64-bit-per-pixel variants are not supported. For 32-bit files without a declared alpha mask, an all-zero alpha channel is treated as opaque instead of producing a fully transparent PNG.
- **Other codecs:** SVG is rasterised in-house; ICO/CUR fall back to PNG-compressed entries; AVIF relies on the browser decoder. TIFF and HEIC are detected but Chromium ships no codec for them, so the original is passed through and the host rejects it as before. No third-party decoder is bundled.
- **Size:** converted images are scaled down to at most 4096 px on the longest side. Native files passed through untouched are not resized.
- **File count:** one paste or drop may contain at most 8 files. Larger batches are left entirely to the native path.
- **Flattening:** a converted image becomes a single PNG frame. Animation, EXIF metadata and embedded colour profiles are not preserved.
- **Scope:** only the `paste` and `drop` paths are covered. The file picker and other insertion paths keep their native behaviour.

## Security and privacy

- Everything runs in the renderer. The plugin makes no network requests, uploads nothing and stores nothing.
- There is no background process, no clipboard polling and no change to DSH host code.
- Image bytes are read only from the paste or drop event, decoded locally, and handed back to the same window.
- The decoders are small, but they do process untrusted input. If you find a crash or a parsing bug, see [SECURITY.md](SECURITY.md).

## Documentation

- [How it works](docs/how-it-works.md) — event flow, decoder internals and a function-by-function code map.
- [Format support](docs/formats.md) — decision pipeline, format matrix, BMP variants and the checklist for adding a format.
- [Troubleshooting](docs/troubleshooting.md) — common failures and how to read the logs.
- [Releasing](docs/releasing.md) — version policy and the maintainer release checklist.

## Community

- [Contributing](CONTRIBUTING.md) — setup, tests, style and what a format contribution needs.
- [Code of Conduct](CODE_OF_CONDUCT.md) — Contributor Covenant 2.1.
- [Security policy](SECURITY.md) — private reporting, scope and supported versions.
- [Changelog](CHANGELOG.md) and [releases](https://github.com/pengtang1024/dsh-paste-image/releases) — what changed and why.
- [Issues](https://github.com/pengtang1024/dsh-paste-image/issues) — bug reports and format requests.

## License

MIT © 2026 pengtang1024. See [LICENSE](LICENSE).
