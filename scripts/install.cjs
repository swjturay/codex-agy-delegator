const path = require('path');
const fs = require('fs');
const os = require('os');

const homeDir = os.homedir();

function ensureDirSync(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

console.log("🚀 Starting Codex-Agy Delegator Quick Setup...");
console.log("==================================================");

// ---------------------------------------------------------
// 1. Install Skills
// ---------------------------------------------------------
console.log("\n[1/2] Installing Skills for Codex and Agy...");

const skillsToInstall = [
  {
    name: 'codex-delegation',
    source: path.resolve(__dirname, '..', 'skills', 'codex-delegation', 'SKILL.md'),
    destinations: [
      path.join(homeDir, '.codex', 'skills', 'codex-delegation', 'SKILL.md'),
      path.join(homeDir, '.config', 'codex', 'skills', 'codex-delegation', 'SKILL.md')
    ]
  },
  {
    name: 'codex-review',
    source: path.resolve(__dirname, '..', 'skills', 'codex-review', 'SKILL.md'),
    destinations: [
      path.join(homeDir, '.codex', 'skills', 'codex-review', 'SKILL.md'),
      path.join(homeDir, '.config', 'codex', 'skills', 'codex-review', 'SKILL.md')
    ]
  },
  {
    name: 'agy-worker',
    source: path.resolve(__dirname, '..', 'skills', 'agy-worker', 'SKILL.md'),
    destinations: [
      path.join(homeDir, '.antigravitycli', 'skills', 'agy-worker', 'SKILL.md')
    ]
  }
];

let installedSkillsCount = 0;

for (const skill of skillsToInstall) {
  let installed = false;
  
  if (!fs.existsSync(skill.source)) {
    console.log(`❌ Source skill not found: ${skill.source}`);
    continue;
  }

  const content = fs.readFileSync(skill.source, 'utf-8');

  for (const dest of skill.destinations) {
    const destDir = path.dirname(dest);
    try {
      ensureDirSync(destDir);
      fs.writeFileSync(dest, content);
      console.log(`✅ Installed [${skill.name}] -> ${dest}`);
      installed = true;
      installedSkillsCount++;
      break; 
    } catch (err) {
      // ignore and try next destination
    }
  }
  
  if (!installed) {
    console.log(`❌ Failed to install [${skill.name}]. Please copy manually.`);
  }
}

// ---------------------------------------------------------
// 2. Install MCP Server Configuration
// ---------------------------------------------------------
console.log(`\n[2/2] Configuring MCP Server for Codex...`);

const distIndex = path.resolve(__dirname, '..', 'dist', 'index.js').replace(/\\/g, '/');
const tomlConfig = `\n[mcp_servers.codex-agy-delegator]
command = "node"
args = ["${distIndex}"]\n`;

const potentialPaths = [
  path.join(homeDir, '.codex', 'config.toml'),
  path.join(homeDir, '.config', 'codex', 'config.toml'),
  path.join(homeDir, 'Library', 'Application Support', 'codex', 'config.toml')
];

let mcpAppended = false;
for (const p of potentialPaths) {
  if (fs.existsSync(p)) {
    try {
      const content = fs.readFileSync(p, 'utf-8');
      if (content.includes('[mcp_servers.codex-agy-delegator]')) {
        console.log(`✅ MCP Configuration already exists in ${p}`);
        mcpAppended = true;
        break;
      }
      fs.appendFileSync(p, tomlConfig);
      console.log(`✅ Automatically appended MCP configuration to ${p}`);
      mcpAppended = true;
      break;
    } catch (err) {
      console.log(`❌ Found ${p} but failed to append: ${err.message}`);
    }
  }
}

if (!mcpAppended) {
  console.log("⚠️  Could not automatically find your Codex config.toml file.");
  console.log("Please copy the configuration block below and paste it into your Codex MCP configuration file manually:\n");
  console.log(tomlConfig);
}

console.log("\n==================================================");
console.log("🎉 Quick Setup Complete!");
console.log("Please restart your Codex client for the changes to take effect.");
console.log("==================================================");
