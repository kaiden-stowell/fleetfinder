#!/bin/bash
# ── FleetFinder Installer ─────────────────────────────────────────────────
# curl -fsSL https://raw.githubusercontent.com/kaiden-stowell/fleetfinder/main/install.sh | bash
# ──────────────────────────────────────────────────────────────────────────

set -e

REPO="https://github.com/kaiden-stowell/fleetfinder.git"
DEST="$HOME/fleetfinder"
PORT=12792
PLIST_NAME="com.fleetfinder.server"
PLIST_PATH="$HOME/Library/LaunchAgents/${PLIST_NAME}.plist"

echo ""
echo "  FleetFinder Installer"
echo "  ─────────────────────"
echo ""

# ── Dependencies ───────────────────────────────────────────────────────────
for cmd in node npm git; do
  if ! command -v "$cmd" &>/dev/null; then
    echo "  Error: '$cmd' is required but not installed."
    exit 1
  fi
done

NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "  Error: Node.js 18+ required (found v$(node -v))"
  exit 1
fi

# ── Preserve user data on reinstall ────────────────────────────────────────
if [ -d "$DEST" ]; then
  echo "  Found an existing install at $DEST"
  REPLY=""
  read -p "  Update it? (data, photos, and PIN are preserved) [y/N] " -n 1 -r REPLY < /dev/tty 2>/dev/null || REPLY="y"
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "  Cancelled."
    exit 0
  fi
  TEMP_DATA=$(mktemp -d)
  [ -f "$DEST/.env" ] && cp "$DEST/.env" "$TEMP_DATA/.env"
  [ -d "$DEST/data" ] && cp -r "$DEST/data" "$TEMP_DATA/data"
  echo "  Backed up your data"
fi

# ── Download ───────────────────────────────────────────────────────────────
echo "  Downloading FleetFinder..."
if [ -d "$DEST/.git" ]; then
  cd "$DEST"
  git stash 2>/dev/null || true
  git pull --ff-only origin main
else
  rm -rf "$DEST"
  git clone "$REPO" "$DEST"
fi
cd "$DEST"

# ── Restore preserved data ─────────────────────────────────────────────────
if [ -d "${TEMP_DATA:-/nonexistent}" ]; then
  [ -f "$TEMP_DATA/.env" ] && cp "$TEMP_DATA/.env" .env
  [ -d "$TEMP_DATA/data" ] && cp -r "$TEMP_DATA/data" .
  rm -rf "$TEMP_DATA"
  echo "  Restored your data"
fi

echo "  Installing dependencies..."
npm install --production --silent 2>/dev/null || npm install --production

mkdir -p data data/uploads logs

# ── Create .env with a random PIN on a fresh install ───────────────────────
if [ ! -f .env ]; then
  PIN=$(node -e 'console.log(String(Math.floor(1000 + Math.random() * 9000)))')
  cat > .env <<ENVEOF
# FleetFinder configuration
HOST=0.0.0.0
PORT=${PORT}
FLEET_PIN=${PIN}
ENVEOF
  echo ""
  echo "  Generated access PIN: ${PIN}"
  echo "  (employees enter this on their phones — change it in $DEST/.env)"
fi

chmod +x start.sh install.sh 2>/dev/null || true

# ── Install as a launchd background service ────────────────────────────────
NODE_BIN=$(which node)
mkdir -p "$HOME/Library/LaunchAgents"

cat > "$PLIST_PATH" <<PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${PLIST_NAME}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${NODE_BIN}</string>
        <string>${DEST}/server.js</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${DEST}</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${DEST}/logs/stdout.log</string>
    <key>StandardErrorPath</key>
    <string>${DEST}/logs/stderr.log</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin:${HOME}/.local/bin</string>
    </dict>
</dict>
</plist>
PLISTEOF

launchctl unload "$PLIST_PATH" 2>/dev/null || true
launchctl load "$PLIST_PATH"

VERSION=$(node -p "require('./version.json').version" 2>/dev/null || echo "unknown")

sleep 2
echo ""
if curl -s -o /dev/null "http://127.0.0.1:${PORT}/api/stats" 2>/dev/null; then
  echo "  ✅ FleetFinder v${VERSION} installed and running!"
else
  echo "  ✅ FleetFinder v${VERSION} installed!"
  echo "  ⚠️  Server may still be starting — check $DEST/logs/"
fi
echo ""
echo "  Admin dashboard → http://127.0.0.1:${PORT}"
echo "  The server runs in the background and starts automatically on boot."
echo ""
echo "  Stop:    launchctl unload ~/Library/LaunchAgents/${PLIST_NAME}.plist"
echo "  Restart: launchctl unload ~/Library/LaunchAgents/${PLIST_NAME}.plist && \\"
echo "           launchctl load ~/Library/LaunchAgents/${PLIST_NAME}.plist"
echo ""
