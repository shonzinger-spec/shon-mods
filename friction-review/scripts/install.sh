#!/bin/bash
# Fill the launchd template for this checkout of friction-review and load it (Fridays 17:00 local).
#   install.sh             write ~/Library/LaunchAgents/com.shonmods.friction-review.plist and load it
#   install.sh --no-load   write the plist only
#   install.sh --uninstall unload and remove it
set -euo pipefail

LABEL="com.shonmods.friction-review"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MOD_DIR="$(cd "$HERE/.." && pwd)"
TEMPLATE="$HERE/$LABEL.plist.template"
DEST_DIR="${LAUNCH_AGENTS_DIR:-$HOME/Library/LaunchAgents}"
DEST="$DEST_DIR/$LABEL.plist"
DOMAIN="gui/$(id -u)"

if [ "${1:-}" = "--uninstall" ]; then
  launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
  rm -f "$DEST"
  echo "removed $DEST"
  exit 0
fi

[ -f "$MOD_DIR/scripts/friction/scan.py" ] || { echo "scan.py not found under $MOD_DIR" >&2; exit 1; }
mkdir -p "$DEST_DIR" "$HOME/.claude/friction-review/reports"

tpl="$(cat "$TEMPLATE")"
tpl="${tpl//__MOD_DIR__/$MOD_DIR}"
tpl="${tpl//__HOME__/$HOME}"
printf '%s\n' "$tpl" > "$DEST"
plutil -lint "$DEST"

if [ "${1:-}" = "--no-load" ]; then
  echo "wrote $DEST (not loaded)"
  exit 0
fi
launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
launchctl bootstrap "$DOMAIN" "$DEST"
echo "loaded $LABEL: runs Fridays at 17:00 local; log: $HOME/.claude/friction-review/run.log"
echo "first run may ask permission to show a dialog; run once now with: python3 $MOD_DIR/scripts/friction/scan.py"
