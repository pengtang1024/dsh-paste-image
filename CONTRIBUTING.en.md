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

| Path                    | Purpose                                                                                                                                                                                                                                         |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `client.js`             | All renderer logic: event capture, sniffing, decoding, PNG re-encoding and rerouting.                                                                                                                                                           |
| `lib/index.js`          | Host half. Intentionally empty (`export function apply() {}`); everything happens in the renderer.                                                                                                                                              |
| `cordis.patch.yml`      | Loader entry that mounts the plugin.                                                                                                                                                                                                            |
| `locale/`               | Display metadata for the eight languages the DSH interface ships: title, description and the detail document shown in Plugin Manager.                                                                                                           |
| `README*.md`            | English README plus one full translation per supported language; each `meta.detail` points at its own translation.                                                                                                                              |
| `tests/client.test.mjs` | `node:test` suite; runs `client.js` in a `vm` context with a minimal DOM stub.                                                                                                                                                                  |
| `tests/helpers/dom.mjs` | The stub: fake canvas and image data, BMP builders, and the globals `client.js` expects.                                                                                                                                                        |
| `docs/`                 | Chinese user documentation; English mirrors live in [`docs/en/`](docs/en/): [how it works](docs/en/how-it-works.md), [format support](docs/en/formats.md), [troubleshooting](docs/en/troubleshooting.md) and [releasing](docs/en/releasing.md). |

## Tests come with the change

Every behaviour change needs a test, and both gates must stay green:

```bash
npm test
npm run check
```

- `npm test` runs `node --test tests/*.test.mjs`. Add cases for new formats, new guards or changed pass-through rules. The current suite covers magic-byte sniffing, candidate detection, the BMP decoder, converting BMP bytes declared as PNG, native pass-through, the locale metadata shown for every language, and relative links across the documentation.
- `npm run check` runs `node --check` on `client.js` and `lib/index.js`.
- For anything that touches the event path, also test manually: install the plugin locally, reload, then paste a screenshot and drop a file. Confirm the composer receives the attachment and that the Console (Verbose level) shows the expected `[dsh-paste-image]` line.

Do not claim a change is verified without the command output. If something is untested, say so in the pull request.

## Adding a format

Format work touches more than the decoder. The full checklist lives in [docs/en/formats.md#adding-a-format](docs/en/formats.md#adding-a-format); in short: sniff it, decode it, route it in `toCanvas()`/`IMAGE_EXT`, add the four test cases (happy path, truncation, declared-type lie, sniff), then update `docs/formats.md` and `docs/en/formats.md`, every README, and both `CHANGELOG.md` and `CHANGELOG.en.md`. Keep the decoder dependency-free — a new runtime dependency is a non-starter for this plugin.

## Translations

The plugin ships display metadata and READMEs in every language the DSH interface supports: English (`en`), Simplified Chinese (`zh`), Japanese (`ja`), Spanish (`es`), French (`fr`), German (`de`), Russian (`ru`) and Portuguese (`pt`). English is the source of truth; every other file is a full translation of `README.md`.

When you change a user-visible fact in `README.md` — a format, a limit, an install step, a version number — update all eight translations in the same pull request. A translation does not need to be perfect prose, but it must not change meaning, add claims, or drop a limitation.

What to update:

1. `README.<language>.md` — the full translation. Keep the eight-language switcher line, badges, code fences, commands, paths, URLs and inline code identical to English; translate prose, headings and table headers/cells.
2. `locale/<language>.json` — `meta.title` (3–80 characters), `meta.description` (over 40 characters, same facts and limits as `locale/en.json`) and `meta.detail`, which must name that language's README (`README.md` for English, `README.<language>.md` otherwise).

To add a language, first check that the DSH interface ships it; a locale file nobody can select is dead weight. Then add `README.<language>.md`, `locale/<language>.json`, include the language in the switcher line of every README, and extend `LOCALES` in `tests/locale.test.mjs`. The suite fails when a locale file, detail document or cross-README link is missing, or when a relative link in any README or doc points at a file that does not exist.

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

## Branch model

The project follows Git Flow: `develop` is the integration branch and `master` is the release branch. Both histories advance only by merges; releases are marked with signed tags.

- **Long-lived branches**: `develop` (day-to-day integration) and `master` (released state only). Do not develop directly on `master`.
- **`feature/*` and `fix/*`**: branch off `develop` and merge back into `develop`. `--no-ff` may be used to preserve the branch topology, but is not required for these merges.
- **`release/*`**: cut from `develop` to finish version numbers, changelog and other release prep. When done, **merge both ways**: first into `master`, tag the signed tag on `master`, then merge `master` back into `develop`.
- **`hotfix/*`**: cut from `master` (or a published tag) for urgent fixes. It follows the same **two-way merge**: into `master` with a signed tag, then `master` back into `develop`.

Merging `release/*` and `hotfix/*` into both `master` and `develop` **must use `--no-ff`** to leave a traceable merge commit. Signed tags are only created on `master`.

By default, do not change GitHub's default branch setting, do not force push, and do not rebase already-published commits; published tags must never move. Ask a maintainer before making an exception.

### Naming and commit conventions

- Branch names use **kebab-case** (lowercase, words separated by hyphens), e.g. `feat/paste-webp`, `fix/settings-locale`. In practice `feature/*` is often written as `feat/*`; the two are equivalent.
- Commit messages follow Conventional Commits in the form `type(scope): 中文描述`. `scope` is optional and names the affected module (e.g. `decoder`, `locale`, `docs`); the description is written in Simplified Chinese and does not end with a period. Example: `fix(decoder): 修正截断 BMP 的越界读取`.
- `type` is one of `feat`, `fix`, `docs`, `chore`, `refactor`, `perf`.

## Signing convention

Release tags on this machine are signed with **SSH** (not GPG). The effective git configuration, which you can re-check with `git config --get <key>`, is:

| Setting           | Value                                              |
| ----------------- | -------------------------------------------------- |
| `gpg.format`      | `ssh`                                              |
| `user.signingkey` | `/home/pt/.ssh/id_ed25519_github_docker_panel.pub` |
| `tag.gpgSign`     | `true`                                             |

The equivalent `git config --list --local` excerpt:

```text
gpg.format=ssh
user.signingkey=/home/pt/.ssh/id_ed25519_github_docker_panel.pub
tag.gpgSign=true
```

Tags created on `master` therefore carry a signature by default. To verify a signature, Git needs a list of trusted public keys; by convention `gpg.ssh.allowedSignersFile` points at `.git/allowed_signers` inside the repository. **That file lives under `.git/` and is never versioned**, so every fresh clone needs this local setup:

```bash
git config --local gpg.ssh.allowedSignersFile .git/allowed_signers
# Write the public-key line into the file; <principal> is the identity you
# want associated with the key (e.g. your GitHub username):
printf '<principal> %s\n' "$(cat /home/pt/.ssh/id_ed25519_github_docker_panel.pub)" > .git/allowed_signers
```

You can then check signatures with `git verify-tag v<version>` or `git log --show-signature`. Never commit the private key; `allowed_signers` is also a per-machine, local-only concern and does not belong in version control.

## Pull requests

1. Open an issue first for anything larger than a typo or a docs fix.
2. Follow the [branch model](#branch-model) above and branch from `develop`: `feat/...`, `fix/...` or `docs/...`, using kebab-case names.
3. Keep commits focused and follow the [naming and commit conventions](#naming-and-commit-conventions) above.
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
