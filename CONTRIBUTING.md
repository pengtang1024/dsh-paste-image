# 为 dsh-paste-image 做贡献

感谢你的帮助。这是一个小巧、零依赖的浏览器插件，门槛就一句话：改一件事，测一遍，保持精简。

## 环境要求

- Node.js 20 或更高版本。`package.json` 中声明了 `"engines": { "node": ">=20" }`。
- 没有运行时依赖。插件以纯渲染进程代码加一个空宿主模块的形式发布，项目不接受新增依赖。
- 本地检查用 npm 就够了。DSH CLI 安装插件时内部使用 pnpm，你不需要自己管理。

## 本地准备

```bash
git clone https://github.com/pengtang1024/dsh-paste-image.git
cd dsh-paste-image
npm test
npm run check
```

想在应用里试用你的改动：

```bash
dsh plugin --profile <profile> add file:/absolute/path/to/dsh-paste-image
```

安装后重载 DSH 窗口。在当前 DSH 构建中，`file:` 安装会把插件复制进 profile，所以修改工作副本之后，要重新执行 `add` 命令并再次重载；没有构建步骤，`client.js` 原样发布。

## 项目结构

| 路径                    | 用途                                                                                                                                                                       |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `client.js`             | 全部渲染进程逻辑：事件捕获、嗅探、解码、PNG 重编码与回投。                                                                                                                 |
| `lib/index.js`          | 宿主部分。故意留空（`export function apply() {}`）；一切都发生在渲染进程。                                                                                                 |
| `cordis.patch.yml`      | 挂载插件的加载器入口。                                                                                                                                                     |
| `locale/`               | DSH 界面所支持的八种语言的展示元数据：标题、描述，以及插件管理器中显示的详情文档。                                                                                         |
| `README*.md`            | 中文源 README，以及其余七种语言的完整翻译；每个 `meta.detail` 指向自己语言的那份 README。                                                                                  |
| `tests/client.test.mjs` | `node:test` 测试套件；在带最小 DOM 桩的 `vm` 上下文中运行 `client.js`。                                                                                                    |
| `tests/helpers/dom.mjs` | 桩实现：假的画布与图像数据、BMP 构造器，以及 `client.js` 期望的全局对象。                                                                                                  |
| `docs/`                 | 中文用户文档，英文镜像在 `docs/en/`：[实现原理](docs/how-it-works.md)、[格式支持](docs/formats.md)、[常见问题](docs/troubleshooting.md) 与 [发版流程](docs/releasing.md)。 |

## 测试随改动一起提交

每一次行为变更都需要测试，而且两道门禁都必须保持通过：

```bash
npm test
npm run check
```

- `npm test` 运行 `node --test tests/*.test.mjs`。新增格式、新增防护或修改直通规则时都要补用例。当前套件覆盖魔数嗅探、候选文件识别、BMP 解码器、把声明为 PNG 的 BMP 字节转换、原生直通、每种语言展示的 locale 元数据，以及文档之间的相对链接。
- `npm run check` 对 `client.js` 和 `lib/index.js` 运行 `node --check`。
- 任何触及事件路径的改动，还要手工验证：在本地安装插件、重载，然后粘贴一张截图并拖入一个文件。确认输入框收到附件，且控制台（Verbose 级别）打印出预期的 `[dsh-paste-image]` 日志行。

没有命令输出就不要声称改动已经验证。有没测到的部分，在拉取请求里写清楚。

## 新增格式

