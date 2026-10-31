# Installing RawBoy on your iPhone

RawBoy isn't on the App Store. You build it on a Mac and install it on your own iPhone with Xcode, signed with your
Apple ID. The iOS apps are **RawBoy** (scheme `RawBoyPro`), **RawBoy Auto** (`RawBoyAuto`) and **RawBoy Camera**
(`RawBoyCamera`).

## What you need

- A Mac with **Xcode** (from the App Store; open it once so it installs its components) and an iPhone on **iOS 17**
  or newer, plus a USB cable for the first install.
- An **Apple ID**. A free one is enough; a paid Apple Developer Program membership ($99 a year) only changes how long
  an install lasts and how many apps you can have (see [Free or paid Apple ID](#free-or-paid-apple-id)).
- Build tools from [Homebrew](https://brew.sh): `brew install xcodegen cmake glslang spirv-cross`
- Network access for the first build: it downloads LibRaw, jpegli and MediaPipe.
- Optional: the Adobe DNG SDK in `third_party/dng_sdk` ([third_party/README.md](../third_party/README.md)). Without
  it the iOS apps build fine, but DNG 1.7 files with JPEG XL compression don't open.

## 1. Build the native parts

```sh
git clone https://github.com/lexusag/RawBoy.git
cd RawBoy
ios/native/build.sh        # LibRaw + jpegli → ios/native/out/*.xcframework (takes a while the first time)
```

## 2. Set your signing team

The Xcode project is generated from `ios/project.yml`, which is signed with the maintainer's team
(`DEVELOPMENT_TEAM: PB2FFKSMC8`) and uses `app.rawboy.*` bundle ids. If that's your team, skip to step 3. Otherwise:

1. In Xcode, **Settings → Accounts → +** and sign in with your Apple ID. This creates your *Personal Team* (free) or
   shows your paid team.
2. Find your Team ID: Xcode makes an "Apple Development" certificate the first time it signs, and its OU field is the
   team ID. Either open any project, pick your team under *Signing & Capabilities* once and read *Development Team*
   in Build Settings, or run:
   ```sh
   security find-certificate -c "Apple Development" -p | openssl x509 -noout -subject
   ```
3. Put your team in `ios/project.yml` and give the apps bundle ids of your own (a bundle id belongs to the first team
   that registers it, so `app.rawboy.*` won't sign under another team):
   ```sh
   cd ios
   sed -i '' 's/PB2FFKSMC8/YOURTEAMID/; s/app\.rawboy/com.yourname.rawboy/g' project.yml
   ```
   Keep this as a local change (or `git stash` it when you pull). Don't set the team in Xcode's Signing tab instead:
   `xcodegen` regenerates the project and drops it.

## 3. Generate the project and install

```sh
cd ios
xcodegen                   # also generates the Metal shaders and downloads MediaPipe
open RawBoy.xcodeproj
```

1. Connect the iPhone with the cable, unlock it and tap **Trust** on "Trust This Computer?".
2. Turn on **Developer Mode** on the iPhone: **Settings → Privacy & Security → Developer Mode**, then restart and
   confirm. The switch only appears after the iPhone has been connected to Xcode once.
3. In Xcode, pick the scheme (`RawBoyPro`, `RawBoyAuto` or `RawBoyCamera`) and your iPhone as the run destination at
   the top of the window, then **Product → Run** (⌘R). The Debug build is what goes on the phone; the engine is
   compiled optimised in Debug too, so it isn't slower than a release build.
4. With a free Apple ID, the first launch is refused as an "Untrusted Developer". On the iPhone, open **Settings →
   General → VPN & Device Management**, tap your Apple ID under *Developer App* and **Trust** it. Then open the app
   from the home screen. You trust once per Apple ID, not per app.

Repeat step 3 with the other schemes for the other apps. After the first install you can tick **Connect via
network** for the iPhone in **Window → Devices and Simulators** and install over Wi-Fi without the cable.

From the command line instead of the Xcode window (the device id comes from `xcrun devicectl list devices`):

```sh
xcodebuild -project RawBoy.xcodeproj -scheme RawBoyPro -configuration Debug \
    -destination 'generic/platform=iOS' -derivedDataPath build/dd -allowProvisioningUpdates build
xcrun devicectl device install app --device <device id> build/dd/Build/Products/Debug-iphoneos/RawBoyPro.app
```

## Free or paid Apple ID

| | Free Apple ID (Personal Team) | Apple Developer Program |
|---|---|---|
| Install lasts | **7 days**, then the app won't open until you reinstall it | 1 year |
| Apps on one iPhone | **3** at a time (RawBoy, Auto, Camera and Film are 4: remove one to add another) | no limit |
| New bundle ids | 10 per 7 days | no limit |

When an install expires, just run it again from Xcode (step 3): with the same bundle id it updates in place and keeps
the app's settings and photos. Deleting the app from the iPhone deletes its data; photos already saved to your library
stay there. Updating to a newer RawBoy is the same: `git pull`, `ios/native/build.sh` if `engine/src/main/cpp` or
`ios/native` changed, `xcodegen`, Run.

## When it doesn't work

- **"Failed to register bundle identifier" / "No profiles for 'app.rawboy…' were found"**: the bundle ids still belong
  to another team. Change them as in step 2.
- **"Your maximum App ID limit has been reached"**: the free 10-per-week limit. Wait, or reuse the bundle ids you
  already registered rather than inventing new ones.
- **"The maximum number of apps for free development profiles has been reached"**: three apps are already installed
  with your free team. Delete one from the iPhone.
- **"Could not launch… Developer Mode disabled"**: step 3.2. **"Untrusted Developer"**: step 3.4.
- **`glslang: command not found` or missing `.metal` files**: the Homebrew tools aren't installed (`brew install glslang spirv-cross`).
- **"No such module 'RawBoyNative'" / missing xcframework**: run `ios/native/build.sh` first, then `xcodegen` again.
- **`xcrun: unable to find utility` / no iOS SDK**: `xcode-select` points at the Command Line Tools. Run
  `sudo xcode-select -s /Applications/Xcode.app/Contents/Developer`.
