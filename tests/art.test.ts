import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { UNITS, ENEMIES, unitById } from '../src/core/content.ts';
import type * as Artwork from '../src/game/art.ts';

function fixture(failedFile = '') {
  const decodes: string[] = [];
  const texts: string[] = [];
  const drawn: string[] = [];
  let dataUrls = 0;
  const context = {
    exports: {} as typeof Artwork,
    require: () => ({ UNITS, ENEMIES, unitById }),
    Image: class {
      src = '';
      async decode() {
        decodes.push(this.src);
        if (this.src.split('?')[0]!.endsWith(failedFile) && failedFile) {
          failedFile = '';
          throw new Error('image unavailable');
        }
      }
    },
    document: {
      createElement: () => ({
        width: 0,
        height: 0,
        getContext: () => ({
          drawImage: (image: { src: string }) => drawn.push(image.src),
          fillText: (text: string) => texts.push(text),
        }),
        toDataURL: () => `data:image/png;base64,${++dataUrls}`,
      }),
    },
  };
  const source = readFileSync(new URL('../src/game/art.ts', import.meta.url), 'utf8');
  runInNewContext(
    ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText,
    context,
  );
  return { api: context.exports, decodes, texts, drawn };
}

test('all unit and enemy artwork exists with a transparent 256px canvas', async () => {
  const f = fixture();
  await f.api.loadArtwork();
  assert.equal(f.decodes.length, UNITS.length + ENEMIES.length + 1);
  for (const url of f.decodes) {
    const path = url.split('?')[0]!;
    const data = readFileSync(new URL(`../public${path}`, import.meta.url));
    if (!path.endsWith('.png')) continue;
    assert.equal(data.toString('hex', 0, 8), '89504e470d0a1a0a', path);
    assert.equal(data.readUInt32BE(16), 256, path);
    assert.equal(data.readUInt32BE(20), 256, path);
    assert.equal(data[25], 6, `${path} uses RGBA`);
  }
  const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
  const paths = [...css.matchAll(/url\(['"]?(\/assets\/[^)'"\s]+)/g)];
  assert.ok(paths.length > 0);
  for (const [, path] of paths)
    assert.ok(existsSync(new URL(`../public${path}`, import.meta.url)), path);
});

test('failed artwork can be retried without decoding the successful images again', async () => {
  const f = fixture('unit-ln.png');
  await assert.rejects(f.api.loadArtwork(), /庭院图片未能加载/);
  assert.throws(() => f.api.artwork('unit-ln.png'), /尚未加载图片/);
  await f.api.loadArtwork();
  const count = f.decodes.length;
  await f.api.loadArtwork();
  assert.equal(f.decodes.length, count);
  assert.equal(f.decodes.filter((p) => p.split('?')[0]!.endsWith('unit-ln.png')).length, 2);
  assert.equal(f.decodes.filter((p) => p.split('?')[0]!.endsWith('unit-derivative.png')).length, 1);
});

test('all runtime and CSS images bypass previously immutable image URLs', async () => {
  const f = fixture();
  await f.api.loadArtwork();
  const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
  const urls = [
    ...f.decodes,
    ...ENEMIES.map((enemy) => f.api.enemyPortrait(enemy.kind)),
    ...[...css.matchAll(/url\(['"]?(\/assets\/[^)'"\s]+)/g)].map((match) => match[1]!),
  ];
  for (const url of urls) assert.match(url, /\?rev=2$/, url);
});

test('plant signs use actual operations, bombs have no arithmetic label and portraits are cached', async () => {
  const f = fixture();
  await f.api.loadArtwork();
  for (const unit of UNITS) {
    const canvas = f.api.unitCanvas(unit.id);
    assert.equal(canvas.width, 256);
    assert.equal(canvas.height, 256);
  }
  assert.deepEqual(f.texts, ['D', 'ln', 'eᵘ', 'arcsin', 'sin', 'u²', '1/u']);
  assert.equal(f.api.portrait('ln'), f.api.portrait('ln'));
});

test('enemy sprites do not bake formulas into their textures', async () => {
  const f = fixture();
  await f.api.loadArtwork();
  for (const enemy of ENEMIES) {
    f.api.enemyCanvas(enemy.kind);
    assert.equal(f.drawn.at(-1), f.api.enemyPortrait(enemy.kind));
  }
  assert.deepEqual(f.texts, []);
});

test('image loading failure leaves a retry page with a safe manual entry', async () => {
  const app = { innerHTML: '', addEventListener() {} };
  const context = {
    exports: {},
    require: (path: string) => {
      if (path === './game/sound.ts')
        return {
          Sound: class {
            enabled = true;
          },
        };
      if (path === './core/content.ts') return { UNITS, ENEMIES };
      if (path === './game/art.ts')
        return {
          loadArtwork: async () => {
            throw new Error('missing art');
          },
          portrait: () => {
            throw new Error('尚未加载图片：unit-derivative.png');
          },
        };
      return {};
    },
    document: { querySelector: (s: string) => (s === '#app' ? app : null), addEventListener() {} },
    window: { addEventListener() {} },
    clearTimeout() {},
    Error,
    harness: undefined as unknown as { boot: () => Promise<void>; showLibrary: () => void },
  };
  const source =
    readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8').replace(
      /void boot\(\);\s*$/,
      '',
    ) + '\nglobalThis.harness = { boot, showLibrary };';
  runInNewContext(
    ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText,
    context,
  );
  await context.harness.boot();
  assert.match(app.innerHTML, /missing art/);
  assert.match(app.innerHTML, /data-action="retry-connect"/);
  assert.doesNotThrow(() => context.harness.showLibrary());
  assert.match(app.innerHTML, /data-action="library" disabled/);
});
