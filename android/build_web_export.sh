#!/usr/bin/env bash
# ------------------------------------------------------------
# بیلد استاتیک وب برای باندل داخل APK اندروید (نسخهٔ مستقل آفلاین)
# ------------------------------------------------------------
# 1. فایل‌های سمت سرور (api routes / middleware / instrumentation)
#    موقتاً کنار گذاشته می‌شوند چون در حالت محلی وجود ندارند.
# 2. next build با output=export و NEXT_PUBLIC_LOCAL_MODE=1 اجرا می‌شود
#    (موتور API محلی + دیتابیس localStorage در باندل فعال می‌شود).
# 3. خروجی export (در همان distDir = .next-apk) در android/assets/app کپی می‌شود.
# 4. همه‌چیز برگردانده می‌شود (حتی در صورت خطا — trap).
set -euo pipefail
cd "$(dirname "$0")/.."

STASH=".apk-build-stash"
OUT=".next-apk"

cleanup() {
  # بازگرداندن فایل‌های موقت
  if [ -d "$STASH/api" ]; then rm -rf src/app/api; mv "$STASH/api" src/app/api; fi
  if [ -f "$STASH/middleware.ts" ]; then mv "$STASH/middleware.ts" src/middleware.ts; fi
  if [ -f "$STASH/instrumentation.ts" ]; then mv "$STASH/instrumentation.ts" src/instrumentation.ts; fi
  rm -rf "$STASH"
}
trap cleanup EXIT

# --- پاک‌سازی قبلی ---
rm -rf "$STASH" "$OUT" android/assets/app

# --- کنار گذاشتن فایل‌های سمت سرور ---
mv src/app/api "$STASH-api-tmp" && mkdir -p "$STASH" && mv "$STASH-api-tmp" "$STASH/api"
mv src/middleware.ts "$STASH/middleware.ts"
mv src/instrumentation.ts "$STASH/instrumentation.ts"

echo "▶ building static export (LOCAL_MODE) ..."
NEXT_EXPORT=1 \
NEXT_PUBLIC_LOCAL_MODE=1 \
NEXT_DIST_DIR="$OUT" \
bunx next build

echo "▶ copying $OUT → android/assets/app"
mkdir -p android/assets/app
cp -r "$OUT"/. android/assets/app/
# فایل‌های سرور-محور که در نسخهٔ مستقل بی‌استفاده‌اند — برای سبک ماندن APK حذف می‌شوند
rm -f android/assets/app/mfg-erp.apk android/assets/app/mysql-schema.sql \
      android/assets/app/hosting-guide.md android/assets/app/robots.txt
echo "✅ export done: android/assets/app ($(du -sh android/assets/app | cut -f1))"
