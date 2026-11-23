# Troubleshooting

The plugin has no UI. Every success and every failure is written to the browser console, so the first step is always the same: open DevTools, enable the Verbose level and filter for `[dsh-paste-image]`.

- DevTools: `Ctrl+Shift+I` (`Cmd+Option+I` on macOS).
- Console → the level dropdown → tick **Verbose**. `console.debug` messages are hidden at the default level.
- Filter box: `dsh-paste-image`.

| Message                                                 | Meaning                                                          |
| ------------------------------------------------------- | ---------------------------------------------------------------- |
| `[dsh-paste-image] image/xpm -> image/png 1440x900`     | Converted successfully; the composer receives a PNG.             |
| `[dsh-paste-image] keep original (image/bmp): bmp: ...` | Conversion failed; the original file was passed on unchanged.    |
| No message at all                                       | The event never reached the plugin, or the plugin is not loaded. |

## Nothing happens after installing

1. **Reload the page.** The client module is injected when the renderer loads. Installing the package does not hot-inject it, so before a reload — or a hard reload if you had the page open during install — the plugin has no listeners and does nothing. Use `Ctrl+R` (`Cmd+R`) or reload from the app menu.
2. **Check that the plugin is actually in the profile.** On Linux the profile directory is `~/.dsh/profiles/<profile>/`. Its `package.json` should list `dsh-paste-image` in `dependencies`, and `node_modules/dsh-paste-image/client.js` should exist. If either is missing, the `add` command targeted another profile or failed silently; re-run it and watch its output.
3. **Re-run the install after editing a local checkout.** Current DSH builds copy a `file:` install into the profile; edits in your checkout are not picked up by a reload alone. Re-run `dsh plugin --profile <profile> add file:/absolute/path/to/dsh-paste-image` and reload.
4. **Use an absolute path.** A relative `file:` path is resolved in the profile directory, not in your shell's working directory.
5. **Look for module-loading errors.** If the module fails to load, the console shows an error at load time, before any paste. Reload with the console open and read the first red line.
6. **Check the composer target.** In the console, run `document.querySelector('[data-composer-card]')`. If it returns `null`, the plugin deliberately lets go: it does not claim the event and does not call `preventDefault()`, so the browser's native paste/drop goes to the host untouched and the plugin does not convert the image. That is the 0.4.1 fail-safe, not a crash — and it means the DSH build changed its composer markup, so please report it.

## Pasting images does nothing

You paste or drop an image and no attachment shows up in the composer, with no obvious red error in the console:

1. **Confirm the plugin is enabled and at version 0.4.1 or later.** In Settings → Plugins → dsh-paste-image the row should read "enabled". 0.4.0 had a regression: when the UI services the settings page needs were not ready, the whole `apply()` — listener installation included — was skipped. 0.4.1 decouples listener installation from settings-page registration. Upgrade before investigating further.
2. **Restart or reload the host after upgrading.** Updating the package does not hot-inject the client module: quit and start DSH again, or reload the page in the window. Still nothing after upgrading usually means an old process is still running.
3. **Look for `[dsh-paste-image]` lines in the console.** Open DevTools → Console, set the level to **Verbose** and filter for `dsh-paste-image`. A successful conversion logs something like `image/xpm -> image/png`; no line at all means the event never reached the plugin (listeners were not installed, or the page was not reloaded). A `keep original (...)` line means conversion failed — see the next section.
4. **Confirm the composer card exists.** Run `document.querySelector('[data-composer-card]')` in the console. When it returns `null` the plugin deliberately stays out of the way: it does not claim the event and does not call `preventDefault()`, so native paste goes to the host untouched — that is the 0.4.1 fail-safe; the trade-off is that the plugin will not convert that image.
5. **Confirm the event really carries images, within the limit.** Plain text and non-image files never enter the plugin; a paste with more files than "max files per paste" (8 by default) goes to the native path as a whole batch.
6. **Still nothing? File an issue with evidence.** Include the DSH version, the plugin version (`0.4.1`), how it was installed, the OS and desktop session, plus the full `[dsh-paste-image]` lines at Verbose level and the first red error.

## The red "仅支持 PNG、JPG、WebP、GIF" error is still there

There are two different failures behind the same message.

**The event was never intercepted.** The plugin returns early, without touching the event, when:

- the paste or drop contains zero files or more than 8 files (`MAX_FILES`);
- no file looks like an image — the MIME type does not start with `image/` and the file name has no recognized image extension;
- the plugin is not loaded (see the previous section);
- the page has no `[data-composer-card]`, so the plugin deliberately lets go, native paste takes over and no conversion happens (see step 4 above).

A `.heic` file still fails after the sniff: the plugin now recognizes `heic`/`heif` by extension and by the `ftyp` box, but Chromium ships no HEIC codec, so decoding throws and the original is forwarded. Convert it to PNG or JPEG before pasting.

**The conversion failed.** In that case the console shows `keep original (...)` and the original bytes are forwarded, so the host rejects them exactly as before. The text after the colon is the decoder's reason:

