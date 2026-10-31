# RawBoy Web: the engine's native code compiled to WebAssembly with Emscripten (see build.sh).
# Sources are used in place from engine/src/main/cpp; only the bridge (wasm_bridge.cpp) is web-specific.
cmake_minimum_required(VERSION 3.22.1)
project(rawboy_web LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

include(FetchContent)

set(ENGINE_CPP "${CMAKE_CURRENT_SOURCE_DIR}/../../engine/src/main/cpp")
option(RAWBOY_WEB_DNG_SDK "Build rawboy-full with the Adobe DNG SDK" OFF)

# Every object must agree on threads (shared memory) and exceptions (LibRaw and jpegli use them internally).
set(WEB_FLAGS -pthread -fwasm-exceptions -msimd128)
add_compile_options(${WEB_FLAGS} -sUSE_ZLIB=1)

# --- LibRaw, as in the engine's CMakeLists, but without OpenMP (Emscripten has none) ---
set(RAWBOY_LIBRAW_VERSION "0.21.3" CACHE STRING "LibRaw release tag")
FetchContent_Declare(libraw URL https://github.com/LibRaw/LibRaw/archive/refs/tags/${RAWBOY_LIBRAW_VERSION}.tar.gz)
FetchContent_MakeAvailable(libraw)
file(GLOB_RECURSE LIBRAW_SOURCES CONFIGURE_DEPENDS "${libraw_SOURCE_DIR}/src/*.cpp")
list(FILTER LIBRAW_SOURCES EXCLUDE REGEX ".*_ph\\.cpp$")
add_library(libraw_static STATIC ${LIBRAW_SOURCES})
target_include_directories(libraw_static PUBLIC "${libraw_SOURCE_DIR}")
target_compile_definitions(libraw_static PUBLIC LIBRAW_NODLL USE_ZLIB)
# LibRaw byte-swaps big-endian 16-bit data in place with swab(p, p, n); musl's swab doesn't allow overlap and
# zeroes/duplicates bytes (big-endian DNGs such as iPhone ProRAW got a garbage LinearizationTable and decoded
# white). LIBRAW_OWN_SWAB selects LibRaw's own in-place swap.
target_compile_definitions(libraw_static PRIVATE LIBRAW_OWN_SWAB)
target_compile_options(libraw_static PRIVATE -w -O3)

# --- jpegli: the engine's fetch and library targets (the Android .so is skipped outside Android) ---
include("${ENGINE_CPP}/jpegli.cmake")

# --- Adobe DNG SDK (rawboy-full): same setup as the engine's CMakeLists ---
set(RAWBOY_WITH_DNG_SDK 0)
if(RAWBOY_WEB_DNG_SDK)
    set(RAWBOY_DNG_SDK_ROOT "${CMAKE_CURRENT_SOURCE_DIR}/../../third_party/dng_sdk")
    include("${CMAKE_CURRENT_SOURCE_DIR}/dng_sdk.cmake")
    set(RAWBOY_WITH_DNG_SDK 1)
endif()

set(RAWBOY_SOURCES
    wasm_bridge.cpp
    ${ENGINE_CPP}/blemish.cpp
    ${ENGINE_CPP}/decode.cpp
    ${ENGINE_CPP}/decoder_libraw.cpp
    ${ENGINE_CPP}/libraw_parallel.cpp
    ${ENGINE_CPP}/decoder_display.cpp
    ${ENGINE_CPP}/display_inverse.cpp
    ${ENGINE_CPP}/display_profile.cpp
    ${ENGINE_CPP}/exif_reader.cpp
    ${ENGINE_CPP}/jpeg_decode.cpp
    ${ENGINE_CPP}/image_ops.cpp
    ${ENGINE_CPP}/lens_opcodes.cpp
    ${ENGINE_CPP}/noise.cpp
    ${ENGINE_CPP}/orientation.cpp)
if(RAWBOY_WITH_DNG_SDK)
    list(APPEND RAWBOY_SOURCES ${ENGINE_CPP}/decoder_dng.cpp)
    set(OUTPUT_NAME rawboy-full)
else()
    set(OUTPUT_NAME rawboy)
endif()

add_executable(rawboy_web ${RAWBOY_SOURCES})
set_target_properties(rawboy_web PROPERTIES OUTPUT_NAME ${OUTPUT_NAME} SUFFIX ".mjs")
target_include_directories(rawboy_web PRIVATE "${ENGINE_CPP}")
target_compile_definitions(rawboy_web PRIVATE RAWBOY_WITH_DNG_SDK=${RAWBOY_WITH_DNG_SDK})
target_compile_options(rawboy_web PRIVATE -O3 -Wall)
target_link_libraries(rawboy_web PRIVATE libraw_static rawboy_jpegli)
if(RAWBOY_WITH_DNG_SDK)
    target_link_libraries(rawboy_web PRIVATE dng_sdk)
endif()
target_link_options(rawboy_web PRIVATE
    ${WEB_FLAGS} -O3 -lembind -sUSE_ZLIB=1
    -sMODULARIZE=1 -sEXPORT_ES6=1 -sEXPORT_NAME=createRawBoy
    -sENVIRONMENT=web,worker,node
    -sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=256MB -sMAXIMUM_MEMORY=4GB
    # parallelRows (rawboy.h) uses at most 8 threads; a full pool would deadlock a worker, so fail loudly instead.
    -sPTHREAD_POOL_SIZE=8 -sPTHREAD_POOL_SIZE_STRICT=2
    -sSTACK_SIZE=2MB -sDEFAULT_PTHREAD_STACK_SIZE=2MB
    -sEXPORT_EXCEPTION_HANDLING_HELPERS=1
    -sEXPORTED_RUNTIME_METHODS=HEAPU8)
