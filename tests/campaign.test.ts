import test from 'node:test';
import assert from 'node:assert/strict';
import { Battle } from '../src/core/battle.ts';
import { LEVELS, unitById } from '../src/core/content.ts';
import type { Operation } from '../src/core/math.ts';

test('all ten levels can be won with normal energy, cooldowns and progressively stronger defenses', () => {
  for (const level of LEVELS)
    for (const seed of [1, 7, 17, 53, 101, 263, 482, 829]) {
      const battle = new Battle(level.id, seed);
      const rows = [0, 2, 4, 1, 3];
      const columns = level.id >= 9 ? [3, 1, 0] : level.id >= 5 ? [3, 1] : [3];
      for (const col of columns)
        for (const row of rows)
          if (battle.energy >= 100) assert.equal(battle.place('derivative', row, col), null);
      battle.start();
      for (let step = 0; step < 16000 && battle.phase === 'running'; step++) {
        for (const row of rows)
          for (const col of [8, 6]) {
            const next = battle.enemies
              .filter((e) => e.row === row && e.x >= col + 0.5 && e.x < col + 1.35)
              .sort((a, b) => a.x - b.x)[0];
            if (!next) continue;
            let operation: Operation | null = null;
            if (col === 8) {
              if (
                next.expression.type === 'fn' &&
                next.expression.name === 'exp' &&
                next.expression.arg.type === 'fn'
              )
                operation = 'ln';
            } else if (next.expression.type === 'fn') {
              operation =
                next.expression.name === 'exp'
                  ? 'ln'
                  : next.expression.name === 'ln'
                    ? 'exp'
                    : next.expression.name === 'sin'
                      ? 'asin'
                      : next.expression.name === 'asin'
                        ? 'sin'
                        : null;
            } else if (next.expression.type === 'pow') {
              operation =
                next.expression.exponent === 0.5
                  ? 'square'
                  : next.expression.exponent === -1
                    ? 'reciprocal'
                    : null;
            } else if (next.kind === 'exponential' && next.expression.type === 'mul')
              operation = 'ln';
            if (operation) {
              assert.ok(unitById(operation).level <= level.id);
              battle.place(operation, row, col);
            }
          }
        for (const col of columns)
          for (const row of rows)
            if (battle.energy >= 250 && !battle.units.some((u) => u.row === row && u.col === col))
              battle.place('derivative', row, col);
        battle.step(0.05);
        battle.drainEvents();
      }
      assert.equal(
        battle.phase,
        'won',
        `level ${level.id}, seed ${seed}, kills ${battle.kills}, time ${battle.time}`,
      );
      assert.equal(battle.lives, 3, `level ${level.id}, seed ${seed}`);
    }
});
