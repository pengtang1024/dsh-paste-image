import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import {
  createDocument,
  makeBmp,
  makeBmp8,
  makeBmp16,
  makeBmp32,
  makeRle8Bmp,
  makeRle4Bmp,
  makeDib,
} from './helpers/dom.mjs'

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

test('sniff 认 AVIF / ICO / SVG / 无头 DIB', () => {
  const avif = new Uint8Array(12)
  avif.set([0x66, 0x74, 0x79, 0x70], 4)
  avif.set([0x61, 0x76, 0x69, 0x66], 8)
  assert.equal(api.sniff(avif), 'image/avif')
  assert.equal(api.sniff(new Uint8Array([0, 0, 1, 0, 1, 0])), 'image/x-icon')
  assert.equal(api.sniff(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), 'image/svg')
  assert.equal(api.sniff(makeDib(1, 1, [[1, 2, 3]])), 'image/bmp')
})

test('decodeBmp 解 8 位调色板', () => {
  const bmp = makeBmp8(
    2,
    1,
    [1, 0],
    [
      [0, 0, 0],
      [10, 20, 30],
    ],
  )
  const data = api.decodeBmp(bmp)._image.data
  assert.deepEqual([...data.slice(0, 4)], [10, 20, 30, 255])
  assert.deepEqual([...data.slice(4, 8)], [0, 0, 0, 255])
})

test('decodeBmp 解 16 位 RGB555', () => {
  const bmp = makeBmp16(2, 1, [0x7c00, 0x001f])
  const data = api.decodeBmp(bmp)._image.data
  assert.deepEqual([...data.slice(0, 4)], [255, 0, 0, 255])
  assert.deepEqual([...data.slice(4, 8)], [0, 0, 255, 255])
})

test('decodeBmp 解 RLE8 并保持自底向上顺序', () => {
  const palette = [
    [0, 0, 0],
    [1, 2, 3],
    [4, 5, 6],
    [7, 8, 9],
    [10, 11, 12],
  ]
  const bmp = makeRle8Bmp(4, 2, [2, 1, 2, 2, 0, 0, 2, 3, 2, 4, 0, 1], palette)
  const data = api.decodeBmp(bmp)._image.data
  assert.deepEqual([...data.slice(0, 4)], [7, 8, 9, 255])
  assert.deepEqual([...data.slice(8, 12)], [10, 11, 12, 255])
  assert.deepEqual([...data.slice(16, 20)], [1, 2, 3, 255])
  assert.deepEqual([...data.slice(24, 28)], [4, 5, 6, 255])
})

test('decodeBmp 解 RLE4 游程', () => {
  const palette = [
    [0, 0, 0],
    [1, 1, 1],
    [2, 2, 2],
    [3, 3, 3],
    [4, 4, 4],
  ]
  const bmp = makeRle4Bmp(4, 1, [2, 0x12, 2, 0x34, 0, 1], palette)
  const data = api.decodeBmp(bmp)._image.data
  assert.deepEqual([...data.slice(0, 16)], [1, 1, 1, 255, 2, 2, 2, 255, 3, 3, 3, 255, 4, 4, 4, 255])
})

test('decodeBmp 解无头 DIB', () => {
  const dib = makeDib(2, 1, [
    [255, 0, 0],
    [0, 255, 0],
  ])
  const data = api.decodeBmp(dib)._image.data
  assert.deepEqual([...data.slice(0, 4)], [255, 0, 0, 255])
  assert.deepEqual([...data.slice(4, 8)], [0, 255, 0, 255])
})

test('decodeBmp 把全零 alpha 的 32 位 BMP 当不透明', () => {
  const bmp = makeBmp32(1, 1, [[255, 0, 0]], 0)
  assert.deepEqual([...api.decodeBmp(bmp)._image.data], [255, 0, 0, 255])
})

test('normalize 把声明成 PNG 的无头 DIB 转成 PNG', async () => {
  const dib = makeDib(2, 1, [
    [255, 0, 0],
    [0, 255, 0],
  ])
  const out = await api.normalize(new File([dib], 'wechat.png', { type: 'image/png' }))
  assert.ok(out)
  assert.equal(api.sniff(new Uint8Array(await out.file.arrayBuffer())), 'image/png')
})

test('normalize 给缺少 MIME 的原生图片补上正确类型', async () => {
  const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13])
  const out = await api.normalize(new File([png], 'shot.png', { type: '' }))
  assert.ok(out)
  assert.equal(out.file.type, 'image/png')
  assert.equal(out.file.name, 'shot.png')
})

test('parseBmp 明确拒绝 BI_CMYK 而不是猜通道', () => {
  const bmp = makeBmp(1, 1, [[255, 255, 255]])
  new DataView(bmp.buffer).setUint32(30, 11, true) // BI_CMYK
  assert.throws(() => api.decodeBmp(bmp), /bmp: unsupported compression 11/)
})

test('normalize 对拒绝的 BMP 变体抛错，调用方保留原文件', async () => {
  const bmp = makeBmp(1, 1, [[255, 255, 255]])
  new DataView(bmp.buffer).setUint32(30, 12, true) // BI_CMYKRLE8
  await assert.rejects(api.normalize(new File([bmp], 'print.bmp', { type: 'image/bmp' })), /unsupported compression 12/)
})
