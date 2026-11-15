import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { createDocument, makeBmp } from './helpers/dom.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const clientPath = join(here, '..', 'client.js')

function load() {
  const context = vm.createContext({
    module: { exports: {} },
    document: createDocument(),
    TextDecoder,
    Blob,
    File,
    Uint8Array,
    Uint8ClampedArray,
    DataView,
    Set,
    Map,
    Promise,
    console,
  })
  vm.runInContext(readFileSync(clientPath, 'utf8'), context, { filename: 'client.js' })
  return context.module.exports
}

const api = load()

test('sniff 识别常见图片魔数', () => {
  assert.equal(api.sniff(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])), 'image/png')
  assert.equal(api.sniff(new Uint8Array([255, 216, 255, 224])), 'image/jpeg')
  assert.equal(api.sniff(new TextEncoder().encode('GIF89a')), 'image/gif')
  assert.equal(api.sniff(new Uint8Array([66, 77, 54, 0])), 'image/bmp')
  assert.equal(api.sniff(new TextEncoder().encode('/* XPM */')), 'image/xpm')
  assert.equal(api.sniff(new TextEncoder().encode('hello')), null)
})

test('isImageCandidate 认声明与扩展名', () => {
  assert.equal(api.isImageCandidate({ type: 'image/xpm', name: 'shot.xpm' }), true)
  assert.equal(api.isImageCandidate({ type: '', name: 'shot.png' }), true)
  assert.equal(api.isImageCandidate({ type: 'text/plain', name: 'notes.txt' }), false)
  assert.equal(api.isImageCandidate(null), false)
})

test('decodeBmp 把 BGR 还原成 RGBA', () => {
  const bmp = makeBmp(2, 1, [
    [255, 0, 0],
    [0, 255, 0],
  ])
  const canvas = api.decodeBmp(bmp)
  assert.equal(canvas.width, 2)
  assert.equal(canvas.height, 1)
  const data = canvas._image.data
  assert.deepEqual([...data.slice(0, 4)], [255, 0, 0, 255])
  assert.deepEqual([...data.slice(4, 8)], [0, 255, 0, 255])
})

test('normalize 把 BMP 字节声称 PNG 的粘贴转成真 PNG', async () => {
  const bmp = makeBmp(2, 2, [
    [255, 0, 0],
    [0, 255, 0],
    [0, 0, 255],
    [255, 255, 255],
  ])
  const file = new File([bmp], 'wechat.png', { type: 'image/png' })
  const out = await api.normalize(file)
  assert.ok(out, 'should convert')
  assert.equal(out.file.type, 'image/png')
  assert.equal(out.file.name, 'wechat.png')
  assert.equal(out.width, 2)
  assert.equal(out.height, 2)
  const bytes = new Uint8Array(await out.file.arrayBuffer())
  assert.equal(api.sniff(bytes), 'image/png')
})

test('normalize 放行真 PNG 不改写', async () => {
  const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13])
  const file = new File([png], 'real.png', { type: 'image/png' })
  assert.equal(await api.normalize(file), null)
})
