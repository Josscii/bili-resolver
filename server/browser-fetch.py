import asyncio
import base64
import json
import sys
import time
from urllib.parse import urlparse
from curl_cffi.requests import AsyncSession

ALLOWED = {'api.bilibili.com', 'api.biliapi.com', 'www.bilibili.com', 'bilibili.com', 'b23.tv'}

async def main():
    session = AsyncSession(impersonate='chrome131', max_clients=4)
    semaphore = asyncio.Semaphore(4)
    bootstrap_lock = asyncio.Lock()
    bootstrapped = float("-inf")
    tasks = set()

    async def bootstrap():
        nonlocal bootstrapped
        async with bootstrap_lock:
            if time.monotonic() - bootstrapped < 21600:
                return
            response = await session.get('https://api.bilibili.com/x/frontend/finger/spi', timeout=15)
            response.raise_for_status()
            data = response.json().get('data', {})
            for field, name in [('b_3', 'buvid3'), ('b_4', 'buvid4')]:
                if data.get(field):
                    session.cookies.set(name, data[field], domain='.bilibili.com')
            bootstrapped = time.monotonic()

    async def request(item):
        try:
            async with semaphore:
                url = item['url']
                parsed = urlparse(url)
                if parsed.scheme != 'https' or parsed.hostname not in ALLOWED or parsed.port not in (None, 443) or parsed.username:
                    raise ValueError('Unsupported upstream URL')
                method = item.get('method', 'GET').upper()
                if method not in ('GET', 'HEAD'):
                    raise ValueError('Unsupported method')
                await bootstrap()
                headers = {k: v for k, v in item.get('headers', {}).items() if k.lower() != 'user-agent'}
                response = await session.request(method, url, headers=headers, timeout=15, allow_redirects=False)
                result = {'id': item['id'], 'status': response.status_code, 'headers': dict(response.headers), 'body': base64.b64encode(response.content).decode()}
        except Exception as error:
            result = {'id': item['id'], 'error': str(error)}
        print(json.dumps(result), flush=True)

    try:
        while True:
            line = await asyncio.to_thread(sys.stdin.readline)
            if not line:
                break
            item = json.loads(line)
            task = asyncio.create_task(request(item))
            tasks.add(task)
            task.add_done_callback(tasks.discard)
        await asyncio.gather(*tasks)
    finally:
        await session.close()

asyncio.run(main())
