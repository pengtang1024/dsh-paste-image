# 格式支持

本页是粘贴或拖入文件后处理逻辑的参考：类型如何判定、由哪个解码器处理、输出是什么，以及哪些格式是有意不处理的。面向用户的简版说明见 [README](../README.md#支持的格式)；本文档是它背后的细节。

## 决策流程

`paste` 或 `drop` 事件中的每个文件都要经过同样的四个问题。

1. **它到底算不算候选？** 当 `file.type` 以 `image/` 开头，或文件名匹配
   `.png`、`.jpg`、`.jpeg`、`.jfif`、`.gif`、`.webp`、`.bmp`、`.dib`、`.tif`、`.tiff`、`.xpm`、`.avif`、`.ico`、`.cur`、`.svg`、`.heic` 或 `.heif` 时，
   `isImageCandidate()` 会接受该文件。同一次事件中的其它文件一律原样转发。
2. **它实际上是什么？** `sniff()` 读取魔数并返回规范类型，不理会声明的 MIME 类型。检查顺序很重要：先查四种原生格式，然后依次是 BMP、TIFF、XPM、`ftyp` 家族（AVIF/HEIC）、ICO/CUR、SVG，最后是无文件头的 DIB。
3. **能否原样放行？** 只有当嗅探出的类型属于原生格式**且**声明类型与之一致（包括 `MIME_ALIAS` 中的别名写法）时，文件才逐字节原样放行。没有声明类型的原生文件会按嗅探类型重新包一层，而不是重编码，这样宿主拿到的仍是一个合法的 `File`。字节与声明类型不符的原生文件会被重编码——正是这一步让 BMP 无法顶着 `image/png` 的标签蒙混过关。
4. **否则：解码、绘制、重编码。** `toCanvas()` 选择一个解码器，把结果画到最长边不超过 4096 px 的画布上，再按所选输出格式（默认 PNG）导出。如果所有解码器都拒绝，则保留原文件，插件记录 `keep original (...)` 日志，于是失败表现与未装插件时完全一致。

## 格式矩阵

| 格式家族                     | 嗅探结果         | 解码路径                                                                   | 结果                                        |
| ---------------------------- | ---------------- | -------------------------------------------------------------------------- | ------------------------------------------- |
| PNG、JPEG、WebP、GIF         | 各自的类型       | 无 —— 原样转发字节                                                         | 文件不变                                    |
| 同上，但标签写错             | 真实类型         | 画布解码 → PNG                                                             | 真正的 PNG，文件名为 `.png`                 |
| XPM3 文本                    | `image/xpm`      | `decodeXpm()` —— 自带解析器，颜色经由浏览器的 CSS 解析器解析               | PNG                                         |
| 带文件头的 BMP               | `image/bmp`      | 先走 Chromium `createImageBitmap()`；Chromium 拒绝该变体时用 `decodeBmp()` | PNG                                         |
| 无文件头的 DIB（`CF_DIB`）   | `image/bmp`      | 只用 `decodeBmp()` —— Chromium 需要那 14 字节的文件头                      | PNG                                         |
| 带 `BI_JPEG`/`BI_PNG` 的 BMP | `image/bmp`      | `bmpEmbedded()` 拆出内嵌数据，再交给浏览器解码                             | PNG                                         |
| SVG                          | `image/svg`      | `loadSvg()` —— 用 object URL 加载 `<img>` 元素，再画到画布                 | PNG，尺寸取自 `width`/`height` 或 `viewBox` |
| ICO / CUR                    | `image/x-icon`   | 先交给 Chromium；`icoPngEntry()` 兜底取最大的 PNG 压缩条目                 | PNG                                         |
| AVIF                         | `image/avif`     | Chromium `createImageBitmap()`                                             | PNG（首帧）                                 |
| TIFF                         | `image/tiff`     | 能检测出来，随后交给浏览器 —— Chromium 没有 TIFF 解码器                    | 保留原文件；宿主照旧拒绝                    |
| HEIC / HEIF                  | `image/heic`     | 能检测出来，随后交给浏览器 —— Chromium 没有 HEIC 解码器                    | 保留原文件；宿主照旧拒绝                    |
| 其它任意 `image/*`           | 浏览器接受的类型 | 以声明类型调用 `createImageBitmap()`                                       | PNG，或保留原文件                           |

“别名写法”指那些指向某个规范类型的取值：`image/jpg`、`image/pjpeg` → `image/jpeg`；`image/x-png` → `image/png`；`image/x-bmp`、`image/x-ms-bmp`、`image/x-win-bitmap` → `image/bmp`；`image/vnd.microsoft.icon` → `image/x-icon`；`image/x-xpixmap`、`image/x-xpm` → `image/xpm`；`image/svg+xml` → `image/svg`。

## BMP 变体

`parseBmp()` 与 `decodeBmp()` 由所有变体共用，因此这里用一张网格而不是逐个特例来描述可接受的组合。

| 维度       | 可接受的值                                                                                                                                   |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 像素深度   | 每像素 1、4、8、16、24、32 位                                                                                                                |
| 压缩方式   | `BI_RGB`（0）、`BI_RLE8`（1）、`BI_RLE4`（2）、`BI_BITFIELDS`（3）、`BI_ALPHABITFIELDS`（6）；`BI_JPEG`（4）与 `BI_PNG`（5）从内嵌数据中拆出 |
| 文件头大小 | 12（`BITMAPCOREHEADER`）、40（`BITMAPINFOHEADER`）、52、56、64、108（V4）、124（V5），以及完全没有文件头                                     |
| 调色板     | OS/2 核心头每项 3 字节，其它情况 4 字节；alpha 字节为零时颜色保持不透明                                                                      |
| 行序       | 自下而上（默认）与自上而下（负高度）                                                                                                         |
| Alpha      | 声明了就用位掩码；否则 32 位图像中全零的 alpha 通道按不透明处理                                                                              |
| 字节序     | 小端序，与格式规范一致                                                                                                                       |

防护措施：超过 64 Mi 像素的文件（或所需画布超过这一上限）在分配内存前即被拒绝，每次读取行都做边界检查，RLE 流在 `EOF`、`delta` 或缓冲区末尾处停止。

## 哪些格式不支持，以及为什么

- **TIFF。** Chromium 不提供 TIFF 解码器。一个基线解码器（未压缩、PackBits、LZW；8 位灰度/RGB/调色板）不依赖第三方即可实现，但还没有写，所以 TIFF 只是被检测出来并原样放行，失败表现与未装插件时完全相同。这是最有可能接下来支持的格式。
- **HEIC / HEIF。** 解码需要 HEVC 解码器。把解码器以 wasm 形式打包会让插件体积成倍增长，并破坏“一个脚本、不联网、不依赖第三方解码器”这一特性，因此 HEIC 按设计只做检测、不做处理。从文件应用里粘贴或直接拖入的 `.heic` iPhone 照片仍会失败。
- **`BI_CMYK` BMP（压缩方式 11/12/13）。** 除印刷流水线外，CMYK 位图很少见。`parseBmp()` 会明确拒绝（`bmp: unsupported compression 11`）而不是猜测通道顺序，因此保留原文件，并在日志里说明原因。
- **2 位与 64 位 BMP。** 只有旧版 OS/2 软件和少数专用工具才会产生。
- **仅含 DIB 条目的 ICO/CUR。** 条目是原始位图而不是 PNG 的图标不会被重新组装；浏览器也许仍能自行解码。
- **JPEG XL、JPEG 2000、PSD、TGA、DDS、OpenEXR、相机 RAW。** 这些不是用于粘贴的格式。等 DSH 原生接受它们后，请走文件选择器。
- **动图来源。** 转换后的图像是所选输出格式（默认 PNG）的一帧静态图；动画、EXIF 与色彩配置文件都会丢弃。原生 GIF/WebP 原样放行，因此动画得以保留。

## 新增格式

插件刻意保持零依赖，因此新增格式要么是在 `client.js` 里写一个小解析器，要么是在浏览器解码路径里加一个条目。清单如下：

1. **嗅探。** 在 `sniff()` 中加入对应的魔数分支；更具体的签名要排在更通用的前面。如果格式没有可靠的签名（比如 XPM 这类文本格式），就用结构检查代替前缀匹配。
2. **解码。** 写一个 `decode<Format>()`，为 `canvasOf()` 返回 RGBA 像素数据，或为 `<img>` 路径返回可绘制的图像。读取前校验每个长度，用 `MAX_PIXELS` 限制像素总数，遇到任何意外情况都抛出简短的 `format: reason` 错误。
3. **接入。** 把该类型加入 `toCanvas()`（如果应当原样放行，则加入 `NATIVE_TYPES`）；如果不是原生类型，还要加入 `IMAGE_EXT` 的扩展名列表。
4. **测试。** 如果字节构造不简单，就给 `tests/helpers/dom.mjs` 补一个构建器，并在 `tests/client.test.mjs` 中增加用例：嗅探、正常路径、被截断的文件，以及“声明类型说谎”的情况。
5. **写文档。** 更新上面的矩阵、`README.md` 及各语言翻译里的表格与限制说明；如果规则有变，还要更新 `Pass-through` 段落。
6. **写发布说明。** 在 `CHANGELOG.md` 的 `[Unreleased]` 下加一条；维护者会在下个版本中把它归并进去。

提交拉取请求前先跑 `npm test`、`npm run check` 和 `npm run format:check`；完整流程见 `CONTRIBUTING.md`。
