import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { createApp } from '../server/app.ts';
import { Store } from '../server/store.ts';
import { DatabaseSync } from 'node:sqlite';

test('accounts, sessions, per-user saves, validation and static-file isolation', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'function-garden-test-'));
  writeFileSync(join(dir, 'index.html'), '<h1>Test</h1>');
  const { server, store } = createApp({ database: ':memory:', publicDir: dir });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = (path: string, data: unknown, cookie = '', origin?: string) =>
    fetch(base + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie, ...(origin ? { origin } : {}) },
      body: JSON.stringify(data),
    });
  try {
    const registered = await post('/api/register', {
      username: '测试玩家',
      password: 'correct-pass-123',
    });
    assert.equal(registered.status, 201);
    const cookie = registered.headers.get('set-cookie')!.split(';')[0]!;
    assert.ok(registered.headers.get('set-cookie')!.includes('HttpOnly'));
    const first = (await registered.json()) as { user: { id: number; username: string } };
    assert.equal(first.user.username, '测试玩家');
    assert.equal(
      (await post('/api/register', { username: '测试玩家', password: 'correct-pass-123' })).status,
      409,
    );
    assert.equal(
      (await post('/api/login', { username: '测试玩家', password: 'incorrect-pass' })).status,
      401,
    );
    assert.equal((await post('/api/register', { username: 'bad', password: '123' })).status, 400);
    assert.equal(
      (await post('/api/progress/complete', { level: 1, stars: 3, seconds: 62 })).status,
      401,
    );
    assert.equal(
      (await post('/api/progress/complete', { level: 3, stars: 3, seconds: 62 }, cookie)).status,
      403,
    );
    assert.equal(
      (
        await post(
          '/api/progress/complete',
          { level: 1, stars: 3, seconds: 62 },
          cookie,
          'https://untrusted.example',
        )
      ).status,
      403,
    );
    assert.equal(
      (await post('/api/progress/complete', { level: 1, stars: 3, seconds: 62 }, cookie)).status,
      200,
    );
    await post('/api/progress/complete', { level: 1, stars: 1, seconds: 90 }, cookie);
    const session = (await (
      await fetch(base + '/api/session', { headers: { cookie } })
    ).json()) as { progress: { stars: number; bestSeconds: number }[] };
    assert.equal(session.progress[0]!.stars, 3);
    assert.equal(session.progress[0]!.bestSeconds, 62);
    for (let level = 2; level <= 10; level++) {
      if (level < 10)
        assert.equal(
          (
            await post(
              '/api/progress/complete',
              { level: level + 1, stars: 3, seconds: 80 },
              cookie,
            )
          ).status,
          403,
        );
      assert.equal(
        (await post('/api/progress/complete', { level, stars: 3, seconds: 80 }, cookie)).status,
        200,
      );
    }
    assert.equal(
      (await post('/api/progress/complete', { level: 11, stars: 3, seconds: 80 }, cookie)).status,
      400,
    );
    const completed = await (await fetch(base + '/api/session', { headers: { cookie } })).json();
    assert.equal(completed.progress.length, 10);
    const second = await post('/api/register', {
        username: '另一玩家',
        password: 'another-pass-123',
      }),
      otherCookie = second.headers.get('set-cookie')!.split(';')[0]!;
    const other = (await (
      await fetch(base + '/api/session', { headers: { cookie: otherCookie } })
    ).json()) as { progress: unknown[] };
    assert.equal(other.progress.length, 0);
    assert.equal((await fetch(base + '/data/game.sqlite')).status, 404);
    assert.equal((await fetch(base + '/%2e%2e%5cserver%5capp.ts')).status, 403);
    assert.equal((await fetch(base + '/')).status, 200);
    await post('/api/logout', {}, cookie);
    const loggedOut = (await (
      await fetch(base + '/api/session', { headers: { cookie } })
    ).json()) as { user: unknown };
    assert.equal(loggedOut.user, null);
    const login = await post('/api/login', { username: '测试玩家', password: 'correct-pass-123' });
    assert.equal(login.status, 200);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    store.close();
  }
});
test('SQLite progress persists after the database is closed and reopened', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'function-garden-save-')), 'test.sqlite');
  const first = new Store(file);
  const user = first.addUser('persistent', 'hash', 'salt');
  first.complete(user.id, 1, 3, 65);
  first.close();
  const second = new Store(file);
  assert.deepEqual(
    second.progress(user.id).map((row) => ({ ...row })),
    [{ level: 1, stars: 3, bestSeconds: 65 }],
  );
  second.close();
});

test('legacy three-level saves retain accounts, sessions and records after upgrading', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'function-garden-legacy-')), 'test.sqlite');
  const legacy = new DatabaseSync(file);
  legacy.exec(`
    CREATE TABLE users(id INTEGER PRIMARY KEY,username TEXT NOT NULL,username_key TEXT NOT NULL UNIQUE,password_hash TEXT NOT NULL,salt TEXT NOT NULL,created_at INTEGER NOT NULL);
    CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,expires_at INTEGER NOT NULL);
    CREATE TABLE progress(user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,level INTEGER NOT NULL CHECK(level BETWEEN 1 AND 3),stars INTEGER NOT NULL CHECK(stars BETWEEN 1 AND 3),best_seconds REAL NOT NULL,PRIMARY KEY(user_id,level));
    INSERT INTO users VALUES(7,'旧玩家','旧玩家','original-hash','original-salt',1);
    INSERT INTO progress VALUES(7,1,3,65),(7,2,2,92),(7,3,1,120);
  `);
  legacy.prepare('INSERT INTO sessions VALUES(?,?,?)').run('session-hash', 7, Date.now() + 60_000);
  legacy.close();
  const upgraded = new Store(file);
  try {
    assert.equal(upgraded.userByName('旧玩家')!.password_hash, 'original-hash');
    assert.equal(upgraded.session('session-hash')!.id, 7);
    assert.deepEqual(
      upgraded.progress(7).map((row) => ({ ...row })),
      [
        { level: 1, stars: 3, bestSeconds: 65 },
        { level: 2, stars: 2, bestSeconds: 92 },
        { level: 3, stars: 1, bestSeconds: 120 },
      ],
    );
    upgraded.complete(7, 4, 3, 150);
    upgraded.complete(7, 10, 2, 300);
  } finally {
    upgraded.close();
  }
  const reopened = new Store(file);
  try {
    assert.equal(reopened.progress(7).length, 5);
    assert.equal(reopened.session('session-hash')!.id, 7);
  } finally {
    reopened.close();
  }
});
