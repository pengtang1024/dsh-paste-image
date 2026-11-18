import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

for (const locale of ['en', 'zh']) {
  test(`locale/${locale}.json carries display metadata`, () => {
    const meta = JSON.parse(readFileSync(join(root, 'locale', `${locale}.json`), 'utf8')).meta
    assert.equal(typeof meta.title, 'string')
    assert.ok(meta.title.trim().length > 2, 'meta.title is missing')
    assert.ok(meta.title.trim().length <= 80, 'meta.title is too long for a plugin row')
    assert.equal(typeof meta.description, 'string')
    assert.ok(meta.description.trim().length > 40, 'meta.description does not explain the capability and its limits')
  })
}

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
  assert.equal(manifest.exports['./locale/*.json'], './locale/*.json')
})
