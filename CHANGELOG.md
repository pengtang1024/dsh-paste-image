# 更新日志

本文件记录该项目的所有重要变更。

格式基于 [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)，本项目遵循[语义化版本](https://semver.org/spec/v2.0.0.html)。

## [Unreleased]

## [0.4.2] - 2026-11-25

### 修复

- 配置页不显示：恢复工厂返回对象里的 module-level `inject: ['slots']`（宿主 facade 服务门）。宿主 cordis-client-runner 的 guard 白名单不含 `slots`/`locale`/`inject`，0.4.1 删掉 inject 后 `apply()` 里读 `ctx.slots` / `typeof ctx.inject` 抛错被空 catch 吞掉，配置页从未注册到 `plugins.row.config`。只声明 `slots`、不声明 `locale`，避免 locale 偶发缺失时 park 整个包。
- `locale` 改由 `ctx.inject(['slots', 'locale'], cb)` 延迟获取；配置页注册失败不再静默，只输出一行 `console.debug('[dsh-paste-image] settings page unavailable: ...')`。注册仍由 `pageRegistered` 保证幂等，slot/key/NS 均不变（`plugins.row.config` / `dsh-paste-image#paste-image` / `dsh-paste-image:settings`）。
- 保留 0.4.1 的粘贴优先与合成器失败安全：`apply()` 仍先 `ctx.effect(install, 'paste-image')` 挂上监听，找不到真实 `[data-composer-card]` 时不 claim、放行原生 paste/drop。
- 测试仍为 90 个（90 通过、0 失败）。

## [0.4.1] - 2026-11-23

### 修复

- 配置页不再拖累粘贴链路（`client.js`）：模块工厂不再返回 `inject: ['slots', 'locale']`，`apply()` 一进来就先 `ctx.effect(install, 'paste-image')` 挂上 paste/drop 监听，再尽力注册配置页——`slots`/`locale` 已就绪时内联注册，否则用 `ctx.inject(['slots', 'locale'], cb)` 等服务到达后延迟注册，两者都没有就跳过。UI 服务缺失或注册抛错时，粘贴依旧可用。
- 不再吞掉原生粘贴：`handle()` 只有拿到真正的 `[data-composer-card]` 才 claim 并 `preventDefault()`/`stopPropagation()`；卡片不存在时直接返回，浏览器原生 paste/drop 路径继续执行，不再把合成 drop 派发到 `document.body`。
- 声明宿主要求：`package.json` 新增 `engines.dsh`（`>=0.2.0-rc.2 || >=0.2.1-rc.2 || >=0.2.2-rc.1`），插件详情页不再显示“未声明宿主要求”。
- 展示描述同步实际行为：`package.json` 与八种 `locale/*.json` 的简介从「只转 PNG」改为「PNG / JPEG / WebP（默认 PNG）」，并补充文件数与长边上限可配。
- 测试：补充监听立即安装、`ctx.inject` 延迟注册、缺少 `[data-composer-card]` 时不接管三条用例，套件共 90 个测试（90 通过、0 失败）。

## [0.4.0] - 2026-11-21

### 新增

- 配置页面：注册到插件管理器的 `plugins.row.config` 槽位（`key = dsh-paste-image#paste-image`），入口是“设置 → 插件 → dsh-paste-image → 配置”。插件行显示一行状态摘要，页面提供 6 个复选框（启用、XPM / BMP-DIB / SVG / ICO-CUR 转换开关、控制台日志）、1 个输出格式下拉框（PNG / JPEG / WebP）、3 个数字输入（单次最大文件数 1–8、长边 512–8192、质量 0.1–1，选 PNG 时禁用）、保存与恢复默认。
- 运行时设置：新增 `getSettings()` / `applySettings()` / `resetSettings()`，默认值等同于 0.3.1 的行为；`normalize()` 读取转换开关与输出格式/质量，`canvasOf()` 读取长边上限，`handle()` 读取总开关与文件数上限，日志由 `logConversions` 控制。保存后立即生效，无需重载页面；关掉某种格式后该格式原样交给原生通道，关掉总开关后监听器保留、粘贴与拖拽完全走原生路径。
- 输出格式：新增 `outputFormat`（`png` / `jpeg` / `webp`，默认 `png`）与 `quality`（0.1–1，默认 0.92，仅 JPEG / WebP 生效）；JPEG 编码前把透明像素合成到白底，PNG 无损、WebP 保留透明；浏览器不支持所选编码器时以实际 `blob.type` 为准回退，识别不了就回到 PNG，文件名扩展名同步。
- 持久化：设置按浏览器保存在 `localStorage` 的 `dsh-paste-image.settings.v1` 键下，不上传、不写宿主；`localStorage` 不可用或内容损坏时回退到默认值/内存，不影响粘贴。
- 测试：新增 26 个用例（`tests/settings.test.mjs`），覆盖默认值、范围钳制、持久化与损坏回退、恢复默认、行为接线、输出格式/质量与页面注册契约；测试总数从 61 增加到 87。
- 文档：新增输出格式实测（`docs/output-formats.md`，英文 `docs/en/output-formats.md`），记录真实 Chromium 下五个夹具的 PNG / JPEG / WebP 体积与编码耗时（q=0.92 与 q=0.8），结论是体积比例取决于内容、没有通用百分比——照片用 JPEG/WebP 约小 82%，UI 截图用 JPEG 反而比 PNG 大 49%、PNG 仍可能更小，透明图必须避开 JPEG；README 配置节补了 4 行速查表并链接完整实测。

## [0.3.1] - 2026-11-21

### 性能

- `normalize()` 先用 `file.slice()` 读取至多 1 KiB 头做嗅探；嗅探结果是原生格式（PNG/JPEG/WebP/GIF）且声明 MIME 与之一致时直接返回 `null`，不再对整文件调用 `arrayBuffer()`。20 MiB PNG 直通基准从 3.803–3.929 ms/op、每次全量读取 20,971,520 字节，降到 0.0038–0.0063 ms/op、全量读取 0 字节；只有声明类型为空需要重包、或确实要转码时才读全量。
- `resolveColor()` 复用一个 1×1 canvas 与 2D context，不再为每个调色板颜色新建画布；XPM 在 `cpp === 1` 时用字符码 `Map` 代替逐像素 `row.slice()`。512×512 XPM 基准从 4.712–4.837 ms/op 降到 3.35–3.95 ms/op（约 -24%，观测区间 -18%～-29%）。BMP→PNG 转换仍在约 3.9–4.0 ms/op，`decodeBmp` 在运行噪声内不变。
- 优化只发生在原有的同步渲染进程代码里：没有新增 worker，没有网络请求，处理时机与行为不变。`npm run bench` 可复现完整基准，`--quick` 为 CI 规模的冒烟运行。

### 兼容性

- 缺少 `AbortController` 时 `install()` 退回不带 `signal` 的监听，disposer 用 `removeEventListener` 精确卸载两个 handler。
- 缺少 `canvas.toBlob` 时 `toPngBlob()` 回退到 `toDataURL()`，再把 base64 解码成 `Blob`。
- 缺少 `DataTransfer`/`DragEvent` 时 `handle()` 在 claim 事件与 `preventDefault()` 之前返回，保留浏览器原生 paste/drop 路径，不会吞掉事件。
- 缺少 `file.slice()`/`file.size` 的类 `File` 对象无法只读文件头，退回原有的全量读取路径。

### 测试

- 61 个测试：41 个客户端/多语言用例，加上 20 个兼容性用例——无头 DIB、1/4/8/16/24/32 位 BMP、RLE4/RLE8、BITFIELDS、OS/2 core header、TIFF/HEIC/AVIF 嗅探、MIME 别名直通、BMP 冒充 PNG、8 文件上限、非图片透传，以及上述三条降级路径。CI 矩阵扩展到 Node 20/22/24，并新增 `node bench/bench.mjs --quick` 冒烟任务。

## [0.3.0] - 2026-11-20

### 新增

- 插件转为以中文为主：`README.md` 是简体中文，`README.en.md` 是英文版，另有 `README.ja.md`、`README.es.md`、`README.fr.md`、`README.de.md`、`README.ru.md`、`README.pt.md` 六种译文。每份 README 顶部都有同一行八语言切换链接，并新增「多语言」说明小节。
- `locale/` 目录为 DSH 界面支持的八种语言提供展示元数据：`locale/en.json`、`locale/zh.json`、`locale/ja.json`、`locale/es.json`、`locale/fr.json`、`locale/de.json`、`locale/ru.json`、`locale/pt.json`，各自携带本地化的 `meta.title`、`meta.description`，以及指向对应语言 README 的 `meta.detail`——中文指向 `README.md`，英文指向 `README.en.md`。插件列表行与详情页因此按界面语言显示，而不是回退到 manifest 名称和英文文案。
- 技术文档改为以中文为主：`docs/how-it-works.md`、`docs/formats.md`、`docs/troubleshooting.md`、`docs/releasing.md` 均为中文，英文版位于 `docs/en/` 下的同名文件。
- `CONTRIBUTING.md`、`CHANGELOG.md`、`SECURITY.md` 同样以中文为主，英文版分别为 `CONTRIBUTING.en.md`、`CHANGELOG.en.md`、`SECURITY.en.md`；`CODE_OF_CONDUCT.md` 保留 Contributor Covenant 英文原文。贡献指南新增「翻译」小节，说明中文是源语言、改动时需要同步哪些文件，以及新增一种语言时如何扩展测试中的 `LOCALES`。

### 变更

- `files` 发布 `README*.md`，不再写死两份 README；`package.json` 新增 `i18n`、`localization`、`multilingual` 关键词，版本为 `0.3.0`。
- 英文版 README 不再直接引用只存在于中文里的错误提示；该错误改为可翻译的散文描述，使各语言译文都基于同一段英文说明。
- 发布清单（`docs/releasing.md`）与格式文档（`docs/formats.md`）同步要求更新全部译文：发版时检查每种语言都仍有 locale 文件和 README，包内容检查期望全部八个 locale 与每一份译好的 README；格式文档的新增格式清单也要求同步更新各语言 README。文档之间的相对链接按语言指向中文页或 `docs/en/` 下的英文页。

### 测试

- 37 个测试：对八种语言逐语言校验元数据——各有一个可用的 locale 文件、标题、40 到 600 字符的简介，以及指向该语言 README 的 `meta.detail`；`meta.detail` 与 README 互链，每份 README 必须以 `# dsh-paste-image` 开头并链接全部八种译文；此外还检查 locale 集合与打包声明（`files` 中的 `README*.md`、`locale/*.json`，以及 `./locale/*.json` 导出），并确认 README 与文档里的每个相对链接都指向真实存在的文件。图标与打包检查仍期望 `README*.md` 和每个 locale 文件。

## [0.2.3] - 2026-11-18

### 修复

- 一次粘贴可能重复插入同一张图片：每份已加载的客户端 bundle 副本都会再添加一个 document 级监听器，而旧的 `install()` 返回空操作 disposer，因此监听器从不被移除；加载五份副本就会产生五份相同附件。现在 `install()` 是幂等的，返回基于引用计数、以 abort 实现的 disposer，在最后一个持有者释放时移除两个监听器；每个来源的 paste/drop 事件只被认领一次，重复监听器无法再把同一事件转换并二次转发。

### 测试

- 21 个测试：新增的用例连续 install 两次，断言只有一对 paste/drop 监听器，dispose 后再次 install。

## [0.2.2] - 2026-11-18

### 新增

- 插件管理器展示元数据：`locale/en.json` 与 `locale/zh.json` 提供 `meta.title` 和 `meta.description`，插件列表行与详情页会描述插件能力，而不是回退到 manifest 名称和 README。
- 包根新增 `icon`（`./assets/icon-180.png`）与 `./locale/*.json` 导出；图标和 locale 现在随 npm tarball 一起发布。
- `.github/workflows/release.yml` 通过 OIDC trusted publishing 把 GitHub Releases 发布到 npm，无需保存 token。

### 变更

- `dsh-paste-image@0.2.1` 是首个 npm 版本；两份 README 现在都以 `dsh plugin --profile <profile> add dsh-paste-image` 开头，并保留 GitHub 安装作为不经过 registry 的替代方式。

### 测试

- 20 个测试：新增的四个用例断言两个 locale 文件都带可用的 `meta.title`/`meta.description`、图标是小于 256 KiB 的 PNG，以及 locale 与图标被正确打包和导出。

## [0.2.1] - 2026-11-18

### 修复

- `docs/releasing.md` 的发版清单写的是 0.2.0 的测试数量；现已与测试套件一致（16 个测试）。

## [0.2.0] - 2026-11-18

### 新增

- `decodeBmp()` 完整支持 BMP/DIB：1/4/8/16/24/32 位像素，`BI_RLE8`/`BI_RLE4`，`BI_BITFIELDS`/`BI_ALPHABITFIELDS`，`BITMAPCOREHEADER`，`BITMAPV2/V3/V4/V5HEADER`，OS/2 v2 头，以及无头 DIB（即 `CF_DIB` 形态）。
- 内嵌 JPEG/PNG 载荷（`BI_JPEG`/`BI_PNG`）会被解包后交给浏览器解码器。
- SVG 粘贴通过 `<img>` 元素栅格化；缺少 `width`/`height` 时用 `viewBox` 提供尺寸。
- 浏览器无法解码 ICO/CUR 图标时，回退到最大的 PNG 压缩目录项。
- 为 AVIF、HEIC/HEIF、ICO/CUR、SVG 和无头 DIB 增加魔数检测。
- 增加 MIME 别名表，把 `image/jpg`、`image/x-png`、`image/x-bmp`、`image/x-xpixmap`、`image/svg+xml` 等视为规范类型。
- 在分配 BMP/XPM canvas 之前增加 `MAX_PIXELS` 保护（64 Mi px）。
- `docs/formats.md`：决策流程、完整格式矩阵、BMP 变体表格，以及新增格式的检查清单。
- `docs/releasing.md`：版本策略、发版清单、npm 发布步骤与市场同步。
- 开源脚手架：`.github/CODEOWNERS`、issue 模板中的联系链接、README 徽章，以及汇总贡献指南、行为准则、安全策略、更新日志与发布记录的「社区」小节。

### 变更

- 声明类型为空的原生图片会用嗅探出的类型重新包装，而不是原样透传后被宿主拒绝。
- BMP 解码器中的行步长、调色板项、位掩码与 alpha 处理由所有像素深度共用，不再只针对 24/32 位写死。
- 使用 `BI_CMYK` 压缩（11/12/13）的 BMP 会以 `bmp: unsupported compression` 拒绝，而不是当作 RGB 解码。

### 修复

- 编码器把 alpha 通道留为零的 32 位 BMP 不再导出为全透明 PNG。
- 调色板 BMP 项按正确的项大小加载（OS/2 core header 为 3 字节，其余为 4 字节），调色板项中为零的 alpha 字节不再把该颜色变成透明。
- `cordis.patch.yml` 现在包含在发布的 `files` 列表中。此前 GitHub（以及未来的 npm）安装会漏掉加载补丁，导致 bundle 入口从未挂载；CI 现在会检查 tarball 中是否存在该文件。

## [0.1.0] - 2026-11-15

### 新增

- 在 DSH 渲染进程中以捕获阶段拦截 `paste` 与 `drop`。
- 对 PNG、JPEG、GIF、WebP、BMP、TIFF 和 XPM 做魔数检测，不依赖声明的 MIME 类型。
- 当声明类型与字节一致时，PNG、JPEG、WebP 和 GIF 原样透传。
- XPM3 文本解码器（`decodeXpm`），以及 24/32 位未压缩 BMP 的回退解码器（`decodeBmp`）。
- Canvas 重新编码为 PNG，长边上限 4096 像素，并以 `.png` 命名文件。
- 把合成的 `drop` 事件转发到 `[data-composer-card]`，用 `__dshPasteImageRerouted` 去重。
- 通过 `__ModuleLoader__` 注册模块，并挂接 `ctx.effect` 生命周期钩子。
- Node 测试套件覆盖字节嗅探、候选检测、BMP 解码、声明类型不符时的转换与原生透传。
- 采用 MIT 许可证。
