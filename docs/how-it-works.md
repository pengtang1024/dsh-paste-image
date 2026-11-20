# 工作原理

本文自上而下带读 `client.js`。行号引用都指向当前文件；文末的代码地图是一份快速索引。

```text
paste / drop (capture phase)
        |
        v
  handle(event, data)
        |  no files, > 8 files, or no image candidate -> return, native path
        |  preventDefault() + stopPropagation()
        v
  for each candidate file -> normalize(file)
        |
        | sniff(bytes) -> kind
        | native kind and the declaration agrees -> null (keep the file untouched)
        | declared type is empty      -> retype the File, no re-encode
        v
  toCanvas()
        | XPM                 -> decodeXpm()
        | SVG                 -> loadSvg() + <img> rasterisation
        | BMP / DIB           -> createImageBitmap(), fallback decodeBmp()
        |                        (embedded JPEG/PNG payloads are unwrapped first)
        | ICO / CUR           -> createImageBitmap(), fallback to the largest PNG entry
        | everything else     -> createImageBitmap()
        v
  canvasOf()   longest side clamped to 4096
        v
  toPngBlob()  canvas.toBlob('image/png')
        v
  new File(name.png, image/png)
        |
        v
  reroute(files) -> synthetic DragEvent('drop') on [data-composer-card]
```

## 1. 捕获阶段

