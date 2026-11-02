import assert from "node:assert/strict";
import test from "node:test";
import worker from "../worker.js";

test("self-hosted mode never calls TikHub even when its credential is configured", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (input, options) => {
    const url = new URL(input);
    calls.push(url);
    assert.equal(url.origin, "https://resolver.example");
    assert.equal(url.searchParams.get("p"), "2");
    assert.equal(options.headers.Authorization, "Bearer private-token");
    assert.equal(options.redirect, "manual");
    return Response.json({ status: "error", message: "upstream blocked" }, { status: 503 });
  });
  const response = await worker.fetch(new Request("https://gateway.example/v2?url=https://www.bilibili.com/video/BV14R4y1M7PF&p=2"), {
    BILI_PROVIDER: "selfhost", BILI_UPSTREAM_URL: "https://resolver.example/v2", BILI_UPSTREAM_TOKEN: "private-token", TIKHUB_API_KEY: "must-not-be-used",
  });
  assert.equal(response.status, 500);
  assert.equal(calls.length, 1);
  assert.match((await response.json()).message, /503/);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
});

test("self-hosted mode preserves stream lists and reports the active provider", async (t) => {
  const payload = { status: "success", bvid: "BV14R4y1M7PF", p: 1, videos: [], audios: [{ url: "https://example.com/audio", bitrate: 128, backup_urls: [] }] };
  t.mock.method(globalThis, "fetch", async () => Response.json(payload));
  const response = await worker.fetch(new Request("https://gateway.example/v2?url=https://www.bilibili.com/video/BV14R4y1M7PF"), {
    BILI_PROVIDER: "selfhost", BILI_UPSTREAM_URL: "https://resolver.example/v2",
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("X-Bili-Provider"), "selfhost");
  assert.deepEqual(await response.json(), payload);
});
