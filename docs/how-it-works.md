# How dsh-paste-image works

This page follows a paste from the DOM event to the PNG that the composer receives, and maps each step to the function that implements it in [`client.js`](../client.js). Line numbers refer to that file at version 0.1.0.

## The problem in one paragraph

The DSH desktop client accepts four attachment types: `image/png`, `image/jpeg`, `image/webp` and `image/gif`. The renderer receives the real file, but the MIME type attached to it comes from the source application and can be wrong or unsupported: a Wayland screenshot tool may declare `image/xpm`, and another application may hand over BMP bytes while claiming `image/png`. The plugin ignores the label, inspects the bytes, and converts what the host cannot take.

## Event flow

```text
paste / drop
   |
   |  capture phase, document level
   v
install() listener ---> handle(event, data)
                          |
                          | event rerouted?           yes -> return
                          | 0 files or more than 8?   yes -> return (native path)
                          | no image candidate?       yes -> return (native path)
                          |
                          +-- preventDefault() + stopPropagation()
                          |
                          v
                       for each file ---> normalize(file)
                                            |
                                            | sniff(bytes) -> kind
                                            | native and declaration agrees? yes -> null (keep file)
                                            v
                                          toCanvas()
                                            | XPM  -> decodeXpm() -> canvas
                                            | else -> createImageBitmap(blob)
                                            |           | throws and kind is BMP -> decodeBmp()
                                            v
                                          canvasOf()  longest side clamped to 4096
                                            v
                                          toPngBlob()  canvas.toBlob('image/png')
                                            v
                                          new File(name.png, image/png)
                          |
                          v
                       reroute(files) ---> synthetic DragEvent('drop') on [data-composer-card]
```

## 1. Capture phase

