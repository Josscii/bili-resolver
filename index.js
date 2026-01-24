/**
 * Bilibili Resolver & Proxy Worker (v2.5 Universal Path)
 * 
 * 新增功能：
 * 1. 万能路径解析：支持 /【视频标题】 https://b23.tv/xxx 这种混合文本直接访问
 * 2. 自动提取逻辑：无论路径里混杂了什么中文或符号，只要包含 BV号 或 b23.tv 链接即可识别
 * 3. 继承 v2.4 的所有 UI 和下载功能
 */

const REFERER = 'https://www.bilibili.com/';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// --- 错误码字典 ---
const ERROR_MAP = {
    '-400': '请求错误', '-403': '访问权限不足', '-404': '视频不存在', 
    '-10403': '仅限港澳台地区', '62002': '视频不可见', '62004': '审核中'
};

// --- WBI 签名算法 ---
const mixinKeyEncTab = [46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52];
const getMixinKey = (orig) => mixinKeyEncTab.map(n => orig[n]).join('').slice(0, 32);
async function md5(text) {
    const msgUint8 = new TextEncoder().encode(text);
    const hashBuffer = await crypto.subtle.digest('MD5', msgUint8);
    return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}
async function signWbi(params) {
    const res = await fetch("https://api.bilibili.com/x/web-interface/nav", { headers: { "User-Agent": UA } });
    const json = await res.json();
    const { img_url, sub_url } = json.data.wbi_img;
    const mixin_key = getMixinKey(img_url.split('/').pop().split('.')[0] + sub_url.split('/').pop().split('.')[0]);
    const curr_params = { ...params, wts: Math.floor(Date.now() / 1000) };
    const query = Object.keys(curr_params).sort().map(k => `${k}=${encodeURIComponent(curr_params[k])}`).join('&');
    const w_rid = await md5(query + mixin_key);
    return query + `&w_rid=${w_rid}`;
}

// --- 业务逻辑 ---
async function extractBvid(text) {
    // 1. 优先匹配 BV 号
    let match = text.match(/(BV[a-zA-Z0-9]{10})/);
    if (match) return match[1];

    // 2. 匹配 b23.tv 短链 (即使混在中文里)
    const b23Match = text.match(/b23\.tv\/([a-zA-Z0-9]+)/);
    if (b23Match) {
        try {
            const res = await fetch(`https://b23.tv/${b23Match[1]}`, { method: 'HEAD', redirect: 'follow', headers: { 'User-Agent': UA } });
            match = res.url.match(/(BV[a-zA-Z0-9]{10})/);
            if (match) return match[1];
        } catch (e) {}
    }
    // 3. 匹配完整 bilibili.com 链接
    const urlMatch = text.match(/video\/(BV[a-zA-Z0-9]{10})/);
    if (urlMatch) return urlMatch[1];

    throw new Error("无效的链接");
}

async function resolveBili(bvid, qn, host) {
    const vRes = await fetch(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`, { headers: { 'User-Agent': UA } });
    const vData = await vRes.json();
    if (vData.code !== 0) throw new Error(ERROR_MAP[vData.code] || vData.message);

    const { cid, title, pic, owner } = vData.data;
    const signedQuery = await signWbi({ bvid, cid, qn: qn || 80, fnval: 1 });
    const pRes = await fetch(`https://api.bilibili.com/x/player/wbi/playurl?${signedQuery}`, {
        headers: { 'User-Agent': UA, 'Referer': REFERER }
    });
    const pData = await pRes.json();
    if (pData.code !== 0) throw new Error(ERROR_MAP[pData.code] || "解析失败");

    const rawUrl = pData.data.durl[0].url;
    const playableUrl = `${host}/proxy?url=${encodeURIComponent(rawUrl)}&name=${encodeURIComponent(title)}`;
    const downloadUrl = `${playableUrl}&dl=1`;

    return { title, pic, bvid, author: owner.name, playableUrl, downloadUrl };
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
    </style>
