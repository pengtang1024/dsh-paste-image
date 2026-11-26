# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.6.1] - 2026-11-26

### Fixed

- Fixed the red master CI left behind by v0.6.0: the benchmark fixture still asserted a PNG default even though the default output had moved to WebP. The fixture assertion and benchmark label now expect WebP, and CI is green again.
- Formatted the contributing guides (Chinese and English) to clear the longstanding format WARN; `format:check` now reports zero warnings.

## [0.6.0] - 2026-11-26

### Added

- The settings page localization dictionary now covers all seven languages (Chinese source plus English, Spanish, French, German, Russian and Portuguese), and the interface follows the DSH display language automatically; previously only Chinese and English were covered, so other locales showed untranslated English text.
- package.json now declares per-release DSH compatibility (dsh.compatibility.dshReleases, covering 0.2.0-rc.2 through 0.2.2-rc.5) and a plugin category of productivity, so the detail page can show compatibility per host release and the marketplace can file the plugin by category.

### Changed

- The default output format for pasted images is now WebP instead of PNG (PNG and JPEG remain fully supported and can be selected at any time); the wording across the seven-language READMEs, SECURITY and DETAIL pages, docs and locale descriptions now says WebP is the default, keeping documentation in sync with the runtime default.

## [0.5.1] - 2026-11-26

### Changed

- Slimmed down the settings page: tighter padding, gaps, line height and input/button sizes cut the vertical footprint by roughly 20–25%. The control kinds, count, order, values and save semantics are unchanged, with no functional regression.
- The long `formatHint` / `qualityHint` notes are now expandable on demand (Details / Less), with the full text preserved and identical in Chinese and English; the `note` text is trimmed without dropping information.
- The GitHub star prompt and link stay fully present and clickable, with localized wording and `noopener noreferrer` unchanged — no localization regression.

## [0.5.0] - 2026-11-26

### Added

- A dedicated **Paste any image** entry in the Settings sidebar, alongside entries such as Quick phrases, opens the full runtime settings form directly; its label follows the sidebar wording. The original plugin-row entry (Settings → Plugins → dsh-paste-image → Configure) remains, and both share the same settings and registration ID.
- A localized GitHub star prompt at the bottom of the settings page: the Chinese and English prompt and link text follow the interface language, and the link opens the repository in a new tab with `noopener noreferrer`.

### Changed

- Reworked the settings form's visual design: controls are grouped into Switch / Count & limits / Output format & quality / Format conversion / System / Actions, with thin separators, section headings, hover feedback, a status pill and a primary button style. All colours and radii come from DSH design tokens, and the controls, their order, values and save semantics are unchanged.
- Documentation wording is now consistent: the READMEs (Chinese source plus six translations), the localized SECURITY files and both `docs/formats.md` pages describe the transcoded output as the selected format (PNG by default) instead of always PNG. The Chinese and translated READMEs, both changelogs and all seven DETAIL documents describe the new sidebar entry and the retained plugin-row entry.

### Fixed

- The six settings-section headings used to render raw dictionary keys instead of localized text; they now go through `t()` so both Chinese and English interfaces show the proper translated headings.
- The primary button's foreground colour used `--dsw-alias-label-on-color`, which no longer matches the current theme tokens; it now uses `--dsw-alias-label-primary-foreground`, keeping the button label legible.

## [0.4.3] - 2026-11-25

### Added

- Added five translated versions of the security policy, keeping the terms consistent across languages.
- Added the Dependabot configuration and reviewed the repository security settings.

### Changed

- The contributing guide now documents the Git Flow branch model and the SSH signing convention.
- Completed the seven-language DETAIL documents and removed Japanese; localization is now zh / en / es / fr / de / ru / pt.
- The README now asks readers for a GitHub star.

### Fixed

- The settings page still did not show up: the factory declared only `inject: ['slots']` and missed `locale`. cordis requires a service to be declared on the fiber before it can be read, so the `ctx.locale` read in `apply()` was blocked by the guard and swallowed by a try/catch, making `hasPageServices()` return false; the `ctx.inject(['slots', 'locale'], cb)` fallback never registered the page either and its error was swallowed by `debugUnavailable`. The factory now declares `inject: ['slots', 'locale']`, the ineffective deferred fallback and the try/catch are removed, and `registerSettingsPage()` is called directly once the services are ready (the `pageRegistered` guard, locale namespace `dsh-paste-image:settings` and slot key stay the same). `ctx.effect(install, 'paste-image')` still runs first, so a settings failure cannot affect pasting; a missing service only leaves one `console.debug` line.
- Added a cordis guard regression case: the factory must declare both `slots` and `locale`, and the old declaration blocks `ctx.locale` reads while the new one can register the settings page directly.

## [0.4.2] - 2026-11-25

### Fixed

