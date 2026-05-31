import test from 'node:test';
import assert from 'node:assert/strict';

import { quoteWindowsCommandArg, stripTerminalControlSequences } from '../src/windowsConPty.js';

test('quoteWindowsCommandArg leaves simple tokens unchanged', () => {
  assert.equal(quoteWindowsCommandArg('agy'), 'agy');
  assert.equal(quoteWindowsCommandArg('--version'), '--version');
});

test('quoteWindowsCommandArg wraps spaces and escapes quotes', () => {
  assert.equal(quoteWindowsCommandArg('hello world'), '"hello world"');
  assert.equal(quoteWindowsCommandArg('say "hello"'), '"say \\"hello\\""');
});

test('stripTerminalControlSequences removes ansi and osc sequences', () => {
  const raw = '\u001b[2J\u001b[Hhello\u001b]0;title\u0007\r\nworld\u001b[?25h';
  assert.equal(stripTerminalControlSequences(raw), 'hello\nworld');
});
