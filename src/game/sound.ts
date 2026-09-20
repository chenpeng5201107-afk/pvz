import { renderSound, SOUND_SAMPLE_RATE, SOUND_SECONDS } from './sound-clips.ts';
import type { SoundKind } from './sound-clips.ts';

const COOLDOWN: Partial<Record<SoundKind, number>> = {
  shot: 0.085,
  hit: 0.1,
  bite: 0.16,
  kill: 0.08,
  explosion: 0.12,
  invalid: 0.25,
};
const VOLUME = 0.65;
const MAX_VOICES = 24;

export class Sound {
  enabled = localStorage.getItem('fg:sound') !== 'off';
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private buffers = new Map<SoundKind, AudioBuffer>();
  private voices = new Set<AudioBufferSourceNode>();
  private lastPlayed = new Map<SoundKind, number>();
  async unlock(): Promise<void> {
    if (!this.enabled || typeof AudioContext === 'undefined') return;
    try {
      if (!this.context) {
        this.context = new AudioContext();
        this.master = this.context.createGain();
        this.master.gain.value = VOLUME;
        const compressor = this.context.createDynamicsCompressor();
        compressor.threshold.value = -18;
        compressor.knee.value = 12;
        compressor.ratio.value = 5;
        compressor.attack.value = 0.003;
        compressor.release.value = 0.16;
        this.master.connect(compressor);
        compressor.connect(this.context.destination);
      }
      if (this.context.state === 'suspended') await this.context.resume();
    } catch {
      // Audio/autoplay restrictions must not prevent playing the game.
    }
  }
  toggle(): boolean {
    this.enabled = !this.enabled;
    localStorage.setItem('fg:sound', this.enabled ? 'on' : 'off');
    if (this.context && this.master) {
      const now = this.context.currentTime;
      this.master.gain.cancelScheduledValues(now);
      this.master.gain.setTargetAtTime(this.enabled ? VOLUME : 0, now, 0.008);
      if (!this.enabled) {
        for (const voice of this.voices) voice.stop(now + 0.04);
        this.lastPlayed.clear();
      }
    }
    if (this.enabled) void this.unlock();
    return this.enabled;
  }
  play(kind: string): void {
    if (!this.enabled || !this.context || !this.master || this.context.state !== 'running') return;
    if (!Object.hasOwn(SOUND_SECONDS, kind)) return;
    const id = kind as SoundKind;
    const now = this.context.currentTime;
    if (now - (this.lastPlayed.get(id) ?? -Infinity) < (COOLDOWN[id] ?? 0)) return;
    if (this.voices.size >= MAX_VOICES) return;
    this.lastPlayed.set(id, now);
    let buffer = this.buffers.get(id);
    if (!buffer) {
      const samples = renderSound(id);
      buffer = this.context.createBuffer(1, samples.length, SOUND_SAMPLE_RATE);
      buffer.copyToChannel(samples, 0);
      this.buffers.set(id, buffer);
    }
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.master);
    this.voices.add(source);
    source.onended = () => {
      source.disconnect();
      this.voices.delete(source);
    };
    source.start(now);
  }
}
