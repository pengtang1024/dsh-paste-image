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

test('applySettings 局部更新保留其他字段', () => {
  const { api } = load()
  api.applySettings({ maxSide: 2048, convertSvg: false })
  const expected = { ...DEFAULTS, maxSide: 2048, convertSvg: false, maxFiles: 2 }
  assert.deepEqual(plain(api.applySettings({ maxFiles: 2 })), expected)
  assert.deepEqual(plain(api.getSettings()), expected)
})

test('applySettings 写入固定 key，新实例从 localStorage 读回同一份设置', () => {
  const storage = createStorage()
  const first = load({ localStorage: storage })
  const expected = { ...DEFAULTS, maxFiles: 3, maxSide: 2048, convertSvg: false, logConversions: false }
  first.api.applySettings({ maxFiles: 3, maxSide: 2048, convertSvg: false, logConversions: false })

  const write = storage.writes.find((entry) => entry.key === SETTINGS_KEY)
  assert.ok(write, `必须写入 ${SETTINGS_KEY}`)
  assert.deepEqual(JSON.parse(write.value), expected)

  const second = load({ localStorage: storage })
  assert.deepEqual(plain(second.api.getSettings()), expected)
})

test('损坏的 JSON 与越界的历史值都回退到安全默认', () => {
  const broken = load({ localStorage: createStorage({ [SETTINGS_KEY]: '{"maxFiles":' }) })
  assert.deepEqual(plain(broken.api.getSettings()), DEFAULTS)

  const stale = load({
    localStorage: createStorage({ [SETTINGS_KEY]: JSON.stringify({ maxFiles: 99, enabled: false }) }),
  })
  assert.deepEqual(plain(stale.api.getSettings()), { ...DEFAULTS, maxFiles: 8, enabled: false })
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
  assert.deepEqual(plain(first.api.getSettings()), DEFAULTS)
  assert.equal(first.api.applySettings({ maxSide: 2048 }).maxSide, 2048)
  assert.deepEqual(plain(first.api.getSettings()), { ...DEFAULTS, maxSide: 2048 })

  const second = load({ localStorage: throwing })
  assert.deepEqual(plain(second.api.getSettings()), DEFAULTS)
})

test('resetSettings 恢复全部默认值并写回 storage', () => {
  const storage = createStorage()
  const { api } = load({ localStorage: storage })
  api.applySettings({
    enabled: false,
    maxFiles: 2,
    maxSide: 1024,
    convertBmp: false,
    convertSvg: false,
    convertIco: false,
    logConversions: false,
  })

  assert.deepEqual(plain(api.resetSettings()), DEFAULTS)
  assert.deepEqual(plain(api.getSettings()), DEFAULTS)

  const write = storage.writes[storage.writes.length - 1]
  assert.equal(write.key, SETTINGS_KEY)
  assert.deepEqual(JSON.parse(write.value), DEFAULTS)
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
  document.body.dispatchEvent = (event) => {
    drops.push(event)
    for (let i = waiters.length - 1; i >= 0; i--) {
      if (waiters[i]()) waiters.splice(i, 1)
    }
    return true
  }
  return {
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
  const loaded = load({
    document: createEventDocument(),
    window: {
      __ModuleLoader__: {
        load(value) {
          definition = value
        },
      },
    },
  })
  assert.ok(definition, 'client.js 必须调用 window.__ModuleLoader__.load')
  return { ...loaded, definition }
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
    },
  }
  const plugin = definition.factory((name) => {
    assert.equal(name, 'react')
    return react
  })
  plugin.apply(ctx)
  return { ctx, effects, injections, registrations, locales, plugin }
}

test('模块加载器把配置页注册到 plugins.row.config，key 与 locale 固定', () => {
  const loaded = loadPlugin()
  const applied = applyPlugin(loaded.definition, createReactStub())

  assert.deepEqual(applied.effects, ['paste-image', 'paste-image: settings dictionaries'])
  assert.equal(applied.locales.length, 1)
  assert.equal(applied.locales[0].namespace, 'dsh-paste-image:settings')
  assert.ok(applied.locales[0].dictionaries.zh.summary, 'zh 词典必须带 summary')
  assert.ok(applied.locales[0].dictionaries.en.summary, 'en 词典必须带 summary')

  assert.equal(applied.injections.length, 1)
  assert.equal(applied.injections[0].name, 'plugins.row.config')
  const disposer = applied.injections[0].factory()
  assert.equal(typeof disposer, 'function')

  assert.equal(applied.registrations.length, 1)
  const { meta, component } = applied.registrations[0]
  assert.deepEqual(plain(meta), {
    name: 'plugins.row.config',
    key: 'dsh-paste-image#paste-image',
    locale: 'dsh-paste-image:settings',
  })
  assert.equal(typeof component, 'function')
})

test('summary 视图输出单行状态字符串', () => {
  const loaded = loadPlugin()
  const applied = applyPlugin(loaded.definition, createReactStub())
  applied.injections[0].factory()
  const Page = applied.registrations[0].component
  const t = (key) =>
    ({ summary: 'Image paste conversion', summaryEnabled: 'enabled', summaryDisabled: 'disabled' })[key] || key

  const enabled = flattenText(renderTree(Page({ view: 'summary', t })))
  assert.equal(typeof enabled, 'string')
  assert.equal(enabled, 'Image paste conversion · enabled')

  loaded.api.applySettings({ enabled: false })
  const disabled = flattenText(renderTree(Page({ view: 'summary', t })))
  assert.equal(typeof disabled, 'string')
  assert.equal(disabled, 'Image paste conversion · disabled')
  loaded.api.resetSettings()
})

test('page 视图渲染 6 个 checkbox、2 个 number 输入与 2 个按钮', () => {
  const loaded = loadPlugin()
  const applied = applyPlugin(loaded.definition, createReactStub())
  applied.injections[0].factory()
  const Page = applied.registrations[0].component
  const tree = renderTree(Page({ view: 'page', t: (key) => key }))

  const elements = []
  walk(tree, (node) => elements.push(node))

  const checkboxes = elements.filter((node) => node.type === 'input' && node.props.type === 'checkbox')
  const numbers = elements.filter((node) => node.type === 'input' && node.props.type === 'number')
  const buttons = elements.filter((node) => node.type === 'button')

  assert.equal(checkboxes.length, 6)
  assert.equal(numbers.length, 2)
  assert.equal(buttons.length, 2)
  assert.equal(checkboxes.filter((node) => node.props.checked).length, 6)
  assert.deepEqual(
    numbers.map((node) => node.props.value),
    ['8', '4096'],
  )
  assert.deepEqual(
    numbers.map((node) => node.props.min),
    [1, 512],
  )
  assert.deepEqual(
    numbers.map((node) => node.props.max),
    [8, 8192],
  )
  loaded.api.resetSettings()
})
