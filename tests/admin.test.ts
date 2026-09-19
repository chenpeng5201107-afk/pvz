import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { get, request } from 'node:http';
import { createApp } from '../server/app.ts';

async function fixture(t: TestContext, host = '127.0.0.1') {
  const { server, store } = createApp({ database: ':memory:', publicDir: 'dist' });
  await new Promise<void>((resolve) => server.listen(0, host, resolve));
  t.after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    store.close();
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const page = await (await fetch(base + '/database')).text();
  const token = page.match(/name="admin-token" content="([a-f0-9]+)"/)?.[1] ?? '';
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(base + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
  const admin = (id: number, action: string, body: unknown = {}) =>
    post(`/api/admin/users/${id}/${action}`, body, { Origin: base, 'X-Admin-Token': token });
  const register = async (username: string) => {
    const response = await post('/api/register', { username, password: 'original-pass-123' });
    assert.equal(response.status, 201);
    const cookie = response.headers.get('set-cookie')!.split(';')[0]!;
    const { user } = await response.json();
    return { id: user.id as number, cookie };
  };
  return { base, store, token, post, admin, register };
}

test('local admin can search, rename, reset passwords and revoke sessions', async (t) => {
  const { base, store, token, post, admin, register } = await fixture(t);
  assert.ok(token, 'management page provides a request token');
  const first = await register('管理测试甲');
  const second = await register('管理测试乙');
  const session = async (cookie: string) =>
    (await fetch(base + '/api/session', { headers: { cookie } })).json();
  const filtered = await (await fetch(base + '/database?q=' + encodeURIComponent('测试甲'))).text();
  assert.match(filtered, /管理测试甲/);
  assert.doesNotMatch(filtered, /管理测试乙/);
  const secret = store.userByName('管理测试甲')!;
  assert.ok(!filtered.includes(secret.password_hash) && !filtered.includes(secret.salt));
  assert.equal((await admin(first.id, 'rename', { username: '新名字' })).status, 200);
  assert.equal(store.userByName('管理测试甲'), undefined);
  assert.equal(store.userByName('新名字')!.id, first.id);
  assert.equal((await session(first.cookie)).user, null);
  assert.equal((await session(second.cookie)).user.id, second.id);
  const login = await post('/api/login', { username: '新名字', password: 'original-pass-123' });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie')!.split(';')[0]!;
  assert.equal(
    (await admin(first.id, 'password', { password: 'replacement-pass-456' })).status,
    200,
  );
  assert.equal((await session(cookie)).user, null);
  assert.equal(
    (await post('/api/login', { username: '新名字', password: 'original-pass-123' })).status,
    401,
  );
  const newLogin = await post('/api/login', {
    username: '新名字',
    password: 'replacement-pass-456',
  });
  assert.equal(newLogin.status, 200);
  const newCookie = newLogin.headers.get('set-cookie')!.split(';')[0]!;
  assert.equal((await admin(first.id, 'logout')).status, 200);
  assert.equal((await session(newCookie)).user, null);
  assert.equal((await session(second.cookie)).user.id, second.id);
});

test('admin edits exact results and confirms resets and deletions for one user only', async (t) => {
  const { base, store, post, admin, register } = await fixture(t);
  const first = await register('进度测试甲');
  const second = await register('进度测试乙');
  store.complete(first.id, 1, 3, 30);
  store.complete(second.id, 1, 2, 60);
  assert.equal(
    (await admin(first.id, 'progress', { level: 1, stars: 1, seconds: 120 })).status,
    200,
  );
  assert.deepEqual(
    store.progress(first.id).map((row) => ({ ...row })),
    [{ level: 1, stars: 1, bestSeconds: 120 }],
  );
  assert.equal(
    (
      await post(
        '/api/progress/complete',
        { level: 1, stars: 3, seconds: 20 },
        { cookie: first.cookie },
      )
    ).status,
    401,
  );
  assert.equal(
    (await admin(first.id, 'progress', { level: 10, stars: 3, seconds: 300 })).status,
    200,
  );
  assert.equal(store.progress(first.id).length, 2);
  assert.equal(
    (await admin(first.id, 'reset-progress', { confirmUsername: '错误名字' })).status,
    400,
  );
  assert.equal(store.progress(first.id).length, 2);
  assert.equal(
    (await admin(first.id, 'reset-progress', { confirmUsername: '进度测试甲' })).status,
    200,
  );
  assert.equal(store.progress(first.id).length, 0);
  assert.equal(store.progress(second.id).length, 1);
  store.complete(first.id, 1, 2, 50);
  store.createSession('temporary-session', first.id, Date.now() + 60_000);
  assert.equal((await admin(first.id, 'delete')).status, 400);
  assert.equal((await admin(first.id, 'delete', { confirmUsername: '进度测试甲' })).status, 200);
  assert.equal(store.userByName('进度测试甲'), undefined);
  assert.equal(store.session('temporary-session'), undefined);
  assert.equal(store.progress(first.id).length, 0);
  assert.equal(store.progress(second.id).length, 1);
  assert.equal(
    (await (await fetch(base + '/api/session', { headers: { cookie: second.cookie } })).json()).user
      .id,
    second.id,
  );
});

test('management rejects forged origins, missing tokens, bad hosts and invalid input', async (t) => {
  const { base, token, store, post, admin, register } = await fixture(t);
  const first = await register('保留账号');
  await register('重复账号');
  const path = `/api/admin/users/${first.id}/delete`;
  const body = { confirmUsername: '保留账号' };
  const rejectedHeaders: Record<string, string>[] = [
    {},
    { Origin: base },
    { 'X-Admin-Token': token },
    { Origin: 'https://untrusted.example', 'X-Admin-Token': token },
    { Origin: 'http://127.0.0.1:5173', 'X-Admin-Token': token },
  ];
  for (const headers of rejectedHeaders)
    assert.equal((await post(path, body, headers)).status, 403);
  assert.equal(
    await new Promise<number | undefined>((resolve, reject) => {
      get(base + '/database', { headers: { Host: 'untrusted.example' } }, (response) => {
        response.resume();
        resolve(response.statusCode);
      }).on('error', reject);
    }),
    403,
  );
  assert.equal(
    (await fetch(base + '/database', { headers: { Origin: 'https://untrusted.example' } })).status,
    403,
  );
  assert.equal(
    (await fetch(base + '/database', { headers: { 'X-Forwarded-For': '192.0.2.1' } })).status,
    403,
  );
  assert.equal((await fetch(base + path)).status, 405);
  assert.equal((await admin(first.id, 'rename', { username: '重复账号' })).status, 409);
  assert.equal((await admin(first.id, 'rename', { username: '<script>' })).status, 400);
  assert.equal((await admin(first.id, 'password', { password: 'short' })).status, 400);
  for (const result of [
    { level: 11, stars: 3, seconds: 60 },
    { level: 1, stars: 0, seconds: 60 },
    { level: 1, stars: 2.5, seconds: 60 },
    { level: 1, stars: 3, seconds: -1 },
    { level: '1', stars: 3, seconds: 60 },
  ])
    assert.equal((await admin(first.id, 'progress', result)).status, 400);
  assert.equal((await admin(999, 'logout')).status, 404);
  assert.equal((await admin(first.id, 'unknown')).status, 404);
  assert.ok(store.userByName('保留账号'));
  assert.equal(store.progress(first.id).length, 0);
});

test('management is unavailable when the server listens on a public interface', async (t) => {
  const { base, post } = await fixture(t, '0.0.0.0');
  assert.equal((await fetch(base + '/database')).status, 403);
  assert.equal((await post('/api/admin/users/1/delete', { confirmUsername: 'any' })).status, 403);
});

test('a score request already in flight cannot restore progress after an admin reset', async (t) => {
  const { base, store, admin, register } = await fixture(t);
  const user = await register('正在提交');
  store.complete(user.id, 1, 3, 30);
  const score = JSON.stringify({ level: 1, stars: 3, seconds: 20 });
  let finish: () => void = () => {};
  const response = new Promise<number | undefined>((resolve, reject) => {
    const req = request(
      base + '/api/progress/complete',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          cookie: user.cookie,
          'Content-Length': Buffer.byteLength(score),
        },
      },
      (res) => {
        res.resume();
        resolve(res.statusCode);
      },
    );
    req.on('error', reject);
    req.write(score.slice(0, -1));
    finish = () => req.end(score.slice(-1));
    t.after(() => req.destroy());
  });
  assert.equal(
    (await admin(user.id, 'reset-progress', { confirmUsername: '正在提交' })).status,
    200,
  );
  finish();
  assert.equal(await response, 401);
  assert.equal(store.progress(user.id).length, 0);
});

