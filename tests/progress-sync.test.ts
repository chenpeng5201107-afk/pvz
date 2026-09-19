import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import type { Battle } from '../src/core/battle.ts';
import type { CompletionPayload, LevelProgress, SessionInfo } from '../src/shared/api.ts';
import { ApiError } from '../src/ui/api.ts';

// Run the actual entry-point functions without starting Phaser or contacting a real server.
const source = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const script = ts.transpileModule(
  source.replace(/void boot\(\);\s*$/, '') +
    `
  globalThis.harness = {
    saveResult, retryPending,
    setSession(value) { session = value; },
    setBattle(value) { battle = value; saving = null; }
  };`,
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023 } },
).outputText;

function fixture() {
  const storage = new Map<string, string>();
  const calls: {
    body: CompletionPayload;
    resolve: (result: { progress: LevelProgress[] }) => void;
    reject: (error: Error) => void;
  }[] = [];
  const elements = new Map<string, { disabled: boolean; hidden: boolean; textContent: string }>();
  const replaceDialog = () => {
    for (const selector of [
      '[data-action="result-home"]',
      '#result-primary',
      '#save-retry',
      '#save-status',
    ])
      elements.set(selector, { disabled: true, hidden: true, textContent: '' });
  };
  replaceDialog();
  const context = {
    exports: {},
    require: (path: string) => {
      if (path === './game/sound.ts') return { Sound: class {} };
      if (path === './ui/api.ts')
        return {
          ApiError,
          request: (_path: string, body: CompletionPayload) =>
            new Promise((resolve, reject) => calls.push({ body, resolve, reject })),
        };
      return {};
    },
    document: {
      querySelector: (selector: string) =>
        selector === '#app' ? { addEventListener() {} } : (elements.get(selector) ?? null),
      addEventListener() {},
    },
    window: { addEventListener() {} },
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    },
    // Match plain HTTP LAN browsers, where randomUUID may be unavailable.
    crypto: { getRandomValues: crypto.getRandomValues.bind(crypto) },
    Error,
    harness: undefined as unknown as {
      saveResult: (battle: Battle) => Promise<void>;
      retryPending: () => Promise<void>;
      setSession: (session: SessionInfo) => void;
      setBattle: (battle: Battle) => void;
    },
  };
  runInNewContext(script, context);
  return { ...context.harness, storage, calls, elements, replaceDialog };
}
const account = (id = 1, progressRevision = 0): SessionInfo => ({
  user: { id, username: `玩家${id}`, progressRevision },
  progress: [],
});
const model = () => ({ level: { id: 1 }, stars: 3, time: 20 }) as Battle;
const key = (owner: SessionInfo) => `fg:pending:${owner.user!.id}:${owner.user!.username}`;
const pending = (owner: SessionInfo) =>
  JSON.stringify({
    userId: owner.user!.id,
    progressRevision: owner.user!.progressRevision,
    submissionId: 'offline-result',
    level: 1,
    stars: 3,
    seconds: 20,
  });
const progress: LevelProgress[] = [{ level: 1, stars: 3, bestSeconds: 20 }];

test('new scores carry the account and progress revision that produced them', async () => {
  const f = fixture(),
    owner = account(1, 4),
    battle = model();
  f.setSession(owner);
  f.setBattle(battle);
  const saving = f.saveResult(battle);
  f.calls[0]!.resolve({ progress });
  await saving;
  assert.equal(f.calls[0]!.body.userId, 1);
  assert.equal(f.calls[0]!.body.progressRevision, 4);
  assert.deepEqual(owner.progress, progress);
  assert.equal(f.storage.has(key(owner)), false);
});

test('late save responses cannot change another account or remove its pending score', async () => {
  const f = fixture(),
    first = account(),
    second = account(2),
    battle = model();
  f.setSession(first);
  f.setBattle(battle);
  const saving = f.saveResult(battle);
  f.setSession(second);
  f.setBattle(model());
  f.replaceDialog();
  f.storage.set(key(second), pending(second));
  f.calls[0]!.resolve({ progress });
  await saving;
  assert.deepEqual(second.progress, []);
  assert.equal(f.storage.get(key(second)), pending(second));
  assert.equal(f.elements.get('[data-action="result-home"]')!.disabled, true);
});

