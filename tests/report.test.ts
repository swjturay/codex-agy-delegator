import test from 'node:test';
import assert from 'node:assert';
import { parseAgyReport } from '../src/report.js';

test('parseAgyReport should correctly parse a valid report', () => {
  const validJson = `
  {
    "changed_files": ["a.txt"],
    "implementation_summary": "Done",
    "tests_run": ["npm test"],
    "test_results": [],
    "risk_notes": ["note 1"],
    "review_focus": ["a.txt"],
    "assumptions": ["assume 1"]
  }`;
  
  const parsed = parseAgyReport(validJson);
  assert.ok(parsed !== null, 'Report should be parsed successfully');
  assert.deepStrictEqual(parsed.changed_files, ['a.txt']);
  assert.strictEqual(parsed.implementation_summary, 'Done');
  assert.deepStrictEqual(parsed.tests_run, ['npm test']);
});

test('parseAgyReport should return null for invalid json', () => {
  const invalidJson = `{ "changed_files": ["a.txt" ] // missing closing brace`;
  const parsed = parseAgyReport(invalidJson);
  assert.strictEqual(parsed, null);
});

test('parseAgyReport should provide defaults for missing fields', () => {
  const emptyJson = `{}`;
  const parsed = parseAgyReport(emptyJson);
  assert.ok(parsed !== null);
  assert.deepStrictEqual(parsed.changed_files, []);
  assert.strictEqual(parsed.implementation_summary, '');
  assert.deepStrictEqual(parsed.risk_notes, []);
});
