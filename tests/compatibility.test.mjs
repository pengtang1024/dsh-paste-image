// 兼容性基线：现代 Chromium/Electron 渲染进程（AbortController、DataTransfer/DragEvent、
// canvas.toBlob、createImageBitmap、Image + URL.createObjectURL 可用）为主路径，并断言这些
// 能力缺失时的优雅降级（粘贴/拖拽仍可安装、转换回退到 data URL、事件不吞掉以保留原生合成器路径）。
// 分组 A（格式/平台）应随当前实现常绿；分组 B（降级契约）在硬化实现落地前允许失败，
// 但它们仍是真实断言，不是 skip，也不为了变绿而放水。
import test from 'node:test'
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import {
  createDocument,
  createEventDocument,
  makeBmp,
  makeBmp8,
  makeBmp16,
  makeBmp32,
  makeRle4Bmp,
  makeRle8Bmp,
  makeDib,
} from './helpers/dom.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const clientPath = join(here, '..', 'client.js')
const clientSource = readFileSync(clientPath, 'utf8')
const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])

// 与 client.test.mjs 相同风格：vm + 最小 DOM 桩；globals 用于按场景注入或省略浏览器 API。
function loadClient({ document = createDocument(), globals = {}, includeAbortController = true } = {}) {
  const context = {
    module: { exports: {} },
    document,
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
    ...globals,
  }
  if (includeAbortController) context.AbortController = AbortController
  vm.createContext(context)
  vm.runInContext(clientSource, context, { filename: 'client.js' })
  return context.module.exports
}

function encode(text) {
  return new TextEncoder().encode(text)
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitFor(predicate, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return true
    await delay(5)
  }
  return predicate()
}

const api = loadClient()

// ---------- 本地 BMP 变体构造器（helpers 没有覆盖的 1/4 位、OS/2 core、BITFIELDS） ----------

function makeIndexedBmp(width, height, bpp, indices, palette) {
  const stride = ((bpp * width + 31) >> 5) << 2
  const offset = 54 + palette.length * 4
  const bytes = new Uint8Array(offset + stride * height)
  const dv = new DataView(bytes.buffer)
  bytes[0] = 0x42
  bytes[1] = 0x4d
  dv.setUint32(2, bytes.length, true)
  dv.setUint32(10, offset, true)
  dv.setUint32(14, 40, true)
  dv.setInt32(18, width, true)
  dv.setInt32(22, height, true)
  dv.setUint16(26, 1, true)
  dv.setUint16(28, bpp, true)
  dv.setUint32(34, stride * height, true)
  dv.setUint32(46, palette.length, true)
  palette.forEach(([r, g, b], i) => {
    const o = 54 + i * 4
    bytes[o] = b
    bytes[o + 1] = g
    bytes[o + 2] = r
  })
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = indices[y * width + x] & 0xff
      const row = offset + (height - 1 - y) * stride
      if (bpp === 8) bytes[row + x] = index
      else if (bpp === 4) bytes[row + (x >> 1)] |= x & 1 ? index & 0x0f : (index & 0x0f) << 4
      else bytes[row + (x >> 3)] |= (index & 1) << (7 - (x & 7))
    }
  }
  return bytes
}

function makeCoreHeaderBmp(width, height, bpp, pixels, palette = []) {
  const stride = ((bpp * width + 31) >> 5) << 2
  const offset = 14 + 12 + (bpp <= 8 ? palette.length * 3 : 0)
  const bytes = new Uint8Array(offset + stride * height)
  const dv = new DataView(bytes.buffer)
  bytes[0] = 0x42
  bytes[1] = 0x4d
  dv.setUint32(2, bytes.length, true)
  dv.setUint32(10, offset, true)
  dv.setUint32(14, 12, true)
  dv.setUint16(18, width, true)
  dv.setUint16(20, height, true)
  dv.setUint16(22, 1, true)
  dv.setUint16(24, bpp, true)
  palette.forEach(([r, g, b], i) => {
    const o = 26 + i * 3
    bytes[o] = b
    bytes[o + 1] = g
    bytes[o + 2] = r
  })
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const value = pixels[y * width + x]
      const row = offset + (height - 1 - y) * stride
      if (bpp === 24) {
        bytes[row + x * 3] = value[2]
        bytes[row + x * 3 + 1] = value[1]
        bytes[row + x * 3 + 2] = value[0]
      } else {
        bytes[row + x] = value
      }
    }
  }
  return bytes
}

