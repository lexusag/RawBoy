# Releasing RawBoy Camera to TestFlight (iOS)

`.github/workflows/release.yml` (the `ios-testflight` job) archives `RawBoyCamera` for iOS, cloud-signs it for App Store Connect / TestFlight, and uploads it automatically whenever a GitHub release is published.

When `APP_STORE_CONNECT_KEY` is not set, the job skips with a warning so GitHub releases keep working before the secrets are configured.

## How it fits together

- **Versioning.** `MARKETING_VERSION` comes from the release tag (`v1.6.2` → `1.6.2`), and `CURRENT_PROJECT_VERSION` uses `GITHUB_RUN_NUMBER`, so every release (and any manual re-dispatch for the same tag) gets a strictly higher build number automatically. `manageAppVersionAndBuildNumber` is set to `false` in `ExportOptions.plist` so Xcode keeps these exact values.
- **Cloud-managed distribution signing.** `xcodebuild archive` runs with `CODE_SIGNING_ALLOWED=NO` (no Apple Development certificate needed on the runner), and `xcodebuild -exportArchive` uses `-allowProvisioningUpdates` with an App Store Connect API key (`method: app-store-connect`, `destination: upload`, `signingStyle: automatic`). Apple manages the distribution certificate and provisioning profile automatically — no `.p12` or `.mobileprovision` secrets to export or renew.
- **External TestFlight eligible.** `testFlightInternalOnly` is off, so every uploaded build can be distributed to both Internal and External Testing groups (and submitted to the App Store).

## One-time setup

### 1. Create an App Store Connect API key

1. Open [appstoreconnect.apple.com](https://appstoreconnect.apple.com) → **Users and Access → Integrations → App Store Connect API**.
2. Under **Team Keys**, click **+** (Generate API Key):
   - **Name:** `GitHub TestFlight` (or similar)
   - **Access:** **App Manager** *(required for cloud-managed distribution signing; a Developer-only key is not sufficient)*
3. Copy the **Issuer ID** shown at the top of the page and the **Key ID** of the new key.
4. Click **Download** next to the key to save `AuthKey_<KEYID>.p8`. **You can only download a `.p8` file once** — keep a backup in a password manager.
5. Base64-encode the `.p8` for GitHub Secrets:
   ```sh
   base64 -i AuthKey_<KEYID>.p8 | pbcopy
   ```

### 2. Add the GitHub repository secrets

Repository → **Settings → Secrets and variables → Actions → New repository secret**:

| Secret | Value |
| --- | --- |
| `APP_STORE_CONNECT_KEY` | base64 of `AuthKey_<KEYID>.p8` |
| `APP_STORE_CONNECT_KEY_ID` | the 10-character Key ID from App Store Connect |
| `APP_STORE_CONNECT_ISSUER_ID` | the UUID Issuer ID from App Store Connect |

## Releasing via CI

- **Automatic:** publishing a GitHub release (tag `vX.Y.Z`) dispatches `.github/workflows/release.yml`, whose `ios-testflight` job builds, signs, and uploads `RawBoy Camera` to TestFlight.
- **Manual / TestFlight-only re-upload for an existing tag:** Actions → **Release RawBoy** → **Run workflow**, enter the existing tag (e.g. `v1.6.2`), and tick **Skip building the APKs** and **Skip building RawBoy Desktop's DMG** (leave **Skip uploading RawBoy Camera to TestFlight** unticked). Because `CURRENT_PROJECT_VERSION` uses `GITHUB_RUN_NUMBER`, re-running for the same tag automatically gets a higher build number.

## Troubleshooting

- **API key permission error during `-exportArchive`:** verify the key's role in App Store Connect is **App Manager** (or **Admin**), not **Developer**.
- **Duplicate build number:** if you uploaded a higher build number manually from Xcode for the same `MARKETING_VERSION`, either publish a new tag or let `GITHUB_RUN_NUMBER` exceed it.
