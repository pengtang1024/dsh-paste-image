import test from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { createDocument, createEventDocument, makeBmp } from './helpers/dom.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const clientPath = join(here, '..', 'client.js')
const source = readFileSync(clientPath, 'utf8')

const SETTINGS_KEY = 'dsh-paste-image.settings.v1'

// 默认值必须等于引入配置页之前的硬编码行为（见 client.js 里的 SETTINGS_DEFAULTS）。
const DEFAULTS = {
  enabled: true,
  maxFiles: 8,
  maxSide: 4096,
  outputFormat: 'png',
  quality: 0.92,
  convertXpm: true,
  convertBmp: true,
  convertSvg: true,
  convertIco: true,
  logConversions: true,
}

// vm 里创建的对象属于另一个 realm，deepEqual 前先转成当前 realm 的纯 JSON。
function plain(value) {
  return JSON.parse(JSON.stringify(value))
}

function createStorage(seed = {}) {
  const data = new Map(Object.entries(seed))
  const writes = []
  return {
    writes,
    getItem(key) {
      return data.has(key) ? data.get(key) : null
    },
    setItem(key, value) {
      const text = String(value)
      data.set(key, text)
      writes.push({ key, value: text })
    },
    removeItem(key) {
      data.delete(key)
    },
  }
}

function load(options = {}) {
  const logs = []
  const record = (...args) => {
    logs.push(args.join(' '))
  }
  const sandbox = {
    module: { exports: {} },
    document: options.document || createDocument(),
    AbortController,
    TextDecoder,
    Blob,
    File,
    Uint8Array,
    Uint8ClampedArray,
    DataView,
    Set,
    Map,
    Promise,
    console: { debug: record, log: record, warn: record, error: record, info: record },
  }
  if (options.localStorage !== undefined) sandbox.localStorage = options.localStorage
  if (options.window !== undefined) sandbox.window = options.window
  if (options.DataTransfer !== undefined) sandbox.DataTransfer = options.DataTransfer
  if (options.DragEvent !== undefined) sandbox.DragEvent = options.DragEvent
  const context = vm.createContext(sandbox)
  vm.runInContext(source, context, { filename: 'client.js' })
  return { api: context.module.exports, context, logs }
}

function pngBytes() {
  return new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13])
}

function pngFile(name) {
  return new File([pngBytes()], name, { type: 'image/png' })
}

// 格式转换专用文档桩：记录 canvas 创建顺序与 toBlob 的实参，并可按请求的 MIME 返回 blob。
function createFormatDocument(options = {}) {
  const canvases = []
  const blobCalls = []
  const document = {
    canvases,
    blobCalls,
    createElement(tag) {
      if (tag !== 'canvas') return {}
      const canvas = {
        width: 0,
        height: 0,
        _image: null,
        getContext() {
          return {
            createImageData(w, h) {
              return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }
            },
            putImageData(image) {
              canvas._image = image
            },
            drawImage() {},
            getImageData() {
              return { data: new Uint8ClampedArray([0, 0, 0, 255]) }
            },
            clearRect() {},
            fillRect() {},
            set fillStyle(value) {
              this._fill = value
            },
            get fillStyle() {
              return this._fill === undefined ? '#000000' : this._fill
            },
          }
        },
        toBlob(callback, type, quality) {
          blobCalls.push({ type, quality, argCount: arguments.length })
          const actual = options.actualType ? options.actualType(type) : type || 'image/png'
          callback(new Blob([pngBytes()], { type: actual }))
        },
      }
      canvases.push(canvas)
      return canvas
    },
  }
  return document
}

function bmpFile(name = 'wechat.png') {
  const bmp = makeBmp(2, 2, [
    [255, 0, 0],
    [0, 255, 0],
    [0, 0, 255],
    [255, 255, 255],
  ])
  return new File([bmp], name, { type: 'image/png' })
}

async function convertBmpWith(patch, options = {}) {
  const formatDocument = createFormatDocument(options)
  const { api } = load({ document: formatDocument })
  api.applySettings(patch)
  const out = await api.normalize(bmpFile(options.fileName))
  return { out, formatDocument, api }
}

// ---------- 设置读写 ----------

test('getSettings 返回引入配置页之前的默认值', () => {
  const { api } = load()
  assert.deepEqual(plain(api.getSettings()), DEFAULTS)
})

test('applySettings 把 maxFiles 夹到 1..8', () => {
  const { api } = load()
  assert.equal(api.applySettings({ maxFiles: 0 }).maxFiles, 1)
  assert.equal(api.applySettings({ maxFiles: 99 }).maxFiles, 8)
  assert.equal(api.applySettings({ maxFiles: 5 }).maxFiles, 5)
})

