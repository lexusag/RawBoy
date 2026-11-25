# Signing and notarizing RawBoy Desktop (macOS DMG)

`.github/workflows/release.yml` (the `desktop` job) builds `RawBoy-Desktop-<tag>.dmg`, signs the app and disk image with your **Developer ID Application** certificate, submits the DMG to Apple's notary service (`xcrun notarytool`), staples the notarization ticket (`xcrun stapler`), and attaches it to the GitHub release.

When the signing secrets are not set, the job falls back to an ad-hoc signed, unnotarized DMG (which Gatekeeper blocks on first launch).

## How it fits together

- **Developer ID Application certificate.** Distribution outside the Mac App Store requires a **Developer ID Application** certificate from a paid Apple Developer Program membership (not *Apple Development* or *Mac App Distribution*). It lasts 5 years and is exported with its private key as a password-protected `.p12` file.
- **Hardened Runtime (no App Sandbox).** Apple notarization requires Hardened Runtime (`--options runtime`) and a secure timestamp (`--timestamp`) on every executable and framework. App Sandbox stays off (`ENABLE_APP_SANDBOX: NO`) so RawBoy Desktop can keep writing `.xmp` sidecars next to your photos. Because Hardened Runtime turns on Library Validation, all embedded frameworks (`RawBoyEngine.framework`, `RawBoyNative.framework`, `RawBoyJpeg.framework`) are signed with the same Developer ID certificate before the `.app` bundle itself is signed (inside-out signing).
- **Notarization via App Store Connect API key.** `xcrun notarytool` authenticates with an App Store Connect API key (`.p8` file, Key ID, Issuer ID). Unlike an Apple ID + app-specific password, an API key is not tied to your personal login and does not break when you change your Apple ID password.
- **Stapling.** Once Apple returns `Accepted`, `xcrun stapler staple` attaches the notarization ticket directly to the `.dmg` so Gatekeeper can verify it offline when a user downloads and opens it.

## One-time setup

### 1. Create and export a Developer ID Application certificate

On your Mac (signed in with your paid Apple Developer Program account):

