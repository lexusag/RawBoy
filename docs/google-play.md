# Publishing to Google Play

`.github/workflows/play.yml` ("Publish to Google Play") builds signed Android App Bundles (`.aab`, the format Play
wants instead of APKs) of the apps you tick and uploads them to the Play track you choose. It never runs by itself:
only when you start it from the Actions tab.

## How it fits together

- **Signing.** Play re-signs every app before delivering it to phones ("Play App Signing"). By default Google creates
  that signing key itself when the first bundle of an app is uploaded, and the `rawboy` key (`KEYSTORE_FILE`, the one
  the GitHub APKs are signed with) becomes the *upload key*: the workflow signs the bundle with it and Play checks the
  signature. The apps work the same, but a GitHub APK and the Play version of an app have different signatures, so
  neither updates over the other (switching needs an uninstall). To keep one signature, give Play the `rawboy` key
  as its signing key instead; see step 1, and note it can only be chosen before the app's first upload.
- **Uploading.** Play has an API for releases. The workflow logs in to it as a *service account*: a robot Google
  account whose JSON key is the `PLAY_SERVICE_ACCOUNT_JSON` secret, and which you invite into Play Console like a
  team member, allowed only to release.
- **Versions.** Each upload has a *version name* (what users see, `1.6.2`) and a *version code* (a number Play
  compares; it must be higher than every earlier upload of that app). Leave the code empty and the workflow
  derives it from the name as `release.yml` does from a tag: `X*10000 + Y*100 + Z`, so `1.6.2` → `10602`. A GitHub
  release `v1.6.2` and a Play upload `1.6.2` then carry the same numbers.
- **Tracks.** `internal` (up to 100 testers you list, available within minutes, no review), `closed` (testers you
  invite, reviewed), `open` (anyone can join the test from the listing) and `production` (everyone).

## One-time setup

### 0. Privacy policy address

Play asks for a public privacy policy URL for every app. The four Android apps share one: `https://app.rawboy.link/privacy-android` (`web/public/privacy-android.html`, deployed with the website by `release.yml`). Update it, and the date on it, if the apps start collecting anything new or a library's data use changes.

### 1. Play Console: the apps and the first upload

Each app must exist in Play Console before the workflow can upload to it, and its first bundle has to be uploaded
by hand, in the browser:

1. Play Console → **Create app** (name, default language, App, Free). Do this for each app.
2. Run the workflow with **Upload to Play** unticked (see *Running it* below). When it finishes, open the run and
   download **play-bundles-&lt;version&gt;** at the bottom of its Summary page; it holds one folder per app.
3. *(Optional, only before this app's first upload.)* To make Play sign with your own `rawboy` key, find **App
   signing** in Play Console (search for "app signing" at the top). If it offers **Use a different key → Export and
   upload a key from a Java keystore**, follow it: Play shows a command for its `pepk.jar` tool and an encryption key
   to download. On your computer, with the `.jks` file:
   ```
   java -jar pepk.jar --keystore=rawboy-release.jks --alias=rawboy --output=rawboy-pepk.zip \
     --include-cert --rsa-aes-encryption --encryption-key-path=encryption_public_key.pem
   ```
   (It asks for the keystore and key passwords.) Upload `rawboy-pepk.zip`. Do this for each app: the encryption
   key differs per app, so download it each time. **Play App Signing can't be changed afterwards.** Play Console's
   layout changes, and for new apps the option is often missing; then skip this step and let Google sign.
4. **Test and release → Testing → Internal testing → Create new release**: upload that app's `.aab` from the
   downloaded folder, save, and roll out the internal release.

### 2. Google Cloud: the service account

1. Open [console.cloud.google.com](https://console.cloud.google.com), create a project (e.g. `rawboy-play`).
2. **APIs & Services → Library**: search *Google Play Android Developer API*, **Enable**.
3. **IAM & Admin → Service accounts → Create service account**: name `github-play-upload`, skip the optional roles,
   **Done**. Copy its email (`github-play-upload@rawboy-play.iam.gserviceaccount.com`).
4. Open it → **Keys → Add key → Create new key → JSON**. A `.json` file downloads. It is a password: don't commit
   it or share it.

### 3. Play Console: let the service account release

1. Play Console (the account level, not an app) → **Users and permissions → Invite new users**.
2. Email: the service account's email. **App permissions → Add app**: pick each RawBoy app and allow **View app
   information**, **Release to production, exclude devices, and use Play App Signing** and **Release apps to
   testing tracks**. Leave account permissions off. **Invite user**.
   Permissions can take up to a day to start working; a 403 "The caller does not have permission" error before
   then is that.

### 4. GitHub: the secrets

Repository → **Settings → Secrets and variables → Actions → New repository secret**:

| Secret | Value |
| --- | --- |
| `PLAY_SERVICE_ACCOUNT_JSON` | the whole content of the JSON key file (open it in a text editor, copy everything) |
| `KEYSTORE_FILE` | already set for `release.yml`: the `.jks` as base64 (`base64 -i rawboy-release.jks \| pbcopy` on a Mac) |
| `KEYSTORE_PASS` | already set: the keystore and key password |

## Running it

Actions → **Publish to Google Play** → **Run workflow**:

| Field | What to put |
| --- | --- |
| Use workflow from | the branch or tag to build (`main`, or a release tag such as `v1.6.2`) |
| Version name | `1.6.2`: three numbers, the second and third below 100 |
| Version code | empty (derived from the version name), or a number to force one, e.g. a second upload of the same version |
| RawBoy, Auto, Camera, Film | tick the apps to publish |
| Play track | `internal` to try it yourself, `closed` for testers, `production` for everyone |
| Release status | `completed` rolls it out; `draft` puts it in Play Console for you to send. Use `draft` while an app has never been through review: Play refuses `completed` then |
| What's new | the release notes, English, up to 500 characters |
| Upload to Play | untick to only build the bundles and download them (as for the first upload) |

The run takes about as long as the APK build in `release.yml`. A red **Upload** job usually means: the version code
was already used (raise the version or set a higher code), the service account has no permission for that app yet,
or the app is still in draft and needs **Release status: draft**.

Production releases still go through Google's review (hours to a few days) before users get them. Rolling out to a
part of the users, halting a release and answering reviews stay in Play Console.
