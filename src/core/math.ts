/** Expressions are trees, never executable strings. Every level uses 0 < x < 1. */
export type FunctionName = 'ln' | 'exp' | 'sin' | 'cos' | 'tan' | 'asin' | 'acos' | 'atan';
export type Expr =
  | { type: 'number'; value: number }
  | { type: 'x' }
  | { type: 'add'; terms: Expr[] }
  | { type: 'mul'; terms: Expr[] }
  | { type: 'pow'; base: Expr; exponent: number }
  | { type: 'fn'; name: FunctionName; arg: Expr };
export type Operation = 'derivative' | 'ln' | 'exp' | 'asin' | 'sin' | 'square' | 'reciprocal';
export type Interval = { lo: number; hi: number; openLo: boolean; openHi: boolean };
export const X: Expr = { type: 'x' };
export const n = (value: number): Expr => ({
  type: 'number',
  value: Object.is(value, -0) ? 0 : value,
});
export const add = (...terms: Expr[]): Expr => simplify({ type: 'add', terms });
export const mul = (...terms: Expr[]): Expr => simplify({ type: 'mul', terms });
export const pow = (base: Expr, exponent: number): Expr =>
  simplify({ type: 'pow', base, exponent });
export const fn = (name: FunctionName, arg: Expr): Expr => simplify({ type: 'fn', name, arg });
const key = (expr: Expr): string => JSON.stringify(expr);
const range = (lo: number, hi: number, openLo = false, openHi = false): Interval => ({
  lo,
  hi,
  openLo,
  openHi,
});
const positive = (r: Interval): boolean => r.lo > 0 || (r.lo === 0 && r.openLo);
const nonzero = (r: Interval): boolean => positive(r) || r.hi < 0 || (r.hi === 0 && r.openHi);
const safeProduct = (a: number, b: number): number => (a === 0 || b === 0 ? 0 : a * b);

function inverse(r: Interval): Interval | null {
  if (!nonzero(r)) return null;
  if (r.lo >= 0) return range(1 / r.hi, r.lo === 0 ? Infinity : 1 / r.lo, r.openHi, r.openLo);
  return range(r.hi === 0 ? -Infinity : 1 / r.hi, 1 / r.lo, r.openHi, r.openLo);
}

