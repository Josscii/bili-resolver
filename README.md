# Bilibili Resolver API

一个纯 Node.js + Express 的 B 站解析服务，只保留 `/api/any` 这一条接口。

## 运行

```bash
npm install
npm run dev
```

默认监听 `http://127.0.0.1:8787`。

生产启动：

```bash
npm start
```

## 接口

### `GET /api/any`

查询参数：

- `text`: B 站视频链接，支持普通链接和 `b23.tv` 短链
- `qn`: 目标画质，可选，默认 `64`

示例：

```bash
curl "http://127.0.0.1:8787/api/any?text=https://www.bilibili.com/video/BV1xx411c7mD&qn=64"
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
  "quality": 64
}
```

## 说明

- 服务会在内存中缓存 20 分钟，减少重复请求 B 站接口。
- 其余路径都会返回 `404` JSON。
