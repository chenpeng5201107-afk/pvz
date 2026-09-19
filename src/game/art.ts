import { UNITS, unitById, isBomb } from '../core/content.ts';
import type { UnitId, EnemyKind } from '../core/content.ts';

type Ctx = CanvasRenderingContext2D;
const INK = '#344239',
  PAPER = '#fbf8ec';
const COLORS: Record<string, [string, string]> = {
  linear: ['#688963', '#d8e5c7'],
  power: ['#718d9d', '#d4e1e3'],
  exponential: ['#b28b50', '#efdab0'],
  logarithm: ['#ac8e61', '#ecdfbf'],
  sine: ['#9680a8', '#e1d6ea'],
  arcsine: ['#8f80a6', '#e0d8e9'],
  radical: ['#b48682', '#ecd8d1'],
  fraction: ['#7c959c', '#d8e5e3'],
  nested: ['#b59163', '#e9d9bd'],
};
function path(ctx: Ctx, points: number[][], fill?: string, stroke = INK, width = 2.3): void {
  ctx.beginPath();
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    if (p.length === 6) ctx.bezierCurveTo(p[0]!, p[1]!, p[2]!, p[3]!, p[4]!, p[5]!);
    else if (p.length === 4) ctx.quadraticCurveTo(p[0]!, p[1]!, p[2]!, p[3]!);
    else if (i === 0) ctx.moveTo(p[0]!, p[1]!);
    else ctx.lineTo(p[0]!, p[1]!);
  }
  if (fill) {
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  }
  ctx.strokeStyle = stroke;
  ctx.lineWidth = width;
  ctx.stroke();
}
function ellipse(
  ctx: Ctx,
  x: number,
  y: number,
  rx: number,
  ry: number,
  fill: string,
  stroke?: string,
): void {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 2.3;
    ctx.stroke();
  }
}
function line(
  ctx: Ctx,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color = INK,
  width = 2,
): void {
  path(
    ctx,
    [
      [x1, y1],
      [x2, y2],
    ],
    undefined,
    color,
    width,
  );
}
function text(ctx: Ctx, value: string, x: number, y: number, size: number, color = INK): void {
  ctx.font = `italic ${size}px Georgia, "Cambria Math", serif`;
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(value, x, y);
}
function face(ctx: Ctx, x: number, y: number, angry = false): void {
  ellipse(ctx, x - 6, y, 2, 3, INK);
  ellipse(ctx, x + 6, y, 2, 3, INK);
  if (angry) {
    line(ctx, x - 10, y - 7, x - 3, y - 4, INK, 1.5);
    line(ctx, x + 3, y - 4, x + 10, y - 7, INK, 1.5);
  } else
    path(
      ctx,
      [
        [x - 3, y + 7],
        [x, y + 10, x + 4, y + 6],
      ],
      undefined,
      INK,
      1.4,
    );
}
function leaf(ctx: Ctx, x: number, y: number, direction: number, color: string): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(direction, 1);
  path(
    ctx,
    [
      [0, 0],
      [-19, -2, -23, -20],
      [-1, -21, 0, 0],
    ],
    color,
  );
  line(ctx, 0, 0, -16, -13, INK, 1);
  ctx.restore();
}
function shadow(ctx: Ctx): void {
  ellipse(ctx, 0, 44, 37, 6, '#283e2520');
  ellipse(ctx, 0, 44, 26, 3, '#283e2510');
}

