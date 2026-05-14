# MaterialBox

一个本地优先的浏览器素材管理扩展，支持 Chrome 和 Firefox。它可以从网页中采集图片与视频，保存在本地 IndexedDB 中，并结合本地模型做基础智能分类。

## 使用演示

将演示动图放在项目根目录并命名为 `demo.gif` 后，README 会直接展示实际使用流程。

![MaterialBox demo](./demo.gif)

## 功能概览

- 右键快速保存网页图片和视频
- 扫描当前页面并批量收集媒体资源
- 使用 IndexedDB 本地存储素材，不依赖云端服务
- 基于 TensorFlow.js 和本地模型进行图片分类
- 支持手动纠正分类结果，逐步优化本地分类效果
- 提供素材网格浏览、预览、搜索和分类筛选
- 支持素材导入与导出
- 提供中英文界面
- 支持浏览器通知和保存反馈

## 项目结构

- `manifest.json`: Chrome 侧扩展清单
- `manifest.firefox.json`: Firefox 侧扩展清单模板
- `src/background.js`: 后台逻辑、右键菜单、抓取、导出、训练入口
- `src/content-script.js`: 页面媒体扫描与提取
- `src/lib/`: 数据存储、分类器、i18n 和通用工具
- `src/pages/`: popup 与素材库页面
- `_locales/`: 多语言文案
- `scripts/build-browser-packages.mjs`: 浏览器打包脚本
- `tests/`: 单元测试与简单烟雾测试

## 环境要求

- Node.js 18+
- npm 9+

## 安装依赖

```bash
npm install
```

## 开发命令

```bash
npm run build
npm test
```

脚本说明：

- `npm run build`: 构建 AI bundle、导出 bundle，并生成 `dist/chrome` 与 `dist/firefox`
- `npm test`: 运行 Node 内置测试
- `npm run test:smoke:chrome`: 运行 Chrome 冒烟测试
- `npm run test:compat:firefox`: 对 Firefox 构建产物执行 `web-ext lint`

说明：

- `src/generated/` 中的 bundle 由构建命令生成
- `dist/` 为浏览器打包产物，不建议直接提交

## 本地加载扩展

### Chrome

1. 打开 `chrome://extensions/`
2. 开启开发者模式
3. 选择“加载已解压的扩展程序”
4. 选择项目根目录，或在构建后选择 `dist/chrome`

### Firefox

1. 打开 `about:debugging#/runtime/this-firefox`
2. 选择“临时载入附加组件”
3. 选择项目根目录中的 `manifest.json`，或构建后使用 `dist/firefox/manifest.json`

说明：项目兼容 Chrome 与 Firefox 的后台脚本机制，构建流程会分别生成对应产物。

## 开发建议

- 修改 `src/lib/ai-entry.js` 或 `src/lib/export-entry.js` 后，重新执行 `npm run build`
- 提交代码时保留源码与必要资源文件，不提交 `node_modules`、`dist` 等生成产物

## 后续方向

- 引入更强的本地视觉 embedding 或相似度检索能力
- 增加标签系统、批量操作和重复素材检测
- 完善 ZIP 导出与元数据备份
- 增加站点规则、收藏夹和时间线视图
