# 升级开发工作台

## 变更

插件包由 `@local/dsh-git-control`（过渡名称 `@local/dsh-workbench`）更名为 `@yunlai/dsh-workbench`，bundle 生成的条目由 `git-control` 更名为 `workbench`。旧版配置需要更新包引用；右侧面板与布局偏好沿用旧内部键，不需要清空用户数据。

## 迁移

1. 更新插件本地目录中的代码及依赖：`npm ci --omit=dev`。目录本身无需改名。

2. 在当前 Harness profile 的 `package.json` 中，将 dependencies 的包名键与 `dsh.profile.bundles` 中的 `@local/dsh-git-control` 或 `@local/dsh-workbench` 改成 `@yunlai/dsh-workbench`；保留对应的 `link:` 路径。运行 profile 的依赖安装以更新锁文件和链接。

3. 若手工注册过 Cordis 条目，将 `name` 改成 `@yunlai/dsh-workbench`；针对旧 `git-control` 的条目覆盖改为 `workbench`，保留原 `config`。已通过 bundle 注册时不要再手工插入第二个条目。

4. 重载 Harness，确认插件详情完整名称为 `@yunlai/dsh-workbench`，且只出现一个“开发工作台”。原有面板布局和偏好仍可恢复。

## 切换到在线安装

曾通过本地目录、`link:` 或 Git 地址安装的用户，需要先在 Harness 插件管理器移除旧安装引用，再通过 `@yunlai/dsh-workbench` 安装 npm 包。首次 npm 发布前此安装方式不可用。不要同时启用本地版与 npm 版；无需删除布局偏好或本地项目。之后在插件详情选择更新版本，按提示重载或重启。预览版显式使用 `@yunlai/dsh-workbench@beta`。
