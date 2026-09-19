import { X, n, add, mul, pow, fn } from './math.ts';
import type { Expr, Operation } from './math.ts';

export type EnemyKind =
  | 'linear'
  | 'power'
  | 'exponential'
  | 'logarithm'
  | 'sine'
  | 'arcsine'
  | 'radical'
  | 'fraction'
  | 'nested';
export type BombId = 'bomb' | 'areaBomb' | 'rowBomb';
export type UnitId = Operation | BombId;
export const isBomb = (id: UnitId): id is BombId =>
  id === 'bomb' || id === 'areaBomb' || id === 'rowBomb';
export interface UnitDefinition {
  id: UnitId;
  name: string;
  symbol: string;
  cost: number;
  cooldown: number;
  color: string;
  light: string;
  hint: string;
  example: string;
  level: number;
}
export const UNITS: UnitDefinition[] = [
  {
    id: 'derivative',
    name: '求导塔',
    symbol: 'D',
    cost: 100,
    cooldown: 4,
    color: '#52775a',
    light: '#d9e5c5',
    hint: '基础射程两格；覆盖前方求导塔时，继承其最远射程，可连续联动。',
    example: '3x² → 6x → 6',
    level: 1,
  },
  {
    id: 'ln',
    name: '对数门',
    symbol: 'ln',
    cost: 35,
    cooldown: 2,
    color: '#ad7a44',
    light: '#f2dfbc',
    hint: '对第一个经过的函数取自然对数，用后消失。',
    example: 'eˣ → x',
    level: 3,
  },
  {
    id: 'exp',
    name: '指数门',
    symbol: 'eᵘ',
    cost: 35,
    cooldown: 2,
    color: '#60879a',
    light: '#d8e7ed',
    hint: '将函数放进 e 的指数中，用后消失。',
    example: 'ln(x) → x',
    level: 4,
  },
  {
    id: 'asin',
    name: '反正弦门',
    symbol: 'arcsin',
    cost: 40,
    cooldown: 2,
    color: '#8f75a5',
    light: '#e4daec',
    hint: '反正弦变换；解开正弦时须满足主值区间。',
    example: 'sin(x) → x',
    level: 5,
  },
  {
    id: 'sin',
    name: '正弦门',
    symbol: 'sin',
    cost: 30,
    cooldown: 2,
    color: '#6a9592',
    light: '#d6e8e0',
    hint: '对函数取正弦，可以解开反正弦。',
    example: 'arcsin(x) → x',
    level: 6,
  },
  {
    id: 'square',
    name: '平方门',
    symbol: 'u²',
    cost: 25,
    cooldown: 2,
    color: '#b17b7d',
    light: '#efd9d4',
    hint: '把函数平方，可以解除平方根。',
    example: '√(2x + 1) → 2x + 1',
    level: 7,
  },
  {
    id: 'reciprocal',
    name: '倒数门',
    symbol: '1/u',
    cost: 25,
    cooldown: 2,
    color: '#7c9361',
    light: '#e1e7ca',
    hint: '把函数变为它的倒数；原式不能为零。',
    example: '1/(2x + 1) → 2x + 1',
    level: 8,
  },
  {
    id: 'bomb',
    name: '单格炸弹',
    symbol: '✦',
    cost: 200,
    cooldown: 30,
    color: '#bc735b',
    light: '#f1ddc4',
    hint: '种在空格中，敌人经过该格中点时引爆，清除本格敌人，不伤己方。',
    example: '单格清除 · 200 能量 · 冷却 30 秒',
    level: 2,
  },
  {
    id: 'areaBomb',
    name: '范围炸弹',
    symbol: '✦³',
    cost: 350,
    cooldown: 45,
    color: '#b46e67',
    light: '#efd6ce',
    hint: '种在空格中，敌人经过该格中点时引爆，清除周围 3×3 范围敌人，不伤己方。',
    example: '3×3 清除 · 350 能量 · 冷却 45 秒',
    level: 6,
  },
  {
    id: 'rowBomb',
    name: '清行炸弹',
    symbol: '↔',
    cost: 500,
    cooldown: 60,
    color: '#a65c58',
    light: '#e9c8bf',
    hint: '种在空格中，敌人经过该格中点时引爆，清除本行已登场敌人，不伤己方。',
    example: '整行清除 · 500 能量 · 冷却 60 秒',
    level: 9,
  },
];
export const unitById = (id: UnitId): UnitDefinition => UNITS.find((u) => u.id === id)!;
export interface Level {
  id: number;
  title: string;
  subtitle: string;
  description: string;
  waves: number;
  startingEnergy: number;
  income: number;
  enemyCount: number;
  interval: number;
  pool: EnemyKind[];
  powerDegree: [number, number];
  portrait: UnitId;
  formula: string;
  tip: string;
}
export const LEVELS: Level[] = [
  {
    id: 1,
    title: '求导的清晨',
    subtitle: '先学会，让变量退场',
    description: '建立第一道防线，认识求导与常数。',
    waves: 3,
    startingEnergy: 500,
    income: 9,
    enemyCount: 5,
    interval: 3.8,
    pool: ['linear', 'linear', 'power'],
    powerDegree: [2, 2],
    portrait: 'derivative',
    formula: 'x² → 2x → 2',
    tip: '先在五行的第 4 列各放一座求导塔。一次函数一击、二次函数两击即可消灭。',
  },
  {
    id: 2,
    title: '并肩的防线',
    subtitle: '让后排也加入战斗',
    description: '练习连续求导，尝试联动射程与单格炸弹。',
    waves: 3,
    startingEnergy: 600,
    income: 10,
    enemyCount: 5,
    interval: 3.8,
    pool: ['linear', 'power', 'power'],
    powerDegree: [2, 3],
    portrait: 'derivative',
    formula: 'x³ → 3x² → 6x → 6',
    tip: '在同一行相距不超过两列的求导塔可以联动。单格炸弹可救急，花费 200 能量、冷却 30 秒。',
  },
  {
    id: 3,
    title: '指数的钥匙',
    subtitle: '有些敌人，需要换个思路',
    description: '只引入一种新函数：用对数门解开指数。',
    waves: 3,
    startingEnergy: 650,
    income: 11,
    enemyCount: 6,
    interval: 3.8,
    pool: ['linear', 'exponential', 'power'],
    powerDegree: [3, 4],
    portrait: 'ln',
    formula: 'ln(eˣ) = x',
    tip: 'eˣ 不怕求导！第 4 列放塔，第 7 列放 ln 门，让敌人先经过门的中点再进入火力范围。',
  },
  {
    id: 4,
    title: '对数的回声',
    subtitle: '认识指数与对数的配对',
    description: '加入对数函数，学会选择两种互逆的门。',
    waves: 3,
    startingEnergy: 700,
    income: 12,
    enemyCount: 6,
    interval: 3.7,
    pool: ['power', 'exponential', 'logarithm'],
    powerDegree: [4, 5],
    portrait: 'exp',
    formula: 'e^(ln x) = x',
    tip: '指数函数用 ln 门，对数函数用指数门。敌人还在格子右半边时，可以暂停补门。',
  },
  {
    id: 5,
    title: '正弦的波纹',
    subtitle: '先解波形，再做求导',
    description: '加入正弦函数，用反正弦门还原它。',
    waves: 3,
    startingEnergy: 750,
    income: 13,
    enemyCount: 6,
    interval: 3.6,
    pool: ['power', 'exponential', 'logarithm', 'sine'],
    powerDegree: [5, 6],
    portrait: 'asin',
    formula: 'arcsin(sin x) = x',
    tip: '正弦函数先过反正弦门。高次多项式需要更多次求导，可以在前塔后方补一座联动塔。',
  },
  {
    id: 6,
    title: '反向的旋律',
    subtitle: '两种波形，分别化解',
    description: '加入反正弦函数和范围炸弹，练习识别与补救。',
    waves: 3,
    startingEnergy: 800,
    income: 14,
    enemyCount: 7,
    interval: 3.6,
    pool: ['power', 'exponential', 'logarithm', 'sine', 'arcsine'],
    powerDegree: [6, 8],
    portrait: 'sin',
    formula: 'sin(arcsin x) = x',
    tip: '反正弦函数用正弦门。3×3 范围炸弹可以解围，花费 350 能量、冷却 45 秒。',
  },
  {
    id: 7,
    title: '根号下的秘密',
    subtitle: '用平方解开根式',
    description: '加入根式，继续强化防线应对八到十次多项式。',
    waves: 3,
    startingEnergy: 850,
    income: 15,
    enemyCount: 7,
    interval: 3.5,
    pool: ['power', 'power', 'sine', 'arcsine', 'radical'],
    powerDegree: [8, 10],
    portrait: 'square',
    formula: '(√(2x + 1))² = 2x + 1',
    tip: '根式用平方门。建议每行逐步建成两座联动求导塔，应对越来越厚的多项式纸甲。',
  },
  {
    id: 8,
    title: '分母的另一边',
    subtitle: '倒过来看，事情会简单些',
    description: '加入分式，用倒数门化简后再集中求导。',
    waves: 4,
    startingEnergy: 900,
    income: 16,
    enemyCount: 7,
    interval: 3.5,
    pool: ['power', 'power', 'exponential', 'logarithm', 'radical', 'fraction'],
    powerDegree: [10, 12],
    portrait: 'reciprocal',
    formula: '1 / (1 / (2x + 1)) = 2x + 1',
    tip: '分式先过倒数门。前塔被毁会让后排射程缩短，注意补塔保持联动。',
  },
  {
    id: 9,
    title: '层层嵌套',
    subtitle: '把两道门的顺序排好',
    description: '加入嵌套函数与清行炸弹，练习两步变换。',
    waves: 4,
    startingEnergy: 950,
    income: 18,
    enemyCount: 7,
    interval: 3.4,
    pool: ['power', 'power', 'radical', 'fraction', 'nested'],
    powerDegree: [12, 16],
    portrait: 'rowBomb',
    formula: 'e^(sin x) → sin x → x',
    tip: '第 9 列放 ln 门，第 7 列放反正弦门，第 4 列及后方布塔。清行炸弹花费 500 能量、冷却 60 秒。',
  },
  {
    id: 10,
    title: '花园的协奏',
    subtitle: '每一道函数，都不止一条路',
    description: '综合全部函数与最高二十次多项式，让整条防线一起出手。',
    waves: 4,
    startingEnergy: 999,
    income: 20,
    enemyCount: 8,
    interval: 3.3,
    pool: [
      'power',
      'power',
      'exponential',
      'logarithm',
      'sine',
      'arcsine',
      'radical',
      'fraction',
      'nested',
    ],
    powerDegree: [16, 20],
    portrait: 'derivative',
    formula: 'x²⁰ → … → 常数',
    tip: '每行建立三座联动塔，先变换再集火。暂停补种、预留炸弹能量，让失误还有挽回的机会。',
  },
];
export const ENEMIES: {
  kind: EnemyKind;
  name: string;
  formula: string;
  route: string;
  color: string;
}[] = [
  { kind: 'linear', name: '纸片小兵', formula: '3x', route: '求导 → 3', color: '#72936a' },
  {
    kind: 'power',
    name: '叠层纸甲',
    formula: '2x³ + x',
    route: '连续求导三次 → 常数',
    color: '#7193a0',
  },
  {
    kind: 'exponential',
    name: '螺旋壳怪',
    formula: 'e^(2x)',
    route: 'ln 门 → 2x → 求导 → 2',
    color: '#ba8d53',
  },
  {
    kind: 'logarithm',
    name: '卷轴怪',
    formula: 'ln(3x + 1)',
    route: '指数门 → 3x + 1 → 求导 → 3',
    color: '#b69363',
  },
  {
    kind: 'sine',
    name: '波浪软虫',
    formula: 'sin(x)',
    route: '反正弦门 → x → 求导 → 1',
    color: '#9c82ab',
  },
  {
    kind: 'arcsine',
    name: '量角器甲虫',
    formula: 'arcsin(x)',
    route: '正弦门 → x → 求导 → 1',
    color: '#9585b0',
  },
  {
    kind: 'radical',
    name: '折角纸兽',
    formula: '√(2x + 1)',
    route: '平方门 → 2x + 1 → 求导 → 2',
    color: '#b58787',
  },
  {
    kind: 'fraction',
    name: '悬浮分数怪',
    formula: '1/(2x + 1)',
    route: '倒数门 → 2x + 1 → 求导 → 2',
    color: '#77959b',
  },
  {
    kind: 'nested',
    name: '双层谜题',
    formula: 'e^(sin x)',
    route: 'ln 门 → 反正弦门 → 求导',
    color: '#a48861',
  },
];

