import { extractBvidAndP } from "./bili-link.js";
import { normalizeDashStreams, streamCacheSeconds } from "./streams.js";
import { createHash } from "node:crypto";

export function createBiliResolver(getCookie = () => "", options = {}) {
  const fetcher = (...args) => (options.fetcher ?? fetch)(...args);
  const metadataOrigin = options.metadataOrigin ?? "https://api.bilibili.com";
  const REFERER = "https://www.bilibili.com/";
  const UA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
  const CACHE_TTL_MS = 20 * 60 * 1000;
  const WBI_KEY_TTL_MS = 30 * 1000;

  const ERROR_MAP = {
    "-400": "请求错误",
    "-403": "访问权限不足",
    "-404": "视频不存在",
    "-10403": "仅限港澳台地区",
    62002: "视频不可见",
    62004: "审核中",
  };

  const mixinKeyEncTab = [
    46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
    33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61,
    26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36,
    20, 34, 44, 52,
  ];

  const responseCache = new Map();
  const infoCache = new Map();
  const pending = new Map();
  let wbiKeyCache;
  let wbiKeyRequest;

  function getMixinKey(orig) {
    return mixinKeyEncTab
      .map((index) => orig[index])
      .join("")
      .slice(0, 32);
  }

  function md5(text) {
    return createHash("md5").update(text).digest("hex");
  }

  function normalizeQn(value) {
    const parsed = Number.parseInt(String(value ?? "64"), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 64;
  }

  function getCachedPayload(cacheKey) {
    const entry = responseCache.get(cacheKey);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      responseCache.delete(cacheKey);
      return null;
    }
    return entry.payload;
  }

  function setCachedPayload(cacheKey, payload) {
    if (responseCache.size >= 256) responseCache.delete(responseCache.keys().next().value);
    responseCache.set(cacheKey, {
      payload,
      expiresAt: Date.now() + streamCacheSeconds(payload) * 1000,
    });
  }

  async function requestBili(url, label) {
    const cookie = getCookie()?.trim();
    const res = await fetcher(url, {
      headers: {
        "User-Agent": UA,
        Referer: REFERER,
        Accept: "application/json",
        ...(cookie ? { Cookie: cookie } : {}),
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      const error = new Error(
        res.status === 412
          ? `${label}被 B 站风控拦截 (412)，请稍后重试；持续失败时请检查服务器出口 IP 或配置 BILIBILI_COOKIE`
          : `${label}失败 (${res.status})`,
      );
      error.status = res.status;
      throw error;
    }
    return res.json();
  }

  async function fetchWbiKey() {
    const json = await requestBili(
      "https://api.bilibili.com/x/web-interface/nav",
      "获取 WBI 签名",
    );
    const wbiImg = json?.data?.wbi_img;
    if (!wbiImg?.img_url || !wbiImg?.sub_url) {
      throw new Error("WBI 签名数据缺失");
    }

    const key = getMixinKey(
      wbiImg.img_url.split("/").pop().split(".")[0] +
        wbiImg.sub_url.split("/").pop().split(".")[0],
    );
    wbiKeyCache = { key, expiresAt: Date.now() + WBI_KEY_TTL_MS };
    return key;
  }

  async function signWbi(params) {
    if (!wbiKeyCache || wbiKeyCache.expiresAt <= Date.now()) {
      wbiKeyRequest ??= fetchWbiKey().finally(() => {
        wbiKeyRequest = null;
      });
      await wbiKeyRequest;
    }
    const mixinKey = wbiKeyCache.key;

    const currentParams = { ...params, wts: Math.floor(Date.now() / 1000) };
    const query = Object.keys(currentParams)
      .sort()
      .map((key) => `${key}=${encodeURIComponent(String(currentParams[key]).replace(/[!'()*]/g, ""))}`)
      .join("&");

    return `${query}&w_rid=${md5(query + mixinKey)}`;
  }

  async function getVideoInfo(bvid) {
    if (options.dashOnly) {
      const entry = infoCache.get(bvid);
      if (entry?.expiresAt > Date.now()) return entry.value;
      const key = `info:${bvid}`;
      if (!pending.has(key)) {
        pending.set(key, fetchVideoInfo(bvid).then((value) => {
          if (infoCache.size >= 128) infoCache.delete(infoCache.keys().next().value);
          infoCache.set(bvid, { value, expiresAt: Date.now() + CACHE_TTL_MS });
          return value;
        }).finally(() => pending.delete(key)));
      }
      return pending.get(key);
    }
    return fetchVideoInfo(bvid);
  }

  async function fetchVideoInfo(bvid) {
    let data;
    try {
      data = await requestBili(
        `${metadataOrigin}/x/web-interface/view?${new URLSearchParams({ bvid })}`,
        "视频信息请求",
      );
    } catch (error) {
      if (error.status !== 412) throw error;
    }

    if (!data || [-352, -412].includes(data.code)) {
      const query = await signWbi({ bvid });
      data = await requestBili(
        `${metadataOrigin}/x/web-interface/wbi/view?${query}`,
        "视频信息请求",
      );
    }

    if (data.code !== 0) {
      throw new Error(ERROR_MAP[data.code] || data.message || "解析失败");
    }
    return data.data;
  }

  async function getPlayUrlWithFallback(bvid, cid, targetQn) {
    const qualities = [targetQn, 64, 32].filter(
      (value, index, all) => all.indexOf(value) === index && value <= targetQn,
    );
    let lastError = null;

    for (const qn of qualities) {
      try {
        const signedQuery = await signWbi({
          bvid,
          cid,
          qn,
          fnval: 1,
          platform: "html5",
        });
        const data = await requestBili(
          `https://api.bilibili.com/x/player/wbi/playurl?${signedQuery}`,
          "播放地址请求",
        );
        if (data.code === 0 && data.data?.durl?.length > 0) {
          return {
            url: data.data.durl[0].url,
            quality: data.data.quality,
          };
        }

        lastError = data.message || ERROR_MAP[data.code] || "解析失败";
      } catch (error) {
        if (error.status === 412) throw error;
        lastError = error.message;
      }
    }

    throw new Error(lastError || "解析失败");
  }

  async function getDashStreams(bvid, cid) {
    const signedQuery = await signWbi({
      bvid,
      cid,
      qn: 127,
      fnval: 4048,
      fnver: 0,
      fourk: 1,
      ...(options.dashOnly ? { web_location: 1550101 } : {}),
    });
    const data = await requestBili(
      `https://api.bilibili.com/x/player/wbi/playurl?${signedQuery}`,
      "DASH 播放地址请求",
    );
    if (data.code !== 0 || !data.data?.dash) {
      throw new Error(data.message || ERROR_MAP[data.code] || "DASH 解析失败");
    }

    return normalizeDashStreams(data.data.dash);
  }

  async function resolveBili(bvid, p, qn) {
    let { cid, title, pic, owner, pages, desc } = await getVideoInfo(bvid);
    if (p && pages?.length > 0) {
      const page = pages.find((item) => item.page === p) || pages[0];
      cid = page.cid;
      title = page.part || title;
    }

    if (options.dashOnly) {
      const streams = await getDashStreams(bvid, cid);
      if (!streams.videos.length && !streams.audios.length) throw new Error("未返回可用音视频流");
      return { title, description: desc ?? "", pic, bvid, p, author: owner?.name ?? "", url: null,
        quality: streams.videos[0]?.quality ?? null, ...streams };
    }

    const [videoStream, dashStreams] = await Promise.all([
      getPlayUrlWithFallback(bvid, cid, qn),
      getDashStreams(bvid, cid).catch(() => ({ videos: [], audios: [] })),
    ]);

    return {
      title,
      description: desc ?? "",
      pic,
      bvid,
      p,
      author: owner?.name ?? "",
      url: videoStream.url,
      quality: videoStream.quality,
      videos: dashStreams.videos,
      audios: dashStreams.audios,
    };
  }

  async function resolveFromText(text, page, quality) {
    const qn = normalizeQn(quality);
    const { bvid, p } = await extractBvidAndP(text, page, fetcher);
    const cacheKey = `${bvid}:${p}:${qn}`;
    const cached = getCachedPayload(cacheKey);
    if (cached) return cached;
    if (pending.has(cacheKey)) return pending.get(cacheKey);
    if (pending.size >= 32) throw new Error("解析请求较多，请稍后重试");
    const request = resolveBili(bvid, p, qn).then((result) => {
      const payload = { status: "success", ...result };
      setCachedPayload(cacheKey, payload);
      return payload;
    }).finally(() => pending.delete(cacheKey));
    pending.set(cacheKey, request);
    return request;
  }

  return { resolveBili, resolveFromText };
}