[`install()`](../client.js#L669-L679) 在 `document` 上挂两个监听器：

```js
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
```

`true` 这个标志就是全部要点：捕获阶段从 `document` 一路向下传到目标，因此插件会在输入框自身的冒泡阶段处理函数之前看到事件。如果插件转换了文件，它就能在输入框读取 `clipboardData` 之前调用 `preventDefault()`。

## 2. 前置校验与分发

[`handle()`](../client.js#L631-L667) 是分发器。它在三种情况下提前退出：

- 已设置 `event[REROUTED]`（[第 23 行](../client.js#L23)）；一旦设置，插件立即返回。没有这个标志，插件自己的捕获监听器会再次看到自己派发的合成事件，从而递归。
- 这一批文件数为零，或多于 `MAX_FILES = 8` 个（[第 21 行](../client.js#L22)）。这个检查发生在 `preventDefault()` _之前_，所以一次九个图片的批次会整体交给原生路径，而不会被部分转换。
- 没有任何文件是图片候选（[`isImageCandidate()`](../client.js#L610-L615)）：声明类型必须以 `image/` 开头，或者文件名以 [`IMAGE_EXT`](../client.js#L19) 中的某个扩展名结尾。纯文本粘贴永远不匹配，因此永远不会被处理。

每个候选文件都在各自的 `try/catch` 里转换；失败时保留原文件（见[第 11 节](#11-失败处理与日志)）。

## 3. 魔数检测

[`sniff()`](../client.js#L72-L106) 读取文件开头的若干字节，返回一个类似 MIME 的字符串；无法识别格式时返回 `null`：

| 签名                                                | 结果           |
| --------------------------------------------------- | -------------- |
| `89 50 4E 47 0D 0A 1A 0A`                           | `image/png`    |
| `FF D8 FF`                                          | `image/jpeg`   |
| 偏移 0 处的 `GIF`                                   | `image/gif`    |
| 偏移 0 处的 `RIFF`，偏移 8 处的 `WEBP`              | `image/webp`   |
| `BM`                                                | `image/bmp`    |
| 偏移 0 处的 `BITMAP*HEADER` 长度，且宽/高/位深合理  | `image/bmp`    |
| `II 2A 00` 或 `MM 00 2A`（小端/大端 TIFF）          | `image/tiff`   |
| 偏移 0 处的 `/* XPM */`，大小写不敏感               | `image/xpm`    |
| 偏移 4 处的 `ftyp`，偏移 8 处为 `avif`/`avis` brand | `image/avif`   |
| 偏移 4 处的 `ftyp`，偏移 8 处为 HEIC/HEIF brand     | `image/heic`   |
| `00 00 01 00`（图标）或 `00 00 02 00`（光标）       | `image/x-icon` |
| 开头为 `<`，且前 1 KiB 内含 `<svg`                  | `image/svg`    |

无文件头的 DIB 那一行，就是 Windows 代码里看到的 `CF_DIB` 形态：一个裸的 `BITMAPINFOHEADER`（或 OS/2 core header），前面没有 14 字节的 `BITMAPFILEHEADER`。[`dibHeaderSize()`](../client.js#L43-L63) 会先用 `BMP_HEADERS` 校验头长度，再校验宽高的符号和位深，通过之后才放行，所以碰巧以 `0x28` 开头的随机二进制文件不会被判定为图片。

这些辅助函数刻意做得很小：[`ascii()`](../client.js#L28-L32) 把一段字节转成字符串供文本签名使用，[`unit32()`](../client.js#L34-L36) 为 DIB 探测按小端读取 `uint32`，其余的则是直接比较。

## 4. 原样透传规则

[`normalize()`](../client.js#L581-L606) 是做出判断的地方：

```js
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
```

返回 `null` 表示「不转换」；`handle()` 会保留原始的 `File`。这正是真实截图能保持完全相同的字节、元数据与动画的原因：当声明与嗅探结果一致时，PNG、JPEG、WebP 和 GIF 从不会被重新编码。

0.2.0 里有两处新细节：

- **MIME 别名。** [`aliasMime()`](../client.js#L38-L40) 把应用实际发出的各种拼写映射到规范类型——`image/jpg`、`image/pjpeg`、`image/x-png`、`image/x-bmp`、`image/x-ms-bmp`、`image/vnd.microsoft.icon`、`image/x-xpixmap`、`image/xpm`、`image/svg+xml`。没有它，一个完好的 `image/jpg` JPEG 会被白白解码再重新编码。
- **缺失声明。** `type` 为空的 `File` 过去会被原样透传，然后被宿主拒绝，因为白名单跟着标签走。现在会把字节重新包进一个带嗅探类型的 `File`，从而在不重新编码的情况下被接受。

这里的声明类型只有否决权。字节是 JPEG 却声称 `image/png` 的文件通不过 `declared === kind` 检查，于是会被转换成真正的 PNG。同理，声明为 PNG 的 BMP 也会被转换，因为宿主的白名单和宿主的解码器都跟着标签走。

发生转换时会重建文件名：最后一个扩展名被替换成 `.png`，因此 `shot.xpm` 变成 `shot.png`，而 `wechat.png`（实际装着 BMP 字节）仍是 `wechat.png`。被重标类型的原生文件则保留自己的扩展名（JPEG 是 `.jpg`，以及 `.webp`、`.gif`）。

## 5. 解码

[`toCanvas()`](../client.js#L545-L574) 选择解码路径：

- `image/xpm` 直接交给 [`decodeXpm()`](../client.js#L144-L185)，因为没有浏览器解码 XPM。
- `image/svg` 交给 [`loadSvg()`](../client.js#L475-L498)，它通过 `<img>` 元素加载标记，并把固有尺寸绘制到 canvas 上。Chromium 没有为 SVG blob 实现 `createImageBitmap()`，所以这是每个 Chromium 构建都能用的唯一路径。
- 其余全部交给 `createImageBitmap(new Blob([bytes], { type }))`，其中 `type` 在已知时是嗅探出的格式，否则是声明类型（别名映射之后），再否则是 `application/octet-stream`。使用嗅探出的格式正是标错类型的 BMP 能正确解码的原因：blob 会按字节被重新标注类型。
- 如果 `createImageBitmap` 拒绝，且嗅探格式是 BMP，插件会先检查有没有**内嵌**的 JPEG 或 PNG 数据（压缩方式 `BI_JPEG`/`BI_PNG`）并解码它；如果没有，就运行 [`decodeBmp()`](../client.js#L346-L445) 作为回退。
- 如果 `createImageBitmap` 拒绝，且嗅探格式是 `image/x-icon`，[`icoPngEntry()`](../client.js#L500-L522) 会从图标目录里挑出最大的 PNG 压缩条目并解码它。仅含 DIB 的图标仍然不支持。
- 其它任何解码错误都会被重新抛出。`handle()` 捕获它，保留原文件并记录原因。

[`canvasOf()`](../client.js#L526-L535) 随后规范化尺寸：`scale = min(1, MAX_SIDE / max(width, height))`，其中 `MAX_SIDE = 4096`（[第 20 行](../client.js#L21)），宽高取整且不小于 1，然后把源图绘制到缩放后的 canvas 上。小图不缩放，直接通过。

[`toPngBlob()`](../client.js#L537-L543) 把 `canvas.toBlob(callback, 'image/png')` 包进 Promise，并在回调收到 `null` 时拒绝。得到的 blob 成为一个新的内存内 `File`。

## 6. XPM 解码器

XPM 是 C 源码文本，所以 [`decodeXpm()`](../client.js#L144-L185) 先用 [`xpmStrings()`](../client.js#L110-L119) 提取每个双引号字符串，并对引号、反斜杠、换行和制表符做反转义。开头的 UTF-8 BOM 会先被剥掉。

第一个字符串是头部：`width height ncolors chars-per-pixel`。宽、高和颜色数都必须为正；省略时 `chars-per-pixel` 默认为 1。像素数超过 `MAX_PIXELS` 的头部会在分配任何缓冲区之前被拒绝。

接下来的 `ncolors` 个字符串是调色板。每一行以像素键开头（前 `chars-per-pixel` 个字符）；其余部分被扫描以寻找 `c` 颜色说明。提取器接受一个或两个以空白分隔的 token，这足以覆盖 `#RRGGBB` 和带空格的名称。[`resolveColor()`](../client.js#L121-L142) 随后用 1×1 canvas 解析该值：把字符串赋给 `fillStyle`，再通过 `getImageData()` 读回像素，因此它接受的正好是浏览器 CSS 颜色解析器所接受的内容——`#rgb`、`#rgba`、`#rrggbb`、`#rrggbbaa` 以及单词形式的 CSS 颜色名。不是 CSS 颜色的调色板名，例如两个词的 `light gray`，会被 `fillStyle` 拒绝并变成不透明黑色。字面量 `None` 变成完全透明；其它被拒绝的值会让 `resolveColor()` 返回 `null`，该调色板条目同样回退为不透明黑色。

像素行从 `strings[1 + ncolors]` 开始。每行被切成 `chars-per-pixel` 个块，在调色板里查找，然后写入 `ImageData` 缓冲区。未知的键或过短的行会产生透明像素。

不支持：XPM1/XPM2 头部布局、除 `c` 以外的颜色键（`m`、`g`、`g4`、`s` 会被忽略），以及不是合法 CSS 颜色的调色板颜色名——包括 `light gray` 这类多词名称，它们会输出成黑色。

## 7. BMP / DIB 解码器

BMP 是一个家族而不是一种格式，所以 0.2.0 把工作拆成两部分：[`parseBmp()`](../client.js#L189-L244) 校验头部并计算布局，[`decodeBmp()`](../client.js#L346-L445) 把像素转换成 RGBA。

`parseBmp()` 接受：

- 文件以 `BM` 开头时的 14 字节 `BITMAPFILEHEADER`，否则按**无文件头 DIB** 处理。对 DIB 来说，像素偏移由头部长度、可选的位掩码和调色板大小推导，而不是从第 10 个字节读取。
- 头部长度 `12`（OS/2 `BITMAPCOREHEADER`）、`40`（`BITMAPINFOHEADER`）、`52`（`BITMAPV2INFOHEADER`）、`56`（`BITMAPV3INFOHEADER`）、`64`（OS/2 v2）、`108`（`BITMAPV4HEADER`）和 `124`（`BITMAPV5HEADER`）。
- 位深 1、4、8、16、24 和 32。
- 压缩方式 `0`（`BI_RGB`）、`1`（`BI_RLE8`）、`2`（`BI_RLE4`）、`3`（`BI_BITFIELDS`）和 `6`（`BI_ALPHABITFIELDS`）。
- 16 位和 32 位文件的位掩码：V4/V5 从头里取，否则取 40 字节头之后的 12（或 16）个字节。对 `BI_RGB` 的 16 位文件，掩码为零时回退到标准 RGB555 布局（`0x7C00 / 0x03E0 / 0x001F`）。
- 负的高度（自上而下的位图）；每一处行循环都读取 `topDown ? y : height - 1 - y`，包括 RLE 路径。

`decodeBmp()` 随后转换：

- **索引位深**（`1/4/8`）：调色板由 [`bmpPalette()`](../client.js#L261-L274) 读取，core header 用 3 字节条目，否则用 4 字节 `RGBQUAD` 条目；alpha 字节仅在非零时使用，因为多数调色板 BMP 把它留成 `0`。
- **16 位**：每个通道用 [`maskValue()`](../client.js#L255-L259) 提取并缩放到 0–255。
- **24 位**：BGR 通道，采用标准的 `floor((bpp * width + 31) / 32) * 4` 行跨度。
- **32 位**：`BI_RGB` 复制 `BGRA`；下面的 alpha 启发式规则适用。带掩码的 32 位使用 `r/g/b` 掩码，以及文件声明了 alpha 掩码时的 alpha 掩码。
- **RLE4 / RLE8**：[`decodeRleBmp()`](../client.js#L284-L344) 遍历操作码流——编码行程、带字填充的绝对模式、`delta`、行结束和位图结束——并通过 [`putIndexed()`](../client.js#L276-L282) 写出，使用与未压缩路径相同的自下而上映射。
- **内嵌数据**（`BI_JPEG`/`BI_PNG`）：[`bmpEmbedded()`](../client.js#L447-L461) 提取数据并交给浏览器解码。

两道防护避免畸形文件把渲染进程拖垮：总像素超过 `MAX_PIXELS = 64 Mi pixels` 的图片会在分配内存之前被拒绝，并且每次读行都会在触碰字节之前检查文件长度。

32 位 alpha 启发式规则堵住了一个长期存在的坑：当**每个**像素的第四个字节都是零时，插件把位图当作不透明，而不是导出一张完全透明的 PNG。真正带 alpha 的文件（有像素非零）则保留它。

## 8. SVG 与图标回退

[`loadSvg()`](../client.js#L475-L498) 把 blob 按 UTF-8 解码，包进一个 object URL，然后等待 `Image` 加载完成。[`svgSize()`](../client.js#L465-L473) 提供固有尺寸——优先 `<svg width="…" height="…">`，其次 `viewBox`，最后兜底 `300×150`——这样只带 `viewBox` 的 SVG 不会塌成浏览器的默认盒子。object URL 在成功和失败两条路径上都会被撤销。

[`icoPngEntry()`](../client.js#L500-L522) 读取图标目录，筛选出负载嗅探为 PNG 的条目，保留声明面积最大的那个。光标（`type = 2`）和仅含 DIB 的图标返回 `null`；随后原始错误被重新抛出，文件被原样透传。

## 9. 尺寸钳制与 PNG 导出

[`canvasOf()`](../client.js#L526-L535) 接受一个可选的显式尺寸，因为 `ImageBitmap` 暴露 `width`/`height`，而 `HTMLImageElement` 暴露 `naturalWidth`/`naturalHeight`。其余部分与之前的钳制相同。

## 10. 重路由

[`reroute()`](../client.js#L621-L629) 搭建回到输入框的桥：

```js
var dt = new DataTransfer()
files.forEach(function (file) {
  dt.items.add(file)
})
var event = new DragEvent('drop', { bubbles: true, cancelable: true, composed: true, dataTransfer: dt })
Object.defineProperty(event, REROUTED, { value: true })
composer().dispatchEvent(event)
```

[`composer()`](../client.js#L617-L619) 解析 `document.querySelector('[data-composer-card]')`，并回退到 `document.body`。派发一个真正的 `drop` 事件意味着插件不需要了解任何私有的输入框 API：它复用与手动拖放相同的附件路径。`REROUTED` 属性被定义为不可枚举，因此不会泄漏到任何检查该事件的地方。

## 11. 失败处理与日志

转换按文件在 `try/catch` 内运行（[`handle()`，第 631–667 行](../client.js#L631-L667)）。成功时插件记录：

```text
[dsh-paste-image] image/xpm -> image/png 1440x900
[dsh-paste-image] (no type) -> image/png
```

左侧是声明类型，`File` 没有类型时是 `(no type)`。失败时它记录：

```text
[dsh-paste-image] keep original (image/bmp): bmp: unsupported bpp 2
```

并把原始的 `File` 推入待发送批次。一个坏文件永远不会阻塞其它文件，合成 drop 仍然会发生——这就是为什么一次失败的转换最终表现为宿主原本的红色报错，而不是静默。两条消息都用 `console.debug`，所以浏览器控制台必须设到 Verbose 级别才能看到。

## 12. 模块注册

该文件是包在 IIFE 里的经典脚本。在底部（[第 696–711 行](../client.js#L696-L711)）它把自己注册到 DSH 客户端模块加载器：

```js
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
```

`ctx.effect(install, 'paste-image')` 把安装绑定到插件的 effect 作用域，并为其命名以便诊断。回退的 `install()` 让模块在没有 effect 作用域的环境里仍然可用。Node 测试里没有 `window`，所以注册代码块被跳过，文件通过 `module.exports` 导出 [`api`](../client.js#L701-L711) 供测试套件使用。

## 代码地图

| 关注点               | 函数 / 入口             | 位置                                    |
| -------------------- | ----------------------- | --------------------------------------- |
| 格式签名             | `sniff()`               | [client.js:72](../client.js#L72-L106)   |
| DIB 头部探测         | `dibHeaderSize()`       | [client.js:43](../client.js#L43-L63)    |
| SVG 头部探测         | `looksLikeSvg()`        | [client.js:65](../client.js#L65-L70)    |
| 字节转字符串辅助函数 | `ascii()`               | [client.js:28](../client.js#L28-L32)    |
| MIME 别名表          | `aliasMime()`           | [client.js:38](../client.js#L38-L40)    |
| XPM 字符串提取       | `xpmStrings()`          | [client.js:110](../client.js#L110-L119) |
| CSS 颜色解析         | `resolveColor()`        | [client.js:121](../client.js#L121-L142) |
| XPM 解码             | `decodeXpm()`           | [client.js:144](../client.js#L144-L185) |
| BMP 头部解析         | `parseBmp()`            | [client.js:189](../client.js#L189-L244) |
| 位掩码通道           | `maskChannel()`         | [client.js:246](../client.js#L246-L253) |
| 调色板加载           | `bmpPalette()`          | [client.js:261](../client.js#L261-L274) |
| RLE4 / RLE8 解码     | `decodeRleBmp()`        | [client.js:284](../client.js#L284-L344) |
| BMP 像素解码         | `decodeBmp()`           | [client.js:346](../client.js#L346-L445) |
| 内嵌 JPEG/PNG 数据   | `bmpEmbedded()`         | [client.js:447](../client.js#L447-L461) |
| SVG 尺寸 / 光栅化    | `loadSvg()`             | [client.js:475](../client.js#L475-L498) |
| 图标内的 PNG 条目    | `icoPngEntry()`         | [client.js:500](../client.js#L500-L522) |
| 尺寸钳制             | `canvasOf()`            | [client.js:526](../client.js#L526-L535) |
| PNG 导出             | `toPngBlob()`           | [client.js:537](../client.js#L537-L543) |
| 解码路由             | `toCanvas()`            | [client.js:545](../client.js#L545-L574) |
| 透传 / 转换          | `normalize()`           | [client.js:581](../client.js#L581-L606) |
| 候选判定             | `isImageCandidate()`    | [client.js:610](../client.js#L610-L615) |
| 输入框目标           | `composer()`            | [client.js:617](../client.js#L617-L619) |
| 合成 drop            | `reroute()`             | [client.js:621](../client.js#L621-L629) |
| 前置校验与分发       | `handle()`              | [client.js:631](../client.js#L631-L667) |
| 事件监听器           | `install()`             | [client.js:669](../client.js#L669-L679) |
| 模块入口             | `__ModuleLoader__.load` | [client.js:696](../client.js#L696-L711) |

## 设计说明

- **字节优先于标签。** MIME 类型由来源应用提供；魔数由图片编码器提供。信任字节是同时处理「不支持但诚实」和「支持但在撒谎」的唯一办法。
- **捕获阶段与同步取消。** 输入框绝不能看到未受支持的原始文件，而 `preventDefault()` 只在事件派发期间有效。
- **以 PNG 作为输出。** 它在白名单里，对已解码的像素无损，而且每个 Chromium 构建都能通过 `canvas.toBlob` 编码它。
- **用合成 drop 而不是私有 API。** 复用原生 drop 路径，使插件在不触碰 `[data-composer-card]` 的输入框改动下仍然兼容。
- **无宿主进程。** 粘贴是 UI 事件。一个渲染进程监听器就够了；宿主侧的剪贴板守护进程只会多出一个进程、权限和轮询，毫无收益。
- **无第三方解码器。** TIFF 和 HEIC 只检测不解码：内置一个编解码器要么让模块加载器注入的单个脚本膨胀，要么给一个本来完全离线的插件增加运行时拉取。BMP、XPM 和 SVG 覆盖了这个插件为之而写的格式，其余交给浏览器继续覆盖。
