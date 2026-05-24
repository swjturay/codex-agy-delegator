const path = require('path');
const fs = require('fs');
const os = require('os');

const distIndex = path.resolve(__dirname, '..', 'dist', 'src', 'index.js');
const tomlConfig = `\n[mcp_servers.codex-agy-delegator]
command = "node"
args = ["${distIndex}"]\n`;

console.log("=========================================");
console.log("Codex MCP Server Configuration Generated:");
console.log("=========================================");
console.log(tomlConfig);
console.log("=========================================");

const homeDir = os.homedir();
// Potential codex config paths, just an example list based on common locations
const potentialPaths = [
  path.join(homeDir, '.codex', 'mcp.toml'),
  path.join(homeDir, '.config', 'codex', 'mcp.toml'),
  path.join(homeDir, 'Library', 'Application Support', 'codex', 'mcp.toml')
];

let appended = false;
for (const p of potentialPaths) {
  if (fs.existsSync(p)) {
    try {
      const content = fs.readFileSync(p, 'utf-8');
      if (content.includes('[mcp_servers.codex-agy-delegator]')) {
        console.log(`\n✅ Configuration already exists in ${p}`);
        appended = true;
        break;
      }
      fs.appendFileSync(p, tomlConfig);
      console.log(`\n✅ Automatically appended configuration to ${p}`);
      appended = true;
      break;
    } catch (err) {
      console.log(`\n❌ Found ${p} but failed to append: ${err.message}`);
    }
  }
}

if (!appended) {
  console.log("\n⚠️  Could not automatically find your Codex mcp.toml file.");
  console.log("Please copy the configuration block above and paste it into your Codex MCP configuration file manually.");
} else {
  console.log("Please restart your Codex client for the changes to take effect.");
}
