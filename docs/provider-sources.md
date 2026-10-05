# 官方网盘适配与授权说明

核实日期：2026-10-05。以下是实现依据和明确限制；现阶段只有模拟请求测试，未登录任何真实账号、注册应用、创建授权、访问真实网盘数据或验证账号端到端连接。

## 实现状态

- OneDrive、Google Drive、Dropbox：官方只读 API 适配器、授权码 + S256 PKCE、刷新令牌处理已实现；使用者需要配置自己注册的客户端，并亲自完成账号授权
- 百度网盘、阿里云盘、夸克网盘：界面入口保留为“待核实官方接入”，不提供伪造的登录流程，不读取 Cookie，不复用他人应用 ID，不调用逆向私有接口
- `available` 表示适配器可用，不代表应用已获平台批准或账号已连接；`getOAuthConfig(...).available` 只判断必要客户端配置是否存在

## OneDrive

配置 `ONEDRIVE_CLIENT_ID` 为自己的 Microsoft 应用 UUID；可选 `ONEDRIVE_TENANT` 为 `common`（默认）、`organizations`、`consumers` 或租户 UUID。在应用注册中配置适用账号类型及桌面/公共客户端的本机回调地址。使用公共客户端 PKCE，不接收或打包 Microsoft 客户端密钥。管理员策略仍可能限制授权。

请求 delegated `Files.Read` 与 `offline_access`。当前范围是登录用户默认 OneDrive，未实现 SharePoint 站点库发现、跨租户或共享驱动聚合。

- 列表：`GET https://graph.microsoft.com/v1.0/me/drive/{root|items/id}/children`
- 元数据：`GET .../me/drive/items/{id}`
- 搜索：`GET .../me/drive/root/search(q='...')`；Graph 可能匹配内容或元数据，本应用随后按 NFKC 规范化、忽略大小写的文件名子串过滤。过滤后页面可能为空，仍保留下一页游标
- 下载：先查询权威文件名，再请求 `.../items/{id}/content`；不创建分享链接

