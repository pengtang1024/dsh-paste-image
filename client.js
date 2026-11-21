;(function () {
  'use strict'

  var NATIVE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']
  var NATIVE_SET = new Set(NATIVE_TYPES)
  var NATIVE_EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' }
  // 转换产出的编码：PNG 不传 quality，JPEG/WebP 按设置的质量编码。
  var OUTPUT_FORMATS = {
    png: { mime: 'image/png', ext: 'png', quality: false },
    jpeg: { mime: 'image/jpeg', ext: 'jpg', quality: true },
    webp: { mime: 'image/webp', ext: 'webp', quality: true },
  }
  var OUTPUT_EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }
  var MIME_ALIAS = {
    'image/jpg': 'image/jpeg',
    'image/pjpeg': 'image/jpeg',
    'image/x-png': 'image/png',
    'image/x-bmp': 'image/bmp',
    'image/x-ms-bmp': 'image/bmp',
    'image/x-win-bitmap': 'image/bmp',
    'image/vnd.microsoft.icon': 'image/x-icon',
    'image/x-xpixmap': 'image/xpm',
    'image/x-xpm': 'image/xpm',
    'image/svg+xml': 'image/svg',
  }
  var IMAGE_EXT = /\.(png|jpe?g|jfif|gif|webp|bmp|dib|tiff?|xpm|avif|ico|cur|svg|heic|heif)$/i
  var MAX_PIXELS = 64 * 1024 * 1024

  // ---------- 运行时设置 ----------
  // 默认值就是引入配置页之前的行为：开启、最多 8 个文件、长边 4096、输出 PNG、质量 0.92、
  // 四种格式全转换、转换日志开。只存在浏览器 localStorage 里（隐私模式或被禁用时退回内存），Host 侧不参与。
  var SETTINGS_KEY = 'dsh-paste-image.settings.v1'
  var SETTINGS_DEFAULTS = {
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
  var SETTINGS_RANGES = { maxFiles: [1, 8], maxSide: [512, 8192], quality: [0.1, 1] }
  var SETTINGS_DECIMALS = { quality: 2 }
  var SETTINGS_FLAGS = ['enabled', 'convertXpm', 'convertBmp', 'convertSvg', 'convertIco', 'logConversions']
  var SETTINGS_ENUMS = { outputFormat: ['png', 'jpeg', 'webp'] }
  // 文件头嗅探出的类型 -> 对应的转换开关；未列出的类型（PNG/JPEG/GIF/WebP/TIFF 等）不受开关约束。
  var CONVERT_FLAGS = {
    'image/xpm': 'convertXpm',
    'image/bmp': 'convertBmp',
    'image/svg': 'convertSvg',
    'image/x-icon': 'convertIco',
  }

  function copySettings(source) {
    var out = {}
    Object.keys(SETTINGS_DEFAULTS).forEach(function (key) {
      out[key] = source && typeof source[key] !== 'undefined' ? source[key] : SETTINGS_DEFAULTS[key]
    })
    return out
  }

  // 布尔值强制布尔化；枚举只认设定值，其余一律回默认；数字先按各自精度取整再夹到区间内，
  // 非数字（NaN/Infinity/对象）保留原值，这样界面里清空输入框不会把已保存的值打成 0。
  function sanitizeSettings(patch, base) {
    var next = copySettings(base)
    if (!patch || typeof patch !== 'object') return next
    SETTINGS_FLAGS.forEach(function (flag) {
      if (typeof patch[flag] !== 'undefined') next[flag] = Boolean(patch[flag])
    })
    Object.keys(SETTINGS_ENUMS).forEach(function (name) {
      if (typeof patch[name] === 'undefined') return
      var value = String(patch[name]).toLowerCase()
      next[name] = SETTINGS_ENUMS[name].indexOf(value) < 0 ? SETTINGS_DEFAULTS[name] : value
    })
    Object.keys(SETTINGS_RANGES).forEach(function (name) {
      if (typeof patch[name] === 'undefined') return
      var value = Number(patch[name])
      if (!Number.isFinite(value)) return
      var range = SETTINGS_RANGES[name]
      var decimals = SETTINGS_DECIMALS[name]
      var rounded = decimals ? Number(value.toFixed(decimals)) : Math.round(value)
      next[name] = Math.min(range[1], Math.max(range[0], rounded))
    })
    return next
  }

  function readStoredSettings() {
    try {
      if (typeof localStorage === 'undefined' || !localStorage) return null
      var raw = localStorage.getItem(SETTINGS_KEY)
      return raw ? JSON.parse(raw) : null
    } catch (error) {
      return null
    }
  }

  function writeStoredSettings(value) {
    try {
      if (typeof localStorage === 'undefined' || !localStorage) return false
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(value))
      return true
    } catch (error) {
      return false
    }
  }

  var settings = sanitizeSettings(readStoredSettings(), SETTINGS_DEFAULTS)

  function getSettings() {
    return copySettings(settings)
  }

  function applySettings(patch) {
    settings = sanitizeSettings(patch, settings)
    writeStoredSettings(settings)
    return copySettings(settings)
  }

  function resetSettings() {
    settings = copySettings(SETTINGS_DEFAULTS)
    writeStoredSettings(settings)
    return copySettings(settings)
  }

  // 用户在配置页关掉某种格式的转换后，该类型的粘贴必须原样交给合成器：返回 null 即“别动这个文件”。
  function conversionAllowed(kind) {
    var flag = CONVERT_FLAGS[kind]
    return !flag || settings[flag] !== false
  }

  // 头探测长度：所有魔数、DIB 头（<=124B）与 SVG 文本探测（1024B）都落在这一段内。
  var HEAD_PROBE = 1024
  var REROUTED = '__dshPasteImageRerouted'
  var HANDLED = '__dshPasteImageHandled'
  var INSTALLED = '__dshPasteImageInstalled'
  var BMP_HEADERS = { 12: true, 40: true, 52: true, 56: true, 64: true, 108: true, 124: true }
  var HEIC_BRANDS = { heic: true, heix: true, heis: true, heim: true, hevc: true, hevx: true, mif1: true, msf1: true }
  var BMP_BPPS = { 1: true, 4: true, 8: true, 16: true, 24: true, 32: true }
  var BMP_COMPRESSION = { 0: true, 1: true, 2: true, 3: true, 4: true, 5: true, 6: true }

  function ascii(bytes, start, len) {
    var out = ''
    for (var i = start; i < start + len && i < bytes.length; i++) out += String.fromCharCode(bytes[i])
    return out
  }

  function unit32(bytes, offset) {
    return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0
  }

  function aliasMime(type) {
    return MIME_ALIAS[type] || type
  }

  // 无文件头的 DIB（BITMAPINFOHEADER 起步，Windows CF_DIB 形状）。
  function dibHeaderSize(bytes) {
    if (bytes.length < 16) return 0
    var size = unit32(bytes, 0)
    if (!BMP_HEADERS[size]) return 0
    if (size === 12) {
      var width = bytes[4] | (bytes[5] << 8)
      var height = bytes[6] | (bytes[7] << 8)
      var planes = bytes[8] | (bytes[9] << 8)
      var bpp = bytes[10] | (bytes[11] << 8)
      return width > 0 && height > 0 && planes === 1 && (bpp === 1 || bpp === 4 || bpp === 8 || bpp === 24) ? size : 0
    }
    if (bytes.length < 20) return 0
    var w = unit32(bytes, 4) | 0
    var h = unit32(bytes, 8) | 0
    var pl = bytes[12] | (bytes[13] << 8)
    var bits = bytes[14] | (bytes[15] << 8)
    var compression = unit32(bytes, 16)
    if (!(w > 0) || h === 0 || pl !== 1 || !BMP_BPPS[bits]) return 0
    if (compression !== 0 && compression !== 1 && compression !== 2 && compression !== 3 && compression !== 6) return 0
    return w * Math.abs(h) > MAX_PIXELS ? 0 : size
  }

  function looksLikeSvg(bytes) {
    var head = new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(0, Math.min(bytes.length, 1024)))
    head = head.replace(/^\uFEFF/, '').replace(/^\s+/, '')
    if (head.charAt(0) !== '<') return false
    return /<svg[\s>]/i.test(head)
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
    if (bytes.length >= 12 && ascii(bytes, 4, 4) === 'ftyp') {
      var brand = ascii(bytes, 8, 4).toLowerCase()
      if (brand === 'avif' || brand === 'avis') return 'image/avif'
      if (HEIC_BRANDS[brand]) return 'image/heic'
    }
    if (bytes.length >= 4 && bytes[0] === 0 && bytes[1] === 0 && (bytes[2] === 1 || bytes[2] === 2) && bytes[3] === 0)
      return 'image/x-icon'
    if (looksLikeSvg(bytes)) return 'image/svg'
    if (dibHeaderSize(bytes)) return 'image/bmp'
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

  // 复用的 1x1 canvas：一张 XPM 动辄几十上百个调色板颜色，逐色新建 canvas 纯属开销。
  var colorCanvas = null

  function colorContext() {
    if (!colorCanvas) {
      colorCanvas = document.createElement('canvas')
      colorCanvas.width = 1
      colorCanvas.height = 1
    }
    return colorCanvas.getContext('2d')
  }

  // 用 canvas 把任意 CSS 颜色解析成 RGBA，顺带支持命名色与 4/8/12 位十六进制。
  function resolveColor(color) {
    if (!color || color === 'None') return [0, 0, 0, 0]
    var ctx = colorContext()
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
    var strings = xpmStrings(text.replace(/^\uFEFF/, ''))
    if (strings.length < 2) throw new Error('xpm: no strings')
    var head = strings[0].trim().split(/\s+/).map(Number)
    var width = head[0]
    var height = head[1]
    var colors = head[2]
    var cpp = head[3] || 1
    if (!(width > 0 && height > 0 && colors > 0)) throw new Error('xpm: bad header ' + strings[0])
    if (width * height > MAX_PIXELS) throw new Error('xpm: too large')

    var palette = new Map()
    // cpp===1 时按字符码建索引，像素循环里就不用为每个像素 row.slice 出一枚字符串
    // （字符码与单字符 key 一一对应；越界位置两边都取到空 key，语义不变）。
    var codePalette = cpp === 1 ? new Map() : null
    for (var i = 1; i <= colors; i++) {
      var line = strings[i] || ''
      var key = line.slice(0, cpp)
      var rest = line.slice(cpp)
      var m = /\bc\s+([^\s]+(?:\s+[^\s]+)?)/.exec(rest)
      var raw = m ? m[1].trim() : '#000000'
      var color = resolveColor(raw) || [0, 0, 0, 255]
      if (codePalette) codePalette.set(key.charCodeAt(0), color)
      else palette.set(key, color)
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
        var rgba = codePalette ? codePalette.get(row.charCodeAt(x)) : palette.get(row.slice(x * cpp, (x + 1) * cpp))
        rgba = rgba || [0, 0, 0, 0]
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

  // ---------- BMP / DIB ----------

  function parseBmp(bytes) {
    var dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    var file = bytes.length >= 18 && dv.getUint16(0, true) === 0x4d42
    var p = file ? 14 : 0
    if (bytes.length < p + 16) throw new Error('bmp: truncated header')
    var headerSize = dv.getUint32(p, true)
    if (!BMP_HEADERS[headerSize]) throw new Error('bmp: unsupported header ' + headerSize)
    var info = {
      headerSize: headerSize,
      width: 0,
      height: 0,
      bpp: 0,
      compression: 0,
      clrUsed: 0,
      imageSize: 0,
      paletteStride: headerSize === 12 ? 3 : 4,
      paletteOffset: p + headerSize,
      masks: null,
      offset: 0,
    }
    if (headerSize === 12) {
      info.width = dv.getUint16(p + 4, true)
      info.height = dv.getInt16(p + 6, true)
      info.bpp = dv.getUint16(p + 10, true)
      if (info.bpp !== 1 && info.bpp !== 4 && info.bpp !== 8 && info.bpp !== 24)
        throw new Error('bmp: core header bpp ' + info.bpp)
    } else {
      info.width = dv.getInt32(p + 4, true)
      info.height = dv.getInt32(p + 8, true)
      info.bpp = dv.getUint16(p + 14, true)
      info.compression = dv.getUint32(p + 16, true)
      info.imageSize = dv.getUint32(p + 20, true)
      info.clrUsed = dv.getUint32(p + 32, true)
      // BI_CMYK and friends (11/12/13) are not decoded; refuse instead of guessing channel order.
      if (!BMP_COMPRESSION[info.compression]) throw new Error('bmp: unsupported compression ' + info.compression)
    }
    if (!(info.width > 0) || info.height === 0) throw new Error('bmp: bad dimensions')
    if (info.width * Math.abs(info.height) > MAX_PIXELS) throw new Error('bmp: too large')
    if (!BMP_BPPS[info.bpp]) throw new Error('bmp: unsupported bpp ' + info.bpp)

    var maskBytes = 0
    if (info.compression === 3 || info.compression === 6) {
      var mo = p + 40
      if (mo + 12 > bytes.length) throw new Error('bmp: truncated masks')
      info.masks = [dv.getUint32(mo, true), dv.getUint32(mo + 4, true), dv.getUint32(mo + 8, true)]
      if (info.compression === 6 && mo + 16 <= bytes.length) info.masks.push(dv.getUint32(mo + 12, true))
      if (headerSize === 40) maskBytes = info.compression === 6 ? 16 : 12
    }

    if (file) {
      info.offset = dv.getUint32(10, true)
    } else {
      var paletteBytes = info.bpp <= 8 ? (info.clrUsed || 1 << info.bpp) * info.paletteStride : 0
      info.offset = p + headerSize + maskBytes + paletteBytes
    }
    if (info.offset > bytes.length) throw new Error('bmp: bad pixel offset')
    return info
  }

  function maskChannel(mask) {
    if (!mask) return null
    var m = mask >>> 0
    var shift = 0
    while (shift < 32 && ((m >>> shift) & 1) === 0) shift++
    if (shift === 32) return null
    return { shift: shift, max: m >>> shift, mask: m }
  }

  function maskValue(value, channel) {
    if (!channel) return 0
    var v = (value & channel.mask) >>> channel.shift
    return channel.max === 255 ? v : Math.round((v * 255) / channel.max)
  }

  function bmpPalette(bytes, info) {
    var palette = new Uint8Array(256 * 4)
    for (var a = 0; a < 256; a++) palette[a * 4 + 3] = 255
    var count = Math.min(info.bpp <= 8 ? info.clrUsed || 1 << info.bpp : 0, 256)
    for (var i = 0; i < count; i++) {
      var po = info.paletteOffset + i * info.paletteStride
      if (po + 3 > bytes.length) break
      palette[i * 4] = bytes[po + 2]
      palette[i * 4 + 1] = bytes[po + 1]
      palette[i * 4 + 2] = bytes[po]
      if (info.paletteStride === 4 && bytes[po + 3]) palette[i * 4 + 3] = bytes[po + 3]
    }
    return palette
  }

  function putIndexed(data, width, x, y, index, palette) {
    var o = (y * width + x) * 4
    data[o] = palette[index * 4]
    data[o + 1] = palette[index * 4 + 1]
    data[o + 2] = palette[index * 4 + 2]
    data[o + 3] = palette[index * 4 + 3]
  }

  function decodeRleBmp(bytes, info, data, width, height, topDown, palette) {
    var rle4 = info.compression === 2
    var x = 0
    var y = 0
    var i = info.offset
    while (i + 1 < bytes.length) {
      var count = bytes[i++]
      var value = bytes[i++]
      if (count > 0) {
        for (var k = 0; k < count; k++) {
          if (x < width && y < height) {
            var idx = rle4 ? (k % 2 === 0 ? value >> 4 : value & 0x0f) : value
            putIndexed(data, width, x, topDown ? y : height - 1 - y, idx, palette)
          }
          x++
        }
      } else if (value === 0) {
        x = 0
        y++
        if (y >= height) break
      } else if (value === 1) {
        break
      } else if (value === 2) {
        if (i + 1 >= bytes.length) break
        x += bytes[i++]
        y += bytes[i++]
        if (y >= height) break
      } else {
        var n = value
        var used = 0
        if (rle4) {
          var pairs = (n + 1) >> 1
          for (var j = 0; j < pairs && i < bytes.length; j++) {
            var b = bytes[i++]
            used++
            if (x < width && y < height) {
              putIndexed(data, width, x, topDown ? y : height - 1 - y, b >> 4, palette)
            }
            x++
            if (j * 2 + 1 < n) {
              if (x < width && y < height) {
                putIndexed(data, width, x, topDown ? y : height - 1 - y, b & 0x0f, palette)
              }
              x++
            }
          }
        } else {
          for (var m = 0; m < n && i < bytes.length; m++) {
            var v = bytes[i++]
            used++
            if (x < width && y < height) {
              putIndexed(data, width, x, topDown ? y : height - 1 - y, v, palette)
            }
            x++
          }
        }
        if (used & 1) i++
      }
      if (y >= height) break
    }
  }

  function decodeBmp(bytes) {
    var info = parseBmp(bytes)
    var dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    var width = info.width
    var topDown = info.height < 0
    var height = topDown ? -info.height : info.height
    var bpp = info.bpp
    if (info.compression === 4 || info.compression === 5) throw new Error('bmp: embedded payload')

    var canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    var ctx = canvas.getContext('2d')
    var image = ctx.createImageData(width, height)
    var data = image.data

    if (info.compression === 1 || info.compression === 2) {
      decodeRleBmp(bytes, info, data, width, height, topDown, bmpPalette(bytes, info))
    } else if (bpp <= 8) {
      var palette = bmpPalette(bytes, info)
      var stride = ((bpp * width + 31) >> 5) << 2
      for (var y = 0; y < height; y++) {
        var srcRow = info.offset + (topDown ? y : height - 1 - y) * stride
        if (srcRow + stride > bytes.length) throw new Error('bmp: truncated pixels')
        for (var x = 0; x < width; x++) {
          var idx
          if (bpp === 8) idx = bytes[srcRow + x]
          else if (bpp === 4) idx = (bytes[srcRow + (x >> 1)] >> (x & 1 ? 0 : 4)) & 0x0f
          else idx = (bytes[srcRow + (x >> 3)] >> (7 - (x & 7))) & 1
          putIndexed(data, width, x, y, idx, palette)
        }
      }
    } else if (bpp === 16) {
      var masks16 = info.masks && info.masks[0] | info.masks[1] | info.masks[2] ? info.masks : [0x7c00, 0x03e0, 0x001f]
      var rc = maskChannel(masks16[0])
      var gc = maskChannel(masks16[1])
      var bc = maskChannel(masks16[2])
      var stride16 = ((16 * width + 31) >> 5) << 2
      for (var y16 = 0; y16 < height; y16++) {
        var row16 = info.offset + (topDown ? y16 : height - 1 - y16) * stride16
        if (row16 + stride16 > bytes.length) throw new Error('bmp: truncated pixels')
        for (var x16 = 0; x16 < width; x16++) {
          var v16 = dv.getUint16(row16 + x16 * 2, true)
          var o16 = (y16 * width + x16) * 4
          data[o16] = maskValue(v16, rc)
          data[o16 + 1] = maskValue(v16, gc)
          data[o16 + 2] = maskValue(v16, bc)
          data[o16 + 3] = 255
        }
      }
    } else if (bpp === 24) {
      var stride24 = ((24 * width + 31) >> 5) << 2
      for (var y24 = 0; y24 < height; y24++) {
        var row24 = info.offset + (topDown ? y24 : height - 1 - y24) * stride24
        if (row24 + stride24 > bytes.length) throw new Error('bmp: truncated pixels')
        for (var x24 = 0; x24 < width; x24++) {
          var s24 = row24 + x24 * 3
          var o24 = (y24 * width + x24) * 4
          data[o24] = bytes[s24 + 2]
          data[o24 + 1] = bytes[s24 + 1]
          data[o24 + 2] = bytes[s24]
          data[o24 + 3] = 255
        }
      }
    } else {
      var masks32 = info.masks && info.masks[0] | info.masks[1] | info.masks[2] ? info.masks : null
      var r32 = masks32 ? maskChannel(masks32[0]) : null
      var g32 = masks32 ? maskChannel(masks32[1]) : null
      var b32 = masks32 ? maskChannel(masks32[2]) : null
      var a32 = masks32 && masks32[3] ? maskChannel(masks32[3]) : null
      var anyAlpha = false
      for (var y32 = 0; y32 < height; y32++) {
        var row32 = info.offset + (topDown ? y32 : height - 1 - y32) * width * 4
        if (row32 + width * 4 > bytes.length) throw new Error('bmp: truncated pixels')
        for (var x32 = 0; x32 < width; x32++) {
          var s32 = row32 + x32 * 4
          var o32 = (y32 * width + x32) * 4
          if (masks32) {
            var v32 = dv.getUint32(s32, true)
            data[o32] = maskValue(v32, r32)
            data[o32 + 1] = maskValue(v32, g32)
            data[o32 + 2] = maskValue(v32, b32)
            data[o32 + 3] = a32 ? maskValue(v32, a32) : 255
          } else {
            var a = bytes[s32 + 3]
            data[o32] = bytes[s32 + 2]
            data[o32 + 1] = bytes[s32 + 1]
            data[o32 + 2] = bytes[s32]
            data[o32 + 3] = a
            if (a) anyAlpha = true
          }
        }
      }
      // 很多编码器把 32 位 BMP 的 alpha 全留成 0；整幅图都没有非零 alpha 时按不透明处理，
      // 否则粘贴出来的 PNG 会整张透明。
      if (!masks32 && !anyAlpha) for (var q = 3; q < data.length; q += 4) data[q] = 255
    }
    ctx.putImageData(image, 0, 0)
    return canvas
  }

  function bmpEmbedded(bytes) {
    var info
    try {
      info = parseBmp(bytes)
    } catch (error) {
      return null
    }
    if (info.compression !== 4 && info.compression !== 5) return null
    var start = info.offset
    var length = info.imageSize || bytes.length - start
    if (start + length > bytes.length) length = bytes.length - start
    var payload = bytes.subarray(start, start + length)
    var kind = sniff(payload)
    return kind === 'image/png' || kind === 'image/jpeg' ? { type: kind, data: payload } : null
  }

  // ---------- SVG / ICO ----------

  function svgSize(text) {
    var w = /<svg[^>]*\bwidth\s*=\s*["']\s*([\d.]+)/i.exec(text)
    var h = /<svg[^>]*\bheight\s*=\s*["']\s*([\d.]+)/i.exec(text)
    var box = /viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(text)
    return {
      width: w ? Number(w[1]) : box ? Number(box[1]) : 0,
      height: h ? Number(h[1]) : box ? Number(box[2]) : 0,
    }
  }

  function loadSvg(bytes) {
    return new Promise(function (resolve, reject) {
      if (typeof Image === 'undefined') throw new Error('svg: no Image')
      var text = new TextDecoder('utf-8', { fatal: false }).decode(bytes)
      var url = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' }))
      var size = svgSize(text)
      var img = new Image()
      var finish = function (fn, value) {
        URL.revokeObjectURL(url)
        fn(value)
      }
      img.onload = function () {
        finish(resolve, {
          image: img,
          width: img.naturalWidth || size.width || 300,
          height: img.naturalHeight || size.height || 150,
        })
      }
      img.onerror = function () {
        finish(reject, new Error('svg: decode failed'))
      }
      img.src = url
    })
  }

  function icoPngEntry(bytes) {
    if (bytes.length < 6) return null
    var dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    if (dv.getUint16(0, true) !== 0 || dv.getUint16(2, true) !== 1) return null
    var count = dv.getUint16(4, true)
    var best = null
    var bestArea = -1
    for (var i = 0; i < count; i++) {
      var e = 6 + i * 16
      if (e + 16 > bytes.length) break
      var w = bytes[e] || 256
      var h = bytes[e + 1] || 256
      var size = dv.getUint32(e + 8, true)
      var off = dv.getUint32(e + 12, true)
      if (!size || off + 8 > bytes.length || off + size > bytes.length) continue
      if (sniff(bytes.subarray(off, off + 8)) !== 'image/png') continue
      if (w * h > bestArea) {
        bestArea = w * h
        best = bytes.subarray(off, off + size)
      }
    }
    return best
  }

  // ---------- 规范化 ----------

  function canvasOf(source, width, height) {
    var w = width || source.width || source.naturalWidth || 1
    var h = height || source.height || source.naturalHeight || 1
    var scale = Math.min(1, settings.maxSide / Math.max(w, h))
    var canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(w * scale))
    canvas.height = Math.max(1, Math.round(h * scale))
    canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height)
    return canvas
  }

  // toDataURL 回退路径不能假设 atob 存在（非渲染进程的 vm/测试环境就没有），所以自带解码。
  // 预建 256 项查表（0 = 非法字符），避免逐字符在 64 字符表里 indexOf。
  var B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  var B64_LOOKUP = new Uint8Array(256)
  for (var b64 = 0; b64 < B64_ALPHABET.length; b64++) B64_LOOKUP[B64_ALPHABET.charCodeAt(b64)] = b64 + 1

  function base64Bytes(text) {
    var out = new Uint8Array(((text.length * 3) >> 2) + 3)
    var length = 0
    var buffer = 0
    var bits = 0
    for (var i = 0; i < text.length; i++) {
      var code = text.charCodeAt(i)
      var value = code < 256 ? B64_LOOKUP[code] - 1 : -1
      if (value < 0) continue
      buffer = ((buffer << 6) | value) & 0xffffff
      bits += 6
      if (bits >= 8) {
        bits -= 8
        out[length++] = (buffer >> bits) & 0xff
      }
    }
    return out.subarray(0, length)
  }

  function dataUrlBlob(canvas, mime, quality) {
    if (typeof canvas.toDataURL !== 'function') throw new Error('canvas.toBlob/toDataURL unavailable')
    var url = quality === null ? canvas.toDataURL(mime) : canvas.toDataURL(mime, quality)
    var comma = url.indexOf(',')
    if (comma < 0) throw new Error('canvas.toDataURL failed')
    var meta = url.slice(5, comma)
    if (meta.indexOf('base64') < 0) throw new Error('canvas.toDataURL is not base64')
    return new Blob([base64Bytes(url.slice(comma + 1))], { type: meta.split(';')[0] || 'image/png' })
  }

  // 统一编码入口：按选定 MIME 出 blob，PNG 不传 quality（浏览器不接受这个参数），
  // JPEG/WebP 传 0.1–1 的质量；没有 toBlob 时退回同一 MIME/quality 的 data URL。
  function encodeCanvas(canvas, mime, quality) {
    return new Promise(function (resolve, reject) {
      var done = function (blob) {
        blob ? resolve(blob) : reject(new Error('canvas.toBlob failed'))
      }
      if (typeof canvas.toBlob !== 'function') {
        try {
          resolve(dataUrlBlob(canvas, mime, quality))
        } catch (error) {
          reject(error)
        }
        return
      }
      if (quality === null) canvas.toBlob(done, mime)
      else canvas.toBlob(done, mime, quality)
    })
  }

  // JPEG 没有 alpha 通道：先把画布铺到不透明白底上再编码，透明像素才不会变黑。
  function flattenOnWhite(canvas) {
    var out = document.createElement('canvas')
    out.width = canvas.width
    out.height = canvas.height
    var ctx = out.getContext('2d')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, out.width, out.height)
    ctx.drawImage(canvas, 0, 0)
    return out
  }

  // 浏览器真正编码出来的类型（blob.type / data URL 的 MIME）才是最终类型：请求的格式不被支持时
  // 以实际类型为准，无法识别时退回 PNG，保证 File 的 type 与扩展名始终自洽、宿主不会拒收。
  function encodedMime(type) {
    var mime = aliasMime(String(type || '').toLowerCase())
    return OUTPUT_EXT[mime] ? mime : 'image/png'
  }

  async function toCanvas(file, bytes, kind) {
    if (kind === 'image/xpm') {
      return canvasOf(decodeXpm(new TextDecoder('utf-8', { fatal: false }).decode(bytes)))
    }
    if (kind === 'image/svg') {
      var svg = await loadSvg(bytes)
      return canvasOf(svg.image, svg.width, svg.height)
    }
    var type = kind || aliasMime((file.type || '').toLowerCase()) || 'application/octet-stream'
    try {
      var bitmap = await createImageBitmap(new Blob([bytes], { type: type }))
      return canvasOf(bitmap)
    } catch (error) {
      if (kind === 'image/bmp') {
        var embedded = bmpEmbedded(bytes)
        if (embedded) {
          var inner = await createImageBitmap(new Blob([embedded.data], { type: embedded.type }))
          return canvasOf(inner)
        }
        return canvasOf(decodeBmp(bytes))
      }
      if (kind === 'image/x-icon') {
        var png = icoPngEntry(bytes)
        if (!png) throw error
        var icon = await createImageBitmap(new Blob([png], { type: 'image/png' }))
        return canvasOf(icon)
      }
      throw error
    }
  }

  function fileName(file, ext) {
    var base = (file.name || 'image').replace(/\.[^.]+$/, '')
    return base + '.' + ext
  }

  // 只读文件头做嗅探。whole 为 true 表示这段头就是整个文件，后续可直接复用，
  // 不必回头再 file.arrayBuffer() 一次。缺少 slice/size 的类 File 对象返回 null，走原全量读取。
  async function readHead(file) {
    if (typeof file.slice !== 'function' || typeof file.size !== 'number') return null
    var bytes = new Uint8Array(await file.slice(0, HEAD_PROBE).arrayBuffer())
    var whole = bytes.length < HEAD_PROBE || file.size <= bytes.length
    return { bytes: bytes, whole: whole }
  }

  async function normalize(file) {
    var declared = aliasMime((file.type || '').toLowerCase())
    var head = await readHead(file)
    var kind = head ? sniff(head.bytes) : null
    // 该格式的转换被关掉：头部已经能定性，直接放行原文件，连整份字节都不读。
    if (kind && !conversionAllowed(kind)) return null
    // 原生类型且声明一致：本来就要原样放行，读 1KB 头就够了，整个文件不必进内存。
    if (head && kind && NATIVE_SET.has(kind) && declared === kind) return null
    var bytes
    if (head && head.whole) {
      bytes = head.bytes
    } else {
      bytes = new Uint8Array(await file.arrayBuffer())
      kind = sniff(bytes)
    }
    if (kind && !conversionAllowed(kind)) return null
    if (kind && NATIVE_SET.has(kind)) {
      if (declared === kind) return null
      if (!declared) {
        return {
          file: new File([bytes], fileName(file, NATIVE_EXT[kind]), { type: kind }),
          from: '(no type)',
          to: kind,
          width: 0,
          height: 0,
        }
      }
    }
    var canvas = await toCanvas(file, bytes, kind)
    var profile = OUTPUT_FORMATS[settings.outputFormat] || OUTPUT_FORMATS.png
    var encoded = profile.mime === 'image/jpeg' ? flattenOnWhite(canvas) : canvas
    var blob = await encodeCanvas(encoded, profile.mime, profile.quality ? settings.quality : null)
    var mime = encodedMime(blob.type)
    return {
      file: new File([blob], fileName(file, OUTPUT_EXT[mime]), { type: mime }),
      from: declared || '(no type)',
      to: mime,
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

  // reroute() 依赖 DataTransfer/DragEvent 构造器；缺任何一个就无法把文件送进合成器，
  // 此时必须彻底放手，让浏览器原生 paste/drop 路径继续跑（不 claim、不 preventDefault）。
  function canReroute() {
    return typeof DataTransfer === 'function' && typeof DragEvent === 'function'
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

  function claim(event) {
    if (event[HANDLED]) return false
    try {
      Object.defineProperty(event, HANDLED, { value: true })
    } catch (error) {
      event[HANDLED] = true
    }
    return true
  }

  async function handle(event, data) {
    // 总开关只停本插件的转换/拦截，不卸载监听：配置页保存后立刻生效，也不影响原生粘贴路径。
    if (!settings.enabled) return
    if (!data || event[REROUTED]) return
    if (!canReroute()) return
    var files = Array.prototype.slice.call(data.files || [])
    if (files.length === 0 || files.length > settings.maxFiles) return
    if (!files.some(isImageCandidate)) return
    if (!claim(event)) return
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
        if (converted && settings.logConversions)
          console.debug(
            '[dsh-paste-image] ' +
              converted.from +
              ' -> ' +
              converted.to +
              (converted.width ? ' ' + converted.width + 'x' + converted.height : ''),
          )
      } catch (error) {
        out.push(file)
        if (settings.logConversions)
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
    if (typeof document === 'undefined') return function () {}
    var record = document[INSTALLED]
    if (!record) {
      var onPaste = function (event) {
        void handle(event, event.clipboardData)
      }
      var onDrop = function (event) {
        void handle(event, event.dataTransfer)
      }
      // 现代 Chromium/Electron 走 AbortController；缺失时退回 removeEventListener，
      // 两种方式都保留 handler 引用，保证同一 record 能被准确卸载。
      var controller = typeof AbortController === 'function' ? new AbortController() : null
      var options = controller ? { capture: true, signal: controller.signal } : { capture: true }
      document.addEventListener('paste', onPaste, options)
      document.addEventListener('drop', onDrop, options)
      record = {
        refs: 0,
        release: function () {
          record.refs -= 1
          if (record.refs > 0) return
          if (controller) controller.abort()
          else {
            document.removeEventListener('paste', onPaste, true)
            document.removeEventListener('drop', onDrop, true)
          }
          delete document[INSTALLED]
        },
      }
      Object.defineProperty(document, INSTALLED, { value: record, configurable: true })
    }
    record.refs += 1
    return record.release
  }

  var api = {
    sniff: sniff,
    decodeXpm: decodeXpm,
    decodeBmp: decodeBmp,
    normalize: normalize,
    isImageCandidate: isImageCandidate,
    install: install,
    getSettings: getSettings,
    applySettings: applySettings,
    resetSettings: resetSettings,
  }

  if (typeof window !== 'undefined' && window.__ModuleLoader__ && typeof window.__ModuleLoader__.load === 'function') {
    window.__ModuleLoader__.load({
      id: 'dsh-paste-image',
      factory: function (require) {
        // react 只在这里取：Node vm 测试没有 window，也就不会走到这；顶层绝不能 require。
        var React = null
        try {
          React = require('react')
        } catch (error) {
          React = null
        }

        var NS = 'dsh-paste-image:settings'
        var DICTIONARIES = {
          zh: {
            summary: '图片粘贴转换',
            summaryEnabled: '已启用',
            summaryDisabled: '已停用',
            enabled: '启用插件',
            maxFiles: '单次最大文件数',
            maxSide: '长边上限 (px)',
            outputFormat: '输出格式',
            quality: '质量',
            qualityHint: 'PNG 为无损编码；质量只对 JPEG / WebP 生效。',
            formatHint:
              '照片类内容 JPEG/WebP 通常比 PNG 小约 80%；截图、文字和像素画往往 PNG 更小；需要透明请选 PNG 或 WebP。完整实测见 docs/output-formats.md。',
            convertXpm: '转换 XPM',
            convertBmp: '转换 BMP / DIB',
            convertSvg: '转换 SVG',
            convertIco: '转换 ICO / CUR',
            logConversions: '控制台转换日志',
            save: '保存',
            reset: '恢复默认',
            saved: '已保存',
            saveFailed: '保存失败',
            note: '设置只保存在这个浏览器里，保存后立即生效；恢复默认会写回全部默认值。',
          },
          en: {
            summary: 'Image paste conversion',
            summaryEnabled: 'enabled',
            summaryDisabled: 'disabled',
            enabled: 'Enable plugin',
            maxFiles: 'Max files per paste',
            maxSide: 'Long-edge limit (px)',
            outputFormat: 'Output format',
            quality: 'Quality',
            qualityHint: 'PNG is lossless; quality applies to JPEG / WebP only.',
            formatHint:
              'For photos, JPEG/WebP are usually about 80% smaller than PNG; for screenshots, text and pixel art PNG is often smaller; choose PNG or WebP when you need transparency. Full measurements: docs/output-formats.md.',
            convertXpm: 'Convert XPM',
            convertBmp: 'Convert BMP / DIB',
            convertSvg: 'Convert SVG',
            convertIco: 'Convert ICO / CUR',
            logConversions: 'Log conversions to console',
            save: 'Save',
            reset: 'Restore defaults',
            saved: 'Saved',
            saveFailed: 'Save failed',
            note: 'Settings live in this browser only and take effect immediately. Restoring writes every default back.',
          },
        }

        function createPage() {
          var styles = {
            summary: { color: 'var(--dsw-alias-label-secondary)', fontSize: '13px', lineHeight: '20px' },
            page: {
              display: 'flex',
              flexDirection: 'column',
              gap: '14px',
              color: 'var(--dsw-alias-label-primary)',
              fontSize: '13px',
            },
            row: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' },
            checkRow: { display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' },
            check: { margin: '0', accentColor: 'var(--dsw-alias-brand-primary)' },
            input: {
              width: '140px',
              padding: '4px 8px',
              borderRadius: '6px',
              border: '1px solid var(--dsw-alias-border-l2)',
              background: 'var(--dsw-alias-bg-layer-1)',
              color: 'var(--dsw-alias-label-primary)',
              fontSize: '13px',
            },
            buttons: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' },
            button: {
              padding: '5px 14px',
              borderRadius: '6px',
              border: '1px solid var(--dsw-alias-border-l2)',
              background: 'var(--dsw-alias-bg-layer-1)',
              color: 'var(--dsw-alias-label-primary)',
              fontSize: '13px',
              cursor: 'pointer',
            },
            ok: { color: 'var(--dsw-alias-state-success-primary)', fontSize: '12px' },
            error: { color: 'var(--dsw-alias-state-error-primary)', fontSize: '12px' },
            note: { color: 'var(--dsw-alias-label-tertiary)', fontSize: '12px', lineHeight: '18px' },
          }

          var FORMAT_OPTIONS = [
            { value: 'png', label: 'PNG' },
            { value: 'jpeg', label: 'JPEG' },
            { value: 'webp', label: 'WebP' },
          ]

          function formatLabel(value) {
            return value === 'jpeg' ? 'JPEG' : value === 'webp' ? 'WebP' : 'PNG'
          }

          function fallbackText(key) {
            return key
          }

          // 表单只在“保存”时写：draft 是本地状态，离开页面即丢弃。
          function SettingsForm(props) {
            var t = props && typeof props.t === 'function' ? props.t : fallbackText
            var draftState = React.useState(function () {
              return api.getSettings()
            })
            var draft = draftState[0]
            var setDraft = draftState[1]
            var statusState = React.useState('')
            var status = statusState[0]
            var setStatus = statusState[1]

            var update = function (key, value) {
              setDraft(function (current) {
                var next = {}
                Object.keys(current).forEach(function (name) {
                  next[name] = current[name]
                })
                next[key] = value
                return next
              })
              setStatus('')
            }

            var save = function () {
              try {
                setDraft(api.applySettings(draft))
                setStatus('saved')
              } catch (error) {
                setStatus('saveFailed')
              }
            }

            var reset = function () {
              try {
                setDraft(api.resetSettings())
                setStatus('saved')
              } catch (error) {
                setStatus('saveFailed')
              }
            }

            var checkbox = function (key) {
              return React.createElement(
                'label',
                { key: key, style: styles.checkRow },
                React.createElement('input', {
                  key: 'input',
                  type: 'checkbox',
                  style: styles.check,
                  checked: draft[key] === true,
                  onChange: function (event) {
                    update(key, event.target.checked)
                  },
                }),
                React.createElement('span', { key: 'text' }, t(key)),
              )
            }

            var number = function (key, min, max, step, options) {
              return React.createElement(
                'label',
                { key: key, style: styles.row },
                React.createElement('span', { key: 'text' }, t(key)),
                React.createElement('input', {
                  key: 'input',
                  type: 'number',
                  min: min,
                  max: max,
                  step: step,
                  value: String(draft[key]),
                  disabled: Boolean(options && options.disabled),
                  onChange: function (event) {
                    if (event.target.value === '') return
                    var value = Number(event.target.value)
                    if (Number.isFinite(value)) update(key, value)
                  },
                  style: styles.input,
                }),
              )
            }

            var select = function (key, options) {
              return React.createElement(
                'label',
                { key: key, style: styles.row },
                React.createElement('span', { key: 'text' }, t(key)),
                React.createElement(
                  'select',
                  {
                    key: 'select',
                    value: draft[key],
                    onChange: function (event) {
                      update(key, String(event.target.value))
                    },
                    style: styles.input,
                  },
                  options.map(function (option) {
                    return React.createElement('option', { key: option.value, value: option.value }, option.label)
                  }),
                ),
              )
            }

            var statusNode = status
              ? React.createElement(
                  'span',
                  { key: 'status', style: status === 'saved' ? styles.ok : styles.error },
                  t(status),
                )
              : null

            return React.createElement(
              'div',
              { style: styles.page },
              checkbox('enabled'),
              number('maxFiles', 1, 8, 1),
              number('maxSide', 512, 8192, 256),
              select('outputFormat', FORMAT_OPTIONS),
              React.createElement('div', { key: 'formatHint', style: styles.note }, t('formatHint')),
              number('quality', 0.1, 1, 0.01, { disabled: draft.outputFormat === 'png' }),
              React.createElement('div', { key: 'qualityHint', style: styles.note }, t('qualityHint')),
              checkbox('convertXpm'),
              checkbox('convertBmp'),
              checkbox('convertSvg'),
              checkbox('convertIco'),
              checkbox('logConversions'),
              React.createElement(
                'div',
                { key: 'actions', style: styles.buttons },
                React.createElement(
                  'button',
                  { key: 'save', type: 'button', style: styles.button, onClick: save },
                  t('save'),
                ),
                React.createElement(
                  'button',
                  { key: 'reset', type: 'button', style: styles.button, onClick: reset },
                  t('reset'),
                ),
                statusNode,
              ),
              React.createElement('div', { key: 'note', style: styles.note }, t('note')),
            )
          }

          // view/t 都可能缺：summary 给插件行卡片用，其余（含 undefined）按完整表单渲染。
          return function Page(props) {
            var t = props && typeof props.t === 'function' ? props.t : fallbackText
            var view = props && props.view
            if (view === 'summary') {
              var effective = api.getSettings()
              return React.createElement(
                'div',
                { style: styles.summary },
                t('summary') +
                  ' · ' +
                  t(effective.enabled ? 'summaryEnabled' : 'summaryDisabled') +
                  ' · ' +
                  formatLabel(effective.outputFormat),
              )
            }
            return React.createElement(SettingsForm, { t: t })
          }
        }

        var Page = React ? createPage() : null

        return {
          inject: ['slots', 'locale'],
          apply: function (ctx) {
            if (!ctx || typeof ctx.effect !== 'function') {
              install()
              return
            }
            // 监听器只挂一次；总开关交给 settings.enabled 在 handle 里判断，不来回卸载。
            ctx.effect(install, 'paste-image')
            if (Page && ctx.locale && typeof ctx.locale.register === 'function') {
              ctx.effect(function () {
                return ctx.locale.register(NS, DICTIONARIES)
              }, 'paste-image: settings dictionaries')
            }
            if (
              Page &&
              ctx.slots &&
              typeof ctx.slots.inject === 'function' &&
              typeof ctx.slots.register === 'function'
            ) {
              ctx.slots.inject('plugins.row.config', function () {
                return ctx.slots.register(
                  { name: 'plugins.row.config', key: 'dsh-paste-image#paste-image', locale: NS },
                  Page,
                )
              })
            }
          },
        }
      },
    })
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = api
})()
