#!/bin/bash
# Diagnostic: can we write a file inside Slack.app's Resources dir with sudo?
set -e
SLACK="$HOME/Applications/Slack.app/Contents/Resources"
TEST="$SLACK/test-uber-write"

echo "Attempting: sudo cp $SLACK/app-arm64.asar $TEST"
sudo cp "$SLACK/app-arm64.asar" "$TEST"
echo "✓ Write succeeded."
ls -la "$TEST"
sudo rm "$TEST"
echo "✓ Cleanup succeeded. Direct sudo works — TCC is NOT blocking interactive sudo writes."