test('applySettings 把 maxSide 夹到 512..8192', () => {
  const { api } = load()
  assert.equal(api.applySettings({ maxSide: 100 }).maxSide, 512)
  assert.equal(api.applySettings({ maxSide: 999999 }).maxSide, 8192)
  assert.equal(api.applySettings({ maxSide: 2048 }).maxSide, 2048)
})

test('applySettings 对小数先取整再夹区间', () => {
  const { api } = load()
  assert.equal(api.applySettings({ maxFiles: 2.6 }).maxFiles, 3)
  assert.equal(api.applySettings({ maxFiles: 2.4 }).maxFiles, 2)
  assert.equal(api.applySettings({ maxSide: 700.6 }).maxSide, 701)
  assert.equal(api.applySettings({ maxSide: 700.4 }).maxSide, 700)
})

test('applySettings 把布尔字段强转成布尔值', () => {
  const { api } = load()
  const next = api.applySettings({
    enabled: 0,
    convertXpm: '',
    convertBmp: 1,
    convertSvg: 'yes',
    logConversions: 0,
  })
  assert.equal(next.enabled, false)
  assert.equal(next.convertXpm, false)
  assert.equal(next.convertBmp, true)
  assert.equal(next.convertSvg, true)
  assert.equal(next.logConversions, false)
  for (const key of ['enabled', 'convertXpm', 'convertBmp', 'convertSvg', 'logConversions']) {
    assert.equal(typeof next[key], 'boolean')
  }
})

test('applySettings 局部更新保留其他字段（含 outputFormat/quality）', () => {
  const { api } = load()
  api.applySettings({ maxSide: 2048, convertSvg: false, outputFormat: 'jpeg', quality: 0.5 })
  const expected = {
    ...DEFAULTS,
    maxSide: 2048,
    convertSvg: false,
    outputFormat: 'jpeg',
    quality: 0.5,
    maxFiles: 2,
  }
  assert.deepEqual(plain(api.applySettings({ maxFiles: 2 })), expected)
  assert.deepEqual(plain(api.getSettings()), expected)

  // 再改一个字段，outputFormat/quality 仍应原样保留。
  const kept = plain(api.applySettings({ quality: 0.75 }))
  assert.equal(kept.outputFormat, 'jpeg')
  assert.equal(kept.quality, 0.75)
})

test('applySettings 写入固定 key，新实例从 localStorage 读回同一份设置', () => {
  const storage = createStorage()
  const first = load({ localStorage: storage })
  const expected = {
    ...DEFAULTS,
    maxFiles: 3,
    maxSide: 2048,
    outputFormat: 'webp',
    quality: 0.7,
    convertSvg: false,
    logConversions: false,
  }
  first.api.applySettings({
    maxFiles: 3,
    maxSide: 2048,
    outputFormat: 'webp',
    quality: 0.7,
    convertSvg: false,
    logConversions: false,
  })

  const write = storage.writes.find((entry) => entry.key === SETTINGS_KEY)
  assert.ok(write, `必须写入 ${SETTINGS_KEY}`)
  assert.deepEqual(JSON.parse(write.value), expected)

  const second = load({ localStorage: storage })
  assert.deepEqual(plain(second.api.getSettings()), expected)
})

test('损坏的 JSON 与越界的历史值都回退到安全默认', () => {
  const broken = load({ localStorage: createStorage({ [SETTINGS_KEY]: '{"maxFiles":' }) })
  const brokenSettings = plain(broken.api.getSettings())
  assert.deepEqual(brokenSettings, DEFAULTS)
  assert.equal(brokenSettings.outputFormat, 'png')
  assert.equal(brokenSettings.quality, 0.92)

  const stale = load({
    localStorage: createStorage({ [SETTINGS_KEY]: JSON.stringify({ maxFiles: 99, enabled: false }) }),
  })
  assert.deepEqual(plain(stale.api.getSettings()), { ...DEFAULTS, maxFiles: 8, enabled: false })
})

test('旧版 localStorage 只有 enabled/maxFiles 时补齐 outputFormat 与 quality 默认值', () => {
  const legacy = load({
    localStorage: createStorage({ [SETTINGS_KEY]: JSON.stringify({ enabled: false, maxFiles: 3 }) }),
  })
  const settings = plain(legacy.api.getSettings())
  assert.deepEqual(settings, { ...DEFAULTS, enabled: false, maxFiles: 3 })
  assert.equal(settings.outputFormat, 'png')
  assert.equal(settings.quality, 0.92)
})

