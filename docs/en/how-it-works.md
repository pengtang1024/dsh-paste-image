# How it works

This document walks through `client.js` top to bottom. Line references point into the current file; the code map at the end is a quick index.

```text
paste / drop (capture phase)
        |
        v
  handle(event, data)
        |  no files, > settings.maxFiles files, or no image candidate -> return, native path
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
  encodeCanvas()  canvas.toBlob(profile.mime[, quality])
        v
  new File(name.<ext>, encodedMime(blob.type))
        |
        v
  reroute(files) -> synthetic DragEvent('drop') on [data-composer-card]
```

## 1. Capture phase

[`install()`](../../client.js#L912-L945) adds two listeners on `document`:

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

[`handle()`](../../client.js#L869-L910) is the dispatcher. It bails out early in the following cases:

- The master switch is off (`settings.enabled === false`, [line 871](../../client.js#L871)): return immediately; the listener is never torn down, so saving the settings re-enables conversion.
- `event[REROUTED]` is set ([line 136](../../client.js#L136)); if it is set, the plugin returns immediately. Without this flag the plugin's own capture listener would see its synthetic event and recurse.
- The batch has zero files or more than `settings.maxFiles` files (default 8, [`handle()` line 875](../../client.js#L875); the settings page allows 1–8). The check happens _before_ `preventDefault()`, so a batch of nine images is left entirely to the native path instead of being partially converted.
- No file is an image candidate ([`isImageCandidate()`](../../client.js#L832-L837)): the declared type must start with `image/`, or the name must end in one of the extensions in [`IMAGE_EXT`](../../client.js#L26). A plain-text paste never matches, so it is never touched.
- The `DataTransfer`/`DragEvent` constructors are missing ([`canReroute()`](../../client.js#L845-L847)): the plugin cannot hand the files back to the composer, so it lets go entirely and the browser's native paste/drop path keeps running — no event is swallowed by something that cannot take over.

Each candidate is converted inside its own `try/catch`; failures keep the original file (see [section 11](#11-failure-handling-and-logging)).

## 3. Magic-byte detection

[`sniff()`](../../client.js#L188-L222) reads the first bytes of the file and returns a MIME-like string, or `null` when it does not recognize the format:

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

The headerless-DIB row is the shape Windows code sees as `CF_DIB`: a bare `BITMAPINFOHEADER` (or OS/2 core header) with no 14-byte `BITMAPFILEHEADER` in front. [`dibHeaderSize()`](../../client.js#L159-L179) validates the header size against `BMP_HEADERS`, the width/height sign and the bit depth before letting it through, so random binaries that happen to start with `0x28` are not classified as images.

The helpers are deliberately tiny: [`ascii()`](../../client.js#L144-L148) turns a byte range into a string for the text signatures, [`unit32()`](../../client.js#L150-L152) reads a little-endian `uint32` for the DIB probe, and the rest are direct comparisons.

## 4. The pass-through rule

[`normalize()`](../../client.js#L788-L828) is where the decision is made. It reads only the file header first, then decides whether the whole file is needed:

```js
var declared = aliasMime((file.type || '').toLowerCase())
var head = await readHead(file)
var kind = head ? sniff(head.bytes) : null
// this format's conversion is off: the header already decides it, so skip the full read
if (kind && !conversionAllowed(kind)) return null
// native type and agreeing declaration: pass through, a 1 KiB header is enough
if (head && kind && NATIVE_SET.has(kind) && declared === kind) return null
var bytes
if (head && head.whole) {
  bytes = head.bytes
} else {
  bytes = new Uint8Array(await file.arrayBuffer())
  kind = sniff(bytes)
}
if (kind && !conversionAllowed(kind)) return null
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

[`readHead()`](../../client.js#L781-L786) takes only the first `HEAD_PROBE = 1024` bytes through `file.slice(0, HEAD_PROBE)` ([line 135](../../client.js#L135)). A native file whose declared type agrees with the sniffed type returns `null` right there, and the whole file never enters memory — which is why the 20 MiB PNG pass-through went from about 3.8–3.9 ms/op with 20,971,520 bytes read in full to about 0.0038–0.0063 ms/op with 0 bytes read in full. Only two situations go on to call `file.arrayBuffer()` for the full contents: the declared type is empty and the bytes must be re-wrapped in a `File` carrying the sniffed type, or the sniffed type is not native and the image must be decoded and converted. When the file is smaller than 1 KiB, the header is the whole file and is reused instead of read twice; a File-like object without `slice()`/`size` yields `null` and falls back to the full read.

Returning `null` means "no conversion"; `handle()` keeps the original `File`. This is why a real screenshot keeps its exact bytes, metadata and animation: PNG, JPEG, WebP and GIF are never re-encoded when the declaration matches.

Two details are new in 0.2.0:

- **MIME aliases.** [`aliasMime()`](../../client.js#L154-L156) maps the spellings applications actually emit onto the canonical type — `image/jpg`, `image/pjpeg`, `image/x-png`, `image/x-bmp`, `image/x-ms-bmp`, `image/vnd.microsoft.icon`, `image/x-xpixmap`, `image/xpm`, `image/svg+xml`. Without it, a perfectly good `image/jpg` JPEG would be decoded and re-encoded for nothing.
- **Missing declaration.** A `File` with an empty `type` used to be passed through unchanged, and the host then rejected it because the whitelist follows the label. Now the bytes are re-wrapped in a `File` that carries the sniffed type, so the file is accepted without a re-encode.

The declared type only has veto power here. A file whose bytes are JPEG but which claims `image/png` fails the `declared === kind` test, so it is converted into the selected output format (PNG by default). Likewise a BMP declared as PNG is converted, because the host's whitelist and the host's decoder both follow the label.

When a conversion happens, the file name is rebuilt: the extension follows the actual encoded type (`.png` by default), so `shot.xpm` becomes `shot.png`, and `wechat.png` (which actually contained BMP bytes) stays `wechat.png`. A retyped native file keeps its own extension instead (`.jpg` for JPEG, `.webp`, `.gif`).

## 5. Decoding

[`toCanvas()`](../../client.js#L743-L772) picks the decoding route:

- `image/xpm` goes straight to [`decodeXpm()`](../../client.js#L269-L315), because no browser decodes XPM.
- `image/svg` goes to [`loadSvg()`](../../client.js#L607-L630), which loads the markup through an `<img>` element and draws the intrinsic size onto a canvas. Chromium does not implement `createImageBitmap()` for SVG blobs, so this is the only route that works in every Chromium build.
- Everything else is handed to `createImageBitmap(new Blob([bytes], { type }))`, where `type` is the sniffed format when known, otherwise the declared type (after alias mapping), otherwise `application/octet-stream`. Using the sniffed format is what makes a mislabelled BMP decode correctly: the blob is re-typed from the bytes.
- If `createImageBitmap` rejects and the sniffed format is BMP, the plugin first checks for an **embedded** JPEG or PNG payload (compression `BI_JPEG`/`BI_PNG`) and decodes that; if there is none, [`decodeBmp()`](../../client.js#L478-L577) runs as a fallback.
- If `createImageBitmap` rejects and the sniffed format is `image/x-icon`, [`icoPngEntry()`](../../client.js#L632-L654) picks the largest PNG-compressed entry out of the icon directory and decodes that. DIB-only icons stay unsupported.
- Any other decode error is rethrown. `handle()` catches it, keeps the original file and logs the reason.

[`canvasOf()`](../../client.js#L658-L667) then normalizes the size: `scale = min(1, settings.maxSide / max(width, height))`, with `settings.maxSide` defaulting to 4096 ([line 36](../../client.js#L36), range 512–8192), dimensions rounded and never below 1, and the source drawn into the scaled canvas. Small images pass through unscaled.

## 6. The XPM decoder

XPM is C source text, so [`decodeXpm()`](../../client.js#L269-L315) starts by extracting every double-quoted string with [`xpmStrings()`](../../client.js#L226-L234) and unescaping quotes, backslashes, newlines and tabs. A leading UTF-8 BOM is stripped first.

The first string is the header: `width height ncolors chars-per-pixel`. The width, height and colour count must all be positive; `chars-per-pixel` defaults to 1 when omitted. A header larger than `MAX_PIXELS` pixels is rejected before any buffer is allocated.

The next `ncolors` strings are the palette. Each line begins with the pixel key (the first `chars-per-pixel` characters); the rest is scanned for a `c` colour specification. The extractor accepts one or two whitespace-separated tokens, which is enough for `#RRGGBB` and for names that contain a space. [`resolveColor()`](../../client.js#L249-L267) then resolves the value with a 1×1 canvas: it assigns the string to `fillStyle`, reads the pixel back through `getImageData()`, and therefore accepts exactly what the browser's CSS colour parser accepts — `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa` and single-word CSS colour names. Palette names that are not also CSS colours, such as the two-word `light gray`, are rejected by `fillStyle` and become opaque black. The literal `None` becomes fully transparent; any other rejected value makes `resolveColor()` return `null`, and that palette entry also falls back to opaque black.

Pixel rows start at `strings[1 + ncolors]`. Each row is sliced into `chars-per-pixel` chunks, looked up in the palette, and written into an `ImageData` buffer. An unknown key or a short row yields transparent pixels.

Not supported: XPM1/XPM2 header layouts, colour keys other than `c` (`m`, `g`, `g4`, `s` are ignored), and palette colour names that are not valid CSS colours — including multi-word names such as `light gray`, which come out black.

## 7. The BMP / DIB decoder

BMP is a family, not a format, so 0.2.0 splits the work in two: [`parseBmp()`](../../client.js#L319-L376) validates the header and computes the layout, and [`decodeBmp()`](../../client.js#L478-L577) turns pixels into RGBA.

`parseBmp()` accepts:

- The 14-byte `BITMAPFILEHEADER` when the file starts with `BM`, or a **headerless DIB** when it does not. For DIBs the pixel offset is derived from the header size, the optional bit masks and the palette size instead of being read from byte 10.
- Header sizes `12` (OS/2 `BITMAPCOREHEADER`), `40` (`BITMAPINFOHEADER`), `52` (`BITMAPV2INFOHEADER`), `56` (`BITMAPV3INFOHEADER`), `64` (OS/2 v2), `108` (`BITMAPV4HEADER`) and `124` (`BITMAPV5HEADER`).
- Bit depths 1, 4, 8, 16, 24 and 32.
- Compression `0` (`BI_RGB`), `1` (`BI_RLE8`), `2` (`BI_RLE4`), `3` (`BI_BITFIELDS`) and `6` (`BI_ALPHABITFIELDS`).
- Bit masks for 16- and 32-bit files, taken from the header for V4/V5 and from the 12 (or 16) bytes after a 40-byte header otherwise. A mask of zero for a `BI_RGB` 16-bit file falls back to the standard RGB555 layout (`0x7C00 / 0x03E0 / 0x001F`).
- A negative height (top-down bitmap); every row loop reads `topDown ? y : height - 1 - y`, including the RLE paths.

`decodeBmp()` then converts:

- **Indexed depths** (`1/4/8`): the palette is read from [`bmpPalette()`](../../client.js#L393-L406), with 3-byte entries for the core header and 4-byte `RGBQUAD` entries otherwise; the alpha byte is only used when non-zero, because most palette BMPs leave it at `0`.
- **16-bit**: each channel is extracted with [`maskValue()`](../../client.js#L387-L391) and scaled to 0–255.
- **24-bit**: BGR channels with the standard `floor((bpp * width + 31) / 32) * 4` row stride.
- **32-bit**: `BI_RGB` copies `BGRA`; the alpha heuristic below applies. Masked 32-bit uses the `r/g/b` masks and the alpha mask when the file declares one.
- **RLE4 / RLE8**: [`decodeRleBmp()`](../../client.js#L416-L476) walks the opcode stream — encoded runs, absolute mode with word padding, `delta`, end-of-line and end-of-bitmap — and writes through [`putIndexed()`](../../client.js#L408-L414) with the same bottom-up mapping as the uncompressed paths.
- **Embedded payloads** (`BI_JPEG`/`BI_PNG`): [`bmpEmbedded()`](../../client.js#L579-L593) extracts the payload and lets the browser decode it.

Two guards keep a malformed file from taking the renderer down: any image wider than `MAX_PIXELS = 64 Mi pixels` total is rejected before allocation, and every row read checks the file length before touching bytes.

The 32-bit alpha heuristic closes a long-standing footgun: when **every** pixel's fourth byte is zero, the plugin treats the bitmap as opaque instead of exporting transparent pixels; PNG output keeps transparency, while JPEG output composites it onto white. Files that do carry alpha (some pixels non-zero) keep it.

## 8. SVG and icon fallbacks

[`loadSvg()`](../../client.js#L607-L630) decodes the blob as UTF-8, wraps it in an object URL and waits for an `Image` to load. [`svgSize()`](../../client.js#L597-L605) provides the intrinsic size — `<svg width="…" height="…">` first, `viewBox` as a fallback, `300×150` as the last resort — so an SVG that only carries a `viewBox` does not collapse to the browser's default box. The object URL is revoked on both the success and the failure path.

[`icoPngEntry()`](../../client.js#L632-L654) reads the icon directory, filters to entries whose payload sniffed as PNG, and keeps the largest one by declared area. Cursors (`type = 2`) and DIB-only icons return `null`; the original error is then rethrown and the file is passed through.

## 9. Size clamp and image encoding

[`canvasOf()`](../../client.js#L658-L667) accepts an optional explicit size, because an `ImageBitmap` exposes `width`/`height` while an `HTMLImageElement` exposes `naturalWidth`/`naturalHeight`. Everything else is the same clamp as before.

[`encodeCanvas()`](../../client.js#L706-L722) is the single encoding entry point: it wraps `canvas.toBlob()` in a Promise, passes only two arguments for PNG, and adds `settings.quality` only for JPEG/WebP. Without `toBlob`, [`dataUrlBlob()`](../../client.js#L694-L702) calls `toDataURL()` with the same MIME and quality and decodes the base64 payload into a `Blob`. The actual encoded type is decided by [`encodedMime()`](../../client.js#L738-L741) from `blob.type`; JPEG flattening and the fallback rules are in [section 13](#13-settings-and-the-configuration-page).

## 10. Rerouting

[`reroute()`](../../client.js#L849-L857) builds the bridge back into the composer:

```js
var dt = new DataTransfer()
files.forEach(function (file) {
  dt.items.add(file)
})
var event = new DragEvent('drop', { bubbles: true, cancelable: true, composed: true, dataTransfer: dt })
Object.defineProperty(event, REROUTED, { value: true })
composer().dispatchEvent(event)
```

[`composer()`](../../client.js#L839-L841) resolves `document.querySelector('[data-composer-card]')` and falls back to `document.body`. Dispatching a real `drop` event means the plugin does not need to know any private composer API: it reuses the same attachment path as a manual drag-and-drop. The `REROUTED` property is defined non-enumerably so it does not leak into anything that inspects the event.

## 11. Failure handling and logging

Conversion runs per file inside a `try/catch` ([`handle()`, lines 869–910](../../client.js#L869-L910)). On success the plugin logs:

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

The file is a classic script wrapped in an IIFE. At the bottom ([lines 959–1271](../../client.js#L959-L1271)) it registers itself with the DSH client module loader:

```js
window.__ModuleLoader__.load({
  id: 'dsh-paste-image',
  factory: function (require) {
    // react is required only inside the factory: Node tests have no window and never reach this.
    // NS / DICTIONARIES / createPage() are defined in the same factory; omitted here.
    var React = null
    try {
      React = require('react')
    } catch (error) {
      React = null
    }
    var Page = React ? createPage() : null
    return {
      inject: ['slots', 'locale'],
      apply: function (ctx) {
        if (!ctx || typeof ctx.effect !== 'function') {
          install()
          return
        }
        ctx.effect(install, 'paste-image')
        if (Page && ctx.locale && typeof ctx.locale.register === 'function') {
          ctx.effect(function () {
            return ctx.locale.register(NS, DICTIONARIES)
          }, 'paste-image: settings dictionaries')
        }
        if (Page && ctx.slots && typeof ctx.slots.inject === 'function' && typeof ctx.slots.register === 'function') {
          ctx.slots.inject('plugins.row.config', function () {
            return ctx.slots.register(
              { name: 'plugins.row.config', key: 'dsh-paste-image#paste-image', locale: NS },
              Page,
            )
          })
        }
      },
    }
  },
})
```

`inject: ['slots', 'locale']` makes Cordis wait for the `slots` and `locale` services before calling `apply`, so the settings page is not skipped. `factory(require)` pulls `react` in only inside the factory, so a Node test without `window` never reaches it and the top level never loads React. `ctx.effect(install, 'paste-image')` ties the installation to the plugin's effect scope and names it for diagnostics; the fallback `install()` keeps the module usable in environments without an effect scope. `ctx.locale.register(NS, DICTIONARIES)` registers the Chinese and English dictionaries, and `ctx.slots.inject('plugins.row.config', ...)` then registers the settings page on the `plugins.row.config` row ([lines 1249–1266](../../client.js#L1249-L1266)). In a Node test there is no `window`, so the whole registration block is skipped and the file exports [`api`](../../client.js#L947-L957) through `module.exports` for the test suite.

## 13. Settings and the configuration page

The runtime settings object sits at the top of the file ([`client.js:29-132`](../../client.js#L29-L132)): `SETTINGS_KEY` is `dsh-paste-image.settings.v1`, `SETTINGS_DEFAULTS` matches the behaviour before this page existed (enabled, at most 8 files, a 4096 px long edge, PNG output, quality 0.92, all four conversion switches on, conversion logging on), `SETTINGS_RANGES` keeps `maxFiles` at 1–8, `maxSide` at 512–8192 and `quality` at 0.1–1 (rounded to two decimals), and `SETTINGS_ENUMS` accepts only `png` / `jpeg` / `webp` for `outputFormat`. The public entry points are `api.getSettings()`, `api.applySettings(patch)` and `api.resetSettings()`: `applySettings()` coerces the boolean switches, normalises or defaults the enum, rounds and clamps the numbers to their ranges, then writes to `localStorage`; when `localStorage` is missing or throws, it keeps an in-memory copy and paste keeps working.

Three consumers each read one slice:

- [`canvasOf()`](../../client.js#L658-L667) uses `settings.maxSide` to compute the scale, which affects converted images only.
- [`normalize()`](../../client.js#L788-L828) checks `conversionAllowed(kind)` as soon as the header has been sniffed; a disabled format returns `null`, the original file is handed to the composer untouched and the full bytes are never read. The BMP-labelled-PNG case goes through the same check, so turning BMP conversion off passes it through as well. When conversion is needed, it picks the output encoding from `settings.outputFormat` and `settings.quality`.
- [`handle()`](../../client.js#L869-L910) checks `settings.enabled` first and returns when it is off; `settings.maxFiles` then decides whether the whole batch goes to the native path, and `settings.logConversions` gates the log lines.

Output encoding is defined by `OUTPUT_FORMATS` ([`client.js:8-12`](../../client.js#L8-L12)): `png` → `image/png` (lossless, no quality argument), `jpeg` → `image/jpeg`, and `webp` → `image/webp`. JPEG has no alpha channel, so `normalize()` first runs [`flattenOnWhite()`](../../client.js#L725-L734) to composite the canvas onto an opaque white background, keeping transparent pixels from turning black; PNG is lossless and WebP keeps transparency. [`encodeCanvas()`](../../client.js#L706-L722) then calls `canvas.toBlob(callback, mime)` — PNG uses two arguments, while JPEG/WebP receive `quality` as the third; without `toBlob`, [`dataUrlBlob()`](../../client.js#L694-L702) goes through `toDataURL()` with the same MIME and quality and decodes the base64 payload.

The final type follows what the browser actually encoded: [`encodedMime()`](../../client.js#L738-L741) reads `blob.type` (after MIME alias mapping), accepts only PNG/JPEG/WebP, and falls back to `image/png` when the type is unrecognised; the file extension also follows the actual MIME. So a browser without the requested encoder yields an image whose label and bytes agree; the actual `blob.type` is authoritative and falls back to PNG when unrecognised, instead of PNG data masquerading as JPEG/WebP.

The page is registered inside the module loader factory: after `ctx.slots.inject('plugins.row.config', ...)` it calls `ctx.slots.register({ name: 'plugins.row.config', key: 'dsh-paste-image#paste-image', locale: 'dsh-paste-image:settings' }, Page)` ([`client.js:1254-1266`](../../client.js#L1254-L1266)). `Page` returns a one-line summary (including the current output format) when `view === 'summary'`; otherwise it renders the form: six checkboxes (enabled, the XPM/BMP-DIB/SVG/ICO-CUR conversion switches, logging), one output-format select (PNG / JPEG / WebP), three number inputs (file count, long edge, quality — 0.1–1 in 0.01 steps, disabled while PNG is selected), Save and Restore defaults. The form draft lives in `React.useState` and only Save calls `applySettings()`; `ctx.locale.register()` registers the Chinese and English dictionaries, and every style uses `--dsw-alias-*` variables. Node tests have no `window`, so the factory never runs and `require('react')` stays inside it instead of loading at the top level.

The measured size impact of these settings is covered in the [output format measurements](output-formats.md): JPEG/WebP shrink photos by about 82%, while UI screenshots are often smaller as PNG.

## Code map

| Concern                   | Function / entry        | Location                                    |
| ------------------------- | ----------------------- | ------------------------------------------- |
| Format signatures         | `sniff()`               | [client.js:188](../../client.js#L188-L222)  |
| DIB header probe          | `dibHeaderSize()`       | [client.js:159](../../client.js#L159-L179)  |
| SVG head probe            | `looksLikeSvg()`        | [client.js:181](../../client.js#L181-L186)  |
| Byte-to-string helper     | `ascii()`               | [client.js:144](../../client.js#L144-L148)  |
| MIME alias table          | `aliasMime()`           | [client.js:154](../../client.js#L154-L156)  |
| XPM string extraction     | `xpmStrings()`          | [client.js:226](../../client.js#L226-L234)  |
| CSS colour resolution     | `resolveColor()`        | [client.js:249](../../client.js#L249-L267)  |
| XPM decoding              | `decodeXpm()`           | [client.js:269](../../client.js#L269-L315)  |
| BMP header parsing        | `parseBmp()`            | [client.js:319](../../client.js#L319-L376)  |
| Bit-mask channels         | `maskChannel()`         | [client.js:378](../../client.js#L378-L385)  |
| Palette loading           | `bmpPalette()`          | [client.js:393](../../client.js#L393-L406)  |
| RLE4 / RLE8 decoding      | `decodeRleBmp()`        | [client.js:416](../../client.js#L416-L476)  |
| BMP pixel decoding        | `decodeBmp()`           | [client.js:478](../../client.js#L478-L577)  |
| Embedded JPEG/PNG payload | `bmpEmbedded()`         | [client.js:579](../../client.js#L579-L593)  |
| SVG size / rasterisation  | `loadSvg()`             | [client.js:607](../../client.js#L607-L630)  |
| PNG entry inside an icon  | `icoPngEntry()`         | [client.js:632](../../client.js#L632-L654)  |
| Size clamp                | `canvasOf()`            | [client.js:658](../../client.js#L658-L667)  |
| Output encoding           | `encodeCanvas()`        | [client.js:706](../../client.js#L706-L722)  |
| JPEG white background     | `flattenOnWhite()`      | [client.js:725](../../client.js#L725-L734)  |
| Actual encoded type       | `encodedMime()`         | [client.js:738](../../client.js#L738-L741)  |
| Decode routing            | `toCanvas()`            | [client.js:743](../../client.js#L743-L772)  |
| Pass-through / conversion | `normalize()`           | [client.js:788](../../client.js#L788-L828)  |
| Candidate test            | `isImageCandidate()`    | [client.js:832](../../client.js#L832-L837)  |
| Composer target           | `composer()`            | [client.js:839](../../client.js#L839-L841)  |
| Synthetic drop            | `reroute()`             | [client.js:849](../../client.js#L849-L857)  |
| Guards and dispatch       | `handle()`              | [client.js:869](../../client.js#L869-L910)  |
| Event listeners           | `install()`             | [client.js:912](../../client.js#L912-L945)  |
| Module entry              | `__ModuleLoader__.load` | [client.js:959](../../client.js#L959-L1271) |

## Design notes

- **Bytes over labels.** MIME types are supplied by the source application; magic bytes are supplied by the image encoder. Trusting the bytes is the only way to handle both "unsupported but honest" and "supported but lying".
- **Capture and synchronous cancel.** The composer must never see the raw unsupported file, and `preventDefault()` is only effective while the event is being dispatched.
- **PNG as the default output.** It is on the whitelist, lossless for the pixels that were decoded, and every Chromium build can encode it through `canvas.toBlob`; switch to JPEG/WebP for smaller files, and an unsupported encoder falls back to PNG.
- **Synthetic drop instead of a private API.** Reusing the native drop path keeps the plugin compatible with composer changes that do not touch `[data-composer-card]`.
- **No host process.** A paste is a UI event. A renderer listener is enough; a host-side clipboard daemon would add a process, permissions and polling for no benefit.
- **No third-party decoder.** TIFF and HEIC are detected but not decoded: shipping a codec would either bloat the single script the module loader injects or add a runtime fetch to a plugin that is otherwise offline-only. BMP, XPM and SVG cover the formats this plugin was written for, and the browser keeps covering the rest.
