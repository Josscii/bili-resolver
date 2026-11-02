function cdnPriority(value) {
  const url = new URL(value);
  const host = url.hostname.toLowerCase();
  if (host.includes(".mcdn.") || host.includes("szbdyd") || /^\d+\.\d+\.\d+\.\d+$/.test(host) || (url.port && !["80", "443"].includes(url.port))) return 3;
  if (host.endsWith(".akamaized.net") || /(?:cosov|uposov|akam)/.test(host)) return 2;
  if (/^upos-/.test(host) && /\.bilivideo\.(com|cn|net)$/.test(host)) return 0;
  return 1;
}

export function getStreamUrls(stream) {
  const values = [stream.baseUrl, stream.base_url,
    ...(Array.isArray(stream.backupUrl) ? stream.backupUrl : []),
    ...(Array.isArray(stream.backup_url) ? stream.backup_url : [])];
  return [...new Set(values)].filter((value) => {
    try {
      const url = new URL(value);
      const deadline = Number(url.searchParams.get("deadline"));
      return ["http:", "https:"].includes(url.protocol) && (!deadline || deadline * 1000 > Date.now() + 60_000);
    } catch {
      return false;
    }
  }).sort((a, b) => cdnPriority(a) - cdnPriority(b));
}

export function streamCacheSeconds(payload, now = Date.now()) {
  const urls = [payload.url, ...(payload.videos ?? []).map((stream) => stream.url), ...(payload.audios ?? []).map((stream) => stream.url)].filter(Boolean);
  let expiresAt = now + 20 * 60 * 1000;
  for (const value of urls) {
    const deadline = Number(new URL(value).searchParams.get("deadline"));
    if (Number.isFinite(deadline) && deadline > 0) expiresAt = Math.min(expiresAt, deadline * 1000 - 60_000);
  }
  return Math.max(0, Math.floor((expiresAt - now) / 1000));
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


export function normalizeDashStreams(dash = {}) {
  const rawVideos = (dash.video ?? []).map((stream) => ({ ...stream, urls: getStreamUrls(stream) })).filter((stream) => stream.urls.length);
  const h264Videos = rawVideos.filter(
    (stream) => stream.codecid === 7 || /^avc/i.test(stream.codecs ?? ""),
  );
  const compatibleVideos = h264Videos.length > 0 ? h264Videos : rawVideos;
  const videos = uniqueBy(
    compatibleVideos
      .filter((stream) => stream.urls.length && stream.height > 0)
      .sort(
        (lhs, rhs) =>
          rhs.height - lhs.height ||
          (rhs.bandwidth ?? 0) - (lhs.bandwidth ?? 0),
      )
      .map((stream) => ({
        url: stream.urls[0],
        backup_urls: stream.urls.slice(1),
        height: stream.height,
        quality: stream.id,
        filesize: getStreamFileSize(stream),
      })),
    (stream) => stream.height,
  );

  const audios = uniqueBy(
    (dash.audio ?? [])
      .map((stream) => ({ ...stream, urls: getStreamUrls(stream) }))
      .filter((stream) => stream.urls.length && stream.bandwidth > 0)
      .sort((lhs, rhs) => rhs.bandwidth - lhs.bandwidth)
      .map((stream) => ({
        url: stream.urls[0],
        backup_urls: stream.urls.slice(1),
        bitrate: Math.max(Math.round(stream.bandwidth / 1000), 1),
        quality: stream.id,
        filesize: getStreamFileSize(stream),
      })),
    (stream) => stream.bitrate,
  );

  return { videos, audios };
}
