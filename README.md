# dsh-paste-image

[![CI](https://github.com/pengtang1024/dsh-paste-image/actions/workflows/ci.yml/badge.svg)](https://github.com/pengtang1024/dsh-paste-image/actions/workflows/ci.yml)

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
3. **Re-encode.** `normalize()` lets native files through untouched. Everything else is decoded (dedicated XPM and BMP decoders, or the browser's own codec), drawn onto a canvas capped at 4096 px on the longest side, and exported as `image/png` with a `.png` file name.
4. **Reroute.** `handle()` dispatches a synthetic `drop` event carrying the new `File` at `[data-composer-card]`, which is the same path a real drag-and-drop takes. A `__dshPasteImageRerouted` marker stops the plugin from intercepting its own event.

All of this is client-side. There is no host process, no clipboard polling and no network request.

## Supported formats

| Format                                     | Typical declared type | What happens                                                                                                                          |
| ------------------------------------------ | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| PNG                                        | `image/png`           | Passed through unchanged                                                                                                              |
| JPEG / JFIF                                | `image/jpeg`          | Passed through unchanged                                                                                                              |
| WebP                                       | `image/webp`          | Passed through unchanged                                                                                                              |
| GIF                                        | `image/gif`           | Passed through unchanged                                                                                                              |
| XPM (XPM3 text)                            | `image/xpm`           | Decoded by `decodeXpm()`, re-encoded as PNG                                                                                           |
| BMP / DIB (24/32-bit, uncompressed)        | `image/bmp`           | Browser decode first, `decodeBmp()` as fallback, re-encoded as PNG                                                                    |
| TIFF                                       | `image/tiff`          | Detected by magic bytes; decoded only if the browser ships a TIFF codec (Chromium does not), otherwise the original is passed through |
| AVIF, ICO, CUR, SVG, HEIC, other `image/*` | `image/...`           | Decoded by the browser when it can, then re-encoded as PNG; otherwise the original is passed through                                  |

Pass-through only happens when the magic bytes match one of the four native types **and** the declared type agrees (or is empty). A file whose bytes are JPEG but which claims `image/png` is re-encoded as a real PNG, so the declared type can no longer lie.

A file is considered at all when its MIME type starts with `image/` or its name ends in `.png`, `.jpg`, `.jpeg`, `.jfif`, `.gif`, `.webp`, `.bmp`, `.dib`, `.tif`, `.tiff`, `.xpm`, `.avif`, `.ico`, `.cur` or `.svg`. Non-image files in the same paste are forwarded untouched.

## Install

Not published to npm. Install from GitHub:

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

`npm test` runs the Node test suite (5 tests at 0.1.0) covering magic-byte sniffing, candidate detection, the BMP decoder, the BMP-labelled-PNG conversion and native pass-through. `npm run check` syntax-checks `client.js` and `lib/index.js`.

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
- **BMP:** 24- or 32-bit, uncompressed (`BI_RGB`), `BITMAPINFOHEADER` or newer only. RLE, 1/4/8/16-bit images and OS/2 headers are not supported. For 32-bit files the fourth byte is taken as alpha, so files that leave it at zero can come out transparent.
- **Other codecs:** AVIF, ICO, CUR, SVG and HEIC rely on the browser decoder; TIFF is detected but Chromium does not decode it. When the browser cannot decode a file, the original is passed through and the host rejects it as before.
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
- [Troubleshooting](docs/troubleshooting.md) — common failures and how to read the logs.
- [Contributing](CONTRIBUTING.md) — development setup, tests and style.

## License

MIT © 2026 pengtang1024. See [LICENSE](LICENSE).
