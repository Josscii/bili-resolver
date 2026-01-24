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
- 🔓 **自动绕过防盗链**: 服务端自动伪造 `Referer` 和 `User-Agent`，解决视频无法加载的问题。
- ⚡ **一键直连**: 只需在 VRChat 播放器中输入 `域名/BV号` 即可直接播放。
- 📱 **多画质支持**: 默认为 1080P 高清画质，支持通过参数降级。
- 🚀 **零成本部署**: 单文件 `index.js`，基于 Cloudflare Workers 免费版即可稳定运行。

## 🎮 VRChat 使用指南

### 1. 基础用法
在 VRChat 世界的视频播放器（URL 输入栏）中，直接输入你的**自定义域名**加视频 BV 号：

**格式：**
```text
https://你的自定义域名.com/BVxxxxxx
```

**示例：**
假设你绑定的域名是 `bili.example.com`，你想看 BV1xx411c7mD：
👉 输入: `https://bili.example.com/BV1xx411c7mD`

### 2. 指定画质
如果世界内网络卡顿，可以强制指定低画质（默认是 80 即 1080P）：
- **720P**: `.../BVxxxxxx?qn=64`
- **480P**: `.../BVxxxxxx?qn=32`

---

## 🛠️ 部署指南

### 方法一：网页在线部署 (最简单，无需安装工具)

适合没有编程基础或不想安装本地环境的用户。

1. **创建 Worker**:
   - 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)。
   - 在左侧菜单点击 **Workers & Pages** -> **Create Application**。
   - 点击 **Create Worker**。
   - 给它起个名字（例如 `bili-proxy`），点击 **Deploy**。

2. **粘贴代码**:
   - 点击 **Edit code** 按钮进入在线编辑器。
   - 删除编辑器里原有的 `Hello World` 代码。
   - 将本项目 `index.js` 中的代码**全部复制粘贴**进去。
   - 点击右上角的 **Deploy** 保存并发布。

3. **绑定域名 (关键步骤)**:
   - 回到该 Worker 的详情页面 (Overview)。
   - 点击顶部的 **Settings** (设置) -> **Triggers** (触发器)。
   - 向下滚动找到 **Custom Domains** (自定义域名)。
   - 点击 **Add Custom Domain**。
   - 输入你拥有的二级域名（例如 `bili.你的域名.com`）。
   - Cloudflare 会自动配置 DNS 和 SSL 证书，等待几分钟生效后即可使用。

### 方法二：使用 Wrangler CLI (开发者)

适合习惯使用命令行进行版本管理的用户。

1. **安装与登录**:
   ```bash
   npm install -g wrangler
   wrangler login
   ```

2. **创建配置文件 (`wrangler.toml`)**:
   ```toml
   name = "bili-resolver"
   main = "index.js"
   compatibility_date = "2024-01-01"
   [placement]
   mode = "smart"
   ```

3. **发布**:
   ```bash
   wrangler deploy
   ```
   *发布后同样记得去网页后台绑定 Custom Domain。*

---

## 🔗 API 接口文档

### 1. VRChat 直连 / 重定向
最常用的接口，直接重定向到代理后的视频流。
- **URL**: `/<BV_ID>`
- **Method**: `GET`
- **Response**: `302 Redirect` -> 视频流

### 2. 网页解析器 (Web UI)
在浏览器中直接访问域名，提供一个简单的图形界面来测试解析结果。
- **URL**: `/`

### 3. 获取解析 JSON
如果你在开发其他工具，可以通过此接口获取元数据。
- **URL**: `/json/<BV_ID>`

### 4. 万能流代理 (Proxy)
Worker 的核心代理端点，用于中转 Bilibili 的 mcdn 流量。
- **URL**: `/proxy?url=<ENCODED_URL>`

## ❓ 常见问题 (FAQ)

**Q: 为什么 VRChat 里还是显示 Loading Error?**
A: 
1. **域名问题**: 确认你是否使用了自定义域名？不要使用 `workers.dev`。
2. **播放器支持**: 只有视频流是 302 重定向的，请确保你的 VRChat 播放器支持重定向（目前主流的 ProTV 和 USharpVideo 都支持）。
3. **会员限制**: 某些 B 站视频（如番剧、大会员专享）需要 Cookie 才能解析，本脚本默认是**未登录**状态，只能看公共视频。

**Q: 会消耗 Cloudflare 额度吗？**
A: 会。Cloudflare Workers 免费版每天有 100,000 次请求限制。
- **注意**：视频流代理会消耗 Worker 的 CPU 时间（/proxy 接口）。如果多人同时观看高清视频，可能会短暂触发 Worker 的 CPU 限制，建议仅供个人或小规模好友使用。

## ⚠️ 免责声明

1. 本项目仅供用于 VRChat 玩家技术交流和个人娱乐，**严禁用于商业用途**。
2. 脚本不存储任何视频内容，仅做实时解析与流量转发。
3. 请勿在公共大流量实例中滥用，以免被 Cloudflare 封禁账号。

***