test('late retry responses cannot change a new login, even for the same account', async () => {
  const f = fixture(),
    first = account(),
    newLogin = account();
  f.setSession(first);
  f.storage.set(key(first), pending(first));
  const retrying = f.retryPending();
  f.setSession(newLogin);
  f.calls[0]!.resolve({ progress });
  await retrying;
  assert.deepEqual(newLogin.progress, []);
  assert.equal(f.storage.get(key(first)), pending(first));
});

for (const newerFirst of [false, true]) {
  test(`overlapping identical scores stay isolated when ${newerFirst ? 'new' : 'old'} response arrives first`, async () => {
    const f = fixture(),
      owner = account(),
      first = model(),
      second = model();
    f.setSession(owner);
    f.setBattle(first);
    const oldSave = f.saveResult(first);
    const oldStored = f.storage.get(key(owner));
    f.setBattle(second);
    f.replaceDialog();
    const newSave = f.saveResult(second);
    const newStored = f.storage.get(key(owner));
    if (newerFirst) {
      f.calls[1]!.resolve({ progress });
      await newSave;
      f.calls[0]!.resolve({ progress: [] });
      await oldSave;
    } else {
      f.calls[0]!.resolve({ progress: [] });
      await oldSave;
      assert.equal(f.storage.get(key(owner)), newStored);
      assert.equal(f.elements.get('[data-action="result-home"]')!.disabled, true);
      const duplicate = f.saveResult(second);
      assert.equal(f.calls.length, 2, 'old finally must not release the newer save lock');
      await duplicate;
      f.calls[1]!.resolve({ progress });
      await newSave;
    }
    assert.notEqual(oldStored, newStored, 'distinct battles need distinct cache identities');
    assert.deepEqual(owner.progress, progress);
    assert.equal(f.storage.has(key(owner)), false);
  });
}

test('errors from an earlier battle do not change the current result dialog', async () => {
  const f = fixture(),
    owner = account(),
    battle = model();
  f.setSession(owner);
  f.setBattle(battle);
  const saving = f.saveResult(battle);
  f.setBattle(model());
  f.replaceDialog();
  f.calls[0]!.reject(new ApiError('断线', 0));
  await saving;
  assert.equal(f.elements.get('#save-status')!.textContent, '');
  assert.equal(f.elements.get('#save-retry')!.hidden, true);
  assert.equal(f.elements.get('[data-action="result-home"]')!.disabled, true);
});

test('legacy, malformed and stale pending scores are discarded without resubmission', async () => {
  for (const stored of [
    '{bad',
    JSON.stringify({ level: 1, stars: 3, seconds: 20 }),
    pending(account(1, 0)),
    pending(account(2, 1)),
  ]) {
    const f = fixture(),
      owner = account(1, 1);
    f.setSession(owner);
    f.storage.set(key(owner), stored);
    const retrying = f.retryPending();
    f.calls[0]?.resolve({ progress });
    await retrying;
    assert.equal(f.calls.length, 0);
    assert.equal(f.storage.has(key(owner)), false);
    assert.deepEqual(owner.progress, []);
  }
});

test('offline scores remain available and sync successfully on reconnection', async () => {
  const f = fixture(),
    owner = account(),
    battle = model();
  f.setSession(owner);
  f.setBattle(battle);
  const saving = f.saveResult(battle);
  f.calls[0]!.reject(new ApiError('断线', 0));
  await saving;
  const stored = f.storage.get(key(owner));
  assert.ok(stored);
  const retrying = f.retryPending();
  f.calls[1]!.resolve({ progress });
  await retrying;
  assert.deepEqual(owner.progress, progress);
  assert.equal(f.storage.has(key(owner)), false);
});

test('server-rejected stale scores are removed instead of retried on every login', async () => {
  const f = fixture(),
    owner = account();
  f.setSession(owner);
  f.storage.set(key(owner), pending(owner));
  const retrying = f.retryPending();
  f.calls[0]!.reject(new ApiError('进度已变化', 409));
  await retrying;
  assert.equal(f.storage.has(key(owner)), false);
  assert.deepEqual(owner.progress, []);
});
