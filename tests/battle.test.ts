import test from 'node:test';
import assert from 'node:assert/strict';
import { Battle, TOWER_HP } from '../src/core/battle.ts';
import type { Enemy } from '../src/core/battle.ts';
import { Random, generateEnemy, ENEMIES } from '../src/core/content.ts';
import { X, n, mul, fn, operate, format } from '../src/core/math.ts';

const enemy = (id: number, x: number, expression = fn('exp', X)): Enemy => ({
  id,
  kind: 'exponential',
  row: 0,
  x,
  expression,
  speed: 0.31,
  biteCooldown: 0,
  alive: true,
  hitFlash: 0,
});
test('every generated enemy has a legal solution across seeds and waves', () => {
  for (let seed = 1; seed <= 80; seed++)
    for (const kind of ENEMIES) {
      const generated = generateEnemy(kind.kind, new Random(seed), [2, (seed % 4) + 2]);
      let expression = generated.expression;
      for (const operation of generated.solution) {
        const result = operate(expression, operation);
        assert.ok(result.ok, `${kind.kind}: ${format(expression)}`);
        if (result.ok) expression = result.expression;
      }
      assert.equal(expression.type, 'number', kind.kind);
    }
});
test('pause freezes resources, attacks, card cooldown and motion but allows placement', () => {
  const battle = new Battle(3, 9);
  battle.start();
  battle.place('derivative', 0, 1);
  battle.pause();
  const time = battle.time,
    energy = battle.energy,
    cooldown = battle.cooldowns.derivative;
  battle.step(1);
  assert.equal(battle.time, time);
  assert.equal(battle.energy, energy);
  assert.equal(battle.cooldowns.derivative, cooldown);
  assert.equal(battle.place('ln', 0, 3), null);
});
test('a gate triggers for only the first crossing, before an in-flight derivative', () => {
  const battle = new Battle(3, 1);
  battle.place('ln', 0, 3);
  battle.start();
  battle.enemies = [enemy(101, 3.5001), enemy(102, 4.7)];
  battle.bullets = [{ id: 999, row: 0, x: 3.45, targetId: 101 }];
  battle.step(1 / 60);
  assert.equal(battle.units.length, 0);
  assert.equal(battle.kills, 1);
  assert.equal(battle.enemies.length, 1);
  assert.equal(battle.enemies[0]!.id, 102);
});
test('invalid gate is consumed and does not delete the enemy', () => {
  const battle = new Battle(3, 1);
  battle.place('ln', 0, 3);
  battle.start();
  battle.enemies = [enemy(101, 3.5001, mul(n(-2), X))];
  battle.step(1 / 60);
  assert.equal(battle.units.length, 0);
  assert.equal(battle.kills, 0);
  assert.equal(battle.enemies.length, 1);
});
test('tower fires only into the next two cells of its own row', () => {
  const battle = new Battle(3, 1);
  battle.place('derivative', 0, 1);
  battle.start();
  battle.enemies = [enemy(101, 4.1)];
  battle.step(0.05);
  assert.equal(battle.bullets.length, 0);
  battle.enemies[0]!.x = 3.9;
  battle.step(0.01);
  assert.equal(battle.bullets.length, 1);
});
test('enemies bite at the tower front and the tower continues fighting', () => {
  const battle = new Battle(3, 1);
  battle.place('derivative', 0, 1);
  battle.start();
  battle.enemies = [enemy(101, 2.041)];
  battle.step(0.2);
  assert.ok(battle.units[0]!.hp < TOWER_HP);
  assert.ok(battle.enemies[0]!.x >= 2.03);
  assert.ok(battle.units[0]!.shotCooldown > 0);
});
test('duplicate bullets cannot award a kill twice', () => {
  const battle = new Battle(1, 1);
  battle.start();
  battle.enemies = [enemy(101, 3, X)];
  battle.bullets = [
    { id: 1, row: 0, x: 2.95, targetId: 101 },
    { id: 2, row: 0, x: 2.95, targetId: 101 },
  ];
  battle.step(0.02);
  assert.equal(battle.kills, 1);
});
test('occupied cells, unlocks, prices and terminal phases are enforced', () => {
  const battle = new Battle(1, 1);
  assert.notEqual(battle.place('ln', 0, 2), null);
  assert.equal(battle.place('derivative', 0, 1), null);
  assert.notEqual(battle.place('derivative', 0, 1), null);
  battle.enemies = [enemy(101, 4.5)];
  assert.equal(battle.place('derivative', 0, 4), null);
  battle.energy = 0;
  assert.notEqual(battle.place('derivative', 1, 1), null);
  battle.phase = 'lost';
  assert.equal(battle.remove(0, 1), false);
});
test('identical seeds reproduce coefficient and wave choices', () => {
  const a = new Battle(3, 482),
    b = new Battle(3, 482);
  a.start();
  b.start();
  for (let i = 0; i < 100; i++) {
    a.step(0.1);
    b.step(0.1);
  }
  assert.deepEqual(a.enemies, b.enemies);
});
test('the tutorial can be won and returns a stable final state', () => {
  const battle = new Battle(1, 11);
  for (let row = 0; row < 5; row++) assert.equal(battle.place('derivative', row, 3), null);
  battle.start();
  for (let i = 0; i < 5000 && battle.phase === 'running'; i++) battle.step(0.1);
  assert.equal(battle.phase, 'won');
  assert.equal(battle.wave, 3);
  assert.ok(battle.stars >= 1);
  const time = battle.time;
  battle.step(1);
  assert.equal(battle.time, time);
});