- The settings page did not show up: the factory's returned object once again carries module-level `inject: ['slots']` (the host facade service gate). The host cordis-client-runner guard whitelist does not include `slots`/`locale`/`inject`, so after 0.4.1 removed `inject`, reading `ctx.slots` / `typeof ctx.inject` inside `apply()` threw and was swallowed by an empty catch, and the page was never registered into `plugins.row.config`. Only `slots` is declared and not `locale`, so an occasionally missing locale cannot park the whole package.
- `locale` is now obtained lazily through `ctx.inject(['slots', 'locale'], cb)`; a settings-page registration failure is no longer silent and emits a single `console.debug('[dsh-paste-image] settings page unavailable: ...')` line. Registration stays idempotent via `pageRegistered`, and the slot/key/NS are unchanged (`plugins.row.config` / `dsh-paste-image#paste-image` / `dsh-paste-image:settings`).
- The 0.4.1 paste-first behaviour and composer failure safety are preserved: `apply()` still installs the listeners with `ctx.effect(install, 'paste-image')` first, and without a real `[data-composer-card]` the plugin does not claim the event and lets native paste/drop through.
- The suite stays at 90 tests (90 passing, 0 failing).

## [0.4.1] - 2026-11-23

### Fixed

- The settings page no longer drags the paste path down with it (`client.js`): the module factory no longer returns `inject: ['slots', 'locale']`, and `apply()` starts with `ctx.effect(install, 'paste-image')` to register the paste/drop listeners before it tries to register the settings page — inline when `slots`/`locale` are already available, otherwise via `ctx.inject(['slots', 'locale'], cb)` once the services arrive, and skipped outright when neither exists. Paste keeps working when a UI service is missing or registration throws.
- Native paste is no longer swallowed: `handle()` only claims and calls `preventDefault()`/`stopPropagation()` when it has a real `[data-composer-card]`; without that card it returns immediately and the browser's native paste/drop path keeps running, instead of dispatching the synthetic drop on `document.body`.
- Host requirement is declared: `package.json` now carries `engines.dsh` (`>=0.2.0-rc.2 || >=0.2.1-rc.2 || >=0.2.2-rc.1`), so the plugin detail page no longer shows "未声明宿主要求".
- Marketplace descriptions match the real behaviour: the summaries in `package.json` and all eight `locale/*.json` files move from "PNG only" to "PNG / JPEG / WebP (PNG by default)" and mention the configurable file count and long-edge limit.
- Tests: three new cases cover immediate listener installation, deferred `ctx.inject` registration and the missing `[data-composer-card]` pass-through; the suite now has 90 tests (90 passing, 0 failing).

## [0.4.0] - 2026-11-21

### Added

- Configuration page: registered into the Plugin Manager's `plugins.row.config` slot (`key = dsh-paste-image#paste-image`) and reachable through Settings → Plugins → dsh-paste-image → Configure. The plugin row shows a one-line status summary; the page offers six checkboxes (enabled, XPM / BMP-DIB / SVG / ICO-CUR conversion switches, console logging), one output-format select (PNG / JPEG / WebP), three number inputs (max files per paste, 1–8; long edge, 512–8192; quality, 0.1–1, disabled while PNG is selected), Save and Restore defaults.
- Runtime settings: new `getSettings()` / `applySettings()` / `resetSettings()`, with defaults equal to 0.3.1 behaviour. `normalize()` reads the conversion switches plus the output format/quality, `canvasOf()` reads the long-edge limit, and `handle()` reads the master switch and the file-count limit, while `logConversions` gates the log lines. Saved changes apply immediately without a reload; disabling a format hands that format to the native channel untouched, and disabling the master switch keeps the listeners registered while paste and drop go fully native.
- Output format: new `outputFormat` (`png` / `jpeg` / `webp`, default `png`) and `quality` (0.1–1, default 0.92, applied to JPEG / WebP only). JPEG composites transparent pixels onto white before encoding; PNG is lossless and WebP keeps transparency. When the browser cannot encode the selected format, the plugin falls back to the actual `blob.type` and then to PNG when that type is unrecognised, with the file extension following the result.
- Persistence: settings are stored per browser under the `localStorage` key `dsh-paste-image.settings.v1` — nothing uploaded, nothing written to the host. When `localStorage` is unavailable or holds corrupt data, the plugin falls back to the defaults or an in-memory copy and paste keeps working.
- Tests: 26 new cases in `tests/settings.test.mjs` covering defaults, range clamping, persistence and corrupt-storage fallback, restore defaults, behaviour wiring, output format/quality and the page registration contract; the suite grows from 61 to 87 tests.
- Docs: new output-format measurements (`docs/output-formats.md`, English mirror `docs/en/output-formats.md`) recording PNG / JPEG / WebP sizes and encode times for five fixtures in a real Chromium (q=0.92 and q=0.8). The finding is that size ratios depend on content and no single percentage generalises — JPEG/WebP shrink photos by about 82%, while JPEG makes a UI screenshot 49% larger than PNG and PNG can still win there, and transparent images must avoid JPEG. The README configuration section gained a four-row quick-reference table linking to the full measurements.