1. Open **Xcode → Settings → Accounts**, select your Apple ID and your paid team, and click **Manage Certificates…**.
2. Click **+** and choose **Developer ID Application**. Xcode creates the certificate and stores it with its private key in your login keychain.
   *(Alternative without Xcode: create a Certificate Signing Request in Keychain Access → Certificate Assistant → Request a Certificate From a Certificate Authority, upload it at [developer.apple.com/account/resources/certificates/add](https://developer.apple.com/account/resources/certificates/add) under **Developer ID Application**, download the `.cer`, and double-click it to import it into your login keychain.)*
3. Open **Keychain Access**, select **login** (left sidebar) → **My Certificates** (top tab), and find `Developer ID Application: <Your Name> (<TEAMID>)`.
4. Expand the disclosure triangle to confirm the private key is nested under it.
5. Select the certificate, right-click → **Export "Developer ID Application: …"**, choose **Personal Information Exchange (.p12)**, save it as `rawboy-dev-id.p12`, and set a strong export password.
   *(Keep a backup of this `.p12` and its password in a password manager; Apple limits how many Developer ID certificates an account can create, and you cannot re-download the private key from Apple.)*
6. Base64-encode the `.p12` for GitHub Secrets:
   ```sh
   base64 -i rawboy-dev-id.p12 | pbcopy
   ```

### 2. Create an App Store Connect API key for notarization

1. Open [appstoreconnect.apple.com](https://appstoreconnect.apple.com) → **Users and Access → Integrations → App Store Connect API**.
2. Under **Team Keys**, click **+** (Generate API Key):
   - **Name:** `GitHub Notarization` (or similar)
   - **Access:** **Developer**
3. Copy the **Issuer ID** shown at the top of the page and the **Key ID** of the new key.
4. Click **Download** next to the key to save `AuthKey_<KEYID>.p8`. **You can only download a `.p8` file once** — store it safely alongside your `.p12`.
5. Base64-encode the `.p8` for GitHub Secrets:
   ```sh
   base64 -i AuthKey_<KEYID>.p8 | pbcopy
   ```

### 3. Add the GitHub repository secrets

Repository → **Settings → Secrets and variables → Actions → New repository secret**:

| Secret | Value |
| --- | --- |
| `MACOS_CERT_P12` | base64 of `rawboy-dev-id.p12` |
| `MACOS_CERT_PASSWORD` | password you chose when exporting the `.p12` |
| `APPLE_NOTARY_KEY` | base64 of `AuthKey_<KEYID>.p8` |
| `APPLE_NOTARY_KEY_ID` | the 10-character Key ID from App Store Connect |
| `APPLE_NOTARY_ISSUER_ID` | the UUID Issuer ID from App Store Connect |

You do not need a separate secret for the signing identity name: the workflow reads the `Developer ID Application: …` identity directly from the imported `.p12`.

## Releasing via CI

- **Automatic:** publishing a GitHub release (tag `vX.Y.Z`) dispatches `.github/workflows/release.yml`, whose `desktop` job builds, signs, notarizes, staples, verifies, and uploads `RawBoy-Desktop-vX.Y.Z.dmg` to the release.
- **Re-signing / rebuilding only the DMG for an existing release:** Actions → **Release RawBoy** → **Run workflow**, enter the existing tag (e.g. `v1.6.2`), and tick **Skip building the APKs** (leave **Skip building RawBoy Desktop's DMG** unticked).
- **Safety check:** if `MACOS_CERT_P12` is set, the job requires all four remaining secrets and fails if signing or notarization fails, so a misconfiguration never silently uploads an unnotarized DMG. If `MACOS_CERT_P12` is unset, it falls back to an ad-hoc signed DMG with a warning.

## Building, signing, and notarizing locally on a Mac

If you ever need to produce a signed and notarized DMG from your own Mac (assuming the Developer ID Application certificate is already in your login keychain):

```sh
# 1. Build native libraries (macOS slice) and generate the Xcode project
ios/native/build.sh macos
(cd ios && xcodegen)

# 2. Build Release
TAG=v1.6.2
xcodebuild build -project ios/RawBoy.xcodeproj -scheme RawBoyDesktop \
  -configuration Release -destination 'platform=macOS' \
  -derivedDataPath ios/build/dd \
  MARKETING_VERSION="${TAG#v}" CURRENT_PROJECT_VERSION=1

# 3. Sign inside-out (embedded frameworks first, then the app bundle)
IDENTITY=$(security find-identity -v -p codesigning | sed -n 's/.*"\(Developer ID Application: [^"]*\)".*/\1/p' | head -n 1)
APP="ios/build/dd/Build/Products/Release/RawBoy Desktop.app"

find "$APP/Contents/Frameworks" -maxdepth 1 \( -name "*.dylib" -o -name "*.framework" \) -print0 | \
  while IFS= read -r -d '' item; do
    codesign --force --timestamp --options runtime --sign "$IDENTITY" "$item"
  done
codesign --force --timestamp --options runtime --sign "$IDENTITY" "$APP"
codesign --verify --deep --strict --verbose=2 "$APP"

# 4. Pack and sign the DMG
rm -rf dist dmg && mkdir -p dist dmg
ditto "$APP" "dmg/RawBoy Desktop.app"
ln -s /Applications dmg/Applications
DMG="dist/RawBoy-Desktop-$TAG.dmg"
hdiutil create -volname "RawBoy Desktop" -srcfolder dmg -ov -format UDZO "$DMG"
codesign --force --timestamp --sign "$IDENTITY" "$DMG"

# 5. Notarize and staple (store credentials once with `xcrun notarytool store-credentials`)
xcrun notarytool submit "$DMG" \
  --key ~/keys/AuthKey_<KEYID>.p8 --key-id <KEYID> --issuer <ISSUER_ID> --wait
xcrun stapler staple "$DMG"
xcrun stapler validate "$DMG"
spctl --assess --type open --context context:primary-signature --verbose "$DMG"
```

## Troubleshooting

- **`No 'Developer ID Application' certificate found in MACOS_CERT_P12`:** you exported an *Apple Development* or *Mac App Distribution* certificate, or exported the certificate without its private key. Re-export from **My Certificates** in Keychain Access with the private key included.
- **Notarization status `Invalid`:** the CI job automatically prints the full JSON log from `xcrun notarytool log <submission-id>` in the step output. The most common causes are a nested binary missing `--timestamp` or `--options runtime`, or an unsigned framework.
- **Notarization timed out after 15m (`In Progress`):** Apple often holds the very first submission on a brand-new Developer ID for several hours. The job stops waiting at 15 minutes so it doesn't burn runner minutes; check status locally with `xcrun notarytool info <submission-id> --key ...` (or `xcrun notarytool history ...`) and re-run the workflow once Apple marks it `Accepted`.
- **Certificate renewal:** Developer ID Application certificates expire after 5 years. Existing notarized DMGs keep working because they carry a secure timestamp; create a new certificate, export a new `.p12`, and update `MACOS_CERT_P12` and `MACOS_CERT_PASSWORD`.