test('localStorage 抛错时退回内存设置且不崩溃', () => {
  const throwing = {
    getItem() {
      throw new Error('blocked')
    },
    setItem() {
      throw new Error('blocked')
    },
    removeItem() {
      throw new Error('blocked')
    },
  }
  const first = load({ localStorage: throwing })
  const defaults = plain(first.api.getSettings())
  assert.deepEqual(defaults, DEFAULTS)
  assert.equal(defaults.outputFormat, 'png')
  assert.equal(defaults.quality, 0.92)
  assert.equal(first.api.applySettings({ maxSide: 2048 }).maxSide, 2048)
  assert.deepEqual(plain(first.api.getSettings()), { ...DEFAULTS, maxSide: 2048 })

  const second = load({ localStorage: throwing })
  assert.deepEqual(plain(second.api.getSettings()), DEFAULTS)
})

test('resetSettings 恢复全部默认值（含 outputFormat/quality）并写回 storage', () => {
  const storage = createStorage()
  const { api } = load({ localStorage: storage })
  api.applySettings({
    enabled: false,
    maxFiles: 2,
    maxSide: 1024,
    outputFormat: 'webp',
    quality: 0.3,
    convertBmp: false,
    convertSvg: false,
    convertIco: false,
    logConversions: false,
  })

  const reset = plain(api.resetSettings())
  assert.deepEqual(reset, DEFAULTS)
  assert.equal(reset.outputFormat, 'png')
  assert.equal(reset.quality, 0.92)
  assert.deepEqual(plain(api.getSettings()), DEFAULTS)

  const write = storage.writes[storage.writes.length - 1]
  assert.equal(write.key, SETTINGS_KEY)
  assert.deepEqual(JSON.parse(write.value), DEFAULTS)
})

// ---------- 输出格式与质量 ----------

test('非法 outputFormat 回退 png，枚举值大小写归一', () => {
  const { api } = load()
  assert.equal(api.applySettings({ outputFormat: 'gif' }).outputFormat, 'png')
  assert.equal(api.applySettings({ outputFormat: 42 }).outputFormat, 'png')
  assert.equal(api.applySettings({ outputFormat: 'WEBP' }).outputFormat, 'webp')
  assert.equal(api.applySettings({ outputFormat: 'JPEG' }).outputFormat, 'jpeg')
})

test('quality 先按两位小数取整再夹到 0.1..1', () => {
  const { api } = load()
  assert.equal(api.applySettings({ quality: 0 }).quality, 0.1)
  assert.equal(api.applySettings({ quality: 2 }).quality, 1)
  assert.equal(api.applySettings({ quality: 0.456 }).quality, 0.46)
  assert.equal(api.applySettings({ quality: 0.923 }).quality, 0.92)
})

test('outputFormat=jpeg 时 BMP 冒充 PNG 转成 JPEG，quality 传给 toBlob', async () => {
  const { out, formatDocument } = await convertBmpWith({ outputFormat: 'jpeg', quality: 0.5 })
  assert.ok(out)
  assert.equal(out.file.type, 'image/jpeg')
  assert.equal(out.file.name.endsWith('.jpg'), true)
  assert.equal(out.to, 'image/jpeg')
  assert.equal(formatDocument.blobCalls.length, 1)
  assert.deepEqual(formatDocument.blobCalls[0], { type: 'image/jpeg', quality: 0.5, argCount: 3 })
})

test('outputFormat=webp 时 BMP 冒充 PNG 转成 WebP，quality 传给 toBlob', async () => {
  const { out, formatDocument } = await convertBmpWith({ outputFormat: 'webp', quality: 0.5 })
  assert.ok(out)
  assert.equal(out.file.type, 'image/webp')
  assert.equal(out.file.name.endsWith('.webp'), true)
  assert.equal(out.to, 'image/webp')
  assert.equal(formatDocument.blobCalls.length, 1)
  assert.deepEqual(formatDocument.blobCalls[0], { type: 'image/webp', quality: 0.5, argCount: 3 })
})

test('默认 outputFormat=png 时输出 PNG，toBlob 只收 mime 不收 quality', async () => {
  const { out, formatDocument } = await convertBmpWith({})
  assert.ok(out)
  assert.equal(out.file.type, 'image/png')
  assert.equal(out.file.name.endsWith('.png'), true)
  assert.equal(out.to, 'image/png')
  assert.equal(formatDocument.blobCalls.length, 1)
  assert.equal(formatDocument.blobCalls[0].type, 'image/png')
  assert.equal(formatDocument.blobCalls[0].argCount, 2)
  assert.equal(formatDocument.blobCalls[0].quality, undefined)
})

