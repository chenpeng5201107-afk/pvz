import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.ts';
import { isLoopbackAddress } from './admin.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT ?? 3001),
  host = process.env.HOST ?? '127.0.0.1',
  database = resolve(process.env.PVZ_DATA_DIR ?? resolve(root, 'data'), 'game.sqlite');
const { server, store } = createApp({
  database,
  publicDir: resolve(root, 'dist'),
  secureCookies: process.env.COOKIE_SECURE === 'true',
  allowDevOrigin: process.env.NODE_ENV !== 'production',
});
server.on('error', (error) => {
  console.error('启动失败：', error.message);
  store.close();
  process.exitCode = 1;
});
server.listen(port, host, () => {
  const address = server.address();
  if (!address || typeof address === 'string') return;
  const urlHost = address.address.includes(':') ? `[${address.address}]` : address.address;
  const url = `http://${urlHost}:${address.port}`;
  console.log(
    `\n函数保卫战已启动：${url}\n${isLoopbackAddress(address.address) ? `用户管理（数据库）：${url}/database` : '用户管理：已关闭（仅本机监听模式可用）'}\n数据库文件：${database}\n按 Ctrl+C 停止。\n`,
  );
});
let closing = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () => {
    if (closing) return;
    closing = true;
    server.close(() => {
      store.close();
      process.exit(0);
    });
  });
