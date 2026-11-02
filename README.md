# Bilibili Resolver API

一个支持 Cloudflare Workers 和 Node.js + Express 的 B 站解析服务，提供视频分辨率和音频码率列表。两个运行入口共用解析逻辑。

## TikHub 临时解析

Worker 配置了 `TIKHUB_API_KEY` Secret 时，B 站解析使用 TikHub；未配置时使用 B 站直连接口。

```bash
npx wrangler secret put TIKHUB_API_KEY
npm run deploy
```

`downloader.js` 管理现有 `downloader` Worker。`/bilibili?url=...` 直接调用同一份解析模块，返回 `videos`、`audios` 列表，支持链接中的 `p` 或独立的 `p` 参数。其他入口维持现有逻辑；抖音和小红书的 TikHub 调用也从 Secret 读取密钥。

```bash
npx wrangler secret put TIKHUB_API_KEY --config wrangler.downloader.jsonc
npx wrangler deploy --config wrangler.downloader.jsonc
```

TikHub 使用 `fetch_one_video` 获取详情，再通过 `fetch_video_playurl` 获取所选分 P 的流。两个接口当前标价各 $0.001，首次未命中的解析约 $0.002，实际费用取决于免费额度和折扣。详情、分 P 流分别缓存 20 分钟，同一实例内的并发相同请求合并，失败结果不缓存，最多保留 256 条缓存。

画质和码率以 TikHub 实际返回的流为准，`qn` 不会解锁其未提供的画质。音视频分离时 `url` 为 `null`，客户端应从 `videos` 和 `audios` 选择直链；不会把无音轨视频伪装成合并 MP4。

音视频流会从上游提供的主地址和备用地址中优先选择常规 B 站 CDN，将已识别的海外镜像和 PCDN 地址后置，并在每条流的 `backup_urls` 中保留其余候选。不会自行替换域名或改写签名。过期或即将过期的地址会被排除，流缓存和 Worker 响应缓存最长 20 分钟，并在所选地址的 `deadline` 前至少 60 秒到期。客户端可在超时或持续低速时使用备用地址重试；服务端排序无法保证每条用户线路都同样快。

## Cloudflare Workers

```bash
npm install
npm run dev:worker
```

部署到 `wrangler.jsonc` 指定的账号和 Worker：

```bash
npx wrangler login
npm run deploy
```

Worker 地址为 `https://bili-resolver.jossciiweiyi.workers.dev`，支持 `/v2`、`/api/any` 和 `/`。请求参数和成功响应与 Node.js 服务兼容。

可选登录 Cookie 通过 Worker Secret 配置：

```bash
npx wrangler secret put BILIBILI_COOKIE
```

本地开发可在不提交到 Git 的 `.dev.vars` 中配置 `BILIBILI_COOKIE`。Worker 的 Cookie 通过运行时绑定传入，不依赖服务器环境变量。

现有 `downloader` 的 `/bilibili` 已直接调用本仓库的 Worker 模块，不再请求旧服务器。普通旧入口的 `parseFromBiliResolver` 仍保留原地址。传递视频链接时应使用 `encodeURIComponent(url)` 或 `URLSearchParams` 编码，保留分 P 参数。

Cloudflare 的出口也可能受到 B 站限制；迁移不保证消除 412。错误响应使用 `Cache-Control: no-store`，不会写入解析结果缓存。

验证：

```bash
npm test
npm run deploy -- --dry-run
```

## Node.js 运行

```bash
npm install
npm run dev
```

默认监听 `http://127.0.0.1:3000`。

生产启动：

```bash
npm start
```

## Dokploy 部署

仓库已经包含自动部署 workflow：`.github/workflows/dokploy-deploy.yml`。

流程对应文章里的做法：

- push 到 `codex/express-api-rewrite`
- GitHub Actions 构建并推送镜像到 `ghcr.io`
- 调用 `DOKPLOY_WEBHOOK` 触发 Dokploy 重部署

你需要在 GitHub 仓库 Secrets 里新增：

- `DOKPLOY_WEBHOOK`: Dokploy 项目的 Deploy Webhook URL

Dokploy 里镜像地址建议填写：

```text
ghcr.io/<你的 GitHub 用户名或组织名（小写）>/<你的仓库名（小写）>:codex-express-api-rewrite
```

## 接口

### `GET /api/any` 或 `GET /v2`

查询参数：

- `text` 或 `url`: B 站视频链接，支持普通链接和 `b23.tv` 短链
- `p`: 分 P 序号，可选；链接中没有 `p` 时作为回退值
- `qn`: 目标画质，可选，默认 `64`

示例：

```bash
curl "http://127.0.0.1:3000/api/any?text=https://www.bilibili.com/video/BV1xx411c7mD&qn=64"
```

成功返回：

```json
{
  "status": "success",
  "title": "示例标题",
  "pic": "https://i0.hdslb.com/...",
  "bvid": "BV1xx411c7mD",
  "p": 1,
  "author": "示例作者",
  "url": "https://upos-sz-mirror...bilivideo.com/...",
  "quality": 64,
  "videos": [
    {
      "url": "https://...bilivideo.com/...",
      "height": 720,
      "quality": 64,
      "filesize": null
    }
  ],
  "audios": [
    {
      "url": "https://...bilivideo.com/...",
      "bitrate": 132,
      "quality": 30232,
      "filesize": null
    }
  ]
}
```

## 说明

- 服务会在内存中缓存 20 分钟，减少重复请求 B 站接口。
- 视频信息接口返回 HTTP 412 或风控错误码时，会自动尝试 WBI 签名接口；失败响应不会被缓存。
- 所有 API 请求均携带 Referer，WBI 签名密钥缓存 30 秒，并合并并发获取请求。
- 如果部署环境持续返回 412，可在部署平台配置 `BILIBILI_COOKIE` 环境变量，值为浏览器登录 B 站后的 Cookie 请求头内容，再重启服务。Cookie 属于敏感凭据，不要提交到仓库。服务器出口 IP 受限时，配置 Cookie 也不保证恢复。
- 缓存按 `bvid + p + qn` 隔离，不同分 P 不会共用解析结果。
- `url` 和 `quality` 为兼容旧客户端保留；新客户端应使用 `videos` 和 `audios`。
- 其余路径都会返回 `404` JSON。

## 自部署浏览器请求模式

Docker 镜像默认启用 `BILI_BROWSER_FETCH=1`，使用持久化 curl_cffi 会话、Chrome TLS 指纹和 B 站匿名访客 Cookie。无需 TikHub，也无需登录 Cookie；出口 IP 被限制时仍可能失败。此模式直接返回 DASH 的 `videos`、`audios`，顶层 `url` 为 `null`。同视频并发请求合并，元信息缓存 20 分钟，流缓存受签名地址过期时间限制；Python 请求并发上限为 4。

`GET /health` 检查进程状态，不代表 B 站解析可用。本机运行时需另外安装 `curl_cffi==0.17.0`，并通过 `BILI_PYTHON` 指定 Python 路径。

Cloudflare Worker 设置 `BILI_PROVIDER=selfhost` 和 `BILI_UPSTREAM_URL=https://parse.aistenapp.top/v2` 后转发到自部署服务。此模式失败直接返回错误，不会自动调用 TikHub。`TIKHUB_API_KEY` 可继续保留供下载网关其他平台使用，不会用于 B 站解析。
