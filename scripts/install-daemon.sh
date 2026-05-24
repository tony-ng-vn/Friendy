#!/usr/bin/env bash
set -euo pipefail

LABEL="com.friendy.sensor"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE_PLIST="$ROOT_DIR/launchd/$LABEL.plist"
TARGET_DIR="$HOME/Library/LaunchAgents"
TARGET_PLIST="$TARGET_DIR/$LABEL.plist"

mkdir -p "$TARGET_DIR" "$HOME/Library/Logs"

sed \
  -e "s#__FRIENDY_REPO_DIR__#$ROOT_DIR#g" \
  -e "s#__FRIENDY_HOME__#$HOME#g" \
  "$SOURCE_PLIST" > "$TARGET_PLIST"

chmod 644 "$TARGET_PLIST"

launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$(id -u)" "$TARGET_PLIST"
launchctl enable "gui/$(id -u)/$LABEL"
launchctl kickstart -k "gui/$(id -u)/$LABEL"

echo "Installed and started $LABEL"
echo "Logs: $HOME/Library/Logs/friendy-sensor.log and friendy-sensor.error.log"