[`install()`](../client.js#L227-L231) adds two listeners on `document`:

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

The third argument `true` selects the capture phase. Capture runs from the window down to the target, before the composer's own bubble-phase handlers. That ordering is what lets the plugin cancel the original event before the composer tries to read the unsupported file. If the listener were registered in the bubble phase, the composer would already have seen (and rejected) the paste.

`install()` returns an empty disposer; the listeners live for the lifetime of the document. A page reload is the reliable way to reset them.

## 2. Guards in `handle`

[`handle()`](../client.js#L204-L225) is the dispatcher. It bails out early in three cases:

1. **Already rerouted.** The synthetic `drop` event carries a `__dshPasteImageRerouted` property ([`REROUTED`](../client.js#L9)); if it is set, the plugin returns immediately. Without this flag the plugin's own capture listener would see its synthetic event and recurse.
2. **Zero or too many files.** `data.files` is converted to an array and rejected when it is empty or longer than `MAX_FILES` (8, [line 8](../client.js#L8)). The check happens _before_ `preventDefault()`, so a batch of nine images is left entirely to the native path instead of being partially converted.
3. **No image candidate.** [`isImageCandidate()`](../client.js#L185-L190) returns true when the declared type starts with `image/` or the name matches `IMAGE_EXT` ([line 6](../client.js#L6)): `png`, `jpg`, `jpeg`, `jfif`, `gif`, `webp`, `bmp`, `dib`, `tif`, `tiff`, `xpm`, `avif`, `ico`, `cur`, `svg`. A plain-text paste does not match, so it is never touched.

Only after those guards does `handle()` call `event.preventDefault()` and `event.stopPropagation()`. Both calls are synchronous — they happen before the first `await`. That matters: once the function suspends on `file.arrayBuffer()`, it is too late to cancel the event, because the browser has already delivered it.

## 3. Magic-byte detection

[`sniff()`](../client.js#L17-L28) reads the first bytes of the file and returns a MIME-like string, or `null` when it does not recognize the format:

| Signature                                         | Result       |
| ------------------------------------------------- | ------------ |
| `89 50 4E 47 0D 0A 1A 0A`                         | `image/png`  |
| `FF D8 FF`                                        | `image/jpeg` |
| `GIF` at offset 0                                 | `image/gif`  |
| `RIFF` at 0 and `WEBP` at 8                       | `image/webp` |
| `BM`                                              | `image/bmp`  |
| `II 2A 00` or `MM 00 2A` (little/big-endian TIFF) | `image/tiff` |
| `/* XPM */` at offset 0, case-insensitive         | `image/xpm`  |

Everything else returns `null` and is left to the browser. The helpers are deliberately tiny: [`ascii()`](../client.js#L11-L15) turns a byte range into a string for the text signatures, and the rest are direct comparisons.

## 4. The pass-through rule

[`normalize()`](../client.js#L172-L181) is where the decision is made:

```js
var kind = sniff(bytes)
var declared = (file.type || '').toLowerCase()
if (kind && NATIVE_SET.has(kind) && (declared === kind || declared === '')) return null
```

Returning `null` means "no conversion"; `handle()` keeps the original `File`. This is why a real screenshot keeps its exact bytes, metadata and animation: PNG, JPEG, WebP and GIF are never re-encoded when the declaration matches or is empty.

The declared type only has veto power here. A file whose bytes are JPEG but which claims `image/png` fails the `declared === kind` test, so it is converted into a real PNG. Likewise a BMP declared as PNG is converted, because the host's whitelist and the host's decoder both follow the label.

When a conversion happens, the file name is rebuilt: the last extension is replaced with `.png`, so `shot.xpm` becomes `shot.png`, and `wechat.png` (which actually contained BMP bytes) stays `wechat.png`.

## 5. Decoding

[`toCanvas()`](../client.js#L158-L170) picks the decoding route:

- `image/xpm` goes straight to [`decodeXpm()`](../client.js#L61-L101), because no browser decodes XPM.
- Everything else is handed to `createImageBitmap(new Blob([bytes], { type }))`, where `type` is the sniffed format when known, otherwise the declared type, otherwise `application/octet-stream`. Using the sniffed format is what makes a mislabelled BMP decode correctly: the blob is re-typed from the bytes.
- If `createImageBitmap` rejects and the sniffed format is BMP, [`decodeBmp()`](../client.js#L105-L137) runs as a fallback.
- Any other decode error is rethrown. `handle()` catches it, keeps the original file and logs the reason.

[`canvasOf()`](../client.js#L141-L150) then normalizes the size: `scale = min(1, MAX_SIDE / max(width, height))` with `MAX_SIDE = 4096` ([line 7](../client.js#L7)), dimensions rounded and never below 1, and the source drawn into the scaled canvas. Small images pass through unscaled.

[`toPngBlob()`](../client.js#L152-L156) wraps `canvas.toBlob(callback, 'image/png')` in a Promise and rejects when the callback receives `null`. The resulting blob becomes a new in-memory `File`.

## 6. The XPM decoder

XPM is C source text, so [`decodeXpm()`](../client.js#L61-L101) starts by extracting every double-quoted string with [`xpmStrings()`](../client.js#L32-L40) and unescaping quotes, backslashes, newlines and tabs.

The first string is the header: `width height ncolors chars-per-pixel`. The width, height and colour count must all be positive; `chars-per-pixel` defaults to 1 when omitted.

The next `ncolors` strings are the palette. Each line begins with the pixel key (the first `chars-per-pixel` characters); the rest is scanned for a `c` colour specification. The extractor accepts one or two whitespace-separated tokens, which is enough for `#RRGGBB` and for names that contain a space. [`resolveColor()`](../client.js#L43-L59) then resolves the value with a 1×1 canvas: it assigns the string to `fillStyle`, reads the pixel back through `getImageData()`, and therefore accepts exactly what the browser's CSS colour parser accepts — `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa` and single-word CSS colour names. Palette names that are not also CSS colours, such as the two-word `light gray`, are rejected by `fillStyle` and become opaque black. The literal `None` becomes fully transparent; any other rejected value makes `resolveColor()` return `null`, and that palette entry also falls back to opaque black.

Pixel rows start at `strings[1 + ncolors]`. Each row is sliced into `chars-per-pixel` chunks, looked up in the palette, and written into an `ImageData` buffer. An unknown key or a short row yields transparent pixels.

Not supported: XPM1/XPM2 header layouts, colour keys other than `c` (`m`, `g`, `g4`, `s` are ignored), and palette colour names that are not valid CSS colours — including multi-word names such as `light gray`, which come out black.

## 7. The BMP decoder

[`decodeBmp()`](../client.js#L105-L137) is the fallback for BMP variants the browser refuses. It reads the file with a `DataView` and validates the parts it understands:

- Magic `0x4d42` (`BM`).
- Pixel-data offset at byte 10, DIB header size at byte 14; the header must be at least 40 bytes (`BITMAPINFOHEADER` or newer).
- Width at 18, height at 22 as signed integers. A negative height means a top-down bitmap, which the loop handles.
- Bits per pixel at 28, compression at 30. Only 24- or 32-bit with `BI_RGB` (compression 0) is accepted; anything else throws `bmp: unsupported variant`.

The row stride is `floor((bpp * width + 31) / 32) * 4`, the standard BMP padding rule. Pixels are stored as BGR(A), so the loop swaps the first and third byte and copies the fourth byte as alpha for 32-bit files. The result is put into an `ImageData` on a canvas and then goes through the same `canvasOf()` clamp as every other format.

Because the fourth byte is copied verbatim, a 32-bit BMP whose encoder leaves alpha at zero can produce a fully transparent PNG. Converting the file to 24-bit BMP or to PNG avoids that.

## 8. Rerouting

[`reroute()`](../client.js#L196-L202) builds the bridge back into the composer:

```js
var dt = new DataTransfer()
files.forEach(function (file) {
  dt.items.add(file)
})
var event = new DragEvent('drop', { bubbles: true, cancelable: true, composed: true, dataTransfer: dt })
Object.defineProperty(event, REROUTED, { value: true })
composer().dispatchEvent(event)
```

[`composer()`](../client.js#L192-L194) resolves `document.querySelector('[data-composer-card]')` and falls back to `document.body`. Dispatching a real `drop` event means the plugin does not need to know any private composer API: it reuses the same attachment path as a manual drag-and-drop. The `REROUTED` property is defined non-enumerably so it does not leak into anything that inspects the event.

## 9. Failure handling and logging

Conversion runs per file inside a `try/catch` ([`handle()`, lines 212–223](../client.js#L212-L223)). On success the plugin logs:

```text
[dsh-paste-image] image/xpm -> image/png 1440x900
```

The left side is the declared type (or `(no type)`). On failure it logs:

```text
[dsh-paste-image] keep original (image/bmp): bmp: unsupported variant
```

and pushes the original `File` into the outgoing batch. One bad file never blocks the others, and the synthetic drop still happens — which is why a failed conversion ends with the host's original red error rather than silence. Both messages use `console.debug`, so the browser console must be set to the Verbose level to show them.

## 10. Module registration

The file is a classic script wrapped in an IIFE. At the bottom ([lines 242–257](../client.js#L242-L257)) it registers itself with the DSH client module loader:

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

`ctx.effect(install, 'paste-image')` ties the installation to the plugin's effect scope and names it for diagnostics. The fallback `install()` keeps the module usable in environments without an effect scope. In a Node test there is no `window`, so the registration block is skipped and the file exports [`api`](../client.js#L233-L240) through `module.exports` for the test suite.

## Code map

| Concern                   | Function / entry        | Location                                |
| ------------------------- | ----------------------- | --------------------------------------- |
| Format signatures         | `sniff()`               | [client.js:17](../client.js#L17-L28)    |
| Byte-to-string helper     | `ascii()`               | [client.js:11](../client.js#L11-L15)    |
| XPM string extraction     | `xpmStrings()`          | [client.js:32](../client.js#L32-L40)    |
| CSS colour resolution     | `resolveColor()`        | [client.js:43](../client.js#L43-L59)    |
| XPM decoding              | `decodeXpm()`           | [client.js:61](../client.js#L61-L101)   |
| BMP fallback decoding     | `decodeBmp()`           | [client.js:105](../client.js#L105-L137) |
| Size clamp                | `canvasOf()`            | [client.js:141](../client.js#L141-L150) |
| PNG export                | `toPngBlob()`           | [client.js:152](../client.js#L152-L156) |
| Decode routing            | `toCanvas()`            | [client.js:158](../client.js#L158-L170) |
| Pass-through / conversion | `normalize()`           | [client.js:172](../client.js#L172-L181) |
| Candidate test            | `isImageCandidate()`    | [client.js:185](../client.js#L185-L190) |
| Composer target           | `composer()`            | [client.js:192](../client.js#L192-L194) |
| Synthetic drop            | `reroute()`             | [client.js:196](../client.js#L196-L202) |
| Guards and dispatch       | `handle()`              | [client.js:204](../client.js#L204-L225) |
| Event listeners           | `install()`             | [client.js:227](../client.js#L227-L231) |
| Module entry              | `__ModuleLoader__.load` | [client.js:242](../client.js#L242-L257) |

## Design notes

- **Bytes over labels.** MIME types are supplied by the source application; magic bytes are supplied by the image encoder. Trusting the bytes is the only way to handle both "unsupported but honest" and "supported but lying".
- **Capture and synchronous cancel.** The composer must never see the raw unsupported file, and `preventDefault()` is only effective while the event is being dispatched.
- **PNG as the output.** It is on the whitelist, lossless for the pixels that were decoded, and every Chromium build can encode it through `canvas.toBlob`.
- **Synthetic drop instead of a private API.** Reusing the native drop path keeps the plugin compatible with composer changes that do not touch `[data-composer-card]`.
- **No host process.** A paste is a UI event. A renderer listener is enough; a host-side clipboard daemon would add a process, permissions and polling for no benefit.
