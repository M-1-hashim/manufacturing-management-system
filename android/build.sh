#!/usr/bin/env bash
# بیلد و امضای app.apk — سِتب نسخهٔ اندروید (بدون Gradle، با build-tools خام)
set -euo pipefail
cd "$(dirname "$0")"

export JAVA_HOME="${JAVA_HOME:-$HOME/jdk21}"
export PATH="$JAVA_HOME/bin:$PATH"

BT="${BT:-$HOME/android-sdk/android-16}"          # build-tools 36 (d8 ≥ 8.10 — با javac 21 سازگار)
PLATFORM="${PLATFORM:-$HOME/android-sdk/android-34/android.jar}"
OUT=build
KEYSTORE=keystore/setab.jks
KS_PASS=setab2024

rm -rf "$OUT"; mkdir -p "$OUT" "$OUT/classes" "$OUT/dex"

echo "[1/6] aapt2 compile resources"
"$BT/aapt2" compile --dir res -o "$OUT/res.zip"

echo "[2/6] aapt2 link"
"$BT/aapt2" link -o "$OUT/base.apk" \
  -I "$PLATFORM" \
  --manifest AndroidManifest.xml \
  --min-sdk-version 24 --target-sdk-version 34 \
  --auto-add-overlay \
  "$OUT/res.zip"

echo "[3/6] javac"
javac --release 8 -encoding UTF-8 -Xlint:-options \
  -classpath "$PLATFORM" \
  -d "$OUT/classes" src/com/setab/erp/MainActivity.java

echo "[4/6] d8 (dex)"
"$BT/d8" --release --lib "$PLATFORM" --min-api 24 \
  --output "$OUT/dex" $(find "$OUT/classes" -name '*.class')
# classes.dex باید در ریشهٔ apk باشد
APK_ABS="$(pwd)/$OUT/base.apk"
(cd "$OUT/dex" && zip -q "$APK_ABS" classes.dex)

echo "[5/6] zipalign"
"$BT/zipalign" -f -p 4 "$OUT/base.apk" "$OUT/aligned.apk"

echo "[6/6] apksigner"
if [ ! -f "$KEYSTORE" ]; then
  mkdir -p keystore
  keytool -genkeypair -keystore "$KEYSTORE" -alias setab \
    -keyalg RSA -keysize 2048 -validity 10000 \
    -storepass "$KS_PASS" -keypass "$KS_PASS" \
    -dname "CN=Setab Manufacturing ERP, O=Setab, C=AF"
fi
"$BT/apksigner" sign --ks "$KEYSTORE" --ks-key-alias setab \
  --ks-pass "pass:$KS_PASS" --key-pass "pass:$KS_PASS" \
  --out app.apk "$OUT/aligned.apk"

"$BT/apksigner" verify --print-certs app.apk | head -5
ls -la app.apk
echo "OK → android/app.apk"
