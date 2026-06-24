# ArchiParse Converter

Proof-of-Concept standalone C++ tool to convert `.skp` to JSON.

## Setup

1. Download the [SketchUp C SDK (Windows)](https://developer.sketchup.com/sketchup/c-api)
2. Extract the SDK into the `model-converter/sdk` folder. The structure should look like:
   - `model-converter/sdk/headers/SketchUpAPI/...`
   - `model-converter/sdk/binaries/sketchup/x64/SketchUpAPI.dll`
   - `model-converter/sdk/binaries/sketchup/x64/SketchUpAPI.lib`

## Build

```powershell
cd model-converter
mkdir build
cd build
cmake ..
cmake --build . --config Release
```

## Run

```powershell
.\Release\archiparse.exe path\to\your\model.skp > output.json
```
