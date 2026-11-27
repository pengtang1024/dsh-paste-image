# 发版

发版由维护者从 `master` 切出。本文所有内容都是可以直接照抄的检查清单；仓库没有构建步骤，所以「发版」就是改版本号 + 更新 changelog + 打 tag + 写发布说明。

> 🚦 **发版流程一览：** 版本策略 → 发版前检查 → 六步发版流程 → 发布后验证 → npm 发布 → 热修复。**CI 必须全绿**才允许发布。

## 版本策略

项目遵循[语义化版本](https://semver.org/spec/v2.0.0.html)，并保留 1.0 之前的常见约定：

- **0.x.0**（MINOR）——新增格式、新增宿主集成，以及任何可能改变透传规则的东西。1.0 之前，次版本发布可以包含破坏性变更。
- **0.x.y**（PATCH）——缺陷修复、解码器修正、仅文档变更的发布。
- `package.json` 里的版本号是唯一事实来源，没有单独的版本文件。

新增一种格式永远是次版本号提升：用户会按版本锁定插件，需要知道解码行为何时发生了变化。

## 发版前检查

以下命令全部在 `master` 的干净检出上执行（测试套件共 102 个用例，必须全部通过）：

```bash
git switch master
git pull --ff-only
git status --porcelain          # must be empty
npm test                        # suite must pass
npm run check
npm run format:check            # CI runs the same thing
```

> 🚦 **CI 门禁：** 同时确认最新 `master` 提交对应的 GitHub Actions 运行是绿的——即使本地全部通过，只要 CI 红了，这次发布就不能发。

## 发版流程

1. **提升版本号。**

   ```bash
   npm version 0.3.0 --no-git-tag-version   # or edit package.json by hand
   ```

2. **把 changelog 提升为正式版本。** 将 `## [Unreleased]` 下的条目移入新的 `## [0.3.0] - YYYY-MM-DD` 小节，`CHANGELOG.md`（中文）和 `CHANGELOG.en.md`（英文）两处都要做，并让每份文件的 `## [Unreleased]` 保持为空。保持 Keep-a-Changelog 结构：`Added`、`Changed`、`Deprecated`、`Removed`、`Fixed`、`Security`。

3. **检查翻译。** 中文文档是唯一事实来源：`README.md` 和 `docs/` 下的页面是正式版本，`README.en.md`、`docs/en/`、`CONTRIBUTING.en.md`、`CHANGELOG.en.md` 和 `SECURITY.en.md` 是镜像。如果本次发布改变了用户可见的事实——某个格式、某个限制、某个安装步骤——就在同一个发布提交里更新每个 `README.<language>.md`、每个 `locale/<language>.json` 的描述、对应的英文页面，以及市场上的条目。当某个语言缺少 README、缺少 `meta.detail` 目标、缺少跨 README 链接，或文档里出现指向不存在文件的相对链接时，测试套件会失败：

   ```bash
   ls README*.md locale/*.json
   npm test
   ```

4. **格式化并验证。**

   ```bash
   npm run format
   npm test
   npm run check
   npm run format:check
   ```

5. **提交、打 tag、推送。**

   ```bash
   git add -A
   git commit -m "chore(release): 0.3.0"
   git tag -a v0.3.0 -m "dsh-paste-image 0.3.0"
   git push origin master
   git push origin v0.3.0
   ```

   这里故意使用附注 tag（annotated tag）：`git describe` 和发布页面都会用到它。已经发布出去的 tag，永远不要移动或强制推送。

6. **发布 GitHub release。** 直接复用 changelog 中对应的章节作为正文：

   ```bash
   awk '/^## \[0\.3\.0\]/{flag=1;next}/^## \[/{flag=0}flag' CHANGELOG.md > /tmp/notes.md
   gh release create v0.3.0 --title "v0.3.0" --notes-file /tmp/notes.md --verify-tag
   ```

   对于 `0.x.y-rc.N` 这类 tag，加上 `--prerelease`。

## 发布之后

- **确认 tag 能安装。** GitHub 安装解析的是仓库而不是 release，但验证 tag 仍能发现 `files` 里漏掉了 `client.js` 之类的问题：

  ```bash
  dsh plugin --profile <scratch-profile> add github:pengtang1024/dsh-paste-image#v0.3.0
  ```

  打开那个 profile，粘贴一张图片，然后删除该 profile。

- **检查打包内容。** `npm pack --dry-run` 会打印文件列表；其中必须包含 `client.js`、`lib/`、`cordis.patch.yml`、全部七个 locale、每个翻译版 README、`LICENSE` 和 `CHANGELOG.md`，并且不能有 `tests/` 或 `docs/` 里的任何文件。

- **更新市场上的条目。** 插件市场的提交位于另一个仓库：[`data/plugins/pengtang1024__dsh-paste-image.yml`](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/data/plugins/pengtang1024__dsh-paste-image.yml)。如果发布改变了支持的格式列表，就在提到这些新格式的同一个 pull request 里更新 `description.en` / `description.zh`。目录的 schema 只承载这两种语言；七种语言的文案存放在插件的 `locale/` 目录里，在安装之后才会被读取。市场 pull request 合并后，目录每晚重新生成。

## 发布到 npm

自 0.2.1 起，包以 `dsh-paste-image` 的名字发布在 npm 上。此后各版本都由 CI 发布：

1. `.github/workflows/release.yml` 在 `release: published` 时通过 **trusted publishing（OIDC）** 发布——没有 `NPM_TOKEN`，也没有存储任何密钥。
2. 在 npmjs.com 上一次性配置 trusted publisher（package → Settings → Trusted Publisher）：provider 填 `GitHub Actions`，organization 填 `pengtang1024`，repository 填 `dsh-paste-image`，workflow 填 `release.yml`，environment 留空。该配置必须在两天内完成第一次成功发布，否则会过期，需要重新创建。
3. 只支持 GitHub 托管的 runner；自托管 runner 会被 registry 拒绝。
4. 工作流不可用时的兜底手工发布：`npm publish --registry=https://registry.npmjs.org --access public`。该账号开启了 `auth-and-writes` 2FA，因此不带 bypass-2FA 的细粒度 token 会拿到 403。确实能绕过 2FA 的 token 仍然无法管理 token、访问权限、维护者或 trusted-publisher 设置——那些操作需要交互式验证。

有四个坑值得记住：

- **镜像源不能用来发布。** `registry.npmmirror.com` 是只读的；手工发布时始终要带 `--registry=https://registry.npmjs.org`（或设置 `publishConfig.registry`）。
- **不要把 staged 版本留在那里。** `npm stage publish` 把 2FA 推迟到 `npm stage approve`；一次中断的尝试会在 registry 里留下 `0.0.0-stage` 版本，而绕过 2FA 的 token 无法把它撤下。
- **信任权限默认不是「开着」的。** `npm stage publish` 始终允许；直接发布和 dist-tag 管理需要额外勾选。`npm trust list <pkg> --registry=https://registry.npmjs.org` 必须输出 `permissions: publish, stage publish`。带 `stage publish, manageDistTags` 权限的条目仍然能成功换取 token，但随后上传会失败并报 `403 OIDC permission denied for this action`。
- **信任条目不能编辑，只能替换。** 对已存在的条目执行 `npm trust github … --allow-publish` 会失败：`409 ... a trusted publisher configuration that a token could also match already exists`。先撤销（`npm trust revoke <pkg> --id=<id>`），再用 `--allow-publish` 重建。这两条命令都需要浏览器交互式验证，所以非 TTY 的 shell 无法完成。

## 热修复

安全修复和解码器修复走同一条路径，只是提升 PATCH 号。当 `master` 上已经包含未发布的改动时，从已发布的 tag 拉分支：

```bash
git switch -c fix/decoder-bounds v0.2.0
# fix, test, commit
git switch master && git merge --ff-only fix/decoder-bounds
npm version patch --no-git-tag-version
```

如果修复涉及安全，就把发布说明与安全公告同时发出，这样用户能看到升级路径。

## 不要做的事

- 不要在功能 pull request 里提升版本号或修改 `CHANGELOG.md`；参见 `CONTRIBUTING.md`。
- 不要从 `master` 以外的分支发布。
- 不要删除已发布的 release 或 tag；改为发布一个后续 patch。
- 不要在 tag 指向的同一个提交没有绿色 CI 运行的情况下发布。
