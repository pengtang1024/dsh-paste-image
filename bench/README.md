# Benchmark

Reproducible micro-benchmarks for `client.js`: sniffing, BMP/XPM decoding and the `normalize()` paths that run
on every paste. The suite has no dependencies beyond Node itself and loads the real `client.js` in a `vm`
context, using the same minimal canvas/document stub as the unit tests.

Numbers here are **indicative, not thresholds**. They exist so a future change can be compared against a known
starting point on the same machine, not so CI can fail on them.

## Commands

```sh
node bench/bench.mjs          # full run, a few seconds
node bench/bench.mjs --quick  # CI-sized run: fewer iterations and rounds
node bench/bench.mjs --json   # machine-readable results; stdout is JSON only
```

The process exits `0` on success and `2` on unknown arguments. `--quick --json` can be combined. The suite needs
Node >= 20 and uses only `node:fs`, `node:os`, `node:path`, `node:perf_hooks`, `node:url`, `node:vm` and the Web
`Blob`/`File` globals (present in Node 20).

## What is measured

| Case                           | Fixture                                                        | Notes                                                                       |
| ------------------------------ | -------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `sniff 20 MiB PNG`             | 20,971,520-byte buffer with a PNG signature and filler payload | type detection only                                                         |
| `decodeBmp 24-bit 1024x1024`   | 1024x1024, 3,145,782-byte BMP                                  | BGR -> RGBA                                                                 |
| `decodeBmp 32-bit 1024x1024`   | 1024x1024, 4,194,358-byte BMP                                  | alpha all zero, so the opaque fix-up pass runs                              |
| `decodeBmp RLE8 1024x1024`     | 1024x1024, 8-color palette, 13,368-byte compressed stream      | RLE8 encoder output                                                         |
| `decodeXpm 512x512 64 colors`  | 512x512, 64 colors, 265,206-byte XPM text                      | palette via canvas stub                                                     |
| `normalize native PNG 20 MiB`  | same 20 MiB PNG, declared `image/png`                          | pass-through; only a ≤1 KiB header is read, `arrayBuffer()` is instrumented |
| `normalize BMP->PNG 1024x1024` | 24-bit BMP named `wechat.png`, declared `image/png`            | conversion path                                                             |

`normalize()` cases use a `File` whose `arrayBuffer()` counts the bytes it returns, which is how the table reports
`bytes read`. Only full-file `arrayBuffer()` reads are counted; the ≤1 KiB header that `normalize()` pulls through
`file.slice()` is not, so the native pass-through case reports 0. The other fixtures come from
`tests/helpers/dom.mjs` (`createDocument`, `makeRle8Bmp`); the 24/32-bit BMP and XPM fixtures are generated
locally so the benchmark does not depend on image assets in the repository.

## Method

- The client is loaded once per run, exactly as in `tests/client.test.mjs`; decodes write into the stub canvas.
- Each case runs a warmup, then five rounds of identical iterations. `ms/op` is the median of the per-round
  means, which keeps a single GC pause or scheduler hiccup from dominating a sample. `iters` is the number of
  timed calls across all rounds.
- `ops/sec = 1000 / ms/op`; `MB/s = bytes / 1e6 / seconds` (1 MB = 1,000,000 bytes). Throughput is `n/a` for
  `sniff` because it only looks at the header. For the `normalize()` cases `MB/s` is the fixture size divided by
  `ms/op`: for native pass-through that describes input bytes handled per second, not bytes copied, because no
  full-file read happens.
- `--quick` divides iterations by five, divides warmup by three and uses two rounds instead of five.
- Every fixture is sanity-checked before timing (sniff result, decoded dimensions, conversion output), so a broken
  fixture fails loudly instead of benchmarking the wrong code path.

## Baseline (before optimization)

Kept as historical reference. Captured 2026-11-21T06:58:35Z on:

| Item        | Value                                            |
| ----------- | ------------------------------------------------ |
| Node        | v24.21.0 (V8 13.6.233.17-node.53)                |
| OS / kernel | Ubuntu 26.04.1 LTS, Linux 7.0.0-44-generic       |
| CPU         | 13th Gen Intel(R) Core(TM) i7-13700K, 24 threads |
| Arch        | x86_64                                           |
| Command     | `node bench/bench.mjs`                           |

