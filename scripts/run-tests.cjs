const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const repositoryRoot = path.resolve(__dirname, '..');
const testDirectory = path.join(repositoryRoot, 'tests');
const testFiles = fs.readdirSync(testDirectory)
  .filter((file) => file.endsWith('.test.ts'))
  .sort()
  .map((file) => path.join(testDirectory, file));

if (testFiles.length === 0) {
  console.error('No test files found.');
  process.exit(1);
}

const args = [];
if (process.argv.includes('--coverage')) {
  args.push('--experimental-test-coverage');
}
args.push('--import', 'tsx', '--test', ...testFiles);

const result = spawnSync(process.execPath, args, {
  cwd: repositoryRoot,
  env: process.env,
  shell: false,
  stdio: 'inherit',
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
