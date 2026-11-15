;(function () {
  'use strict'

  var NATIVE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']
  var NATIVE_SET = new Set(NATIVE_TYPES)
  var IMAGE_EXT = /\.(png|jpe?g|jfif|gif|webp|bmp|dib|tiff?|xpm|avif|ico|cur|svg)$/i
  var MAX_SIDE = 4096
  var MAX_FILES = 8
  var REROUTED = '__dshPasteImageRerouted'

  function ascii(bytes, start, len) {
    var out = ''
    for (var i = start; i < start + len && i < bytes.length; i++) out += String.fromCharCode(bytes[i])
    return out
  }

  function sniff(bytes) {
    if (
      bytes.length >= 8 &&
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47 &&
      bytes[4] === 0x0d &&
      bytes[5] === 0x0a &&
      bytes[6] === 0x1a &&
      bytes[7] === 0x0a
    )
      return 'image/png'
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
    if (bytes.length >= 6 && ascii(bytes, 0, 3) === 'GIF') return 'image/gif'
    if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') return 'image/webp'
    if (bytes.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4d) return 'image/bmp'
    if (
      bytes.length >= 4 &&
      ((bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2a && bytes[3] === 0) ||
        (bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0 && bytes[3] === 0x2a))
    )
      return 'image/tiff'
    if (bytes.length >= 9 && ascii(bytes, 0, 9).toLowerCase() === '/* xpm */') return 'image/xpm'
    return null
  }

  // ---------- XPM ----------

  function xpmStrings(text) {
    var out = []
    var re = /"((?:[^"\\]|\\.)*)"/g
    var m
    while ((m = re.exec(text)) !== null) {
      out.push(m[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\').replace(/\\n/g, '\n').replace(/\\t/g, '\t'))
    }
    return out
  }

  // 用 canvas 把任意 CSS 颜色解析成 RGBA，顺带支持命名色与 4/8/12 位十六进制。
  function resolveColor(color) {
    if (!color || color === 'None') return [0, 0, 0, 0]
    var c = document.createElement('canvas')
    c.width = 1
    c.height = 1
    var ctx = c.getContext('2d')
    ctx.clearRect(0, 0, 1, 1)
    ctx.fillStyle = '#000000'
    ctx.fillStyle = color
    var filled = ctx.fillStyle
    if (
      typeof filled === 'string' &&
      filled === '#000000' &&
      color.toLowerCase() !== '#000000' &&
      color.toLowerCase() !== 'black'
    ) {
      return null
    }
    ctx.fillRect(0, 0, 1, 1)
    var d = ctx.getImageData(0, 0, 1, 1).data
    return [d[0], d[1], d[2], d[3]]
  }

  function decodeXpm(text) {
    var strings = xpmStrings(text)
    if (strings.length < 2) throw new Error('xpm: no strings')
    var head = strings[0].trim().split(/\s+/).map(Number)
    var width = head[0]
    var height = head[1]
    var colors = head[2]
    var cpp = head[3] || 1
    if (!(width > 0 && height > 0 && colors > 0)) throw new Error('xpm: bad header ' + strings[0])

    var palette = new Map()
    for (var i = 1; i <= colors; i++) {
      var line = strings[i] || ''
      var key = line.slice(0, cpp)
      var rest = line.slice(cpp)
      var m = /\bc\s+([^\s]+(?:\s+[^\s]+)?)/.exec(rest)
      var raw = m ? m[1].trim() : '#000000'
      palette.set(key, resolveColor(raw) || [0, 0, 0, 255])
    }

    var canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    var ctx = canvas.getContext('2d')
    var image = ctx.createImageData(width, height)
    var data = image.data
    for (var y = 0; y < height; y++) {
      var row = strings[1 + colors + y] || ''
      for (var x = 0; x < width; x++) {
        var k = row.slice(x * cpp, (x + 1) * cpp)
        var rgba = palette.get(k) || [0, 0, 0, 0]
        var o = (y * width + x) * 4
        data[o] = rgba[0]
        data[o + 1] = rgba[1]
        data[o + 2] = rgba[2]
        data[o + 3] = rgba[3]
      }
    }
    ctx.putImageData(image, 0, 0)
    return canvas
  }

  // ---------- BMP（浏览器解不了时的兜底，24/32 位未压缩） ----------

  function decodeBmp(bytes) {
    var dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    if (dv.getUint16(0, true) !== 0x4d42) throw new Error('bmp: bad magic')
    var offset = dv.getUint32(10, true)
    var headerSize = dv.getUint32(14, true)
    var width = dv.getInt32(18, true)
    var height = dv.getInt32(22, true)
    var bpp = dv.getUint16(28, true)
    var compression = dv.getUint32(30, true)
    if (headerSize < 40 || (bpp !== 24 && bpp !== 32) || compression !== 0) throw new Error('bmp: unsupported variant')
    var topDown = height < 0
    if (topDown) height = -height
    var stride = Math.floor((bpp * width + 31) / 32) * 4
    var canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    var ctx = canvas.getContext('2d')
    var image = ctx.createImageData(width, height)
    var data = image.data
    for (var y = 0; y < height; y++) {
      var srcRow = offset + (topDown ? y : height - 1 - y) * stride
      for (var x = 0; x < width; x++) {
        var s = srcRow + x * (bpp / 8)
        var o = (y * width + x) * 4
        data[o] = bytes[s + 2]
        data[o + 1] = bytes[s + 1]
        data[o + 2] = bytes[s]
        data[o + 3] = bpp === 32 ? bytes[s + 3] : 255
      }
    }
    ctx.putImageData(image, 0, 0)
    return canvas
  }

  // ---------- 规范化 ----------

  function canvasOf(source) {
    var w = source.width || source.naturalWidth
    var h = source.height || source.naturalHeight
    var scale = Math.min(1, MAX_SIDE / Math.max(w, h))
    var canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(w * scale))
    canvas.height = Math.max(1, Math.round(h * scale))
    canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height)
    return canvas
  }

  function toPngBlob(canvas) {
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (blob) {
        blob ? resolve(blob) : reject(new Error('canvas.toBlob failed'))
      }, 'image/png')
    })
  }

  async function toCanvas(file, bytes, kind) {
    if (kind === 'image/xpm') {
      return canvasOf(decodeXpm(new TextDecoder('utf-8', { fatal: false }).decode(bytes)))
    }
    var type = kind || file.type || 'application/octet-stream'
    try {
      var bitmap = await createImageBitmap(new Blob([bytes], { type: type }))
      return canvasOf(bitmap)
    } catch (error) {
      if (kind === 'image/bmp') return canvasOf(decodeBmp(bytes))
      throw error
    }
  }

  async function normalize(file) {
    var bytes = new Uint8Array(await file.arrayBuffer())
    var kind = sniff(bytes)
    var declared = (file.type || '').toLowerCase()
    if (kind && NATIVE_SET.has(kind) && (declared === kind || declared === '')) return null
    var canvas = await toCanvas(file, bytes, kind)
    var blob = await toPngBlob(canvas)
    var name = (file.name || 'image').replace(/\.[^.]+$/, '') + '.png'
    return {
      file: new File([blob], name, { type: 'image/png' }),
      from: declared || '(no type)',
      to: 'image/png',
      width: canvas.width,
      height: canvas.height,
    }
  }

  // ---------- 事件桥 ----------

  function isImageCandidate(file) {
    if (!file) return false
    var type = (file.type || '').toLowerCase()
    if (type.indexOf('image/') === 0) return true
    return IMAGE_EXT.test(file.name || '')
  }

  function composer() {
    return document.querySelector('[data-composer-card]') || document.body
  }

  function reroute(files) {
    var dt = new DataTransfer()
    files.forEach(function (file) {
      dt.items.add(file)
    })
    var event = new DragEvent('drop', { bubbles: true, cancelable: true, composed: true, dataTransfer: dt })
    Object.defineProperty(event, REROUTED, { value: true })
    composer().dispatchEvent(event)
  }

  async function handle(event, data) {
    if (!data || event[REROUTED]) return
    var files = Array.prototype.slice.call(data.files || [])
    if (files.length === 0 || files.length > MAX_FILES) return
    if (!files.some(isImageCandidate)) return
    event.preventDefault()
    event.stopPropagation()
    var out = []
    for (var i = 0; i < files.length; i++) {
      var file = files[i]
      if (!isImageCandidate(file)) {
        out.push(file)
        continue
      }
      try {
        var converted = await normalize(file)
        out.push(converted ? converted.file : file)
        if (converted)
          console.debug(
            '[dsh-paste-image] ' +
              converted.from +
              ' -> ' +
              converted.to +
              ' ' +
              converted.width +
              'x' +
              converted.height,
          )
      } catch (error) {
        out.push(file)
        console.debug(
          '[dsh-paste-image] keep original (' +
            (file.type || 'no type') +
            '): ' +
            (error && error.message ? error.message : String(error)),
        )
      }
    }
    reroute(out)
  }

  function install() {
    document.addEventListener(
      'paste',
      function (event) {
        void handle(event, event.clipboardData)
      },
      true,
    )
    document.addEventListener(
      'drop',
      function (event) {
        void handle(event, event.dataTransfer)
      },
      true,
    )
    return function () {}
  }

  var api = {
    sniff: sniff,
    decodeXpm: decodeXpm,
    decodeBmp: decodeBmp,
    normalize: normalize,
    isImageCandidate: isImageCandidate,
    install: install,
  }

  if (typeof window !== 'undefined' && window.__ModuleLoader__ && typeof window.__ModuleLoader__.load === 'function') {
    window.__ModuleLoader__.load({
      id: 'dsh-paste-image',
      factory: function () {
        return {
          apply: function (ctx) {
            if (ctx && typeof ctx.effect === 'function') {
              ctx.effect(install, 'paste-image')
              return
            }
            install()
          },
        }
      },
    })
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = api
})()