function makeBitfieldsBmp(width, height, values, { alpha = false } = {}) {
  const maskCount = alpha ? 4 : 3
  const offset = 54 + maskCount * 4
  const bytes = new Uint8Array(offset + width * height * 4)
  const dv = new DataView(bytes.buffer)
  bytes[0] = 0x42
  bytes[1] = 0x4d
  dv.setUint32(2, bytes.length, true)
  dv.setUint32(10, offset, true)
  dv.setUint32(14, 40, true)
  dv.setInt32(18, width, true)
  dv.setInt32(22, height, true)
  dv.setUint16(26, 1, true)
  dv.setUint16(28, 32, true)
  dv.setUint32(30, alpha ? 6 : 3, true) // BI_ALPHABITFIELDS / BI_BITFIELDS
  dv.setUint32(34, width * height * 4, true)
  dv.setUint32(54, 0x00ff0000, true)
  dv.setUint32(58, 0x0000ff00, true)
  dv.setUint32(62, 0x000000ff, true)
  if (alpha) dv.setUint32(66, 0xff000000, true)
  values.forEach((value, i) => dv.setUint32(offset + i * 4, value, true))
  return bytes
}

// ---------- 浏览器 API 桩 / 事件夹具 ----------

class DataTransferStub {
  constructor() {
    this.files = []
    this.items = {
      add: (file) => {
        this.files.push(file)
      },
    }
  }
}

class DragEventStub {
  constructor(type, init = {}) {
    this.type = type
    Object.assign(this, init)
  }
}

class FakeImage {
  constructor() {
    this.naturalWidth = 0
    this.naturalHeight = 0
  }

  set src(value) {
    this._src = value
    queueMicrotask(() => {
      if (this.onload) this.onload()
    })
  }

  get src() {
    return this._src
  }
}

const fakeUrl = {
  createObjectURL() {
    return 'blob:compat-test'
  },
  revokeObjectURL() {},
}

function createDocumentWithoutToBlob() {
  const document = createDocument()
  const dataUrl = 'data:image/png;base64,' + Buffer.from(PNG_SIGNATURE).toString('base64')
  return {
    ...document,
    createElement(tag) {
      const element = document.createElement(tag)
      if (tag === 'canvas') {
        delete element.toBlob
        element.toDataURL = () => dataUrl
      }
      return element
    },
  }
}

function makePasteEvent(files) {
  return {
    defaultPrevented: false,
    propagationStopped: false,
    clipboardData: { files },
    preventDefault() {
      this.defaultPrevented = true
    },
    stopPropagation() {
      this.propagationStopped = true
    },
  }
}

function createHarness() {
  const document = createEventDocument()
  // 事件桩只记录监听器，转换还需要 canvas 桩：两者合并成同一个文档对象。
  Object.assign(document, createDocument())
  // 真实合成器卡片：client.js 只在 querySelector('[data-composer-card]') 命中时才接管粘贴，
  // 并把结果 drop 派发到这个元素上，而不是 document.body。
  const dropEvents = []
  const card = {
    dispatchEvent(event) {
      dropEvents.push(event)
      return true
    },
  }
  document.querySelector = (selector) => (selector === '[data-composer-card]' ? card : null)
  document.body.dispatchEvent = () => {
    throw new Error('reroute 必须派发到 composer card，不得落到 document.body')
  }
  const client = loadClient({ document, globals: { DataTransfer: DataTransferStub, DragEvent: DragEventStub } })
  const dispose = client.install()
  const paste = document.listeners.find((entry) => entry.type === 'paste').listener
  return { document, client, dispose, paste, dropEvents, card }
}

// ============================ A. 格式 / 平台兼容 ============================

test('兼容性 A：无头 DIB (CF_DIB) 可嗅探并按 BGR 解码', () => {
  const dib = makeDib(2, 1, [
    [255, 0, 0],
    [0, 255, 0],
  ])
  assert.equal(api.sniff(dib), 'image/bmp')
  const canvas = api.decodeBmp(dib)
  assert.equal(canvas.width, 2)
  assert.equal(canvas.height, 1)
  const data = canvas._image.data
  assert.deepEqual([...data.slice(0, 4)], [255, 0, 0, 255])
  assert.deepEqual([...data.slice(4, 8)], [0, 255, 0, 255])
})

