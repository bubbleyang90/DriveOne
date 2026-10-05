# DriveOne

一个本地运行、中文界面的多网盘文件资源管理器。第一版把浏览、按文件名搜索、查看详情和下载放在同一个窗口里；远端操作只读。

> 当前是可运行的 MVP，不是已经获得六家网盘授权的成品。OneDrive、Google Drive、Dropbox 的官方 API 与 OAuth/PKCE 适配器已实现，使用合成响应自动化测试；尚未使用真实账号验证。百度、阿里、夸克保留明确的「待官方准入」入口。演示模式完全使用本机生成的假数据，不会连接网盘。

## Windows 快速启动

1. 从 [Node.js 官网](https://nodejs.org/)安装 Node.js 22.12 或更高版本（建议受支持的 LTS）。不需要 WSL，也不需要 Python。
2. 下载或克隆本仓库，在项目目录打开 PowerShell：

   ```powershell
   npm ci --ignore-scripts
   npm start
   ```

3. 在浏览器打开终端显示的地址，默认 **http://127.0.0.1:4318**。地址必须用 `127.0.0.1`，不能替换为电脑 IP 或 `localhost`。
4. 点击「演示模式」即可体验。连接真实网盘前，先完成下方各厂商的应用注册与权限配置。
5. 下载文件默认保存到项目的 `downloads` 目录；界面会显示实际路径。关闭终端或按 Ctrl+C 退出，内存中的授权随之清除。

也可以双击 `start-windows.cmd`。它只启动本地服务，不安装软件、不修改系统设置、不注册开机启动。

macOS / Linux 使用相同的 npm 命令。应用没有运行时第三方依赖，也没有构建步骤；`npm ci` 用于检查锁文件一致性。

## 第一版能做什么

- 六个网盘入口，分别展示未配置、未连接、已连接或待准入状态
- 当前账号文件夹浏览、面包屑、浏览器前进/后退、分页加载
- 在选中网盘内搜索文件名；保留厂商原有分页与匹配语义，不声称全网盘内容索引
- 对当前已加载条目排序，列表/卡片视图，文件元数据侧栏
- 下载队列、字节进度、取消、失败提示，同名文件自动编号，不覆盖已有文件
- Google Docs / Sheets / Slides / Drawings 显式选择支持的导出格式
- 本机合成演示数据，和真实连接状态分开标记

不包含上传、删除、重命名、批量文件夹下载、跨盘搬运、同步、离线持久索引、挂载盘符或 Windows Explorer 插件。每个服务暂支持一个账号，多个服务可同时连接；不同浏览器会话隔离。

## 网盘能力与前提

| 网盘 | 当前实现 | 连接前提 / 限制 |
| --- | --- | --- |
| OneDrive | 官方 Graph 浏览、搜索、下载；OAuth + PKCE | 自己的 Microsoft 公共客户端注册，`Files.Read` 与 `offline_access`；租户可能要求管理员批准 |
| Google Drive | 官方 Drive v3 浏览、文件名搜索、下载/导出；OAuth + PKCE | 自己的 Desktop OAuth Client，启用 Drive API；完整浏览使用受限的 `drive.readonly`，不是 `drive.file`；可能需要应用验证 |
| Dropbox | 官方列表、文件名搜索、下载；OAuth + PKCE | 自己的 Scoped App，选择 Full Dropbox；`files.metadata.read` 与 `files.content.read`；公开发布需符合其生产审核要求 |
| 百度网盘 | 待准入，未实现真实连接 | 需确认官方应用资格、企业/生产准入和授权范围；不使用个人测试凭据冒充生产权限 |
| 阿里云盘 | 待准入，未实现真实连接 | 需通过消费者阿里云盘开发者准入及使用场景审查；不以阿里云 PDS 代替消费者网盘接口 |
| 夸克网盘 | 待准入，未实现真实连接 | 已存在官方网盘 Skill，但尚未验证可用于本独立资源管理器的通用 OAuth/API 准入路径 |

不读取浏览器 Cookie、不使用私有网页接口、不借用第三方 Client ID、不提供绕过审核的方法。演示模式中这六个入口都可浏览同一组合成示例，这不代表六个真实适配器均已可用。

### 配置自己的应用

只在自己的电脑上创建应用和填写配置。不要在 Issue、PR、聊天或截图中发送授权码、Client Secret、访问令牌或刷新令牌。

```powershell
Copy-Item .env.example .env
notepad .env
```

`.env` 已被 Git 忽略。填好后重启服务。服务不会替你创建应用、同意授权、扩大权限或访问真实账号。应用里的「连接」按钮会将浏览器带到对应厂商的官方授权页，是否继续由你决定。

默认回调地址：

- OneDrive：`http://127.0.0.1:4318/oauth/callback/onedrive`
- Google Drive：`http://127.0.0.1:4318/oauth/callback/googledrive`
- Dropbox：`http://127.0.0.1:4318/oauth/callback/dropbox`

如果改变 `PORT`，必须同步调整允许的回调地址。服务只监听 IPv4 回环地址；不要用代理转发或将其暴露到公网。

#### OneDrive

1. 在 [Microsoft 应用注册](https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app)中注册自己控制的应用，根据目标账号选择账户类型
2. 配置适用于桌面/公共客户端的授权码 + PKCE 和上面的回环重定向地址；`127.0.0.1` 回环 URI 在门户中的配置方式可能需要使用应用清单，请参考 [Microsoft 回环 URI 规则](https://learn.microsoft.com/en-us/entra/identity-platform/reply-url)
3. 配置 Microsoft Graph 委托读取权限 `Files.Read`；离线刷新请求 `offline_access`。不创建或填写客户端密钥
4. 设置 `ONEDRIVE_CLIENT_ID`；`ONEDRIVE_TENANT` 默认 `common`，也可用 `consumers`、`organizations` 或自己的租户 UUID
5. 重启后点击连接。账号或组织策略拒绝时，遵循组织审核流程

#### Google Drive

1. 在自己控制的 Google Cloud 项目中启用 Drive API，设置 OAuth consent screen，创建 **Desktop app** 类型 OAuth Client
2. 配置所需测试用户或完成适用的发布审核；DriveOne 请求 `https://www.googleapis.com/auth/drive.readonly`
3. 设置 `GOOGLE_CLIENT_ID`。如果该桌面客户端交换授权码时需要随附 Secret，可仅在本机设置 `GOOGLE_CLIENT_SECRET`；不要创建 Web 客户端来绕过桌面流程
4. 重启后连接。`drive.readonly` 是受限范围；`drive.file` 无法替代全盘浏览。是否需要验证或安全评估由应用部署与数据处理方式决定，不因本项目开源而自动豁免
5. Google 原生文档需要导出；当前仅支持界面列出的格式。CSV 只导出首张工作表；官方 `files.export` 有 10 MB 输出上限。快捷方式、Forms、其他原生类型、Shared Drives 专属导航和组织特殊策略不是本版保证覆盖的范围

#### Dropbox

1. 在 [Dropbox App Console](https://www.dropbox.com/developers/apps)创建自己的 Scoped App
2. 使用 **Full Dropbox**（App Folder 无法浏览整盘），选择 `files.metadata.read` 和 `files.content.read`
3. 注册上面的精确回调地址，把 App key 填入 `DROPBOX_CLIENT_ID`；PKCE 流程不需要 App Secret
4. 重启后连接。开发模式、关联用户数量和生产审批遵循 [Dropbox 开发者指南](https://docs.dropboxapi.com/dropbox-api/docs/developer-resources/developer-guide)
5. 本版使用普通账号文件命名空间；未实现团队成员选择、团队空间的专门根命名空间切换或管理员接口

更多官方端点、搜索语义和保守的下载主机白名单见 [接口来源与接入说明](docs/provider-sources.md)。

## 本地配置与安全

- `PORT`：默认 `4318`
- `DRIVEONE_DOWNLOAD_DIR`：默认项目内 `downloads`；可设为自己有写权限的绝对目录
- `DRIVEONE_MAX_DOWNLOAD_BYTES`：单个下载最大字节数，默认 20 GiB；不是网盘额度

安全边界与已知限制见 [SECURITY.md](SECURITY.md)。重要事项：

- 服务端令牌、PKCE verifier、状态和文件元数据仅在进程内存中；不用 LocalStorage，也不把 token 写入 `.env`、日志或数据库。页面刷新保持当前浏览器会话，退出进程、8 小时会话到期或断开后需要重新授权
- 浏览器历史会记录目录 ID/名称与搜索词，可能由浏览器持久保存；断开不清除浏览器历史。下载文件与其文件名也会留在本机磁盘
- 「断开」清除本机授权和相应待处理请求/下载；**不会撤销厂商账户里的应用授权**。若要彻底移除，去对应厂商账户的授权应用设置撤销
- OAuth Client ID 是配置；可选的 Google Client Secret 若放在 `.env`，由你负责保护该本机文件。应用未提供 OS 密钥库或加密配置存储
- 默认只接受精确回环 Host，检查 Origin 与 CSRF，使用严格 CSP。下载按权威元数据命名，过滤 Windows 保留名，独占创建临时文件，原子提交且不覆盖
- 要使用支持硬链接的可信本地磁盘（Windows 推荐 NTFS）。不支持原子提交的文件系统会安全失败，不能保证 FAT/exFAT、NAS 或网络盘
- 取消/失败会清理当前临时文件。强制杀进程、系统断电可能留下 `.driveone-*.part`，下次不会自动覆盖或删除它们；停止应用后可自行检查清理
- 没有遥测或部署。真实连接时，会向对应官方 API 发送必需的授权/搜索/文件请求；下载文件保存在你配置的本地目录
- 应用不防御已控制同一操作系统用户的恶意进程。请勿在共享公共电脑或不可信下载目录中处理敏感云文件

## 开发和验证

```powershell
npm run verify
```

- `npm run check`：检查全部 JavaScript 语法与 HTML 无内联脚本/事件处理器
- `npm test`：Node 原生测试运行器；OAuth、分页、搜索、导出、下载、主机/来源/CSRF 校验和竞态均使用合成数据
- GitHub Actions 配置 Windows / Ubuntu × Node 22 / 24；远端执行结果以对应提交的实际 CI 为准
- 无 bundler，无 npm 生命周期脚本，无运行时依赖；前端是原生 HTML/CSS/ES modules

测试证据和未执行范围见 [验证记录](docs/validation.md)。模拟响应通过，不意味着真实登录、租户策略、厂商审核、真实下载或 Windows GUI 已通过。

```text
src/server.js      本机 HTTP、会话、OAuth 回调、只读 API
src/oauth.js       官方 OAuth + PKCE、授权码交换与刷新
src/providers.js   三个官方只读适配器与六个能力声明
src/downloads.js   有界队列、流式下载、取消与安全文件提交
src/demo.js        纯合成示例文件
public/           中文交互界面
test/             单元/集成/前端逻辑测试
```

## 后续路线

真实账号验收、操作系统安全凭据存储与官方三家中文网盘准入应先于写入操作、跨盘同步或桌面打包。公开仓库不等于厂商生产批准；请按所使用网盘的条款和自己的授权使用。
