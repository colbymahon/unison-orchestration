#!/usr/bin/env bash
# Unison Frontend Dev Server
# Runs Next.js with explicit NODE_PATH to prevent PostCSS module resolution
# failures when the project lives on an external volume.
set -e
cd "$(dirname "$0")"
NODE_PATH="$(pwd)/node_modules" npm run dev