test('兼容性 A：1 位 BMP 调色板索引解码', () => {
  const bmp = makeIndexedBmp(
    4,
    1,
    1,
    [1, 0, 1, 0],
    [
      [0, 0, 0],
      [255, 255, 255],
    ],
  )
  assert.equal(api.sniff(bmp), 'image/bmp')
  const canvas = api.decodeBmp(bmp)
  assert.equal(canvas.width, 4)
  assert.equal(canvas.height, 1)
  const data = canvas._image.data
  assert.deepEqual([...data.slice(0, 4)], [255, 255, 255, 255])
  assert.deepEqual([...data.slice(4, 8)], [0, 0, 0, 255])
  assert.deepEqual([...data.slice(8, 12)], [255, 255, 255, 255])
  assert.deepEqual([...data.slice(12, 16)], [0, 0, 0, 255])
})

test('兼容性 A：4 位 BMP 半字节调色板解码', () => {
  const bmp = makeIndexedBmp(
    4,
    1,
    4,
    [0, 1, 2, 3],
    [
      [0, 0, 0],
      [10, 20, 30],
      [40, 50, 60],
      [70, 80, 90],
    ],
  )
  assert.equal(api.sniff(bmp), 'image/bmp')
  const canvas = api.decodeBmp(bmp)
  assert.equal(canvas.width, 4)
  assert.equal(canvas.height, 1)
  const data = canvas._image.data
  assert.deepEqual([...data.slice(0, 4)], [0, 0, 0, 255])
  assert.deepEqual([...data.slice(4, 8)], [10, 20, 30, 255])
  assert.deepEqual([...data.slice(8, 12)], [40, 50, 60, 255])
  assert.deepEqual([...data.slice(12, 16)], [70, 80, 90, 255])
})

test('兼容性 A：8 位 BMP 调色板解码', () => {
  const bmp = makeBmp8(
    2,
    1,
    [1, 0],
    [
      [0, 0, 0],
      [10, 20, 30],
    ],
  )
  assert.equal(api.sniff(bmp), 'image/bmp')
  const canvas = api.decodeBmp(bmp)
  assert.equal(canvas.width, 2)
  assert.equal(canvas.height, 1)
  const data = canvas._image.data
  assert.deepEqual([...data.slice(0, 4)], [10, 20, 30, 255])
  assert.deepEqual([...data.slice(4, 8)], [0, 0, 0, 255])
})

test('兼容性 A：16 位 RGB555 BMP 解码', () => {
  const bmp = makeBmp16(2, 1, [0x7c00, 0x001f])
  assert.equal(api.sniff(bmp), 'image/bmp')
  const canvas = api.decodeBmp(bmp)
  assert.equal(canvas.width, 2)
  assert.equal(canvas.height, 1)
  const data = canvas._image.data
  assert.deepEqual([...data.slice(0, 4)], [255, 0, 0, 255])
  assert.deepEqual([...data.slice(4, 8)], [0, 0, 255, 255])
})

test('兼容性 A：24 位 BMP 自底向上解码尺寸与像素', () => {
  const bmp = makeBmp(2, 2, [
    [255, 0, 0],
    [0, 255, 0],
    [0, 0, 255],
    [255, 255, 255],
  ])
  assert.equal(api.sniff(bmp), 'image/bmp')
  const canvas = api.decodeBmp(bmp)
  assert.equal(canvas.width, 2)
  assert.equal(canvas.height, 2)
  const data = canvas._image.data
  assert.deepEqual([...data.slice(0, 4)], [255, 0, 0, 255])
  assert.deepEqual([...data.slice(4, 8)], [0, 255, 0, 255])
  assert.deepEqual([...data.slice(8, 12)], [0, 0, 255, 255])
  assert.deepEqual([...data.slice(12, 16)], [255, 255, 255, 255])
})

test('兼容性 A：32 位 BMP 保留 alpha，全零 alpha 视为不透明', () => {
  const withAlpha = makeBmp32(
    2,
    1,
    [
      [10, 20, 30],
      [40, 50, 60],
    ],
    200,
  )
  const opaque = api.decodeBmp(withAlpha)._image.data
  assert.deepEqual([...opaque.slice(0, 4)], [10, 20, 30, 200])
  assert.deepEqual([...opaque.slice(4, 8)], [40, 50, 60, 200])
  const zeroAlpha = makeBmp32(1, 1, [[255, 0, 0]], 0)
  assert.deepEqual([...api.decodeBmp(zeroAlpha)._image.data], [255, 0, 0, 255])
})

