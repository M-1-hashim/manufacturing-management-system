#!/usr/bin/env bash
# Build the Windows desktop (Electron) distribution from Linux.
# Produces: desktop-dist/win-unpacked  (runnable on Windows, portable)
set -euo pipefail
cd "$(dirname "$0")/.."

echo "[1/6] Building Next.js standalone (NEXT_DIST_DIR=.next-electron — isolated from dev server)..."
export NEXT_DIST_DIR=.next-electron
export NODE_ENV=production
export NEXT_TELEMETRY_DISABLED=1
if [ "${DESKTOP_SKIP_NEXT_BUILD:-0}" = "1" ]; then
  echo "  skipped (DESKTOP_SKIP_NEXT_BUILD=1)"
else
  bunx next build
fi

echo "[2/6] Copying static assets into standalone..."
# Next 16 keeps the distDir name inside standalone: standalone/.next-electron
rm -rf .next-electron/standalone/.next-electron/static
cp -r .next-electron/static .next-electron/standalone/.next-electron/static
rm -rf .next-electron/standalone/public
cp -r public .next-electron/standalone/public
# Never ship the Linux .env (absolute DATABASE_URL) or a stray traced db copy;
# electron/main.js always injects the correct DATABASE_URL at runtime.
rm -f .next-electron/standalone/.env
rm -rf .next-electron/standalone/db

echo "[3/6] Ensuring Prisma Windows engine inside standalone..."
mkdir -p .next-electron/standalone/node_modules/.prisma/client
if cp node_modules/.prisma/client/query_engine-windows.dll.node .next-electron/standalone/node_modules/.prisma/client/ 2>/dev/null; then
  echo "  OK: query_engine-windows.dll.node copied"
else
  echo "WARN: windows engine copy failed"
fi

echo "[4/6] Preparing bundled demo database..."
mkdir -p desktop-assets/demo-db
cp db/custom.db desktop-assets/demo-db/custom.db

echo "[5/6] Packaging with electron-builder (win dir target)..."
bunx electron-builder --win dir --config electron-builder.yml

echo "[5b/6] Copying standalone server into win-unpacked (cp -a keeps hidden dirs + node_modules)..."
rm -rf desktop-dist/win-unpacked/resources/server
cp -a .next-electron/standalone desktop-dist/win-unpacked/resources/server
# Defensive: main.js uses only node builtins — no deps may ship in resources/app
rm -rf desktop-dist/win-unpacked/resources/app/node_modules

echo "[6/6] Verifying output..."
ls -la desktop-dist/win-unpacked | head -25
test -f desktop-dist/win-unpacked/resources/server/server.js && echo "OK: server.js in place" || echo "FAIL: server.js missing"
test -d desktop-dist/win-unpacked/resources/server/.next-electron/static && echo "OK: static assets in place" || echo "FAIL: static assets missing"
test -d desktop-dist/win-unpacked/resources/server/node_modules/next && echo "OK: node_modules in place" || echo "FAIL: node_modules missing"
test -f desktop-dist/win-unpacked/resources/server/node_modules/.prisma/client/query_engine-windows.dll.node \
  && echo "OK: windows prisma engine present in packaged server" \
  || echo "WARN: windows prisma engine MISSING from packaged server"
du -sh desktop-dist/win-unpacked
echo "BUILD DONE: desktop-dist/win-unpacked"
