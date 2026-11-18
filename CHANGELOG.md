# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.3] - 2026-11-18

### Fixed

- One paste could insert the same image several times: every copy of the client bundle that had been loaded added another document-level listener, and the old `install()` returned a no-op disposer so nothing was ever removed. Five loaded copies produced five identical attachments. `install()` is now idempotent, returns a reference-counted, abort-based disposer that removes both listeners once the last holder releases them, and each source paste/drop event is claimed once, so duplicate listeners can no longer convert and re-route the same event twice.

### Tests

- 21 tests: the new one installs twice, asserts a single paste/drop listener pair, disposes, and installs again.

## [0.2.2] - 2026-11-18

### Added

- Plugin Manager display metadata: `locale/en.json` and `locale/zh.json` ship `meta.title` and `meta.description`, so plugin rows and the detail page describe the capability instead of falling back to the manifest name and README.
- A package-root `icon` (`./assets/icon-180.png`) and a `./locale/*.json` export; the icon and locales now travel inside the npm tarball.
- `.github/workflows/release.yml` publishes GitHub Releases to npm through OIDC trusted publishing, with no stored token.

### Changed

- `dsh-paste-image@0.2.1` is the first npm release; both READMEs now lead with `dsh plugin --profile <profile> add dsh-paste-image` and keep the GitHub install as the no-registry alternative.

### Tests

- 20 tests: the four new ones assert both locale files carry usable `meta.title`/`meta.description`, the icon is a PNG under 256 KiB, and the locales plus icon are packaged and exported.

## [0.2.1] - 2026-11-18

### Fixed

- The release checklist in `docs/releasing.md` reported the 0.2.0 test count; it now matches the suite (16 tests).

## [0.2.0] - 2026-11-18

### Added

- Full BMP/DIB coverage in `decodeBmp()`: 1/4/8/16/24/32-bit pixels, `BI_RLE8`/`BI_RLE4`, `BI_BITFIELDS`/`BI_ALPHABITFIELDS`, `BITMAPCOREHEADER`, `BITMAPV2/V3/V4/V5HEADER`, OS/2 v2 headers and headerless DIBs (the `CF_DIB` shape).
- Embedded JPEG/PNG payloads (`BI_JPEG`/`BI_PNG`) are unwrapped and handed to the browser decoder.
- SVG pastes are rasterised through an `<img>` element; `viewBox` provides the size when `width`/`height` are missing.
- ICO/CUR fall back to the largest PNG-compressed directory entry when the browser cannot decode the icon.
- Magic-byte detection for AVIF, HEIC/HEIF, ICO/CUR, SVG and headerless DIBs.
- MIME alias table so `image/jpg`, `image/x-png`, `image/x-bmp`, `image/x-xpixmap`, `image/svg+xml` and friends are treated as the canonical type.
- `MAX_PIXELS` guard (64 Mi px) before a BMP/XPM canvas is allocated.
- `docs/formats.md`: the decision pipeline, the full format matrix, the BMP variant grid and the checklist for adding a format.
- `docs/releasing.md`: version policy, release checklist, npm publish steps and marketplace sync.
- Open-source scaffolding: `.github/CODEOWNERS`, issue-template contact links, README badges, and a Community section linking contributing, conduct, security, changelog and releases.

### Changed

- A native image with an empty declared type is re-wrapped with the sniffed type instead of being passed through and rejected by the host.
- Row stride, palette entries, bit masks and alpha handling in the BMP decoder are shared by every pixel depth instead of being hard-coded for 24/32-bit.
- BMP files using `BI_CMYK` compression (11/12/13) are rejected with `bmp: unsupported compression` instead of being decoded as RGB.

### Fixed

- 32-bit BMPs whose encoder leaves the alpha channel at zero no longer export as a fully transparent PNG.
- Palette BMP entries are loaded with the correct entry size (3 bytes for the OS/2 core header, 4 otherwise), and a zero alpha byte in a palette entry no longer makes that colour transparent.
- `cordis.patch.yml` is now part of the published `files` list. GitHub (and future npm) installs used to omit the loader patch, so the bundle entry never mounted; CI checks the tarball for the file.

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
