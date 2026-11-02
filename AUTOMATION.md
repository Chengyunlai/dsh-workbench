# 自动化与发布

中文 | [English](AUTOMATION.en.md)

工作流由 `.github/workflows/` 管理。所有外部 Actions 固定完整提交 SHA；Dependabot 每周提出 npm 与 Actions 更新，维护者按同样的 PR 检查审核。

## 每个 PR 与 main

`CI` 在 Ubuntu 24.04 和 macOS 15、Node.js 24 上执行 `npm ci` 与 `npm run verify`。Linux 同时运行固定版本 actionlint 检查工作流语义。独立的安装包任务执行构建与 `npm run test:package`，生成 ZIP、npm tarball 和 SHA256SUMS，供 Actions 下载并保留七天。

默认测试的单个用例上限为五分钟；子进程夹具按宽限期从 SIGTERM 升级到 SIGKILL，并等待输出流关闭。默认测试覆盖真实 Git、捆绑的 JS／TS 与 Python 导航、模拟 DAP 和客户端 DOM。仓库检查验证翻译键与占位符、文档本地链接、中英文段落对齐，以及构建后的 `client.js` 未发生未提交漂移。安装包在隔离目录中验证 Host 导入、客户端注册、必需资源与安装后的编译器跳转；ZIP 额外包含锁文件并执行 `npm ci --omit=dev` 验收。

main 要求汇总检查 `CI` 成功；它只有在全部基础与安装包任务通过时才成功。工作流不按文档路径跳过这一必需检查。Windows 尚未列为已验证平台；JSDOM 测试通过不代表桌面原生行为已验收。

## 真实工具集成测试

`Integration` 在相关语言服务／调试器文件的 PR、手动触发、每周一上海时间 03:20，以及发布验证时运行。它独立于每个 PR 的基础 CI；普通文档与界面改动不需要下载整套工具。

工具版本固定为 Go 1.24.5、gopls 0.20.0、Delve 1.25.2、Java 21.0.8+9、JDT LS 1.50.0、debugpy 1.8.22 和 js-debug 1.140.0。JDT LS 与 js-debug 下载校验 SHA-256；工具与本机配置写入被忽略的 `.tools/ci` 和 `.tools/*.json`。

本地需要 Python 3.12、Go 和 Java 21 的 `JAVA_HOME`；可用 `DSH_CI_PYTHON` 与 `DSH_DEBUG_GO` 显式指定命令。脚本会在本地 `.tools` 安装工具并更新插件的本机语言服务／适配器配置：

```sh
npm run setup:ci-tools
npm run test:languages
npm run test:debug
```

集成测试启动临时项目与专用进程，验证真实定义跳转、启动／接入、断点、单步、变量和求值。无需模型 API Key，不调用用户项目。

## 版本发布

手动运行 `Release` 是构建演练：执行基础与真实集成测试，上传安装资产并保留三十天，不创建 Release。维护者首次发布前可用这一入口验收。

正式发布时，先通过 PR 更新 `package.json`、锁文件版本和变更说明，合并到 main。给该提交创建与包版本完全相同的 `v<version>` 标签并推送，例如包版本 `1.0.0` 对应 `v1.0.0`。发布检查拒绝版本不符或不在 main 历史中的标签。

标签触发测试、干净安装验收、ZIP／tarball 与校验和生成，再由独立任务创建 Draft Release。预发布版本自动标为 prerelease。维护者检查安装、兼容说明和资产后手动发布；工作流不自动公开 Draft，也不覆盖已存在的 Release。

ZIP 用户解压后按附带的 `INSTALL.txt` 运行 `npm ci --omit=dev`，再由 Harness 插件管理器安装解压目录。npm tarball 可用 npm 安装；它不包含锁文件。当前包保持 `private: true` 与既有安装标识，不执行 npm registry 发布。
