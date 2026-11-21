// Reproducible micro-benchmarks for the dsh-paste-image renderer client.
//
//   node bench/bench.mjs           full run (a few seconds; far below one minute)
//   node bench/bench.mjs --quick   CI smoke run: fewer warmups and iterations
//   node bench/bench.mjs --json    machine-readable output (stdout is JSON only)
//
// The benchmarks load the real client.js into a vm context with the same minimal
// canvas/document stub the unit tests use, so the shipped decoder is what runs.
// Each timing is the median of several rounds of identical iterations, which
// keeps GC pauses and scheduler noise from dominating a single sample.
// Numbers are indicative, not thresholds: V8 tiering, other load on the machine
// and thermal state routinely move them by 10-30%.

import { readFileSync } from 'node:fs'
import { arch, cpus, platform, release } from 'node:os'
import { dirname, join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import { createDocument, makeRle8Bmp } from '../tests/helpers/dom.mjs'

const MIB = 1024 * 1024
const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')

const argv = process.argv.slice(2)
const quick = argv.includes('--quick')
const asJson = argv.includes('--json')
const unknown = argv.filter((arg) => arg !== '--quick' && arg !== '--json')
if (unknown.length > 0) {
  console.error('unknown argument(s): ' + unknown.join(' '))
  console.error('usage: node bench/bench.mjs [--quick] [--json]')
  process.exit(2)
}

// ---------- loading the real client ----------

function loadClient(document) {
  const context = vm.createContext({
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
  })
  vm.runInContext(readFileSync(join(ROOT, 'client.js'), 'utf8'), context, { filename: 'client.js' })
  return context.module.exports
}

// ---------- fixtures ----------

function buildPngBuffer(byteLength) {
  const bytes = new Uint8Array(byteLength)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  // Filler payload; sniff() must decide from the signature without scanning it.
  bytes.fill(0x5a, 8)
  return bytes
}

function writeBmpHeader(bytes, width, height, bpp, imageSize) {
  const dv = new DataView(bytes.buffer)
  bytes[0] = 0x42
  bytes[1] = 0x4d
  dv.setUint32(2, bytes.length, true)
  dv.setUint32(10, 54, true)
  dv.setUint32(14, 40, true)
  dv.setInt32(18, width, true)
  dv.setInt32(22, height, true)
  dv.setUint16(26, 1, true)
  dv.setUint16(28, bpp, true)
  dv.setUint32(34, imageSize, true)
}

function buildBmp24(width, height) {
  const stride = ((24 * width + 31) >> 5) << 2
  const bytes = new Uint8Array(54 + stride * height)
  writeBmpHeader(bytes, width, height, 24, stride * height)
  for (let y = 0; y < height; y++) {
    const row = 54 + (height - 1 - y) * stride
    for (let x = 0; x < width; x++) {
      const o = row + x * 3
      bytes[o] = (x + y) & 0xff
      bytes[o + 1] = (x * 3 + y * 5) & 0xff
      bytes[o + 2] = (x * 7 + y) & 0xff
    }
  }
  return bytes
}

function buildBmp32(width, height) {
  const stride = width * 4
  const bytes = new Uint8Array(54 + stride * height)
  writeBmpHeader(bytes, width, height, 32, stride * height)
  for (let y = 0; y < height; y++) {
    const row = 54 + (height - 1 - y) * stride
    for (let x = 0; x < width; x++) {
      const o = row + x * 4
      bytes[o] = (x * 5 + y) & 0xff
      bytes[o + 1] = (x + y * 3) & 0xff
      bytes[o + 2] = (x * 7 + y * 11) & 0xff
      // alpha stays 0 on purpose: exercises the "all-zero alpha means opaque" fix-up pass.
    }
  }
  return bytes
}

function buildRle8Bmp(width, height, colorCount) {
  const palette = Array.from({ length: colorCount }, (_, i) => [(i * 32) & 0xff, (255 - i * 16) & 0xff, (i * 8) & 0xff])
  const stream = []
  for (let y = 0; y < height; y++) {
    let left = width
    let color = y % colorCount
    while (left > 0) {
      const run = Math.min(left, 255)
      stream.push(run, color)
      left -= run
      color = (color + 1) % colorCount
    }
    stream.push(0, 0)
  }
  stream.push(0, 1)
  return makeRle8Bmp(width, height, stream, palette)
}

const XPM_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

function buildXpm(width, height, colorCount) {
  const lines = ['/* XPM */', 'static char * image[] = {', `"${width} ${height} ${colorCount} 1",`]
  for (let i = 0; i < colorCount; i++) {
    const hex = ((i * 0x4f1b) & 0xffffff).toString(16).padStart(6, '0')
    lines.push(`"${XPM_CHARS[i]} c #${hex}",`)
  }
  for (let y = 0; y < height; y++) {
    let row = ''
    for (let x = 0; x < width; x++) row += XPM_CHARS[(x * 3 + y * 5) % colorCount]
    lines.push(`"${row}",`)
  }
  lines.push('};')
  return lines.join('\n')
}

// A File that counts the bytes its arrayBuffer() hands out, so the pass-through
// case can show how much of the file the current implementation actually pulls in.
function countingFile(bytes, name, type) {
  const file = new File([bytes], name, { type })
  const read = file.arrayBuffer.bind(file)
  const stats = { reads: 0, bytes: 0 }
  file.arrayBuffer = async () => {
    const buffer = await read()
    stats.reads += 1
    stats.bytes += buffer.byteLength
    return buffer
  }
  return {
    file,
    stats,
    reset() {
      stats.reads = 0
      stats.bytes = 0
    },
  }
}

// ---------- timing ----------

// Iterations are per round; `steps.iterations * steps.rounds` calls are timed.
function plan(iterations, warmup, rounds) {
  if (!quick) return { iterations, warmup, rounds }
  return {
    iterations: Math.max(1, Math.ceil(iterations / 5)),
    warmup: Math.max(1, Math.ceil(warmup / 3)),
    rounds: Math.max(2, rounds - 2),
  }
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

function measureSync(fn, steps) {
  for (let i = 0; i < steps.warmup; i++) fn()
  const samples = []
  for (let round = 0; round < steps.rounds; round++) {
    const start = performance.now()
    for (let i = 0; i < steps.iterations; i++) fn()
    samples.push((performance.now() - start) / steps.iterations)
  }
  return { iterations: steps.iterations * steps.rounds, msPerOp: median(samples) }
}

async function measureAsync(fn, steps, afterWarmup) {
  for (let i = 0; i < steps.warmup; i++) await fn()
  if (afterWarmup) afterWarmup()
  const samples = []
  for (let round = 0; round < steps.rounds; round++) {
    const start = performance.now()
    for (let i = 0; i < steps.iterations; i++) await fn()
    samples.push((performance.now() - start) / steps.iterations)
  }
  return { iterations: steps.iterations * steps.rounds, msPerOp: median(samples) }
}

function throughput(bytesPerOp, msPerOp) {
  if (!bytesPerOp || !(msPerOp > 0)) return null
  return bytesPerOp / 1e6 / (msPerOp / 1000)
}

const results = []

function record(name, measured, { inputBytes = null, bytesRead = null } = {}) {
  results.push({
    case: name,
    iterations: measured.iterations,
    opsPerSec: 1000 / measured.msPerOp,
    msPerOp: measured.msPerOp,
    mbPerSec: throughput(inputBytes, measured.msPerOp),
    bytesRead,
  })
}

// ---------- reporting ----------

function fixed(value, digits) {
  return value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

function msDigits(value) {
  if (value >= 100) return 1
  if (value >= 10) return 2
  if (value >= 1) return 3
  if (value >= 0.01) return 4
  if (value >= 0.001) return 5
  return 6
}

function formatBytesRead(bytes) {
  if (bytes === null) return 'n/a'
  return `${bytes.toLocaleString('en-US')} (${(bytes / MIB).toFixed(1)} MiB)`
}

function formatTable(rows) {
  const widths = rows[0].map((_, column) => Math.max(...rows.map((row) => row[column].length)))
  const render = (row) =>
    row.map((cell, column) => (column === 0 ? cell.padEnd(widths[column]) : cell.padStart(widths[column]))).join('  ')
  const rule = widths.map((width) => '-'.repeat(width)).join('  ')
  return [render(rows[0]), rule, ...rows.slice(1).map(render)].join('\n')
}

function buildTable() {
  const rows = [['case', 'iters', 'ops/sec', 'ms/op', 'MB/s', 'bytes read']]
  for (const result of results) {
    rows.push([
      result.case,
      String(result.iterations),
      result.opsPerSec >= 1000 ? fixed(result.opsPerSec, 0) : fixed(result.opsPerSec, 1),
      fixed(result.msPerOp, msDigits(result.msPerOp)),
      result.mbPerSec === null ? 'n/a' : fixed(result.mbPerSec, 1),
      formatBytesRead(result.bytesRead),
    ])
  }
  return rows
}

// ---------- run ----------

const document = createDocument()
const api = loadClient(document)

const bigPng = buildPngBuffer(20 * MIB)
const bmp24 = buildBmp24(1024, 1024)
const bmp32 = buildBmp32(1024, 1024)
const rle8 = buildRle8Bmp(1024, 1024, 8)
const xpmText = buildXpm(512, 512, 64)
const xpmBytes = Buffer.byteLength(xpmText)

// Cheap sanity checks: fail loudly instead of benchmarking the wrong code path.
if (api.sniff(bigPng) !== 'image/png') throw new Error('fixture check: big PNG not sniffed as image/png')
if (api.sniff(bmp24) !== 'image/bmp') throw new Error('fixture check: 24-bit BMP not sniffed as image/bmp')
if (api.sniff(rle8) !== 'image/bmp') throw new Error('fixture check: RLE8 BMP not sniffed as image/bmp')
if (api.sniff(new TextEncoder().encode(xpmText)) !== 'image/xpm') throw new Error('fixture check: XPM not sniffed')

{
  // Five rounds of 500k calls keeps each timed sample measurable without the
  // call overhead of performance.now() leaking into a ~5 ns operation.
  const steps = plan(500000, 50000, 5)
  record(
    'sniff 20 MiB PNG',
    measureSync(() => api.sniff(bigPng), steps),
  )
}

{
  const steps = plan(10, 3, 5)
  const canvas = api.decodeBmp(bmp24)
  if (canvas.width !== 1024 || canvas.height !== 1024) throw new Error('fixture check: 24-bit BMP decode size')
  document.canvases.length = 0
  record(
    'decodeBmp 24-bit 1024x1024',
    measureSync(() => api.decodeBmp(bmp24), steps),
    { inputBytes: bmp24.length },
  )
}

{
  const steps = plan(10, 3, 5)
  const canvas = api.decodeBmp(bmp32)
  if (canvas.width !== 1024 || canvas.height !== 1024) throw new Error('fixture check: 32-bit BMP decode size')
  document.canvases.length = 0
  record(
    'decodeBmp 32-bit 1024x1024',
    measureSync(() => api.decodeBmp(bmp32), steps),
    { inputBytes: bmp32.length },
  )
}

{
  const steps = plan(10, 3, 5)
  const canvas = api.decodeBmp(rle8)
  if (canvas.width !== 1024 || canvas.height !== 1024) throw new Error('fixture check: RLE8 BMP decode size')
  document.canvases.length = 0
  record(
    'decodeBmp RLE8 1024x1024',
    measureSync(() => api.decodeBmp(rle8), steps),
    { inputBytes: rle8.length },
  )
}

{
  const steps = plan(6, 2, 5)
  const canvas = api.decodeXpm(xpmText)
  if (canvas.width !== 512 || canvas.height !== 512) throw new Error('fixture check: XPM decode size')
  document.canvases.length = 0
  record(
    'decodeXpm 512x512 64 colors',
    measureSync(() => api.decodeXpm(xpmText), steps),
    { inputBytes: xpmBytes },
  )
}

{
  // Pass-through: declared type already matches the sniffed type, so normalize()
  // returns null after reading only the <=1 KiB header. The interesting number is
  // how many full-file bytes it still pulls through arrayBuffer() to get there (0).
  const steps = plan(20, 5, 5)
  const counted = countingFile(bigPng, 'big.png', 'image/png')
  if ((await api.normalize(counted.file)) !== null) throw new Error('fixture check: native PNG not passed through')
  const measured = await measureAsync(() => api.normalize(counted.file), steps, counted.reset)
  record('normalize native PNG 20 MiB (arrayBuffer)', measured, {
    inputBytes: bigPng.length,
    bytesRead: counted.stats.bytes / measured.iterations,
  })
}

{
  // Declared PNG but actually 24-bit BMP: conversion path. createImageBitmap is
  // absent in Node, so toCanvas() falls back to the shipped JS decodeBmp path.
  const steps = plan(6, 2, 5)
  const counted = countingFile(bmp24, 'wechat.png', 'image/png')
  const first = await api.normalize(counted.file)
  if (!first || first.file.type !== 'image/png' || first.width !== 1024) {
    throw new Error('fixture check: BMP-as-PNG conversion did not produce a 1024px PNG')
  }
  const measured = await measureAsync(() => api.normalize(counted.file), steps, counted.reset)
  record('normalize BMP->PNG 1024x1024', measured, {
    inputBytes: bmp24.length,
    bytesRead: counted.stats.bytes / measured.iterations,
  })
}

// ---------- output ----------

const metadata = {
  generatedAt: new Date().toISOString(),
  quick,
  node: process.version,
  v8: process.versions.v8,
  platform: platform(),
  arch: arch(),
  release: release(),
  cpu: (cpus()[0] && cpus()[0].model) || 'unknown',
  threads: cpus().length,
}

const notes = [
  'sniff() only inspects the signature (plus a bounded 1 KiB text probe for SVG), so MB/s over the 20 MiB buffer is not a meaningful rate.',
  'normalize() native pass-through reads at most a 1 KiB header through file.slice(); it only falls back to a full-file arrayBuffer() read when the bytes need re-wrapping or conversion.',
  'normalize() BMP->PNG runs the JS decodeBmp fallback because createImageBitmap is unavailable in Node; in a browser the native decoder would be used instead.',
  'MB/s uses 1 MB = 1,000,000 bytes; fixture sizes use MiB. For the RLE8 case it is the compressed stream rate, not the decoded pixel rate.',
  'decodeBmp 32-bit includes the extra pass that treats all-zero alpha as opaque.',
  'ms/op is the median of per-round means; iters counts every timed call across all rounds.',
]

if (asJson) {
  console.log(
    JSON.stringify(
      {
        ...metadata,
        fixtures: {
          bigPngBytes: bigPng.length,
          bmp24Bytes: bmp24.length,
          bmp32Bytes: bmp32.length,
          rle8Bytes: rle8.length,
          xpmBytes,
        },
        results,
        notes,
      },
      null,
      2,
    ),
  )
} else {
  console.log(
    `dsh-paste-image client benchmark · node ${metadata.node} · ${metadata.platform} ${metadata.arch} · ` +
      `${metadata.cpu} (${metadata.threads} threads)`,
  )
  const mode = quick ? 'quick' : 'full (pass --quick for the CI-sized run)'
  console.log(`measured ${metadata.generatedAt} · mode: ${mode}`)
  console.log('')
  console.log(formatTable(buildTable()))
  console.log('')
  console.log('notes:')
  for (const note of notes) console.log('- ' + note)
}