test('兼容性 A：RLE8 BMP 游程解码', () => {
  const palette = [
    [0, 0, 0],
    [7, 8, 9],
  ]
  const bmp = makeRle8Bmp(2, 1, [2, 1, 0, 1], palette)
  assert.equal(api.sniff(bmp), 'image/bmp')
  const canvas = api.decodeBmp(bmp)
  assert.equal(canvas.width, 2)
  assert.equal(canvas.height, 1)
  const data = canvas._image.data
  assert.deepEqual([...data.slice(0, 4)], [7, 8, 9, 255])
  assert.deepEqual([...data.slice(4, 8)], [7, 8, 9, 255])
})

test('兼容性 A：RLE4 BMP 半字节游程解码', () => {
  const palette = [
    [0, 0, 0],
    [1, 1, 1],
    [2, 2, 2],
  ]
  const bmp = makeRle4Bmp(4, 1, [4, 0x12, 0, 1], palette)
  assert.equal(api.sniff(bmp), 'image/bmp')
  const data = api.decodeBmp(bmp)._image.data
  assert.deepEqual([...data.slice(0, 16)], [1, 1, 1, 255, 2, 2, 2, 255, 1, 1, 1, 255, 2, 2, 2, 255])
})

test('兼容性 A：OS/2 12 字节 core header BMP（24 位与 8 位调色板）', () => {
  const rgb = makeCoreHeaderBmp(2, 1, 24, [
    [255, 0, 0],
    [0, 255, 0],
  ])
  assert.equal(api.sniff(rgb), 'image/bmp')
  const rgbCanvas = api.decodeBmp(rgb)
  assert.equal(rgbCanvas.width, 2)
  assert.equal(rgbCanvas.height, 1)
  const rgbData = rgbCanvas._image.data
  assert.deepEqual([...rgbData.slice(0, 4)], [255, 0, 0, 255])
  assert.deepEqual([...rgbData.slice(4, 8)], [0, 255, 0, 255])

  const indexed = makeCoreHeaderBmp(
    2,
    1,
    8,
    [1, 0],
    [
      [0, 0, 0],
      [10, 20, 30],
    ],
  )
  const indexedData = api.decodeBmp(indexed)._image.data
  assert.deepEqual([...indexedData.slice(0, 4)], [10, 20, 30, 255])
  assert.deepEqual([...indexedData.slice(4, 8)], [0, 0, 0, 255])
})

test('兼容性 A：BI_BITFIELDS 位域解析', () => {
  const bmp = makeBitfieldsBmp(2, 1, [0x00ff0000, 0x000000ff])
  const canvas = api.decodeBmp(bmp)
  assert.equal(canvas.width, 2)
  assert.equal(canvas.height, 1)
  const data = canvas._image.data
  assert.deepEqual([...data.slice(0, 4)], [255, 0, 0, 255])
  assert.deepEqual([...data.slice(4, 8)], [0, 0, 255, 255])
})

test('兼容性 A：BI_ALPHABITFIELDS 保留 alpha 位域', () => {
  const bmp = makeBitfieldsBmp(1, 1, [0x8000ff00], { alpha: true })
  assert.deepEqual([...api.decodeBmp(bmp)._image.data], [0, 255, 0, 128])
})

test('兼容性 A：嗅探 TIFF / HEIC / AVIF / SVG / ICO / XPM', () => {
  assert.equal(api.sniff(new Uint8Array([0x49, 0x49, 0x2a, 0x00, 8, 0, 0, 0])), 'image/tiff')
  assert.equal(api.sniff(new Uint8Array([0x4d, 0x4d, 0x00, 0x2a, 0, 0, 0, 8])), 'image/tiff')

  const heic = new Uint8Array(16)
  heic.set(encode('ftyp'), 4)
  heic.set(encode('heic'), 8)
  assert.equal(api.sniff(heic), 'image/heic')

  const avif = new Uint8Array(16)
  avif.set(encode('ftyp'), 4)
  avif.set(encode('avif'), 8)
  assert.equal(api.sniff(avif), 'image/avif')

  assert.equal(api.sniff(encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), 'image/svg')
  assert.equal(api.sniff(encode('\n  <svg viewBox="0 0 1 1"></svg>')), 'image/svg')
  assert.equal(api.sniff(new Uint8Array([0, 0, 1, 0, 1, 0, 0, 0])), 'image/x-icon')
  assert.equal(api.sniff(encode('/* XPM */\nstatic char *x[] = {')), 'image/xpm')
  assert.equal(api.sniff(encode('not an image')), null)
})

