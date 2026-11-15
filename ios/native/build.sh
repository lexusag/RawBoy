#!/bin/sh
# Builds the engine's native code for iOS into ios/native/out/:
#   RawBoyNative.xcframework  decoders (LibRaw, + Adobe DNG SDK when third_party/dng_sdk exists)
#   RawBoyJpeg.xcframework    jpegli + export band operations
# Each holds an iPhone (arm64), a Simulator (arm64) and a macOS (arm64 + x86_64, deployment target 15.0) slice. Needs Xcode and CMake; the first run downloads
# LibRaw and jpegli. Usage: ios/native/build.sh
set -e
cd "$(dirname "$0")"

# xcode-select may point at the Command Line Tools, which have no iOS SDK.
if ! xcrun --sdk iphoneos --show-sdk-path > /dev/null 2>&1 && [ -d /Applications/Xcode.app ]; then
    export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
fi

DEPLOYMENT_TARGET=17.0
MACOS_DEPLOYMENT_TARGET=15.0
OUT=out
JOBS=$(sysctl -n hw.ncpu)

build() {  # build <sdk>
    sdk=$1
    dir=build/$sdk
    # libjxl's bundled dependencies declare CMake < 3.5 policies, which CMake 4 refuses by default.
    if [ "$sdk" = macosx ]; then
        # The macOS slice is universal (the Viewer is too); the DNG SDK keeps its iPhone platform define (POSIX, no Carbon).
        cmake -S . -B "$dir" -DCMAKE_BUILD_TYPE=Release \
            -DCMAKE_OSX_SYSROOT=macosx -DCMAKE_OSX_ARCHITECTURES="arm64;x86_64" \
            -DCMAKE_OSX_DEPLOYMENT_TARGET=$MACOS_DEPLOYMENT_TARGET -DCMAKE_POLICY_VERSION_MINIMUM=3.5 > /dev/null
    else
        cmake -S . -B "$dir" -DCMAKE_BUILD_TYPE=Release \
            -DCMAKE_SYSTEM_NAME=iOS -DCMAKE_OSX_SYSROOT="$sdk" -DCMAKE_OSX_ARCHITECTURES=arm64 \
            -DCMAKE_OSX_DEPLOYMENT_TARGET=$DEPLOYMENT_TARGET -DCMAKE_POLICY_VERSION_MINIMUM=3.5 > /dev/null
    fi
    cmake --build "$dir" -j "$JOBS" --target rawboy_native rawboy_jpeg
    for name in RawBoyNative RawBoyJpeg; do
        framework "$dir" "$name" "$sdk"
    done
}

framework() {  # framework <build dir> <name> <sdk>: wraps the dylib as <build dir>/frameworks/<name>.framework
    fw=$1/frameworks/$2.framework
    rm -rf "$fw"
    root=$fw           # where the binary, Headers, Modules and Info.plist go
    if [ "$3" = macosx ]; then
        # macOS frameworks are versioned bundles (Resources/Info.plist, symlinks).
        root=$fw/Versions/A
        mkdir -p "$root/Resources"
    fi
    mkdir -p "$root/Headers" "$root/Modules"
    cp "$1/$2" "$root/$2"
    strip -x "$root/$2"
    # The linker's ad-hoc signature names the binary "<name>-<hash>"; iOS refuses to install an embedded framework
    # whose signing identifier doesn't match its bundle id (Xcode keeps the identifier when it re-signs).
    codesign --force --sign - --identifier "app.rawboy.native.$2" "$root/$2" 2> /dev/null
    header=$(echo "$2" | sed 's/RawBoyNative/rawboy_native/; s/RawBoyJpeg/rawboy_jpeg/').h
    cp "$header" "$root/Headers/"
    cat > "$root/Modules/module.modulemap" << EOF
framework module $2 {
    header "$header"
    export *
}
EOF
    platform=iPhoneOS
    minimum=$DEPLOYMENT_TARGET
    [ "$3" = iphonesimulator ] && platform=iPhoneSimulator
    plist=$fw/Info.plist
    if [ "$3" = macosx ]; then
        platform=MacOSX
        minimum=$MACOS_DEPLOYMENT_TARGET
        plist=$root/Resources/Info.plist
    fi
    cat > "$plist" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleExecutable</key><string>$2</string>
    <key>CFBundleIdentifier</key><string>app.rawboy.native.$2</string>
    <key>CFBundleName</key><string>$2</string>
    <key>CFBundlePackageType</key><string>FMWK</string>
    <key>CFBundleShortVersionString</key><string>1.0</string>
    <key>CFBundleVersion</key><string>1</string>
    <key>CFBundleSupportedPlatforms</key><array><string>$platform</string></array>
    <key>MinimumOSVersion</key><string>$minimum</string>
</dict>
</plist>
EOF
    if [ "$3" = macosx ]; then
        ln -sfn A "$fw/Versions/Current"
        ln -sfn Versions/Current/$2 "$fw/$2"
        ln -sfn Versions/Current/Headers "$fw/Headers"
        ln -sfn Versions/Current/Modules "$fw/Modules"
        ln -sfn Versions/Current/Resources "$fw/Resources"
        # Seal the bundle (the binary was signed alone above).
        codesign --force --sign - --identifier "app.rawboy.native.$2" "$fw" 2> /dev/null
    fi
}

build iphoneos
build iphonesimulator
build macosx

mkdir -p "$OUT"
xcframework() {  # xcframework <name> <build dir prefix>
    rm -rf "$OUT/$1.xcframework"
    xcodebuild -create-xcframework \
        -framework "build/${2}iphoneos/frameworks/$1.framework" \
        -framework "build/${2}iphonesimulator/frameworks/$1.framework" \
        -framework "build/${2}macosx/frameworks/$1.framework" \
        -output "$OUT/$1.xcframework" > /dev/null
}
xcframework RawBoyNative ""
xcframework RawBoyJpeg ""
ls -la "$OUT"
