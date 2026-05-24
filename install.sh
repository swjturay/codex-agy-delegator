#!/usr/bin/env bash
set -e

echo "=================================================="
echo "🚀 Installing Codex-Agy Delegator"
echo "=================================================="

# Check dependencies
for cmd in git node npm; do
  if ! command -v $cmd &> /dev/null; then
    echo "❌ Error: $cmd is required but not installed. Please install $cmd and try again."
    exit 1
  fi
done

TARGET_DIR="$HOME/.codex-agy-delegator"

if [ -d "$TARGET_DIR" ]; then
  echo "📦 Updating existing installation in $TARGET_DIR..."
  cd "$TARGET_DIR"
  git pull --quiet origin main
else
  echo "📦 Downloading Codex-Agy Delegator to $TARGET_DIR..."
  git clone --quiet https://github.com/swjturay/codex-agy-delegator.git "$TARGET_DIR"
  cd "$TARGET_DIR"
fi

echo "⚙️  Installing dependencies..."
npm install --no-fund --no-audit --silent

echo "🔨 Compiling project..."
npm run build > /dev/null 2>&1

echo "🛠  Running setup..."
npm run setup

echo "=================================================="
echo "✨ Codex-Agy Delegator has been successfully installed!"
echo "=================================================="