test('请求 jpeg 但 canvas 实际返回 PNG 时以实际类型为准回退 .png', async () => {
  const { out, formatDocument } = await convertBmpWith(
    { outputFormat: 'jpeg', quality: 0.5 },
    { actualType: () => 'image/png' },
  )
  assert.ok(out)
  assert.equal(formatDocument.blobCalls[0].type, 'image/jpeg')
  assert.equal(out.file.type, 'image/png')
  assert.equal(out.file.name.endsWith('.png'), true)
  assert.equal(out.to, 'image/png')
})

test('JPEG 转换多建一张白底画布，PNG/WebP 不额外建', async () => {
  const png = await convertBmpWith({ outputFormat: 'png' })
  const jpeg = await convertBmpWith({ outputFormat: 'jpeg' })
  const webp = await convertBmpWith({ outputFormat: 'webp' })
  assert.equal(png.formatDocument.canvases.length, 2)
  assert.equal(jpeg.formatDocument.canvases.length, png.formatDocument.canvases.length + 1)
  assert.equal(webp.formatDocument.canvases.length, png.formatDocument.canvases.length)
})

// ---------- 行为接线 ----------

class FakeDataTransfer {
  constructor() {
    this.items = {
      list: [],
      add(file) {
        this.list.push(file)
      },
    }
    this.files = this.items.list
  }
}

class FakeDragEvent {
  constructor(type, init = {}) {
    this.type = type
    this.bubbles = Boolean(init.bubbles)
    this.cancelable = Boolean(init.cancelable)
    this.composed = Boolean(init.composed)
    this.dataTransfer = init.dataTransfer || null
  }
}

function createDropSink(document) {
  const drops = []
  const waiters = []
  // client.js 只认真正的合成器卡片，并把 drop 派发到该元素；body 只是兜底陷阱。
  const card = {
    dispatchEvent(event) {
      drops.push(event)
      for (let i = waiters.length - 1; i >= 0; i--) {
        if (waiters[i]()) waiters.splice(i, 1)
      }
      return true
    },
  }
  document.querySelector = (selector) => (selector === '[data-composer-card]' ? card : null)
  document.body.dispatchEvent = () => {
    throw new Error('reroute 必须派发到 composer card，不得落到 document.body')
  }
  return {
    card,
    drops,
    wait(count = 1, timeout = 2000) {
      if (drops.length >= count) return Promise.resolve(drops[count - 1])
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`等待第 ${count} 次重路由超时`)), timeout)
        waiters.push(() => {
          if (drops.length < count) return false
          clearTimeout(timer)
          resolve(drops[count - 1])
          return true
        })
      })
    },
  }
}

async function settle(rounds = 4) {
  for (let i = 0; i < rounds; i++) await new Promise((resolve) => setImmediate(resolve))
}

function loadBridge() {
  const document = createEventDocument()
  // 事件桩只负责监听器；转换路径（BMP -> canvas -> PNG）还需要 createElement。
  document.createElement = createDocument().createElement
  const sink = createDropSink(document)
  const loaded = load({ document, DataTransfer: FakeDataTransfer, DragEvent: FakeDragEvent })
  const release = loaded.api.install()
  const paste = document.listeners.find((entry) => entry.type === 'paste')
  assert.ok(paste, 'install() 必须注册 paste 监听')
  return { ...loaded, document, sink, paste, release }
}

function pasteEvent(files) {
  return {
    clipboardData: { files },
    prevented: false,
    stopped: false,
    preventDefault() {
      this.prevented = true
    },
    stopPropagation() {
      this.stopped = true
    },
  }
}

test('maxFiles=1 时两文件粘贴不 claim 也不 preventDefault', async () => {
  const bridge = loadBridge()
  bridge.api.resetSettings()
  bridge.api.applySettings({ maxFiles: 1 })

  const event = pasteEvent([pngFile('a.png'), pngFile('b.png')])
  bridge.paste.listener(event)
  await settle()

  assert.equal(event.__dshPasteImageHandled, undefined)
  assert.equal(event.prevented, false)
  assert.equal(bridge.sink.drops.length, 0)
  assert.equal(bridge.api.getSettings().maxFiles, 1)
  bridge.release()
})

