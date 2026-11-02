import { createBiliResolver } from "./resolver.js";
import { createTikHubResolver } from "./tikhub.js";
import { streamCacheSeconds } from "./streams.js";
import { createSelfHostedResolver } from "./upstream.js";

let resolver;
let configuration;

function respond(body, status = 200, provider) {
  return Response.json(body, {
    status,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Cache-Control": status === 200 ? `public, max-age=${streamCacheSeconds(body)}` : "no-store",
      ...(provider ? { "X-Bili-Provider": provider } : {}),
    },
  });
}

export default {
  async fetch(request, env = {}) {
    const url = new URL(request.url);
    if (!["/", "/api/any", "/v2"].includes(url.pathname)) {
      return respond({ status: "error", message: "Not Found" }, 404);
    }
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
          "Cache-Control": "no-store",
        },
      });
    }
    if (request.method !== "GET") {
      const response = respond({ status: "error", message: "Method Not Allowed" }, 405);
      response.headers.set("Allow", "GET, OPTIONS");
      return response;
    }
    const text = url.searchParams.get("text") ?? url.searchParams.get("url");
    if (!text) {
      return respond({ status: "error", message: "缺少 text 或 url 参数" }, 400);
    }
    try {
      const provider = env.BILI_PROVIDER || (env.TIKHUB_API_KEY ? "tikhub" : "direct");
      const nextConfiguration = JSON.stringify([provider, env.BILIBILI_COOKIE, env.TIKHUB_API_KEY, env.BILI_UPSTREAM_URL, env.BILI_UPSTREAM_TOKEN]);
      if (!resolver || configuration !== nextConfiguration) {
        const cookie = env.BILIBILI_COOKIE;
        let nextResolver;
        if (provider === "selfhost") nextResolver = createSelfHostedResolver(env.BILI_UPSTREAM_URL, env.BILI_UPSTREAM_TOKEN);
        else if (provider === "tikhub") nextResolver = createTikHubResolver(env.TIKHUB_API_KEY);
        else if (provider === "direct") nextResolver = createBiliResolver(() => cookie);
        else throw new Error("未知的 BILI_PROVIDER 配置");
        resolver = nextResolver;
        configuration = nextConfiguration;
      }
      const payload = await resolver.resolveFromText(
        text,
        url.searchParams.get("p"),
        url.searchParams.get("qn"),
      );
      return respond(payload, 200, provider);
    } catch (error) {
      return respond({ status: "error", message: error.message }, 500);
    }
  },
};
