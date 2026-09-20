import { UNITS, ENEMIES, unitById } from '../core/content.ts';
import type { UnitId, EnemyKind } from '../core/content.ts';

export const ART_ROOT = '/assets/garden-v1/';
// Bypass images previously served with an immutable one-year cache policy.
const ART_REVISION = '?rev=2';
const files: Record<UnitId, string> = {
  derivative: 'unit-derivative',
  ln: 'unit-ln',
  exp: 'unit-exp',
  asin: 'unit-asin',
  sin: 'unit-sin',
  square: 'unit-square',
  reciprocal: 'unit-reciprocal',
  bomb: 'unit-bomb',
  areaBomb: 'unit-area-bomb',
  rowBomb: 'unit-row-bomb',
};
const signs: Partial<Record<UnitId, [number, number, number]>> = {
  derivative: [133, 139, 57],
  ln: [124, 102, 44],
  exp: [134, 117, 53],
  asin: [125, 105, 58],
  sin: [130, 110, 57],
  square: [128, 105, 67],
  reciprocal: [130, 103, 71],
};
const images = new Map<string, HTMLImageElement>();
const cards = new Map<string, string>();

/** Decode before the UI or Phaser consumes a texture; failures can be retried. */
export async function loadArtwork(): Promise<void> {
  const names = [
    ...UNITS.map((u) => files[u.id] + '.png'),
    ...ENEMIES.map((e) => `enemy-${e.kind}.png`),
    'battle.webp',
  ];
  await Promise.all(
    names.map(async (name) => {
      if (images.has(name)) return;
      const image = new Image();
      image.src = ART_ROOT + name + ART_REVISION;
      try {
        await image.decode();
      } catch {
        throw new Error('庭院图片未能加载，请刷新页面或重新构建后重试。');
      }
      images.set(name, image);
    }),
  );
}

export function artwork(name: string): HTMLImageElement {
  const image = images.get(name);
  if (!image) throw new Error(`尚未加载图片：${name}`);
  return image;
}
function spriteCanvas(name: string): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  canvas.getContext('2d')!.drawImage(artwork(name), 0, 0);
  return canvas;
}
export function unitCanvas(id: UnitId): HTMLCanvasElement {
  const canvas = spriteCanvas(files[id] + '.png'),
    sign = signs[id];
  if (sign) {
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#302318';
    ctx.font = `bold ${id === 'asin' ? 17 : 25}px Georgia, serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(unitById(id).symbol, sign[0], sign[1], sign[2] - 6);
  }
  return canvas;
}
export function enemyCanvas(kind: EnemyKind): HTMLCanvasElement {
  return spriteCanvas(`enemy-${kind}.png`);
}
export function portrait(id: UnitId): string {
  if (!cards.has(id)) cards.set(id, unitCanvas(id).toDataURL());
  return cards.get(id)!;
}
export function enemyPortrait(kind: EnemyKind): string {
  return ART_ROOT + `enemy-${kind}.png` + ART_REVISION;
}
export function heroArt(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext('2d')!;
  canvas.width = 900;
  canvas.height = 360;
  ctx.drawImage(unitCanvas('derivative'), 10, 20, 340, 340);
  ctx.drawImage(unitCanvas('ln'), 300, 0, 355, 355);
  ctx.drawImage(enemyCanvas('exponential'), 610, 15, 340, 340);
  ctx.fillStyle = '#f8ebba';
  ctx.strokeStyle = '#3e2b19';
  ctx.lineWidth = 5;
  ctx.font = 'bold italic 32px Georgia';
  ctx.textAlign = 'center';
  ctx.strokeText('eˣ → x → c', 725, 68);
  ctx.fillText('eˣ → x → c', 725, 68);
}
