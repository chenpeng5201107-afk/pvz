import { LEVELS, Random, generateEnemy, unitById, isBomb } from './content.ts';
import type { Level, EnemyKind, UnitId, BombId } from './content.ts';
import { operate, format } from './math.ts';
import type { Expr, Operation } from './math.ts';

export const ROWS = 5,
  COLS = 9,
  TOWER_HP = 140;
export function blastArea(kind: BombId, row: number, col: number) {
  const radius = kind === 'areaBomb' ? 1 : 0;
  return {
    firstRow: Math.max(0, row - radius),
    lastRow: Math.min(ROWS - 1, row + radius),
    left: kind === 'rowBomb' ? 0 : Math.max(0, col - radius),
    right: kind === 'rowBomb' ? COLS : Math.min(COLS, col + radius + 1),
  };
}
export interface Unit {
  id: number;
  kind: UnitId;
  row: number;
  col: number;
  hp: number;
  shotCooldown: number;
}
export interface Enemy {
  id: number;
  kind: EnemyKind;
  row: number;
  x: number;
  expression: Expr;
  speed: number;
  biteCooldown: number;
  alive: boolean;
  hitFlash: number;
}
export interface Bullet {
  id: number;
  targetId: number;
  row: number;
  x: number;
}
export type Phase = 'preparing' | 'running' | 'paused' | 'won' | 'lost';
export type BattleEvent = {
  type:
    | 'place'
    | 'remove'
    | 'shot'
    | 'hit'
    | 'transform'
    | 'invalid'
    | 'kill'
    | 'explosion'
    | 'bite'
    | 'destroy'
    | 'leak'
    | 'wave'
    | 'won'
    | 'lost';
  row: number;
  x: number;
  text?: string;
  unchanged?: boolean;
  bomb?: BombId;
};
interface Spawn {
  at: number;
  row: number;
  kind: EnemyKind;
  expression: Expr;
}

