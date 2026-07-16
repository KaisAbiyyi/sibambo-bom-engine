# KP Technical and Method Guide

## Objective and workflow

Sibambo Model Eval converts supported SketchUp/BOM JSON or BOME2 exports into an early-stage building-review workspace. It preserves source geometry, derives evidence in browser memory, and supports this workflow:

`upload -> inspect model/rooms -> calibrate -> analyze -> compare scenarios -> recommend/optimize -> export`

This is decision support. Results are preliminary engineering estimates, not certified design calculations.

## Architecture

- **SvelteKit workspace**: upload, validation, progressive controls, result panels, JSON configuration import/export, and printable HTML reports.
- **Model ingestion**: parses JSON and `.json.gz`/BOME2-compatible payloads; validates source/decompressed size and requires renderable faces.
- **Geometry foundation**: normalizes entity hierarchy, SketchUp-to-Three.js coordinates, surfaces, openings, materials, and static model assets.
- **Room intelligence**: generates bounded candidates, validates closed envelopes, builds topology, infers room semantics, and keeps evidence/provenance for inspection.
- **Analysis engine**: runs seven deterministic building/room modules from inferred geometry plus explicit calibration inputs.
- **Client safety**: browser-reachable fingerprint code uses browser-safe hashing; Bun tests use native `CryptoHasher`; no Node crypto module is bundled for the browser.

## Room intelligence

The pipeline selects planar floor evidence, constructs candidate loops, rejects malformed envelopes, applies opening bridges, and converts accepted loops to detected rooms. Topology links rooms, openings, and circulation; semantics infer likely function and confidence from geometry/evidence. Room IDs and fingerprints are deterministic for identical input.

Room detection is heuristic. Open plans, missing faces, non-manifold geometry, or unusual exporter hierarchy can yield partial, ambiguous, or zero rooms. Those states are diagnostics, not a certification result.

## Seven analysis modules

| Module | Inputs | Method and output | Units | Assumptions / limitations |
| --- | --- | --- | --- | --- |
| Thermal comfort | Indoor/outdoor design temperature, RH, air speed, room/envelope evidence | Simplified comfort estimate and status | °C, %, m/s, status | Not full transient PMV/PPD study; defaults reduce confidence. |
| Human flow | Room area, function, doors, topology | Capacity, access/circulation path estimate | people, m², status | Not egress-code verification or crowd simulation. |
| Natural ventilation | Openings, orientation, wind, topology | Opening/crossflow inference and ACH estimate | ACH, m², status | Not CFD; wind and pressure fields are simplified. |
| Cooling capacity | Envelope, glazing, solar defaults, people, lights, ventilation | Steady design-load estimate and AC sizing | W, kW, BTU/h, PK | Not full RTS/energy model; no hourly weather simulation. |
| Illuminance | Function target, area, room geometry | Required target and lumens | lux, lm | Target-based estimate; no ray tracing. |
| Artificial lighting | Target lux, luminaire flux/wattage, CU, LLF | Luminaire quantity and power estimate | lm, W, count | Not DIALux/Radiance; luminaire layout is indicative. |
| OTTV | Wall/glazing areas, inferred facade orientation, U-values, solar/shading factors | Envelope heat-transfer estimate and threshold comparison | W/m² | Orientation and solar terms are inferred/simplified; not regulatory compliance. |

All seven modules use transparent first-principle approximations and explicit configuration defaults. They are **not CFD, not full RTS, and not DIALux/Radiance**. A licensed engineer must verify critical decisions with appropriate domain tools.

## Calibration, scenarios, and recommendations

Project calibration records value, unit, source, and validation state for climate, envelope, lighting, AC, and OTTV inputs. Invalid values block recalculation. Calibration re-runs analysis only: it does not mutate source geometry, rerun room detection, or replace the default analysis.

Default-versus-calibrated comparisons report deltas for comfort, ACH, cooling, luminaires, and OTTV. Recommendations are evidence-backed and prioritised by severity/confidence. Applying a supported recommendation or Pareto result changes the active proposed configuration and retains the default baseline for comparison.

Optimization is a bounded seeded search, not exhaustive optimization. It respects maximum evaluations, time budget, and `AbortController` cancellation; partial diagnostics are retained on cancellation or budget stop.

## Large-model operation and cancellation

- Use **house2** for full workflow demonstration.
- Use **PROJECT SBOOST 2** only for a bounded processing smoke run.
- Use **PROJECT SBOOST 1** only to demonstrate cancellation/resource limits.
- Do not use `presentation20` as normal validation input.

Progress is reported by logical object/unit. Stop ends cooperative processing at a safe boundary, retains completed cache/diagnostics, and keeps UI interactive. Source extraction before evidence setup can still be less interruptible; avoid unbounded runs.

## Known limitations

- Heuristic room detection and inferred orientation may be incomplete for atypical exports.
- Results use design-state defaults and steady approximations, not certification-grade simulation.
- Scenario multipliers are building-wide; per-room geometric edits are not supported.
- Optimizer frontier depends on bounded search budget and is not exhaustive.
- Source JSON remains unchanged; browser state must be exported to persist a configuration/report.
