# 开放范围与许可

发布日期：2026-10-29。团队已确认对本次自有内容的授权权利，并同意 MIT 许可及公开发布。

## 获取方式

- 公开仓库：https://github.com/KylerGu/optics-lab-open-source
- 源码 ZIP：https://github.com/KylerGu/optics-lab-open-source/archive/refs/heads/codex/publish.zip
- 演示网站：https://optics-lab-elvy.onrender.com/

仓库及源码下载不要求评委成为项目成员。网站 AI 功能依赖部署者的服务配置；本地部署时使用自己的 API 授权。

## 本次开放内容

- `src/`：前端、光学模型、场景与公式定义、镜片预设及前端测试。
- `backend/`：接口、光学求解、AI 工具编排及后端测试。
- `public/`、构建与部署配置、依赖清单和空白 `.env.example`。
- `scripts/` 内的运行与验证脚本，以及使用和模型说明。
- `THIRD_PARTY_NOTICES.md`、`third-party-licenses/` 中已收集的许可原文及元数据索引。

不公开原开发仓库的 Git 历史、真实 `.env`、API 密钥、服务账户、私密对话、浏览器数据、赛事规则 PDF、参赛报告、历史原始验证数据或临时截图。不捆绑 `node_modules`、虚拟环境、`dist` 或容器镜像。源码中的测试和预设属于本次公开内容；报告所引用的历史验证数据另按评审要求提供。

## 许可边界

自有代码与随附自有说明文档采用根目录 [LICENSE](../LICENSE) 中的 MIT 许可。MIT 允许商业使用、修改和再分发，要求保留版权和许可声明，不要求衍生项目必须开源。

第三方依赖、字体、图标、外部参考资料和厂商参数保留各自许可或权利边界，详见 [第三方声明](../THIRD_PARTY_NOTICES.md)。DeepSeek API 服务及模型权重不属于自有开源代码。不得用本项目 MIT 声明替代上游许可。

本次源码快照与文件哈希见 `release-manifest.json`；既有验证结果按其原日期引用，不冒充本次重测结果。