test('enabled=false 时普通粘贴不被接管，enabled=true 时接管并重路由', async () => {
  const bridge = loadBridge()

  bridge.api.applySettings({ enabled: false })
  const ignored = pasteEvent([pngFile('shot.png')])
  bridge.paste.listener(ignored)
  await settle()
  assert.equal(ignored.__dshPasteImageHandled, undefined)
  assert.equal(ignored.prevented, false)
  assert.equal(bridge.sink.drops.length, 0)

  bridge.api.applySettings({ enabled: true })
  const claimed = pasteEvent([pngFile('shot.png')])
  bridge.paste.listener(claimed)
  const drop = await bridge.sink.wait(1)
  assert.equal(claimed.__dshPasteImageHandled, true)
  assert.equal(claimed.prevented, true)
  assert.equal(claimed.stopped, true)
  assert.equal(drop.type, 'drop')
  assert.equal(drop.dataTransfer.files.length, 1)
  assert.equal(drop.dataTransfer.files[0].name, 'shot.png')
  bridge.release()
})

test('convertBmp=false 时 BMP 冒充 PNG 原样保留，true 时转成 PNG', async () => {
  const { api } = load()
  const bmp = makeBmp(2, 2, [
    [255, 0, 0],
    [0, 255, 0],
    [0, 0, 255],
    [255, 255, 255],
  ])

  api.applySettings({ convertBmp: false })
  assert.equal(await api.normalize(new File([bmp], 'wechat.png', { type: 'image/png' })), null)

  api.applySettings({ convertBmp: true })
  const out = await api.normalize(new File([bmp], 'wechat.png', { type: 'image/png' }))
  assert.ok(out)
  assert.equal(out.file.type, 'image/png')
  assert.equal(api.sniff(new Uint8Array(await out.file.arrayBuffer())), 'image/png')
})

test('maxSide=512 时长边 1024 的 BMP 输出 512 宽', async () => {
  const { api } = load()
  const pixels = Array.from({ length: 1024 * 4 }, (_, i) => [i & 0xff, (i * 3) & 0xff, (i * 5) & 0xff])
  const bmp = makeBmp(1024, 4, pixels)

  api.applySettings({ maxSide: 512 })
  const out = await api.normalize(new File([bmp], 'wide.png', { type: 'image/png' }))
  assert.ok(out)
  assert.equal(out.width, 512)
  assert.equal(out.height, 2)
  assert.equal(out.file.type, 'image/png')
})

test('logConversions=false 时不打调试日志，true 时打一条', async () => {
  const bridge = loadBridge()
  const bmp = makeBmp(2, 2, [
    [255, 0, 0],
    [0, 255, 0],
    [0, 0, 255],
    [255, 255, 255],
  ])

  bridge.api.applySettings({ logConversions: false })
  bridge.paste.listener(pasteEvent([new File([bmp], 'wechat.png', { type: 'image/png' })]))
  await bridge.sink.wait(1)
  assert.equal(bridge.logs.length, 0)

  bridge.api.applySettings({ logConversions: true })
  bridge.paste.listener(pasteEvent([new File([bmp], 'wechat.png', { type: 'image/png' })]))
  await bridge.sink.wait(2)
  assert.equal(bridge.logs.length, 1)
  assert.match(bridge.logs[0], /^\[dsh-paste-image\] image\/png -> image\/png 2x2$/)
  bridge.release()
})

// ---------- 页面注册契约 ----------

function createReactStub() {
  return {
    createElement(type, props, ...children) {
      return { type, props: { ...(props || {}), children } }
    },
    useState(initial) {
      return [typeof initial === 'function' ? initial() : initial, () => {}]
    },
    useEffect() {},
    useMemo(factory) {
      return factory()
    },
    useRef(initial) {
      return { current: initial }
    },
    useCallback(callback) {
      return callback
    },
  }
}

function renderTree(node) {
  if (Array.isArray(node)) return node.map(renderTree)
  if (node === null || node === undefined || typeof node !== 'object') return node
  if (typeof node.type === 'function') return renderTree(node.type(node.props))
  const children = Array.isArray(node.props.children) ? node.props.children.map(renderTree) : []
  return { type: node.type, props: { ...node.props, children } }
}

function walk(node, visit) {
  if (Array.isArray(node)) {
    node.forEach((child) => walk(child, visit))
    return
  }
  if (node === null || node === undefined || typeof node !== 'object') return
  visit(node)
  walk(node.props.children, visit)
}

function flattenText(node) {
  if (node === null || node === undefined) return ''
  if (Array.isArray(node)) return node.map(flattenText).join('')
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (typeof node === 'object') return flattenText(node.props.children)
  return ''
}

function loadPlugin() {
  let definition = null
  const document = createEventDocument()
  const loaded = load({
    document,
    window: {
      __ModuleLoader__: {
        load(value) {
          definition = value
        },
      },
    },
  })
  assert.ok(definition, 'client.js 必须调用 window.__ModuleLoader__.load')
  return { ...loaded, document, definition }
}

