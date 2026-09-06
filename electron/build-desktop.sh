#!/usr/bin/env bash
# Build the Windows desktop (Electron) distribution from Linux.
# Produces: desktop-dist/win-unpacked  (runnable on Windows, portable)
set -euo pipefail
cd "$(dirname "$0")/.."

echo "[1/6] Building Next.js standalone (NEXT_DIST_DIR=.next-electron — isolated from dev server)..."
export NEXT_DIST_DIR=.next-electron
export NODE_ENV=production
export NEXT_TELEMETRY_DISABLED=1

echo "[1b/6] Generating SECOND Prisma client (provider=mysql) for host-connection mode..."
# The default client stays SQLite (local/offline mode). This second client is
# what src/lib/db.ts switches to at runtime when DATABASE_URL starts with mysql:
# — without it, every save in host mode fails ("data is not added" bug ≤ v1.0.4).
DATABASE_URL="mysql://build:build@localhost:3306/build" bunx prisma generate \
  --schema prisma/schema.mysql.prisma \
  --generator clientDesktop
test -f node_modules/prisma-mysql-client/index.js || { echo "FAIL: mysql client not generated"; exit 1; }
test -f node_modules/prisma-mysql-client/query_engine-windows.dll.node \
  || { echo "FAIL: windows mysql engine missing from generated client"; exit 1; }
echo "  OK: prisma-mysql-client ready (index.js + query_engine-windows.dll.node)"

if [ "${DESKTOP_SKIP_NEXT_BUILD:-0}" = "1" ]; then
  echo "  next build skipped (DESKTOP_SKIP_NEXT_BUILD=1)"
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

echo "[3b/6] Shipping MySQL Prisma client into packaged server..."
# src/lib/db.ts requires this folder at runtime when DATABASE_URL is mysql:
rm -rf desktop-dist/win-unpacked/resources/server/node_modules/prisma-mysql-client
cp -a node_modules/prisma-mysql-client desktop-dist/win-unpacked/resources/server/node_modules/
test -f desktop-dist/win-unpacked/resources/server/node_modules/prisma-mysql-client/index.js \
  && echo "  OK: prisma-mysql-client in packaged server" \
  || { echo "FAIL: prisma-mysql-client NOT in packaged server"; exit 1; }
test -f desktop-dist/win-unpacked/resources/server/node_modules/prisma-mysql-client/query_engine-windows.dll.node \
  && echo "  OK: windows mysql engine present in packaged server" \
  || { echo "FAIL: windows mysql engine NOT in packaged server"; exit 1; }

echo "[4/6] Preparing bundled demo database..."
mkdir -p desktop-assets/demo-db
cp db/custom.db desktop-assets/demo-db/custom.db

echo "[5/6] Packaging with electron-builder (win dir target)..."
bunx electron-builder --win dir --config electron-builder.yml

echo "[5b/6] Copying standalone server into win-unpacked (cp -a keeps hidden dirs + node_modules)..."
rm -rf desktop-dist/win-unpacked/resources/server
cp -a .next-electron/standalone desktop-dist/win-unpacked/resources/server
# Prune junk that Next's file tracing may have pulled in from the project root
# (build artifacts, docs, logs — the packaged server needs only its runtime).
(
  cd desktop-dist/win-unpacked/resources/server
  rm -rf download desktop-dist skills tool-results tests examples mini-services src electron .zscripts .agent-ctx db 2>/dev/null || true
  rm -f dev.log server.log .env 2>/dev/null || true
)
# Defensive: main.js uses only node builtins — no deps may ship in resources/app
rm -rf desktop-dist/win-unpacked/resources/app/node_modules

# CRITICAL (v1.0.4 fix): the packaged package.json MUST carry productName.
# Without it Electron derives the per-user data dir from `name`
# (nextjs_tailwind_shadcn_ts) instead of %APPDATA%\ManufacturingERP — which is
# exactly why users could not find db-connection.txt. Patch it here so the
# shipped app ALWAYS resolves userData to %APPDATA%\ManufacturingERP.
node -e '
const fs = require("fs");
const p = "desktop-dist/win-unpacked/resources/app/package.json";
const j = JSON.parse(fs.readFileSync(p, "utf8"));
if (j.productName !== "ManufacturingERP") {
  j.productName = "ManufacturingERP";
  fs.writeFileSync(p, JSON.stringify(j, null, 2) + "\n", "utf8");
  console.log("  patched productName into packaged package.json");
}
'
node -e '
const j = JSON.parse(require("fs").readFileSync("desktop-dist/win-unpacked/resources/app/package.json", "utf8"));
if (j.productName !== "ManufacturingERP") { console.error("FAIL: packaged productName missing"); process.exit(1); }
console.log("  OK: packaged productName = " + j.productName + " (userData = %APPDATA%\\ManufacturingERP)");
'

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
