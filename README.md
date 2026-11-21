# dsh-paste-image

[![CI](https://github.com/pengtang1024/dsh-paste-image/actions/workflows/ci.yml/badge.svg)](https://github.com/pengtang1024/dsh-paste-image/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![npm](https://img.shields.io/npm/v/dsh-paste-image.svg)](https://www.npmjs.com/package/dsh-paste-image)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](package.json)

[简体中文](README.md) · [English](README.en.md) · [日本語](README.ja.md) · [Español](README.es.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · [Русский](README.ru.md) · [Português](README.pt.md)

把几乎任何图片粘进或拖进 DeepSeek Harness —— 哪怕剪贴板声称它是 `image/xpm`，或者干脆把 MIME 类型写错了。

## 为什么需要它

DSH 桌面客户端（Electron/Chromium）的附件通道只接受四种类型：`image/png`、`image/jpeg`、`image/webp`、`image/gif`。其它类型一律报红：

> 仅支持 PNG、JPG、WebP、GIF

这份白名单会打断两种在 Linux 上很常见的场景：

- **截图被声明成 XPM。** 部分截图工具（尤其是 Ubuntu/Wayland 上）会把图片以 `image/xpm` 类型放进剪贴板。像素本身没问题，但这个类型不在白名单里，粘贴直接被拒。
- **BMP 字节披着 PNG 的皮。** 有些应用交上来的是 BMP（或 TIFF）数据，却声明成 `image/png`。声明类型过了白名单检查，后面解码失败，还是同一个红字。

`dsh-paste-image` 在渲染进程里把这两类问题一起解决：看真实字节、解出剪贴板里真正的内容、重编码成 PNG，再交回原生附件通道。

## 工作原理

1. **捕获。** `install()` 在 `document` 上以捕获阶段挂 `paste` 和 `drop` 监听，确保先于输入框自己的处理逻辑看到事件。
2. **嗅探。** `handle()` 从 `clipboardData` 或 `dataTransfer` 取出 `File`，`sniff()` 按魔数判断真实格式 —— 不看声明的 MIME 类型。
3. **重编码。** `normalize()` 对四种原生格式原样放行；其余先解码（XPM、BMP/DIB、SVG 走自带路径，其它交给浏览器），画到画布上（最长边超过 4096 会被缩放），再导出为 `image/png`，文件名改成 `.png`。
4. **回投。** `handle()` 在 `[data-composer-card]` 上派发一个携带新 `File` 的合成 `drop` 事件，和真实拖拽走同一条路径；`__dshPasteImageRerouted` 标记防止插件截获自己的事件。

全部逻辑都在客户端。没有宿主进程、不轮询剪贴板、不发网络请求。

## 支持的格式

下表是简版；完整决策流程、BMP 变体网格以及明确不做的格式，见[格式支持参考](docs/formats.md)。

| 格式                     | 常见声明类型    | 处理方式                                                                                                  |
| ------------------------ | --------------- | --------------------------------------------------------------------------------------------------------- |
| PNG                      | `image/png`     | 原样放行，不改写                                                                                          |
| JPEG / JFIF              | `image/jpeg`    | 原样放行，不改写                                                                                          |
| WebP                     | `image/webp`    | 原样放行，不改写                                                                                          |
| GIF                      | `image/gif`     | 原样放行，不改写                                                                                          |
| XPM（XPM3 文本）         | `image/xpm`     | 由 `decodeXpm()` 解码，重编码为 PNG                                                                       |
| BMP / DIB                | `image/bmp`     | 先交给浏览器解码，失败则用 `decodeBmp()` 兜底：1/4/8/16/24/32 位、RLE4/RLE8、BITFIELDS、OS/2 头与无头 DIB |
| SVG                      | `image/svg+xml` | 通过 `<img>` 元素光栅化，重编码为 PNG                                                                     |
| ICO / CUR                | `image/x-icon`  | 先交给浏览器解码，失败则取最大的 PNG 压缩条目                                                             |
| TIFF                     | `image/tiff`    | 能按魔数识别；仅当浏览器自带 TIFF 解码器时才解码（Chromium 没有），否则原样放行                           |
| AVIF                     | `image/avif`    | Chromium 能解码，重编码为 PNG                                                                             |
| HEIC / HEIF 等 `image/*` | `image/...`     | 能按魔数识别；浏览器有对应解码器才解码（Chromium 不解 HEIC），否则原样放行                                |

只有在「魔数属于四种原生格式」**且**「声明类型与之一致」时才原样放行。字节是 JPEG 却声称 `image/png` 的文件会被重编码成真正的 PNG，声明类型从此骗不了人。声明类型为空的原生文件会按嗅探结果重新包一层 `File`（不重编码）；`image/jpg`、`image/x-png`、`image/x-bmp`、`image/x-xpixmap`、`image/svg+xml` 等常见别名视为一致。

一个文件会被纳入处理，条件是 MIME 类型以 `image/` 开头，或文件名以 `.png`、`.jpg`、`.jpeg`、`.jfif`、`.gif`、`.webp`、`.bmp`、`.dib`、`.tif`、`.tiff`、`.xpm`、`.avif`、`.ico`、`.cur`、`.svg`、`.heic`、`.heif` 结尾。同一次粘贴里的非图片文件会原样转发。

## 安装

```bash
dsh plugin --profile <profile> add dsh-paste-image
```

包里是预构建产物——渲染端 bundle、宿主入口、加载补丁、展示元数据和多语言文档——安装直接从 npm registry 拉取。也可以直接从 GitHub 装、绕开 registry：

```bash
dsh plugin --profile <profile> add github:pengtang1024/dsh-paste-image
```

本地开发时指向你的工作副本：

```bash
dsh plugin --profile <profile> add file:/absolute/path/to/dsh-paste-image
```

把 `<profile>` 换成应用实际使用的 profile。**装完必须重载页面**（`Ctrl+R`，macOS 上是 `Cmd+R`）：客户端模块只在渲染进程加载时注入，没重载之前插件不会拦截任何东西。

## 验证

先跑仓库自带检查：

```bash
cd dsh-paste-image
npm test
npm run check
```

`npm test` 跑 Node 测试：魔数嗅探、候选判定、各个 BMP 变体、BMP 冒充 PNG 的转码、无头 DIB、原生 PNG 放行、配置页与运行时设置，以及每个语种的展示元数据。`npm run check` 对 `client.js` 和 `lib/index.js` 做语法检查。

再验证真实链路：

1. 重载 DSH 窗口。
2. 用平时的截图工具截图后粘进输入框，或把图片文件拖进去。
3. 附件正常出现。打开开发者工具（`Ctrl+Shift+I`）→ Console，把日志级别切到 **Verbose**，应能看到：

```text
[dsh-paste-image] image/xpm -> image/png 1440x900
```

如果转码失败，插件会保留原文件并打印 `keep original (...)`。

## 配置

插件在**设置 → 插件 → dsh-paste-image → 配置**里提供一页运行时设置。插件行上还会显示一行摘要（已启用 / 已停用），点进去就是完整表单。默认值等于引入配置页之前的行为：

| 字段           | 默认值 | 范围 / 行为                                                                          |
| -------------- | ------ | ------------------------------------------------------------------------------------ |
| 启用插件       | 开     | 关掉后 `handle()` 直接返回，粘贴与拖拽完全走原生路径（监听器保留，重新打开立即恢复） |
| 单次最大文件数 | 8      | 1–8；超过这个数量的批次整批交回原生路径                                              |
| 长边上限 (px)  | 4096   | 512–8192；只约束转码后的图片，原生放行的文件不缩放                                   |
| 转换 XPM       | 开     | 关掉后 `image/xpm` 不再转码，原样交给原生通道                                        |
| 转换 BMP / DIB | 开     | 关掉后 BMP/DIB（包括字节是 BMP、声明是 PNG 的文件）原样放行                          |
| 转换 SVG       | 开     | 关掉后 SVG 不再光栅化，原样交给原生通道                                              |
| 转换 ICO / CUR | 开     | 关掉后图标不再转码，原样交给原生通道                                                 |
| 控制台转换日志 | 开     | 关掉后不再打印 `[dsh-paste-image] ...` 的 `console.debug` 日志                       |

点**保存**才会写入并立即生效；表单项的改动只是页面内的草稿，离开页面即丢弃。**恢复默认**把上表全部默认值写回并同样立即生效。数字输入会取整并夹到范围内（清空输入框不会把已保存的值打成 0）。

设置只保存在当前浏览器的 `localStorage` 里，键名是 `dsh-paste-image.settings.v1`：不上传、不写宿主，也不跨浏览器或 profile 同步。隐私模式或 `localStorage` 不可用时退回内存，重载页面后回到默认值。保存后无需重载页面，下一次粘贴就按新设置处理。

## 限制

- **XPM：** 只支持 XPM3 文本格式。解析器只读 `c` 颜色键，`m`、`g`、`s` 等键会被忽略；颜色交给浏览器的 CSS 解析器，调色板里带空格的名字（如 `light gray`）不是合法 CSS，会退化为不透明黑色。
- **BMP：** 支持 1/4/8/16/24/32 位、`BI_RGB`/`BI_RLE8`/`BI_RLE4`/`BI_BITFIELDS`/`BI_ALPHABITFIELDS`、core/扩展头/V4/V5/OS/2 头，以及无文件头的 DIB。2 位和 64 位像素格式不支持。32 位图若没有声明 alpha 掩码，且整幅图 alpha 全为 0，会按不透明处理，不再导出全透明 PNG。
- **其它编解码器：** SVG 由插件自己光栅化；ICO/CUR 会回退到 PNG 压缩条目；AVIF 依赖浏览器解码器。TIFF 和 HEIC 能被识别，但 Chromium 没有对应解码器，会原样放行、宿主仍然拒绝。插件不捆绑任何第三方解码库。
- **尺寸：** 转码后的图片最长边默认缩到不超过 4096 px，可在[配置](#配置)里调整；原生放行的文件不做任何缩放。
- **数量：** 一次粘贴或拖入默认最多 8 个文件，可在[配置](#配置)里调整；超过就整批交回原生路径。
- **扁平化：** 转码结果是一帧 PNG，动画、EXIF 元数据和内嵌色彩配置都不会保留。
- **范围：** 只覆盖 `paste` 与 `drop`；文件选择器等其它入口保持原生行为。

## 性能

0.3.1 对热路径做了实测优化，数字来自 `bench/bench.mjs`，同一台机器、Node 24：

| 场景                          | 0.3.0                                           | 0.3.1                                           |
| ----------------------------- | ----------------------------------------------- | ----------------------------------------------- |
| 原生 PNG 直通（20 MiB）       | 3.803–3.929 ms/op；每次全量读取 20,971,520 字节 | 0.0038–0.0063 ms/op；全量读取 0 字节            |
| XPM 解码（512×512，64 色）    | 4.712–4.837 ms/op                               | 3.35–3.95 ms/op（约 -24%，观测区间 -18%～-29%） |
| BMP→PNG 转换（1024×1024）     | 约 3.9–4.0 ms/op                                | 约 3.9–4.0 ms/op，未变                          |
| `decodeBmp`（24/32 位、RLE8） | —                                               | 在运行噪声内不变                                |

`normalize()` 现在先用 `file.slice()` 读至多 1 KiB 头做嗅探；只要嗅探结果是原生格式（PNG/JPEG/WebP/GIF）且声明的 MIME 与之一致，就直接返回、不再把整个文件读进内存。只有需要重新标注类型（声明为空）或真的要转码时才回退到全量 `arrayBuffer()`。`resolveColor()` 复用一个 1×1 画布，XPM 在编码为单字符时用字符码 Map 查表，省掉逐像素 `row.slice()`。BMP 解码与转码路径没有改动。

优化只发生在这段同步的渲染进程代码里：没有新增 worker、没有网络请求，也没有改变插件的处理时机。基准可以用 `npm run bench`（或 `npm run bench -- --quick`）在本机复现；仓库记录的数字是参考值，不是 CI 阈值。

## 兼容性

插件面向现代 Chromium/Electron 提供的渲染进程 API：`File`/`Blob`、`TextDecoder`、`createImageBitmap`、`canvas.toBlob`、`DataTransfer`/`DragEvent`，以及带 `signal` 的 `addEventListener`。在这套基线上，三处缺失做了显式降级，避免某个 API 不存在时插件整体失效或吞掉原生事件：

| 缺失的能力                   | 降级行为                                                                                       |
| ---------------------------- | ---------------------------------------------------------------------------------------------- |
| `AbortController`            | `install()` 改用不带 `signal` 的监听，disposer 用 `removeEventListener` 精确卸载               |
| `canvas.toBlob`              | `toPngBlob()` 回退到 `toDataURL()`，再把 base64 解码成 `Blob`                                  |
| `DataTransfer` / `DragEvent` | `handle()` 在 claim 事件与 `preventDefault()` 之前返回，浏览器原生 paste/drop 路径完全不受影响 |

缺少 `slice()`/`size` 的类 `File` 对象无法只读文件头，会退回原有的全量读取路径。CI 在 Node 20、22、24 上运行全部测试，并额外跑一个 `bench/bench.mjs --quick` 冒烟任务；当前共 79 个测试（41 个客户端/多语言 + 20 个兼容性 + 18 个配置页/设置），覆盖无头 DIB、1/4/8/16/24/32 位 BMP、RLE4/RLE8、BITFIELDS、OS/2 core header、TIFF/HEIC/AVIF 嗅探、MIME 别名直通、BMP 冒充 PNG、8 文件上限、非图片透传、上面三条降级路径，以及配置页的注册契约与设置行为。逐格式的平台差异与浏览器能力依赖见[格式支持](docs/formats.md)。

## 安全与隐私

- 全部逻辑运行在渲染进程，不发网络请求、不上传、不落盘。
- 没有后台进程、不轮询剪贴板、不修改 DSH 宿主代码。
- 图片字节只从 paste 或 drop 事件读取，本地解码后交回同一窗口。
- 解码器很小，但确实在渲染进程里处理不可信输入。发现崩溃或解析问题请见 [SECURITY.md](SECURITY.md)。

## 多语言

插件为 DSH 界面支持的全部语言提供展示元数据——简体中文、英语、日语、西班牙语、法语、德语、俄语和葡萄牙语。每种语言的 `locale/<语言>.json` 各自携带本地化的标题与简介，并把详情页指向本仓库对应语言的 README，因此插件管理器与插件详情页显示的语言与界面一致。

**简体中文是源语言。** 本 README、`docs/` 下的文档以及 `CONTRIBUTING.md`、`CHANGELOG.md`、`SECURITY.md` 都用中文撰写；其余语言是紧随其后的译文，其中英语版为 `README.en.md` 与 `docs/en/`。译文随代码一起维护，不是运行时机器翻译。测试会检查每个已声明语言都有 locale 文件、详情文档，并且 README 之间互相链接。要修正或新增翻译，见[贡献指南](CONTRIBUTING.md#翻译)。

## 文档

- [实现原理](docs/how-it-works.md) —— 事件流、解码器内部实现、逐函数代码地图。
- [格式支持](docs/formats.md) —— 决策流程、格式矩阵、BMP 变体与新增格式清单。
- [常见问题](docs/troubleshooting.md) —— 典型故障与日志查看方法。
- [发版流程](docs/releasing.md) —— 版本策略与维护者发布清单。

## 社区

- [贡献指南](CONTRIBUTING.md) —— 开发环境、测试、代码风格、翻译与格式贡献要求。
- [行为准则](CODE_OF_CONDUCT.md) —— Contributor Covenant 2.1。
- [安全策略](SECURITY.md) —— 私下报告、影响范围与支持版本。
- [更新日志](CHANGELOG.md) 与[发布记录](https://github.com/pengtang1024/dsh-paste-image/releases) —— 改了什么、为什么改。
- [Issues](https://github.com/pengtang1024/dsh-paste-image/issues) —— 缺陷报告与格式需求。

## 许可证

MIT © 2026 pengtang1024，见 [LICENSE](LICENSE)。
