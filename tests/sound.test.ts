import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as clips from '../src/game/sound-clips.ts';
import type { SoundKind } from '../src/game/sound-clips.ts';
import type { Sound } from '../src/game/sound.ts';

const kinds = Object.keys(clips.SOUND_SECONDS) as SoundKind[];

test('all battle effects have finite, non-silent, click-free original waveforms with headroom', () => {
  assert.equal(kinds.length, 14);
  for (const kind of kinds) {
    const data = clips.renderSound(kind);
    assert.equal(data.length, Math.ceil(clips.SOUND_SECONDS[kind] * clips.SOUND_SAMPLE_RATE));
    let peak = 0,
      energy = 0;
    for (const sample of data) {
      assert.ok(Number.isFinite(sample), kind);
      peak = Math.max(peak, Math.abs(sample));
      energy += sample * sample;
    }
    assert.ok(peak > 0.05 && peak <= 0.750001, `${kind}: peak ${peak}`);
    assert.ok(Math.sqrt(energy / data.length) > 0.008, `${kind} is audible`);
    assert.ok(Math.abs(data[0]!) < 0.000001, kind);
    assert.ok(Math.abs(data.at(-1)!) < 0.000001, kind);
    assert.deepEqual(data, clips.renderSound(kind), `${kind} is reproducible`);
  }
});

function fixture(saved = 'on', resumeBlocked = false, available = true) {
  const storage = new Map([['fg:sound', saved]]);
  const sources: Source[] = [];
  const buffers: Float32Array[] = [];
  const parameter = () => ({
    value: 0,
    cancelScheduledValues() {},
    setTargetAtTime(value: number) {
      this.value = value;
    },
  });
  const master = { gain: parameter(), connect() {} };
  const compressor = {
    threshold: parameter(),
    knee: parameter(),
    ratio: parameter(),
    attack: parameter(),
    release: parameter(),
    connect() {},
  };
  class Source {
    buffer: unknown;
    onended: (() => void) | null = null;
    started = false;
    stopped = false;
    disconnected = false;
    connect() {}
    disconnect() {
      this.disconnected = true;
    }
    start() {
      this.started = true;
    }
    stop() {
      this.stopped = true;
    }
  }
  const contexts: FakeContext[] = [];
  class FakeContext {
    currentTime = 0;
    state = 'suspended';
    destination = {};
    constructor() {
      contexts.push(this);
    }
    async resume() {
      if (resumeBlocked) throw new Error('autoplay blocked');
      this.state = 'running';
    }
    createGain() {
      return master;
    }
    createDynamicsCompressor() {
      return compressor;
    }
    createBuffer(channels: number, length: number, rate: number) {
      assert.equal(channels, 1);
      assert.equal(rate, clips.SOUND_SAMPLE_RATE);
      return {
        copyToChannel(data: Float32Array, channel: number) {
          assert.equal(channel, 0);
          assert.equal(data.length, length);
          buffers.push(data);
        },
      };
    }
    createBufferSource() {
      const source = new Source();
      sources.push(source);
      return source;
    }
  }
  const context = {
    exports: {} as { Sound: typeof Sound },
    require: () => clips,
    AudioContext: available ? FakeContext : undefined,
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    },
  };
  const source = readFileSync(new URL('../src/game/sound.ts', import.meta.url), 'utf8');
  runInNewContext(
    ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    context,
  );
  return {
    sound: new context.exports.Sound(),
    contexts,
    sources,
    buffers,
    storage,
    master,
    compressor,
  };
}

test('audio waits for interaction, caches its buffers and connects a mix compressor', async () => {
  const f = fixture();
  f.sound.play('shot');
  assert.equal(f.contexts.length, 0);
  await f.sound.unlock();
  await f.sound.unlock();
  assert.equal(f.contexts.length, 1);
  assert.ok(f.compressor.ratio.value > 1);
  f.sound.play('place');
  f.sound.play('place');
  assert.equal(f.buffers.length, 1);
  assert.equal(f.sources.length, 2);
  assert.ok(f.sources.every((s) => s.started));
});

test('first shot is audible at time zero and simultaneous repetitive events are throttled', async () => {
  const f = fixture();
  await f.sound.unlock();
  for (const kind of ['shot', 'hit', 'bite', 'kill', 'explosion', 'invalid']) {
    f.sound.play(kind);
    f.sound.play(kind);
  }
  assert.equal(f.sources.length, 6);
  f.contexts[0]!.currentTime = 0.3;
  f.sound.play('shot');
  assert.equal(f.sources.length, 7);
  assert.equal(f.buffers.length, 6);
});

test('voices have an upper limit and release their audio connections when finished', async () => {
  const f = fixture();
  await f.sound.unlock();
  for (let i = 0; i < 40; i++) f.sound.play('place');
  assert.equal(f.sources.length, 24);
  f.sources[0]!.onended!();
  assert.ok(f.sources[0]!.disconnected);
  f.sound.play('place');
  assert.equal(f.sources.length, 25);
});

test('muting stops in-flight sounds, persists the preference and permits re-enabling', async () => {
  const f = fixture();
  await f.sound.unlock();
  f.sound.play('won');
  assert.equal(f.sound.toggle(), false);
  assert.equal(f.storage.get('fg:sound'), 'off');
  assert.equal(f.master.gain.value, 0);
  assert.ok(f.sources[0]!.stopped);
  f.sound.play('explosion');
  assert.equal(f.sources.length, 1);
  f.sources[0]!.onended!();
  assert.equal(f.sound.toggle(), true);
  assert.equal(f.storage.get('fg:sound'), 'on');
  f.sound.play('shot');
  assert.equal(f.sources.length, 2);
  assert.ok(f.master.gain.value > 0);
});

test('saved mute preference creates no audio context until explicitly enabled', async () => {
  const f = fixture('off');
  await f.sound.unlock();
  f.sound.play('place');
  assert.equal(f.contexts.length, 0);
  f.sound.toggle();
  await f.sound.unlock();
  assert.equal(f.contexts.length, 1);
});

test('suspended or unavailable audio and unknown events never block gameplay', async () => {
  for (const f of [fixture('on', true), fixture('on', false, false)]) {
    await assert.doesNotReject(f.sound.unlock());
    assert.doesNotThrow(() => f.sound.play('shot'));
    assert.equal(f.sources.length, 0);
  }
  const f = fixture();
  await f.sound.unlock();
  f.sound.play('unknown');
  f.sound.play('toString');
  assert.equal(f.sources.length, 0);
});

test('every battle event can be played through the browser audio adapter', async () => {
  const f = fixture();
  await f.sound.unlock();
  for (const kind of kinds) f.sound.play(kind);
  assert.equal(f.sources.length, kinds.length);
  assert.equal(f.buffers.length, kinds.length);
});
