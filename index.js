import express from "express";
import { createHash } from "node:crypto";

const REFERER = "https://www.bilibili.com/";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const CACHE_TTL_MS = 20 * 60 * 1000;
const PORT = Number.parseInt(process.env.PORT ?? "3000", 10);
const HOST = process.env.HOST ?? "127.0.0.1";

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

const app = express();
app.disable("x-powered-by");

function getMixinKey(orig) {
  return mixinKeyEncTab
    .map((index) => orig[index])
    .join("")
    .slice(0, 32);
}

function md5(text) {
  return createHash("md5").update(text).digest("hex");
}

function getFirstQueryValue(value) {
  return Array.isArray(value) ? value[0] : value;
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
  responseCache.set(cacheKey, {
    payload,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
}

async function signWbi(params) {
  const res = await fetch("https://api.bilibili.com/x/web-interface/nav", {
    headers: { "User-Agent": UA },
  });
  if (!res.ok) throw new Error("获取 WBI 签名失败");

  const json = await res.json();
  const wbiImg = json?.data?.wbi_img;
  if (!wbiImg?.img_url || !wbiImg?.sub_url) {
    throw new Error("WBI 签名数据缺失");
  }

  const mixinKey = getMixinKey(
    wbiImg.img_url.split("/").pop().split(".")[0] +
      wbiImg.sub_url.split("/").pop().split(".")[0],
  );

  const currentParams = { ...params, wts: Math.floor(Date.now() / 1000) };
  const query = Object.keys(currentParams)
    .sort()
    .map((key) => `${key}=${encodeURIComponent(currentParams[key])}`)
    .join("&");

  return `${query}&w_rid=${md5(query + mixinKey)}`;
}

async function extractBvidAndP(text, fallbackPage) {
  let url = text.match(/https?:\/\/[^\s]+/g)?.[0];
  if (!url) throw new Error("无效的链接");

  if (/b23\.tv\/[a-zA-Z0-9]+/.test(url)) {
    try {
      const res = await fetch(url, {
        method: "HEAD",
        redirect: "follow",
        headers: { "User-Agent": UA },
      });
      url = res.url;
    } catch {
      throw new Error("无法解析 b23.tv 链接");
    }
  }

  const urlObj = new URL(url);
  const bvidMatch = urlObj.pathname.match(/(BV[a-zA-Z0-9]{10})/);
  const pMatch =
    urlObj.searchParams.get("p") || urlObj.pathname.match(/\/p(\d+)/);

  if (!bvidMatch) throw new Error("无效的链接");

  let p = 1;
  if (pMatch) {
    if (typeof pMatch === "string") {
      p = Number.parseInt(pMatch, 10);
    } else if (Array.isArray(pMatch)) {
      const captured = pMatch[1] ?? pMatch[0];
      p = Number.parseInt(captured, 10);
    }
  } else if (fallbackPage) {
    p = Number.parseInt(String(fallbackPage), 10);
  }

  if (!Number.isFinite(p) || p <= 0) {
    p = 1;
  }

  return {
    bvid: bvidMatch[1],
    p,
  };
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
      const res = await fetch(
        `https://api.bilibili.com/x/player/wbi/playurl?${signedQuery}`,
        {
          headers: { "User-Agent": UA, Referer: REFERER },
        },
      );

      if (!res.ok) {
        lastError = `播放地址请求失败 (${res.status})`;
        continue;
      }

      const data = await res.json();
      if (data.code === 0 && data.data?.durl?.length > 0) {
        return {
          url: data.data.durl[0].url,
          quality: data.data.quality,
        };
      }

      lastError = data.message || ERROR_MAP[data.code] || "解析失败";
    } catch (error) {
      lastError = error.message;
    }
  }

  throw new Error(lastError || "解析失败");
}

function getStreamUrl(stream) {
  return stream.baseUrl ?? stream.base_url ?? null;
}

function getStreamFileSize(stream) {
  const size = Number.parseInt(String(stream.size ?? ""), 10);
  return Number.isFinite(size) && size > 0 ? size : null;
}