/** Conservative interval arithmetic prevents illegal logs, roots and inverse branches. */
export function interval(expr: Expr): Interval | null {
  if (expr.type === 'number')
    return Number.isFinite(expr.value) ? range(expr.value, expr.value) : null;
  if (expr.type === 'x') return range(0, 1, true, true);
  if (expr.type === 'add' || expr.type === 'mul') {
    let acc = range(expr.type === 'add' ? 0 : 1, expr.type === 'add' ? 0 : 1);
    for (const term of expr.terms) {
      const next = interval(term);
      if (!next) return null;
      if (expr.type === 'add') {
        const lo = acc.lo + next.lo,
          hi = acc.hi + next.hi;
        acc = range(
          Number.isNaN(lo) ? -Infinity : lo,
          Number.isNaN(hi) ? Infinity : hi,
          acc.openLo || next.openLo,
          acc.openHi || next.openHi,
        );
      } else {
        const pairs = [
          [safeProduct(acc.lo, next.lo), acc.openLo || next.openLo],
          [safeProduct(acc.lo, next.hi), acc.openLo || next.openHi],
          [safeProduct(acc.hi, next.lo), acc.openHi || next.openLo],
          [safeProduct(acc.hi, next.hi), acc.openHi || next.openHi],
        ] as [number, boolean][];
        const lo = Math.min(...pairs.map((p) => p[0])),
          hi = Math.max(...pairs.map((p) => p[0]));
        acc = range(
          lo,
          hi,
          pairs.filter((p) => p[0] === lo).every((p) => p[1]),
          pairs.filter((p) => p[0] === hi).every((p) => p[1]),
        );
        if (acc.lo === 0 && acc.hi === 0) acc = range(0, 0);
      }
    }
    return acc;
  }
  if (expr.type === 'pow') {
    const r = interval(expr.base);
    if (!r || !Number.isFinite(expr.exponent)) return null;
    const e = Math.abs(expr.exponent);
    if (e === 0) return range(1, 1);
    if (!Number.isInteger(e) && r.lo < 0) return null;
    let out: Interval;
    if (Number.isInteger(e) && e % 2 === 0 && r.lo < 0) {
      const a = r.lo ** e,
        b = r.hi ** e;
      out =
        r.hi >= 0
          ? range(
              0,
              Math.max(a, b),
              false,
              a > b ? r.openLo : b > a ? r.openHi : r.openLo && r.openHi,
            )
          : range(b, a, r.openHi, r.openLo);
    } else out = range(r.lo ** e, r.hi ** e, r.openLo, r.openHi);
    return expr.exponent < 0 ? inverse(out) : out;
  }
  if (expr.type !== 'fn') return null;
  const r = interval(expr.arg);
  if (!r) return null;
  if (expr.name === 'ln')
    return positive(r) ? range(Math.log(r.lo), Math.log(r.hi), r.openLo, r.openHi) : null;
  if (expr.name === 'exp')
    return range(Math.exp(r.lo), Math.exp(r.hi), r.openLo || r.lo === -Infinity, r.openHi);
  if (expr.name === 'asin' || expr.name === 'acos') {
    if (r.lo < -1 || r.hi > 1) return null;
    return expr.name === 'asin'
      ? range(Math.asin(r.lo), Math.asin(r.hi), r.openLo, r.openHi)
      : range(Math.acos(r.hi), Math.acos(r.lo), r.openHi, r.openLo);
  }
  if (expr.name === 'atan') return range(Math.atan(r.lo), Math.atan(r.hi), r.openLo, r.openHi);
  if (expr.name === 'tan') {
    if (!Number.isFinite(r.lo) || !Number.isFinite(r.hi)) return null;
    const firstPole = Math.ceil((r.lo - Math.PI / 2) / Math.PI) * Math.PI + Math.PI / 2;
    if (firstPole >= r.lo && firstPole <= r.hi) return null;
    return range(Math.tan(r.lo), Math.tan(r.hi), r.openLo, r.openHi);
  }
  if (!Number.isFinite(r.lo) || !Number.isFinite(r.hi) || r.hi - r.lo >= Math.PI * 2)
    return range(-1, 1);
  const calc = expr.name === 'sin' ? Math.sin : Math.cos;
  const candidates: [number, boolean][] = [
    [calc(r.lo), r.openLo],
    [calc(r.hi), r.openHi],
  ];
  const offset = expr.name === 'sin' ? Math.PI / 2 : 0;
  for (let k = Math.ceil((r.lo - offset) / Math.PI); offset + k * Math.PI <= r.hi; k++) {
    const point = offset + k * Math.PI;
    if ((point === r.lo && r.openLo) || (point === r.hi && r.openHi)) continue;
    candidates.push([k % 2 === 0 ? 1 : -1, false]);
  }
  const lo = Math.min(...candidates.map((p) => p[0])),
    hi = Math.max(...candidates.map((p) => p[0]));
  return range(
    lo,
    hi,
    candidates.filter((p) => p[0] === lo).every((p) => p[1]),
    candidates.filter((p) => p[0] === hi).every((p) => p[1]),
  );
}

function coefficient(expr: Expr): [number, Expr | null] {
  if (expr.type === 'number') return [expr.value, null];
  if (expr.type === 'mul' && expr.terms[0]?.type === 'number') {
    return [
      expr.terms[0].value,
      expr.terms.length === 2 ? expr.terms[1]! : { type: 'mul', terms: expr.terms.slice(1) },
    ];
  }
  return [1, expr];
}

