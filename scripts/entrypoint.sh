#!/bin/sh
set -e
# When Railway mounts a volume at /paperclip it is often not writable by the node user.
# Create dirs Paperclip needs and ensure the whole tree is owned by node.
mkdir -p /paperclip/instances/default/logs

# Write opencode config for minimax (Anthropic-compatible) if not already present.
# ANTHROPIC_API_KEY and ANTHROPIC_BASE_URL are set as Railway env vars.
OPENCODE_CFG_DIR="${XDG_CONFIG_HOME:-/paperclip/.config}/opencode"
OPENCODE_CFG_FILE="$OPENCODE_CFG_DIR/opencode.json"
mkdir -p "$OPENCODE_CFG_DIR"
cat > "$OPENCODE_CFG_FILE" << EOJSON
{
  "\$schema": "https://opencode.ai/config.json",
  "provider": {
    "minimax": {
      "npm": "@ai-sdk/anthropic",
      "options": {
        "baseURL": "https://api.minimax.io/anthropic/v1",
        "apiKey": "${ANTHROPIC_API_KEY}"
      },
      "models": {
        "MiniMax-M2.7": {
          "name": "MiniMax-M2.7"
        }
      }
    }
  }
}
EOJSON
echo "[entrypoint] wrote opencode config to $OPENCODE_CFG_FILE"

chown -R node:node /paperclip
exec gosu node "$@"
