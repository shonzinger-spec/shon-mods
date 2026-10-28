#!/bin/sh
# Uninstalls memory-guard. Removes nothing else except (optionally) state/.
DIR="$(cd "$(dirname "$0")" && pwd)"
claude plugin uninstall memory-guard@shon-mods
printf 'Also delete %s/state (alert + log history)? [y/N] ' "$DIR"
read -r ans
case "$ans" in
  y|Y) rm -rf "$DIR/state" && echo "removed $DIR/state" ;;
  *) echo "kept $DIR/state" ;;
esac