格式相关的工作不只是解码器。完整清单在 [docs/formats.md#新增格式](docs/formats.md#新增格式)；简要说：嗅探它、解码它、在 `toCanvas()`/`IMAGE_EXT` 里路由它，补四个测试用例（正常路径、截断、声明类型撒谎、嗅探），然后更新 `docs/formats.md` 与 `docs/en/formats.md`、每个 README，以及 `CHANGELOG.md` 和 `CHANGELOG.en.md`。解码器必须保持零依赖——新增运行时依赖对这个插件来说不可接受。

## 翻译

插件为 DSH 界面支持的每种语言提供展示元数据和 README：简体中文（`zh`，源语言）、英语（`en`）、日语（`ja`）、西班牙语（`es`）、法语（`fr`）、德语（`de`）、俄语（`ru`）、葡萄牙语（`pt`）。`README.md` 是中文源文档，`README.en.md` 是英文翻译，其余为 `README.<language>.md`。

当你改动某个用户可见的事实时——格式、限制、安装步骤、版本号——要在同一次改动里更新全部八种语言。翻译不要求文笔完美，但不得改变含义、添加说法或漏掉限制。

要更新的文件：

1. 各语言 README —— 完整译文。八语言切换行、徽章、代码围栏、命令、路径、URL 与行内代码必须与中文源保持结构一致；翻译正文、标题与表格文字。
2. `locale/<language>.json` —— `meta.title`（3–80 个字符）、`meta.description`（超过 40 个字符，事实与限制同 `locale/zh.json`），以及 `meta.detail`，它必须指向该语言的 README（中文为 `README.md`，英文为 `README.en.md`，其余为 `README.<language>.md`）。

新增一种语言时，先确认 DSH 界面确实支持它；没人能选到的 locale 文件只是白占位置。然后添加该语言的 README 与 `locale/<language>.json`，把它加进每个 README 的切换行，并扩展 `tests/locale.test.mjs` 里的 `LOCALES`。缺少 locale 文件、详情文档或跨 README 链接时，测试会失败；README 或文档里出现指向不存在文件的相对链接时也会失败。

## 代码风格

- JavaScript 使用 Prettier 3 格式化；仓库里的 `.prettierrc.json` 设置了 `semi: false`、`singleQuote: true` 和 `printWidth: 120`。
- `client.js` 在渲染进程中作为经典脚本加载：不要有顶层 `import`/`export`，保留 IIFE，并保留底部的 `module.exports` 测试接缝。
- 保持代码零依赖，解码器自成一体。宁可写几个清晰的函数，也不要引入框架。
- 提交前先格式化：

```bash
npm run format        # npx --yes prettier@3 --write .
npm run format:check  # npx --yes prettier@3 --check .
```

`.prettierignore` 排除了 `node_modules/` 和 `package-lock.json`。`LICENSE` 没有扩展名，所以针对目录运行 Prettier 时会跳过它；它是纯 MIT 文本。

## 拉取请求

1. 凡是比错别字或文档修正更大的改动，请先开 issue。
2. 从 `master` 拉分支：`feat/...`、`fix/...` 或 `docs/...`。
3. 保持提交聚焦，使用 `type(scope): summary`，type 取 `feat`、`fix`、`docs`、`test` 或 `chore`。
4. 在描述里说明改了什么、为什么改、如何验证——贴出命令和相关输出。涉及事件路径的改动，要描述手工粘贴/拖放验证。
5. CI 会在 Node 20 和 22 上对两个入口文件运行 `node --check`、`npx prettier@3 --check .` 和 `npm test`。三项都要保持通过。
6. 功能类拉取请求里不要改版本号，也不要改 `CHANGELOG.md`；发版由维护者执行。
7. 不要提交生成文件、二进制文件或编辑器状态。

## 报告问题

一份有用的报告应包含：

- DSH 版本，以及插件是如何安装的（GitHub 还是本地 `file:` 路径）。
- 操作系统与桌面会话，以及是哪个应用产生的图片。
- 声明的 MIME 类型——它就是 `[dsh-paste-image]` 日志行的左侧。
- 控制台在 Verbose 级别下的输出，以及任何红色报错的完整文本。
- 一份样本文件，前提是其中不含隐私内容。

请不要附加包含个人数据的截图或文件。

## 行为准则

本项目遵循 [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)。