```text
case                                         iters      ops/sec     ms/op     MB/s             bytes read
-----------------------------------------  -------  -----------  --------  -------  ---------------------
sniff 20 MiB PNG                           2500000  208,000,792  0.000005      n/a                    n/a
decodeBmp 24-bit 1024x1024                      50        295.7     3.382    930.3                    n/a
decodeBmp 32-bit 1024x1024                      50        215.9     4.632    905.5                    n/a
decodeBmp RLE8 1024x1024                        50        217.5     4.598      2.9                    n/a
decodeXpm 512x512 64 colors                     30        212.2     4.712     56.3                    n/a
normalize native PNG 20 MiB (arrayBuffer)      100        263.0     3.803  5,514.6  20,971,520 (20.0 MiB)
normalize BMP->PNG 1024x1024                    30        261.8     3.820    823.6    3,145,782 (3.0 MiB)
```

**Key baseline finding (now fixed):** the native pass-through case used to read **20,971,520 bytes (20.0 MiB)** —
the whole file — even though `sniff()` only needed the first 8 bytes, because `normalize()` called
`file.arrayBuffer()` before it knew the declared type already matched. Since 0.3.1 `normalize()` reads at most a
1 KiB header through `file.slice()` and returns `null` for a native type with an agreeing MIME, so the full-file
read is gone: the "after" table below shows 0 bytes read in full and a three-orders-of-magnitude drop in `ms/op`.
A full read still happens when the bytes must be re-wrapped (empty declaration) or converted.

## After optimization

Observed across repeated full runs on the same machine (Node v24.21.0, 13th Gen Intel Core i7-13700K, Ubuntu
26.04.1, Linux 7.0.0-44-generic), command `node bench/bench.mjs`. The before/after figures below are the ranges
observed across those full runs — not a single sample, and not a guarantee. Deltas are median-to-median; the XPM
endpoints alone would read -29% (fastest pair) or -18% (slowest pair), so -24% is quoted instead.

| Case                                     | Before (ms/op)        | After (ms/op)                     | Delta                         | Full bytes read (before → after) |
| ---------------------------------------- | --------------------- | --------------------------------- | ----------------------------- | -------------------------------- |
| `normalize native PNG 20 MiB`            | 3.803–3.929           | 0.0038–0.0063                     | ~99.9% faster                 | 20,971,520 → 0                   |
| `decodeXpm 512x512 64 colors`            | 4.712–4.837           | 3.35–3.95                         | ~-24% (observed -18% to -29%) | n/a                              |
| `normalize BMP->PNG 1024x1024`           | ~3.9–4.0              | ~3.9–4.0                          | unchanged                     | 3,145,782 → 3,145,782            |
| `decodeBmp 24-bit / 32-bit / RLE8 1024²` | 3.382 / 4.632 / 4.598 | unchanged within run-to-run noise | ~0                            | n/a                              |
| `sniff 20 MiB PNG`                       | 0.000005              | 0.000006                          | unchanged                     | n/a                              |

The pass-through saving comes from skipping the 20 MiB copy entirely; the XPM saving comes from reusing one 1×1
canvas in `resolveColor()` and from a character-code `Map` in the `cpp === 1` path instead of a per-pixel
`row.slice()`. `decodeBmp` and the BMP→PNG conversion path were not touched, so they stay inside the noise band.
There is no worker and no network request involved in either change.

Run-to-run spread is real: repeated full runs on the same machine moved individual cases by 10-30%, and more when
other builds/tests share the CPU (the 20 MiB pass-through copy was the most sensitive case before the fix). Compare
runs taken with the same mode on the same idle machine; do not treat a small delta as a regression on its own.

## Notes and limitations

- The canvas stub only allocates `ImageData`; there is no real compositing, encoding or GPU work. The numbers
  describe the decoder and the glue code, not browser rendering.
- `createImageBitmap` does not exist in Node, so `normalize()` for BMP falls back to the shipped JavaScript
  `decodeBmp()` path. In a browser the native decoder would handle that image instead, and the conversion case
  would be dominated by `canvas.toBlob()`; the benchmark documents the fallback, not the browser path.
- `decodeBmp` for 32-bit images includes the extra pass that rewrites all-zero alpha to opaque.
- `sniff` is O(header) for the PNG fixture (plus a bounded 1 KiB text probe used only for SVG), so its `MB/s` is
  reported as `n/a` rather than as an artificial multi-GB/s figure.
- Node 20 compatibility was smoke-tested with `npx --yes node@20 bench/bench.mjs --quick` (v20.20.2, exit 0); the
  recorded baseline above uses the machine's default Node v24.21.0.
