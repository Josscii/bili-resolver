export async function extractBvidAndP(text, fallbackPage, fetcher = fetch) {
  let url = text.match(/https?:\/\/[^\s]+/g)?.[0];
  if (!url) throw new Error("无效的链接");

  if (new URL(url).hostname === "b23.tv") {
    try {
      for (let redirects = 0; redirects < 5; redirects++) {
        const res = await fetcher(url, {
          method: "HEAD",
          redirect: "manual",
          headers: { "User-Agent": "Mozilla/5.0" },
          signal: AbortSignal.timeout(15_000),
        });
        const location = res.headers.get("Location");
        if (res.status < 300 || res.status >= 400 || !location) throw new Error("短链未重定向");
        const target = new URL(location, url);
        if (!["http:", "https:"].includes(target.protocol)) throw new Error("无效的重定向");
        url = target.href;
        if (target.hostname !== "b23.tv") break;
      }
      if (new URL(url).hostname === "b23.tv") throw new Error("短链重定向次数过多");
    } catch {
      throw new Error("无法解析 b23.tv 链接");
    }
  }

  const urlObj = new URL(url);
  if (urlObj.hostname !== "bilibili.com" && !urlObj.hostname.endsWith(".bilibili.com")) {
    throw new Error("无效的 B 站链接");
  }
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