test('兼容性 A：MIME 别名按规范类型判定（image/jpg、image/x-png、image/x-bmp、image/x-xpixmap、image/svg+xml）', async () => {
  const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13])
  const jpeg = new Uint8Array([255, 216, 255, 224, 0, 16, 0, 0])
  assert.equal(await api.normalize(new File([png], 'alias.png', { type: 'image/x-png' })), null)
  assert.equal(await api.normalize(new File([jpeg], 'alias.jpg', { type: 'image/jpg' })), null)

  const bmp = makeBmp(1, 1, [[1, 2, 3]])
  const bmpOut = await api.normalize(new File([bmp], 'alias.bmp', { type: 'image/x-bmp' }))
  assert.ok(bmpOut)
  assert.equal(bmpOut.from, 'image/bmp')
  assert.equal(bmpOut.to, 'image/png')

  const xpmOut = await api.normalize(
    new File(
      [encode('/* XPM */\nstatic char *x[] = {\n"2 1 2 1",\n"a c #ff0000",\n"b c #00ff00",\n"ab"\n};\n')],
      'alias.xpm',
      { type: 'image/x-xpixmap' },
    ),
  )
  assert.ok(xpmOut)
  assert.equal(xpmOut.from, 'image/xpm')
  assert.equal(xpmOut.width, 2)

  const svgClient = loadClient({ document: createDocument(), globals: { Image: FakeImage, URL: fakeUrl } })
  const svgOut = await svgClient.normalize(
    new File([encode('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"></svg>')], 'alias.svg', {
      type: 'image/svg+xml',
    }),
  )
  assert.ok(svgOut)
  assert.equal(svgOut.from, 'image/svg')
  assert.equal(svgOut.width, 40)
  assert.equal(svgOut.height, 20)
})

test('兼容性 A：BMP 字节声明为 image/png 时重新编码为真 PNG', async () => {
  const bmp = makeBmp(2, 2, [
    [255, 0, 0],
    [0, 255, 0],
    [0, 0, 255],
    [255, 255, 255],
  ])
  const out = await api.normalize(new File([bmp], 'wechat.png', { type: 'image/png' }))
  assert.ok(out)
  assert.equal(out.file.type, 'image/png')
  assert.equal(out.file.name, 'wechat.png')
  assert.equal(out.width, 2)
  assert.equal(out.height, 2)
  assert.equal(api.sniff(new Uint8Array(await out.file.arrayBuffer())), 'image/png')
})

test('兼容性 A：8 个文件仍走转换，9 个以上文件交回原生路径', async () => {
  const harness = createHarness()
  try {
    const eight = Array.from(
      { length: 8 },
      (_, index) =>
        new File([makeBmp(1, 1, [[index * 10, 0, 0]])], `img${index}.bmp`, {
          type: 'image/bmp',
        }),
    )
    const convertedEvent = makePasteEvent(eight)
    harness.paste(convertedEvent)
    assert.equal(await waitFor(() => harness.dropEvents.length === 1), true, '8 个文件应触发一次 reroute')
    assert.equal(convertedEvent.defaultPrevented, true)
    const converted = harness.dropEvents[0].dataTransfer.files
    assert.equal(converted.length, 8)
    assert.equal(
      converted.every((file) => file.type === 'image/png'),
      true,
    )
    assert.equal(api.sniff(new Uint8Array(await converted[0].arrayBuffer())), 'image/png')

    const nine = Array.from(
      { length: 9 },
      (_, index) =>
        new File([makeBmp(1, 1, [[index, 0, 0]])], `over${index}.bmp`, {
          type: 'image/bmp',
        }),
    )
    const nativeEvent = makePasteEvent(nine)
    harness.paste(nativeEvent)
    await delay(50)
    assert.equal(harness.dropEvents.length, 1, '9 个文件不应被本插件 reroute')
    assert.equal(nativeEvent.defaultPrevented, false)
    assert.equal(nativeEvent.__dshPasteImageHandled, undefined)
  } finally {
    harness.dispose()
  }
})

