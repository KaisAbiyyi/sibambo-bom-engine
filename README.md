# Sibambo BOM Engine

Sibambo BOM Engine is a building-model exploration workspace for SketchUp-derived JSON, browser-based 3D model viewing, and deterministic early-stage building analysis.

The repository is structured as a product workspace, not a pure public community project. Source distribution uses GPL v3 terms, while Sibambo branding, project direction, and release stewardship remain controlled by the project maintainers.

## What This Repository Contains

| Area | Purpose |
| --- | --- |
| `bom_engine_plugin/` | SketchUp/Ruby plugin source and exporter support files. |
| `model-viewer/` | Canonical browser viewer for legacy Svelte and React prototypes, exposed as native routes. |
| `model-eval/` | SvelteKit analysis app for parsing model JSON and running guided building-performance estimates. |
| `Model_SBMBOOST_bom.json` | Source BOM model export. |
| `Model_SBMBOOST_bom_visual_nonPretty-print.json` | Visual model export used by viewer/evaluation apps. |
| `SKETCHUP_PLUGIN_DEV.md` | Plugin development notes. |
| `WEB_CANVAS_DEV.md` | Web rendering and canvas notes. |
| `APP_INDEX.md` | Route map for embedded model-viewer prototypes. |

## Applications

### Model Viewer

`model-viewer` is the canonical Svelte viewer shell. It uses Svelte 5 with Vite, not React as the application framework. It replaces the old standalone `svelte1`-`svelte5` and `react-1`-`react-5` app folders.

Each legacy prototype still exists as embedded source under `model-viewer/src/embedded/*` and is reachable by route:

```text
/svelte1
/svelte2
/svelte3
/svelte4
/svelte5
/react-1
/react-2
/react-3
/react-4
/react-5
```

Run:

```powershell
npm run dev:model-viewer
```

Build:

```powershell
npm run build:model-viewer
```

### Model Eval

`model-eval` is the SvelteKit analysis experience. It reads a SketchUp/BOM JSON model, detects building components, collects missing inputs through presets, and produces early-stage estimates for lighting, AC, OTTV, thermal comfort, people flow, and wind flow.

## Framework Policy

| App | Framework | Notes |
| --- | --- | --- |
| `model-viewer` | Svelte 5 + Vite | Svelte owns the application shell and route host. Legacy `/react-*` prototypes are mounted as compatibility islands only. |
| `model-eval` | SvelteKit | SvelteKit owns routing, build, SSR output, checks, and app structure. |

Run:

```powershell
npm run dev:model-eval
```

Build:

```powershell
npm run build:model-eval
```

Check:

```powershell
npm --prefix model-eval run check
```

Test:

```powershell
npm --prefix model-eval run test
```

## Requirements

- Node.js 20+ for `model-viewer`.
- Bun for the current `model-eval` test workflow.
- Modern Chromium-based browser for WebGL/Three.js rendering.
- SketchUp environment for plugin development.

Install per app:

```powershell
npm --prefix model-viewer install
npm --prefix model-eval install
```

`model-eval` also includes `bun.lock`; use Bun when running its Bun-native tests.

## Data Flow

```text
SketchUp model
  -> bom_engine_plugin exporter
  -> BOM JSON / visual JSON
  -> model-viewer route previews
  -> model-eval parser
  -> readiness checks
  -> deterministic analysis results
  -> HTML report export
```

## Repository Principles

- Keep `model-viewer` as the single home for browser viewer prototypes.
- Do not reintroduce standalone `svelte1`-`svelte5` or `react-1`-`react-5` app folders.
- Keep analysis math deterministic and auditable.
- Prefer presets and explainable defaults over opaque AI-generated values.
- Treat exported building JSON as input data; do not mutate original files in analysis flows.
- Keep UI apps independently runnable.

## Licensing

Code in this repository is licensed under GNU General Public License v3.0 only. See `LICENSE`.

Project name, trademarks, product branding, and non-code business assets remain controlled by the Sibambo maintainers unless separately granted.

## Status

Active product/research workspace. APIs, JSON schema assumptions, and analysis formulas may change while the engine matures.
