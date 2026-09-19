import test from 'node:test';
import assert from 'node:assert/strict';
import { Battle, TOWER_HP } from '../src/core/battle.ts';
import type { Enemy } from '../src/core/battle.ts';
import { unitById } from '../src/core/content.ts';
import type { BombId } from '../src/core/content.ts';
import { X, fn, pow } from '../src/core/math.ts';

const enemy = (
  id: number,
  row: number,
  x: number,
  expression = fn('exp', fn('exp', X)),
): Enemy => ({
  id,
  row,
  x,
  expression,
  kind: 'nested',
  speed: 0.31,
  biteCooldown: 0,
  alive: true,
  hitFlash: 0,
});

test('a gate can be planted in an occupied cell and triggers at its midpoint', () => {
  const battle = new Battle(3, 1);
  battle.start();
  battle.enemies = [enemy(101, 0, 3.8, fn('exp', X))];
  battle.pause();
  assert.equal(battle.place('ln', 0, 3), null);
  battle.step(1);
  assert.deepEqual(battle.enemies[0]!.expression, fn('exp', X));
  battle.resume();
  battle.step(0.5);
  assert.equal(battle.units.length, 1);
  battle.step(0.5);
  assert.deepEqual(battle.enemies[0]!.expression, X);
  assert.equal(battle.units.length, 0);
});

test('a gate skips enemies past the midpoint and consumes only the first eligible crossing', () => {
  const battle = new Battle(3, 1);
  battle.enemies = [enemy(101, 0, 3.49, fn('exp', X)), enemy(102, 0, 4.6, fn('exp', X))];
  assert.equal(battle.place('ln', 0, 3), null);
  battle.start();
  for (let i = 0; i < 4; i++) battle.step(1);
  assert.deepEqual(battle.enemies.find((e) => e.id === 101)!.expression, fn('exp', X));
  assert.deepEqual(battle.enemies.find((e) => e.id === 102)!.expression, X);
  assert.equal(battle.units.length, 0);
});

test('a crossing exactly at the midpoint is transformed before a derivative hits', () => {
  const battle = new Battle(3, 1);
  battle.enemies = [enemy(101, 0, 3.5, fn('exp', X))];
  assert.equal(battle.place('ln', 0, 3), null);
  battle.bullets = [{ id: 999, row: 0, x: 3.4, targetId: 101 }];
  battle.start();
  battle.step(1 / 60);
  assert.equal(battle.kills, 1);
  assert.equal(battle.units.length, 0);
});

test('a replacement tower blocks enemies in the right half without pushing them backwards', () => {
  for (const x of [3.8, 3.5, 3.49]) {
    const battle = new Battle(3, 1);
    battle.enemies = [enemy(101, 0, x)];
    assert.equal(battle.place('derivative', 0, 3), null);
    battle.start();
    battle.step(0.2);
    assert.ok(battle.enemies[0]!.x <= x);
    if (x >= 3.5) {
      assert.equal(battle.enemies[0]!.x, x);
      assert.ok(battle.units[0]!.hp < TOWER_HP);
      assert.ok(battle.units[0]!.shotCooldown > 0);
    } else {
      assert.ok(battle.enemies[0]!.x < x);
      assert.equal(battle.units[0]!.hp, TOWER_HP);
      assert.equal(battle.units[0]!.shotCooldown, 0);
    }
  }
});

test('rear towers inherit the furthest linked range through multiple towers', () => {
  const battle = new Battle(10, 1);
  for (const col of [0, 2, 4]) assert.equal(battle.place('derivative', 0, col), null);
  assert.equal(battle.towerReach(0, 0), 7);
  assert.equal(battle.towerReach(0, 2), 7);
  battle.enemies = [enemy(101, 0, 6.8, pow(X, 20))];
  battle.start();
  battle.step(0.01);
  assert.equal(battle.bullets.length, 3);
  battle.step(1);
  assert.equal(battle.enemies[0]!.expression.type, 'mul');
});

test('range links ignore gates, other rows and gaps wider than two columns', () => {
  const battle = new Battle(10, 1);
  battle.place('derivative', 0, 0);
  battle.place('ln', 0, 2);
  battle.place('derivative', 1, 2);
  battle.place('derivative', 0, 3);
  assert.equal(battle.towerReach(0, 0), 3);
  battle.enemies = [enemy(101, 0, 5.8)];
  battle.start();
  battle.step(0.01);
  assert.equal(battle.bullets.length, 1);
});

