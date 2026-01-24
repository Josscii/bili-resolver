/**
 * Bilibili Resolver & Proxy Worker
 * 路由规则：
 * - /               : 解析 UI 界面
 * - /BVxxxxxx       : 直接 302 重定向到视频流
 * - /json/BVxxxxxx  : 获取解析结果 JSON
 * - /proxy?url=...  : 视频流中转代理
 */

const REFERER = 'https://www.bilibili.com/';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// --- WBI 加密核心算法 ---
const mixinKeyEncTab = [
    46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
    33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40,
    61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11,
    36, 20, 34, 44, 52
];

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
    const img_key = img_url.split('/').pop().split('.')[0];
    const sub_key = sub_url.split('/').pop().split('.')[0];
    const mixin_key = getMixinKey(img_key + sub_key);
    const curr_params = { ...params, wts: Math.floor(Date.now() / 1000) };
    const query = Object.keys(curr_params).sort().map(k => `${k}=${encodeURIComponent(curr_params[k])}`).join('&');
    const w_rid = await md5(query + mixin_key);
    return query + `&w_rid=${w_rid}`;
}

// --- 后端解析引擎 ---
async function resolveBili(bvid, qn, host) {
    const vRes = await fetch(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`, { headers: { 'User-Agent': UA } });
    const vData = await vRes.json();
    if (vData.code !== 0) throw new Error(vData.message);

    const { cid, title, pic } = vData.data;
    const signedQuery = await signWbi({ bvid, cid, qn: qn || 80, fnval: 1 });
    const pRes = await fetch(`https://api.bilibili.com/x/player/wbi/playurl?${signedQuery}`, {
        headers: { 'User-Agent': UA, 'Referer': REFERER }
    });
    const pData = await pRes.json();
    if (pData.code !== 0) throw new Error("解析地址失败");

    const rawUrl = pData.data.durl[0].url;
    const playableUrl = `${host}/proxy?url=${encodeURIComponent(rawUrl)}`;

    return { title, pic, bvid, cid, rawUrl, playableUrl };
}

