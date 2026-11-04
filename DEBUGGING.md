# 调试配置

[English](DEBUGGING.en.md) | 中文

开发工作台内的调试支持本机 Python、Go 和 Node.js（JavaScript／TypeScript）；代码阅读与 Git 操作仍只读。调试启动的程序会正常执行，可能写文件、访问网络或连接数据库，因此需使用你准备好的开发配置。

## 安装调试器

Python 使用 [debugpy](https://github.com/microsoft/debugpy)，Go 使用 [Delve](https://github.com/go-delve/delve)，JS／TS 使用 [vscode-js-debug 的 standalone DAP 发行包](https://github.com/microsoft/vscode-js-debug/releases)。适配器文件和机器路径不包含在插件包中；Python 需选择已安装 debugpy 的解释器，Go 需可访问兼容的工具链；TS 需先生成 JS 及 source map，插件不执行构建任务。

```sh
npm run setup:debuggers -- \
  --python /absolute/path/to/venv/bin/python \
  --dlv /absolute/path/to/dlv \
  --js-debug /absolute/path/to/js-debug/src/dapDebugServer.js
```

可以只传其中一种。命令验证文件并保存启动参数到 `.tools/debug-adapters.json`；不会改变全局环境，Python 虚拟环境路径会原样保留。重载插件后生效。把 standalone js-debug 解压到 ESM 项目内时，需要在其根目录添加 `package.json`，内容为 `{"private":true,"type":"commonjs"}`，避免上级项目把 CJS 适配器当成 ESM。

也可在插件设置中提供 `debugAdapters.python`、`.go`、`.javascript`，每项包括 `command`、`args`、`env`、`transport`（`stdio` 或 `tcp`）。TCP 适配器应绑定 `127.0.0.1:0`，在 stdout 公告 `127.0.0.1:<端口>`；插件连接该动态端口。启动命令通过受管子进程执行，不经过 shell。显式插件配置优先；`useInstalledDebugAdapters: false` 禁用本机设置文件。`debugTimeoutMs` 默认 30000，`debugOutputChars` 默认 65536；较大的 Go 项目可增加等待时间。

## 直接调试当前文件

没有启动配置时，在源码区按 F5 即调试当前文件，无需创建 `.dsh/debug.json`：Python 运行该脚本，优先使用工作区 `.venv` 解释器，否则使用适配器的解释器；Go 编译当前文件所在包，`_test.go` 使用测试模式；JS／MJS／CJS 使用宿主 Node 运行当前文件。运行目录默认为工作区根目录。

TS／MTS／CTS 需先生成 JS 和 source map。插件识别同目录输出，或最近 `tsconfig.json` 中同时明确设置的 `rootDir` 与 `outDir`；不自动解析继承配置、执行构建或安装依赖。复杂构建路径、启动参数、环境变量、其他 Python 环境和不同运行目录可使用下面的项目配置。已有启动配置优先于当前文件；配置错误会显示，不会被自动推断掩盖。

右键选择“接入已有进程”：没有接入配置时，弹窗选择语言并填写本机调试端口，Go 也可选择进程 ID。Enter 接入，Esc 取消；不会扫描或自行接入其他程序。端口必须已由目标调试器监听，填写普通服务端口或当前进程 ID 不会自动启用调试器。

## 自定义项目配置

需要自定义启动或接入参数时，在已注册的工作区创建可选的 `.dsh/debug.json`。文件支持 JSON 注释；每个配置包含唯一的 `name`、`language`、`request` 和适配器的 `arguments`。语言为 `python`、`go`、`javascript` 或 `typescript`，请求为 `launch` 或 `attach`。只有 `${workspaceFolder}` 会被替换；不执行命令变量、任务、自动构建或配置脚本。

```json
{
  "configurations": [
    {
      "name": "Python 启动", "language": "python", "request": "launch",
      "arguments": { "program": "${workspaceFolder}/main.py", "cwd": "${workspaceFolder}" }
    },
    {
      "name": "Python 接入", "language": "python", "request": "attach",
      "arguments": { "connect": { "host": "127.0.0.1", "port": 5678 } }
    },
    {
      "name": "Go 启动", "language": "go", "request": "launch",
      "arguments": { "mode": "debug", "program": "${workspaceFolder}", "cwd": "${workspaceFolder}" }
    },
    {
      "name": "Go 接入", "language": "go", "request": "attach",
      "arguments": { "mode": "local", "processId": 12345 }
    },
    {
      "name": "Node 启动", "language": "javascript", "request": "launch",
      "arguments": { "type": "pwa-node", "program": "${workspaceFolder}/main.js", "cwd": "${workspaceFolder}" }
    },
    {
      "name": "Node 接入", "language": "javascript", "request": "attach",
      "arguments": { "type": "pwa-node", "address": "127.0.0.1", "port": 9229 }
    },
    {
      "name": "TS 启动", "language": "typescript", "request": "launch",
      "arguments": { "type": "pwa-node", "program": "${workspaceFolder}/dist/main.js", "cwd": "${workspaceFolder}", "sourceMaps": true, "outFiles": ["${workspaceFolder}/dist/**/*.js"] }
    }
  ]
}
```

Python 接入端口由目标程序的 `debugpy.listen()` 或 `python -m debugpy --listen 127.0.0.1:5678 ...` 提供；Node 接入端口由 `node --inspect=127.0.0.1:9229 ...` 提供。Go 的本机 PID 接入受系统调试权限限制；也支持接入现有 Delve DAP 服务，配置 `mode: "remote"` 与 `connect: { "host": "127.0.0.1", "port": ... }`。Python／Go 的直接 DAP 接入仅允许本机回环地址；Go 服务需按 Delve 文档配置多客户端模式才能在客户端断开后继续保留。JS／TS 通过 js-debug 接入 Node inspector，不是把 inspector 端口当作 DAP 端口。

TS 启动默认先暂停在入口，等待原始源码映射可用；按 F5 继续后可命中 `.ts` 断点并在原始 TS 中单步。`stopOnEntry` 可在配置中显式指定。断点行必须存在于当前工作区源码中，空行或不能执行的行是否能绑定由适配器报告。

## 交互与进程归属

打开源码后，调试区顶部显示操作条，按运行控制（启动／继续、结束、暂停）、单步控制（跳过、进入、跳出）与进程接入分组。单步跳过使用跨越调用的折线箭头，执行当前行而不进入被调用函数；单步进入使用向下箭头，进入被调用函数；跳出使用向上箭头，执行完当前函数后回到调用者。语义参照 [JetBrains 单步说明](https://www.jetbrains.com/help/idea/stepping-through-the-program.html)。图标悬停提示操作名称、快捷键与单步含义；当前状态不可执行的操作置灰。未启动或结束后保留操作条，程序输出保留到再次启动；窄栏下操作分组换行。正常结束时显示“已结束”，与结束竞态的单步请求会同步结束状态。

源码行号左侧点击设置／取消断点，也可用 F9；空心圆表示尚未验证，实心圆表示适配器已确认，箭头和整行底色标记当前执行行。F5 启动或继续，F8 单步跳过，F7 进入，Shift＋F8 跳出，Alt＋F5 暂停，Shift＋F5 结束。源码右键菜单提供同样操作，并提供“接入已有进程”；多个匹配配置通过选择菜单确定。

调试面板默认停靠右侧，可在标题栏的“停靠”选择器切换到底部；位置保存在当前客户端的浏览器存储中，重新打开后恢复。底部布局将调用栈、变量和输出并排显示，窄栏下自动换行。切换位置保留源码光标与滚动、所选栈帧和变量展开状态，不发送调试执行请求。

暂停后显示调用栈、变量与输出，各区有独立标题。调用栈为单行选中列表：单击或上下键切换栈帧，同步预览源码与该帧变量；Home／End 到首尾，Enter／F4 或双击把焦点移到源码。执行箭头始终标记实际栈顶，选择其他帧只改变阅读位置，不移动程序执行点；列表下方显示文件名和行号，“完整路径”可展开查看并复制路径。变量名、类型和值分列显示，字符串、数字与常量沿用宿主代码配色；首个变量作用域自动展开，子变量按需读取。

调用栈与变量区获得焦点时，同样支持 F5／F7／F8／Shift＋F8／Alt＋F5／Shift＋F5；调用栈右键或 Shift＋F10 提供阅读源码、继续、单步、暂停与结束操作。输出和状态刷新保留所选帧与变量展开状态；下一次暂停重新选择实际执行帧。切换帧或继续运行后，迟到的变量响应不会覆盖新选择。工作区外的帧可选中查看变量，但不读取外部源码。

暂停时，选中栈帧对应文件的函数内、执行位置及之前的变量行尾会显示 `名称: 类型 = 值`；这些是当前暂停时的值，不是各行执行时的历史值。提示只读取非昂贵作用域的变量，不执行表达式；适配器未提供类型时只显示值。切换栈帧、继续运行或更换文件会清除旧提示。悬浮框可移入、展开和复制，点击外部或按 Esc 关闭。

### 悬浮查看变量

程序暂停后，将鼠标停在源码变量或点分成员上（如 `path`、`args.config`），即可查看所选调用栈帧中的值和类型；对象可展开读取子项，长值可选择复制。也可在变量处按 Shift＋F10，选择“查看变量值”；Esc 关闭弹层。切换文件、栈帧、单步、继续运行或结束时关闭旧弹层，取消等待中的查询。

悬浮通过适配器的 scopes／variables 请求查找变量，不发送 evaluate 请求；跳过标记为昂贵的作用域。函数调用、下标表达式及适配器未暴露的成员请使用“计算表达式”。每次查询跨作用域与成员层级共读取最多 `debugInspectMaxVariables` 个变量，默认 1000，可在插件配置中设为 1–10000；达到上限时显示提示。值和类型由调试适配器提供。

### 清理断点与表达式求值

调试工具栏的垃圾桶图标和源码右键菜单提供“清理全部断点”。尚未启动时清理面板内全部文件的断点；活动会话中同时向全部已连接适配器发送清除请求，确认后移除标记。失败会显示断点状态未确认，保留本地标记以便重新应用。

程序暂停后，选中调用栈帧，点击工具栏计算器图标、右键“计算表达式”，或按 Alt＋F8。源码中选中的文本会预填到表达式输入区；Enter 或“计算表达式”按钮提交，Shift＋Enter 换行，Esc 关闭。结果显示类型和值，对象可展开查看子项。切换栈帧或进入新一次暂停会清除旧结果；恢复运行或结束会话会关闭求值窗口。

求值使用适配器的 [DAP evaluate](https://microsoft.github.io/debug-adapter-protocol/specification#Requests_Evaluate)，仅在当前暂停帧内执行，Python、Go、JS/TS 的可用表达式由相应适配器决定，TS 使用运行时值。输入和选中文本不会自动求值；显式提交可能调用函数、修改变量或执行其它副作用。失败、超时或暂停状态变化不能保证表达式未执行，界面会报告且不自动重试，关闭窗口不会撤销已经提交的求值。表达式最长 8192 个字符；对象子项每次最多读取 100 个。

每个工作区仅允许一个活动调试会话；源码区保持只读，未提供条件断点、测试选择器、浏览器调试或子进程自动接入。断点在当前面板内存中保存，关闭重开后需重新设置。

`launch` 会话拥有插件创建的程序，结束或卸载插件时请求终止程序并等待受管进程退出；`attach` 会话结束时发送 `terminateDebuggee: false`，保留已有程序。关闭调试面板或切换会话不等于结束调试，回到工作区会发现其活动会话。退出插件前应显式结束会话；程序断开和终止的行为还受适配器及操作系统权限影响，失败会显示在调试区。

## 验证

`npm test` 覆盖断点与快捷键、主题、导航、输入校验、调试进程归属和重复启动。配置真实适配器后运行 `npm run test:debug` 验证真实程序；若 Go 不在 PATH，可设置 `DSH_DEBUG_GO=/absolute/path/to/go`。测试在临时工作区启动专用小程序，不运行当前项目。`test/debug.e2e.mjs` 与 `test/debug-hover.e2e.mjs` 属于手动环境测试，不混入不依赖外部调试器的默认套件。单独验证 Python 悬浮可运行 `DSH_HOVER_PYTHON=/absolute/path/to/python node --test test/debug-hover.e2e.mjs`。
