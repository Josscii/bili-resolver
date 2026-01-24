# 📺 Bilibili Resolver & Proxy Worker

> 专为 VRChat 优化的 Bilibili 视频解析与流媒体代理服务。
> 解决 VRChat 播放器无法播放 B 站视频的 Referer 防盗链问题。
> 
> ***本项目的核心目的是帮助低成本用户利用 Cloudflare 免费资源，自建专属的解析服务，不再受制于第三方主流解析站的不稳定与广告干扰。***

![VRChat Ready](https://img.shields.io/badge/VRChat-Ready-pink?logo=vrchat)
![Cloudflare Workers](https://img.shields.io/badge/Deployed%20on-Cloudflare%20Workers-orange?logo=cloudflare)
![License](https://img.shields.io/badge/License-MIT-blue)

**Bili-Resolver-Worker** 是一个运行在 Cloudflare Workers 上的轻量级工具。

对于 **VRChat** 玩家而言，它是一个**视频中转站**。由于 Bilibili 的视频链接通过 Referer 验证进行防盗链，普通的 VRChat 播放器直接输入 B 站链接通常会加载失败或报错（403 Forbidden）。本服务作为一个中间层，自动处理所有鉴权请求头，并将视频流无缝转发给 VRChat 播放器。

## ⚠️ 网络连接重要提示 (必读)

> [!WARNING]
> **关于 workers.dev 域名的访问限制**
> Cloudflare 分配的默认域名（例如 `xxx.workers.dev`）在中国大陆通常无法直接访问。
> **为了确保服务可用，部署 Worker 后请务必在后台绑定自己的自定义域名。**

* **有域名：** 直接在 Cloudflare Worker 设置中绑定二级域名（如 `api.yourdomain.com`）。
* **无域名：** 可以尝试使用免费域名服务（如 `pp.ua`、`eu.org`、`dpdns.org`等）。

如果你在国内仅使用加速器游玩 VRChat，**必须绑定自定义域名 (Custom Domain)** 才能正常解析和播放。

- ❌ **错误用法**: `https://bili.你的名字.workers.dev/BV...` (国内无法连接)
- ✅ **正确用法**: `https://bili.你的域名.com/BV...` (直连速度通常不错)

## ✨ 核心特性

- 🎮 **VRChat 完美兼容**: 专为 USharpVideo, ProTV, iwaSyncVideo 等 VRChat 播放器设计。
- 🔄 **Git 自动集成**: 支持 Fork 仓库后自动部署，源码更新一键同步。
- 🔓 **自动绕过防盗链**: 服务端自动伪造 `Referer` 和 `User-Agent`，解决视频无法加载的问题。
- ⚡ **一键直连**: 支持直接粘贴 `BV号` 或 `b23.tv` 短链，智能识别并解析。
- 📱 **多画质支持**: 默认为 1080P 高清画质，支持通过参数降级。
- 📥 **强制下载**: 提供 Web 界面，支持一键下载命名的 MP4 文件。
- 🚀 **零成本部署**: 单文件逻辑，基于 Cloudflare Workers 免费版即可稳定运行。

## 🎮 VRChat 使用指南

### 1. 基础用法
在 VRChat 世界的视频播放器（URL 输入栏）中，直接输入你的**自定义域名**加视频 BV 号或分享链接：

**格式：**
```text
https://你的自定义域名.com/BVxxxxxx
```
或者直接粘贴复制的 B 站分享文本（脚本会自动提取）：
```text
https://你的自定义域名.com/【视频标题】 https://b23.tv/xxx
```

### 2. 指定画质
如果世界内网络卡顿，可以强制指定低画质（默认是 80 即 1080P）：
- **720P**: `.../BVxxxxxx?qn=64`
- **480P**: `.../BVxxxxxx?qn=32`

---

## 🛠️ 部署指南

### 方法一：GitHub 集成部署 (推荐，支持自动更新)

最推荐的方式。通过连接 GitHub，当本项目更新时，你只需在 GitHub 点击 "Sync Fork"，Cloudflare 会自动更新你的服务。

1. **Fork 本仓库**:
   - 点击本项目页面右上角的 **Fork** 按钮，将其复制到你自己的 GitHub 账号下。

2. **创建 Worker**:
   - 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)。
   - 在左侧菜单点击 **Workers & Pages** -> **Create Application**。
   - 点击 **Connect to Git** (不要点 Create Worker)。
   - 选择你刚才 Fork 的仓库。
   - 保持默认设置 (Settings 均无需修改)，点击 **Save and Deploy**。

3. **绑定域名 (必做)**:
   - 部署完成后，进入该 Worker 的详情页。
   - 点击顶部的 **Settings** (设置) -> **Triggers** (触发器)。
   - 点击 **Add Custom Domain**，输入你的二级域名并保存。

### 方法二：网页在线部署 (简单，无需 Git)

适合不想折腾 GitHub 账号的用户。

1. **创建 Worker**:
   - 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)。
   - 点击 **Workers & Pages** -> **Create Application** -> **Create Worker**。
   - 点击 **Deploy**。

2. **粘贴代码**:
   - 点击 **Edit code**。
   - 删除原有代码，将本项目 `index.js` 中的代码**全部复制粘贴**进去。
   - 点击 **Deploy** 保存。

3. **绑定域名**:
   - 同样在 **Settings** -> **Triggers** 中添加自定义域名。

### 方法三：使用 Wrangler CLI (开发者)

适合习惯使用命令行进行版本管理的用户。

1. **安装与登录**:
   ```bash
   npm install -g wrangler
   wrangler login
   ```

2. **配置与发布**:
   - 下载代码到本地。
   - 运行 `wrangler deploy`。

---

## 🔗 API 接口文档

### 1. VRChat 直连 / 重定向 (万能路径)
最常用的接口，支持各种格式的路径。
- **URL**: `/<任意内容>`
- **说明**: 路径可以是 `BV号`、`b23.tv短链`，甚至是包含中文标题的脏文本。Worker 会自动提取链接并重定向到视频流。

### 2. 网页解析器 (Web UI)
在浏览器中直接访问域名，提供一个现代化的图形界面（Glassmorphism 风格）。
- **URL**: `/`
- **功能**: 支持解析预览、复制直链、一键下载 MP4。

### 3. 万能流代理 (Proxy)
Worker 的核心代理端点，用于中转 Bilibili 的流量。
- **URL**: `/proxy?url=<ENCODED_URL>&dl=<0|1>`
- **参数**: `dl=1` 可强制触发浏览器下载。

## ❓ 常见问题 (FAQ)

**Q: 为什么 VRChat 里还是显示 Loading Error?**
A: 
1. **域名问题**: 确认你是否使用了自定义域名？不要使用 `workers.dev`。
2. **播放器支持**: 只有视频流是 302 重定向的，请确保你的 VRChat 播放器支持重定向（目前主流的 ProTV 和 USharpVideo 都支持）。
3. **会员限制**: 某些 B 站视频（如番剧、大会员专享）需要 Cookie 才能解析，本脚本默认是**未登录**状态，只能看公共视频。

**Q: 为什么下载的文件名是乱码或者没有 .mp4 后缀？**
A: 请使用我们提供的 Web UI 界面点击下载，或者手动在链接后加上 `&name=文件名`。Worker 会自动处理 `Content-Disposition` 头来保证文件名正确。

**Q: 会消耗 Cloudflare 额度吗？**
A: 会。Cloudflare Workers 免费版每天有 100,000 次请求限制。视频流代理会消耗 Worker 的 CPU 时间，建议仅供个人或小规模好友使用。

## ⚠️ 免责声明

1. 本项目仅供用于 VRChat 玩家技术交流和个人娱乐，**严禁用于商业用途**。
2. 脚本不存储任何视频内容，仅做实时解析与流量转发。
3. 请勿在公共大流量实例中滥用，以免被 Cloudflare 封禁账号。
