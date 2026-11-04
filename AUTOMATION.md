# 自动化与发布

中文 | [English](AUTOMATION.en.md)

工作流由 `.github/workflows/` 管理。所有外部 Actions 固定完整提交 SHA；Dependabot 每周提出 npm 与 Actions 更新，维护者按同样的 PR 检查审核。React 与 React DOM 配套更新，防止版本不一致。

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

标签触发测试、干净安装验收、ZIP／tarball 与校验和生成，再由独立任务创建 Draft Release。预发布版本自动标为 prerelease。维护者检查后公开 Release，`release.published` 事件再次验证该标签位于 main 历史并通过全部发布检查，随后用 OIDC 发布已验收的 tarball 到 npm；稳定版使用 `latest`，含预发布后缀的版本使用 `beta`。手动构建演练和草稿均不发布 npm。若首次手动发布的版本已存在，只有 npm 的 SHA-512 integrity 与验收 tarball 完全相同才跳过发布；版本相同但内容不同会报错，必须发布新版本。查询兼容 npm 返回的字符串与单元素数组，并拒绝缺失或多条校验值。

ZIP 用户解压后按附带的 `INSTALL.txt` 运行 `npm ci --omit=dev`，再由 Harness 插件管理器安装解压目录。npm tarball 可用 npm 安装；它不包含锁文件。正式包为公开的 `@yunlai/dsh-workbench`，兼容要求由 `engines.dsh` 声明。

## 首次 npm 发布与可信发布配置

首次发布需要在维护者终端使用 `yunlai` 登录 npm，执行已验收 tarball 的 `npm publish ./dist/dsh-workbench-1.0.0.tgz --access public --registry=https://registry.npmjs.org`（后续版本替换文件名）；浏览器登录或 2FA 由维护者完成。包创建后，在 npm 的 Trusted Publisher 设置选择 GitHub Actions，填写 owner `Chengyunlai`、repository `dsh-workbench`、workflow `release.yml`，允许 `npm publish`。此后通过公开 GitHub Release 发布，无需保存长期 npm token。设置方法见 [npm 官方文档](https://docs.npmjs.com/trusted-publishers/)。
