# Building RawBoy

## Building

Needs Android Studio (Ladybug or newer) with **NDK 27.2** and **CMake 3.22.1** from the SDK Manager.
Open the folder and let Gradle sync. The first native build downloads LibRaw and needs network access.
Command line: `./gradlew :app-pro:assembleDebug` (RawBoy), `./gradlew :app-auto:assembleDebug` (RawBoy Auto), or `./gradlew :app-camera:assembleDebug` (RawBoy Camera). The Gradle daemon is pinned to JDK 21 (`gradle/gradle-daemon-jvm.properties`), because Gradle 8.11 can't run on the Java 25 that Android Studio bundles.

minSdk 29 (Android 10). No storage permissions needed: input comes through the system picker or "Open with",
and output goes through MediaStore.

The iOS apps are built with Xcode on a Mac: see [Installing on your iPhone](ios-install.md).

## Release build

1. Create a signing key once (keep the file and passwords safe; you need the same key for every update):
   ```
   keytool -genkeypair -v -keystore ~/keys/rawboy-release.jks -alias rawboy -keyalg RSA -keysize 4096 -validity 10000
   ```
2. Create `keystore.properties` in the repo root (git-ignored):
   ```
   storeFile=/Users/<you>/keys/rawboy-release.jks
   storePassword=...
   keyAlias=rawboy
   keyPassword=...
   ```
3. Put the Adobe DNG SDK in `third_party/dng_sdk` ([third_party/README.md](../third_party/README.md)): release builds
   fail without it (debug builds don't need it).
4. Build:
   - APK to install directly: `./gradlew :app-pro:assembleRelease` → `app-pro/build/outputs/apk/release/app-pro-release.apk`
     (RawBoy Auto: `:app-auto:assembleRelease` → `app-auto/build/outputs/apk/release/app-auto-release.apk`)
   - Bundle for Google Play: `./gradlew :app-pro:bundleRelease` → `app-pro/build/outputs/bundle/release/app-pro-release.aab`
     (likewise `:app-auto:bundleRelease`)
   - Build all: `./gradlew :app-pro:assembleRelease :app-auto:assembleRelease :app-camera:assembleRelease`
     (camera APKs: `app-camera/build/outputs/apk/{standard,film}/release/app-camera-{standard,film}-release.apk`)

   Both apps are signed with the same `keystore.properties`.

   Release builds are minified with R8 and resource-shrunk. Without `keystore.properties`, you get `app-release-unsigned.apk`, which Android won't install.

   On GitHub, publishing a release runs `.github/workflows/release.yml`, which builds the three apps signed with the
   `KEYSTORE_FILE` (base64 .jks) and `KEYSTORE_PASS` secrets and attaches the APKs to the release. The version
   comes from the tag: `vX.Y.Z` → versionName `X.Y.Z`, versionCode `X*10000 + Y*100 + Z` (Y and Z below 100; each
   release's tag must be higher than the last). Local builds use `rawboy.versionName`/`rawboy.versionCode` from
   `gradle.properties`. Google Play bundles are built and uploaded by a separate, manually started workflow: see
   [Publishing to Google Play](google-play.md).