function uniqueBy(items, key) {
  const seen = new Set();
  return items.filter((item) => {
    const value = key(item);
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

async function getDashStreams(bvid, cid) {
  const signedQuery = await signWbi({
    bvid,
    cid,
    qn: 127,
    fnval: 4048,
    fnver: 0,
    fourk: 1,
  });
  const res = await fetch(
    `https://api.bilibili.com/x/player/wbi/playurl?${signedQuery}`,
    {
      headers: { "User-Agent": UA, Referer: REFERER },
    },
  );
  if (!res.ok) throw new Error(`DASH 播放地址请求失败 (${res.status})`);

  const data = await res.json();
  if (data.code !== 0 || !data.data?.dash) {
    throw new Error(data.message || ERROR_MAP[data.code] || "DASH 解析失败");
  }

  const rawVideos = data.data.dash.video ?? [];
  const h264Videos = rawVideos.filter(
    (stream) => stream.codecid === 7 || /^avc/i.test(stream.codecs ?? ""),
  );
  const compatibleVideos = h264Videos.length > 0 ? h264Videos : rawVideos;
  const videos = uniqueBy(
    compatibleVideos
      .filter((stream) => getStreamUrl(stream) && stream.height > 0)
      .sort(
        (lhs, rhs) =>
          rhs.height - lhs.height ||
          (rhs.bandwidth ?? 0) - (lhs.bandwidth ?? 0),
      )
      .map((stream) => ({
        url: getStreamUrl(stream),
        height: stream.height,
        quality: stream.id,
        filesize: getStreamFileSize(stream),
      })),
    (stream) => stream.height,
  );

  const audios = uniqueBy(
    (data.data.dash.audio ?? [])
      .filter((stream) => getStreamUrl(stream) && stream.bandwidth > 0)
      .sort((lhs, rhs) => rhs.bandwidth - lhs.bandwidth)
      .map((stream) => ({
        url: getStreamUrl(stream),
        bitrate: Math.max(Math.round(stream.bandwidth / 1000), 1),
        quality: stream.id,
        filesize: getStreamFileSize(stream),
      })),
    (stream) => stream.bitrate,
  );

  return { videos, audios };
}

export async function resolveBili(bvid, p, qn) {
  const res = await fetch(
    `https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`,
    {
      headers: { "User-Agent": UA },
    },
  );
  if (!res.ok) throw new Error(`视频信息请求失败 (${res.status})`);

  const data = await res.json();
  if (data.code !== 0) {
    throw new Error(ERROR_MAP[data.code] || data.message || "解析失败");
  }

  let { cid, title, pic, owner, pages, desc } = data.data;
  if (p && pages?.length > 0) {
    const page = pages.find((item) => item.page === p) || pages[0];
    cid = page.cid;
    title = page.part;
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

app.get(["/api/any", "/v2"], async (req, res) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Cache-Control", "public, max-age=1200");

  const text = getFirstQueryValue(req.query.text ?? req.query.url);
  if (!text) {
    return res.status(400).json({
      status: "error",
      message: "缺少 text 或 url 参数",
    });
  }

  const qn = normalizeQn(getFirstQueryValue(req.query.qn));
  const fallbackPage = getFirstQueryValue(req.query.p);

  try {
    const { bvid, p } = await extractBvidAndP(text, fallbackPage);
    const cacheKey = `${bvid}:${p}:${qn}`;
    const cachedPayload = getCachedPayload(cacheKey);
    if (cachedPayload) {
      return res.json(cachedPayload);
    }

    const payload = {
      status: "success",
      ...(await resolveBili(bvid, p, qn)),
    };

    setCachedPayload(cacheKey, payload);
    return res.json(payload);
  } catch (error) {
    return res.status(500).json({
      status: "error",
      message: error.message,
    });
  }
});

app.use((_req, res) => {
  res.status(404).json({
    status: "error",
    message: "Not Found",
  });
});

app.listen(PORT, HOST, () => {
  console.log(`Bili resolver listening on http://${HOST}:${PORT}`);
});