function applyPlugin(definition, react) {
  const effects = []
  const injections = []
  const registrations = []
  const locales = []
  const ctx = {
    effect(callback, label) {
      effects.push(label)
      const disposer = callback()
      return typeof disposer === 'function' ? disposer : () => {}
    },
    slots: {
      inject(name, factory) {
        injections.push({ name, factory })
      },
      register(meta, component) {
        registrations.push({ meta, component })
        return () => {}
      },
    },
    locale: {
      register(namespace, dictionaries) {
        locales.push({ namespace, dictionaries })
        return () => {}
      },
      bind(namespace) {
        return (key) => {
          const dictionary = locales.find((entry) => entry.namespace === namespace)?.dictionaries.zh || {}
          return dictionary[key] || key
        }
      },
    },
  }
  const plugin = definition.factory((name) => {
    assert.equal(name, 'react')
    return react
  })
  plugin.apply(ctx)
  return { ctx, effects, injections, registrations, locales, plugin }
}

test('模块加载器保留 plugins.row.config 行配置入口，key 与 locale 固定', () => {
  const loaded = loadPlugin()
  const applied = applyPlugin(loaded.definition, createReactStub())

  assert.deepEqual(applied.effects, ['paste-image', 'paste-image: settings dictionaries'])
  assert.equal(applied.locales.length, 1)
  assert.equal(applied.locales[0].namespace, 'dsh-paste-image:settings')
  assert.ok(applied.locales[0].dictionaries.zh.summary, 'zh 词典必须带 summary')
  assert.ok(applied.locales[0].dictionaries.en.summary, 'en 词典必须带 summary')

  const rowInjection = applied.injections.find((entry) => entry.name === 'plugins.row.config')
  assert.ok(rowInjection, '必须保留 plugins.row.config 注入')
  const disposer = rowInjection.factory()
  assert.equal(typeof disposer, 'function')

  const rowRegistration = applied.registrations.find((entry) => entry.meta.name === 'plugins.row.config')
  assert.ok(rowRegistration, '必须保留插件页行配置注册')
  const { meta, component } = rowRegistration
  assert.deepEqual(plain(meta), {
    name: 'plugins.row.config',
    key: 'dsh-paste-image#paste-image',
    locale: 'dsh-paste-image:settings',
  })
  assert.equal(typeof component, 'function')
})

test('模块加载器把设置侧栏入口注册到 settings.section，label 本地化且复用表单', () => {
  const loaded = loadPlugin()
  const applied = applyPlugin(loaded.definition, createReactStub())

  const dictionaries = applied.locales[0].dictionaries
  assert.equal(dictionaries.zh['section.title'], '粘贴任意图片')
  assert.equal(dictionaries.en['section.title'], 'Paste any image')

  const sectionInjection = applied.injections.find((entry) => entry.name === 'settings.section')
  assert.ok(sectionInjection, '必须注入 settings.section 槽位')
  sectionInjection.factory()
  const section = applied.registrations.find((entry) => entry.meta.name === 'settings.section')
  assert.ok(section, '必须注册 settings.section 条目')
  assert.deepEqual(plain(section.meta), {
    name: 'settings.section',
    id: 'dsh-paste-image#paste-image',
    order: 27,
    locale: 'dsh-paste-image:settings',
  })
  assert.equal(typeof section.meta.label, 'function')
  assert.equal(section.meta.label(), '粘贴任意图片')

  // 宿主只传 close，不传 view：Page 必须直接渲染完整表单。
  const elements = []
  walk(renderTree(section.component({ close() {} })), (node) => elements.push(node))
  assert.equal(elements.filter((node) => node.type === 'input' && node.props.type === 'number').length, 3)
  assert.equal(elements.filter((node) => node.type === 'button').length, 2)
})

test('summary 视图输出单行状态字符串并带上输出格式', () => {
  const loaded = loadPlugin()
  const applied = applyPlugin(loaded.definition, createReactStub())
  applied.injections.find((entry) => entry.name === 'plugins.row.config').factory()
  const Page = applied.registrations.find((entry) => entry.meta.name === 'plugins.row.config').component
  const t = (key) =>
    ({ summary: 'Image paste conversion', summaryEnabled: 'enabled', summaryDisabled: 'disabled' })[key] || key

  loaded.api.resetSettings()
  const enabled = flattenText(renderTree(Page({ view: 'summary', t })))
  assert.equal(typeof enabled, 'string')
  assert.ok(!enabled.includes('\n'), 'summary 必须是单行')
  assert.match(enabled, /PNG/)
  assert.match(enabled, /enabled/)

  loaded.api.applySettings({ enabled: false })
  const disabled = flattenText(renderTree(Page({ view: 'summary', t })))
  assert.equal(typeof disabled, 'string')
  assert.match(disabled, /disabled/)
  assert.match(disabled, /PNG/)

  loaded.api.applySettings({ outputFormat: 'jpeg' })
  const jpeg = flattenText(renderTree(Page({ view: 'summary', t })))
  assert.equal(typeof jpeg, 'string')
  assert.ok(!jpeg.includes('\n'), 'summary 必须是单行')
  assert.match(jpeg, /JPEG/)
  assert.doesNotMatch(jpeg, /PNG/)
  loaded.api.resetSettings()
})

