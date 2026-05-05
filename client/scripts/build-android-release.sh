#!/bin/bash
set -e

# Build a signed release APK for Android
# Prerequisites: Java 17+, Android SDK (ANDROID_HOME set)

cd "$(dirname "$0")/.."

echo "📱 Syncing web to Android..."
npm run mobile:sync:android

echo "🔑 Setting up signing..."

# Copy keystore and properties into android/ (gitignored dir)
cp memorains.keystore android/
cp keystore.properties android/
cp ci/signing.gradle android/app/

# Append signing.gradle to build.gradle (idempotent)
BUILD_GRADLE="android/app/build.gradle"
if ! grep -q "apply from: 'signing.gradle'" "$BUILD_GRADLE"; then
    echo "" >> "$BUILD_GRADLE"
    echo "apply from: 'signing.gradle'" >> "$BUILD_GRADLE"
fi

echo "🔨 Building release APK..."
cd android
./gradlew assembleRelease
cd ..

# Copy APK to output
mkdir -p built-apk
cp android/app/build/outputs/apk/release/app-release.apk built-apk/memorains-release.apk

echo ""
echo "✅ Signed release APK: built-apk/memorains-release.apk"
ls -lh built-apk/memorains-release.apk
