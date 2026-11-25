import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

// Every language the DSH interface ships. Keep this list in sync with locale/*.json.
// Ordered as the language switch line: source language (zh) first, then the translations.
const LOCALES = ['zh', 'en', 'es', 'fr', 'de', 'ru', 'pt']

function readmeFor(locale) {
  if (locale === 'zh') return 'README.md'
  return locale === 'en' ? 'README.en.md' : `README.${locale}.md`
}

function detailFor(locale) {
  return `docs/DETAIL.${locale}.md`
}

for (const locale of LOCALES) {
  test(`locale/${locale}.json carries display metadata`, () => {
    const meta = JSON.parse(readFileSync(join(root, 'locale', `${locale}.json`), 'utf8')).meta
    assert.equal(typeof meta.title, 'string')
    assert.ok(meta.title.trim().length > 2, 'meta.title is missing')
    assert.ok(meta.title.trim().length <= 80, 'meta.title is too long for a plugin row')
    assert.equal(typeof meta.description, 'string')
    assert.ok(meta.description.trim().length > 40, 'meta.description does not explain the capability and its limits')
    assert.ok(meta.description.trim().length <= 600, 'meta.description is too long to scan in a plugin row')
    assert.equal(meta.detail, detailFor(locale), 'meta.detail must point at this language DETAIL document')
    assert.ok(existsSync(join(root, detailFor(locale))), `${detailFor(locale)} does not exist`)
  })

  test(`${readmeFor(locale)} language switch links to every DETAIL translation`, () => {
    const text = readFileSync(join(root, readmeFor(locale)), 'utf8')
    assert.ok(text.startsWith('# dsh-paste-image'), 'README does not start with the plugin name')

    const switchLine = text.split('\n').find((line) => line.includes('](docs/DETAIL'))
    assert.ok(switchLine, `${readmeFor(locale)} has no language switch line`)

    const links = [...switchLine.matchAll(/\[([^\]]+)\]\((docs\/DETAIL\.[a-z]+\.md)\)/g)].map((m) => ({
      label: m[1],
      path: m[2],
    }))

    // Simplified Chinese is the source language and leads the switch line.
    assert.equal(links[0]?.label, '简体中文', '简体中文 must be the first language in the switch line')
    assert.equal(links[0]?.path, detailFor('zh'), '简体中文 must link to the zh DETAIL document')

    // Exactly the supported languages, no stray ja/日本語 entry.
    assert.equal(links.length, LOCALES.length, 'language switch line must list exactly the supported languages')
    assert.ok(
      !/日本語|DETAIL\.ja\.md|README\.ja\.md/.test(switchLine),
      'language switch line must not contain ja/日本語',
    )
    for (const other of LOCALES) {
      assert.ok(
        links.some((link) => link.path === detailFor(other)),
        `${readmeFor(locale)} switch line does not link to ${detailFor(other)}`,
      )
    }
  })
}

test('every supported language has exactly one locale file', () => {
  const shipped = readdirSync(join(root, 'locale'))
    .filter((name) => name.endsWith('.json'))
    .map((name) => name.slice(0, -'.json'.length))
    .sort()
  assert.deepEqual(shipped, [...LOCALES].sort(), 'locale files do not match the supported language list')
})

test('the icon is declared, packaged and small enough', () => {
  assert.equal(manifest.icon, './assets/icon-180.png')
  const bytes = readFileSync(join(root, manifest.icon))
  assert.ok(bytes.length > 0 && bytes.length <= 256 * 1024, 'icon must stay under 256 KiB')
  assert.deepEqual(
    [...bytes.subarray(0, 8)],
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    'icon is not a PNG file',
  )
  assert.ok(manifest.files.includes('assets/icon-180.png'), 'files omits the icon')
})

test('locale files and their export are declared', () => {
  assert.ok(manifest.files.includes('locale/*.json'), 'files omits the locale files')
  assert.ok(manifest.files.includes('README*.md'), 'files omits the translated READMEs')
  assert.equal(manifest.exports['./locale/*.json'], './locale/*.json')
})

test('relative links in documentation point at files that exist', () => {
  const files = readdirSync(root)
    .filter((name) => name.endsWith('.md'))
    .map((name) => name)
  for (const dir of ['docs', 'docs/en']) {
    for (const name of readdirSync(join(root, dir))) {
      if (name.endsWith('.md')) files.push(`${dir}/${name}`)
    }
  }

  for (const file of files) {
    const text = readFileSync(join(root, file), 'utf8')
    for (const [, target] of text.matchAll(/\]\(([^)\s]+)\)/g)) {
      if (/^(https?:|mailto:|#)/.test(target)) continue
      const path = target.split('#')[0]
      if (!path) continue
      assert.ok(existsSync(resolve(root, dirname(file), decodeURI(path))), `${file} links to missing ${target}`)
    }
  }
})
