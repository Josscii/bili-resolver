import express from "express";
import { pathToFileURL } from "node:url";
import { createBiliResolver } from "./resolver.js";
import { createBrowserFetch } from "./server/browser-fetch.js";
import { streamCacheSeconds } from "./streams.js";

const PORT = Number.parseInt(process.env.PORT ?? "3000", 10);
const HOST = process.env.HOST ?? "127.0.0.1";
const browserMode = process.env.BILI_BROWSER_FETCH === "1";
const resolver = createBiliResolver(() => process.env.BILIBILI_COOKIE, browserMode ? {
  fetcher: createBrowserFetch(),
  dashOnly: true,
} : {});
export const resolveBili = resolver.resolveBili;
export const app = express();
app.disable("x-powered-by");

app.get("/health", (_req, res) => res.json({ status: "ok", provider: browserMode ? "selfhost-browser" : "direct" }));

function first(value) {
  return Array.isArray(value) ? value[0] : value;
}

app.get(["/api/any", "/v2"], async (req, res) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Cache-Control", "no-store");
  const text = first(req.query.text ?? req.query.url);
  if (!text) {
    return res.status(400).json({ status: "error", message: "缺少 text 或 url 参数" });
  }
  try {
    const payload = await resolver.resolveFromText(text, first(req.query.p), first(req.query.qn));
    res.set("Cache-Control", `public, max-age=${streamCacheSeconds(payload)}`);
    return res.json(payload);
  } catch (error) {
    return res.status(500).json({ status: "error", message: error.message });
  }
});

app.use((_req, res) => {
  res.status(404).json({ status: "error", message: "Not Found" });
});

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  app.listen(PORT, HOST, () => {
    console.log(`Bili resolver listening on http://${HOST}:${PORT}`);
  });
}
