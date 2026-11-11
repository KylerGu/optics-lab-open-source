# 光学智研

面向本科光学学习与实验探究的交互式仿真平台。你可以调整参数观察现象、自由搭建三维光路，也可以用自然语言让 AI 帮助解释原理、组织参数比较和设计实验。

**[在线体验](https://optics-lab-elvy.onrender.com/) · [下载源码](https://github.com/KylerGu/optics-lab-open-source/archive/refs/heads/codex/publish.zip) · [MIT 许可证](LICENSE)**

## 可以做什么

| 功能 | 使用方式 |
| --- | --- |
| 仿真场景 | 在成像、高斯光束、干涉、衍射、偏振、光纤等场景中调整参数，观察图示和计算结果 |
| 公式查询 | 查看光学公式及参数含义，结合场景理解计算条件 |
| 三维光路搭建 | 添加光源、透镜、反射镜、分光镜和观察屏等器件，调整位置与朝向，查看光路和读数 |
| AI 辅助探究 | 提出问题，让助手调用光学计算、比较参数，或委托搭建助手生成装置 |
| 保存与导出 | 保存装置和探究记录，导出参数、计算结果及 CSV/JSON 数据 |

AI 负责理解问题、安排操作和解释结果，定量结果由光学计算程序给出。你可以随时手动调整条件，再继续提问或比较。

## 先体验一个例子

打开[在线演示](https://optics-lab-elvy.onrender.com/)，进入显微镜相关场景：

1. 查看当前波长、数值孔径和成像参数。
2. 向场景助手提问：“增大物镜数值孔径后，分辨能力和景深怎样变化？”
3. 修改数值孔径，比较两次计算结果，并结合图示查看变化。

也可以进入“实验探究”，提出一个任务：

> 用 12 mW 光源搭建双路分光装置，比较五档透过率，找出透射路功率不少于 7 mW、反射路不少于 3 mW 的设置。

查看助手生成的装置和计算记录后，可以继续修改参数，或导出结果。

## 在自己的电脑上运行

建议准备 **Node.js 22** 和 **Python 3.13**。下载源码 ZIP 并解压，或使用 Git：

```bash
git clone https://github.com/KylerGu/optics-lab-open-source.git
cd optics-lab-open-source
```

以下命令均在项目根目录执行。

### Windows PowerShell

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
npm ci
$env:OPTICS_PYTHON = (Resolve-Path .\.venv\Scripts\python.exe).Path
npm run dev
```

### macOS / Linux

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
npm ci
OPTICS_PYTHON="$PWD/.venv/bin/python" npm run dev
```

打开 **http://127.0.0.1:5173**。启动命令会同时运行前端页面和 Python 后端；保持终端开启，按 Ctrl+C 停止服务。

**不配置 AI 接口，也可以使用本地仿真和光学计算。** 若要使用助手，在页面右上角打开「模型设置」，选择 DeepSeek 模型并填写自己的 API Key。

## 配置 AI 助手

助手目前只连接 DeepSeek 官方接口 `https://api.deepseek.com`。可选模型为 `deepseek-flash` 和 `deepseek-v4-pro`。

1. 打开网站，点击「模型设置」。
2. 选择模型和思考强度，粘贴你在 DeepSeek 申请的 API Key。
3. 保存。密钥写在当前浏览器的 localStorage 中；如果勾选「只在本次标签页保留」，则写入 sessionStorage，关闭标签页后消失。
4. 界面平时只显示密钥末四位。需要停用时，在同一对话框里点「清除密钥」。

密钥随每次助手请求放在请求头里，不放进页面提交的 JSON。服务器用它转发到 DeepSeek，不写入磁盘、日志或调试记录。场景助教（含高斯光束自由传播）、光路搭建和实验探究共用这一份设置。高斯光束页面的助手入口不变，但和其余仿真场景一样走场景助教；调光斑、比较参数和读数仍由原来的高斯光束计算完成。没有填写密钥时，这些助手都会提示打开「模型设置」。

公开网站不要把作者自己的密钥配给访客。默认情况下，即使服务器环境变量里有 `AI_API_KEY`，网站也不会用它回答访客。

自己的电脑或私有部署如果仍希望由服务器统一提供密钥，把 `.env.example` 复制为 `.env`，设置：

```dotenv
AI_ALLOW_SERVER_KEY=1
AI_BASE_URL=https://api.deepseek.com
AI_MODEL=deepseek-flash
AI_API_KEY=你的API密钥
```

然后重新启动服务。只有浏览器里没有个人密钥时，才会使用这份服务器密钥。浏览器里保存了个人密钥时，仍然用个人密钥。不要把 `.env` 提交到 Git。

高级参数说明见 [配置示例](.env.example)。

## 保存实验

装置和探究记录保存在当前浏览器中。需要换电脑、换浏览器或备份时，请先导出文件；清除浏览器数据前也应完成备份。

支持迁移的场景可通过“复制到光路搭建”生成三维器件和参数。进入搭建页后，可以继续调整装置；计算记录保留生成时的条件，便于比较前后结果。

## 构建完整服务

先构建前端：

```bash
npm run build
```

再启动同时提供网页和后端接口的服务。

Windows：

```powershell
.\.venv\Scripts\python.exe -m backend.web
```

macOS / Linux：

```bash
.venv/bin/python -m backend.web
```

打开 **http://127.0.0.1:10000**。部署时可使用仓库中的 [Dockerfile](Dockerfile) 和 [Render 配置](render.yaml)。公开站点保持 `AI_ALLOW_SERVER_KEY` 为关闭，并设置 `APP_ENV=production`（镜像和 `render.yaml` 已写好），从而关闭调试记录和接口文档。助手密钥仍由访问者在「模型设置」中填写。

## 开发与扩展

前端采用 React、TypeScript 和 Three.js，后端采用 Python、FastAPI、NumPy 和 SciPy。

| 目录 | 内容 |
| --- | --- |
| `src/` | 页面、交互、三维显示及前端测试 |
| `backend/` | 光学计算、模型接口、助手工具及后端测试 |
| `scripts/` | 启动和验证脚本 |
| `docs/` | 模型说明、功能文档及验证记录 |

扩展光学模型时，建议同时定义输入参数、单位、适用条件和输出结果，并补充参考案例及测试。

前端检查和构建：

```bash
npm test
npm run build
```

后端检查（使用已安装依赖的虚拟环境）：

```powershell
# Windows
.\.venv\Scripts\python.exe -m unittest discover -s backend/tests -v
```

```bash
# macOS / Linux
.venv/bin/python -m unittest discover -s backend/tests -v
```

部分带 `--live` 参数的验证脚本会调用真实模型接口，运行前请查看脚本说明。

## 模型范围

各场景基于相应的理想化光学模型。使用时请结合页面中的参数范围、适用条件和警告理解结果；几何光线、波动光学和高斯光束的读数具有不同物理含义。

AI 的解释应结合计算记录核对。用于真实实验或工程设计时，还需考虑器件误差、环境条件和实测校准。

## 常见问题

**页面能打开，但 AI 没有回应？**  
打开「模型设置」，确认 DeepSeek 密钥、模型和账户额度。私有部署若开启了 `AI_ALLOW_SERVER_KEY=1`，再检查 `.env` 后重启服务。

**启动时提示端口被占用？**  
开发模式使用 5173 和 8000 端口，请关闭此前启动的服务后重试。

**换浏览器后找不到装置？**  
记录按浏览器和网站地址分别保存。请在原浏览器中导出，再在新环境导入。

## 反馈与许可证

欢迎通过 [Issues](https://github.com/KylerGu/optics-lab-open-source/issues) 报告问题或提出建议。请附上使用场景、复现步骤、参数和预期结果；截图或日志中请去掉密钥及个人信息。

项目自有代码和文档采用 [MIT 许可证](LICENSE)。第三方组件遵循各自许可证，详见 [第三方声明](THIRD_PARTY_NOTICES.md)；发布内容见 [开放范围](docs/open-source-release.md)。
