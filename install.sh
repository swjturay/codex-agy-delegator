#!/usr/bin/env bash
set -euo pipefail

echo "=================================================="
echo "Installing Codex Agent Delegator"
echo "=================================================="

for cmd in git node npm; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Error: $cmd is required but not installed."
    exit 1
  fi
done

NODE_MAJOR="$(node -p 'Number(process.versions.node.split(".")[0])')"
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "Error: Node.js 20 or newer is required. Found $(node --version)."
  exit 1
fi

LEGACY_TARGET="$HOME/.codex-agy-delegator"
if [ -d "$LEGACY_TARGET/.git" ]; then
  TARGET_DIR="$LEGACY_TARGET"
elif [ "$(uname -s)" = "Darwin" ]; then
  TARGET_DIR="$HOME/Library/Application Support/codex-agent-delegator"
else
  DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
  TARGET_DIR="$DATA_HOME/codex-agent-delegator"
fi

if [ -d "$TARGET_DIR/.git" ]; then
  echo "Updating existing installation in $TARGET_DIR..."
  cd "$TARGET_DIR"
  if [ -n "$(git status --porcelain)" ]; then
    echo "Error: existing installation has local changes; refusing to overwrite them."
    exit 1
  fi
  git pull --ff-only origin main
elif [ -e "$TARGET_DIR" ]; then
  echo "Error: $TARGET_DIR exists but is not a git checkout."
  exit 1
else
  echo "Installing to $TARGET_DIR..."
  git clone --quiet https://github.com/swjturay/codex-agy-delegator.git "$TARGET_DIR"
  cd "$TARGET_DIR"
fi

echo "Installing locked dependencies..."
npm ci
echo "Building the MCP server..."
npm run build
echo "Installing Codex skills and MCP configuration..."
npm run setup

echo "=================================================="
echo "Codex Agent Delegator installed successfully."
echo "Restart Codex, then call list_agent_backends to verify your agent CLIs."
echo "=================================================="
