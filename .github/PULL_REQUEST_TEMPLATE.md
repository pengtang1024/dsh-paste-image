## 变更说明

<!-- 这个 PR 解决什么问题、改了什么，为什么这样改。 -->

## 测试方式

- [ ] `npm test`（`node --test tests/*.test.mjs`）
- [ ] `npm run check`（`node --check client.js && node --check lib/index.js`）
- [ ] `npx --yes prettier@3 --check .`
- [ ] 手动粘贴验证

手动验证记录（截图工具、原始格式、转换结果）：

<!-- 例如：微信截图 image/xpm 1440x900 -> image/png，粘贴成功落地附件 -->

## 是否影响原生放行路径

- [ ] 否，只改文档、模板或工具链
- [ ] 是，涉及 `sniff()` / `normalize()` / `NATIVE_TYPES` / 合成 drop 事件

影响说明：

<!-- 原生只接受 image/png、image/jpeg、image/webp、image/gif。若改变了透传条件，请说明哪些输入从此会被改写。 -->

## 检查项

- [ ] 未引入新的运行时依赖
- [ ] 仍是纯客户端实现：无后台进程、不轮询剪贴板、不上传数据
- [ ] 已知限制未被回退：XPM 仅 XPM3 文本、BMP 仅 24/32 位未压缩、HEIC/AVIF/SVG 依赖浏览器解码器、单次最多 8 张
