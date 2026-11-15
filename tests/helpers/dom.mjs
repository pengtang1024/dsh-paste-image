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
