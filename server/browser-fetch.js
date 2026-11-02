import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

export function createBrowserFetch(python = process.env.BILI_PYTHON ?? '/opt/venv/bin/python') {
  let child;
  let sequence = 0;
  const pending = new Map();

  function start() {
    if (child) return;
    const process = spawn(python, [fileURLToPath(new URL('./browser-fetch.py', import.meta.url))], { stdio: ['pipe', 'pipe', 'inherit'] });
    child = process;
    const fail = (error) => {
      if (child !== process) return;
      child = undefined;
      for (const { reject } of pending.values()) reject(error);
      pending.clear();
    };
    process.on('error', fail);
    process.on('exit', () => fail(new Error('浏览器请求进程已退出')));
    process.stdin.on('error', fail);
    createInterface({ input: process.stdout }).on('line', (line) => {
      try {
        const message = JSON.parse(line);
        const request = pending.get(message.id);
        if (!request) return;
        pending.delete(message.id);
        if (message.error) request.reject(new Error(message.error));
        else request.resolve(new Response([204, 205, 304].includes(message.status) ? null : Buffer.from(message.body, 'base64'), { status: message.status, headers: message.headers }));
      } catch (error) {
        fail(error);
        process.kill();
      }
    });
  }

  const fetcher = async (url, options = {}) => {
    options.signal?.throwIfAborted();
    if (pending.size >= 32) throw new Error('解析请求繁忙，请稍后重试');
    start();
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        options.signal?.removeEventListener('abort', abort);
        pending.delete(id);
      };
      const finish = (callback) => (value) => { cleanup(); callback(value); };
      const abort = () => { cleanup(); reject(options.signal.reason); };
      const timer = setTimeout(() => { cleanup(); reject(new Error('解析请求超时')); }, 30_000);
      options.signal?.addEventListener('abort', abort, { once: true });
      pending.set(id, { resolve: finish(resolve), reject: finish(reject) });
      child.stdin.write(JSON.stringify({ id, url: String(url), method: options.method ?? 'GET', headers: Object.fromEntries(new Headers(options.headers)) }) + '\n');
    });
  };
  fetcher.close = () => child?.kill();
  return fetcher;
}
