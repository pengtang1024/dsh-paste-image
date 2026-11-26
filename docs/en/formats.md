# Format support

This page is the reference for what happens to a pasted or dropped file: how the type is decided, which decoder handles it, what the output is, and which formats are intentionally left alone. The user-facing summary lives in the [README](../../README.en.md#supported-formats); this document is the detail behind it.

## Decision pipeline

Every file in a `paste` or `drop` event goes through the same four questions.

1. **Is it a candidate at all?** `isImageCandidate()` accepts a file when `file.type` starts with `image/` or when the file name matches
   `.png`, `.jpg`, `.jpeg`, `.jfif`, `.gif`, `.webp`, `.bmp`, `.dib`, `.tif`, `.tiff`, `.xpm`, `.avif`, `.ico`, `.cur`, `.svg`, `.heic` or `.heif`.
   Everything else in the same event is forwarded untouched.
2. **What is it really?** `sniff()` reads magic bytes and returns a canonical type, ignoring the declared MIME type. The order matters: the four native formats are checked first, then BMP, TIFF, XPM, the `ftyp` family (AVIF/HEIC), ICO/CUR, SVG and finally headerless DIB.
3. **Can it pass through?** The file is passed through byte-for-byte only when the sniffed type is native **and** the declared type agrees (including the alias spellings in `MIME_ALIAS`). A native file with no declared type is re-wrapped with the sniffed type instead of being re-encoded, so the host sees a valid `File`. A native file whose bytes disagree with its declared type is re-encoded — this is what stops a BMP from wearing an `image/png` label.
4. **Otherwise: decode, draw, re-encode.** `toCanvas()` picks a decoder, draws the result onto a canvas capped at 4096 px on the longest side, and the canvas is exported in the selected output format (WebP by default). If every decoder refuses, the original file is kept and the plugin logs `keep original (...)`, so the failure looks exactly like the stock client.

## Format matrix

| Family                      | Sniffed as                   | Decode path                                                                           | Result                                        |
| --------------------------- | ---------------------------- | ------------------------------------------------------------------------------------- | --------------------------------------------- |
| PNG, JPEG, WebP, GIF        | Their own type               | None — bytes are forwarded                                                            | Unchanged file                                |
| Same, but mislabelled       | The real type                | Canvas decode → PNG                                                                   | Real PNG with a `.png` name                   |
| XPM3 text                   | `image/xpm`                  | `decodeXpm()` — in-house parser, colours resolved through the browser's CSS parser    | PNG                                           |
| BMP with a file header      | `image/bmp`                  | Chromium `createImageBitmap()` first; `decodeBmp()` when Chromium refuses the variant | PNG                                           |
| Headerless DIB (`CF_DIB`)   | `image/bmp`                  | `decodeBmp()` only — Chromium expects the 14-byte file header                         | PNG                                           |
| BMP with `BI_JPEG`/`BI_PNG` | `image/bmp`                  | `bmpEmbedded()` unwraps the payload, then the browser decodes it                      | PNG                                           |
| SVG                         | `image/svg`                  | `loadSvg()` — `<img>` element on an object URL, then canvas                           | PNG, sized from `width`/`height` or `viewBox` |
| ICO / CUR                   | `image/x-icon`               | Chromium first; `icoPngEntry()` falls back to the largest PNG-compressed entry        | PNG                                           |
| AVIF                        | `image/avif`                 | Chromium `createImageBitmap()`                                                        | PNG (first frame)                             |
| TIFF                        | `image/tiff`                 | Detected, then offered to the browser — Chromium has no TIFF codec                    | Original kept; host rejects it as before      |
| HEIC / HEIF                 | `image/heic`                 | Detected, then offered to the browser — Chromium has no HEIC codec                    | Original kept; host rejects it as before      |
| Any other `image/*`         | Whatever the browser accepts | `createImageBitmap()` with the declared type                                          | PNG, or original kept                         |

"Alias spellings" are the values that point at a canonical type: `image/jpg`, `image/pjpeg` → `image/jpeg`; `image/x-png` → `image/png`; `image/x-bmp`, `image/x-ms-bmp`, `image/x-win-bitmap` → `image/bmp`; `image/vnd.microsoft.icon` → `image/x-icon`; `image/x-xpixmap`, `image/x-xpm` → `image/xpm`; `image/svg+xml` → `image/svg`.

## BMP variants

`parseBmp()` and `decodeBmp()` are shared across every variant, so the accepted combinations are described as a grid rather than a list of special cases.

| Dimension   | Accepted values                                                                                                                                                 |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pixel depth | 1, 4, 8, 16, 24, 32 bits per pixel                                                                                                                              |
| Compression | `BI_RGB` (0), `BI_RLE8` (1), `BI_RLE4` (2), `BI_BITFIELDS` (3), `BI_ALPHABITFIELDS` (6); `BI_JPEG` (4) and `BI_PNG` (5) are unwrapped from the embedded payload |
| Header size | 12 (`BITMAPCOREHEADER`), 40 (`BITMAPINFOHEADER`), 52, 56, 64, 108 (V4), 124 (V5), and no file header at all                                                     |
| Palettes    | 3 bytes per entry for the OS/2 core header, 4 bytes otherwise; a zero alpha byte keeps the colour opaque                                                        |
| Row order   | Bottom-up (the default) and top-down (negative height)                                                                                                          |
| Alpha       | Bit masks when declared; otherwise an all-zero alpha channel on a 32-bit image is treated as opaque                                                             |
| Byte order  | Little-endian, as the format specifies                                                                                                                          |

Guard rails: a file larger than 64 Mi pixels (or a canvas that would need more than that) is rejected before allocation, every row read is bounds-checked, and RLE streams stop at `EOF`, `delta` or the end of the buffer.

## What is not supported, and why

- **TIFF.** Chromium ships no TIFF codec. A baseline decoder (uncompressed, PackBits, LZW; 8-bit grey/RGB/palette) is feasible without dependencies, but it has not been written, so TIFF is detected and passed through to fail exactly as it did without the plugin. This is the most likely next format.
- **HEIC / HEIF.** Decoding requires an HEVC decoder. Bundling one as wasm would multiply the plugin size and break the "one script, no network, no third-party decoder" property, so HEIC is detected and left alone by design. iPhone photos pasted from the Files app or dragged in as `.heic` will keep failing.
- **`BI_CMYK` BMPs (compression 11/12/13).** CMYK bitmaps are rare outside print pipelines. `parseBmp()` refuses them explicitly (`bmp: unsupported compression 11`) rather than guessing channel order, so the original is kept and the log says why.
- **2-bit and 64-bit BMPs.** Only ever produced by old OS/2 software and a handful of specialised tools.
- **DIB-only ICO/CUR entries.** Icons whose entries are raw bitmaps rather than PNGs are not re-assembled; the browser may still decode them on its own.
- **JPEG XL, JPEG 2000, PSD, TGA, DDS, OpenEXR, camera RAW.** Not paste formats. Use the file picker once DSH accepts them natively.
- **Animated sources.** A converted image is a single still frame in the selected output format (WebP by default); animation, EXIF and colour profiles are dropped. Native GIF/WebP pass through untouched, so they keep their animation.

## Adding a format

The plugin is deliberately dependency-free, so a new format is either a small parser in `client.js` or a new entry in the browser-decoder path. The checklist:

1. **Sniff it.** Add the magic-byte branch to `sniff()`; put the more specific signatures before the generic ones. If the format has no reliable signature (text-based, like XPM), require a structural check instead of a prefix.
2. **Decode it.** Write a `decode<Format>()` that returns RGBA pixel data for `canvasOf()`, or return a drawable image for the `<img>` path. Validate every length before reading, cap the pixel count with `MAX_PIXELS`, and throw a short `format: reason` error on anything unexpected.
3. **Route it.** Add the type to `toCanvas()` (or to `NATIVE_TYPES` if it should pass through) and, if it is not a native type, to the extension list in `IMAGE_EXT`.
4. **Test it.** Extend `tests/helpers/dom.mjs` with a builder if the bytes are non-trivial, and add cases to `tests/client.test.mjs` for: sniffing, the happy path, a truncated file, and the "declared type lies" case.
5. **Document it.** Update the matrix above, the table and limitations in `README.md` and every translation, and the `Pass-through` paragraph if the rules changed.
6. **Release-note it.** Add an entry under `[Unreleased]` in `CHANGELOG.md`; the maintainer folds it into the next version.

Run `npm test`, `npm run check` and `npm run format:check` before opening the pull request; `CONTRIBUTING.md` has the full workflow.
