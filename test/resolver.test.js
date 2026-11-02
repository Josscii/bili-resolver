import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { once } from "node:events";
import test from "node:test";

const bvid = "BV1xx411c7mD";
const video = {
  cid: 11,
  title: "视频",
  desc: "简介",
  owner: { name: "作者" },
  pages: [{ page: 1, cid: 11, part: "第一集" }, { page: 2, cid: 22, part: "第二集" }],
};
const json = (body) => Response.json(body);
let moduleId = 0;
const loadResolver = () => import(`../index.js?test=${moduleId++}`);

function setCookie(t, value) {
  const previous = process.env.BILIBILI_COOKIE;
  process.env.BILIBILI_COOKIE = value;
  t.after(() => {
    if (previous === undefined) delete process.env.BILIBILI_COOKIE;
    else process.env.BILIBILI_COOKIE = previous;
  });
}

function mockApi(t, infoResponse) {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (input, options) => {
    const url = new URL(input);
    calls.push({ url, options });
    if (url.pathname === "/x/web-interface/view") return infoResponse();
    if (url.pathname === "/x/web-interface/wbi/view") return json({ code: 0, data: video });
    if (url.pathname === "/x/web-interface/nav") {
      return json({
        code: -101,
        data: { wbi_img: {
          img_url: "https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png",
          sub_url: "https://i0.hdslb.com/bfs/wbi/4932caff0ff746eab6f01bf08b70ac45.png",
        } },
      });
    }
    if (url.pathname === "/x/player/wbi/playurl") {
      if (url.searchParams.get("fnval") === "4048") {
        return json({ code: 0, data: { dash: { video: [], audio: [] } } });
      }
      return json({ code: 0, data: { durl: [{ url: "https://example.com/video.mp4" }], quality: 64 } });
    }
    throw new Error(`Unexpected request: ${url}`);
  });
  return calls;
}

test("HTTP 412 falls back to signed video info and preserves page selection", async (t) => {
  setCookie(t, "SESSDATA=test-session; buvid3=test-device");
  const calls = mockApi(t, () => new Response("blocked", { status: 412 }));
  const { resolveBili } = await loadResolver();
  const result = await resolveBili(bvid, 2, 64);
  assert.equal(result.title, "第二集");
  assert.equal(result.description, "简介");
  assert.equal(result.author, "作者");
  assert.equal(result.url, "https://example.com/video.mp4");
  const signedInfo = calls.find(({ url }) => url.pathname === "/x/web-interface/wbi/view").url;
  assert.equal(signedInfo.searchParams.get("bvid"), bvid);
  const signature = signedInfo.searchParams.get("w_rid");
  signedInfo.searchParams.delete("w_rid");
  assert.equal(signature, createHash("md5")
    .update(`${signedInfo.searchParams.toString()}ea1db124af3c7062474693fa704f4ff8`).digest("hex"));
  for (const { url, options } of calls) {
    assert.equal(options.headers.Referer, "https://www.bilibili.com/");
    assert.equal(options.headers.Cookie, "SESSDATA=test-session; buvid3=test-device");
    assert.ok(options.signal instanceof AbortSignal);
    if (url.pathname === "/x/player/wbi/playurl") assert.equal(url.searchParams.get("cid"), "22");
  }
  assert.equal(calls.filter(({ url }) => url.pathname.endsWith("/nav")).length, 1);
});

for (const code of [-352, -412]) {
  test(`API risk code ${code} falls back to WBI`, async (t) => {
    const calls = mockApi(t, () => json({ code, message: "风控校验失败" }));
    const { resolveBili } = await loadResolver();
    await resolveBili(bvid, 1, 64);
    assert.ok(calls.some(({ url }) => url.pathname === "/x/web-interface/wbi/view"));
  });
}