export function paintUnit(ctx: Ctx, id: UnitId, x: number, y: number, scale = 1): void {
  const unit = unitById(id);
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  shadow(ctx);
  if (id === 'derivative') {
    path(
      ctx,
      [
        [-14, 13],
        [-25, 41],
        [-16, 44],
        [0, 20],
        [16, 43],
        [24, 40],
        [13, 11],
      ],
      '#ddd9bc',
    );
    path(
      ctx,
      [
        [-13, 25],
        [-10, 43],
        [11, 43],
        [15, 25],
      ],
      '#bbc79c',
    );
    line(ctx, 0, 8, 0, 31, unit.color, 6);
    leaf(ctx, -1, 27, 1, '#bbcfaa');
    leaf(ctx, 1, 25, -1, '#d5e1bf');
    path(
      ctx,
      [
        [2, -29],
        [36, -30],
        [42, -24],
        [42, -9],
        [8, -7],
      ],
      '#cbdab6',
    );
    ellipse(ctx, 39, -19, 6, 10, PAPER, INK);
    ellipse(ctx, -7, -18, 25, 25, '#d7e3be', INK);
    path(
      ctx,
      [
        [-30, -31],
        [-19, -51, 3, -44],
        [7, -35],
      ],
      unit.color,
    );
    path(
      ctx,
      [
        [-9, -43],
        [-10, -55, 1, -53],
      ],
      undefined,
      unit.color,
      3,
    );
    text(ctx, 'D', -7, -24, 23);
    face(ctx, -8, -5);
    ellipse(ctx, 0, 15, 8, 6, PAPER, INK);
    line(ctx, -4, 15, 5, 15, unit.color, 1.4);
    line(ctx, -19, 36, -17, 33, INK, 1);
    line(ctx, 19, 36, 16, 34, INK, 1);
  } else if (isBomb(id)) {
    ellipse(ctx, 0, 9, 31, 32, unit.light, INK);
    ellipse(ctx, -10, -3, 10, 14, '#ffffff70');
    path(
      ctx,
      [
        [-10, -20],
        [-9, -30],
        [10, -30],
        [12, -20],
      ],
      unit.color,
    );
    path(
      ctx,
      [
        [1, -30],
        [5, -47, 20, -42],
        [28, -35, 30, -49],
      ],
      undefined,
      INK,
      3,
    );
    for (let i = 0; i < 6; i++) {
      const angle = (i * Math.PI) / 3;
      line(
        ctx,
        30 + Math.cos(angle) * 5,
        -49 + Math.sin(angle) * 5,
        30 + Math.cos(angle) * 10,
        -49 + Math.sin(angle) * 10,
        '#ce9857',
        2,
      );
    }
    text(ctx, id === 'bomb' ? '1' : id === 'areaBomb' ? '3×3' : '↔', 0, 2, 21, unit.color);
    face(ctx, 0, 22);
  } else {
    path(
      ctx,
      [
        [-30, 39],
        [-28, -12],
        [-27, -41, 0, -43],
        [29, -42, 29, -11],
        [31, 39],
        [18, 39],
        [18, -9],
        [17, -28, 0, -29],
        [-16, -28, -17, -10],
        [-18, 39],
      ],
      unit.light,
    );
    path(
      ctx,
      [
        [-35, 40],
        [-27, 44, -14, 41],
      ],
      undefined,
      INK,
      2,
    );
    path(
      ctx,
      [
        [14, 41],
        [29, 44, 36, 39],
      ],
      undefined,
      INK,
      2,
    );
    ctx.save();
    ctx.setLineDash([3, 4]);
    path(
      ctx,
      [
        [-14, 37],
        [0, 31, 14, 37],
      ],
      undefined,
      unit.color,
      1.5,
    );
    ctx.restore();
    if (id === 'ln') {
      leaf(ctx, -24, -6, 1, '#c3bc8d');
      leaf(ctx, 24, 20, -1, '#d9d6aa');
    }
    if (id === 'exp') {
      line(ctx, -38, 4, -38, -23, unit.color, 1.4);
      line(ctx, -38, 4, -19, 4, unit.color, 1.4);
      path(
        ctx,
        [
          [-35, 1],
          [-22, -2, -20, -24],
        ],
        undefined,
        unit.color,
        2.5,
      );
    }
    if (id === 'asin') {
      ctx.beginPath();
      ctx.arc(0, -25, 32, Math.PI, Math.PI * 2);
      ctx.strokeStyle = unit.color;
      ctx.lineWidth = 2;
      ctx.stroke();
      for (let i = 0; i <= 6; i++) {
        const a = Math.PI + (i * Math.PI) / 6;
        line(
          ctx,
          Math.cos(a) * 27,
          -25 + Math.sin(a) * 27,
          Math.cos(a) * 32,
          -25 + Math.sin(a) * 32,
          unit.color,
          1,
        );
      }
    }
    if (id === 'sin')
      path(
        ctx,
        [
          [-39, -41],
          [-29, -60, -22, -23, -11, -42],
          [-1, -61, 8, -24, 18, -42],
          [27, -56, 34, -34, 41, -40],
        ],
        undefined,
        unit.color,
        2.8,
      );
    if (id === 'square') {
      path(
        ctx,
        [
          [-34, -17],
          [-35, -48],
          [34, -48],
          [35, -17],
        ],
        undefined,
        unit.color,
        2,
      );
      path(
        ctx,
        [
          [-40, -40],
          [-40, -54],
          [-26, -54],
        ],
        undefined,
        unit.color,
        1.5,
      );
      path(
        ctx,
        [
          [40, -40],
          [40, -54],
          [27, -54],
        ],
        undefined,
        unit.color,
        1.5,
      );
    }
    if (id === 'reciprocal') {
      path(
        ctx,
        [
          [-38, -24],
          [-49, -3, -37, 17],
          [-42, 12],
        ],
        undefined,
        unit.color,
        2,
      );
      path(
        ctx,
        [
          [38, 17],
          [49, -5, 37, -24],
          [42, -19],
        ],
        undefined,
        unit.color,
        2,
      );
      line(ctx, -6, 13, 6, 13, unit.color, 1.5);
    }
    path(
      ctx,
      [
        [-28, -42],
        [0, -48, 28, -42],
        [29, -22],
        [0, -18, -29, -23],
      ],
      PAPER,
    );
    text(ctx, unit.symbol, 0, -32, id === 'asin' ? 16 : 23, unit.color);
    face(ctx, 0, -4);
    line(ctx, -25, 22, -22, 25, '#899581', 1);
    line(ctx, 22, 8, 26, 12, '#899581', 1);
  }
  ctx.restore();
}

