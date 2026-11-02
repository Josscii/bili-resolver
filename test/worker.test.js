import assert from "node:assert/strict";
import test from "node:test";
import worker from "../worker.js";

test("Worker validates routes, methods, parameters and CORS", async () => {
  for (const [path, method, status] of [
    ["/", "GET", 400],
    ["/v2", "GET", 400],
    ["/api/any", "POST", 405],
    ["/missing", "GET", 404],
    ["/v2", "OPTIONS", 204],
  ]) {
    const response = await worker.fetch(new Request(`https://resolver.example${path}`, { method }));
    assert.equal(response.status, status);
    assert.equal(response.headers.get("Access-Control-Allow-Origin"), "*");
    assert.equal(response.headers.get("Cache-Control"), "no-store");
  }
});

test("Worker keeps response compatibility, page selection and shared cache across aliases", async (t) => {
  let requests = 0;
  t.mock.method(globalThis, "fetch", async (input) => {
    requests++;
    const url = new URL(input);
    if (url.pathname.endsWith("/view")) {
      return Response.json({ code: 0, data: {
        cid: 1, title: "视频标题", pic: "https://example.com/cover.jpg", desc: "简介",
        owner: { name: "作者" },
        pages: [{ page: 1, cid: 1, part: "" }, { page: 2, cid: 2, part: "第二集" }],
      } });
    }
    if (url.pathname.endsWith("/nav")) {
      return Response.json({ data: { wbi_img: {
        img_url: `https://example.com/${"a".repeat(32)}.png`,
        sub_url: `https://example.com/${"b".repeat(32)}.png`,
      } } });
    }
    assert.equal(url.pathname, "/x/player/wbi/playurl");
    const cid = url.searchParams.get("cid");
    return Response.json({ code: 0, data: {
      durl: [{ url: `https://example.com/${cid}.mp4` }], quality: 64,
      dash: { video: [{ baseUrl: `https://example.com/${cid}.m4s`, codecid: 7, id: 64, height: 720 }], audio: [] },
    } });
  });
  const link = "https://www.bilibili.com/video/BV14R4y1M7PF";
  const first = await worker.fetch(new Request(`https://resolver.example/v2?text=${encodeURIComponent(link)}`));
  const payload = await first.json();
  assert.equal(payload.status, "success");
  assert.equal(payload.title, "视频标题");
  assert.equal(payload.url, "https://example.com/1.mp4");
  assert.equal(payload.videos[0].height, 720);
  const before = requests;
  const cached = await worker.fetch(new Request(`https://resolver.example/api/any?url=${encodeURIComponent(link)}`));
  assert.deepEqual(await cached.json(), payload);
  assert.equal(requests, before);
  const second = await worker.fetch(new Request(`https://resolver.example/?url=${encodeURIComponent(`${link}?p=2`)}&qn=64`));
  assert.equal((await second.json()).title, "第二集");
  assert.ok(requests > before);
});
