cmake_minimum_required(VERSION 3.20)
project(pas_engine LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

if (WIN32)
    add_definitions(-DUNICODE -D_UNICODE -DNOMINMAX -DWIN32_LEAN_AND_MEAN)
    add_definitions(-D_WIN32_WINNT=0x0A00)
endif()

add_library(pas_engine STATIC
    src/Engine.cpp
    src/PriorityMixer.cpp
    src/WasapiRender.cpp
    src/WasapiLoopback.cpp
    src/Meter.cpp
    src/DtxInjector.cpp
    src/Equalizer.cpp
    src/Limiter.cpp
    src/Compressor.cpp
)

target_include_directories(pas_engine PUBLIC include)

if (WIN32)
    target_link_libraries(pas_engine PUBLIC
        ole32
        uuid
        user32
        winmm
    )
    target_compile_options(pas_engine PRIVATE /W4 /permissive- /EHsc /std:c++17)
else()
    message(FATAL_ERROR "Voice Priority Audio's native engine requires Windows (WASAPI).")
endif()