export function simplify(expr: Expr): Expr {
  if (expr.type === 'number' || expr.type === 'x') return expr;
  if (expr.type === 'add') {
    let constant = 0;
    const terms = new Map<string, { c: number; expr: Expr }>();
    for (const original of expr.terms) {
      const reduced = simplify(original);
      for (const term of reduced.type === 'add' ? reduced.terms : [reduced]) {
        const [c, body] = coefficient(term);
        if (!body) {
          constant += c;
          continue;
        }
        const k = key(body),
          old = terms.get(k);
        terms.set(k, { c: c + (old?.c ?? 0), expr: body });
      }
    }
    // This identity is exact; numerical sampling must never decide whether a function is constant.
    for (const [k, value] of terms) {
      const t = value.expr;
      if (t.type !== 'pow' || t.exponent !== 2 || t.base.type !== 'fn' || t.base.name !== 'sin')
        continue;
      const otherKey = key({
        type: 'pow',
        base: { type: 'fn', name: 'cos', arg: t.base.arg },
        exponent: 2,
      });
      const other = terms.get(otherKey);
      if (other && other.c === value.c) {
        constant += value.c;
        terms.delete(k);
        terms.delete(otherKey);
      }
    }
    const out = [...terms.values()]
      .filter((t) => t.c !== 0)
      .map((t) => (t.c === 1 ? t.expr : mul(n(t.c), t.expr)));
    if (constant !== 0 || !out.length) out.push(n(constant));
    return out.length === 1 ? out[0]! : { type: 'add', terms: out };
  }
  if (expr.type === 'mul') {
    let constant = 1;
    const factors = new Map<string, { base: Expr; exponent: number }>();
    for (const original of expr.terms) {
      const reduced = simplify(original);
      for (const term of reduced.type === 'mul' ? reduced.terms : [reduced]) {
        if (term.type === 'number') {
          constant *= term.value;
          continue;
        }
        const base = term.type === 'pow' ? term.base : term,
          exponent = term.type === 'pow' ? term.exponent : 1;
        const k = key(base),
          old = factors.get(k);
        factors.set(k, { base, exponent: exponent + (old?.exponent ?? 0) });
      }
    }
    if (constant === 0) return n(0);
    const out = [...factors.values()]
      .filter((t) => t.exponent !== 0)
      .map((t) => (t.exponent === 1 ? t.base : pow(t.base, t.exponent)));
    if (constant !== 1 || !out.length) out.unshift(n(constant));
    return out.length === 1 ? out[0]! : { type: 'mul', terms: out };
  }
  if (expr.type === 'pow') {
    const base = simplify(expr.base),
      e = expr.exponent;
    if (e === 0) return n(1);
    if (e === 1) return base;
    if (base.type === 'number' && Number.isFinite(base.value ** e)) return n(base.value ** e);
    if (base.type === 'pow') {
      const r = interval(base.base);
      if ((r && r.lo >= 0) || (Number.isInteger(e) && Number.isInteger(base.exponent)))
        return pow(base.base, base.exponent * e);
    }
    if (base.type === 'fn' && base.name === 'exp') return fn('exp', mul(n(e), base.arg));
    return { type: 'pow', base, exponent: e };
  }
  if (expr.type !== 'fn') return expr;
  const arg = simplify(expr.arg),
    name = expr.name;
  if (arg.type === 'number') {
    const calculate = {
      ln: Math.log,
      exp: Math.exp,
      sin: Math.sin,
      cos: Math.cos,
      tan: Math.tan,
      asin: Math.asin,
      acos: Math.acos,
      atan: Math.atan,
    }[name];
    const value = calculate(arg.value);
    if (Number.isFinite(value)) return n(value);
  }
  if (arg.type === 'fn') {
    if (name === 'ln' && arg.name === 'exp') return arg.arg;
    if (name === 'exp' && arg.name === 'ln' && interval(arg)) return arg.arg;
    if (
      ((name === 'sin' && arg.name === 'asin') ||
        (name === 'cos' && arg.name === 'acos') ||
        (name === 'tan' && arg.name === 'atan')) &&
      interval(arg)
    )
      return arg.arg;
    const r = interval(arg.arg);
    if (r && name === 'asin' && arg.name === 'sin' && r.lo >= -Math.PI / 2 && r.hi <= Math.PI / 2)
      return arg.arg;
    if (r && name === 'acos' && arg.name === 'cos' && r.lo >= 0 && r.hi <= Math.PI) return arg.arg;
    if (r && name === 'atan' && arg.name === 'tan' && r.lo > -Math.PI / 2 && r.hi < Math.PI / 2)
      return arg.arg;
  }
  if (
    name === 'ln' &&
    arg.type === 'mul' &&
    arg.terms.every((t) => {
      const r = interval(t);
      return r && positive(r);
    })
  )
    return add(...arg.terms.map((t) => fn('ln', t)));
  if (name === 'ln' && arg.type === 'pow') {
    const r = interval(arg.base);
    if (r && positive(r)) return mul(n(arg.exponent), fn('ln', arg.base));
  }
  return { type: 'fn', name, arg };
}

export function derivative(expr: Expr): Expr {
  if (expr.type === 'number') return n(0);
  if (expr.type === 'x') return n(1);
  if (expr.type === 'add') return add(...expr.terms.map(derivative));
  if (expr.type === 'mul')
    return add(
      ...expr.terms.map((term, i) =>
        mul(derivative(term), ...expr.terms.filter((_, j) => j !== i)),
      ),
    );
  if (expr.type === 'pow')
    return mul(n(expr.exponent), pow(expr.base, expr.exponent - 1), derivative(expr.base));
  const u = expr.arg,
    du = derivative(u);
  switch (expr.name) {
    case 'ln':
      return mul(du, pow(u, -1));
    case 'exp':
      return mul(du, fn('exp', u));
    case 'sin':
      return mul(du, fn('cos', u));
    case 'cos':
      return mul(n(-1), du, fn('sin', u));
    case 'tan':
      return mul(du, pow(fn('cos', u), -2));
    case 'asin':
      return mul(du, pow(add(n(1), mul(n(-1), pow(u, 2))), -0.5));
    case 'acos':
      return mul(n(-1), du, pow(add(n(1), mul(n(-1), pow(u, 2))), -0.5));
    case 'atan':
      return mul(du, pow(add(n(1), pow(u, 2)), -1));
  }
}

