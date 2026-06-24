cmake_minimum_required(VERSION 3.20)
project(archiparse CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

include_directories(third_party)
include_directories(sdk/headers)

add_executable(archiparse
    src/main.cpp
    src/coord.cpp
    src/classifier.cpp
    src/traversal.cpp
)

# Link SketchUp C SDK (Windows)
target_link_directories(archiparse PRIVATE sdk/binaries/sketchup/x64)
target_link_libraries(archiparse PRIVATE SketchUpAPI)
