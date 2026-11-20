# How it works

This document walks through `client.js` top to bottom. Line references point into the current file; the code map at the end is a quick index.

```text
paste / drop (capture phase)
        |
        v
  handle(event, data)
        |  no files, > 8 files, or no image candidate -> return, native path
        |  preventDefault() + stopPropagation()
        v
  for each candidate file -> normalize(file)
        |
        | sniff(bytes) -> kind
        | native kind and the declaration agrees -> null (keep the file untouched)
        | declared type is empty      -> retype the File, no re-encode
        v
  toCanvas()
        | XPM                 -> decodeXpm()
        | SVG                 -> loadSvg() + <img> rasterisation
        | BMP / DIB           -> createImageBitmap(), fallback decodeBmp()
        |                        (embedded JPEG/PNG payloads are unwrapped first)
        | ICO / CUR           -> createImageBitmap(), fallback to the largest PNG entry
        | everything else     -> createImageBitmap()
        v
  canvasOf()   longest side clamped to 4096
        v
  toPngBlob()  canvas.toBlob('image/png')
        v
  new File(name.png, image/png)
        |
        v
  reroute(files) -> synthetic DragEvent('drop') on [data-composer-card]
```

## 1. Capture phase

[`install()`](../../client.js#L669-L679) adds two listeners on `document`:

```js
document.addEventListener(
  'paste',
  function (event) {
    void handle(event, event.clipboardData)
  },
  true,
)
document.addEventListener(
  'drop',
  function (event) {
    void handle(event, event.dataTransfer)
  },
  true,
)
```

The `true` flag is the whole point: capture runs from `document` down to the target, so the plugin sees the event before the composer's own bubble-phase handler. If the plugin converted the file, it can therefore `preventDefault()` before the composer ever reads `clipboardData`.

## 2. Guards and dispatch

[`handle()`](../../client.js#L631-L667) is the dispatcher. It bails out early in three cases:

- `event[REROUTED]` is set ([line 23](../../client.js#L23)); if it is set, the plugin returns immediately. Without this flag the plugin's own capture listener would see its synthetic event and recurse.
- The batch has zero files or more than `MAX_FILES = 8` files ([line 21](../../client.js#L22)). The check happens _before_ `preventDefault()`, so a batch of nine images is left entirely to the native path instead of being partially converted.
- No file is an image candidate ([`isImageCandidate()`](../../client.js#L610-L615)): the declared type must start with `image/`, or the name must end in one of the extensions in [`IMAGE_EXT`](../../client.js#L19). A plain-text paste never matches, so it is never touched.

Each candidate is converted inside its own `try/catch`; failures keep the original file (see [section 11](#11-failure-handling-and-logging)).

## 3. Magic-byte detection

[`sniff()`](../../client.js#L72-L106) reads the first bytes of the file and returns a MIME-like string, or `null` when it does not recognize the format:

| Signature                                                          | Result         |
| ------------------------------------------------------------------ | -------------- |
| `89 50 4E 47 0D 0A 1A 0A`                                          | `image/png`    |
| `FF D8 FF`                                                         | `image/jpeg`   |
| `GIF` at offset 0                                                  | `image/gif`    |
| `RIFF` at 0 and `WEBP` at 8                                        | `image/webp`   |
| `BM`                                                               | `image/bmp`    |
| A `BITMAP*HEADER` size at offset 0 with plausible width/height/bpp | `image/bmp`    |
| `II 2A 00` or `MM 00 2A` (little/big-endian TIFF)                  | `image/tiff`   |
| `/* XPM */` at offset 0, case-insensitive                          | `image/xpm`    |
| `ftyp` at 4 and an `avif`/`avis` brand at 8                        | `image/avif`   |
| `ftyp` at 4 and a HEIC/HEIF brand at 8                             | `image/heic`   |
| `00 00 01 00` (icon) or `00 00 02 00` (cursor)                     | `image/x-icon` |
| A leading `<` with `<svg` inside the first 1 KiB                   | `image/svg`    |

The headerless-DIB row is the shape Windows code sees as `CF_DIB`: a bare `BITMAPINFOHEADER` (or OS/2 core header) with no 14-byte `BITMAPFILEHEADER` in front. [`dibHeaderSize()`](../../client.js#L43-L63) validates the header size against `BMP_HEADERS`, the width/height sign and the bit depth before letting it through, so random binaries that happen to start with `0x28` are not classified as images.

The helpers are deliberately tiny: [`ascii()`](../../client.js#L28-L32) turns a byte range into a string for the text signatures, [`unit32()`](../../client.js#L34-L36) reads a little-endian `uint32` for the DIB probe, and the rest are direct comparisons.

## 4. The pass-through rule

[`normalize()`](../../client.js#L581-L606) is where the decision is made:

```js
var kind = sniff(bytes)
var declared = aliasMime((file.type || '').toLowerCase())
if (kind && NATIVE_SET.has(kind)) {
  if (declared === kind) return null
  if (!declared) {
    return {
      file: new File([bytes], fileName(file, NATIVE_EXT[kind]), { type: kind }),
      from: '(no type)',
      to: kind,
      width: 0,
      height: 0,
    }
  }
}
```

Returning `null` means "no conversion"; `handle()` keeps the original `File`. This is why a real screenshot keeps its exact bytes, metadata and animation: PNG, JPEG, WebP and GIF are never re-encoded when the declaration matches.

Two details are new in 0.2.0:

- **MIME aliases.** [`aliasMime()`](../../client.js#L38-L40) maps the spellings applications actually emit onto the canonical type — `image/jpg`, `image/pjpeg`, `image/x-png`, `image/x-bmp`, `image/x-ms-bmp`, `image/vnd.microsoft.icon`, `image/x-xpixmap`, `image/xpm`, `image/svg+xml`. Without it, a perfectly good `image/jpg` JPEG would be decoded and re-encoded for nothing.
- **Missing declaration.** A `File` with an empty `type` used to be passed through unchanged, and the host then rejected it because the whitelist follows the label. Now the bytes are re-wrapped in a `File` that carries the sniffed type, so the file is accepted without a re-encode.

The declared type only has veto power here. A file whose bytes are JPEG but which claims `image/png` fails the `declared === kind` test, so it is converted into a real PNG. Likewise a BMP declared as PNG is converted, because the host's whitelist and the host's decoder both follow the label.

When a conversion happens, the file name is rebuilt: the last extension is replaced with `.png`, so `shot.xpm` becomes `shot.png`, and `wechat.png` (which actually contained BMP bytes) stays `wechat.png`. A retyped native file keeps its own extension instead (`.jpg` for JPEG, `.webp`, `.gif`).

## 5. Decoding

[`toCanvas()`](../../client.js#L545-L574) picks the decoding route:

- `image/xpm` goes straight to [`decodeXpm()`](../../client.js#L144-L185), because no browser decodes XPM.
- `image/svg` goes to [`loadSvg()`](../../client.js#L475-L498), which loads the markup through an `<img>` element and draws the intrinsic size onto a canvas. Chromium does not implement `createImageBitmap()` for SVG blobs, so this is the only route that works in every Chromium build.
- Everything else is handed to `createImageBitmap(new Blob([bytes], { type }))`, where `type` is the sniffed format when known, otherwise the declared type (after alias mapping), otherwise `application/octet-stream`. Using the sniffed format is what makes a mislabelled BMP decode correctly: the blob is re-typed from the bytes.
- If `createImageBitmap` rejects and the sniffed format is BMP, the plugin first checks for an **embedded** JPEG or PNG payload (compression `BI_JPEG`/`BI_PNG`) and decodes that; if there is none, [`decodeBmp()`](../../client.js#L346-L445) runs as a fallback.
- If `createImageBitmap` rejects and the sniffed format is `image/x-icon`, [`icoPngEntry()`](../../client.js#L500-L522) picks the largest PNG-compressed entry out of the icon directory and decodes that. DIB-only icons stay unsupported.
- Any other decode error is rethrown. `handle()` catches it, keeps the original file and logs the reason.

[`canvasOf()`](../../client.js#L526-L535) then normalizes the size: `scale = min(1, MAX_SIDE / max(width, height))` with `MAX_SIDE = 4096` ([line 20](../../client.js#L21)), dimensions rounded and never below 1, and the source drawn into the scaled canvas. Small images pass through unscaled.

[`toPngBlob()`](../../client.js#L537-L543) wraps `canvas.toBlob(callback, 'image/png')` in a Promise and rejects when the callback receives `null`. The resulting blob becomes a new in-memory `File`.

## 6. The XPM decoder

XPM is C source text, so [`decodeXpm()`](../../client.js#L144-L185) starts by extracting every double-quoted string with [`xpmStrings()`](../../client.js#L110-L119) and unescaping quotes, backslashes, newlines and tabs. A leading UTF-8 BOM is stripped first.

The first string is the header: `width height ncolors chars-per-pixel`. The width, height and colour count must all be positive; `chars-per-pixel` defaults to 1 when omitted. A header larger than `MAX_PIXELS` pixels is rejected before any buffer is allocated.

The next `ncolors` strings are the palette. Each line begins with the pixel key (the first `chars-per-pixel` characters); the rest is scanned for a `c` colour specification. The extractor accepts one or two whitespace-separated tokens, which is enough for `#RRGGBB` and for names that contain a space. [`resolveColor()`](../../client.js#L121-L142) then resolves the value with a 1×1 canvas: it assigns the string to `fillStyle`, reads the pixel back through `getImageData()`, and therefore accepts exactly what the browser's CSS colour parser accepts — `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa` and single-word CSS colour names. Palette names that are not also CSS colours, such as the two-word `light gray`, are rejected by `fillStyle` and become opaque black. The literal `None` becomes fully transparent; any other rejected value makes `resolveColor()` return `null`, and that palette entry also falls back to opaque black.

Pixel rows start at `strings[1 + ncolors]`. Each row is sliced into `chars-per-pixel` chunks, looked up in the palette, and written into an `ImageData` buffer. An unknown key or a short row yields transparent pixels.

Not supported: XPM1/XPM2 header layouts, colour keys other than `c` (`m`, `g`, `g4`, `s` are ignored), and palette colour names that are not valid CSS colours — including multi-word names such as `light gray`, which come out black.

## 7. The BMP / DIB decoder

BMP is a family, not a format, so 0.2.0 splits the work in two: [`parseBmp()`](../../client.js#L189-L244) validates the header and computes the layout, and [`decodeBmp()`](../../client.js#L346-L445) turns pixels into RGBA.

`parseBmp()` accepts:

- The 14-byte `BITMAPFILEHEADER` when the file starts with `BM`, or a **headerless DIB** when it does not. For DIBs the pixel offset is derived from the header size, the optional bit masks and the palette size instead of being read from byte 10.
- Header sizes `12` (OS/2 `BITMAPCOREHEADER`), `40` (`BITMAPINFOHEADER`), `52` (`BITMAPV2INFOHEADER`), `56` (`BITMAPV3INFOHEADER`), `64` (OS/2 v2), `108` (`BITMAPV4HEADER`) and `124` (`BITMAPV5HEADER`).
- Bit depths 1, 4, 8, 16, 24 and 32.
- Compression `0` (`BI_RGB`), `1` (`BI_RLE8`), `2` (`BI_RLE4`), `3` (`BI_BITFIELDS`) and `6` (`BI_ALPHABITFIELDS`).
- Bit masks for 16- and 32-bit files, taken from the header for V4/V5 and from the 12 (or 16) bytes after a 40-byte header otherwise. A mask of zero for a `BI_RGB` 16-bit file falls back to the standard RGB555 layout (`0x7C00 / 0x03E0 / 0x001F`).
- A negative height (top-down bitmap); every row loop reads `topDown ? y : height - 1 - y`, including the RLE paths.

`decodeBmp()` then converts:

- **Indexed depths** (`1/4/8`): the palette is read from [`bmpPalette()`](../../client.js#L261-L274), with 3-byte entries for the core header and 4-byte `RGBQUAD` entries otherwise; the alpha byte is only used when non-zero, because most palette BMPs leave it at `0`.
- **16-bit**: each channel is extracted with [`maskValue()`](../../client.js#L255-L259) and scaled to 0–255.
- **24-bit**: BGR channels with the standard `floor((bpp * width + 31) / 32) * 4` row stride.
- **32-bit**: `BI_RGB` copies `BGRA`; the alpha heuristic below applies. Masked 32-bit uses the `r/g/b` masks and the alpha mask when the file declares one.
- **RLE4 / RLE8**: [`decodeRleBmp()`](../../client.js#L284-L344) walks the opcode stream — encoded runs, absolute mode with word padding, `delta`, end-of-line and end-of-bitmap — and writes through [`putIndexed()`](../../client.js#L276-L282) with the same bottom-up mapping as the uncompressed paths.
- **Embedded payloads** (`BI_JPEG`/`BI_PNG`): [`bmpEmbedded()`](../../client.js#L447-L461) extracts the payload and lets the browser decode it.

Two guards keep a malformed file from taking the renderer down: any image wider than `MAX_PIXELS = 64 Mi pixels` total is rejected before allocation, and every row read checks the file length before touching bytes.

The 32-bit alpha heuristic closes a long-standing footgun: when **every** pixel's fourth byte is zero, the plugin treats the bitmap as opaque instead of exporting a fully transparent PNG. Files that do carry alpha (some pixels non-zero) keep it.

## 8. SVG and icon fallbacks

[`loadSvg()`](../../client.js#L475-L498) decodes the blob as UTF-8, wraps it in an object URL and waits for an `Image` to load. [`svgSize()`](../../client.js#L465-L473) provides the intrinsic size — `<svg width="…" height="…">` first, `viewBox` as a fallback, `300×150` as the last resort — so an SVG that only carries a `viewBox` does not collapse to the browser's default box. The object URL is revoked on both the success and the failure path.

[`icoPngEntry()`](../../client.js#L500-L522) reads the icon directory, filters to entries whose payload sniffed as PNG, and keeps the largest one by declared area. Cursors (`type = 2`) and DIB-only icons return `null`; the original error is then rethrown and the file is passed through.

## 9. Size clamp and PNG export

[`canvasOf()`](../../client.js#L526-L535) accepts an optional explicit size, because an `ImageBitmap` exposes `width`/`height` while an `HTMLImageElement` exposes `naturalWidth`/`naturalHeight`. Everything else is the same clamp as before.

## 10. Rerouting

[`reroute()`](../../client.js#L621-L629) builds the bridge back into the composer:

```js
var dt = new DataTransfer()
files.forEach(function (file) {
  dt.items.add(file)
})
var event = new DragEvent('drop', { bubbles: true, cancelable: true, composed: true, dataTransfer: dt })
Object.defineProperty(event, REROUTED, { value: true })
composer().dispatchEvent(event)
```

[`composer()`](../../client.js#L617-L619) resolves `document.querySelector('[data-composer-card]')` and falls back to `document.body`. Dispatching a real `drop` event means the plugin does not need to know any private composer API: it reuses the same attachment path as a manual drag-and-drop. The `REROUTED` property is defined non-enumerably so it does not leak into anything that inspects the event.

## 11. Failure handling and logging

Conversion runs per file inside a `try/catch` ([`handle()`, lines 631–667](../../client.js#L631-L667)). On success the plugin logs:

```text
[dsh-paste-image] image/xpm -> image/png 1440x900
[dsh-paste-image] (no type) -> image/png
```

The left side is the declared type, or `(no type)` when the `File` had none. On failure it logs:

```text
[dsh-paste-image] keep original (image/bmp): bmp: unsupported bpp 2
```

and pushes the original `File` into the outgoing batch. One bad file never blocks the others, and the synthetic drop still happens — which is why a failed conversion ends with the host's original red error rather than silence. Both messages use `console.debug`, so the browser console must be set to the Verbose level to show them.

## 12. Module registration

The file is a classic script wrapped in an IIFE. At the bottom ([lines 696–711](../../client.js#L696-L711)) it registers itself with the DSH client module loader:

```js
window.__ModuleLoader__.load({
  id: 'dsh-paste-image',
  factory: function () {
    return {
      apply: function (ctx) {
        if (ctx && typeof ctx.effect === 'function') {
          ctx.effect(install, 'paste-image')
          return
        }
        install()
      },
    }
  },
})
```

`ctx.effect(install, 'paste-image')` ties the installation to the plugin's effect scope and names it for diagnostics. The fallback `install()` keeps the module usable in environments without an effect scope. In a Node test there is no `window`, so the registration block is skipped and the file exports [`api`](../../client.js#L701-L711) through `module.exports` for the test suite.

## Code map

| Concern                   | Function / entry        | Location                                   |
| ------------------------- | ----------------------- | ------------------------------------------ |
| Format signatures         | `sniff()`               | [client.js:72](../../client.js#L72-L106)   |
| DIB header probe          | `dibHeaderSize()`       | [client.js:43](../../client.js#L43-L63)    |
| SVG head probe            | `looksLikeSvg()`        | [client.js:65](../../client.js#L65-L70)    |
| Byte-to-string helper     | `ascii()`               | [client.js:28](../../client.js#L28-L32)    |
| MIME alias table          | `aliasMime()`           | [client.js:38](../../client.js#L38-L40)    |
| XPM string extraction     | `xpmStrings()`          | [client.js:110](../../client.js#L110-L119) |
| CSS colour resolution     | `resolveColor()`        | [client.js:121](../../client.js#L121-L142) |
| XPM decoding              | `decodeXpm()`           | [client.js:144](../../client.js#L144-L185) |
| BMP header parsing        | `parseBmp()`            | [client.js:189](../../client.js#L189-L244) |
| Bit-mask channels         | `maskChannel()`         | [client.js:246](../../client.js#L246-L253) |
| Palette loading           | `bmpPalette()`          | [client.js:261](../../client.js#L261-L274) |
| RLE4 / RLE8 decoding      | `decodeRleBmp()`        | [client.js:284](../../client.js#L284-L344) |
| BMP pixel decoding        | `decodeBmp()`           | [client.js:346](../../client.js#L346-L445) |
| Embedded JPEG/PNG payload | `bmpEmbedded()`         | [client.js:447](../../client.js#L447-L461) |
| SVG size / rasterisation  | `loadSvg()`             | [client.js:475](../../client.js#L475-L498) |
| PNG entry inside an icon  | `icoPngEntry()`         | [client.js:500](../../client.js#L500-L522) |
| Size clamp                | `canvasOf()`            | [client.js:526](../../client.js#L526-L535) |
| PNG export                | `toPngBlob()`           | [client.js:537](../../client.js#L537-L543) |
| Decode routing            | `toCanvas()`            | [client.js:545](../../client.js#L545-L574) |
| Pass-through / conversion | `normalize()`           | [client.js:581](../../client.js#L581-L606) |
| Candidate test            | `isImageCandidate()`    | [client.js:610](../../client.js#L610-L615) |
| Composer target           | `composer()`            | [client.js:617](../../client.js#L617-L619) |
| Synthetic drop            | `reroute()`             | [client.js:621](../../client.js#L621-L629) |
| Guards and dispatch       | `handle()`              | [client.js:631](../../client.js#L631-L667) |
| Event listeners           | `install()`             | [client.js:669](../../client.js#L669-L679) |
| Module entry              | `__ModuleLoader__.load` | [client.js:696](../../client.js#L696-L711) |

## Design notes

- **Bytes over labels.** MIME types are supplied by the source application; magic bytes are supplied by the image encoder. Trusting the bytes is the only way to handle both "unsupported but honest" and "supported but lying".
- **Capture and synchronous cancel.** The composer must never see the raw unsupported file, and `preventDefault()` is only effective while the event is being dispatched.
- **PNG as the output.** It is on the whitelist, lossless for the pixels that were decoded, and every Chromium build can encode it through `canvas.toBlob`.
- **Synthetic drop instead of a private API.** Reusing the native drop path keeps the plugin compatible with composer changes that do not touch `[data-composer-card]`.
- **No host process.** A paste is a UI event. A renderer listener is enough; a host-side clipboard daemon would add a process, permissions and polling for no benefit.
- **No third-party decoder.** TIFF and HEIC are detected but not decoded: shipping a codec would either bloat the single script the module loader injects or add a runtime fetch to a plugin that is otherwise offline-only. BMP, XPM and SVG cover the formats this plugin was written for, and the browser keeps covering the rest.
