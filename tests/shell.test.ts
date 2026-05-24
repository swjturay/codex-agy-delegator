import test from 'node:test';
import assert from 'node:assert';
import { tailString } from '../src/shell.js';

test('tailString should return full string if within maxLines', () => {
  const input = 'line 1\nline 2\nline 3';
  const result = tailString(input, 5);
  assert.strictEqual(result, input);
});

test('tailString should truncate string if exceeding maxLines', () => {
  const input = '1\n2\n3\n4\n5\n6';
  const result = tailString(input, 3);
  assert.strictEqual(result, '... (3 lines omitted) ...\n4\n5\n6');
});