- `bmp: unsupported bpp 2` / `bmp: unsupported header 16` — a BMP variant that is not implemented (2-bit pixels, unknown DIB header size; see below).
- `bmp: too large` — the header claims more than 64 Mi pixels; the file is rejected before a canvas is allocated.
- `xpm: bad header ...` or `xpm: no strings` — the XPM text is malformed (see below).
- `svg: decode failed` — the markup is not a valid SVG, or it references external images the browser refuses to load inside an `<img>`.
- A browser decoder error — the format needs a codec this Chromium build does not have (TIFF and HEIC are the usual cases).

If the console shows a successful `-> image/png` line and the composer still rejects the paste, the failure is downstream of the plugin: copy the full error text and the log line into an issue.

## Large images fail

- Converted images are scaled down so their longest side is at most **4096 px** (aspect ratio preserved, dimensions rounded). A 6000 px screenshot therefore arrives as a 4096 px PNG. That is intentional, not a bug.
- Native PNG, JPEG, WebP and GIF files are passed through untouched and are **not** resized. If the host rejects such a file, its size or pixel dimensions are the host's limit, not the plugin's.
- Memory matters. Decoding draws the image into a canvas: a 4096×4096 canvas is roughly 64 MiB of RGBA before the PNG is encoded. Pasting several large images at once multiplies that. If the renderer slows down or crashes, paste fewer images at a time or convert them to smaller PNGs first.
- An image whose longest side is already under 4096 is not upscaled or downscaled.

## XPM decoding fails

Supported input is **XPM3 text**: the `/* XPM */` header, then quoted strings for the `width height ncolors chars-per-pixel` line, the colour table and the pixel rows. Typical console reasons:

- `xpm: no strings` — the file contains no quoted strings; it is probably not XPM text or it was truncated.
- `xpm: bad header <line>` — the first string is not a valid `width height ncolors` header, or one of the numbers is zero.

Colour notes:

- Only the `c` colour key is read. `m` (mono), `g` (grayscale), `g4` and `s` (symbolic) are ignored, so an image that relies on them may come out black or transparent.
- `None` (capital N) is transparent. Lower-case `none` is not a valid CSS colour and falls back to opaque black.
- Values are resolved by the browser's CSS colour parser. `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa` and single-word CSS colour names work. Names that are not valid CSS colours, including two-word names such as `light gray`, fail and become opaque black.
- A colour the browser cannot parse becomes opaque black.
- A pixel whose key is missing from the colour table becomes transparent.

When decoding fails, the original file is forwarded and the host rejects it. Convert the image to PNG with any image viewer and paste the PNG instead.

## BMP decoding fails or looks wrong

- Supported: 1/4/8/16/24/32-bit pixels, `BI_RGB`, `BI_RLE8`, `BI_RLE4`, `BI_BITFIELDS`, `BI_ALPHABITFIELDS`, header sizes 12/40/52/56/64/108/124, and headerless DIBs (`CF_DIB` shape). 2-bit and 64-bit-per-pixel files still throw.
- The browser is tried first; the local `decodeBmp()` decoder is only a fallback. A browser that can decode the file never reaches the fallback.
- `BI_JPEG` / `BI_PNG` BMPs are unwrapped: the embedded payload is handed to the browser decoder.
- For 32-bit files without an alpha mask, the fourth byte is used as alpha **unless the whole channel is zero**, in which case the image is treated as opaque. A partially transparent 32-bit BMP keeps its real alpha.
- Top-down BMPs (negative height) are handled, including the RLE paths; a corrupted header with a non-positive width is rejected.

## SVG or icon pastes fail

- SVG is rasterised through an `<img>` element. External `<image href>` references may fail because the object URL has no base URL; inline shapes and embedded data URLs work.
- ICO/CUR is handed to the browser first. When that fails, only PNG-compressed entries are supported; DIB-only icons and cursors fall back to the original file and are rejected by the host.

## Watching the logs while you test

1. Open the console before pasting.
2. Set the level to Verbose and filter `[dsh-paste-image]`.
3. Paste or drop one image.
4. Read the line:

```text
[dsh-paste-image] <declared type> -> image/png <width>x<height>
[dsh-paste-image] keep original (<declared type>): <reason>
```

The declared type is what the source application claimed. `(no type)` means the file arrived without a MIME type. Seeing `image/xpm -> image/png` confirms that both detection and conversion worked.

If nothing is printed at all, the plugin either is not loaded or did not consider the event an image paste. Re-check the install, the reload and the file count.

## Uninstalling

```bash
dsh plugin --profile <profile> remove dsh-paste-image
```

Then reload the page. The listeners are attached to `document` and live until the page reloads, so the plugin can keep intercepting pastes for the current session even after the package is removed; reload to actually unload it. A checkout you installed with `file:` stays on disk; removing the plugin does not delete it.

## Before filing an issue

Include:

- DSH version and the install method (GitHub package or a local `file:` path).
- OS, desktop session, and the application that produced the image.
- The full `[dsh-paste-image]` lines at Verbose level, and the exact red error text.
- Whether the input was a paste, a drop, or both.
- A sample file if it contains nothing private.

Do not attach screenshots or files containing personal data.
