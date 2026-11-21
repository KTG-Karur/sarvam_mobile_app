#!/bin/bash
set -e

# Read version name from pubspec.yaml (e.g. "1.0.9+9" → "1.0.9")
VERSION=$(grep "^version:" pubspec.yaml | sed 's/version: //' | cut -d'+' -f1 | tr -d '[:space:]')
APK_NAME="sarvam_v_${VERSION}.apk"
APK_REPO="https://github.com/KTG-Karur/sarvam_mobile_apk.git"
TMP_DIR="/tmp/sarvam_apk_publish"

echo "▶ Building release APK for version $VERSION..."
flutter build apk --release

SOURCE_APK="build/app/outputs/flutter-apk/app-release.apk"

if [ ! -f "$SOURCE_APK" ]; then
  echo "❌ APK not found at $SOURCE_APK"
  exit 1
fi

echo "▶ Cloning APK repository..."
rm -rf "$TMP_DIR"
git clone "$APK_REPO" "$TMP_DIR"

echo "▶ Copying APK as $APK_NAME..."
cp "$SOURCE_APK" "$TMP_DIR/$APK_NAME"

cd "$TMP_DIR"
git add "$APK_NAME"
git commit -m "Release $APK_NAME"
git push origin main

cd -
rm -rf "$TMP_DIR"

echo "✅ $APK_NAME published to $APK_REPO"
