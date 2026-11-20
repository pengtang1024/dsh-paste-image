# Releasing

Releases are cut from `master` by the maintainer. Everything here is a checklist you can copy; the repository has no build step, so "releasing" is version bump + changelog + tag + notes.

## Version policy

The project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html) with the usual pre-1.0 caveat:

- **0.x.0** (MINOR) — new formats, new host integration, anything that could change the pass-through rules. Pre-1.0, a minor release may contain breaking changes.
- **0.x.y** (PATCH) — bug fixes, decoder corrections, documentation-only releases.
- The version in `package.json` is the single source of truth. There is no separate version file.

A format addition is always a minor bump: users pin the plugin by version and want to know when decoding behaviour changed.

## Pre-flight

Run all of this from a clean checkout of `master`:

```bash
git switch master
git pull --ff-only
git status --porcelain          # must be empty
npm test                        # suite must pass
npm run check
npm run format:check            # CI runs the same thing
```

Also confirm the GitHub Actions run for the newest `master` commit is green — a red run means the release does not go out, even if your local copy passes.

## Cut the release

1. **Bump the version.**

   ```bash
   npm version 0.3.0 --no-git-tag-version   # or edit package.json by hand
   ```

2. **Promote the changelog.** Move the items under `## [Unreleased]` into a new `## [0.3.0] - YYYY-MM-DD` section in both `CHANGELOG.md` (Chinese) and `CHANGELOG.en.md` (English), and leave `## [Unreleased]` empty at the top of each. Keep the Keep-a-Changelog structure: `Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`, `Security`.

3. **Check the translations.** Chinese is the source of truth: `README.md` and the pages under `docs/` are canonical, and `README.en.md`, `docs/en/`, `CONTRIBUTING.en.md`, `CHANGELOG.en.md` and `SECURITY.en.md` are mirrors. If the release changes a user-visible fact — a format, a limit, an install step — update every `README.<language>.md`, every `locale/<language>.json` description, the matching English page, and the marketplace entry in the same release commit. The suite fails when a language loses its README, its `meta.detail` target or a cross-README link:

   ```bash
   ls README*.md locale/*.json
   npm test
   ```

4. **Format and verify.**

   ```bash
   npm run format
   npm test
   npm run check
   npm run format:check
   ```

5. **Commit, tag, push.**

   ```bash
   git add -A
   git commit -m "chore(release): 0.3.0"
   git tag -a v0.3.0 -m "dsh-paste-image 0.3.0"
   git push origin master
   git push origin v0.3.0
   ```

   The tag is annotated on purpose: `git describe` and the release page both use it. Never move or force-push a tag that has been published.

6. **Publish the GitHub release.** Reuse the changelog section as the body:

   ```bash
   awk '/^## \[0\.3\.0\]/{flag=1;next}/^## \[/{flag=0}flag' CHANGELOG.md > /tmp/notes.md
   gh release create v0.3.0 --title "v0.3.0" --notes-file /tmp/notes.md --verify-tag
   ```

   Add `--prerelease` for `0.x.y-rc.N` tags.

## After the release

- **Check the tag installs.** GitHub installs resolve the repository, not the release, but verifying the tag catches a missing `client.js` in `files`:

  ```bash
  dsh plugin --profile <scratch-profile> add github:pengtang1024/dsh-paste-image#v0.3.0
  ```

  Open that profile, paste an image, then remove the profile.

- **Inspect the package payload.** `npm pack --dry-run` prints the file list; it must contain `client.js`, `lib/`, `cordis.patch.yml`, all eight locales, every translated README, `LICENSE` and `CHANGELOG.md`, and nothing from `tests/` or `docs/`.

- **Update the marketplace entry.** The plugin-market submission lives in a different repository: [`data/plugins/pengtang1024__dsh-paste-image.yml`](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/data/plugins/pengtang1024__dsh-paste-image.yml). If a release changes the supported-format list, update `description.en` / `description.zh` in the same pull request that mentions the new formats. The catalog schema only carries those two languages; the eight-language text lives in the plugin's `locale/` directory and is read after installation. The catalog regenerates nightly after the marketplace pull request merges.

## Publishing to npm

The package is on npm as `dsh-paste-image` since 0.2.1. Releases are published by CI from then on:

1. `.github/workflows/release.yml` publishes on `release: published` through **trusted publishing (OIDC)** — no `NPM_TOKEN`, no stored secret.
2. Configure the trusted publisher once on npmjs.com (package → Settings → Trusted Publisher): provider `GitHub Actions`, organization `pengtang1024`, repository `dsh-paste-image`, workflow `release.yml`, environment empty. The configuration must complete its first successful publish within two days or it expires and has to be recreated.
3. Only GitHub-hosted runners are supported; self-hosted runners are rejected by the registry.
4. Manual fallback, when the workflow is unavailable: `npm publish --registry=https://registry.npmjs.org --access public`. The account has `auth-and-writes` 2FA, so a granular token without bypass-2FA gets a 403. Tokens that _do_ bypass 2FA still cannot manage tokens, access, maintainers or trusted-publisher settings — those need an interactive challenge.

Four traps worth remembering:

- **The mirror cannot publish.** `registry.npmmirror.com` is read-only; always pass `--registry=https://registry.npmjs.org` (or set `publishConfig.registry`) when publishing by hand.
- **Never leave a staged version behind.** `npm stage publish` defers 2FA to `npm stage approve`; an interrupted attempt leaves a `0.0.0-stage` version in the registry, and a bypass-2FA token cannot unpublish it.
- **Trust permissions are not "on" by default.** `npm stage publish` is always allowed; direct publish and dist-tag management need the extra checkbox. `npm trust list <pkg> --registry=https://registry.npmjs.org` must print `permissions: publish, stage publish`. A `stage publish, manageDistTags` row still exchanges tokens successfully and then fails the upload with `403 OIDC permission denied for this action`.
- **A trust row cannot be edited, only replaced.** `npm trust github … --allow-publish` against an existing row fails `409 ... a trusted publisher configuration that a token could also match already exists`. Revoke first (`npm trust revoke <pkg> --id=<id>`), then recreate with `--allow-publish`. Both commands need an interactive browser challenge, so a non-TTY shell cannot finish them.

## Hotfixes

Security and decoder fixes follow the same path with a PATCH bump. Branch from the released tag when `master` already contains unreleased work:

```bash
git switch -c fix/decoder-bounds v0.2.0
# fix, test, commit
git switch master && git merge --ff-only fix/decoder-bounds
npm version patch --no-git-tag-version
```

If the fix is security-relevant, publish the release notes at the same time as the advisory so users see the upgrade path.

## What not to do

- Do not bump the version or edit `CHANGELOG.md` in a feature pull request; see `CONTRIBUTING.md`.
- Do not publish a release from a branch other than `master`.
- Do not delete a published release or tag; publish a follow-up patch instead.
- Do not publish without a green CI run on the same commit the tag points at.
