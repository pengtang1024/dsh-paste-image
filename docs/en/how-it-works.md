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

[`install()`](../../client.js#L769-L802) adds two listeners on `document`:

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

[`handle()`](../../client.js#L729-L767) is the dispatcher. It bails out early in the following cases:

- `event[REROUTED]` is set ([line 25](../../client.js#L25)); if it is set, the plugin returns immediately. Without this flag the plugin's own capture listener would see its synthetic event and recurse.
- The batch has zero files or more than `MAX_FILES = 8` files ([line 21](../../client.js#L21)). The check happens _before_ `preventDefault()`, so a batch of nine images is left entirely to the native path instead of being partially converted.
- No file is an image candidate ([`isImageCandidate()`](../../client.js#L692-L697)): the declared type must start with `image/`, or the name must end in one of the extensions in [`IMAGE_EXT`](../../client.js#L19). A plain-text paste never matches, so it is never touched.
- The `DataTransfer`/`DragEvent` constructors are missing ([`canReroute()`](../../client.js#L705-L707)): the plugin cannot hand the files back to the composer, so it lets go entirely and the browser's native paste/drop path keeps running — no event is swallowed by something that cannot take over.

Each candidate is converted inside its own `try/catch`; failures keep the original file (see [section 11](#11-failure-handling-and-logging)).

## 3. Magic-byte detection

[`sniff()`](../../client.js#L77-L111) reads the first bytes of the file and returns a MIME-like string, or `null` when it does not recognize the format:

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

The headerless-DIB row is the shape Windows code sees as `CF_DIB`: a bare `BITMAPINFOHEADER` (or OS/2 core header) with no 14-byte `BITMAPFILEHEADER` in front. [`dibHeaderSize()`](../../client.js#L48-L68) validates the header size against `BMP_HEADERS`, the width/height sign and the bit depth before letting it through, so random binaries that happen to start with `0x28` are not classified as images.

The helpers are deliberately tiny: [`ascii()`](../../client.js#L33-L37) turns a byte range into a string for the text signatures, [`unit32()`](../../client.js#L39-L41) reads a little-endian `uint32` for the DIB probe, and the rest are direct comparisons.

## 4. The pass-through rule

[`normalize()`](../../client.js#L654-L688) is where the decision is made. It reads only the file header first, then decides whether the whole file is needed:

```js
var declared = aliasMime((file.type || '').toLowerCase())
var head = await readHead(file)
var kind = head ? sniff(head.bytes) : null
// native type and agreeing declaration: pass through, a 1 KiB header is enough
if (head && kind && NATIVE_SET.has(kind) && declared === kind) return null
var bytes
if (head && head.whole) {
  bytes = head.bytes
} else {
  bytes = new Uint8Array(await file.arrayBuffer())
  kind = sniff(bytes)
}
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

[`readHead()`](../../client.js#L647-L652) takes only the first `HEAD_PROBE = 1024` bytes through `file.slice(0, HEAD_PROBE)` ([line 24](../../client.js#L24)). A native file whose declared type agrees with the sniffed type returns `null` right there, and the whole file never enters memory — which is why the 20 MiB PNG pass-through went from about 3.8–3.9 ms/op with 20,971,520 bytes read in full to about 0.0038–0.0063 ms/op with 0 bytes read in full. Only two situations go on to call `file.arrayBuffer()` for the full contents: the declared type is empty and the bytes must be re-wrapped in a `File` carrying the sniffed type, or the sniffed type is not native and the image must be decoded and converted. When the file is smaller than 1 KiB, the header is the whole file and is reused instead of read twice; a File-like object without `slice()`/`size` yields `null` and falls back to the full read.

Returning `null` means "no conversion"; `handle()` keeps the original `File`. This is why a real screenshot keeps its exact bytes, metadata and animation: PNG, JPEG, WebP and GIF are never re-encoded when the declaration matches.

Two details are new in 0.2.0:

- **MIME aliases.** [`aliasMime()`](../../client.js#L43-L45) maps the spellings applications actually emit onto the canonical type — `image/jpg`, `image/pjpeg`, `image/x-png`, `image/x-bmp`, `image/x-ms-bmp`, `image/vnd.microsoft.icon`, `image/x-xpixmap`, `image/xpm`, `image/svg+xml`. Without it, a perfectly good `image/jpg` JPEG would be decoded and re-encoded for nothing.
- **Missing declaration.** A `File` with an empty `type` used to be passed through unchanged, and the host then rejected it because the whitelist follows the label. Now the bytes are re-wrapped in a `File` that carries the sniffed type, so the file is accepted without a re-encode.

The declared type only has veto power here. A file whose bytes are JPEG but which claims `image/png` fails the `declared === kind` test, so it is converted into a real PNG. Likewise a BMP declared as PNG is converted, because the host's whitelist and the host's decoder both follow the label.

When a conversion happens, the file name is rebuilt: the last extension is replaced with `.png`, so `shot.xpm` becomes `shot.png`, and `wechat.png` (which actually contained BMP bytes) stays `wechat.png`. A retyped native file keeps its own extension instead (`.jpg` for JPEG, `.webp`, `.gif`).

## 5. Decoding

[`toCanvas()`](../../client.js#L609-L638) picks the decoding route:

- `image/xpm` goes straight to [`decodeXpm()`](../../client.js#L158-L204), because no browser decodes XPM.
- `image/svg` goes to [`loadSvg()`](../../client.js#L496-L519), which loads the markup through an `<img>` element and draws the intrinsic size onto a canvas. Chromium does not implement `createImageBitmap()` for SVG blobs, so this is the only route that works in every Chromium build.
- Everything else is handed to `createImageBitmap(new Blob([bytes], { type }))`, where `type` is the sniffed format when known, otherwise the declared type (after alias mapping), otherwise `application/octet-stream`. Using the sniffed format is what makes a mislabelled BMP decode correctly: the blob is re-typed from the bytes.
- If `createImageBitmap` rejects and the sniffed format is BMP, the plugin first checks for an **embedded** JPEG or PNG payload (compression `BI_JPEG`/`BI_PNG`) and decodes that; if there is none, [`decodeBmp()`](../../client.js#L367-L466) runs as a fallback.
- If `createImageBitmap` rejects and the sniffed format is `image/x-icon`, [`icoPngEntry()`](../../client.js#L521-L543) picks the largest PNG-compressed entry out of the icon directory and decodes that. DIB-only icons stay unsupported.
- Any other decode error is rethrown. `handle()` catches it, keeps the original file and logs the reason.

[`canvasOf()`](../../client.js#L547-L556) then normalizes the size: `scale = min(1, MAX_SIDE / max(width, height))` with `MAX_SIDE = 4096` ([line 20](../../client.js#L20)), dimensions rounded and never below 1, and the source drawn into the scaled canvas. Small images pass through unscaled.

[`toPngBlob()`](../../client.js#L593-L607) wraps `canvas.toBlob(callback, 'image/png')` in a Promise and rejects when the callback receives `null`. The resulting blob becomes a new in-memory `File`.

## 6. The XPM decoder

XPM is C source text, so [`decodeXpm()`](../../client.js#L158-L204) starts by extracting every double-quoted string with [`xpmStrings()`](../../client.js#L115-L123) and unescaping quotes, backslashes, newlines and tabs. A leading UTF-8 BOM is stripped first.

The first string is the header: `width height ncolors chars-per-pixel`. The width, height and colour count must all be positive; `chars-per-pixel` defaults to 1 when omitted. A header larger than `MAX_PIXELS` pixels is rejected before any buffer is allocated.

The next `ncolors` strings are the palette. Each line begins with the pixel key (the first `chars-per-pixel` characters); the rest is scanned for a `c` colour specification. The extractor accepts one or two whitespace-separated tokens, which is enough for `#RRGGBB` and for names that contain a space. [`resolveColor()`](../../client.js#L138-L156) then resolves the value with a 1×1 canvas: it assigns the string to `fillStyle`, reads the pixel back through `getImageData()`, and therefore accepts exactly what the browser's CSS colour parser accepts — `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa` and single-word CSS colour names. Palette names that are not also CSS colours, such as the two-word `light gray`, are rejected by `fillStyle` and become opaque black. The literal `None` becomes fully transparent; any other rejected value makes `resolveColor()` return `null`, and that palette entry also falls back to opaque black.

Pixel rows start at `strings[1 + ncolors]`. Each row is sliced into `chars-per-pixel` chunks, looked up in the palette, and written into an `ImageData` buffer. An unknown key or a short row yields transparent pixels.

Not supported: XPM1/XPM2 header layouts, colour keys other than `c` (`m`, `g`, `g4`, `s` are ignored), and palette colour names that are not valid CSS colours — including multi-word names such as `light gray`, which come out black.

## 7. The BMP / DIB decoder

BMP is a family, not a format, so 0.2.0 splits the work in two: [`parseBmp()`](../../client.js#L208-L265) validates the header and computes the layout, and [`decodeBmp()`](../../client.js#L367-L466) turns pixels into RGBA.

`parseBmp()` accepts:

- The 14-byte `BITMAPFILEHEADER` when the file starts with `BM`, or a **headerless DIB** when it does not. For DIBs the pixel offset is derived from the header size, the optional bit masks and the palette size instead of being read from byte 10.
- Header sizes `12` (OS/2 `BITMAPCOREHEADER`), `40` (`BITMAPINFOHEADER`), `52` (`BITMAPV2INFOHEADER`), `56` (`BITMAPV3INFOHEADER`), `64` (OS/2 v2), `108` (`BITMAPV4HEADER`) and `124` (`BITMAPV5HEADER`).
- Bit depths 1, 4, 8, 16, 24 and 32.
- Compression `0` (`BI_RGB`), `1` (`BI_RLE8`), `2` (`BI_RLE4`), `3` (`BI_BITFIELDS`) and `6` (`BI_ALPHABITFIELDS`).
- Bit masks for 16- and 32-bit files, taken from the header for V4/V5 and from the 12 (or 16) bytes after a 40-byte header otherwise. A mask of zero for a `BI_RGB` 16-bit file falls back to the standard RGB555 layout (`0x7C00 / 0x03E0 / 0x001F`).
- A negative height (top-down bitmap); every row loop reads `topDown ? y : height - 1 - y`, including the RLE paths.

`decodeBmp()` then converts:

- **Indexed depths** (`1/4/8`): the palette is read from [`bmpPalette()`](../../client.js#L282-L295), with 3-byte entries for the core header and 4-byte `RGBQUAD` entries otherwise; the alpha byte is only used when non-zero, because most palette BMPs leave it at `0`.
- **16-bit**: each channel is extracted with [`maskValue()`](../../client.js#L276-L280) and scaled to 0–255.
- **24-bit**: BGR channels with the standard `floor((bpp * width + 31) / 32) * 4` row stride.
- **32-bit**: `BI_RGB` copies `BGRA`; the alpha heuristic below applies. Masked 32-bit uses the `r/g/b` masks and the alpha mask when the file declares one.
- **RLE4 / RLE8**: [`decodeRleBmp()`](../../client.js#L305-L365) walks the opcode stream — encoded runs, absolute mode with word padding, `delta`, end-of-line and end-of-bitmap — and writes through [`putIndexed()`](../../client.js#L297-L303) with the same bottom-up mapping as the uncompressed paths.
- **Embedded payloads** (`BI_JPEG`/`BI_PNG`): [`bmpEmbedded()`](../../client.js#L468-L482) extracts the payload and lets the browser decode it.

Two guards keep a malformed file from taking the renderer down: any image wider than `MAX_PIXELS = 64 Mi pixels` total is rejected before allocation, and every row read checks the file length before touching bytes.

The 32-bit alpha heuristic closes a long-standing footgun: when **every** pixel's fourth byte is zero, the plugin treats the bitmap as opaque instead of exporting a fully transparent PNG. Files that do carry alpha (some pixels non-zero) keep it.

## 8. SVG and icon fallbacks

[`loadSvg()`](../../client.js#L496-L519) decodes the blob as UTF-8, wraps it in an object URL and waits for an `Image` to load. [`svgSize()`](../../client.js#L486-L494) provides the intrinsic size — `<svg width="…" height="…">` first, `viewBox` as a fallback, `300×150` as the last resort — so an SVG that only carries a `viewBox` does not collapse to the browser's default box. The object URL is revoked on both the success and the failure path.

[`icoPngEntry()`](../../client.js#L521-L543) reads the icon directory, filters to entries whose payload sniffed as PNG, and keeps the largest one by declared area. Cursors (`type = 2`) and DIB-only icons return `null`; the original error is then rethrown and the file is passed through.

## 9. Size clamp and PNG export

[`canvasOf()`](../../client.js#L547-L556) accepts an optional explicit size, because an `ImageBitmap` exposes `width`/`height` while an `HTMLImageElement` exposes `naturalWidth`/`naturalHeight`. Everything else is the same clamp as before.

## 10. Rerouting

[`reroute()`](../../client.js#L709-L717) builds the bridge back into the composer:

```js
var dt = new DataTransfer()
files.forEach(function (file) {
  dt.items.add(file)
})
var event = new DragEvent('drop', { bubbles: true, cancelable: true, composed: true, dataTransfer: dt })
Object.defineProperty(event, REROUTED, { value: true })
composer().dispatchEvent(event)
```

[`composer()`](../../client.js#L699-L701) resolves `document.querySelector('[data-composer-card]')` and falls back to `document.body`. Dispatching a real `drop` event means the plugin does not need to know any private composer API: it reuses the same attachment path as a manual drag-and-drop. The `REROUTED` property is defined non-enumerably so it does not leak into anything that inspects the event.

## 11. Failure handling and logging

Conversion runs per file inside a `try/catch` ([`handle()`, lines 729–767](../../client.js#L729-L767)). On success the plugin logs:

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

The file is a classic script wrapped in an IIFE. At the bottom ([lines 813–828](../../client.js#L813-L828)) it registers itself with the DSH client module loader:

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

`ctx.effect(install, 'paste-image')` ties the installation to the plugin's effect scope and names it for diagnostics. The fallback `install()` keeps the module usable in environments without an effect scope. In a Node test there is no `window`, so the registration block is skipped and the file exports [`api`](../../client.js#L804-L811) through `module.exports` for the test suite.

## Code map

| Concern                   | Function / entry        | Location                                   |
| ------------------------- | ----------------------- | ------------------------------------------ |
| Format signatures         | `sniff()`               | [client.js:77](../../client.js#L77-L111)   |
| DIB header probe          | `dibHeaderSize()`       | [client.js:48](../../client.js#L48-L68)    |
| SVG head probe            | `looksLikeSvg()`        | [client.js:70](../../client.js#L70-L75)    |
| Byte-to-string helper     | `ascii()`               | [client.js:33](../../client.js#L33-L37)    |
| MIME alias table          | `aliasMime()`           | [client.js:43](../../client.js#L43-L45)    |
| XPM string extraction     | `xpmStrings()`          | [client.js:115](../../client.js#L115-L123) |
| CSS colour resolution     | `resolveColor()`        | [client.js:138](../../client.js#L138-L156) |
| XPM decoding              | `decodeXpm()`           | [client.js:158](../../client.js#L158-L204) |
| BMP header parsing        | `parseBmp()`            | [client.js:208](../../client.js#L208-L265) |
| Bit-mask channels         | `maskChannel()`         | [client.js:267](../../client.js#L267-L274) |
| Palette loading           | `bmpPalette()`          | [client.js:282](../../client.js#L282-L295) |
| RLE4 / RLE8 decoding      | `decodeRleBmp()`        | [client.js:305](../../client.js#L305-L365) |
| BMP pixel decoding        | `decodeBmp()`           | [client.js:367](../../client.js#L367-L466) |
| Embedded JPEG/PNG payload | `bmpEmbedded()`         | [client.js:468](../../client.js#L468-L482) |
| SVG size / rasterisation  | `loadSvg()`             | [client.js:496](../../client.js#L496-L519) |
| PNG entry inside an icon  | `icoPngEntry()`         | [client.js:521](../../client.js#L521-L543) |
| Size clamp                | `canvasOf()`            | [client.js:547](../../client.js#L547-L556) |
| PNG export                | `toPngBlob()`           | [client.js:593](../../client.js#L593-L607) |
| Decode routing            | `toCanvas()`            | [client.js:609](../../client.js#L609-L638) |
| Pass-through / conversion | `normalize()`           | [client.js:654](../../client.js#L654-L688) |
| Candidate test            | `isImageCandidate()`    | [client.js:692](../../client.js#L692-L697) |
| Composer target           | `composer()`            | [client.js:699](../../client.js#L699-L701) |
| Synthetic drop            | `reroute()`             | [client.js:709](../../client.js#L709-L717) |
| Guards and dispatch       | `handle()`              | [client.js:729](../../client.js#L729-L767) |
| Event listeners           | `install()`             | [client.js:769](../../client.js#L769-L802) |
| Module entry              | `__ModuleLoader__.load` | [client.js:813](../../client.js#L813-L828) |

## Design notes

- **Bytes over labels.** MIME types are supplied by the source application; magic bytes are supplied by the image encoder. Trusting the bytes is the only way to handle both "unsupported but honest" and "supported but lying".
- **Capture and synchronous cancel.** The composer must never see the raw unsupported file, and `preventDefault()` is only effective while the event is being dispatched.
- **PNG as the output.** It is on the whitelist, lossless for the pixels that were decoded, and every Chromium build can encode it through `canvas.toBlob`.
- **Synthetic drop instead of a private API.** Reusing the native drop path keeps the plugin compatible with composer changes that do not touch `[data-composer-card]`.
- **No host process.** A paste is a UI event. A renderer listener is enough; a host-side clipboard daemon would add a process, permissions and polling for no benefit.
- **No third-party decoder.** TIFF and HEIC are detected but not decoded: shipping a codec would either bloat the single script the module loader injects or add a runtime fetch to a plugin that is otherwise offline-only. BMP, XPM and SVG cover the formats this plugin was written for, and the browser keeps covering the rest.
