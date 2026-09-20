import type { BattleEvent } from '../core/battle.ts';

export type SoundKind = BattleEvent['type'];
export const SOUND_SAMPLE_RATE = 22050;
export const SOUND_SECONDS: Record<SoundKind, number> = {
  place: 0.32,
  remove: 0.26,
  shot: 0.16,
  hit: 0.14,
  transform: 0.64,
  invalid: 0.24,
  kill: 0.48,
  explosion: 0.85,
  bite: 0.18,
  destroy: 0.46,
  leak: 0.48,
  wave: 0.82,
  won: 1.35,
  lost: 1.15,
};

/** Original Foley-like synthesis, without sampled recordings or borrowed melodies. */
export function renderSound(kind: SoundKind): Float32Array<ArrayBuffer> {
  const rate = SOUND_SAMPLE_RATE;
  const samples = new Float32Array(Math.ceil(SOUND_SECONDS[kind] * rate));
  let seed = 17 + Object.keys(SOUND_SECONDS).indexOf(kind) * 7919;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return (seed / 4294967296) * 2 - 1;
  };
  const layer = (
    start: number,
    seconds: number,
    volume: number,
    sample: (time: number, fraction: number) => number,
  ) => {
    const offset = Math.round(start * rate);
    const count = Math.min(Math.ceil(seconds * rate), samples.length - offset);
    for (let i = 0; i < count; i++) {
      const time = i / rate;
      const envelope =
        Math.min(1, time / 0.003) *
        Math.exp((-5 * time) / seconds) *
        Math.min(1, (count - 1 - i) / (rate * 0.012));
      samples[offset + i]! += sample(time, time / seconds) * envelope * volume;
    }
  };
  const tone = (start: number, seconds: number, from: number, to: number, volume: number) => {
    let phase = 0;
    layer(start, seconds, volume, (_time, fraction) => {
      phase += (2 * Math.PI * from * Math.pow(to / from, fraction)) / rate;
      return Math.sin(phase) + 0.18 * Math.sin(phase * 2) + 0.06 * Math.sin(phase * 3);
    });
  };
  const noise = (start: number, seconds: number, volume: number, from: number, to = from) => {
    let filtered = 0,
      rumble = 0;
    layer(start, seconds, volume, (time, fraction) => {
      const cutoff = from * Math.pow(to / from, fraction);
      filtered += (1 - Math.exp((-2 * Math.PI * cutoff) / rate)) * (random() - filtered);
      rumble += 0.012 * (filtered - rumble);
      return (filtered - rumble) * (0.8 + 0.2 * Math.sin(time * 95));
    });
  };
  const bell = (start: number, frequency: number, volume: number, seconds = 0.38) => {
    tone(start, seconds, frequency, frequency, volume);
    tone(start, seconds * 0.45, frequency * 2.76, frequency * 2.76, volume * 0.22);
  };

  switch (kind) {
    case 'place':
      // A scrape, a soft clod of earth, and loose dirt settling.
      noise(0, 0.09, 0.35, 1600, 550);
      tone(0.028, 0.19, 155, 65, 0.4);
      noise(0.045, 0.27, 0.42, 900, 180);
      noise(0.15, 0.12, 0.13, 2400, 600);
      break;
    case 'remove':
      noise(0, 0.23, 0.38, 650, 2300);
      tone(0.08, 0.15, 95, 210, 0.22);
      break;
    case 'shot':
      // Breath and a hollow pop instead of an electronic chirp.
      noise(0, 0.08, 0.23, 1500, 350);
      tone(0, 0.15, 390, 105, 0.3);
      tone(0.006, 0.09, 720, 190, 0.07);
      break;
    case 'hit':
      noise(0, 0.055, 0.26, 2000, 700);
      tone(0, 0.13, 220, 90, 0.19);
      break;
    case 'transform':
      noise(0, 0.34, 0.15, 900, 3500);
      bell(0.035, 620, 0.24);
      bell(0.12, 930, 0.19);
      bell(0.23, 1240, 0.14);
      break;
    case 'invalid':
      tone(0, 0.11, 185, 160, 0.26);
      noise(0, 0.06, 0.16, 1000);
      tone(0.115, 0.12, 145, 125, 0.2);
      break;
    case 'kill':
      tone(0, 0.16, 290, 75, 0.29);
      noise(0.07, 0.13, 0.28, 1800, 400);
      tone(0.19, 0.2, 130, 48, 0.34);
      noise(0.2, 0.28, 0.38, 1100, 150);
      break;
    case 'explosion':
      noise(0, 0.09, 0.55, 4300, 1000);
      tone(0, 0.48, 125, 32, 0.65);
      noise(0.025, 0.81, 1.1, 1600, 70);
      noise(0.16, 0.24, 0.2, 2700, 400);
      noise(0.3, 0.28, 0.12, 1800, 250);
      break;
    case 'bite':
      noise(0, 0.08, 0.29, 3100, 700);
      noise(0.065, 0.11, 0.21, 1700, 300);
      tone(0.01, 0.13, 135, 72, 0.12);
      break;
    case 'destroy':
      noise(0, 0.15, 0.48, 2900, 700);
      tone(0.035, 0.27, 175, 45, 0.35);
      noise(0.15, 0.3, 0.37, 1700, 160);
      break;
    case 'leak':
      tone(0, 0.25, 245, 175, 0.3);
      tone(0.2, 0.27, 175, 110, 0.28);
      noise(0.01, 0.12, 0.2, 1400, 500);
      break;
    case 'wave':
      tone(0, 0.22, 196, 196, 0.28);
      tone(0.19, 0.22, 247, 247, 0.28);
      tone(0.39, 0.4, 294, 294, 0.32);
      noise(0.39, 0.12, 0.16, 1800, 400);
      break;
    case 'won':
      bell(0, 392, 0.3, 0.44);
      bell(0.14, 494, 0.26, 0.44);
      bell(0.3, 659, 0.25, 0.44);
      bell(0.54, 587, 0.22, 0.7);
      bell(0.54, 784, 0.2, 0.8);
      tone(0.54, 0.72, 196, 196, 0.15);
      break;
    case 'lost':
      tone(0, 0.32, 294, 277, 0.26);
      tone(0.26, 0.34, 233, 220, 0.27);
      tone(0.55, 0.59, 175, 98, 0.32);
      noise(0.68, 0.4, 0.14, 700, 120);
      break;
  }
  // Leave headroom for overlapping effects; never amplify a quiet effect to full scale.
  let peak = 0;
  for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
  if (peak > 0.75) for (let i = 0; i < samples.length; i++) samples[i]! *= 0.75 / peak;
  return samples;
}
