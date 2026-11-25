# 工作原理

本文说明 dsh-paste-image 如何把几乎任何图片（哪怕声明类型标错）粘贴或拖入 DeepSeek Harness 的输入框。内容以 [`how-it-works.md`](how-it-works.md) 为准，并反映当前实现：PNG / JPEG / WebP 输出、逐格式的转换开关、保存在浏览器 `localStorage` 的设置。

## 流程概览

```text
paste / drop（捕获阶段）
        |
        v
  handle(event, data)
        |  无文件、超过 maxFiles、或没有图片候选 -> 返回，走浏览器原生路径
        |  preventDefault() + stopPropagation()
        v
  对每个候选文件 -> normalize(file)
        | sniff(bytes) -> 真实格式
        | 原生格式且声明与真实一致 -> null（文件原样保留）
        | 声明类型为空 -> 重新标记 File 类型，不重新编码
        v
  toCanvas()
        | XPM       -> decodeXpm()
        | SVG       -> loadSvg() + <img> 光栅化
        | BMP / DIB -> createImageBitmap()，失败回退 decodeBmp()
        |              （内嵌 JPEG/PNG 数据先解包）
        | ICO / CUR -> createImageBitmap()，失败回退最大的 PNG 条目
        | 其它      -> createImageBitmap()
        v
  canvasOf()   长边钳制到 maxSide（默认 4096）
        v
  encodeCanvas()  canvas.toBlob(profile.mime[, quality])
        v
  new File(name.<ext>, 按实际 blob.type 取类型)
        v
  reroute(files) -> 在 [data-composer-card] 上派发合成 DragEvent('drop')
```

## 1. 捕获阶段

插件在 `document` 上以捕获模式（`addEventListener(..., true)`）监听 `paste` 与 `drop`。捕获阶段从 `document` 向下到达目标，因此插件先于输入框自身的处理函数看到事件；若发生转换，它能在输入框读取 `clipboardData` 之前调用 `preventDefault()`。

## 2. 前置校验与跳过条件

`handle()` 在以下情况提前返回，不接管事件：

- 总开关关闭（`enabled === false`）：监听器不卸载，重新开启后立即生效。
- 事件已带 `REROUTED` 标记：避免插件再次处理自己派发的合成事件而递归。
- 文件数为零或超过 `maxFiles`（默认 8，可配 1–8）：整批交给原生路径，不做部分转换。
- 没有任何图片候选：声明类型须以 `image/` 开头，或文件名以图片扩展名结尾；纯文本粘贴永不匹配。
- `DataTransfer` / `DragEvent` 构造器缺失，或找不到输入框卡片（`[data-composer-card]`）：插件放手，浏览器原生路径照常运行。

每个候选文件在各自的 `try/catch` 中转换；失败时保留原文件。

## 3. 魔数检测

`sniff()` 读取文件开头字节，按签名判定真实格式：PNG、JPEG、GIF、WebP（RIFF + WEBP）、BMP（`BM` 或无文件头的 DIB `BITMAPINFOHEADER`）、TIFF（II/MM）、XPM（`/* XPM */`）、AVIF / HEIC（`ftyp` brand）、ICO/CUR（`00 00 01 00` / `00 00 02 00`）、SVG（开头 `<` 且前 1 KiB 内含 `<svg`）。无法识别时返回 `null`。无文件头的 DIB 会先校验头长度、宽高符号与位深，避免把随机二进制误判为图片。

## 4. 原样透传

`normalize()` 只读前 1024 字节的头部来决定是否触碰整个文件：

- 该格式的转换开关已关闭：直接放行原文件，连整份字节都不读。
- 原生类型（PNG/JPEG/WebP/GIF）且声明与真实一致：读 1 KiB 头后直接放行。真实截图因此字节、元数据与动画完全不变。
- 声明类型为空：把字节重新包成带嗅探类型的 `File`（不重新编码），以便通过宿主白名单。
- 声明类型与真实字节不符（如 BMP 声称 PNG）：走转换，按所选输出格式重新编码。

转换时扩展名按实际编码类型替换（`shot.xpm` → `shot.png`）；被重标类型的原生文件保留自身扩展名。MIME 别名表（`image/jpg`、`image/x-png`、`image/svg+xml` 等）会先归一，避免完好文件被白白重编码。

## 5. 解码与编码

