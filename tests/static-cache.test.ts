import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { createApp } from '../server/app.ts';

test('only fingerprinted build files are immutable; fixed-name images are refreshed', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'garden-cache-'));
  mkdirSync(join(directory, 'assets/garden-v1'), { recursive: true });
  const files = [
    'index.html',
    'assets/index-1234abcd.js',
    'assets/index-abcd1234.css',
    'assets/plain.js',
    'assets/garden-v1/menu.webp',
    'assets/garden-v1/unit-ln.png',
  ];
  for (const file of files) writeFileSync(join(directory, file), 'first version');
  const { server, store } = createApp({ database: ':memory:', publicDir: directory });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    for (const file of files) {
      const response = await fetch(`${base}/${file}?rev=2`, { method: 'HEAD' });
      assert.equal(response.status, 200);
      assert.equal(
        response.headers.get('cache-control'),
        /index-.+\.(js|css)$/.test(file) ? 'public, max-age=31536000, immutable' : 'no-cache',
        file,
      );
    }
    const path = '/assets/garden-v1/menu.webp?rev=2';
    assert.equal(await (await fetch(base + path)).text(), 'first version');
    writeFileSync(join(directory, 'assets/garden-v1/menu.webp'), 'updated image');
    const updated = await fetch(base + path);
    assert.equal(updated.headers.get('cache-control'), 'no-cache');
    assert.equal(await updated.text(), 'updated image');
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    store.close();
  }
});