test('removing or losing the middle tower immediately breaks a range link', () => {
  for (const destroyed of [false, true]) {
    const battle = new Battle(10, 1);
    for (const col of [0, 2, 4]) battle.place('derivative', 0, col);
    assert.equal(battle.towerReach(0, 0), 7);
    if (destroyed) {
      battle.units.find((u) => u.col === 2)!.hp = 1;
      battle.enemies = [enemy(101, 0, 3.041)];
      battle.start();
      battle.step(0.02);
    } else assert.equal(battle.remove(0, 2), true);
    assert.equal(battle.towerReach(0, 0), 3);
  }
});

test('bomb tiers clear only their footprints, ignore formulas and preserve friendly towers', () => {
  for (const kind of ['bomb', 'areaBomb', 'rowBomb'] as BombId[]) {
    const battle = new Battle(10, 1);
    battle.place('derivative', 3, 4);
    battle.enemies = [
      enemy(101, 2, 4.5),
      enemy(102, 2, 5.6),
      enemy(103, 1, 3.2),
      enemy(104, 3, 5.99),
      enemy(105, 0, 4.5),
      enemy(106, 2, 6.8),
      enemy(107, 2, 9.6),
      enemy(108, 1, 6.2),
    ];
    battle.start();
    const energy = battle.energy;
    assert.equal(battle.place(kind, 2, 4), null);
    assert.equal(battle.energy, energy - unitById(kind).cost);
    assert.equal(battle.cooldowns[kind], unitById(kind).cooldown);
    battle.step(0.001);
    const killed =
      kind === 'bomb' ? [101] : kind === 'areaBomb' ? [101, 102, 103, 104] : [101, 102, 106, 107];
    assert.deepEqual(
      battle.enemies.map((e) => e.id),
      [101, 102, 103, 104, 105, 106, 107, 108].filter((id) => !killed.includes(id)),
    );
    assert.equal(battle.kills, killed.length);
    assert.equal(battle.units.length, 1);
    assert.equal(battle.units[0]!.kind, 'derivative');
    assert.ok(battle.drainEvents().some((event) => event.type === 'explosion'));
  }
});

test('bombs respect unlocks, energy, cooldown, pause and terminal phases', () => {
  const locked = new Battle(1, 1);
  assert.notEqual(locked.place('bomb', 0, 0), null);
  const battle = new Battle(10, 1);
  assert.notEqual(battle.place('bomb', 0, 0), null);
  battle.start();
  battle.enemies = [enemy(101, 0, 3.5)];
  battle.pause();
  assert.equal(battle.place('bomb', 0, 3), null);
  assert.notEqual(battle.place('bomb', 0, 3), null);
  battle.step(1);
  assert.equal(battle.enemies.length, 1);
  assert.equal(battle.cooldowns.bomb, 30);
  assert.equal(battle.remove(0, 3), false);
  battle.resume();
  battle.step(0.01);
  assert.equal(battle.kills, 1);
  battle.energy = 199;
  assert.notEqual(battle.place('areaBomb', 0, 0), null);
  battle.phase = 'lost';
  assert.notEqual(battle.place('rowBomb', 0, 0), null);
});

test('an explosion consumes only its triggered bomb and cannot trigger another using a dead enemy', () => {
  const battle = new Battle(10, 1);
  battle.start();
  battle.enemies = [enemy(101, 0, 3.5, X), enemy(102, 1, 3.5, X)];
  battle.bullets = [{ id: 999, row: 0, x: 3.4, targetId: 101 }];
  assert.equal(battle.place('areaBomb', 0, 3), null);
  assert.equal(battle.place('bomb', 1, 3), null);
  const energy = battle.energy;
  battle.step(0.01);
  assert.equal(battle.kills, 2);
  assert.ok(Math.abs(battle.energy - energy - 36 - battle.level.income * 0.01) < 1e-6);
  assert.equal(battle.bullets.length, 0);
  assert.equal(battle.units.length, 1);
  assert.equal(battle.units[0]!.kind, 'bomb');
  assert.equal(battle.drainEvents().filter((event) => event.type === 'explosion').length, 1);
});