[应用注册](https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app)、[OAuth 授权码与 PKCE](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow)、[列表与分页](https://learn.microsoft.com/en-us/graph/api/driveitem-list-children?view=graph-rest-1.0)、[搜索语义](https://learn.microsoft.com/en-us/graph/api/driveitem-search?view=graph-rest-1.0)、[内容下载与重定向](https://learn.microsoft.com/en-us/graph/api/driveitem-get-content?view=graph-rest-1.0)

### Microsoft 下载边界

`/content` 的预授权下载地址按官方文档无需 bearer。实现使用手动跳转，最多跟随三次，每次都重新验证；Graph bearer 仅发送到 Graph，请求下载 CDN 时不发送 Authorization、Cookie 或 Referer。

仅接受 HTTPS、443 端口、无用户名/密码/片段的地址，主机必须为严格 DNS 标签组成的 `*.files.1drv.com`（支持多级集群标签）或单层租户 `*.sharepoint.com`。官方[OneDrive 网络端点清单](https://learn.microsoft.com/en-us/sharepoint/required-urls-and-ports)包含 `*.files.1drv.com`；该清单不是本应用的完整下载白名单。其他 CDN、Microsoft sovereign cloud、`*.sharepoint-df.com`、`*.microsoftpersonalcontent.com`、自定义域名均暂不接受，返回可理解的“不支持安全下载域名”错误，用户可到 OneDrive 官方页面下载。不会因兼容性失败放宽到任意 URL。

## Google Drive

启用自己的 Google Cloud 项目的 Drive API，配置 OAuth 同意屏幕，创建 **Desktop app** 客户端。设置 `GOOGLE_CLIENT_ID`；如果该客户端的令牌交换要求客户端密钥，设置 `GOOGLE_CLIENT_SECRET`，仅从服务器环境读取，不能提交到 Git 或传给网页。当前官方原生应用文档将交换与刷新请求中的 `client_secret` 标为可选。回调使用带明确端口的 loopback HTTP 地址，建议 `127.0.0.1`。

权限为 `https://www.googleapis.com/auth/drive.readonly`，用于全盘浏览及下载；`drive.file` 只覆盖经应用选择/创建的文件，无法实现本工具的全盘资源管理器。`drive.readonly` 属于 restricted scope，公开发布可能需要 Google 验证/安全评估；个人测试、测试用户、组织政策或例外条件按 Google 的当前规则处理。配置 ID 不代表完成这些要求。

- 列表/文件名搜索：`GET https://www.googleapis.com/drive/v3/files`；不显示垃圾箱文件
- Google 的 `name contains` 为**前缀匹配**，不是任意位置子串；例如 `HelloWorld` 可以匹配 `Hello`，不能保证匹配 `World`
- 普通文件：`GET .../files/{id}?alt=media`
- 原生文档：`GET .../files/{id}/export?mimeType=...`；导出需用户明确选择本应用列出的格式，不能输入任意 MIME

[原生应用 OAuth](https://developers.google.com/identity/protocols/oauth2/native-app)、[Drive 权限](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)、[restricted scope 验证](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification)、[列表](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/list)、[搜索语义](https://developers.google.com/workspace/drive/api/guides/ref-search-terms)、[普通下载](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/get)

### Google 导出支持

- Docs：PDF、DOCX、TXT
- Sheets：XLSX、PDF、CSV（仅第一个工作表）
- Slides：PPTX、PDF
- Drawings：PDF、PNG、SVG
- 其他原生类型、快捷方式解引用和 Google Vids 长任务下载未实现；不会误当普通二进制下载
- `files.export` 的平台上限为 10 MB；不绕过权限/大小限制。`capabilities.canDownload=false` 时禁止下载
- 共享驱动发现、分页结果全局排序及所有导出格式未实现；大小排序使用 Google `quotaBytesUsed`，其值不一定等于文件逻辑大小

[导出 API 与大小限制](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/export)、[官方导出格式](https://developers.google.com/workspace/drive/api/guides/ref-export-formats)

## Dropbox

在自己的 [Dropbox App Console](https://www.dropbox.com/developers/apps) 创建 scoped app；全盘浏览需选择 **Full Dropbox** 访问范围，而不是 App folder。只启用 `files.metadata.read`、`files.content.read`。设置 `DROPBOX_CLIENT_ID` 为自己的 app key，配置与程序一致的回调 URL。使用 PKCE 公共客户端流程，申请 `token_access_type=offline` 以便刷新，不需要内置 app secret。生产权限及用户数量限制以自己的应用控制台为准。

- 列表：`POST https://api.dropboxapi.com/2/files/list_folder`；根目录 path 为 `""`，继续请求使用 `list_folder/continue`
- 文件名搜索：`files/search_v2`，设置 `filename_only=true`，分页使用 `files/search/continue_v2`
- 元数据：`files/get_metadata`
- 下载：`POST https://content.dropboxapi.com/2/files/download`；参数通过 ASCII 安全的 `Dropbox-API-Arg` JSON 头发送，文件体直接流式转发
- Dropbox 不提供此列表端点的服务端排序；界面只能排序已载入的项目。搜索存在索引延迟和最多 10,000 个匹配项等平台限制
- 不处理团队 namespace 选择、Paper 原生导出或已删除文件恢复

[OAuth 与刷新](https://docs.dropboxapi.com/dropbox-api/docs/oauth)、[列表与继续游标](https://docs.dropboxapi.com/dropbox-api/api-reference/user-endpoints/files/list-folder)、[文件名搜索](https://docs.dropboxapi.com/dropbox-api/api-reference/user-endpoints/files/search-v-2)、[继续搜索](https://docs.dropboxapi.com/dropbox-api/api-reference/user-endpoints/files/search-continue-v-2)、[元数据](https://docs.dropboxapi.com/dropbox-api/api-reference/user-endpoints/files/get-metadata)、[下载](https://docs.dropboxapi.com/dropbox-api/api-reference/user-endpoints/files/download)

## 待核实服务

[百度网盘开放平台](https://yun.baidu.com/open/platform)、[阿里云盘开发者门户](https://www.alipan.com/developer)、[夸克官方网盘 Skill](https://www.quark.cn/documents/help/quark-drive-skill) 是各服务官方入口。夸克已有官方 Skill 并不等于本应用已获得独立客户端的 OAuth/API 接入权；本项目未下载或运行该 Skill。后续接入应核实开发者注册、可用权限、授权协议和应用审核，再实现正式适配器。

## 调用与安全约定

`createProvider(id,{accessToken,fetchImpl})` 暴露 `list`、`search`、`stat`、`download`。列表返回 `{items,nextCursor}`；下载返回未读完的 `{response,fileName}`，避免缓冲整个文件。每次下载重新查询元数据，不使用客户端提供的文件名。每个适配器请求在等待响应头时有 30 秒超时；获取响应头后立即清除计时器，不会在大文件下载到 30 秒时中断。调用方的取消信号仍覆盖后续文件体。调用方负责文件名本地安全化、目标目录约束、下载体的停滞控制与取消。

游标是带版本、网盘、操作及查询上下文的 opaque base64url 状态，不是可访问的任意 URL。Google/Dropbox 游标只会作为固定端点参数；Graph 游标还验证固定 origin、精确请求路径与 query 参数白名单。游标不是授权凭证，不应记录或用于跨账号授权。

OAuth helper 本身不保存状态；服务层必须生成高熵 state/verifier、绑定当前会话、检查回调状态/有效期、一次性消费并防止回放。`expiresAt` 使用毫秒 Unix 时间。刷新未返回新 refresh token 时保留旧 token；返回新 token 时采用轮换值。

所有外部请求使用手动重定向和 `credentials: omit`。错误只返回 `{code,status,message}` 中预定义的本地化说明，不向 UI 或日志透出上游响应体、令牌、预授权下载地址或原始异常。被拒绝的跳转/错误响应体会被取消。测试以假的令牌和 mocked fetch 覆盖这些边界；不构成真实平台授权或下载验证。
