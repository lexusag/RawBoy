# The engine's DNG SDK setup (engine/src/main/cpp/dng_sdk.cmake) for WebAssembly: the SDK's web platform.
# Little-endian is set explicitly; the SDK's own detection doesn't know wasm32.
set(RAWBOY_DNG_PLATFORM qWeb=1 qDNGLittleEndian=1)
include("${ENGINE_CPP}/dng_sdk.cmake")
