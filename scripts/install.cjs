const path = require('path');
const fs = require('fs');
const os = require('os');

const homeDir = os.homedir();

function ensureDirSync(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function tomlString(value) {
  return value
    .replace(/\\/g, '/')
    .replace(/"/g, '\\"')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n');
}

console.log('Starting Codex Agent Delegator setup...');
console.log('==================================================');
console.log('\n[1/2] Installing delegation skills...');

const skillsToInstall = [
  {
    name: 'codex-delegation',
    source: path.resolve(__dirname, '..', 'skills', 'codex-delegation', 'SKILL.md'),
    destinations: [
      path.join(homeDir, '.codex', 'skills', 'codex-delegation', 'SKILL.md'),
      path.join(homeDir, '.config', 'codex', 'skills', 'codex-delegation', 'SKILL.md'),
    ],
  },
  {
    name: 'codex-review',
    source: path.resolve(__dirname, '..', 'skills', 'codex-review', 'SKILL.md'),
    destinations: [
      path.join(homeDir, '.codex', 'skills', 'codex-review', 'SKILL.md'),
      path.join(homeDir, '.config', 'codex', 'skills', 'codex-review', 'SKILL.md'),
    ],
  },
  {
    name: 'agy-worker',
    source: path.resolve(__dirname, '..', 'skills', 'agy-worker', 'SKILL.md'),
    destinations: [
      path.join(homeDir, '.antigravitycli', 'skills', 'agy-worker', 'SKILL.md'),
    ],
  },
];

for (const skill of skillsToInstall) {
  let installed = false;
  if (!fs.existsSync(skill.source)) {
    console.log(`Source skill not found: ${skill.source}`);
    continue;
  }

  const content = fs.readFileSync(skill.source, 'utf-8');
  for (const destination of skill.destinations) {
    try {
      ensureDirSync(path.dirname(destination));
      fs.writeFileSync(destination, content);
      console.log(`Installed [${skill.name}] -> ${destination}`);
      installed = true;
      break;
    } catch {
      // Try the next supported destination.
    }
  }
  if (!installed) {
    console.log(`Failed to install [${skill.name}]. Copy it manually.`);
  }
}

console.log('\n[2/2] Configuring the MCP server for Codex...');

const distIndex = tomlString(path.resolve(__dirname, '..', 'dist', 'index.js'));
const nodePath = tomlString(process.execPath);
const agentPath = tomlString(process.env.PATH || '');
const tomlConfig = `
[mcp_servers.codex-agent-delegator]
command = "${nodePath}"
args = ["${distIndex}"]
env = { PATH = "${agentPath}" }
startup_timeout_sec = 15.0
tool_timeout_sec = 120.0
`;

const potentialPaths = [
  path.join(homeDir, '.codex', 'config.toml'),
  path.join(homeDir, '.config', 'codex', 'config.toml'),
  path.join(homeDir, 'Library', 'Application Support', 'codex', 'config.toml'),
];

let configured = false;
for (const configPath of potentialPaths) {
  if (!fs.existsSync(configPath)) continue;
  try {
    const content = fs.readFileSync(configPath, 'utf-8');
    if (
      content.includes('[mcp_servers.codex-agent-delegator]')
      || content.includes('[mcp_servers.codex-agy-delegator]')
    ) {
      console.log(`MCP configuration already exists in ${configPath}`);
      configured = true;
      break;
    }
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = `${configPath}.backup-${timestamp}`;
    fs.copyFileSync(configPath, backupPath);
    fs.appendFileSync(configPath, tomlConfig);
    console.log(`Appended MCP configuration to ${configPath}`);
    console.log(`Backup written to ${backupPath}`);
    configured = true;
    break;
  } catch (error) {
    console.log(`Found ${configPath} but failed to update it: ${error.message}`);
  }
}

if (!configured) {
  const defaultConfig = potentialPaths[0];
  try {
    ensureDirSync(path.dirname(defaultConfig));
    fs.writeFileSync(defaultConfig, tomlConfig.trimStart());
    console.log(`Created MCP configuration in ${defaultConfig}`);
    configured = true;
  } catch {
    console.log('Could not create the Codex config.toml file.');
    console.log('Add this block manually:\n');
    console.log(tomlConfig);
  }
}

console.log('\n==================================================');
console.log('Setup complete. Restart Codex for the changes to take effect.');
console.log('==================================================');
