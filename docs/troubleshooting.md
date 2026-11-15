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
6. **Check the composer target.** In the console, run `document.querySelector('[data-composer-card]')`. If it returns `null`, the plugin can still convert images but can only dispatch the synthetic drop on `document.body`; a composer that has moved away from that attribute will not receive it. That means the DSH build changed its composer markup — please report it.

## The red "仅支持 PNG、JPG、WebP、GIF" error is still there

There are two different failures behind the same message.

**The event was never intercepted.** The plugin returns early, without touching the event, when:

- the paste or drop contains zero files or more than 8 files (`MAX_FILES`);
- no file looks like an image — the MIME type does not start with `image/` and the file name has no recognized image extension;
- the plugin is not loaded (see the previous section).

A `.heic` file that arrives as `application/octet-stream` is not a candidate either: `heic` is not in the extension list, and its MIME type does not start with `image/`. Convert it to PNG before pasting.

**The conversion failed.** In that case the console shows `keep original (...)` and the original bytes are forwarded, so the host rejects them exactly as before. The text after the colon is the decoder's reason:

- `bmp: unsupported variant` — not a 24/32-bit uncompressed BMP (see below).
- `xpm: bad header ...` or `xpm: no strings` — the XPM text is malformed (see below).
- A browser decoder error — the format needs a codec this Chromium build does not have (TIFF and many HEIC builds are the usual cases).

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

- Only 24- or 32-bit, uncompressed (`BI_RGB`) BMP with a `BITMAPINFOHEADER` or newer is supported. 1/4/8/16-bit palette images, RLE compression and OS/2 headers throw `bmp: unsupported variant`.
- The browser is tried first; the local `decodeBmp()` decoder is only a fallback. A browser that can decode the file never reaches the fallback.
- For 32-bit files the fourth byte is copied as alpha. If the encoder left it at zero, the resulting PNG can appear fully transparent. Re-save the image as 24-bit BMP or as PNG and paste that.
- Top-down BMPs (negative height) are handled; a corrupted header with a negative width is not.

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
