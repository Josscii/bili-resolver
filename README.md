# Bilibili Resolver API

一个纯 Node.js + Express 的 B 站解析服务，提供视频分辨率和音频码率列表。

## 运行

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
- 缓存按 `bvid + p + qn` 隔离，不同分 P 不会共用解析结果。
- `url` 和 `quality` 为兼容旧客户端保留；新客户端应使用 `videos` 和 `audios`。
- 其余路径都会返回 `404` JSON。
