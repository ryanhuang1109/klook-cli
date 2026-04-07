#!/bin/bash
set -e

echo "=========================================="
echo "  Travel Competitor Monitor — Installer"
echo "=========================================="
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

ok() { echo -e "${GREEN}[OK]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
fail() { echo -e "${RED}[FAIL]${NC} $1"; exit 1; }

# Check Node.js
if ! command -v node &> /dev/null; then
  fail "Node.js not found. Install Node.js 20+ first: https://nodejs.org"
fi

NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt 20 ]; then
  fail "Node.js 20+ required. Current: $(node -v)"
fi
ok "Node.js $(node -v)"

# Check Chrome
if [ "$(uname)" = "Darwin" ]; then
  if [ -d "/Applications/Google Chrome.app" ] || [ -d "/Applications/Chromium.app" ]; then
    ok "Chrome/Chromium found"
  else
    warn "Chrome not found in /Applications. Browser Bridge needs Chrome or Chromium."
  fi
fi

echo ""
echo "Step 1/5: Installing opencli..."
npm install -g @jackwener/opencli 2>&1 | tail -1
ok "opencli installed ($(opencli --version 2>/dev/null || echo 'unknown'))"

echo ""
echo "Step 2/5: Cloning klook-cli..."
INSTALL_DIR="$HOME/klook-cli"
if [ -d "$INSTALL_DIR" ]; then
  warn "$INSTALL_DIR already exists, pulling latest..."
  cd "$INSTALL_DIR" && git pull 2>&1 | tail -1
else
  git clone https://github.com/ryanhuang1109/klook-cli.git "$INSTALL_DIR" 2>&1 | tail -1
fi
cd "$INSTALL_DIR"
ok "klook-cli at $INSTALL_DIR"

echo ""
echo "Step 3/5: Installing dependencies and building..."
npm install 2>&1 | tail -1
npm run build 2>&1 | tail -1
ok "Build complete"

echo ""
echo "Step 4/5: Registering opencli plugins..."
mkdir -p ~/.opencli/plugins
ln -sf "$INSTALL_DIR/dist/clis/klook" ~/.opencli/plugins/klook
ln -sf "$INSTALL_DIR/dist/clis/trip" ~/.opencli/plugins/trip
ln -sf "$INSTALL_DIR/dist/clis/getyourguide" ~/.opencli/plugins/getyourguide
ln -sf "$INSTALL_DIR/dist/clis/kkday" ~/.opencli/plugins/kkday

cp opencli-plugin.json dist/clis/klook/
for p in trip getyourguide kkday; do
  echo "{\"name\":\"$p\",\"version\":\"0.1.0\",\"opencli\":\">=1.0.0\"}" > "dist/clis/$p/opencli-plugin.json"
done
ok "Plugins registered ($(opencli list 2>/dev/null | grep -cE 'klook|trip|getyourguide|kkday') commands)"

echo ""
echo "Step 5/5: Building Browser Bridge extension..."
EXTENSION_DIR="/tmp/opencli-extension"
if [ -d "$EXTENSION_DIR" ]; then
  rm -rf "$EXTENSION_DIR"
fi
git clone --depth 1 https://github.com/jackwener/opencli.git "$EXTENSION_DIR" 2>&1 | tail -1
cd "$EXTENSION_DIR/extension" && npm install 2>&1 | tail -1 && npm run build 2>&1 | tail -1
ok "Browser Bridge extension built at $EXTENSION_DIR/extension"

echo ""
echo "=========================================="
echo -e "${GREEN}  Installation complete!${NC}"
echo "=========================================="
echo ""
echo "One manual step remaining — load the Chrome extension:"
echo ""
echo "  1. Open Chrome"
echo "  2. Go to chrome://extensions/"
echo "  3. Enable 'Developer Mode' (top right)"
echo "  4. Click 'Load unpacked'"
echo "  5. Select: $EXTENSION_DIR/extension"
echo ""
echo "Then verify:"
echo "  opencli doctor"
echo ""
echo "Quick test:"
echo "  opencli klook search \"Tokyo Disneyland\" --limit 3"
echo ""
echo "Start web dashboard:"
echo "  cd $INSTALL_DIR && npm run web"
echo "  # → http://localhost:17890"
echo ""
echo "--- OpenRouter API Key (for AI comparison) ---"
echo ""
echo "Get your key at: https://openrouter.ai/keys"
echo ""
read -p "Paste your OpenRouter API key (or press Enter to skip): " OPENROUTER_KEY
if [ -n "$OPENROUTER_KEY" ]; then
  mkdir -p ~/.klook-cli
  echo "{\"openrouter_api_key\":\"$OPENROUTER_KEY\"}" > ~/.klook-cli/config.json
  ok "OpenRouter API key saved to ~/.klook-cli/config.json"
else
  warn "Skipped. You can set it later:"
  echo "  mkdir -p ~/.klook-cli"
  echo "  echo '{\"openrouter_api_key\":\"YOUR-KEY\"}' > ~/.klook-cli/config.json"
fi
echo ""
