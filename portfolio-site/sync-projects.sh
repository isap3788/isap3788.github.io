#!/bin/sh
# Refresh the live project copies the portfolio embeds.
# Run from anywhere: sh portfolio/sync-projects.sh
set -e
cd "$(dirname "$0")/.."
rm -rf portfolio/projects/backin portfolio/projects/creature-clash
mkdir -p portfolio/projects
cp -R backin-site portfolio/projects/backin
cp -R creature-clash portfolio/projects/creature-clash
rm -f portfolio/projects/creature-clash/README.md
# Public copy: switch off the DEV badge and developer console, even on localhost.
sed -i.bak 's/^export const DEV_BUILD = .*/export const DEV_BUILD = false;/' portfolio/projects/creature-clash/js/profile.js
rm -f portfolio/projects/creature-clash/js/profile.js.bak
echo "Synced BackIn and Creature Clash into portfolio/projects/"
