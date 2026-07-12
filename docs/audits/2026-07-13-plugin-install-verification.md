# SketchUp 2026 Plugin Installation Verification

Status: **PASS**

## Package and installation

- Package: `bom_engine_plugin_v3.0.0.rbz`
- Package size: 44,760 bytes
- Package SHA-256: `A12DFC567338DE8D39497411DFF29AF248DE861A58609461259A36EDFF612887`
- Package layout: 23 files; loader and `bom_engine/core.rb` present; tests excluded
- Installed plugin files: 22 plus `bom_engine_loader.rb`
- Installed plugin version: 3.0.0
- Installed load root: `%APPDATA%/SketchUp/SketchUp 2026/SketchUp/Plugins`
- Backup preserved: `artifacts/_workflow/backups/sketchup-2026-bom-engine-20260713-060035`

Requested executable `C:\Program Files\SketchUp\SketchUp 2026\SketchUp.exe` does not exist on this machine. Actual installed executable is `C:\Program Files\SketchUp\SketchUp 2026\SketchUp\SketchUp.exe`.

## Verification performed

1. Ran all eight embedded SketchUp test files before packaging. Results: classifier 21/21, traversal 9/9, canonical graph PASS, canonical writer PASS, BOME2 PASS, canonical core PASS, BOME2 core PASS, integration 12/12.
2. Restarted SketchUp 2026 after final install.
3. Opened `skps/test.skp` directly.
4. Confirmed BOM Engine toolbar icon and Extensions > BOM Engine menu.
5. Opened Ruby Console. Console was empty at startup: no plugin exception or stack trace.
6. Confirmed every BOM Engine feature loaded from installed `%APPDATA%` directory.
7. Opened export dialog and confirmed default `v3 / BOME2` runtime selection.
8. Exported compressed BOME2 through installed plugin and validated its section directory and counts.
9. Confirmed source model remained unmodified.

## Smoke result

| Metric | Value |
| --- | ---: |
| Compressed size | 32,606 bytes |
| Uncompressed size | 90,068 bytes |
| Export time | 0.279 s |
| Unique meshes | 2 |
| Definitions | 2 |
| Nodes | 2 |
| Instances | 1 |
| Triangles | 3,010 |
| Sections | 7 |
| Maximum quantization error | 0.012863 mm |

Machine-readable record: `artifacts/_workflow/plugin-install.json`.

Local evidence, intentionally ignored by Git:

- `artifacts/test/sketchup/phase4-installed-startup.jpg`
- `artifacts/test/sketchup/phase4-installed-smoke.jpg`
- `artifacts/test/sketchup/phase4-installed-dialog.jpg`
- `artifacts/_workflow/logs/phase4-installed-verification.log`

## Test-driven corrections made during install validation

- Increased triangle-area precision from four to eight decimals. Tiny mesh triangles no longer collapse to zero or accumulate visible area drift.
- Wrapped traversal test mutations in an aborted SketchUp operation. Test model remains clean.
- Updated legacy integration test for deterministic level-suffixed output and current schema version.
- Added silent behavior to legacy export success and failure dialogs for automated runs.