解码路径：XPM 用内置解码器；SVG 经 `<img>` 光栅化（Chromium 不支持 SVG blob 的 `createImageBitmap()`）；其余交给 `createImageBitmap()`，BMP 失败时回退 `decodeBmp()` 或解包内嵌 JPEG/PNG，ICO 失败时取最大的 PNG 条目。尺寸按 `scale = min(1, maxSide / 长边)` 缩放，小图不缩放。

编码由 `encodeCanvas()` 统一处理：PNG 无损、不传质量参数；JPEG 先合成到不透明白底（透明像素不变黑），WebP 保留透明度，两者都带 `quality`。最终类型以浏览器实际 `blob.type` 为准，无法识别时回退 PNG。

## 6. 重路由

`reroute()` 把转换后的文件装进 `DataTransfer`，在真正的输入框卡片上派发一个合成 `drop` 事件（带不可枚举的 `REROUTED` 标记）。这复用手动拖放的同一附件路径，无需了解任何私有输入框 API；找不到卡片则不派发。

## 7. 失败处理与日志

转换逐文件在 `try/catch` 中运行。成功记录 `image/xpm -> image/png 1440x900` 之类信息，失败记录 `keep original (image/bmp): ...` 并保留原文件——坏文件不会阻塞其它文件，合成 drop 仍会发生，最终表现为宿主原本的报错。日志走 `console.debug`，需在浏览器控制台开启 Verbose 级别才能看到。

## 8. 设置与配置页

设置仅存于浏览器 `localStorage`（键 `dsh-paste-image.settings.v1`；隐私模式或被禁用时退回内存副本，粘贴照常工作）。打开方式：主入口是**设置 → 粘贴任意图片**，直接展开下面的完整表单；原有插件页行配置入口（设置 → 插件 → dsh-paste-image → 配置）保留，两处共用同一份设置。也可以用 `api.getSettings()` / `api.applySettings(patch)` / `api.resetSettings()` 读写。

| 设置项 | 默认值 | 取值 / 范围 | 作用 |
| --- | --- | --- | --- |
| `enabled` | `true` | 布尔 | 总开关，关闭后粘贴走原生路径 |
| `maxFiles` | `8` | 整数 1–8 | 单批最大文件数，超限整批放行 |
| `maxSide` | `4096` | 整数 512–8192 | 转码后图片长边上限 |
| `outputFormat` | `png` | `png` / `jpeg` / `webp` | 转换输出格式（浏览器不支持时回退 PNG） |
| `quality` | `0.92` | 0.1–1（两位小数） | JPEG / WebP 编码质量；选 PNG 时表单禁用 |
| `convertXpm` | `true` | 布尔 | 是否转换 XPM |
| `convertBmp` | `true` | 布尔 | 是否转换 BMP / DIB |
| `convertSvg` | `true` | 布尔 | 是否转换 SVG |
| `convertIco` | `true` | 布尔 | 是否转换 ICO / CUR |
| `logConversions` | `true` | 布尔 | 是否输出转换调试日志 |

配置页表单包含上述复选框、输出格式下拉框与三个数字输入，草稿放在组件状态里，只有点“保存”才写入设置；“恢复默认”回到上表默认值。

## 9. 边界与不支持项

- **HEIC / TIFF**：能识别签名，但不解码（插件不内置解码器），保持原样。
- **XPM**：不支持 XPM1/XPM2 头部布局与非 `c` 颜色键；不是合法 CSS 颜色的调色板名（如两词的 `light gray`）会输出为不透明黑色，`None` 为透明。
- **BMP / DIB**：支持头长 12/40/52/56/64/108/124、位深 1/4/8/16/24/32、压缩 BI_RGB / RLE8 / RLE4 / BITFIELDS / ALPHABITFIELDS、内嵌 JPEG/PNG 与自上而下位图；总像素超过 64 Mi 会在分配内存前拒绝。32 位全零 alpha 视为不透明。
- **ICO / CUR**：仅支持含 PNG 条目的图标（取面积最大者）；仅含 DIB 的图标与光标不支持。
- **原生格式**：声明与真实一致的 PNG、JPEG、WebP、GIF 永远不重新编码。
- **体积参考**：照片用 JPEG/WebP 约小 82%，UI 截图用 PNG 往往更小，详见[输出格式实测](output-formats.md)。

## 10. 设计原则

字节优先于标签；捕获阶段同步取消事件；默认 PNG 输出（白名单内、无损、Chromium 通用）；用合成 drop 而非私有 API；无宿主进程、无第三方解码器。
