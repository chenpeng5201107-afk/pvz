import test from 'node:test';
import assert from 'node:assert/strict';
import { LEVELS, Random, generateEnemy, unitById } from '../src/core/content.ts';
import { format, operate } from '../src/core/math.ts';

test('ten levels introduce solvable functions and progressively higher powers', () => {
  assert.deepEqual(
    LEVELS.map((level) => level.id),
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  );
  let previousDegree = 0;
  for (const level of LEVELS) {
    assert.ok(level.powerDegree[0] <= level.powerDegree[1]);
    assert.ok(level.powerDegree[1] >= previousDegree);
    previousDegree = level.powerDegree[1];
    for (const kind of level.pool)
      for (let seed = 1; seed <= 80; seed++) {
        const generated = generateEnemy(kind, new Random(seed), level.powerDegree);
        let expression = generated.expression;
        for (const operation of generated.solution) {
          assert.ok(unitById(operation).level <= level.id, `level ${level.id}: ${operation}`);
          const result = operate(expression, operation);
          assert.ok(result.ok, `level ${level.id}, ${kind}: ${format(expression)}`);
          if (result.ok) expression = result.expression;
        }
        assert.equal(expression.type, 'number');
        if (kind === 'power') {
          assert.ok(generated.solution.length >= level.powerDegree[0]);
          assert.ok(generated.solution.length <= level.powerDegree[1]);
        }
      }
  }
  assert.ok(previousDegree >= 16);
});
