# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