// --- UI 界面 ---
const UI = (host) => `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Bilibili 解析站</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <style>
        body { background-color: #0f172a; }
        .glass { background: rgba(255, 255, 255, 0.03); backdrop-filter: blur(12px); border: 1px solid rgba(255, 255, 255, 0.1); }
    </style>
</head>
<body class="text-slate-200 min-h-screen p-4 flex items-center justify-center">
    <div class="max-w-xl w-full space-y-6">
        <div class="text-center space-y-2">
            <h1 class="text-4xl font-black text-blue-500 italic tracking-tighter">BILIBILI PARSER</h1>
            <p class="text-slate-500 text-[10px] font-bold tracking-[0.3em] uppercase">High Definition Resolution</p>
        </div>

        <div class="glass p-6 rounded-3xl space-y-4 shadow-2xl">
            <input type="text" id="input" placeholder="输入视频链接或 BV 号..." 
                class="w-full bg-slate-800/50 border border-slate-700 rounded-2xl px-5 py-4 focus:ring-2 focus:ring-blue-500 outline-none transition-all">
            
            <div class="flex gap-3">
                <select id="qn" class="bg-slate-800 border border-slate-700 rounded-xl px-4 py-2 text-sm outline-none flex-1 text-slate-300">
                    <option value="80" selected>1080P 高清</option>
                    <option value="64">720P 高清</option>
                    <option value="32">480P 清晰</option>
                    <option value="16">360P 流畅</option>
                </select>
                <button onclick="doParse()" class="bg-blue-600 hover:bg-blue-500 px-8 py-3 rounded-xl font-bold transition-all shadow-lg">解析</button>
            </div>
        </div>

        <div id="loader" class="hidden text-center py-6 animate-pulse text-blue-400 font-bold">处理中...</div>

        <div id="result" class="hidden glass p-6 rounded-3xl space-y-6">
            <div class="flex gap-4">
                <img id="resPic" referrerpolicy="no-referrer" class="w-40 h-24 object-cover rounded-xl border border-white/5 shadow-lg bg-slate-800">
                <div class="flex-1 space-y-2">
                    <h2 id="resTitle" class="font-bold text-lg line-clamp-2 leading-tight"></h2>
                    <span id="resBvid" class="inline-block px-3 py-1 bg-blue-500/10 text-blue-400 text-[10px] font-bold rounded-full uppercase"></span>
                </div>
            </div>
            
            <div class="space-y-3">
                <div class="relative">
                    <label class="text-[10px] font-bold text-slate-500 mb-1 block uppercase tracking-widest">可播放直链 (免防盗链)</label>
                    <div class="flex gap-2">
                        <input id="link" readonly class="w-full bg-slate-900/50 border border-slate-800 p-3 rounded-xl text-xs text-blue-300 outline-none">
                        <button onclick="copy('link')" id="copyBtn" class="bg-slate-700 px-4 rounded-xl text-xs font-bold hover:bg-slate-600 transition-colors">复制</button>
                    </div>
                </div>
                <a id="play" target="_blank" class="block w-full py-4 bg-white text-black text-center rounded-2xl font-black hover:bg-slate-200 transition-all">立即进入播放</a>
            </div>
        </div>
    </div>

    <script>
        function copy(id) {
            const el = document.getElementById(id);
            el.select();
            document.execCommand('copy');
            const btn = document.getElementById('copyBtn');
            btn.innerText = '已复制';
            setTimeout(() => btn.innerText = '复制', 1500);
        }

        async function doParse() {
            const input = document.getElementById('input').value;
            const bvid = input.match(/(BV[a-zA-Z0-9]{10})/)?.[1];
            const qn = document.getElementById('qn').value;
            if(!bvid) return alert('请输入有效链接');
            
            document.getElementById('loader').classList.remove('hidden');
            document.getElementById('result').classList.add('hidden');

            try {
                const res = await fetch(\`/json/\${bvid}?qn=\${qn}\`);
                const data = await res.json();
                if(data.status === 'success') {
                    document.getElementById('resPic').src = data.pic.replace('http:', 'https:');
                    document.getElementById('resTitle').innerText = data.title;
                    document.getElementById('resBvid').innerText = data.bvid;
                    document.getElementById('link').value = data.playableUrl;
                    document.getElementById('play').href = data.playableUrl;
                    document.getElementById('result').classList.remove('hidden');
                } else { alert('解析失败'); }
            } catch(e) { alert('请求出错'); }
            finally { document.getElementById('loader').classList.add('hidden'); }
        }
    </script>
</body>
</html>
`;

// --- 路由处理 ---
export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        const host = url.origin;
        const path = url.pathname;

        // 1. 代理视频流
        if (path === '/proxy') {
            const target = url.searchParams.get('url');
            if (!target) return new Response('Missing URL', { status: 400 });
            return fetch(target, { headers: { 'Referer': REFERER, 'User-Agent': UA } });
        }

        // 2. 首页 UI
        if (path === '/' || path === '') {
            return new Response(UI(host), { headers: { 'Content-Type': 'text/html;charset=UTF-8' } });
        }

        // 3. JSON 模式 (/json/BV...)
        if (path.startsWith('/json/BV')) {
            const bvid = path.split('/')[2];
            const qn = url.searchParams.get('qn') || 80;
            try {
                const res = await resolveBili(bvid, qn, host);
                return new Response(JSON.stringify({ status: 'success', ...res }), {
                    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
                });
            } catch (e) {
                return new Response(JSON.stringify({ status: 'error', message: e.message }), { status: 500 });
            }
        }

        // 4. 直接跳转播放 (/BV...)
        if (path.startsWith('/BV')) {
            const bvid = path.slice(1);
            const qn = url.searchParams.get('qn') || 80;
            try {
                const res = await resolveBili(bvid, qn, host);
                return Response.redirect(res.playableUrl, 302);
            } catch (e) {
                return new Response('解析跳转失败: ' + e.message, { status: 500 });
            }
        }

        return new Response('Not Found', { status: 404 });
    }
}
