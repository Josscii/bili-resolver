import assert from "node:assert/strict";
import test from "node:test";
import { createTikHubResolver } from "../tikhub.js";
import downloader from "../downloader.js";

function mockTikHub(t, playResponse) {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (input, options) => {
    const url = new URL(input);
    calls.push(url);
    assert.equal(url.origin, "https://api.tikhub.io");
    assert.equal(options.headers.Authorization, "Bearer test-key");
    if (url.pathname.endsWith("/fetch_one_video")) {
      return Response.json({ code: 200, data: { code: 0, data: {
        bvid: "BV14R4y1M7PF", cid: 11, title: "标题", pic: "https://example.com/cover.jpg",
        desc: "简介", owner: { name: "作者" },
        pages: [{ page: 1, cid: 11, part: "" }, { page: 2, cid: 22, part: "第二集" }],
      } } });
    }
    assert.ok(url.pathname.endsWith("/fetch_video_playurl"));
    return playResponse ? playResponse(url) : Response.json({ code: 200, data: { code: 0, data: {
      quality: 32, dash: {
        video: [
          { id: 32, height: 480, bandwidth: 1000, codecid: 7, baseUrl: "https://example.com/video.m4s" },
          { id: 32, height: 480, bandwidth: 500, codecid: 12, baseUrl: "https://example.com/hevc.m4s" },
          { id: 16, height: 360, bandwidth: 500, codecid: 7, baseUrl: "https://example.com/low.m4s" },
        ],
        audio: [{ id: 30280, bandwidth: 192000, base_url: "https://example.com/audio.m4s" }],
      },
    } } });
  });
  return calls;
}

test("TikHub merges concurrent requests, retains lists and isolates pages", async (t) => {
  const calls = mockTikHub(t);
  const resolver = createTikHubResolver("test-key");
  const link = "https://www.bilibili.com/video/BV14R4y1M7PF";
  const results = await Promise.all(Array.from({ length: 5 }, () => resolver.resolveFromText(link, 1)));
  assert.equal(calls.length, 2);
  const result = results[0];
  assert.equal(result.title, "标题");
  assert.equal(result.author, "作者");
  assert.equal(result.url, null);
  assert.deepEqual(result.videos.map((video) => video.height), [480, 360]);
  assert.equal(result.audios[0].bitrate, 192);
  assert.equal(result.videos[0].filesize, null);
  const second = await resolver.resolveFromText(`${link}?p=2`, 1);
  assert.equal(second.title, "第二集");
  assert.equal(second.p, 2);
  assert.equal(calls.length, 3);
  assert.equal(calls[2].searchParams.get("cid"), "22");
});

test("TikHub retries failures and empty streams without caching false success", async (t) => {
  let attempt = 0;
  const calls = mockTikHub(t, () => {
    attempt++;
    if (attempt === 1) return Response.json({ detail: "upstream error" }, { status: 503 });
    if (attempt === 2) return Response.json({ code: 200, data: { code: 0, data: { dash: {} } } });
    return Response.json({ code: 200, data: { code: 0, data: { quality: 32, durl: [{ url: "https://example.com/combined.mp4" }] } } });
  });
  const resolver = createTikHubResolver("test-key");
  const link = "https://www.bilibili.com/video/BV14R4y1M7PF";
  await assert.rejects(resolver.resolveFromText(link), /503/);
  await assert.rejects(resolver.resolveFromText(link), /未返回可用音视频流/);
  assert.equal((await resolver.resolveFromText(link)).url, "https://example.com/combined.mp4");
  assert.equal(calls.length, 4);
});

test("downloader /bilibili uses TikHub and preserves page and CORS", async (t) => {
  const calls = mockTikHub(t);
  const request = new Request("https://downloader.example/bilibili?url=https%3A%2F%2Fwww.bilibili.com%2Fvideo%2FBV14R4y1M7PF%3Fp%3D2&qn=64");
  const response = await downloader.fetch(request, { TIKHUB_API_KEY: "test-key" });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "*");
  const data = await response.json();
  assert.equal(data.status, "success");
  assert.equal(data.p, 2);
  assert.equal(data.title, "第二集");
  assert.equal(data.audios.length, 1);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].searchParams.get("cid"), "22");
});