test('page 视图渲染 6 个 checkbox、3 个 number、1 个 select 与 2 个按钮', () => {
  const loaded = loadPlugin()
  const applied = applyPlugin(loaded.definition, createReactStub())
  applied.injections.find((entry) => entry.name === 'plugins.row.config').factory()
  const Page = applied.registrations.find((entry) => entry.meta.name === 'plugins.row.config').component
  const t = (key) => key

  loaded.api.resetSettings()
  const elements = []
  walk(renderTree(Page({ view: 'page', t })), (node) => elements.push(node))

  const checkboxes = elements.filter((node) => node.type === 'input' && node.props.type === 'checkbox')
  const numbers = elements.filter((node) => node.type === 'input' && node.props.type === 'number')
  const selects = elements.filter((node) => node.type === 'select')
  const buttons = elements.filter((node) => node.type === 'button')

  assert.equal(checkboxes.length, 6)
  assert.equal(numbers.length, 3)
  assert.equal(selects.length, 1)
  assert.equal(buttons.length, 2)
  assert.equal(checkboxes.filter((node) => node.props.checked).length, 6)
  assert.deepEqual(
    numbers.map((node) => node.props.value),
    ['8', '4096', '0.92'],
  )
  assert.deepEqual(
    numbers.map((node) => node.props.min),
    [1, 512, 0.1],
  )
  assert.deepEqual(
    numbers.map((node) => node.props.max),
    [8, 8192, 1],
  )
  assert.deepEqual(
    numbers.map((node) => node.props.step),
    [1, 256, 0.01],
  )

  assert.equal(selects[0].props.value, 'png')
  const options = []
  walk(selects[0], (node) => {
    if (node.type === 'option') options.push(node)
  })
  assert.deepEqual(
    options.map((node) => node.props.value),
    ['png', 'jpeg', 'webp'],
  )

  // PNG 是无损编码，质量输入应禁用；切到 JPEG 后启用。
  assert.equal(numbers[2].props.disabled, true)
  loaded.api.applySettings({ outputFormat: 'jpeg' })
  const jpegElements = []
  walk(renderTree(Page({ view: 'page', t })), (node) => jpegElements.push(node))
  const jpegNumbers = jpegElements.filter((node) => node.type === 'input' && node.props.type === 'number')
  assert.equal(jpegNumbers.length, 3)
  assert.equal(jpegNumbers[2].props.disabled, false)
  loaded.api.resetSettings()
})

test('apply(ctx) 在没有 slots/locale 时仍立即安装 paste/drop 监听', () => {
  const loaded = loadPlugin()
  const effects = []
  const disposers = []
  const ctx = {
    effect(callback, label) {
      effects.push(label)
      const disposer = callback()
      disposers.push(typeof disposer === 'function' ? disposer : () => {})
      return disposer
    },
  }
  const plugin = loaded.definition.factory((name) => {
    assert.equal(name, 'react')
    return createReactStub()
  })
  // module-level inject 必须同时声明 slots/locale：cordis guard 只放行声明过的服务读取。
  assert.deepEqual(Object.keys(plugin), ['inject', 'apply'])
  assert.deepEqual(Array.from(plugin.inject), ['slots', 'locale'])

  plugin.apply(ctx)

  // 配置页服务缺失只留一行 debug（load() 的 vm console 统一记入 logs），不阻塞粘贴链路。
  const debugLines = loaded.logs.filter((line) => line.startsWith('[dsh-paste-image] settings page unavailable: '))
  assert.equal(debugLines.length, 1)
  assert.match(debugLines[0], /^\[dsh-paste-image\] settings page unavailable: /)

  assert.deepEqual(
    loaded.document.listeners.map((entry) => entry.type),
    ['paste', 'drop'],
  )
  assert.deepEqual(effects, ['paste-image'])
  disposers[0]()
  assert.equal(loaded.document.listeners.length, 0)
})