export function paintEnemy(
  ctx: Ctx,
  kind: EnemyKind,
  x: number,
  y: number,
  scale = 1,
  formula?: string,
): void {
  const [color, soft] = COLORS[kind] ?? COLORS.linear!;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  shadow(ctx);
  if (kind === 'linear') {
    path(
      ctx,
      [
        [-29, -27],
        [23, -31],
        [33, 19],
        [-26, 25],
        [-36, 6],
      ],
      soft,
    );
    path(
      ctx,
      [
        [16, -29],
        [14, -15],
        [25, -18],
      ],
      PAPER,
      INK,
      1.3,
    );
    path(
      ctx,
      [
        [-18, 24],
        [-24, 39],
        [-35, 39],
      ],
      undefined,
      INK,
      2.5,
    );
    path(
      ctx,
      [
        [15, 25],
        [21, 39],
        [30, 39],
      ],
      undefined,
      INK,
      2.5,
    );
    face(ctx, -3, 13, true);
  } else if (kind === 'power') {
    path(
      ctx,
      [
        [-32, 11],
        [-24, -7],
        [26, -9],
        [35, 22],
        [22, 34],
        [-28, 32],
      ],
      color,
    );
    path(
      ctx,
      [
        [-30, -3],
        [-26, -28],
        [22, -32],
        [31, 2],
        [19, 12],
        [-27, 11],
      ],
      soft,
    );
    path(
      ctx,
      [
        [-23, -26],
        [-18, -44],
        [14, -47],
        [26, -30],
        [16, -17],
        [-19, -16],
      ],
      PAPER,
    );
    line(ctx, -17, 34, -25, 43);
    line(ctx, 16, 34, 25, 42);
    face(ctx, 0, 24, true);
  } else if (kind === 'exponential' || kind === 'nested') {
    path(
      ctx,
      [
        [-31, 22],
        [-40, 13, -40, 2],
        [-43, -10, -28, -7],
        [-17, -2, -13, 17],
        [29, 17],
        [40, 36, 21, 38],
        [-25, 36],
        [-37, 35, -31, 22],
      ],
      soft,
    );
    ellipse(ctx, 7, -8, 31, 33, soft, INK);
    path(
      ctx,
      [
        [11, 14],
        [43, 4, 26, -45, 0, -36],
        [-23, -28, -17, 8, 2, 8],
      ],
      undefined,
      color,
      2.2,
    );
    line(ctx, -32, -3, -40, -18, INK, 1.6);
    line(ctx, -26, -4, -25, -21, INK, 1.6);
    ellipse(ctx, -40, -19, 3, 3, INK);
    ellipse(ctx, -25, -22, 3, 3, INK);
    if (kind === 'nested') {
      ellipse(ctx, 29, 21, 10, 10, PAPER, INK);
      text(ctx, '?', 29, 21, 15, color);
    }
  } else if (kind === 'logarithm') {
    path(
      ctx,
      [
        [-27, -38],
        [21, -38],
        [35, -39, 34, -24],
        [25, 30],
        [19, 40, -27, 33],
        [-18, 17],
      ],
      soft,
    );
    ellipse(ctx, -23, -33, 12, 8, PAPER, INK);
    path(
      ctx,
      [
        [-29, -33],
        [-21, -40, -17, -32],
        [-18, -28, -23, -30],
      ],
      undefined,
      INK,
      1.2,
    );
    path(
      ctx,
      [
        [-27, 28],
        [-33, 43, -12, 41],
        [25, 39],
        [36, 30, 25, 27],
      ],
      PAPER,
    );
    line(ctx, -17, 42, -25, 46);
    line(ctx, 19, 39, 26, 44);
    face(ctx, 2, 18, true);
  } else if (kind === 'sine') {
    path(
      ctx,
      [
        [-41, 18],
        [-46, -3, -25, -15, -11, -3],
        [3, 9, 9, -33, 30, -21],
        [51, -12, 42, 17, 27, 22],
        [10, 28, 5, 18, -8, 26],
        [-20, 34, -41, 36, -41, 18],
      ],
      soft,
    );
    path(
      ctx,
      [
        [-34, 13],
        [-16, -12, -8, 36, 8, 7],
        [17, -7, 21, -5, 31, -4],
      ],
      undefined,
      color,
      2,
    );
    line(ctx, -26, 31, -31, 42);
    line(ctx, -8, 29, -7, 40);
    line(ctx, 17, 26, 24, 37);
    face(ctx, -31, 8);
  } else if (kind === 'arcsine') {
    path(
      ctx,
      [
        [-41, 16],
        [-45, -47, 47, -47, 41, 16],
      ],
      soft,
    );
    path(
      ctx,
      [
        [-28, 8],
        [-28, -23, 30, -23, 28, 8],
      ],
      PAPER,
      INK,
      1.2,
    );
    for (let i = 0; i <= 6; i++) {
      const a = Math.PI + (i * Math.PI) / 6;
      line(
        ctx,
        Math.cos(a) * 34,
        13 + Math.sin(a) * 41,
        Math.cos(a) * 40,
        13 + Math.sin(a) * 47,
        color,
        1.2,
      );
    }
    path(
      ctx,
      [
        [-26, 16],
        [-31, 33],
        [-40, 36],
      ],
      undefined,
    );
    line(ctx, -10, 16, -11, 35);
    path(
      ctx,
      [
        [15, 16],
        [22, 34],
        [31, 34],
      ],
      undefined,
    );
    face(ctx, -6, 25, true);
  } else if (kind === 'radical') {
    path(
      ctx,
      [
        [-39, -3],
        [-24, -12],
        [-14, 7],
        [-3, -39],
        [35, -35],
        [26, 27],
        [-20, 32],
      ],
      soft,
    );
    path(
      ctx,
      [
        [-36, -3],
        [-25, -8],
        [-14, 19],
        [-2, -34],
        [32, -30],
      ],
      undefined,
      color,
      4,
    );
    path(
      ctx,
      [
        [-17, 32],
        [-24, 42],
        [-34, 42],
      ],
      undefined,
    );
    path(
      ctx,
      [
        [17, 30],
        [24, 41],
        [32, 41],
      ],
      undefined,
    );
    face(ctx, 6, 20, true);
  } else {
    path(
      ctx,
      [
        [-20, -43],
        [22, -39],
        [25, -10],
        [-21, -11],
      ],
      soft,
    );
    path(
      ctx,
      [
        [-24, 9],
        [24, 8],
        [30, 38],
        [-27, 40],
      ],
      soft,
    );
    line(ctx, -36, -1, 36, -1, color, 3);
    text(ctx, '1', 1, -26, 25);
    text(ctx, 'x', 1, 24, 26);
    ellipse(ctx, -11, -8, 2, 3, INK);
    ellipse(ctx, 10, -8, 2, 3, INK);
  }
  if (formula && kind !== 'fraction') {
    let ty = -10,
      tx = 0;
    if (kind === 'sine') {
      tx = 10;
      ty = 9;
    }
    if (kind === 'arcsine') ty = 0;
    if (kind === 'power') ty = -3;
    if (kind === 'exponential' || kind === 'nested') tx = 7;
    text(ctx, formula, tx, ty, formula.length > 7 ? 13 : formula.length > 4 ? 18 : 26);
  }
  ctx.restore();
}

