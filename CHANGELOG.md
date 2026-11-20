# 更新日志

本文件记录该项目的所有重要变更。

格式基于 [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)，本项目遵循[语义化版本](https://semver.org/spec/v2.0.0.html)。

## [Unreleased]

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
