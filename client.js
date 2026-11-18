;(function () {
  'use strict'

  var NATIVE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']
  var NATIVE_SET = new Set(NATIVE_TYPES)
  var NATIVE_EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' }
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
  var MAX_SIDE = 4096
  var MAX_FILES = 8
  var MAX_PIXELS = 64 * 1024 * 1024
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

  async function normalize(file) {
    var bytes = new Uint8Array(await file.arrayBuffer())
    var kind = sniff(bytes)
    var declared = aliasMime((file.type || '').toLowerCase())
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
    var blob = await toPngBlob(canvas)
    return {
      file: new File([blob], fileName(file, 'png'), { type: 'image/png' }),
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
    if (!data || event[REROUTED]) return
    var files = Array.prototype.slice.call(data.files || [])
    if (files.length === 0 || files.length > MAX_FILES) return
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
        if (converted)
          console.debug(
            '[dsh-paste-image] ' +
              converted.from +
              ' -> ' +
              converted.to +
              (converted.width ? ' ' + converted.width + 'x' + converted.height : ''),
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
    if (typeof document === 'undefined') return function () {}
    var installed = document[INSTALLED]
    if (typeof installed === 'function') return installed
    var controller = new AbortController()
    var options = { capture: true, signal: controller.signal }
    document.addEventListener(
      'paste',
      function (event) {
        void handle(event, event.clipboardData)
      },
      options,
    )
    document.addEventListener(
      'drop',
      function (event) {
        void handle(event, event.dataTransfer)
      },
      options,
    )
    var dispose = function () {
      controller.abort()
      delete document[INSTALLED]
    }
    Object.defineProperty(document, INSTALLED, { value: dispose, configurable: true })
    return dispose
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
