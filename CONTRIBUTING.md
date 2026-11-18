# Contributing to dsh-paste-image

Thanks for helping. This is a small, dependency-free browser plugin; the bar is "change one thing, test it, keep it small".

## Requirements

- Node.js 20 or newer. `package.json` declares `"engines": { "node": ">=20" }`.
- No runtime dependencies. The plugin ships as plain renderer code plus a no-op host module, and the project does not accept new dependencies.
- npm is enough for local checks. The DSH CLI uses pnpm internally when installing plugins; you do not need to manage that yourself.

## Set up

```bash
git clone https://github.com/pengtang1024/dsh-paste-image.git
cd dsh-paste-image
npm test
npm run check
```

To try your changes in the app:

```bash
dsh plugin --profile <profile> add file:/absolute/path/to/dsh-paste-image
```

Reload the DSH window after installing. In current DSH builds a `file:` install copies the plugin into the profile, so after editing the checkout, re-run the `add` command and reload again; there is no build step and `client.js` is shipped as-is.

## Project layout

| Path                    | Purpose                                                                                                                                                                     |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `client.js`             | All renderer logic: event capture, sniffing, decoding, PNG re-encoding and rerouting.                                                                                       |
| `lib/index.js`          | Host half. Intentionally empty (`export function apply() {}`); everything happens in the renderer.                                                                          |
| `cordis.patch.yml`      | Loader entry that mounts the plugin.                                                                                                                                        |
| `tests/client.test.mjs` | `node:test` suite; runs `client.js` in a `vm` context with a minimal DOM stub.                                                                                              |
| `tests/helpers/dom.mjs` | The stub: fake canvas and image data, BMP builders, and the globals `client.js` expects.                                                                                    |
| `docs/`                 | User documentation: [how it works](docs/how-it-works.md), [format support](docs/formats.md), [troubleshooting](docs/troubleshooting.md) and [releasing](docs/releasing.md). |

## Tests come with the change

Every behaviour change needs a test, and both gates must stay green:

```bash
npm test
npm run check
```

- `npm test` runs `node --test tests/*.test.mjs`. Add cases for new formats, new guards or changed pass-through rules. The current suite covers magic-byte sniffing, candidate detection, the BMP decoder, converting BMP bytes declared as PNG, and native pass-through.
- `npm run check` runs `node --check` on `client.js` and `lib/index.js`.
- For anything that touches the event path, also test manually: install the plugin locally, reload, then paste a screenshot and drop a file. Confirm the composer receives the attachment and that the Console (Verbose level) shows the expected `[dsh-paste-image]` line.

Do not claim a change is verified without the command output. If something is untested, say so in the pull request.

## Adding a format

Format work touches more than the decoder. The full checklist lives in [docs/formats.md#adding-a-format](docs/formats.md#adding-a-format); in short: sniff it, decode it, route it in `toCanvas()`/`IMAGE_EXT`, add the four test cases (happy path, truncation, declared-type lie, sniff), then update `docs/formats.md`, both READMEs and `CHANGELOG.md`. Keep the decoder dependency-free — a new runtime dependency is a non-starter for this plugin.

## Style

- JavaScript is formatted with Prettier 3; the committed `.prettierrc.json` sets `semi: false`, `singleQuote: true` and `printWidth: 120`.
- `client.js` is loaded as a classic script inside the renderer: no top-level `import`/`export`, keep the IIFE, and keep the `module.exports` test seam at the bottom.
- Keep the code dependency-free and the decoders self-contained. Prefer a few clear functions over a framework.
- Format before committing:

```bash
npm run format        # npx --yes prettier@3 --write .
npm run format:check  # npx --yes prettier@3 --check .
```

`.prettierignore` keeps `node_modules/` and `package-lock.json` out. `LICENSE` has no file extension, so Prettier skips it when run on the directory; it is plain MIT text.

## Pull requests

1. Open an issue first for anything larger than a typo or a docs fix.
2. Branch from `master`: `feat/...`, `fix/...` or `docs/...`.
3. Keep commits focused and use `type(scope): summary` with `feat`, `fix`, `docs`, `test` or `chore`.
4. In the description, cover what changed, why, and how you verified it — paste the commands and the relevant output. For event-path changes, describe the manual paste/drop check.
5. CI runs `node --check` on both entry files, `npx prettier@3 --check .` and `npm test` on Node 20 and 22. Keep all three green.
6. Do not bump the version or edit `CHANGELOG.md` in a feature pull request; releases are cut by the maintainer.
7. Do not commit generated files, binaries or editor state.

## Reporting bugs

A useful report includes:

- DSH version and how the plugin was installed (GitHub or a local `file:` path).
- OS and desktop session, and which application produced the image.
- The declared MIME type — it is the left-hand side of the `[dsh-paste-image]` log line.
- The Console output at Verbose level, and the full text of any red error.
- A sample file, if it contains nothing private.

Please do not attach screenshots or files that contain personal data.

## Code of conduct

This project follows [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
