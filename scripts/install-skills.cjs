const path = require('path');
const fs = require('fs');
const os = require('os');

const homeDir = os.homedir();

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

function ensureDirSync(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

console.log("=========================================");
console.log("Installing Skills for Codex and Agy...");
console.log("=========================================");

let installedCount = 0;

for (const skill of skillsToInstall) {
  let installed = false;
  
  if (!fs.existsSync(skill.source)) {
    console.log(`❌ Source skill not found: ${skill.source}`);
    continue;
  }

  const content = fs.readFileSync(skill.source, 'utf-8');

  for (const dest of skill.destinations) {
    const destDir = path.dirname(dest);
    
    // We try to install to the first possible path. If the base app directory doesn't exist, we might skip or force create it.
    // To be safe, we'll force create the .codex or .antigravitycli skills directory if we are confident it's the primary one.
    // We'll prioritize the first destination.
    try {
      ensureDirSync(destDir);
      fs.writeFileSync(dest, content);
      console.log(`✅ Installed [${skill.name}] -> ${dest}`);
      installed = true;
      installedCount++;
      break; // Only install to the first successful path
    } catch (err) {
      console.log(`⚠️  Could not write to ${dest}: ${err.message}`);
    }
  }
  
  if (!installed) {
    console.log(`❌ Failed to install [${skill.name}]. Please copy manually.`);
  }
}

console.log("=========================================");
console.log(`Finished installing ${installedCount}/${skillsToInstall.length} skills.`);
