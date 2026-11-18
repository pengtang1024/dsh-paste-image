# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] - 2026-11-18

### Added

- Full BMP/DIB coverage in `decodeBmp()`: 1/4/8/16/24/32-bit pixels, `BI_RLE8`/`BI_RLE4`, `BI_BITFIELDS`/`BI_ALPHABITFIELDS`, `BITMAPCOREHEADER`, `BITMAPV2/V3/V4/V5HEADER`, OS/2 v2 headers and headerless DIBs (the `CF_DIB` shape).
- Embedded JPEG/PNG payloads (`BI_JPEG`/`BI_PNG`) are unwrapped and handed to the browser decoder.
- SVG pastes are rasterised through an `<img>` element; `viewBox` provides the size when `width`/`height` are missing.
- ICO/CUR fall back to the largest PNG-compressed directory entry when the browser cannot decode the icon.
- Magic-byte detection for AVIF, HEIC/HEIF, ICO/CUR, SVG and headerless DIBs.
- MIME alias table so `image/jpg`, `image/x-png`, `image/x-bmp`, `image/x-xpixmap`, `image/svg+xml` and friends are treated as the canonical type.
- `MAX_PIXELS` guard (64 Mi px) before a BMP/XPM canvas is allocated.

### Changed

- A native image with an empty declared type is re-wrapped with the sniffed type instead of being passed through and rejected by the host.
- Row stride, palette entries, bit masks and alpha handling in the BMP decoder are shared by every pixel depth instead of being hard-coded for 24/32-bit.

### Fixed

- 32-bit BMPs whose encoder leaves the alpha channel at zero no longer export as a fully transparent PNG.
- Palette BMP entries are loaded with the correct entry size (3 bytes for the OS/2 core header, 4 otherwise), and a zero alpha byte in a palette entry no longer makes that colour transparent.

## [0.1.0] - 2026-11-15

### Added

- Capture-phase `paste` and `drop` interception in the DSH renderer.
- Magic-byte detection for PNG, JPEG, GIF, WebP, BMP, TIFF and XPM, independent of the declared MIME type.
- Native pass-through for PNG, JPEG, WebP and GIF when the declared type agrees with the bytes.
- XPM3 text decoder (`decodeXpm`) and a 24/32-bit uncompressed BMP fallback decoder (`decodeBmp`).
- Canvas re-encoding to PNG with a 4096 px longest-side cap and `.png` file naming.
- Synthetic `drop` rerouting to `[data-composer-card]`, guarded by `__dshPasteImageRerouted`.
- `__ModuleLoader__` module registration with a `ctx.effect` lifecycle hook.
- Node test suite covering sniffing, candidate detection, BMP decoding, format-lie conversion and native pass-through.
- MIT license.
