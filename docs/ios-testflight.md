# Publishing RawBoy Camera to TestFlight (iOS)

`.github/workflows/testflight.yml` ("Publish to TestFlight") archives `RawBoyCamera` for iOS, cloud-signs it for App Store Connect / TestFlight, and uploads it. It never runs by itself — only when you start it manually from the Actions tab (just like `play.yml` for Google Play).

## How it fits together

- **Versioning.** `MARKETING_VERSION` comes from the `version` workflow input (e.g. `1.0` or `1.6.2`; a leading `v` is stripped if passed). `CURRENT_PROJECT_VERSION` uses `build_number` if provided, or `GITHUB_RUN_NUMBER` otherwise, so every run gets a strictly higher build number automatically. `manageAppVersionAndBuildNumber` is set to `false` in `ExportOptions.plist` so Xcode keeps these exact values.
- **Cloud-managed distribution signing.** `xcodebuild archive` runs with `CODE_SIGNING_ALLOWED=NO` (no Apple Development certificate needed on the runner), and `xcodebuild -exportArchive` uses `-allowProvisioningUpdates` with an App Store Connect API key (`method: app-store-connect`, `destination: upload`, `signingStyle: automatic`). Apple manages the distribution certificate and provisioning profile automatically — no `.p12` or `.mobileprovision` secrets to export or renew.
- **Internal vs. closed testing.** The **TestFlight distribution** input defaults to `internal` (`testFlightInternalTestingOnly: true` — internal testers only, not eligible for external groups or App Store submission). Pick `closed` (`testFlightInternalTestingOnly: false`) when you want a build eligible for closed/external TestFlight groups or App Store submission.

## One-time setup

### 1. Create an App Store Connect API key

1. Open [appstoreconnect.apple.com](https://appstoreconnect.apple.com) → **Users and Access → Integrations → App Store Connect API**.
2. Under **Team Keys**, click **+** (Generate API Key):
   - **Name:** `GitHub TestFlight` (or similar)
   - **Access:** **Admin** *(required for cloud-managed distribution signing; Developer and App Manager keys fail with `Cloud signing permission error`)*
3. Copy the **Issuer ID** shown at the top of the page and the **Key ID** of the new key.
4. Click **Download** next to the key to save `AuthKey_<KEYID>.p8`. **You can only download a `.p8` file once** — keep a backup in a password manager.
5. Base64-encode the `.p8` for GitHub Secrets:
   ```sh
   base64 -i AuthKey_<KEYID>.p8 | pbcopy
   ```

### 2. Add the GitHub repository secrets

The workflow checks `APP_STORE_CONNECT_*` first and falls back to the existing `APPLE_NOTARY_*` secrets from [macos-release.md](macos-release.md). If your existing `APPLE_NOTARY_*` key already has **Admin** access in App Store Connect, you don't need to add any new secrets.

Otherwise, either replace `APPLE_NOTARY_*` with an **Admin** key (it works for macOS notarization too), or add separate secrets under Repository → **Settings → Secrets and variables → Actions → New repository secret**:

| Secret | Value |
| --- | --- |
| `APP_STORE_CONNECT_KEY` | base64 of `AuthKey_<KEYID>.p8` (optional; falls back to `APPLE_NOTARY_KEY`) |
| `APP_STORE_CONNECT_KEY_ID` | the 10-character Key ID (optional; falls back to `APPLE_NOTARY_KEY_ID`) |
| `APP_STORE_CONNECT_ISSUER_ID` | the UUID Issuer ID (optional; falls back to `APPLE_NOTARY_ISSUER_ID`) |

## Running it

Actions → **Publish to TestFlight** → **Run workflow**:

| Field | What to put |
| --- | --- |
| Use workflow from | the branch or tag to build (`main`, or a release tag such as `v1.6.2`) |
| Version | marketing version shown to users, e.g. `1.0` or `1.6.2` |
| Build number | leave empty to use the GitHub run number, or enter a positive integer to override it |
| TestFlight distribution | `internal` (default, internal testers only) or `closed` (eligible for closed/external testing & App Store) |

## Troubleshooting

- **`Cloud signing permission error` during `-exportArchive`:** verify the key's role in App Store Connect is **Admin** (neither **Developer** nor **App Manager** is sufficient for cloud-managed distribution signing), and that `APP_STORE_CONNECT_*` secrets are set if `APPLE_NOTARY_*` uses a lower-privilege key.
- **Duplicate build number:** if you uploaded a higher build number manually from Xcode for the same marketing version, pass a higher **Build number** in the workflow input (or bump the marketing version).
