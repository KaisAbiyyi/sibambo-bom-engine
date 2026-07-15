# Sibambo Model Eval

Sibambo Model Eval is a SvelteKit app for early-stage building analysis from SketchUp/BOM JSON exports.

Framework status: SvelteKit owns routing, build output, app structure, and diagnostics. This project is not a React app.

It turns raw model geometry into a guided evaluation workflow: upload JSON, inspect detected building data, complete missing inputs with presets, run deterministic estimates, preview overlays, and export an HTML report.

## Scope

Model Eval focuses on first-pass decision support, not final engineering certification.

Included:

- JSON upload and sample loading.
- Automatic face, surface, part, room, and component detection.
- Readiness checks for each analysis mode.
- Progressive inputs with human-readable presets.
- Analysis results as tables, recommendations, before/after hints, and 3D overlays.
- HTML report export.
- Parser unit tests for room detection and height inference.

Out of scope:

- CFD simulation.
- Full energy modeling.
- Structural validation.
- Legal compliance certification.
- Automatic mutation of source JSON.

## Analysis Modes

| Mode | Output |
| --- | --- |
| Lighting | Lamp count and wattage per detected zone. |
| AC | Cooling capacity estimate in BTU/h and PK. |
| OTTV | Envelope heat-transfer estimate with glass ratio and orientation inputs. |
| Thermal | Comfort score based on roof and wall material presets. |
| People flow | Occupancy capacity and circulation score. |
| Wind flow | Ventilation-crossflow score from dominant wind and openings. |

Room Debug also exposes seven room/building analysis modules: thermal comfort, human flow,
natural ventilation, cooling capacity, illuminance requirement, artificial lighting, and OTTV.

## Calibration workflow

Open Room Debug after loading a model, then use **Project calibration** to edit project north,
indoor/outdoor temperature, humidity, wind, envelope U-values, SHGC/shading, lighting CU/LLF/
flux, AC margin, and OTTV threshold. Every value records unit, source, and validation state.
Invalid values block recalculation. Reset field/all restores default profile.

Calibration recalculates analysis only. It does not reparse model geometry or rerun room detection,
topology, or semantic inference. Default-versus-calibrated values show deltas for thermal state,
ACH, cooling, luminaires, and OTTV. Configuration JSON uses schema
`model-eval-project-configuration`, version 1; invalid or unsupported files are rejected before
they change active settings.

Exports: configuration JSON, scenario JSON, and printable HTML analysis reports. Reports retain
units, calculation traces, and degraded/insufficient-data warnings.

## Bounded benchmarking

Use `bun run benchmark:profile -- --phase fingerprint --max-candidates 5000 --time-budget-ms 30000`.
Default benchmark uses safe house2 input and bounded candidates. `--full` is explicit. Do not use
`presentation20_model-eval.json` as a normal validation fixture. Large source extraction remains
uninterruptible before evidence setup, so do not run it until pre-phase cancellation is available.

## Project Structure

```text
model-eval/
  docs/prd.md                         Product requirements and UX scope
  src/lib/model.ts                    Parser, readiness engine, analysis engine
  src/lib/model.test.ts               Bun tests for geometry parsing
  src/lib/ModelCanvas.svelte          Three.js model preview and overlays
  src/routes/+page.svelte             Main analysis workspace
  static/Model_SBMBOOST_bom_visual_nonPretty-print.json
```

## Requirements

- Node.js 20+
- Bun for the current test runner
- Browser with WebGL support

Install:

```powershell
npm install
```

## Development

Start dev server:

```powershell
npm run dev
```

From repository root:

```powershell
npm run dev:model-eval
```

Default root script serves the app at:

```text
http://127.0.0.1:5300
```

## Quality Gates

Type and Svelte check:

```powershell
npm run check
```

Run tests:

```powershell
npm run test
```

Build production bundle:

```powershell
npm run build
```

Preview production bundle:

```powershell
npm run preview
```

## Data Contract

Expected JSON shape:

- `entities`: nested model entities.
- `Face` entities with `vertices`, `area_m2`, optional `surface_type`, optional material data.
- Optional metadata fields such as `schema_version`, `export_level`, and `exported_at`.

The parser tolerates partial metadata but requires renderable faces. If no faces exist, parsing fails with an explicit error.

## Analysis Philosophy

- Auto-detect before asking user input.
- Use presets for domain values such as room function, wall material, glass type, roof material, and lamps.
- Mark results as estimates when defaults are still being used.
- Keep formulas transparent in `src/lib/model.ts`.
- Preserve original JSON; analysis state lives in browser memory/local storage and exported reports.

## License

GPL-3.0-only. See repository root `LICENSE`.
