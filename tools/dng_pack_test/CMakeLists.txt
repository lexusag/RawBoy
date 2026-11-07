# Host test of the Packer's DNG-to-DNG path (engine/src/main/cpp/dng_pack.cpp); see run.sh.
cmake_minimum_required(VERSION 3.20)
project(dng_pack_test CXX C)
set(CMAKE_CXX_STANDARD 17)
include(FetchContent)
set(cpp "${CMAKE_CURRENT_SOURCE_DIR}/../../engine/src/main/cpp")
set(RAWBOY_DNG_SDK_ROOT "${CMAKE_CURRENT_SOURCE_DIR}/../../third_party/dng_sdk")
set(RAWBOY_DNG_PLATFORM qLinux=1)
include("${cpp}/dng_sdk.cmake")

# LibRaw, as in the engine's CMakeLists (fetched; FETCHCONTENT_SOURCE_DIR_LIBRAW points at an existing copy).
FetchContent_Declare(libraw URL https://github.com/LibRaw/LibRaw/archive/refs/tags/0.21.3.tar.gz)
FetchContent_MakeAvailable(libraw)
file(GLOB_RECURSE LIBRAW_SOURCES CONFIGURE_DEPENDS "${libraw_SOURCE_DIR}/src/*.cpp")
list(FILTER LIBRAW_SOURCES EXCLUDE REGEX ".*_ph\\.cpp$")
add_library(libraw_static STATIC ${LIBRAW_SOURCES})
target_include_directories(libraw_static PUBLIC "${libraw_SOURCE_DIR}")
target_compile_definitions(libraw_static PUBLIC LIBRAW_NODLL)
target_compile_options(libraw_static PRIVATE -w -O2)

add_executable(dng_pack_test test.cpp "${cpp}/dng_pack.cpp" "${cpp}/dng_transcode.cpp" "${cpp}/camera_lens_data.cpp"
               "${cpp}/libraw_parallel.cpp" "${cpp}/decoder_libraw.cpp" "${cpp}/lens_opcodes.cpp"
               "${cpp}/exif_reader.cpp" "${cpp}/noise.cpp" "${cpp}/orientation.cpp" "${cpp}/image_ops.cpp")
target_compile_definitions(dng_pack_test PRIVATE RAWBOY_WITH_DNG_SDK=1)
target_include_directories(dng_pack_test PRIVATE "${cpp}")
target_link_libraries(dng_pack_test PRIVATE dng_sdk libraw_static)
