export function createSelfHostedResolver(origin, token) {
  const endpoint = new URL(origin);
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password) {
    throw new Error("自部署解析服务必须使用 HTTPS");
  }
  return {
    async resolveFromText(text, page, quality) {
      const url = new URL(endpoint);
      url.searchParams.set("text", text);
      if (page) url.searchParams.set("p", page);
      if (quality) url.searchParams.set("qn", quality);
      const response = await fetch(url, {
        headers: { Accept: "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        redirect: "manual",
        signal: AbortSignal.timeout(25_000),
      });
      if (!response.ok) throw new Error(`自部署解析服务请求失败 (${response.status})`);
      const payload = await response.json();
      if (payload.status !== "success") throw new Error(payload.message || "自部署解析失败");
      if (!Array.isArray(payload.videos) || !Array.isArray(payload.audios) || (!payload.videos.length && !payload.audios.length)) {
        throw new Error("自部署解析服务未返回音视频流");
      }
      return payload;
    },
  };
}