/** Pure simulation: the renderer never owns combat state or wall-clock timers. */
export class Battle {
  readonly level: Level;
  readonly seed: number;
  phase: Phase = 'preparing';
  units: Unit[] = [];
  enemies: Enemy[] = [];
  bullets: Bullet[] = [];
  energy: number;
  lives = 3;
  kills = 0;
  time = 0;
  wave = 0;
  waveTime = 0;
  intermission = 0;
  cooldowns: Partial<Record<UnitId, number>> = {};
  private random: Random;
  private nextId = 1;
  private spawns: Spawn[] = [];
  private events: BattleEvent[] = [];
  constructor(levelId: number, seed: number) {
    const level = LEVELS.find((l) => l.id === levelId);
    if (!level) throw new Error('未知关卡');
    this.level = level;
    this.seed = seed;
    this.random = new Random(seed);
    this.energy = level.startingEnergy;
  }
  get remaining(): number {
    return this.spawns.length + this.enemies.length;
  }
  get stars(): number {
    return this.phase === 'won' ? this.lives : 0;
  }
  drainEvents(): BattleEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }
  private emit(event: BattleEvent): void {
    this.events.push(event);
  }
  start(): void {
    if (this.phase !== 'preparing') return;
    this.phase = 'running';
    this.nextWave();
  }
  pause(): void {
    if (this.phase === 'running') this.phase = 'paused';
  }
  resume(): void {
    if (this.phase === 'paused') this.phase = 'running';
  }
  private nextWave(): void {
    this.wave++;
    this.waveTime = 0;
    this.intermission = 0;
    const count = this.level.enemyCount + (this.wave - 1) * 2;
    const rows = this.wave === 1 ? [0, 2, 4] : [0, 1, 2, 3, 4];
    this.spawns = Array.from({ length: count }, (_, i) => {
      const kind =
        this.level.id === 1 && this.wave === 1 ? 'linear' : this.random.pick(this.level.pool);
      return {
        at: 2 + i * this.level.interval,
        row: rows[i % rows.length]!,
        kind,
        expression: generateEnemy(kind, this.random, this.level.powerDegree).expression,
      };
    });
    this.emit({ type: 'wave', row: 2, x: 4.5, text: `第 ${this.wave} / ${this.level.waves} 波` });
  }
  canPlace(kind: UnitId, row: number, col: number): string | null {
    if (!['preparing', 'running', 'paused'].includes(this.phase)) return '战斗已经结束';
    if (
      !Number.isInteger(row) ||
      !Number.isInteger(col) ||
      row < 0 ||
      row >= ROWS ||
      col < 0 ||
      col >= COLS
    )
      return '请选择棋盘中的格子';
    const definition = unitById(kind);
    if (!definition || definition.level > this.level.id) return '这个单位尚未在本关开放';
    if (isBomb(kind) && this.phase === 'preparing') return '战斗开始后才能使用炸弹';
    if (this.units.some((u) => u.row === row && u.col === col)) return '这个格子已经有单位';
    if (this.energy < definition.cost) return '能量不足';
    if (this.phase !== 'preparing' && (this.cooldowns[kind] ?? 0) > 0) return '卡牌还在冷却';
    return null;
  }
  place(kind: UnitId, row: number, col: number): string | null {
    const error = this.canPlace(kind, row, col);
    if (error) return error;
    const definition = unitById(kind);
    this.energy -= definition.cost;
    if (this.phase !== 'preparing') this.cooldowns[kind] = definition.cooldown;
    this.units.push({ id: this.nextId++, kind, row, col, hp: TOWER_HP, shotCooldown: 0 });
    this.emit({ type: 'place', row, x: col + 0.5 });
    return null;
  }
  remove(row: number, col: number): boolean {
    if (this.phase === 'won' || this.phase === 'lost') return false;
    const unit = this.units.find((u) => !isBomb(u.kind) && u.row === row && u.col === col);
    if (!unit) return false;
    this.energy = Math.min(999, this.energy + Math.floor(unitById(unit.kind).cost * 0.5));
    this.units = this.units.filter((u) => u.id !== unit.id);
    this.emit({ type: 'remove', row, x: col + 0.5, text: '回收 50%' });
    return true;
  }
  preview(kind: UnitId, row: number, col: number): string {
    if (kind === 'derivative') {
      const reach = this.towerReach(row, col);
      return `持续求导 · 最远覆盖第 ${Math.min(COLS, reach)} 列${reach > col + 3 ? ' · 已联动前方炮台' : ' · 基础射程两格'}`;
    }
    const passed = this.enemies.some(
      (e) => e.alive && e.row === row && e.x >= col && e.x < col + 0.5,
    );
    const enemy = this.enemies
      .filter((e) => e.alive && e.row === row && e.x >= col + 0.5)
      .sort((a, b) => a.x - b.x)[0];
    const hint = passed ? '已过中点的敌人不会触发；' : '经过格子中点触发；';
    if (isBomb(kind)) return `${hint}${unitById(kind).example} · 不伤己方`;
    if (!enemy) return hint + unitById(kind).example;
    const result = operate(enemy.expression, kind);
    return (
      hint +
      (result.ok ? `${format(enemy.expression)} → ${format(result.expression)}` : result.reason)
    );
  }
  towerReach(row: number, col: number): number {
    let reach = col + 3;
    const towers = this.units
      .filter((u) => u.kind === 'derivative' && u.row === row && u.col > col)
      .sort((a, b) => a.col - b.col);
    for (const tower of towers) {
      if (tower.col >= reach) break;
      reach = tower.col + 3;
    }
    return reach;
  }
  private kill(enemy: Enemy, text: string): void {
    if (!enemy.alive) return;
    enemy.alive = false;
    this.kills++;
    this.energy = Math.min(999, this.energy + 18);
    this.emit({ type: 'kill', row: enemy.row, x: enemy.x, text });
  }
  private change(enemy: Enemy, operation: Operation): void {
    const result = operate(enemy.expression, operation);
    if (!result.ok) {
      this.emit({ type: 'invalid', row: enemy.row, x: enemy.x, text: result.reason });
      return;
    }
    enemy.expression = result.expression;
    enemy.hitFlash = 0.18;
    if (result.constant) {
      this.kill(enemy, format(result.expression));
    } else
      this.emit({
        type: operation === 'derivative' ? 'hit' : 'transform',
        row: enemy.row,
        x: enemy.x,
        text: format(result.expression),
        unchanged: result.unchanged,
      });
  }
  step(dt: number): void {
    if (this.phase !== 'running' || dt <= 0) return;
    // Splitting large deltas preserves gate crossings and collision order at any frame rate.
    let remaining = Math.min(dt, 1);
    while (remaining > 1e-8 && this.phase === 'running') {
      const tick = Math.min(remaining, 1 / 60);
      this.tick(tick);
      remaining -= tick;
    }
  }
  private tick(dt: number): void {
    this.time += dt;
    this.waveTime += dt;
    this.energy = Math.min(999, this.energy + dt * this.level.income);
    for (const id of Object.keys(this.cooldowns) as UnitId[])
      this.cooldowns[id] = Math.max(0, (this.cooldowns[id] ?? 0) - dt);
    while (this.spawns[0] && this.spawns[0].at <= this.waveTime) {
      const spawn = this.spawns.shift()!,
        back = Math.max(
          8.7,
          ...this.enemies.filter((e) => e.row === spawn.row && e.alive).map((e) => e.x),
        );
      this.enemies.push({
        id: this.nextId++,
        kind: spawn.kind,
        row: spawn.row,
        x: Math.max(9.35, back + 1.05),
        expression: spawn.expression,
        speed: 0.31 + (this.wave - 1) * 0.012,
        biteCooldown: 0,
        alive: true,
        hitFlash: 0,
      });
    }
    for (let row = 0; row < ROWS; row++) {
      let previous: Enemy | undefined;
      const rowEnemies = this.enemies
        .filter((e) => e.row === row && e.alive)
        .sort((a, b) => a.x - b.x);
      for (const enemy of rowEnemies) {
        if (!enemy.alive) continue;
        enemy.hitFlash = Math.max(0, enemy.hitFlash - dt);
        const oldX = enemy.x;
        let next = oldX - enemy.speed * dt;
        if (previous && previous.alive) next = Math.max(next, Math.min(oldX, previous.x + 1.0));
        const tower = this.units
          .filter(
            (u) =>
              u.row === row &&
              u.kind === 'derivative' &&
              oldX >= u.col + 0.5 &&
              next <= u.col + 1.04,
          )
          .sort((a, b) => b.col - a.col)[0];
        if (tower) {
          next = Math.min(oldX, Math.max(next, tower.col + 1.04));
          enemy.biteCooldown -= dt;
          if (enemy.biteCooldown <= 0) {
            enemy.biteCooldown = 0.9;
            tower.hp -= 12;
            this.emit({ type: 'bite', row, x: tower.col + 0.5 });
            if (tower.hp <= 0) {
              this.units = this.units.filter((u) => u.id !== tower.id);
              this.emit({ type: 'destroy', row, x: tower.col + 0.5, text: '防线被突破' });
            }
          }
        } else enemy.biteCooldown = 0;
        enemy.x = next;
        // Trigger gates and bombs at the cell midpoint before resolving projectiles.
        const crossed = this.units
          .filter(
            (u) =>
              u.row === row &&
              u.kind !== 'derivative' &&
              oldX >= u.col + 0.5 &&
              next <= u.col + 0.5,
          )
          .sort((a, b) => b.col - a.col);
        for (const unit of crossed) {
          if (!enemy.alive) break;
          if (!this.units.some((u) => u.id === unit.id)) continue;
          this.units = this.units.filter((u) => u.id !== unit.id);
          if (isBomb(unit.kind)) {
            const area = blastArea(unit.kind, row, unit.col);
            for (const target of this.enemies)
              if (
                target.alive &&
                target.row >= area.firstRow &&
                target.row <= area.lastRow &&
                (unit.kind === 'rowBomb' || (target.x >= area.left && target.x < area.right))
              )
                this.kill(target, '爆破清除');
            this.emit({ type: 'explosion', row, x: unit.col + 0.5, bomb: unit.kind });
          } else {
            this.change(enemy, unit.kind);
            this.emit({ type: 'remove', row, x: unit.col + 0.5, text: '一次性门已消耗' });
          }
        }
        if (enemy.alive && enemy.x < -0.1) {
          enemy.alive = false;
          this.lives--;
          this.emit({ type: 'leak', row, x: 0, text: '−1 生命' });
        }
        previous = enemy.alive ? enemy : previous;
      }
    }
    this.enemies = this.enemies.filter((e) => e.alive);
    if (this.lives <= 0) {
      this.lives = 0;
      this.phase = 'lost';
      this.emit({ type: 'lost', row: 2, x: 4.5 });
      return;
    }
    for (const unit of this.units) {
      if (unit.kind !== 'derivative') continue;
      unit.shotCooldown = Math.max(0, unit.shotCooldown - dt);
      const reach = this.towerReach(unit.row, unit.col);
      const target = this.enemies
        .filter((e) => e.row === unit.row && e.x >= unit.col + 0.5 && e.x < reach)
        .sort((a, b) => a.x - b.x)[0];
      if (target && unit.shotCooldown <= 0) {
        unit.shotCooldown = 1.25;
        this.bullets.push({
          id: this.nextId++,
          targetId: target.id,
          row: unit.row,
          x: unit.col + 0.82,
        });
        this.emit({ type: 'shot', row: unit.row, x: unit.col + 0.82 });
      }
    }
    const kept: Bullet[] = [];
    for (const bullet of this.bullets) {
      const enemy = this.enemies.find((e) => e.id === bullet.targetId && e.alive);
      if (!enemy) continue;
      bullet.x += 6.5 * dt;
      if (bullet.x >= enemy.x - 0.1) this.change(enemy, 'derivative');
      else kept.push(bullet);
    }
    this.bullets = kept;
    this.enemies = this.enemies.filter((e) => e.alive);
    if (!this.spawns.length && !this.enemies.length) {
      if (this.wave >= this.level.waves) {
        this.phase = 'won';
        this.emit({ type: 'won', row: 2, x: 4.5 });
        return;
      }
      if (this.intermission === 0) {
        this.intermission = 6;
        this.energy = Math.min(999, this.energy + 50);
      }
      this.intermission -= dt;
      if (this.intermission <= 0) this.nextWave();
    }
  }
}
