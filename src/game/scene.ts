import Phaser from 'phaser';
import { Battle, TOWER_HP, blastArea } from '../core/battle.ts';
import type { Enemy, BattleEvent } from '../core/battle.ts';
import { UNITS, ENEMIES, isBomb } from '../core/content.ts';
import type { UnitId, EnemyKind } from '../core/content.ts';
import type { Expr } from '../core/math.ts';
import { format, operate } from '../core/math.ts';
import { unitCanvas, enemyCanvas } from './art.ts';
import type { Sound } from './sound.ts';

export const BOARD = { width: 1120, height: 624, left: 120, top: 64, cell: 100 };
export type Selection = UnitId | 'shovel' | null;
interface Callbacks {
  hud: () => void;
  notice: (message: string) => void;
  preview: (message: string) => void;
  outcome: () => void;
  inspect: (enemy: Enemy) => void;
}
interface Actor {
  container: Phaser.GameObjects.Container;
  image: Phaser.GameObjects.Image;
  label?: Phaser.GameObjects.Text;
  health?: Phaser.GameObjects.Graphics;
  formula?: string;
}
function kindOf(expr: Expr): EnemyKind {
  if (expr.type === 'fn')
    return {
      exp: expr.arg.type === 'fn' ? 'nested' : 'exponential',
      ln: 'logarithm',
      sin: 'sine',
      cos: 'sine',
      tan: 'sine',
      asin: 'arcsine',
      acos: 'arcsine',
      atan: 'arcsine',
    }[expr.name] as EnemyKind;
  if (expr.type === 'pow')
    return expr.exponent < 0
      ? 'fraction'
      : expr.exponent === 0.5
        ? 'radical'
        : expr.exponent > 1
          ? 'power'
          : 'linear';
  if (expr.type === 'add' || expr.type === 'mul')
    return expr.terms.map(kindOf).find((k) => k !== 'linear') ?? 'linear';
  return 'linear';
}
export class GardenScene extends Phaser.Scene {
  model: Battle;
  selection: Selection = 'derivative';
  private callbacks: Callbacks;
  private gardenSound: Sound;
  private units = new Map<number, Actor>();
  private enemies = new Map<number, Actor>();
  private bullets = new Map<number, Phaser.GameObjects.Container>();
  private hover!: Phaser.GameObjects.Graphics;
  private hudAt = 0;
  private finished = false;
  private pointerCell: { row: number; col: number } | null = null;
  private reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  constructor(model: Battle, callbacks: Callbacks, sound: Sound) {
    super('garden');
    this.model = model;
    this.callbacks = callbacks;
    this.gardenSound = sound;
  }
  create(): void {
    for (const unit of UNITS) this.textures.addCanvas(`unit:${unit.id}`, unitCanvas(unit.id));
    for (const enemy of ENEMIES)
      this.textures.addCanvas(`enemy:${enemy.kind}`, enemyCanvas(enemy.kind));
    this.drawBoard();
    this.hover = this.add.graphics().setDepth(2);
    this.input.mouse?.disableContextMenu();
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      const col = Math.floor((pointer.x - BOARD.left) / BOARD.cell),
        row = Math.floor((pointer.y - BOARD.top) / BOARD.cell);
      this.pointerCell = col >= 0 && col < 9 && row >= 0 && row < 5 ? { row, col } : null;
      this.drawHover();
    });
    this.input.on('gameout', () => {
      this.pointerCell = null;
      this.hover.clear();
    });
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (pointer.rightButtonDown()) {
        this.callbacks.notice('已取消选择');
        this.setSelection(null);
        this.callbacks.hud();
        return;
      }
      const col = Math.floor((pointer.x - BOARD.left) / BOARD.cell),
        row = Math.floor((pointer.y - BOARD.top) / BOARD.cell);
      if (col < 0 || col >= 9 || row < 0 || row >= 5) return;
      const enemy = this.model.enemies.find(
        (e) => e.row === row && Math.abs(e.x - (pointer.x - BOARD.left) / BOARD.cell) < 0.45,
      );
      if (this.selection === 'shovel') {
        if (!this.model.remove(row, col)) this.callbacks.notice('这个格子没有可回收的单位');
      } else if (this.selection) {
        const error = this.model.place(this.selection, row, col);
        if (error) this.callbacks.notice(error);
      } else if (enemy) this.callbacks.inspect(enemy);
      this.drawHover();
      this.callbacks.hud();
    });
    this.game.canvas.setAttribute(
      'aria-label',
      '五行九列数学塔防棋盘。选择卡牌后点击格子放置，空格暂停，Esc取消。',
    );
    this.renderActors();
    this.callbacks.hud();
  }
  setSelection(selection: Selection): void {
    this.selection = selection;
    if (this.hover) this.drawHover();
    if (this.game?.canvas) this.game.canvas.style.cursor = selection ? 'crosshair' : 'default';
  }
  private drawBoard(): void {
    const { left, top, cell } = BOARD,
      g = this.add.graphics();
    g.fillStyle(0xf9f7ee);
    g.fillRoundedRect(8, 8, 1104, 606, 20);
    g.lineStyle(1, 0xdfdfcf);
    g.strokeRoundedRect(8, 8, 1104, 606, 20);
    for (let row = 0; row < 5; row++)
      for (let col = 0; col < 9; col++) {
        g.fillStyle((row + col) % 2 === 0 ? 0xf0f1e5 : 0xf5f3e9);
        g.fillRect(left + col * cell, top + row * cell, cell, cell);
      }
    g.lineStyle(1, 0xdde2d2, 0.9);
    for (let col = 0; col <= 9; col++)
      g.lineBetween(left + col * cell, top, left + col * cell, top + 500);
    for (let row = 0; row <= 5; row++)
      g.lineBetween(left, top + row * cell, left + 900, top + row * cell);
    g.lineStyle(2, 0xc2a2a0, 0.6);
    g.lineBetween(left - 10, top, left - 10, top + 500);
    for (let row = 0; row < 5; row++) {
      this.add
        .text(101, top + row * cell + 45, 'ABCDE'[row]!, {
          fontFamily: 'Georgia',
          fontSize: '15px',
          color: '#8d9685',
        })
        .setOrigin(0.5);
      g.fillStyle(0xe2e7d6);
      g.fillRoundedRect(34, top + row * cell + 29, 44, 43, 12);
      g.lineStyle(1, 0xbecbb2);
      g.strokeRoundedRect(34, top + row * cell + 29, 44, 43, 12);
      this.add
        .text(56, top + row * cell + 50, 'ℝ', {
          fontFamily: 'Georgia',
          fontSize: '29px',
          color: '#8b9d7c',
        })
        .setOrigin(0.5);
      for (let mark = 0; mark < 2; mark++) {
        g.lineStyle(2, 0xb2baa5, 0.5);
        g.lineBetween(
          1048 + mark * 13,
          top + row * cell + 46,
          1055 + mark * 13,
          top + row * cell + 51,
        );
        g.lineBetween(
          1048 + mark * 13,
          top + row * cell + 56,
          1055 + mark * 13,
          top + row * cell + 51,
        );
      }
    }
    for (let col = 0; col < 9; col++)
      this.add
        .text(left + (col + 0.5) * cell, 37, String(col + 1), {
          fontFamily: 'Georgia',
          fontSize: '14px',
          color: '#9aa18e',
        })
        .setOrigin(0.5);
    this.add.text(36, 590, '常数域', {
      fontFamily: 'Microsoft YaHei',
      fontSize: '12px',
      color: '#8a9480',
    });
    this.add.text(996, 590, '函数入侵 ←', {
      fontFamily: 'Microsoft YaHei',
      fontSize: '12px',
      color: '#8a9480',
    });
    this.add
      .text(560, 590, '0 < x < 1', {
        fontFamily: 'Georgia',
        fontSize: '15px',
        fontStyle: 'italic',
        color: '#98a189',
      })
      .setOrigin(0.5, 0);
  }
  private drawHover(): void {
    this.hover.clear();
    if (!this.pointerCell) return;
    const { row, col } = this.pointerCell,
      { left, top, cell } = BOARD;
    if (this.selection === 'derivative') {
      const width = (Math.min(9, this.model.towerReach(row, col)) - col - 1) * cell;
      this.hover.fillStyle(0x9ab67d, 0.2);
      this.hover.fillRect(left + (col + 1) * cell, top + row * cell, width, cell);
      this.hover.lineStyle(1, 0x839e6c, 0.7);
      this.hover.strokeRect(left + (col + 1) * cell, top + row * cell, width, cell);
    } else if (this.selection && this.selection !== 'shovel' && isBomb(this.selection)) {
      const area = blastArea(this.selection, row, col);
      this.hover.fillStyle(0xc78162, 0.25);
      this.hover.fillRect(
        left + area.left * cell,
        top + area.firstRow * cell,
        (area.right - area.left) * cell,
        (area.lastRow - area.firstRow + 1) * cell,
      );
      this.hover.lineStyle(2, 0xb36650, 0.8);
      this.hover.strokeRect(
        left + area.left * cell,
        top + area.firstRow * cell,
        (area.right - area.left) * cell,
        (area.lastRow - area.firstRow + 1) * cell,
      );
    }
    if (this.selection && this.selection !== 'shovel' && this.selection !== 'derivative') {
      this.hover.lineStyle(2, 0xb18d59, 0.8);
      this.hover.lineBetween(
        left + (col + 0.5) * cell,
        top + row * cell + 8,
        left + (col + 0.5) * cell,
        top + (row + 1) * cell - 8,
      );
    }
    const error =
      this.selection && this.selection !== 'shovel'
        ? this.model.canPlace(this.selection, row, col)
        : null;
    this.hover.fillStyle(error ? 0xc68d82 : 0x91af77, 0.16);
    this.hover.fillRoundedRect(left + col * cell + 3, top + row * cell + 3, cell - 6, cell - 6, 8);
    this.hover.lineStyle(2, error ? 0xb98479 : 0x6f8e5d, 0.8);
    this.hover.strokeRoundedRect(
      left + col * cell + 3,
      top + row * cell + 3,
      cell - 6,
      cell - 6,
      8,
    );
    if (this.selection && this.selection !== 'shovel')
      this.callbacks.preview(error ?? this.model.preview(this.selection, row, col));
  }
  update(_time: number, delta: number): void {
    this.model.step(Math.min(delta / 1000, 0.1));
    for (const event of this.model.drainEvents()) this.effect(event);
    this.renderActors();
    this.hudAt += delta;
    if (this.hudAt >= 100) {
      this.hudAt = 0;
      this.callbacks.hud();
      this.drawHover();
    }
    if (!this.finished && (this.model.phase === 'won' || this.model.phase === 'lost')) {
      this.finished = true;
      this.time.delayedCall(600, () => this.callbacks.outcome());
    }
  }
  private renderActors(): void {
    const { left, top, cell } = BOARD;
    for (const unit of this.model.units) {
      let actor = this.units.get(unit.id);
      if (!actor) {
        const image = this.add.image(0, 0, `unit:${unit.kind}`).setDisplaySize(134, 134),
          health = this.add.graphics();
        const container = this.add
          .container(left + (unit.col + 0.5) * cell, top + (unit.row + 0.53) * cell, [
            image,
            health,
          ])
          .setDepth(10 + unit.row);
        actor = { container, image, health };
        this.units.set(unit.id, actor);
      }
      actor.health!.clear();
      if (unit.kind === 'derivative' && unit.hp < TOWER_HP) {
        actor.health!.fillStyle(0xdddcca);
        actor.health!.fillRoundedRect(-24, 42, 48, 4, 2);
        actor.health!.fillStyle(unit.hp > 50 ? 0x769964 : 0xc68571);
        actor.health!.fillRoundedRect(-24, 42, (48 * unit.hp) / TOWER_HP, 4, 2);
      }
    }
    for (const [id, actor] of this.units)
      if (!this.model.units.some((u) => u.id === id)) {
        actor.container.destroy();
        this.units.delete(id);
      }
    for (const enemy of this.model.enemies) {
      let actor = this.enemies.get(enemy.id);
      const formula = format(enemy.expression),
        kind = kindOf(enemy.expression);
      if (!actor) {
        const image = this.add.image(0, 4, `enemy:${kind}`).setDisplaySize(123, 123);
        const label = this.add
          .text(0, -15, '', {
            fontFamily: 'Georgia, Cambria Math, serif',
            fontSize: '21px',
            fontStyle: 'italic',
            color: '#303d35',
            padding: { x: 3, y: 2 },
          })
          .setOrigin(0.5);
        const container = this.add.container(0, 0, [image, label]).setDepth(20 + enemy.row);
        actor = { container, image, label };
        this.enemies.set(enemy.id, actor);
      }
      actor.image.setTexture(`enemy:${kind}`);
      actor.container.setPosition(left + enemy.x * cell, top + (enemy.row + 0.52) * cell);
      actor.container.setVisible(enemy.x < 9.7);
      actor.image.setRotation(
        this.reducedMotion ? 0 : Math.sin(this.model.time * 3.2 + enemy.id) * 0.025,
      );
      actor.image.setAlpha(enemy.hitFlash > 0 ? 0.65 : 1);
      if (actor.formula !== formula) {
        actor.formula = formula;
        const compact = formula.replaceAll(' ', '');
        actor.label!.setText(compact.length > 15 ? compact.slice(0, 13) + '…' : compact);
        actor.label!.setFontSize(compact.length > 9 ? 13 : compact.length > 5 ? 16 : 22);
        actor.label!.setY(kind === 'sine' || kind === 'arcsine' ? -7 : -16);
        actor.label!.setBackgroundColor(compact.length > 8 ? '#fbf8ed' : 'rgba(0,0,0,0)');
      }
    }
    for (const [id, actor] of this.enemies)
      if (!this.model.enemies.some((e) => e.id === id)) {
        actor.container.destroy();
        this.enemies.delete(id);
      }
    for (const bullet of this.model.bullets) {
      let image = this.bullets.get(bullet.id);
      if (!image) {
        const circle = this.add.circle(0, 0, 12, 0xfbf9ee).setStrokeStyle(1.5, 0x739a63);
        const letter = this.add
          .text(0, 0, 'D', {
            fontFamily: 'Georgia',
            fontStyle: 'italic',
            fontSize: '16px',
            color: '#567747',
          })
          .setOrigin(0.5);
        image = this.add.container(0, 0, [circle, letter]).setDepth(40);
        this.bullets.set(bullet.id, image);
      }
      image.setPosition(left + bullet.x * cell, top + (bullet.row + 0.37) * cell);
    }
    for (const [id, image] of this.bullets)
      if (!this.model.bullets.some((b) => b.id === id)) {
        image.destroy();
        this.bullets.delete(id);
      }
  }
  private effect(event: BattleEvent): void {
    const x = BOARD.left + event.x * BOARD.cell,
      y = BOARD.top + (event.row + 0.45) * BOARD.cell;
    this.gardenSound.play(event.type);
    if (event.type === 'explosion' && event.bomb) {
      const area = blastArea(event.bomb, event.row, Math.floor(event.x));
      const flash = this.add
        .rectangle(
          BOARD.left + ((area.left + area.right) * BOARD.cell) / 2,
          BOARD.top + ((area.firstRow + area.lastRow + 1) * BOARD.cell) / 2,
          (area.right - area.left) * BOARD.cell,
          (area.lastRow - area.firstRow + 1) * BOARD.cell,
          0xe6b071,
          this.reducedMotion ? 0.2 : 0.6,
        )
        .setStrokeStyle(2, 0xc77d57)
        .setDepth(45);
      this.tweens.add({
        targets: flash,
        alpha: 0,
        duration: this.reducedMotion ? 150 : 500,
        onComplete: () => flash.destroy(),
      });
      return;
    }
    if (event.type === 'invalid') {
      this.callbacks.notice(event.text ?? '运算无效');
      return;
    }
    if (event.type === 'wave') {
      this.callbacks.notice(event.text ?? '新一波敌人出现');
      return;
    }
    if (event.type === 'place' || event.type === 'kill' || event.type === 'transform') {
      if (!this.reducedMotion)
        for (let i = 0; i < 7; i++) {
          const angle = (i * Math.PI * 2) / 7,
            spark = this.add
              .circle(x, y, 2 + (i % 2), event.type === 'kill' ? 0xc5aa61 : 0x93ab77, 0.8)
              .setDepth(50);
          this.tweens.add({
            targets: spark,
            x: x + Math.cos(angle) * 32,
            y: y + Math.sin(angle) * 30,
            alpha: 0,
            duration: 500,
            onComplete: () => spark.destroy(),
          });
        }
    }
    if (
      event.type === 'kill' ||
      event.type === 'transform' ||
      event.type === 'leak' ||
      event.type === 'destroy'
    ) {
      const content = event.type === 'kill' ? `${event.text}  ✓` : (event.text ?? ''),
        label = this.add
          .text(x, y - 35, content, {
            fontFamily: 'Georgia, Microsoft YaHei',
            fontSize: event.type === 'kill' ? '24px' : '14px',
            color: event.type === 'leak' ? '#b66f65' : '#55764b',
            backgroundColor: '#faf8ecee',
            padding: { x: 6, y: 3 },
          })
          .setOrigin(0.5)
          .setDepth(60);
      this.tweens.add({
        targets: label,
        y: y - 62,
        alpha: 0,
        delay: 350,
        duration: this.reducedMotion ? 100 : 700,
        onComplete: () => label.destroy(),
      });
    }
    if (event.type === 'hit' && event.unchanged && this.model.time % 3 < 0.12)
      this.callbacks.preview('导数没有变化，试试先用变换门。');
  }
  inspectAt(row: number, col: number): void {
    const enemy = this.model.enemies
      .filter((e) => e.row === row)
      .sort((a, b) => Math.abs(a.x - col) - Math.abs(b.x - col))[0];
    if (enemy) this.callbacks.inspect(enemy);
  }
  resultFor(enemy: Enemy): string {
    const action = this.selection && this.selection !== 'shovel' ? this.selection : 'derivative';
    if (isBomb(action)) return '经过炸弹所在格的中点时引爆，不受公式复杂度影响';
    const result = operate(enemy.expression, action);
    return result.ok ? `${format(enemy.expression)} → ${format(result.expression)}` : result.reason;
  }
}
export function createGarden(
  parent: HTMLElement,
  model: Battle,
  callbacks: Callbacks,
  sound: Sound,
): { game: Phaser.Game; scene: GardenScene } {
  const scene = new GardenScene(model, callbacks, sound);
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    width: BOARD.width,
    height: BOARD.height,
    backgroundColor: '#f9f7ee',
    transparent: false,
    antialias: true,
    roundPixels: false,
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    fps: { target: 60, forceSetTimeOut: false },
    scene: [scene],
    audio: { noAudio: true },
    banner: false,
  });
  return { game, scene };
}
