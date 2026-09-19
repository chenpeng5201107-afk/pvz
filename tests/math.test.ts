import test from 'node:test';
import assert from 'node:assert/strict';
import {
  X,
  n,
  add,
  mul,
  pow,
  fn,
  derivative,
  operate,
  evaluate,
  format,
  interval,
} from '../src/core/math.ts';
import type { Expr, Operation } from '../src/core/math.ts';

function route(expr: Expr, actions: Operation[]): Expr {
  for (const action of actions) {
    const result = operate(expr, action);
    assert.equal(result.ok, true, `${format(expr)} / ${action}`);
    if (result.ok) expr = result.expression;
  }
  return expr;
}
test('polynomials become constants, independently of coefficient size', () => {
  for (const coefficient of [-9, -2, 1, 3, 99]) {
    assert.deepEqual(
      route(add(mul(n(coefficient), pow(X, 3)), mul(n(4), X), n(-7)), [
        'derivative',
        'derivative',
        'derivative',
      ]),
      n(coefficient * 6),
    );
  }
});
test('exp and ln have different, valid routes', () => {
  assert.deepEqual(route(fn('exp', add(mul(n(2), X), n(3))), ['ln', 'derivative']), n(2));
  assert.deepEqual(route(fn('ln', X), ['derivative', 'reciprocal', 'derivative']), n(1));
  assert.deepEqual(route(fn('ln', add(mul(n(3), X), n(2))), ['exp', 'derivative']), n(3));
  assert.deepEqual(route(mul(n(5), fn('exp', mul(n(2), X))), ['ln', 'derivative']), n(2));
});
test('nested functions require the correct order', () => {
  assert.deepEqual(route(fn('exp', pow(X, 2)), ['ln', 'derivative', 'derivative']), n(2));
  assert.deepEqual(route(fn('exp', fn('sin', X)), ['ln', 'asin', 'derivative']), n(1));
  assert.notEqual(derivative(fn('exp', pow(X, 2))).type, 'number');
});
test('trigonometric inversion respects principal branches and amplitude', () => {
  assert.deepEqual(route(fn('sin', X), ['asin']), X);
  assert.deepEqual(route(fn('asin', X), ['sin']), X);
  assert.notDeepEqual(route(fn('sin', mul(n(3), X)), ['asin']), mul(n(3), X));
  assert.equal(operate(mul(n(3), fn('sin', X)), 'asin').ok, false);
});
test('root, square and reciprocal remain domain-aware', () => {
  assert.deepEqual(route(pow(add(mul(n(2), X), n(1)), 0.5), ['square', 'derivative']), n(2));
  assert.deepEqual(route(pow(pow(X, 2), 0.5), ['derivative']), n(1));
  assert.deepEqual(route(pow(add(X, n(1)), -1), ['reciprocal', 'derivative']), n(1));
  assert.notDeepEqual(pow(pow(add(X, n(-2)), 2), 0.5), add(X, n(-2)));
});
test('undefined operations cannot become wins', () => {
  assert.equal(operate(n(0), 'reciprocal').ok, false);
  assert.equal(operate(mul(n(-1), X), 'ln').ok, false);
  assert.equal(operate(add(X, n(-0.5)), 'reciprocal').ok, false);
  assert.equal(interval({ type: 'pow', base: mul(n(-1), X), exponent: 0.5 }), null);
  assert.equal(interval(fn('tan', mul(n(2), X))), null);
});
test('exact trig identity is recognized; a sine is never assumed constant', () => {
  assert.deepEqual(add(pow(fn('sin', X), 2), pow(fn('cos', X), 2)), n(1));
  const result = operate(fn('sin', X), 'derivative');
  assert.ok(result.ok && !result.constant);
  const exp = operate(fn('exp', X), 'derivative');
  assert.ok(exp.ok && exp.unchanged);
});
test('symbolic derivatives match numerical derivatives for supported nested expressions', () => {
  const cases = [
    fn('exp', pow(X, 2)),
    fn('ln', add(pow(X, 2), n(2))),
    fn('asin', mul(n(0.7), X)),
    fn('cos', X),
    fn('atan', X),
    fn('acos', X),
    fn('tan', X),
    pow(add(X, n(1)), -0.5),
    mul(X, fn('sin', X)),
  ];
  for (const expr of cases)
    for (const x of [0.15, 0.35, 0.7]) {
      const h = 1e-6,
        numerical = (evaluate(expr, x + h) - evaluate(expr, x - h)) / (2 * h);
      assert.ok(Math.abs(numerical - evaluate(derivative(expr), x)) < 1e-5, format(expr));
    }
});

test('fraction products display coefficients, signs and denominators without ambiguity', () => {
  const linear = add(mul(n(2), X), n(1));
  assert.equal(format(derivative(fn('ln', linear))), '2/(2x + 1)');
  assert.equal(format(mul(n(-1), pow(linear, -1))), '−1/(2x + 1)');
  assert.equal(format(mul(n(-2), X, pow(linear, -1))), '−2x/(2x + 1)');
  assert.equal(format(mul(n(2), pow(X, -1), fn('sin', X))), '2sin(x)/x');
  assert.equal(format(mul(pow(X, -1), pow(linear, -1))), '1/(x·(2x + 1))');
  assert.equal(format(mul(add(X, n(1)), pow(linear, -1))), '(x + 1)/(2x + 1)');
});

test('multiplication keeps natural coefficients and separates adjacent numbers and factors', () => {
  assert.equal(format(mul(n(3), X)), '3x');
  assert.equal(format(mul(n(-1), X)), '−x');
  assert.equal(format(mul(n(3), X, fn('sin', X))), '3x·sin(x)');
  assert.equal(format({ type: 'mul', terms: [n(2), n(3)] }), '2·3');
  assert.equal(
    format({ type: 'mul', terms: [n(2), { type: 'pow', base: n(3), exponent: 2 }] }),
    '2·3²',
  );
  assert.equal(format({ type: 'pow', base: n(-2), exponent: 2 }), '(−2)²');
});
