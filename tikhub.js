import { extractBvidAndP } from "./bili-link.js";
import { getStreamUrls, normalizeDashStreams, streamCacheSeconds } from "./streams.js";

const TTL = 20 * 60 * 1000;
const MAX_ENTRIES = 256;

export function createTikHubResolver(apiKey) {
  const cache = new Map();
  const pending = new Map();

  function remember(key, value) {
    if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value);
    const ttl = key.startsWith("streams:") ? streamCacheSeconds(value) * 1000 : TTL;
    if (ttl > 0) cache.set(key, { value, expiresAt: Date.now() + ttl });
    return value;
  }

  async function cached(key, request) {
    const entry = cache.get(key);
    if (entry?.expiresAt > Date.now()) return entry.value;
    cache.delete(key);
    if (!pending.has(key)) {
      pending.set(key, request().then((value) => remember(key, value)).finally(() => pending.delete(key)));
    }
    return pending.get(key);
  }

  async function call(endpoint, params) {
    const url = new URL(`https://api.tikhub.io/api/v1/bilibili/web/${endpoint}`);
    url.search = new URLSearchParams(params).toString();
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`TikHub 请求失败 (${response.status})`);
    const json = await response.json();
    if (json.code !== 200 || !json.data) throw new Error("TikHub 解析失败");
    const data = json.data;
    if (data.code !== undefined) {
      if (data.code !== 0 || !data.data) throw new Error(data.message || "B 站解析失败");
      return data.data;
    }
    return data;
  }

  return {
    async resolveFromText(text, fallbackPage) {
      if (!apiKey) throw new Error("未配置 TIKHUB_API_KEY");
      const { bvid, p } = await extractBvidAndP(text, fallbackPage);
      const info = await cached(`info:${bvid}`, async () => {
        const value = await call("fetch_one_video", { bv_id: bvid });
        if (!value.cid) throw new Error("TikHub 返回的视频信息缺少 cid");
        return value;
      });
      const page = info.pages?.find((item) => item.page === p) ?? info.pages?.[0];
      const cid = page?.cid ?? info.cid;
      return cached(`streams:${bvid}:${p}:${cid}`, async () => {
        const play = await call("fetch_video_playurl", { bv_id: bvid, cid });
        const { videos, audios } = normalizeDashStreams(play.dash);
        const progressive = play.durl?.[0];
        const url = getStreamUrls({ baseUrl: progressive?.url, backup_url: progressive?.backup_url })[0] ?? null;
        if (!url && !videos.length && !audios.length) throw new Error("TikHub 未返回可用音视频流");
        return {
          status: "success",
          title: page?.part || info.title || "",
          description: info.desc ?? "",
          pic: info.pic ?? "",
          bvid,
          p,
          author: info.owner?.name ?? "",
          url,
          quality: play.quality ?? null,
          videos,
          audios,
        };
      });
    },
  };
}
