#!/bin/bash
set -e

HOST_NAME="com.telemost.transcriber"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HOST_PATH="$SCRIPT_DIR/host.py"

# Detect OS
OS="$(uname -s)"
case "$OS" in
  Linux)
    TARGET_DIR="$HOME/.config/google-chrome/NativeMessagingHosts"
    ;;
  Darwin)
    TARGET_DIR="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
    ;;
  *)
    echo "Error: unsupported OS '$OS'. Use install.bat for Windows."
    exit 1
    ;;
esac

# Get extension ID
if [ -n "$1" ]; then
  EXT_ID="$1"
else
  echo -n "Enter Chrome extension ID: "
  read -r EXT_ID
fi

if [ -z "$EXT_ID" ]; then
  echo "Error: extension ID is required."
  echo "Usage: $0 <extension-id>"
  echo "Find it at chrome://extensions with Developer mode enabled."
  exit 1
fi

# Create target directory if needed
mkdir -p "$TARGET_DIR"

# Generate manifest
MANIFEST_PATH="$TARGET_DIR/$HOST_NAME.json"
cat > "$MANIFEST_PATH" <<EOF
{
  "name": "$HOST_NAME",
  "description": "Telemost Transcriber AI Assistant native host",
  "path": "$HOST_PATH",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://$EXT_ID/"]
}
EOF

# Make host executable
chmod +x "$HOST_PATH"

echo ""
echo "=== Installation complete ==="
echo "Manifest: $MANIFEST_PATH"
echo "Host:     $HOST_PATH"
echo "Extension ID: $EXT_ID"
echo ""
echo "Restart Chrome to activate the native host."