test('stale admin actions cannot target an account registered after deletion', async (t) => {
  const { store, admin, register } = await fixture(t);
  const deleted = await register('已删除玩家');
  assert.equal((await admin(deleted.id, 'delete', { confirmUsername: '已删除玩家' })).status, 200);
  const replacement = await register('新注册玩家');
  assert.equal((await admin(deleted.id, 'rename', { username: '误改名字' })).status, 404);
  assert.ok(replacement.id > deleted.id);
  assert.equal(store.userById(replacement.id)!.username, '新注册玩家');
});

for (const action of ['reset-progress', 'progress']) {
  test(`pending scores from before admin ${action} cannot overwrite the new progress`, async (t) => {
    const { base, store, post, admin, register } = await fixture(t);
    const account = await register('离线玩家');
    const original = await (
      await fetch(base + '/api/session', { headers: { cookie: account.cookie } })
    ).json();
    const score = {
      userId: account.id,
      progressRevision: original.user.progressRevision,
      level: 1,
      stars: 3,
      seconds: 20,
    };
    store.complete(account.id, 1, 3, 30);
    assert.equal(
      (
        await admin(account.id, action, {
          confirmUsername: '离线玩家',
          level: 1,
          stars: 1,
          seconds: 120,
        })
      ).status,
      200,
    );
    const expected = store.progress(account.id).map((row) => ({ ...row }));
    const login = await post('/api/login', { username: '离线玩家', password: 'original-pass-123' });
    const cookie = login.headers.get('set-cookie')!.split(';')[0]!;
    const current = await login.json();
    assert.equal((await post('/api/progress/complete', score, { cookie })).status, 409);
    assert.equal(
      (await post('/api/progress/complete', { level: 1, stars: 3, seconds: 20 }, { cookie }))
        .status,
      409,
    );
    assert.deepEqual(
      store.progress(account.id).map((row) => ({ ...row })),
      expected,
    );
    assert.equal(current.user.progressRevision, original.user.progressRevision + 1);
    assert.equal(
      (
        await post(
          '/api/progress/complete',
          { ...score, progressRevision: current.user.progressRevision },
          { cookie },
        )
      ).status,
      200,
    );
  });
}

test('pending scores are bound to their account even when another tab changes the login cookie', async (t) => {
  const { base, store, post, register } = await fixture(t);
  const first = await register('缓存归属甲');
  const original = await (
    await fetch(base + '/api/session', { headers: { cookie: first.cookie } })
  ).json();
  const second = await register('缓存归属乙');
  const score = {
    userId: first.id,
    progressRevision: original.user.progressRevision,
    level: 1,
    stars: 3,
    seconds: 20,
  };
  assert.equal(
    (await post('/api/progress/complete', score, { cookie: second.cookie })).status,
    409,
  );
  assert.deepEqual(store.progress(second.id), []);
});