export class Random {
  private state: number;
  constructor(seed: number) {
    this.state = seed >>> 0 || 1;
  }
  next(): number {
    let x = this.state;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.state = x >>> 0;
    return this.state / 4294967296;
  }
  int(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }
  pick<T>(items: readonly T[]): T {
    return items[this.int(0, items.length - 1)]!;
  }
}
export function generateEnemy(
  kind: EnemyKind,
  random: Random,
  powerDegree: readonly [number, number] = [2, 3],
): { expression: Expr; solution: Operation[] } {
  const a = random.int(1, 5),
    b = random.int(1, 3),
    linear = add(mul(n(a), X), n(b));
  switch (kind) {
    case 'linear':
      return {
        expression: add(mul(n(random.pick([-1, 1]) * a), X), n(random.int(-3, 3))),
        solution: ['derivative'],
      };
    case 'power': {
      const degree = random.int(powerDegree[0], powerDegree[1]);
      return {
        expression: add(mul(n(a), pow(X, degree)), mul(n(b), X), n(random.int(-4, 4))),
        solution: Array.from({ length: degree }, () => 'derivative'),
      };
    }
    case 'exponential':
      return {
        expression: mul(n(random.int(1, 3)), fn('exp', linear)),
        solution: ['ln', 'derivative'],
      };
    case 'logarithm':
      return { expression: fn('ln', linear), solution: ['exp', 'derivative'] };
    case 'sine':
      return {
        expression: fn('sin', mul(n(random.pick([0.5, 1])), X)),
        solution: ['asin', 'derivative'],
      };
    case 'arcsine':
      return {
        expression: fn('asin', mul(n(random.pick([0.5, 0.75, 1])), X)),
        solution: ['sin', 'derivative'],
      };
    case 'radical':
      return { expression: pow(linear, 0.5), solution: ['square', 'derivative'] };
    case 'fraction':
      return { expression: pow(linear, -1), solution: ['reciprocal', 'derivative'] };
    case 'nested':
      return {
        expression: fn('exp', fn('sin', mul(n(random.pick([0.5, 1])), X))),
        solution: ['ln', 'asin', 'derivative'],
      };
  }
}
