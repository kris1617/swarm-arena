#!/bin/sh
set -eu
cd /opt/swarm-arena
git pull --ff-only
docker compose build app
docker compose up -d