## [0.3.1] - 2026-11-21

### Performance

- `normalize()` now reads at most a 1 KiB header through `file.slice()` to sniff the type; when the sniffed type is native (PNG/JPEG/WebP/GIF) and the declared MIME agrees, it returns `null` without calling `arrayBuffer()` on the whole file. The 20 MiB PNG pass-through benchmark drops from 3.803–3.929 ms/op with 20,971,520 bytes read in full to 0.0038–0.0063 ms/op with 0 bytes read in full; a full read only happens when an empty declaration needs re-wrapping or an actual conversion is required.
- `resolveColor()` reuses one 1×1 canvas and 2D context instead of creating a canvas per palette colour; XPM now uses a character-code `Map` instead of a per-pixel `row.slice()` when `cpp === 1`. The 512×512 XPM benchmark drops from 4.712–4.837 ms/op to 3.35–3.95 ms/op (~-24%, observed -18% to -29%). BMP→PNG conversion stays at about 3.9–4.0 ms/op and `decodeBmp` stays within run-to-run noise.
- The optimisation stays inside the existing synchronous renderer code: no new worker, no network request, and no change to timing or behaviour. `npm run bench` reproduces the full suite; `--quick` is the CI-sized smoke run.

### Compatibility

- Without `AbortController`, `install()` falls back to listeners registered without a `signal`, and the disposer removes both handlers with `removeEventListener`.
- Without `canvas.toBlob`, `toPngBlob()` falls back to `toDataURL()` and decodes the base64 payload into a `Blob`.
- Without `DataTransfer`/`DragEvent`, `handle()` returns before claiming the event or calling `preventDefault()`, leaving the browser's native paste/drop path intact instead of swallowing the event.
- File-like objects without `file.slice()`/`file.size` cannot read just a header and fall back to the original full-read path.

### Tests

- 61 tests: 41 client/locale cases plus 20 compatibility cases — headerless DIBs, 1/4/8/16/24/32-bit BMP, RLE4/RLE8, BITFIELDS, OS/2 core headers, TIFF/HEIC/AVIF sniffing, MIME aliases, BMP-labelled PNG, the 8-file limit, non-image pass-through, and the three fallbacks above. The CI matrix expands to Node 20/22/24 and gains a `node bench/bench.mjs --quick` smoke job.

## [0.3.0] - 2026-11-20

### Added

- Chinese-first layout. `README.md` is now Simplified Chinese, `README.en.md` is the English translation, and `README.es.md`, `README.fr.md`, `README.de.md`, `README.ru.md` and `README.pt.md` follow. Every README opens with the same language switcher and carries a Languages section.
- Display metadata for every language the DSH interface supports. `locale/en.json`, `locale/zh.json`, `locale/es.json`, `locale/fr.json`, `locale/de.json`, `locale/ru.json` and `locale/pt.json` each carry a localized `meta.title`, `meta.description` and a `meta.detail` pointing at that language's README — Chinese at `README.md`, English at `README.en.md` — so plugin rows and the detail page read in the app's language instead of falling back to the manifest name and English text.
- Chinese documentation: `docs/how-it-works.md`, `docs/formats.md`, `docs/troubleshooting.md` and `docs/releasing.md` are written in Chinese, with English mirrors under `docs/en/`.
- `CONTRIBUTING.md`, `CHANGELOG.md` and `SECURITY.md` are Chinese too, mirrored by `CONTRIBUTING.en.md`, `CHANGELOG.en.md` and `SECURITY.en.md`; `CODE_OF_CONDUCT.md` keeps the original Contributor Covenant English text. The new Translations section in the contributing guide names Chinese as the source language, lists the files to update, and explains how to add a language by extending `LOCALES` in the test suite.

### Changed

- `files` publishes `README*.md` instead of two hard-coded READMEs, and `package.json` gains the `i18n`, `localization` and `multilingual` keywords. Version is `0.3.0`.
- The English README no longer quotes a Chinese-only error string; the error is described in prose so every translation carries the same English-derived text.
- The release checklist in `docs/releasing.md` and the format guide in `docs/formats.md` now require updating every translation: releases verify that each language still has a locale file and a README, and the payload inspection expects all eight locales and every translated README. Relative links in the documentation point at the Chinese page or its `docs/en/` mirror as appropriate.

### Tests

- 37 tests: for each of the eight languages, the suite asserts one locale file with a usable title, a description between 40 and 600 characters, and a `meta.detail` that names that language's README; every README must start with `# dsh-paste-image` and link to all eight translations. It also checks the locale set and packaging declarations, and verifies that every relative link in the READMEs and docs resolves to a file that exists. The icon and packaging checks expect `README*.md` and every locale file.

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