test('兼容性 A：非图片文件原样透传，图片按需转换', async () => {
  const harness = createHarness()
  try {
    const bmp = new File(
      [
        makeBmp(2, 1, [
          [255, 0, 0],
          [0, 255, 0],
        ]),
      ],
      'shot.bmp',
      { type: 'image/bmp' },
    )
    const text = new File(['hello'], 'notes.txt', { type: 'text/plain' })
    const event = makePasteEvent([bmp, text])
    harness.paste(event)
    assert.equal(await waitFor(() => harness.dropEvents.length === 1), true)
    assert.equal(event.defaultPrevented, true)
    const out = harness.dropEvents[0].dataTransfer.files
    assert.equal(out.length, 2)
    assert.equal(out[0].type, 'image/png')
    assert.equal(api.sniff(new Uint8Array(await out[0].arrayBuffer())), 'image/png')
    assert.equal(out[1], text)
    assert.equal(out[1].type, 'text/plain')
    assert.equal(out[1].name, 'notes.txt')
  } finally {
    harness.dispose()
  }
})

// ============================ B. 优雅降级兼容 ============================

test('兼容性 B 降级：缺少 AbortController 时 install 仍挂载 paste/drop，dispose 可卸载', () => {
  const document = createEventDocument()
  const client = loadClient({ document, includeAbortController: false })
  const dispose = client.install()
  assert.equal(typeof dispose, 'function')
  assert.deepEqual(
    document.listeners.map((entry) => entry.type),
    ['paste', 'drop'],
  )
  dispose()
  assert.equal(document.listeners.length, 0)
})

test('兼容性 B 降级：缺少 canvas.toBlob 时回退到 toDataURL 生成 PNG Blob', async () => {
  const client = loadClient({ document: createDocumentWithoutToBlob() })
  const bmp = makeBmp(2, 1, [
    [255, 0, 0],
    [0, 255, 0],
  ])
  const out = await client.normalize(new File([bmp], 'shot.bmp', { type: 'image/bmp' }))
  assert.ok(out)
  assert.equal(out.file.type, 'image/png')
  assert.equal(out.file.name, 'shot.png')
  assert.equal(out.width, 2)
  assert.equal(out.height, 1)
  assert.equal(client.sniff(new Uint8Array(await out.file.arrayBuffer())), 'image/png')
})

test('兼容性 B 降级：有构造器但没有 [data-composer-card] 时不接管粘贴，保留原生路径', async () => {
  const document = createEventDocument()
  // 有 canvas 能力也不影响判定：缺失合成器卡片必须直接放手。
  Object.assign(document, createDocument())
  assert.equal(document.querySelector('[data-composer-card]'), null)
  const dispatched = []
  document.body.dispatchEvent = (event) => {
    dispatched.push(event)
    return true
  }
  const client = loadClient({ document, globals: { DataTransfer: DataTransferStub, DragEvent: DragEventStub } })
  const dispose = client.install()
  try {
    const paste = document.listeners.find((entry) => entry.type === 'paste').listener
    const bmp = makeBmp(1, 1, [[255, 0, 0]])
    const event = makePasteEvent([new File([bmp], 'shot.bmp', { type: 'image/bmp' })])
    paste(event)
    await delay(50)
    assert.equal(event.__dshPasteImageHandled, undefined, '没有合成器卡片时不得 claim')
    assert.equal(event.defaultPrevented, false)
    assert.equal(event.propagationStopped, false)
    assert.equal(dispatched.length, 0, '没有合成器卡片时不得派发合成 drop')
  } finally {
    dispose()
  }
})

test('兼容性 B 降级：缺少 DataTransfer/DragEvent 时不 claim/preventDefault，保留原生合成器路径', async () => {
  const document = createEventDocument()
  const client = loadClient({ document })
  const dispose = client.install()
  try {
    const paste = document.listeners.find((entry) => entry.type === 'paste').listener
    // 转换阶段用永不 settle 的 arrayBuffer 占位：本用例只看同步的事件归属判定，
    // 避免当前实现走到 reroute 时产生与本断言无关的异步异常。
    const never = new Promise(() => {})
    const event = makePasteEvent([{ type: 'image/bmp', name: 'pending.bmp', arrayBuffer: () => never }])
    paste(event)
    await delay(20)
    assert.equal(event.__dshPasteImageHandled, undefined)
    assert.equal(event.defaultPrevented, false)
    assert.equal(event.propagationStopped, false)
  } finally {
    dispose()
  }
})
