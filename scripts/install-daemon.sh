#!/usr/bin/env bash
set -euo pipefail

LABEL="com.friendy.sensor"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE_PLIST="$REPO_DIR/launchd/$LABEL.plist"
TARGET_DIR="$HOME/Library/LaunchAgents"
TARGET_PLIST="$TARGET_DIR/$LABEL.plist"
LOG_DIR="$HOME/Library/Logs"

if [[ ! -f "$SOURCE_PLIST" ]]; then
  echo "Missing LaunchAgent template: $SOURCE_PLIST" >&2
  exit 1
fi

mkdir -p "$TARGET_DIR" "$LOG_DIR"
sed "s|\$HOME/Friendy|$REPO_DIR|g" "$SOURCE_PLIST" > "$TARGET_PLIST"
chmod 644 "$TARGET_PLIST"

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$TARGET_PLIST"
launchctl enable "gui/$(id -u)/$LABEL"
launchctl kickstart -k "gui/$(id -u)/$LABEL"

echo "Friendy sensor LaunchAgent installed and started: $TARGET_PLIST"
echo "Logs: $LOG_DIR/friendy-sensor.log and $LOG_DIR/friendy-sensor.error.log"
