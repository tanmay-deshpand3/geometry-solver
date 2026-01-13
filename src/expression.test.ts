// Expression Parser Tests
// Run with: npx ts-node src/expression.test.ts

import { validateExpression, evaluateExpression, extractVariableNames } from './expression.ts';
import type { Variable } from './types.ts';

function createVar(name: string, value: number | null): Variable {
    return { id: name, name, value, isDetermined: value !== null };
}

function makeVars(...entries: [string, number | null][]): Map<string, Variable> {
    const map = new Map<string, Variable>();
    for (const [name, value] of entries) {
        map.set(name, createVar(name, value));
    }
    return map;
}

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
    try {
        fn();
        console.log(`✓ ${name}`);
        passed++;
    } catch (e) {
        console.log(`✗ ${name}: ${e}`);
        failed++;
    }
}

function assert(cond: boolean, msg = 'Assertion failed') {
    if (!cond) throw new Error(msg);
}

function assertEq<T>(actual: T, expected: T, msg = '') {
    if (actual !== expected) {
        throw new Error(`Expected ${expected}, got ${actual}. ${msg}`);
    }
}

// ============ VALIDATION TESTS ============
test('Valid: simple number', () => assert(validateExpression('42')));
test('Valid: decimal', () => assert(validateExpression('3.14')));
test('Valid: variable', () => assert(validateExpression('x')));
test('Valid: addition', () => assert(validateExpression('x + 3')));
test('Valid: complex', () => assert(validateExpression('(x + 3) * 2')));
test('Valid: power', () => assert(validateExpression('2 ^ 3')));
test('Invalid: double operator', () => assert(!validateExpression('x ++ 2')));
test('Invalid: unmatched paren', () => assert(!validateExpression('(x + 3')));

// ============ EVALUATION TESTS ============
test('Eval: constant', () => assertEq(evaluateExpression(5, new Map()), 5));
test('Eval: string number', () => assertEq(evaluateExpression('42', new Map()), 42));
test('Eval: addition', () => assertEq(evaluateExpression('2 + 3', new Map()), 5));
test('Eval: subtraction', () => assertEq(evaluateExpression('10 - 4', new Map()), 6));
test('Eval: multiplication', () => assertEq(evaluateExpression('3 * 4', new Map()), 12));
test('Eval: division', () => assertEq(evaluateExpression('10 / 2', new Map()), 5));
test('Eval: power', () => assertEq(evaluateExpression('2 ^ 3', new Map()), 8));
test('Eval: parentheses', () => assertEq(evaluateExpression('(2 + 3) * 4', new Map()), 20));
test('Eval: precedence mul > add', () => assertEq(evaluateExpression('2 + 3 * 4', new Map()), 14));
test('Eval: precedence pow > mul', () => assertEq(evaluateExpression('2 * 3 ^ 2', new Map()), 18));
test('Eval: variable', () => assertEq(evaluateExpression('x + 3', makeVars(['x', 5])), 8));
test('Eval: two variables', () => assertEq(evaluateExpression('x + y', makeVars(['x', 2], ['y', 3])), 5));
test('Eval: unresolved variable', () => assertEq(evaluateExpression('x + 3', makeVars(['x', null])), null));
test('Eval: missing variable', () => assertEq(evaluateExpression('x + 3', new Map()), null));
test('Eval: complex', () => assertEq(evaluateExpression('(x + 3) * 2', makeVars(['x', 5])), 16));
test('Eval: right-associative power', () => assertEq(evaluateExpression('2 ^ 3 ^ 2', new Map()), 512)); // 2^(3^2) = 2^9

// ============ VARIABLE EXTRACTION TESTS ============
test('Extract: constant', () => assertEq(extractVariableNames(5).length, 0));
test('Extract: single var', () => assertEq(extractVariableNames('x + 3').join(','), 'x'));
test('Extract: two vars', () => assertEq(extractVariableNames('x + y').sort().join(','), 'x,y'));
test('Extract: repeated var', () => assertEq(extractVariableNames('x + x').join(','), 'x,x'));

// ============ SUMMARY ============
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
