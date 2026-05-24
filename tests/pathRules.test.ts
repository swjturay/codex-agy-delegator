import test from 'node:test';
import assert from 'node:assert';
import { findFilesOutsideRules, findRuleViolations, matchesPathRule } from '../src/pathRules.js';

test('matchesPathRule should support exact, directory, and glob rules', () => {
  assert.strictEqual(matchesPathRule('src/models/user.ts', 'src/models/*.ts'), true);
  assert.strictEqual(matchesPathRule('src/models/nested/user.ts', 'src/models/*.ts'), false);
  assert.strictEqual(matchesPathRule('src/models/nested/user.ts', 'src/models/**/*.ts'), true);
  assert.strictEqual(matchesPathRule('src/models/user.ts', 'src/models'), true);
  assert.strictEqual(matchesPathRule('src/model.ts', 'src/models'), false);
});

test('findFilesOutsideRules should flag files not covered by allowed rules', () => {
  const outside = findFilesOutsideRules(
    ['src/models/user.ts', 'src/views/user.ts'],
    ['src/models/**/*.ts'],
  );

  assert.deepStrictEqual(outside, ['src/views/user.ts']);
});

test('findRuleViolations should support loose forbidden matching', () => {
  const violations = findRuleViolations(
    ['src/models/legacy/user.ts', 'src/models/user.ts'],
    ['legacy'],
    true,
  );

  assert.deepStrictEqual(violations, ['src/models/legacy/user.ts']);
});
