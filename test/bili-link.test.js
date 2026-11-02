import assert from "node:assert/strict";
import test from "node:test";
import { extractBvidAndP } from "../bili-link.js";

test("short links use the redirect target without requesting the blocked video page", async (t) => {
  let requests = 0;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    requests++;
    assert.equal(new URL(url).hostname, "b23.tv");
    assert.equal(options.redirect, "manual");
    return new Response(null, { status: 302, headers: { Location: "https://www.bilibili.com/video/BV14R4y1M7PF?p=2" } });
  });
  assert.deepEqual(await extractBvidAndP("分享 https://b23.tv/abcd", 1), { bvid: "BV14R4y1M7PF", p: 2 });
  assert.equal(requests, 1);
});

test("short links reject redirects to unrelated hosts", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response(null, {
    status: 302, headers: { Location: "https://example.com/video/BV14R4y1M7PF" },
  }));
  await assert.rejects(extractBvidAndP("https://b23.tv/abcd"), /无效的 B 站链接/);
});
