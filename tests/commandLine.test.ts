import assert from 'node:assert';
import test from 'node:test';

import { parseCommandLine } from '../src/commandLine.js';

test('parses quoted arguments without invoking a shell', () => {
  assert.deepStrictEqual(
    parseCommandLine('node -e "console.log(1 + 2)"'),
    ['node', '-e', 'console.log(1 + 2)'],
  );
});

test('preserves Windows path separators', () => {
  assert.deepStrictEqual(
    parseCommandLine('"C:\\Program Files\\nodejs\\node.exe" script.js'),
    ['C:\\Program Files\\nodejs\\node.exe', 'script.js'],
  );
});

test('treats shell metacharacters as ordinary argument text', () => {
  assert.deepStrictEqual(
    parseCommandLine('echo hello;touch /tmp/not-executed'),
    ['echo', 'hello;touch', '/tmp/not-executed'],
  );
});

test('rejects empty and unterminated command lines', () => {
  assert.throws(() => parseCommandLine('   '), /cannot be empty/u);
  assert.throws(() => parseCommandLine('node "unterminated'), /Unterminated/u);
});
