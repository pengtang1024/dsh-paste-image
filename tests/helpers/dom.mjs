// 最小 DOM 桩：只实现 client.js 用到的 canvas 能力，供 node --test 使用。
export function createDocument() {
  const canvases = []
  function makeCanvas() {
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
      toBlob(callback, type) {
        const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
        callback(new Blob([bytes], { type: type || 'image/png' }))
      },
    }
    canvases.push(canvas)
    return canvas
  }
  return { createElement: (tag) => (tag === 'canvas' ? makeCanvas() : {}), canvases }
}

export function makeBmp(width, height, pixels) {
  const stride = Math.floor((24 * width + 31) / 32) * 4
  const size = 54 + stride * height
  const bytes = new Uint8Array(size)
  const dv = new DataView(bytes.buffer)
  bytes[0] = 0x42
  bytes[1] = 0x4d
  dv.setUint32(2, size, true)
  dv.setUint32(10, 54, true)
  dv.setUint32(14, 40, true)
  dv.setInt32(18, width, true)
  dv.setInt32(22, height, true)
  dv.setUint16(26, 1, true)
  dv.setUint16(28, 24, true)
  dv.setUint32(34, stride * height, true)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixels[y * width + x]
      const o = 54 + (height - 1 - y) * stride + x * 3
      bytes[o] = b
      bytes[o + 1] = g
      bytes[o + 2] = r
    }
  }
  return bytes
}

export function loadClient(clientPath) {
  const source = readFileSync(clientPath, 'utf8')
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
  vm.runInContext(source, context, { filename: 'client.js' })
  return context.module.exports
}

export function makeBmp8(width, height, indices, palette) {
  const paletteBytes = 256 * 4
  const stride = Math.floor((8 * width + 31) / 32) * 4
  const offset = 54 + paletteBytes
  const size = offset + stride * height
  const bytes = new Uint8Array(size)
  const dv = new DataView(bytes.buffer)
  bytes[0] = 0x42
  bytes[1] = 0x4d
  dv.setUint32(2, size, true)
  dv.setUint32(10, offset, true)
  dv.setUint32(14, 40, true)
  dv.setInt32(18, width, true)
  dv.setInt32(22, height, true)
  dv.setUint16(26, 1, true)
  dv.setUint16(28, 8, true)
  dv.setUint32(34, stride * height, true)
  palette.forEach(([r, g, b], i) => {
    const o = 54 + i * 4
    bytes[o] = b
    bytes[o + 1] = g
    bytes[o + 2] = r
    bytes[o + 3] = 0
  })
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      bytes[offset + (height - 1 - y) * stride + x] = indices[y * width + x]
    }
  }
  return bytes
}

export function makeBmp16(width, height, values) {
  const stride = Math.floor((16 * width + 31) / 32) * 4
  const size = 54 + stride * height
  const bytes = new Uint8Array(size)
  const dv = new DataView(bytes.buffer)
  bytes[0] = 0x42
  bytes[1] = 0x4d
  dv.setUint32(2, size, true)
  dv.setUint32(10, 54, true)
  dv.setUint32(14, 40, true)
  dv.setInt32(18, width, true)
  dv.setInt32(22, height, true)
  dv.setUint16(26, 1, true)
  dv.setUint16(28, 16, true)
  dv.setUint32(34, stride * height, true)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      dv.setUint16(54 + (height - 1 - y) * stride + x * 2, values[y * width + x], true)
    }
  }
  return bytes
}

export function makeBmp32(width, height, pixels, alpha = 0) {
  const stride = width * 4
  const size = 54 + stride * height
  const bytes = new Uint8Array(size)
  const dv = new DataView(bytes.buffer)
  bytes[0] = 0x42
  bytes[1] = 0x4d
  dv.setUint32(2, size, true)
  dv.setUint32(10, 54, true)
  dv.setUint32(14, 40, true)
  dv.setInt32(18, width, true)
  dv.setInt32(22, height, true)
  dv.setUint16(26, 1, true)
  dv.setUint16(28, 32, true)
  dv.setUint32(34, stride * height, true)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixels[y * width + x]
      const o = 54 + (height - 1 - y) * stride + x * 4
      bytes[o] = b
      bytes[o + 1] = g
      bytes[o + 2] = r
      bytes[o + 3] = alpha
    }
  }
  return bytes
}

export function makeRle8Bmp(width, height, stream, palette) {
  const offset = 54 + 1024
  const size = offset + stream.length
  const bytes = new Uint8Array(size)
  const dv = new DataView(bytes.buffer)
  bytes[0] = 0x42
  bytes[1] = 0x4d
  dv.setUint32(2, size, true)
  dv.setUint32(10, offset, true)
  dv.setUint32(14, 40, true)
  dv.setInt32(18, width, true)
  dv.setInt32(22, height, true)
  dv.setUint16(26, 1, true)
  dv.setUint16(28, 8, true)
  dv.setUint32(30, 1, true)
  dv.setUint32(34, stream.length, true)
  palette.forEach(([r, g, b], i) => {
    const o = 54 + i * 4
    bytes[o] = b
    bytes[o + 1] = g
    bytes[o + 2] = r
  })
  bytes.set(stream, offset)
  return bytes
}

export function makeDib(width, height, pixels) {
  const stride = Math.floor((24 * width + 31) / 32) * 4
  const size = 40 + stride * height
  const bytes = new Uint8Array(size)
  const dv = new DataView(bytes.buffer)
  dv.setUint32(0, 40, true)
  dv.setInt32(4, width, true)
  dv.setInt32(8, height, true)
  dv.setUint16(12, 1, true)
  dv.setUint16(14, 24, true)
  dv.setUint32(34, stride * height, true)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixels[y * width + x]
      const o = 40 + (height - 1 - y) * stride + x * 3
      bytes[o] = b
      bytes[o + 1] = g
      bytes[o + 2] = r
    }
  }
  return bytes
}

export function makeRle4Bmp(width, height, stream, palette) {
  const offset = 54 + 64
  const size = offset + stream.length
  const bytes = new Uint8Array(size)
  const dv = new DataView(bytes.buffer)
  bytes[0] = 0x42
  bytes[1] = 0x4d
  dv.setUint32(2, size, true)
  dv.setUint32(10, offset, true)
  dv.setUint32(14, 40, true)
  dv.setInt32(18, width, true)
  dv.setInt32(22, height, true)
  dv.setUint16(26, 1, true)
  dv.setUint16(28, 4, true)
  dv.setUint32(30, 2, true)
  dv.setUint32(34, stream.length, true)
  palette.forEach(([r, g, b], i) => {
    const o = 54 + i * 4
    bytes[o] = b
    bytes[o + 1] = g
    bytes[o + 2] = r
  })
  bytes.set(stream, offset)
  return bytes
}

// 事件用文档桩：记录监听器，支持 AbortSignal 卸载，供 install() 幂等性测试使用。
export function createEventDocument() {
  const listeners = []
  const document = {
    listeners,
    body: {},
    querySelector() {
      return null
    },
    addEventListener(type, listener, options) {
      const signal = options && options.signal
      const entry = { type, listener, signal }
      listeners.push(entry)
      if (signal) {
        signal.addEventListener('abort', () => document.removeEventListener(type, listener), { once: true })
      }
    },
    removeEventListener(type, listener) {
      const index = listeners.findIndex((entry) => entry.type === type && entry.listener === listener)
      if (index >= 0) listeners.splice(index, 1)
    },
  }
  return document
}
