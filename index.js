/**
 * Bilibili Resolver & Proxy Worker (v2.7 Refined)
 *
 * 版本特性：
 * 1. Quest 兼容模式：勾选后强制 720P (H.264)，解决 VR 一体机黑屏问题。
 * 2. 智能容错：1080P 失败自动降级。
 * 3. 历史记录：本地保存最近 5 条。
 * 4. UI 微调：优化了 Quest 按钮的可见性和交互反馈。
 */

const REFERER = "https://www.bilibili.com/";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const ERROR_MAP = {
  "-400": "请求错误",
  "-403": "访问权限不足",
  "-404": "视频不存在",
  "-10403": "仅限港澳台地区",
  62002: "视频不可见",
  62004: "审核中",
};

// --- WBI 签名算法 ---
const mixinKeyEncTab = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
  33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61,
  26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36,
  20, 34, 44, 52,
];
const getMixinKey = (orig) =>
  mixinKeyEncTab
    .map((n) => orig[n])
    .join("")
    .slice(0, 32);
async function md5(text) {
  const msgUint8 = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest("MD5", msgUint8);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
async function signWbi(params) {
  const res = await fetch("https://api.bilibili.com/x/web-interface/nav", {
    headers: { "User-Agent": UA },
  });
  const json = await res.json();
  const { img_url, sub_url } = json.data.wbi_img;
  const mixin_key = getMixinKey(
    img_url.split("/").pop().split(".")[0] +
      sub_url.split("/").pop().split(".")[0],
  );
  const curr_params = { ...params, wts: Math.floor(Date.now() / 1000) };
  const query = Object.keys(curr_params)
    .sort()
    .map((k) => `${k}=${encodeURIComponent(curr_params[k])}`)
    .join("&");
  const w_rid = await md5(query + mixin_key);
  return query + `&w_rid=${w_rid}`;
}

async function extractBvidAndP(text) {
  let url = text.match(/https?:\/\/[^\s]+/g)?.[0];

  if (!url) throw new Error("无效的链接");

  const b23Match = url.match(/b23\.tv\/([a-zA-Z0-9]+)/);
  if (b23Match) {
    try {
      const res = await fetch(url, {
        method: "HEAD",
        redirect: "follow",
        headers: { "User-Agent": UA },
      });
      url = res.url;
    } catch (e) {
      throw new Error("无法解析 b23.tv 链接");
    }
  }

  const urlObj = new URL(url);
  const bvidMatch = urlObj.pathname.match(/(BV[a-zA-Z0-9]{10})/);
  const pMatch =
    urlObj.searchParams.get("p") || urlObj.pathname.match(/\/p(\d+)/);
  if (bvidMatch) {
    return {
      bvid: bvidMatch[1],
      p: pMatch ? parseInt(pMatch[1] || pMatch) : 1,
    };
  }

  throw new Error("无效的链接");
}

// 自动降级逻辑
async function getPlayUrlWithFallback(bvid, cid, targetQn) {
  const qualities = [targetQn, 64, 32].filter(
    (v, i, a) => a.indexOf(v) === i && v <= targetQn,
  );
  let lastError = null;
  for (const qn of qualities) {
    try {
      const signedQuery = await signWbi({
        bvid,
        cid,
        qn,
        fnval: 1,
        platform: "html5",
      });
      const pRes = await fetch(
        `https://api.bilibili.com/x/player/wbi/playurl?${signedQuery}`,
        {
          headers: { "User-Agent": UA, Referer: REFERER },
        },
      );
      const pData = await pRes.json();
      if (pData.code === 0 && pData.data.durl && pData.data.durl.length > 0) {
        return { url: pData.data.durl[0].url, quality: pData.data.quality };
      } else {
        lastError = pData.message || ERROR_MAP[pData.code];
      }
    } catch (e) {
      lastError = e.message;
    }
  }
  throw new Error(lastError || "解析失败");
}

async function resolveBili(bvid, p, qn) {
  const vRes = await fetch(
    `https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`,
    { headers: { "User-Agent": UA } },
  );
  const vData = await vRes.json();
  if (vData.code !== 0) throw new Error(ERROR_MAP[vData.code] || vData.message);

  let { cid, title, pic, owner, pages } = vData.data;

  if (p && pages && pages.length > 0) {
    const page = pages.find((pg) => pg.page === p) || pages[0];
    cid = page.cid;
    title = page.part;
  }

  const videoStream = await getPlayUrlWithFallback(bvid, cid, qn || 80);

  return {
    title,
    pic,
    bvid,
    p,
    author: owner.name,
    url: videoStream.url,
    quality: videoStream.quality,
  };
}

// --- UI 界面 ---
const UI = (host) => `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Bilibili 解析 & 下载</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;700;900&display=swap" rel="stylesheet">
    <style>
        body { background: #0f172a; font-family: 'Noto Sans SC', sans-serif; overflow-x: hidden; }
        .glass { background: rgba(30, 41, 59, 0.7); backdrop-filter: blur(20px); border: 1px solid rgba(255, 255, 255, 0.1); box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5); }
        .bg-gradient-mesh { background: radial-gradient(at 0% 0%, hsla(253,16%,7%,1) 0, transparent 50%), radial-gradient(at 50% 0%, hsla(225,39%,30%,1) 0, transparent 50%), radial-gradient(at 100% 0%, hsla(339,49%,30%,1) 0, transparent 50%); position: fixed; top: 0; left: 0; width: 100%; height: 100%; z-index: -1; }
        #bg-cover { position: fixed; top: 0; left: 0; width: 100%; height: 100%; z-index: -1; opacity: 0; transition: opacity 1s ease; background-size: cover; background-position: center; filter: blur(30px) brightness(0.4); transform: scale(1.1); }
        .toast { position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%) translateY(100px); background: rgba(0,0,0,0.8); color: white; padding: 10px 20px; rounded: 10px; transition: transform 0.3s ease; border-radius: 50px; font-size: 14px; z-index: 100; border: 1px solid rgba(255,255,255,0.2); }
        .toast.show { transform: translateX(-50%) translateY(0); }
    </style>
</head>
<body class="text-slate-100 min-h-screen flex flex-col items-center justify-center p-4">
    <div class="bg-gradient-mesh"></div>
    <div id="bg-cover"></div>

    <div class="w-full max-w-lg relative z-10">
        <div class="text-center mb-8 space-y-1">
            <h1 class="text-4xl font-black tracking-tighter text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-pink-500">BILI PARSER</h1>
            <p class="text-xs font-bold text-slate-500 tracking-[0.4em] uppercase">High Speed & Direct Link</p>
        </div>

        <div class="glass rounded-3xl p-6 space-y-4 transition-all duration-300 hover:border-white/20">
            <!-- 输入与按钮区域 -->
            <div class="space-y-3">
                <input type="text" id="input" placeholder="粘贴视频链接 (支持混杂文本)..." 
                    class="w-full bg-slate-900/60 border border-slate-700/50 rounded-xl px-4 py-4 text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all text-center placeholder-slate-500">
                
                <div class="flex gap-2">
                    <select id="qn" class="bg-slate-900/60 border border-slate-700/50 rounded-xl px-3 py-3 text-xs outline-none text-slate-300 w-1/3 text-center appearance-none">
                        <option value="80">1080P 高画质</option>
                        <option value="64">720P 标准</option>
                        <option value="32">480P 流畅</option>
                    </select>
                    <button onclick="doParse()" class="flex-1 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-bold py-3 rounded-xl transition-all shadow-lg shadow-blue-500/20 active:scale-95">立即解析</button>
                </div>
            </div>

            <!-- 优化后的 Quest 按钮布局 -->
            <div class="flex justify-between items-center px-1 pt-1 opacity-90">
                <span class="text-[10px] text-slate-500 font-bold tracking-widest opacity-50">OPTIONS</span>
                <label class="flex items-center gap-2 cursor-pointer group select-none">
                    <input type="checkbox" id="questMode" class="peer hidden">
                    <div class="w-3.5 h-3.5 rounded border border-slate-500 peer-checked:bg-blue-500 peer-checked:border-blue-500 transition-all flex items-center justify-center">
                        <svg class="w-2.5 h-2.5 text-white hidden peer-checked:block" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="4" d="M5 13l4 4L19 7"></path></svg>
                    </div>
                    <span class="text-xs text-slate-400 group-hover:text-slate-200 transition-colors peer-checked:text-blue-400 font-medium">Quest 兼容模式</span>
                </label>
            </div>

            <!-- 加载动画 -->
            <div id="loader" class="hidden py-8 text-center"><div class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div></div>

            <!-- 结果区域 -->
            <div id="result" class="hidden space-y-5 pt-4 border-t border-white/5">
                <div class="flex gap-4 items-start">
                    <img id="resPic" class="w-28 h-16 object-cover rounded-lg shadow-md bg-slate-800 shrink-0">
                    <div class="min-w-0 flex-1 space-y-1">
                        <h3 id="resTitle" class="text-sm font-bold leading-tight line-clamp-2 text-white/90"></h3>
                        <div class="flex items-center gap-2">
                            <span id="resAuthor" class="text-[10px] text-slate-400"></span>
                            <span id="resQuality" class="text-[10px] bg-blue-500/20 text-blue-300 px-1.5 py-0.5 rounded">MP4</span>
                        </div>
                    </div>
                </div>
                <div class="relative group">
                    <input id="link" readonly class="w-full bg-slate-900/40 border border-slate-700/50 rounded-xl px-4 py-3 text-xs text-slate-300 outline-none font-mono tracking-tight cursor-text focus:bg-slate-900/80 transition-colors">
                    <button onclick="copy('link')" id="copyBtn" class="absolute right-2 top-2 bg-slate-700/50 hover:bg-slate-600 text-xs px-3 py-1 rounded-lg transition-colors border border-white/5">复制</button>
                </div>
                <div class="grid grid-cols-2 gap-3">
                    <a id="btnPreview" target="_blank" class="flex items-center justify-center gap-2 bg-slate-700/50 hover:bg-slate-700 border border-white/5 py-3 rounded-xl text-sm font-bold transition-all group cursor-pointer">预览</a>
                    <a id="btnDownload" href="#" class="flex items-center justify-center gap-2 bg-gradient-to-r from-pink-600 to-rose-600 hover:from-pink-500 hover:to-rose-500 py-3 rounded-xl text-sm font-bold shadow-lg shadow-pink-500/20 transition-all active:scale-95 cursor-pointer">下载 MP4</a>
                </div>
            </div>
        </div>

        <div id="historyArea" class="hidden mt-6 w-full max-w-lg glass rounded-3xl p-5">
            <h4 class="text-xs font-bold text-slate-500 uppercase mb-3 flex justify-between">
                <span>最近解析</span>
                <span onclick="clearHistory()" class="cursor-pointer hover:text-white">清除</span>
            </h4>
            <div id="historyList" class="space-y-2"></div>
        </div>
    </div>

    <div id="toast" class="toast">消息提示</div>

    <script>
        function showToast(msg) { const t = document.getElementById('toast'); t.innerText = msg; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 3000); }
        function copy(id) { const el = document.getElementById(id); el.select(); document.execCommand('copy'); showToast('链接已复制到剪贴板'); }

        function loadHistory() {
            const h = JSON.parse(localStorage.getItem('bili_history') || '[]');
            const list = document.getElementById('historyList'); const area = document.getElementById('historyArea');
            list.innerHTML = '';
            if (h.length === 0) { area.classList.add('hidden'); return; }
            area.classList.remove('hidden');
            h.forEach(item => {
                const div = document.createElement('div');
                div.className = 'flex items-center gap-3 p-2 hover:bg-white/5 rounded-lg cursor-pointer transition-colors';
                div.onclick = () => { document.getElementById('input').value = item.url; doParse(); };
                div.innerHTML = \`<div class="w-10 h-6 bg-slate-800 rounded bg-cover bg-center" style="background-image:url('\${item.pic}')"></div><div class="flex-1 min-w-0"><p class="text-xs truncate text-slate-300">\${item.title}</p></div>\`;
                list.appendChild(div);
            });
        }
        function saveHistory(data) {
            let h = JSON.parse(localStorage.getItem('bili_history') || '[]'); h = h.filter(x => x.bvid !== data.bvid);
            h.unshift({ bvid: data.bvid, title: data.title, pic: data.pic, url: "https://www.bilibili.com/video/" + data.bvid });
            if (h.length > 5) h.pop(); localStorage.setItem('bili_history', JSON.stringify(h)); loadHistory();
        }
        function clearHistory() { localStorage.removeItem('bili_history'); loadHistory(); }
        loadHistory();

        async function doParse() {
            const inputVal = document.getElementById('input').value;
            const isQuest = document.getElementById('questMode').checked;
            const qn = isQuest ? 64 : document.getElementById('qn').value; // Quest模式强制64(720P)

            if(!inputVal) { showToast('请先输入视频链接'); return; }
            document.getElementById('loader').classList.remove('hidden'); document.getElementById('result').classList.add('hidden'); document.getElementById('bg-cover').style.opacity = '0';

            try {
                const params = new URLSearchParams({ text: inputVal, qn: qn });
                const res = await fetch(\`/api/any?\${params.toString()}\`); const data = await res.json();
                if(data.status === 'success') {
                    const pic = data.pic.replace('http:', 'https:');
                    document.getElementById('resPic').src = pic; document.getElementById('bg-cover').style.backgroundImage = \`url('\${pic}')\`; document.getElementById('bg-cover').style.opacity = '0.4';
                    document.getElementById('resTitle').innerText = data.title; document.getElementById('resAuthor').innerText = '@' + data.author;
                    
                    const qnMap = { 80: '1080P', 64: '720P', 32: '480P', 16: '360P' };
                    // 状态栏显示 Quest 标识
                    const qualityText = isQuest ? 'Quest (720P)' : (qnMap[data.quality] || 'MP4');
                    document.getElementById('resQuality').innerText = qualityText;
                    
                    document.getElementById('link').value = data.playableUrl;
                    document.getElementById('btnPreview').href = data.playableUrl; document.getElementById('btnDownload').href = data.downloadUrl;
                    saveHistory(data);
                    document.getElementById('result').classList.remove('hidden');
                } else { showToast(data.message); }
            } catch(e) { showToast('网络请求失败'); } finally { document.getElementById('loader').classList.add('hidden'); }
        }
    </script>
</body>
</html>
`;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const host = url.origin;
    const path = url.pathname;

    if (path === "/proxy") {
      const target = url.searchParams.get("url");
      const name = url.searchParams.get("name");
      const isDownload = url.searchParams.get("dl") === "1";
      if (!target) return new Response("Missing URL", { status: 400 });
      try {
        const targetUrl = new URL(target);
        if (
          !targetUrl.hostname.includes("bilivideo") &&
          !targetUrl.hostname.includes("hdslb") &&
          !targetUrl.hostname.includes("akamaized")
        )
          return new Response("Forbidden", { status: 403 });
      } catch (e) {
        return new Response("Invalid URL", { status: 400 });
      }
      const newHeaders = new Headers({ Referer: REFERER, "User-Agent": UA });
      if (request.headers.has("Range"))
        newHeaders.set("Range", request.headers.get("Range"));
      const response = await fetch(target, { headers: newHeaders });
      const responseHeaders = new Headers(response.headers);
      responseHeaders.set("Access-Control-Allow-Origin", "*");
      if (name) {
        const safeName = name.replace(/["\r\n]/g, "");
        const disposition = isDownload ? "attachment" : "inline";
        responseHeaders.set(
          "Content-Disposition",
          `${disposition}; filename="${encodeURIComponent(safeName)}.mp4"`,
        );
      }
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
      });
    }

    if (path === "/" || path === "")
      return new Response(UI(host), {
        headers: { "Content-Type": "text/html;charset=UTF-8" },
      });

    if (path === "/api/any") {
      const text = url.searchParams.get("text");
      const qn = url.searchParams.get("qn") || 64;
      if (!text)
        return new Response(JSON.stringify({ status: "error" }), {
          status: 400,
        });
      const cache = caches.default;
      const cacheKey = new Request(url.toString(), request);
      let response = await cache.match(cacheKey);
      if (!response) {
        try {
          const { bvid, p } = await extractBvidAndP(text);
          const res = await resolveBili(bvid, p, parseInt(qn));
          response = new Response(
            JSON.stringify({ status: "success", ...res }),
            {
              headers: {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*",
                "Cache-Control": "public, max-age=1200",
              },
            },
          );
          ctx.waitUntil(cache.put(cacheKey, response.clone()));
        } catch (e) {
          return new Response(
            JSON.stringify({ status: "error", message: e.message }),
            { status: 500 },
          );
        }
      }
      return response;
    }

    if (path.length > 1) {
      try {
        const rawPath = decodeURIComponent(path.slice(1));
        const bvid = await extractBvid(rawPath);
        if (bvid) {
          const res = await resolveBili(bvid, 80, host);
          return Response.redirect(res.playableUrl, 302);
        }
      } catch (e) {}
    }
    return new Response("Not Found", { status: 404 });
  },
};
