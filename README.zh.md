# dsh-paste-image

[![CI](https://github.com/pengtang1024/dsh-paste-image/actions/workflows/ci.yml/badge.svg)](https://github.com/pengtang1024/dsh-paste-image/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![npm](https://img.shields.io/npm/v/dsh-paste-image.svg)](https://www.npmjs.com/package/dsh-paste-image)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](package.json)

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

包里是预构建产物，安装只从 npm 拉 8 个小文件。也可以直接从 GitHub 装、绕开 registry：

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

`npm test` 跑 Node 测试（0.2.2 为 20 个用例）：魔数嗅探、候选判定、各个 BMP 变体、BMP 冒充 PNG 的转码、无头 DIB、原生 PNG 放行。`npm run check` 对 `client.js` 和 `lib/index.js` 做语法检查。

再验证真实链路：

1. 重载 DSH 窗口。
2. 用平时的截图工具截图后粘进输入框，或把图片文件拖进去。
3. 附件正常出现。打开开发者工具（`Ctrl+Shift+I`）→ Console，把日志级别切到 **Verbose**，应能看到：

```text
[dsh-paste-image] image/xpm -> image/png 1440x900
```

如果转码失败，插件会保留原文件并打印 `keep original (...)`。

## 限制

- **XPM：** 只支持 XPM3 文本格式。解析器只读 `c` 颜色键，`m`、`g`、`s` 等键会被忽略；颜色交给浏览器的 CSS 解析器，调色板里带空格的名字（如 `light gray`）不是合法 CSS，会退化为不透明黑色。
- **BMP：** 支持 1/4/8/16/24/32 位、`BI_RGB`/`BI_RLE8`/`BI_RLE4`/`BI_BITFIELDS`/`BI_ALPHABITFIELDS`、core/扩展头/V4/V5/OS/2 头，以及无文件头的 DIB。2 位和 64 位像素格式不支持。32 位图若没有声明 alpha 掩码，且整幅图 alpha 全为 0，会按不透明处理，不再导出全透明 PNG。
- **其它编解码器：** SVG 由插件自己光栅化；ICO/CUR 会回退到 PNG 压缩条目；AVIF 依赖浏览器解码器。TIFF 和 HEIC 能被识别，但 Chromium 没有对应解码器，会原样放行、宿主仍然拒绝。插件不捆绑任何第三方解码库。
- **尺寸：** 转码后的图片最长边会被缩到不超过 4096 px；原生放行的文件不做任何缩放。
- **数量：** 一次粘贴或拖入最多 8 个文件，超过就整批交回原生路径。
- **扁平化：** 转码结果是一帧 PNG，动画、EXIF 元数据和内嵌色彩配置都不会保留。
- **范围：** 只覆盖 `paste` 与 `drop`；文件选择器等其它入口保持原生行为。

## 安全与隐私

- 全部逻辑运行在渲染进程，不发网络请求、不上传、不落盘。
- 没有后台进程、不轮询剪贴板、不修改 DSH 宿主代码。
- 图片字节只从 paste 或 drop 事件读取，本地解码后交回同一窗口。
- 解码器很小，但确实在渲染进程里处理不可信输入。发现崩溃或解析问题请见 [SECURITY.md](SECURITY.md)。

## 文档

- [实现原理](docs/how-it-works.md) —— 事件流、解码器内部实现、逐函数代码地图。
- [格式支持](docs/formats.md) —— 决策流程、格式矩阵、BMP 变体与新增格式清单。
- [常见问题](docs/troubleshooting.md) —— 典型故障与日志查看方法。
- [发版流程](docs/releasing.md) —— 版本策略与维护者发布清单。

## 社区

- [贡献指南](CONTRIBUTING.md) —— 开发环境、测试、代码风格与格式贡献要求。
- [行为准则](CODE_OF_CONDUCT.md) —— Contributor Covenant 2.1。
- [安全策略](SECURITY.md) —— 私下报告、影响范围与支持版本。
- [更新日志](CHANGELOG.md) 与[发布记录](https://github.com/pengtang1024/dsh-paste-image/releases) —— 改了什么、为什么改。
- [Issues](https://github.com/pengtang1024/dsh-paste-image/issues) —— 缺陷报告与格式需求。

## 许可证

MIT © 2026 pengtang1024，见 [LICENSE](LICENSE)。