export function nodeCount(expr: Expr): number {
  if (expr.type === 'add' || expr.type === 'mul')
    return 1 + expr.terms.reduce((sum, e) => sum + nodeCount(e), 0);
  if (expr.type === 'fn') return 1 + nodeCount(expr.arg);
  if (expr.type === 'pow') return 1 + nodeCount(expr.base);
  return 1;
}
export type MathResult =
  | { ok: true; expression: Expr; constant: boolean; unchanged: boolean }
  | { ok: false; reason: string };
export function operate(expr: Expr, operation: Operation): MathResult {
  if (!interval(expr)) return { ok: false, reason: '原式在当前区间内无定义' };
  const raw: Expr =
    operation === 'derivative'
      ? derivative(expr)
      : operation === 'square'
        ? { type: 'pow', base: expr, exponent: 2 }
        : operation === 'reciprocal'
          ? { type: 'pow', base: expr, exponent: -1 }
          : { type: 'fn', name: operation, arg: expr };
  // Validate before cancellation: e.g. 1 / 0 must not simplify into a victory.
  if (!interval(raw)) return { ok: false, reason: '在 0 < x < 1 内，这次运算无法保证有定义' };
  const result = simplify(raw);
  if (nodeCount(result) > 160) return { ok: false, reason: '表达式过于复杂，请换一条运算路线' };
  return {
    ok: true,
    expression: result,
    constant: result.type === 'number',
    unchanged: key(result) === key(expr),
  };
}

const superDigits: Record<string, string> = {
  '0': '⁰',
  '1': '¹',
  '2': '²',
  '3': '³',
  '4': '⁴',
  '5': '⁵',
  '6': '⁶',
  '7': '⁷',
  '8': '⁸',
  '9': '⁹',
  '-': '⁻',
};
const numberText = (v: number): string =>
  Number.isInteger(v) ? String(v) : String(Number(v.toPrecision(5)));
export function format(expr: Expr): string {
  if (expr.type === 'number') return numberText(expr.value).replace('-', '−');
  if (expr.type === 'x') return 'x';
  if (expr.type === 'add') return expr.terms.map(format).join(' + ').replace(/\+ −/g, '− ');
  if (expr.type === 'mul') {
    return expr.terms
      .map((t, i) => {
        if (i === 0 && t.type === 'number' && t.value === -1) return '−';
        const s = format(t);
        return t.type === 'add' ? `(${s})` : s;
      })
      .join('');
  }
  if (expr.type === 'pow') {
    const b = format(expr.base),
      base = expr.base.type === 'x' || expr.base.type === 'number' ? b : `(${b})`;
    if (expr.exponent === -1) return `1/${base}`;
    if (expr.exponent === 0.5) return `√${base}`;
    if (Number.isInteger(expr.exponent))
      return (
        base +
        String(expr.exponent)
          .split('')
          .map((c) => superDigits[c] ?? c)
          .join('')
      );
    return `${base}^${numberText(expr.exponent)}`;
  }
  const a = format(expr.arg);
  if (expr.name === 'exp') return expr.arg.type === 'x' ? 'eˣ' : `e^(${a})`;
  return `${{ asin: 'arcsin', acos: 'arccos', atan: 'arctan', ln: 'ln', sin: 'sin', cos: 'cos', tan: 'tan' }[expr.name]}(${a})`;
}

export function evaluate(expr: Expr, x: number): number {
  if (expr.type === 'x') return x;
  if (expr.type === 'number') return expr.value;
  if (expr.type === 'add') return expr.terms.reduce((v, t) => v + evaluate(t, x), 0);
  if (expr.type === 'mul') return expr.terms.reduce((v, t) => v * evaluate(t, x), 1);
  if (expr.type === 'pow') return evaluate(expr.base, x) ** expr.exponent;
  return {
    ln: Math.log,
    exp: Math.exp,
    sin: Math.sin,
    cos: Math.cos,
    tan: Math.tan,
    asin: Math.asin,
    acos: Math.acos,
    atan: Math.atan,
  }[expr.name](evaluate(expr.arg, x));
}
