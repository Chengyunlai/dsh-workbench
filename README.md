<p align="center"><img src="icon.svg" width="52" height="52" alt="dsh-workbench" /></p>

<h1 align="center">dsh-workbench</h1>

<p align="center"><strong>对话留在中间，代码就在手边。</strong><br />DeepSeek Harness 右侧的开发工作台，用来读源码、核对改动、调试程序和整理讲解。</p>

<p align="center"><a href="https://www.npmjs.com/package/@yunlai/dsh-workbench"><img src="https://img.shields.io/npm/v/@yunlai/dsh-workbench" alt="npm version" /></a> <a href="https://github.com/Chengyunlai/dsh-workbench/actions/workflows/ci.yml"><img src="https://github.com/Chengyunlai/dsh-workbench/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI" /></a> <a href="LICENSE"><img src="https://raw.githubusercontent.com/Chengyunlai/dsh-workbench/demo-assets/readme/2026-11-03-v1/badge-license.svg" alt="MIT license" /></a> <a href="https://github.com/deepseek-ai/deepseek-harness"><img src="https://raw.githubusercontent.com/Chengyunlai/dsh-workbench/demo-assets/readme/2026-11-03-v1/badge-harness.svg" alt="DeepSeek Harness community plugin" /></a></p>

<p align="center">中文 · <a href="README.en.md">English</a>　|　<a href="#快速开始">安装</a> · <a href="#工作台能做什么">功能</a> · <a href="#能力演示">演示</a> · <a href="https://github.com/Chengyunlai/dsh-workbench/releases/latest">最新发布</a></p>

