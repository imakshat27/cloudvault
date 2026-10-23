#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# Run from the repository root. Artifacts contain source/dependencies, never .env or user files.
npm ci --prefix frontend
npm run build --prefix frontend
npm ci --prefix backend --omit=dev
rm -rf build/app build/worker
mkdir -p build/app/backend/certs build/app/frontend build/worker/certs
curl --fail --silent --show-error https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem -o build/app/backend/certs/rds.pem
cp -R backend/src backend/package.json backend/package-lock.json backend/node_modules build/app/backend/
cp -R frontend/dist build/app/frontend/
cp -R backend/src backend/package.json backend/package-lock.json backend/node_modules build/worker/
cp build/app/backend/certs/rds.pem build/worker/certs/rds.pem
tar -czf build/app.tar.gz -C build/app .
(cd build/worker && zip -qr ../worker.zip .)
printf 'Artifacts ready: build/app.tar.gz and build/worker.zip\n'
