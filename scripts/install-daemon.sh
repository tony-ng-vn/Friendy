#!/usr/bin/env bash
set -euo pipefail

LABEL="com.friendy.sensor"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
TEMPLATE="$REPO_DIR/launchagents/$LABEL.plist"
DEST_DIR="$HOME/Library/LaunchAgents"
DEST="$DEST_DIR/$LABEL.plist"
BOOTSTRAP_TARGET="gui/$(id -u)"

if [[ ! -f "$TEMPLATE" ]]; then
  echo "Missing LaunchAgent template: $TEMPLATE" >&2
  exit 1
fi

mkdir -p "$DEST_DIR" "$HOME/Library/Logs"
sed \
  -e "s#__FRIENDY_REPO_DIR__#$REPO_DIR#g" \
  -e "s#__FRIENDY_HOME__#$HOME#g" \
  "$TEMPLATE" > "$DEST"
chmod 644 "$DEST"

if launchctl print "$BOOTSTRAP_TARGET/$LABEL" >/dev/null 2>&1; then
  launchctl bootout "$BOOTSTRAP_TARGET" "$DEST" >/dev/null 2>&1 || true
fi

launchctl bootstrap "$BOOTSTRAP_TARGET" "$DEST"
launchctl enable "$BOOTSTRAP_TARGET/$LABEL"
launchctl kickstart -k "$BOOTSTRAP_TARGET/$LABEL"

echo "Installed and started $LABEL"
echo "Logs: $HOME/Library/Logs/friendy-sensor.log and friendy-sensor.err.log"