![对话与开发工作台的概念插画](https://raw.githubusercontent.com/Chengyunlai/dsh-workbench/demo-assets/readme/2026-11-03-v1/cover.png)

AI 改完代码后，先在右侧打开 diff，从改动行跳回源码，再沿定义读到实现。遇到需要弄懂的代码，可以把问题交给一个讲解会话，随后在工作台翻阅卡片。文件树、编辑器和底部工具窗口可以调整大小，当前对话始终留在旁边。

## 快速开始

1. 在 DeepSeek Harness 的插件管理器选择「安装插件」，输入 `@yunlai/dsh-workbench`，启用「开发工作台」。
2. 打开一个已注册的 Git 项目对话，展开右侧工具区，在「开始」或「更多工具」中选择「开发工作台」。
3. 从文件树打开文件。在支持的源码中按 `F12` 跳定义，或从底部打开「变更」核对 diff。

在线安装用户可在插件详情检查版本并更新，随后重载或重启 Harness。当前发布包要求 Harness `0.2.1-rc.5` 或更新版本，运行环境要求 Node.js `22.14.0` 或更新版本。[下载 ZIP](https://github.com/Chengyunlai/dsh-workbench/releases/latest) · [升级说明](UPGRADING.md)

<details>
<summary>从 ZIP 或源码目录安装</summary>

下载 Release 中的 ZIP 并解压，按包内 `INSTALL.txt` 安装依赖，再在 Harness 插件管理器中选择解压后的目录。也可以克隆仓库并安装源码目录。

```sh
git clone https://github.com/Chengyunlai/dsh-workbench.git
cd dsh-workbench
npm ci --omit=dev
```

</details>

## 工作台能做什么

| 想做的事 | 在工作台里怎么做 |
| --- | --- |
| **读懂源码** | 用文件树和内容查找定位代码。标签保留各文件的阅读位置，支持语法高亮、折叠、同词高亮、定义跳转和前进／后退。右键标签可关闭当前、其他或全部文件。 |
| **看清 Python 类关系** | 从文件树工具栏或 Python 源码右键菜单打开层级树或分栏图。查看继承、抽象类、显式 Protocol 基类及有源码依据的工厂返回关联，点击节点或方法跳回源码。类关系目前仅支持 Python，处于 Beta 阶段。 |
| **阅读文档和图片** | 对话中的 Markdown 可进入工作台预览，也可切回源码。预览支持 YAML 标题、标签和字段、代码块高亮与文件链接。文件标签还可预览 PNG、SVG、ICNS 等图片和图标。 |
| **核对 Git 改动** | 分组查看已暂存、工作区变更和未跟踪文件，阅读逐行 diff、提交图与提交详情。双击 diff 行可跳到当前源码。可把选中的 diff 行作为修改任务或讲解材料交给新会话。 |
| **检查真实执行** | 启动调试或接入已有进程，设置断点、单步并切换栈帧。暂停时可悬浮查看变量、展开对象、查看行内值及求值，也可一次清理全部断点。 |
| **运行项目命令** | 从底部打开终端，复用 Harness 终端服务在当前会话的工作区运行命令。切换到查找、变更、历史、记忆卡片或调试时，编辑区仍可见。 |

Python 类图基于静态源码分析。定义跳转可打开语言服务返回的受支持库源码和声明文件，显示为只读库标签。[类关系说明](USAGE.md#python-类关系图) · [导航限制](USAGE.md#导航行为与限制)

## 讲给我听与记忆卡片

例如读到一个 `stream()` 方法，想知道 SSE 字节在哪里分帧、何时变成模型事件。右键文件选「讲给我听」，输入问题。新会话会尝试沿源码和具体输入讲清链路，把同一份完整解释保存成一张卡。卡片先概括问题，末尾用一道回忆题请你复述机制或预测边界情况。

底部「记忆卡片」按归档目录分组，可组合搜索标题、摘要、标签、来源与路径。卡片是项目中的 Markdown 文件，默认存放在 `.dsh/cards/`。关联文件的卡片按源码最近两级目录归档，未关联源码的归入 `general/`，已有卡片也可按来源在索引里归组。[卡片使用指南](USAGE.md#记忆卡片)

![记忆卡片的 YAML 元数据、问题概括、示例与回忆题](screenshots/readme-v1.4.1/memory-card-preview.png)

<details>
<summary>查看卡片分组索引</summary>

![记忆卡片按通用和 src/transport 分组，可搜索问题、标签与来源](screenshots/readme-v1.4.1/memory-card-index.png)

</details>

## 能力演示

下方录制使用虚构项目。点击截图可查看对应 GIF。

<table><tr><td width="33%" align="center"><a href="https://raw.githubusercontent.com/Chengyunlai/dsh-workbench/demo-assets/demos/2026-11-02-c0f7910/code-navigation.gif"><img src="https://raw.githubusercontent.com/Chengyunlai/dsh-workbench/demo-assets/readme/2026-11-03-v1/read-code.png" alt="代码与文档阅读" /></a><br /><strong>代码与文档阅读</strong></td><td width="33%" align="center"><a href="https://raw.githubusercontent.com/Chengyunlai/dsh-workbench/demo-assets/demos/2026-11-02-c0f7910/git-inspection.gif"><img src="https://raw.githubusercontent.com/Chengyunlai/dsh-workbench/demo-assets/readme/2026-11-03-v1/review-changes.png" alt="Git 差异与历史" /></a><br /><strong>Git 差异与历史</strong></td><td width="33%" align="center"><a href="https://raw.githubusercontent.com/Chengyunlai/dsh-workbench/demo-assets/demos/2026-11-02-c0f7910/debugger-evaluate.gif"><img src="https://raw.githubusercontent.com/Chengyunlai/dsh-workbench/demo-assets/readme/2026-11-03-v1/debug-program.png" alt="断点与表达式求值" /></a><br /><strong>断点与表达式求值</strong></td></tr></table>

### Python 类关系

![Python 源码和右侧类关系图，显示 EventReader 的两个实现](screenshots/readme-v1.4.1/python-class-diagram.png)

<details>
<summary>查看同一组类的层级树</summary>

![Python 源码和右侧层级树，按基类展开实现与方法](screenshots/readme-v1.4.1/python-class-hierarchy.png)

</details>

### 暂停后悬浮查看变量

![Python 断点暂停、悬浮变量和单步](https://raw.githubusercontent.com/Chengyunlai/dsh-workbench/demo-assets/demos/2026-11-04-dc2b2e3/debug-hover.gif)

<details>
<summary>更多演示与录制说明</summary>

[代码折叠和标签恢复](https://raw.githubusercontent.com/Chengyunlai/dsh-workbench/demo-assets/demos/2026-11-03-beecb54/code-folding.gif) · [调试悬浮录制说明](https://github.com/Chengyunlai/dsh-workbench/blob/demo-assets/demos/2026-11-04-dc2b2e3/RECORDING.md)

主视觉是概念插画。类关系和记忆卡片截图取自 `1.4.1` 工作台的真实 Harness Web 界面，使用虚构的 Beacon Stream 项目和样例卡片。其他演示来自较早版本的独立实例，GIF 按步骤调整了画面停留时长。

</details>

## 语言支持

下表区分定义跳转与调试。五种语言都可只读浏览、语法高亮和折叠。Go 和 Java 需要配置本机语言服务，Python 和 JS／TS 的导航依赖随包安装。

| 语言 | 定义跳转 | 启动与接入调试 |
| --- | --- | --- |
| Python | Pyright | debugpy |
| Go | gopls | Delve |
| Java | Eclipse JDT LS | 暂无 |
| JavaScript | TypeScript 语言服务 | vscode-js-debug（Node.js） |
| TypeScript | TypeScript 语言服务 | vscode-js-debug（需要生成 JS 和 source map） |

调试适配器需单独配置。配置好后可在源码区设置断点并按 `F5`，或用右键菜单接入已有进程。自定义启动参数可写入 `.dsh/debug.json`。[语言配置](USAGE.md#五种语言的支持与配置) · [调试配置](DEBUGGING.md#安装调试器)

## 使用边界

- 文件阅读、搜索和 Git 检查是只读操作。源码改动交给对话中的 Agent 或你常用的编辑器。
- 终端与调试会执行实际命令或程序。卡片由讲解会话写入项目目录，内容按工作区的权限与 Git 规则管理。
- CI 覆盖 Linux 和 macOS 的基础检查、安装包验收及真实语言服务与调试器测试。桌面交互实测覆盖 macOS，Windows 与 Linux 桌面交互待验证。

## 文档与贡献

| 目的 | 文档 |
| --- | --- |
| 操作、快捷键、语言服务与布局 | [使用指南](USAGE.md) |
| 调试器、启动与接入配置 | [调试指南](DEBUGGING.md) |
| 版本变化与安装迁移 | [升级说明](UPGRADING.md) |
| 报告问题或提交 PR | [贡献指南](CONTRIBUTING.md) · [Issues](https://github.com/Chengyunlai/dsh-workbench/issues) |
| CI、发布与安全报告 | [自动化与发布](AUTOMATION.md) · [安全报告](SECURITY.md) |

项目使用 [MIT](LICENSE) 许可。编辑器使用 CodeMirror，界面图标来自 Lucide，文件图标来自 vscode-icons。[依赖许可声明](THIRD_PARTY_NOTICES.txt)
