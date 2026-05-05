## Run client as DEV
```
npm install
npm run dev
```


## Electron

Run in dev:
```
npm run desktop:build:html
npm run desktop:dev
```

Make the package:
```
npm run desktop:make
```


## Mobile (Capacitor)

The mobile app wraps the web frontend using [Capacitor](https://capacitorjs.com/), similar to how Electron wraps it for desktop.

Service worker and PWA-specific paths are disabled in mobile builds; the app loads local files with a relative `./` base path. The API host is configured via localStorage (`memo_note_host` key), same as Electron.

### Prerequisites

- **Android**: [Android Studio](https://developer.android.com/studio) with an Android SDK and emulator or device.
- **iOS** (future): Xcode with a macOS machine.

### Setup (one-time)

```bash
cd client
npm install

# Build the web app for Capacitor
npm run mobile:build

# Add Android platform
npx cap add android

# (Future) Add iOS platform
# npx cap add ios
```

### Development

```bash
# Build web app, sync to Android, and open in Android Studio
npm run mobile:open:android

# Or sync and run directly on a connected device/emulator
npm run mobile:run:android
```

You can also run from Android Studio: open `client/android/` as a project, then use **Run** (▶) to build and launch.

#### Build APK from command line (no Android Studio)

```bash
cd client/android
./gradlew assembleDebug
# APK output: android/app/build/outputs/apk/debug/app-debug.apk

# For a release build (requires signing config):
# ./gradlew assembleRelease
```

### iOS (future)

```bash
npm run mobile:open:ios
```

### Rebuild after code changes

```bash
npm run mobile:sync:android   # rebuild + sync Android
# or
npm run mobile:sync:ios       # rebuild + sync iOS
```

### Connecting to a custom server

In the mobile app, the host setting is available in the side menu. Set your server host there (saved in localStorage), or set it before launching:

```js
localStorage.setItem("memo_note_host", "your-server.com");
```