</head>
<body class="text-slate-100 min-h-screen flex items-center justify-center p-4">
    <div class="bg-gradient-mesh"></div>
    <div id="bg-cover"></div>
    <div class="w-full max-w-lg relative z-10">
        <div class="text-center mb-8 space-y-1">
            <h1 class="text-4xl font-black tracking-tighter text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-pink-500">BILI PARSER</h1>
            <p class="text-xs font-bold text-slate-500 tracking-[0.4em] uppercase">High Speed & Direct Link</p>
        </div>
        <div class="glass rounded-3xl p-6 space-y-5 transition-all duration-300 hover:border-white/20">
            <div class="space-y-3">
                <input type="text" id="input" placeholder="在此粘贴视频链接..." 
                    class="w-full bg-slate-900/60 border border-slate-700/50 rounded-xl px-4 py-4 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all placeholder-slate-500 text-center">
                <div class="flex gap-2">
                    <select id="qn" class="bg-slate-900/60 border border-slate-700/50 rounded-xl px-3 py-3 text-xs outline-none text-slate-300 w-1/3 text-center appearance-none">
                        <option value="80">1080P 高画质</option>
                        <option value="64">720P 标准</option>
                        <option value="32">480P 流畅</option>
                    </select>
                    <button onclick="doParse()" class="flex-1 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-bold py-3 rounded-xl transition-all shadow-lg shadow-blue-500/20 active:scale-95">立即解析</button>
                </div>
            </div>
            <div id="loader" class="hidden py-8 text-center"><div class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div><p class="text-xs text-slate-400 mt-2 font-mono">PROCESSING...</p></div>
            <div id="result" class="hidden space-y-5 pt-2 border-t border-white/5">
                <div class="flex gap-4 items-start">
                    <img id="resPic" class="w-28 h-16 object-cover rounded-lg shadow-md bg-slate-800 shrink-0">
                    <div class="min-w-0 flex-1 space-y-1">
                        <h3 id="resTitle" class="text-sm font-bold leading-tight line-clamp-2 text-white/90"></h3>
                        <div class="flex items-center gap-2"><span id="resAuthor" class="text-[10px] text-slate-400"></span><span class="text-[10px] bg-blue-500/20 text-blue-300 px-1.5 py-0.5 rounded">MP4</span></div>
                    </div>
                </div>
                <div class="relative group">
                    <input id="link" readonly class="w-full bg-slate-900/40 border border-slate-700/50 rounded-xl px-4 py-3 text-xs text-slate-300 outline-none font-mono tracking-tight cursor-text focus:bg-slate-900/80 transition-colors">
                    <button onclick="copy('link')" id="copyBtn" class="absolute right-2 top-2 bg-slate-700/50 hover:bg-slate-600 text-xs px-3 py-1 rounded-lg transition-colors border border-white/5">复制</button>
                </div>
                <div class="grid grid-cols-2 gap-3">
                    <a id="btnPreview" target="_blank" class="flex items-center justify-center gap-2 bg-slate-700/50 hover:bg-slate-700 border border-white/5 py-3 rounded-xl text-sm font-bold transition-all group cursor-pointer">
                        <svg class="w-4 h-4 text-slate-300 group-hover:text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>在线预览
                    </a>
                    <a id="btnDownload" href="#" class="flex items-center justify-center gap-2 bg-gradient-to-r from-pink-600 to-rose-600 hover:from-pink-500 hover:to-rose-500 py-3 rounded-xl text-sm font-bold shadow-lg shadow-pink-500/20 transition-all active:scale-95 cursor-pointer">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>下载 MP4
                    </a>
                </div>
            </div>
        </div>
    </div>
    <script>
        function copy(id) { const el = document.getElementById(id); el.select(); document.execCommand('copy'); const btn = document.getElementById('copyBtn'); const original = btn.innerText; btn.innerText = 'OK'; btn.classList.add('text-green-400'); setTimeout(() => { btn.innerText = original; btn.classList.remove('text-green-400'); }, 1500); }
        async function doParse() {
            const inputVal = document.getElementById('input').value; const qn = document.getElementById('qn').value; if(!inputVal) return;
            document.getElementById('loader').classList.remove('hidden'); document.getElementById('result').classList.add('hidden'); document.getElementById('bg-cover').style.opacity = '0';
            try {
                const params = new URLSearchParams({ text: inputVal, qn: qn });
                const res = await fetch(\`/api/any?\${params.toString()}\`); const data = await res.json();
                if(data.status === 'success') {
                    const pic = data.pic.replace('http:', 'https:');
                    document.getElementById('resPic').src = pic; document.getElementById('bg-cover').style.backgroundImage = \`url('\${pic}')\`; document.getElementById('bg-cover').style.opacity = '0.4';
                    document.getElementById('resTitle').innerText = data.title; document.getElementById('resAuthor').innerText = '@' + data.author; document.getElementById('link').value = data.playableUrl;
                    document.getElementById('btnPreview').href = data.playableUrl; document.getElementById('btnDownload').href = data.downloadUrl;
                    document.getElementById('result').classList.remove('hidden');
                } else { alert(data.message); }
            } catch(e) { alert('请求失败'); } finally { document.getElementById('loader').classList.add('hidden'); }
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

        // 1. 代理视频流
        if (path === '/proxy') {
            const target = url.searchParams.get('url');
            const name = url.searchParams.get('name');
            const isDownload = url.searchParams.get('dl') === '1';

            if (!target) return new Response('Missing URL', { status: 400 });
            try {
                const targetUrl = new URL(target);
                if (!targetUrl.hostname.includes('bilivideo') && !targetUrl.hostname.includes('hdslb') && !targetUrl.hostname.includes('akamaized')) {
                    return new Response('Forbidden', { status: 403 });
                }
            } catch(e) { return new Response('Invalid URL', { status: 400 }); }

            const newHeaders = new Headers({ 'Referer': REFERER, 'User-Agent': UA });
            if (request.headers.has("Range")) newHeaders.set("Range", request.headers.get("Range"));

            const response = await fetch(target, { headers: newHeaders });
            const responseHeaders = new Headers(response.headers);
            responseHeaders.set("Access-Control-Allow-Origin", "*");

            if (name) {
                const safeName = name.replace(/["\r\n]/g, "");
                const disposition = isDownload ? 'attachment' : 'inline';
                responseHeaders.set("Content-Disposition", `${disposition}; filename="${encodeURIComponent(safeName)}.mp4"`);
            }
            return new Response(response.body, { status: response.status, statusText: response.statusText, headers: responseHeaders });
        }

        // 2. 首页
        if (path === '/' || path === '') {
            return new Response(UI(host), { headers: { 'Content-Type': 'text/html;charset=UTF-8' } });
        }

        // 3. API 接口
        if (path === '/api/any') {
            const text = url.searchParams.get('text');
            const qn = url.searchParams.get('qn') || 80;
            if (!text) return new Response(JSON.stringify({ status: 'error' }), { status: 400 });

            const cache = caches.default;
            const cacheKey = new Request(url.toString(), request);
            let response = await cache.match(cacheKey);
            
            if (!response) {
                try {
                    const bvid = await extractBvid(text);
                    const res = await resolveBili(bvid, qn, host);
                    response = new Response(JSON.stringify({ status: 'success', ...res }), {
                        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=1200' }
                    });
                    ctx.waitUntil(cache.put(cacheKey, response.clone()));
                } catch (e) {
                    return new Response(JSON.stringify({ status: 'error', message: e.message }), { status: 500 });
                }
            }
            return response;
        }

        // 4. [新功能] 万能路径匹配 (Catch-All Route)
        // 逻辑：如果路径不是系统路径，尝试解码并提取 B站链接
        // 例子：/【Ether Strike.mp4-哔哩哔哩】 https://b23.tv/OoyY97Z
        // 例子：/BV1xx411c7x
        if (path.length > 1) {
            try {
                // 解码路径 (处理 %E3%80... 等编码)
                const rawPath = decodeURIComponent(path.slice(1));
                
                // 尝试提取
                const bvid = await extractBvid(rawPath);
                
                if (bvid) {
                    // 解析并重定向到播放代理
                    const res = await resolveBili(bvid, 80, host);
                    return Response.redirect(res.playableUrl, 302);
                }
            } catch (e) {
                // 提取失败则继续往下走 (返回 404)
            }
        }

        return new Response('Not Found', { status: 404 });
    }
}