// 复刻 cordis 的 guard：只有 factory 声明过 inject 的服务名才可以读取，否则抛错。
// effect 是 ctx 内建方法（reflect.ts 的 isSpecialProperty），不走 inject 白名单。
// 对应 reflect.ts:152 `cannot get property ... without inject` / :172 `prop in fiber.inject` 放行。
const GUARD_BUILTINS = ['effect']
function guardedContext(target, declared) {
  const allowed = [...declared, ...GUARD_BUILTINS]
  return new Proxy(target, {
    get(object, prop, receiver) {
      if (typeof prop === 'string' && !allowed.includes(prop)) {
        throw new Error(`cannot get property "${prop}" without inject`)
      }
      return Reflect.get(object, prop, receiver)
    },
  })
}

test('guard 语义回归：factory 必须声明 locale，声明后 ctx.locale 可读且配置页直接注册', () => {
  const loaded = loadPlugin()
  const plugin = loaded.definition.factory((name) => {
    assert.equal(name, 'react')
    return createReactStub()
  })
  assert.ok(plugin.inject.includes('slots'), 'factory 必须声明 slots')
  assert.ok(plugin.inject.includes('locale'), 'factory 必须声明 locale（否则 ctx.locale 被 guard 拦截）')

  // 反证：按旧的 inject: ['slots'] 构造 guard，读 ctx.locale 必抛错。
  const oldGuard = guardedContext({ slots: {}, locale: {} }, ['slots'])
  assert.throws(() => oldGuard.locale, /cannot get property "locale" without inject/)

  const effects = []
  const slotInjections = []
  const registrations = []
  const locales = []
  const target = {
    effect(callback, label) {
      effects.push(label)
      const disposer = callback()
      return typeof disposer === 'function' ? disposer : () => {}
    },
    slots: {
      inject(name, factory) {
        slotInjections.push({ name, factory })
      },
      register(meta, component) {
        registrations.push({ meta, component })
        return () => {}
      },
    },
    locale: {
      register(namespace, dictionaries) {
        locales.push({ namespace, dictionaries })
        return () => {}
      },
      bind(namespace) {
        return (key) => key
      },
    },
  }
  const ctx = guardedContext(target, Array.from(plugin.inject))
  // 新声明下两个服务都可读；这正是 0.4.2 缺失的一环。
  assert.equal(ctx.locale, target.locale)
  assert.equal(ctx.slots, target.slots)

  plugin.apply(ctx)
  assert.deepEqual(effects, ['paste-image', 'paste-image: settings dictionaries'])
  assert.equal(locales.length, 1)
  assert.equal(locales[0].namespace, 'dsh-paste-image:settings')
  assert.equal(slotInjections.length, 2)
  assert.deepEqual(slotInjections.map((entry) => entry.name), ['settings.section', 'plugins.row.config'])
  const rowInjection = slotInjections.find((entry) => entry.name === 'plugins.row.config')
  rowInjection.factory()
  assert.equal(registrations.length, 1)
  slotInjections.find((entry) => entry.name === 'settings.section').factory()
  assert.equal(registrations.length, 2)
  assert.deepEqual(plain(registrations.find((entry) => entry.meta.name === 'plugins.row.config').meta), {
    name: 'plugins.row.config',
    key: 'dsh-paste-image#paste-image',
    locale: 'dsh-paste-image:settings',
  })

  // pageRegistered 幂等：重复 apply 不重复注册词典/槽位。
  plugin.apply(ctx)
  assert.equal(locales.length, 1)
  assert.equal(slotInjections.length, 2)
  assert.equal(registrations.length, 2)
  assert.deepEqual(effects, ['paste-image', 'paste-image: settings dictionaries', 'paste-image'])

  const debugLines = loaded.logs.filter((line) => line.startsWith('[dsh-paste-image] settings page unavailable: '))
  assert.equal(debugLines.length, 0)
})

test('服务就绪时同步注册配置页，不再走 ctx.inject 延迟兜底', () => {
  const loaded = loadPlugin()
  const injectCalls = []
  const ctx = {
    effect(callback, label) {
      const disposer = callback()
      return typeof disposer === 'function' ? disposer : () => {}
    },
    inject(names, callback) {
      injectCalls.push({ names, callback })
    },
    slots: {
      inject() {},
      register() {
        return () => {}
      },
    },
    locale: {
      register() {
        return () => {}
      },
    },
  }
  const plugin = loaded.definition.factory((name) => {
    assert.equal(name, 'react')
    return createReactStub()
  })
  plugin.apply(ctx)
  assert.equal(injectCalls.length, 0, '不得再调用 ctx.inject([\'slots\',\'locale\'], cb) 兜底')
  const debugLines = loaded.logs.filter((line) => line.startsWith('[dsh-paste-image] settings page unavailable: '))
  assert.equal(debugLines.length, 0)
})
