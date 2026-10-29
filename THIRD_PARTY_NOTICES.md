# 第三方资源声明

项目采用的 MIT 许可仅覆盖有权授权的自有部分。第三方依赖、图标、字体、资料和服务保留各自许可。

## 主要依赖

| 资源 | 项目所用版本 | 许可与处理 |
| --- | --- | --- |
| React / React DOM | 19.3.0 | MIT，保留原版权和许可 |
| Three.js | 0.174.0 | MIT，保留原版权和许可 |
| FastAPI / Uvicorn | 0.116.1 / 0.35.0 | MIT / BSD-3-Clause |
| Pydantic / HTTPX | 2.11.7 / 0.28.1 | MIT / BSD-3-Clause |
| NumPy / SciPy | 2.3.1 / 1.16.0 | BSD 类许可及各自随附组件声明 |
| Lucide React | 0.468.0 | ISC 及所附 Feather 图标 MIT 声明 |
| KaTeX | 0.19.0 | MIT；随附字体按原许可文件处理 |
| certifi | requirements.txt 中 >=2026.10.19 | MPL-2.0；原核查机器版本为 2025.7.14，许可副本和元数据仅代表该核查版本 |

完整锁定版本以 package-lock.json 和 requirements.txt 为准；上表只作导航，第三方授权以原许可文本为准。`third-party-licenses/inventory.json` 记录原核查的 npm 锁文件条目和本机 Python 包；并非线上环境证明。npm 中的可选平台条目不等于均已安装。未在本机安装的平台包和后续安装的新版本，应保留其分发包自带许可；本目录不宣称涵盖所有未来安装产物。

`third-party-licenses/` 随附已收集的许可原文。源码包不捆绑 node_modules、Python 环境、编译后 JavaScript 或容器镜像。若自行分发构建产物或镜像，应根据实际组件保留版权、许可和必要的源码获取说明；certifi 的许可不改变本项目其他独立代码的许可。

## 模型服务和参考资料

- DeepSeek：运行时调用外部 API，使用者自行取得服务账户和调用授权；本项目不分发其模型权重。https://api-docs.deepseek.com/
- OpenStax 和 MIT OCW：作为光学公式和教学参考来源，源码包不复制教材原文或图片；按各资料自己的许可使用。https://openstax.org/books/university-physics-volume-3/pages/preface ；https://ocw.mit.edu/pages/privacy-and-terms-of-use/
- SCHOTT N-BK7：源码采用的折射率与 Sellmeier 系数已在原资源核查中登记；外部参数来源不转为团队自有授权，不随源码包分发厂商原 PDF。数据来源：https://media.schott.com/api/public/content/41e799d0bf874807a0bb8e702fbb75b5?v=54856406

本声明不将科学公式、外链、数据参数和软件代码视作同一种授权对象。