test("deleted videos do not trigger fallback requests", async (t) => {
  const calls = mockApi(t, () => json({ code: -404, message: "Not Found" }));
  const { resolveBili } = await loadResolver();
  await assert.rejects(resolveBili(bvid, 1, 64), /视频不存在/);
  assert.equal(calls.length, 1);
});

test("concurrent playback requests share a WBI key request", async (t) => {
  setCookie(t, "");
  const calls = mockApi(t, () => json({ code: 0, data: video }));
  const { resolveBili } = await loadResolver();
  await Promise.all([resolveBili(bvid, 1, 64), resolveBili(bvid, 2, 64)]);
  assert.equal(calls.filter(({ url }) => url.pathname.endsWith("/nav")).length, 1);
  assert.ok(calls.every(({ options }) => !Object.hasOwn(options.headers, "Cookie")));
});

test("blocked responses are not cached and subsequent requests can recover", async (t) => {
  const realFetch = globalThis.fetch;
  const calls = mockApi(t, () => new Response("blocked", { status: 412 }));
  const apiFetch = globalThis.fetch;
  let blocked = true;
  t.mock.method(globalThis, "fetch", (input, options) => {
    if (blocked && new URL(input).pathname === "/x/web-interface/wbi/view") {
      return Promise.resolve(new Response("blocked", { status: 412 }));
    }
    return apiFetch(input, options);
  });
  const { app } = await loadResolver();
  const server = app.listen(0, "127.0.0.1");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await once(server, "listening");
  const url = `http://127.0.0.1:${server.address().port}/v2?url=https://www.bilibili.com/video/${bvid}`;
  const failure = await realFetch(url);
  assert.equal(failure.status, 500);
  assert.equal(failure.headers.get("cache-control"), "no-store");
  assert.match((await failure.json()).message, /风控.*412/);
  blocked = false;
  const success = await realFetch(url);
  assert.equal(success.status, 200);
  assert.equal((await success.json()).status, "success");
  const requestCount = calls.length;
  assert.equal((await realFetch(url)).status, 200);
  assert.equal(calls.length, requestCount);
});

test("self-hosted DASH mode coalesces requests and reuses metadata across pages", async () => {
  const { createBiliResolver } = await import('../resolver.js');
  const calls = [];
  const fetcher = async (input) => {
    const url = new URL(input);
    calls.push(url);
    if (url.pathname.endsWith('/view')) return json({ code: 0, data: video });
    if (url.pathname.endsWith('/nav')) return json({ data: { wbi_img: {
      img_url: 'https://example.com/7cd084941338484aae1ad9425b84077c.png',
      sub_url: 'https://example.com/4932caff0ff746eab6f01bf08b70ac45.png',
    } } });
    assert.equal(url.searchParams.get('fnval'), '4048');
    return json({ code: 0, data: { dash: {
      video: [{ baseUrl: 'https://example.com/video', height: 360, id: 16, codecid: 7 }],
      audio: [{ baseUrl: 'https://example.com/audio', bandwidth: 64000, id: 30216 }],
    } } });
  };
  const resolver = createBiliResolver(() => '', { dashOnly: true, fetcher });
  const link = `https://www.bilibili.com/video/${bvid}`;
  const [first, duplicate] = await Promise.all([resolver.resolveFromText(link, 1), resolver.resolveFromText(link, 1)]);
  assert.deepEqual(first, duplicate);
  assert.equal(first.url, null);
  assert.equal(first.videos.length, 1);
  assert.equal(first.audios.length, 1);
  const second = await resolver.resolveFromText(link, 2);
  assert.equal(second.title, '第二集');
  await resolver.resolveFromText(link, 1);
  assert.equal(calls.filter(url => url.pathname.endsWith('/view')).length, 1);
  assert.equal(calls.filter(url => url.pathname.endsWith('/playurl')).length, 2);
  assert.deepEqual(calls.filter(url => url.pathname.endsWith('/playurl')).map(url => url.searchParams.get('cid')), ['11', '22']);
});