test('all bomb tiers stay planted without a crossing even when enemies are in their blast range', () => {
  for (const kind of ['bomb', 'areaBomb', 'rowBomb'] as BombId[]) {
    const battle = new Battle(10, 1);
    battle.start();
    assert.equal(battle.place(kind, 2, 3), null);
    battle.step(0.5);
    assert.equal(battle.units.length, 1);
    battle.enemies = [enemy(101, 1, 3.5), enemy(102, 2, 5.2)];
    battle.step(0.5);
    assert.equal(battle.units.length, 1);
    assert.equal(battle.kills, 0);
    assert.ok(!battle.drainEvents().some((event) => event.type === 'explosion'));
  }
});

test('all bomb tiers wait for an enemy to reach the planted cell midpoint', () => {
  for (const kind of ['bomb', 'areaBomb', 'rowBomb'] as BombId[]) {
    const battle = new Battle(10, 1);
    battle.start();
    battle.enemies = [enemy(101, 2, 3.8)];
    assert.equal(battle.place(kind, 2, 3), null);
    battle.step(0.5);
    assert.equal(battle.kills, 0);
    assert.equal(battle.units.length, 1);
    battle.step(0.5);
    assert.equal(battle.kills, 1);
    assert.equal(battle.units.length, 0);
    assert.equal(battle.drainEvents().filter((event) => event.type === 'explosion').length, 1);
  }
});

test('bombs skip enemies past the midpoint and remain armed for the next crossing', () => {
  for (const kind of ['bomb', 'areaBomb', 'rowBomb'] as BombId[]) {
    const battle = new Battle(10, 1);
    battle.start();
    battle.enemies = [enemy(101, 2, 3.49), enemy(102, 2, 4.6)];
    assert.equal(battle.place(kind, 2, 3), null);
    battle.step(1);
    assert.equal(battle.kills, 0);
    assert.equal(battle.units.length, 1);
    for (let i = 0; i < 3; i++) battle.step(1);
    assert.ok(!battle.enemies.some((e) => e.id === 102));
    assert.equal(battle.units.length, 0);
    assert.equal(battle.drainEvents().filter((event) => event.type === 'explosion').length, 1);
  }
});

test('bombs, towers and gates cannot share a cell and rejected placements cost nothing', () => {
  for (const kind of ['bomb', 'areaBomb', 'rowBomb'] as BombId[]) {
    for (const existing of ['derivative', 'ln', 'bomb'] as const) {
      const battle = new Battle(10, 1);
      battle.start();
      assert.equal(battle.place(existing, 2, 3), null);
      const energy = battle.energy;
      const cooldowns = { ...battle.cooldowns };
      assert.equal(battle.canPlace(kind, 2, 3), '这个格子已经有单位');
      assert.equal(battle.place(kind, 2, 3), '这个格子已经有单位');
      assert.equal(battle.energy, energy);
      assert.deepEqual(battle.cooldowns, cooldowns);
      assert.equal(battle.units.length, 1);
    }
    const battle = new Battle(10, 1);
    battle.start();
    assert.equal(battle.place(kind, 2, 3), null);
    for (const plant of ['derivative', 'ln'] as const)
      assert.equal(battle.place(plant, 2, 3), '这个格子已经有单位');
  }
});

test('enemies killed by a row bomb cannot bite towers later in the same tick', () => {
  const battle = new Battle(10, 1);
  battle.place('derivative', 0, 5);
  battle.start();
  battle.enemies = [enemy(101, 0, 3.5), enemy(102, 0, 6.041)];
  assert.equal(battle.place('rowBomb', 0, 3), null);
  battle.step(0.01);
  assert.equal(battle.kills, 2);
  assert.equal(battle.units[0]!.hp, TOWER_HP);
  assert.ok(!battle.drainEvents().some((event) => event.type === 'bite'));
});

test('twentieth-degree enemies overwhelm a single tower but linked firepower holds the line', () => {
  for (const columns of [[3], [3, 1, 0]]) {
    const battle = new Battle(10, 1);
    for (const col of columns) battle.place('derivative', 0, col);
    battle.start();
    battle.enemies = [enemy(101, 0, 5.99, pow(X, 20))];
    for (let i = 0; i < 1800 && battle.enemies.some((e) => e.id === 101); i++) {
      battle.step(1 / 60);
      battle.drainEvents();
    }
    if (columns.length === 1) {
      assert.equal(battle.units.length, 0);
      assert.equal(battle.lives, 2);
    } else {
      assert.ok(battle.units.some((u) => u.col === 3));
      assert.ok(!battle.enemies.some((e) => e.id === 101));
    }
  }
});