export function unitCanvas(id: UnitId): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  paintUnit(canvas.getContext('2d')!, id, 128, 138, 2);
  return canvas;
}
export function enemyCanvas(kind: EnemyKind, formula?: string): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  paintEnemy(canvas.getContext('2d')!, kind, 128, 132, 2, formula);
  return canvas;
}
const cards = new Map<string, string>();
export function portrait(id: UnitId): string {
  if (!cards.has(id)) cards.set(id, unitCanvas(id).toDataURL());
  return cards.get(id)!;
}
export function enemyPortrait(kind: EnemyKind, formula: string): string {
  const k = `enemy:${kind}`;
  if (!cards.has(k)) cards.set(k, enemyCanvas(kind, formula).toDataURL());
  return cards.get(k)!;
}
export function heroArt(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext('2d')!;
  canvas.width = 1100;
  canvas.height = 430;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (let row = 0; row < 4; row++)
    for (let col = 0; col < 10; col++) {
      ctx.fillStyle = (row + col) % 2 === 0 ? '#e9edde' : '#f0eee2';
      ctx.fillRect(col * 110, row * 106, 109, 105);
    }
  ctx.save();
  ctx.globalAlpha = 0.25;
  ctx.strokeStyle = '#9fad8f';
  for (let x = 0; x <= 1100; x += 110) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, 430);
    ctx.stroke();
  }
  ctx.restore();
  paintUnit(ctx, 'derivative', 175, 275, 2.2);
  paintUnit(ctx, 'ln', 475, 275, 2.2);
  paintEnemy(ctx, 'exponential', 805, 270, 2.3, 'eˣ');
  paintEnemy(ctx, 'power', 1055, 70, 1.8, 'x³');
  paintUnit(ctx, 'square', 40, 40, 1.7);
  text(ctx, 'D', 320, 255, 30, '#52775a');
  ellipse(ctx, 320, 255, 24, 24, '#fbf8ec88', '#70916c');
  text(ctx, 'D', 320, 255, 28, '#52775a');
  for (let i = 0; i < 3; i++) line(ctx, 265 - i * 10, 253, 278 - i * 10, 253, '#8eab80', 2);
}
export const unitTextureIds = UNITS.map((u) => u.id);
