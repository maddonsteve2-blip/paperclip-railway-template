#!/bin/sh
set -e
# When Railway mounts a volume at /paperclip it is often not writable by the node user.
# Create dirs Paperclip needs and ensure the whole tree is owned by node.
mkdir -p /paperclip/instances/default/logs

# Write opencode config so the built-in anthropic provider points to minimax.
node -e "
const fs = require('fs');
const baseURL = process.env.ANTHROPIC_BASE_URL || 'https://api.minimax.io/anthropic/v1';
const cfg = { provider: { anthropic: { options: { baseURL }, models: { 'MiniMax-M2.7': { name: 'MiniMax-M2.7' } } } } };
const dir = (process.env.XDG_CONFIG_HOME || '/paperclip/.config') + '/opencode';
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(dir + '/opencode.json', JSON.stringify(cfg, null, 2));
console.log('[entrypoint] wrote opencode config to ' + dir + '/opencode.json');
"

chown -R node:node /paperclip
exec gosu node "$@"
