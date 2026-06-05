# Sibambo Model Viewer

Sibambo Model Viewer is the canonical Svelte browser host for Sibambo BOM visual prototypes.

It uses Svelte 5 with Vite. It replaces the old standalone `svelte1`-`svelte5` and `react-1`-`react-5` apps with one Svelte wrapper. Legacy prototype source remains embedded and route-addressable, so the repository stays clean without losing reviewable UI iterations.

## Purpose

- Serve all visual model prototypes from one app.
- Keep route compatibility for existing prototype names.
- Avoid duplicated app shells, lockfiles, public assets, and dependency installs.
- Provide a single place for visual JSON loading and model-viewer iteration.

## Framework

`model-viewer` is a Svelte app, not a React app. The application shell, catalog, route loading, home screen, and host layout live in Svelte.

The `/react-*` routes still mount legacy React prototype internals as compatibility islands inside Svelte route wrappers. This preserves the old review surfaces while keeping the project-level viewer app in Svelte. A full removal of React internals requires porting those five legacy prototypes to native Svelte components.

## Routes

| Route | Embedded source | Description |
| --- | --- | --- |
| `/svelte1` | `src/embedded/svelte1/Page.svelte` | Living architectural section prototype. |
| `/svelte2` | `src/embedded/svelte2/Page.svelte` | Board interface iteration. |
| `/svelte3` | `src/embedded/svelte3/Page.svelte` | Cinematic interface iteration. |
| `/svelte4` | `src/embedded/svelte4/Page.svelte` | Mineral atlas experience. |
| `/svelte5` | `src/embedded/svelte5/Page.svelte` | Camera ritual experience. |
| `/react-1` | `src/embedded/react-1/Page.svelte` | React frontend draft 01, wrapped for Svelte host routing. |
| `/react-2` | `src/embedded/react-2/Page.svelte` | React frontend draft 02, wrapped for Svelte host routing. |
| `/react-3` | `src/embedded/react-3/Page.svelte` | Digital twin draft 03, wrapped for Svelte host routing. |
| `/react-4` | `src/embedded/react-4/Page.svelte` | Inspection draft 04, wrapped for Svelte host routing. |
| `/react-5` | `src/embedded/react-5/Page.svelte` | Blueprint atlas draft 05, wrapped for Svelte host routing. |

## Architecture

```text
model-viewer/
  public/
    Model_SBMBOOST_bom_visual_nonPretty-print.json
  src/
    App.svelte                  Wrapper shell and route host
    appCatalog.ts               Route registry and lazy imports
    embedded/
      svelte1..svelte5/         Native Svelte prototype sources
      react-1..react-5/         React sources wrapped by Svelte route entries
```

The app uses browser pathname routing. `appCatalog.ts` maps route paths to lazy-loaded `Page.svelte` modules. Every route entrypoint is a Svelte component, so the host can mount everything consistently.

## Requirements

- Node.js 20+
- Browser with WebGL support

Install:

```powershell
npm install
```

## Development

From this directory:

```powershell
npm run dev -- --host 127.0.0.1 --port 5200
```

From repository root:

```powershell
npm run dev:model-viewer
```

Open:

```text
http://127.0.0.1:5200/
http://127.0.0.1:5200/svelte1
http://127.0.0.1:5200/react-5
```

## Build

From this directory:

```powershell
npm run build
```

From repository root:

```powershell
npm run build:model-viewer
```

Preview:

```powershell
npm run preview
```

## Maintenance Rules

- Add new viewer experiments under `src/embedded/<experiment-id>/`.
- Register new routes in `src/appCatalog.ts`.
- Keep shared model JSON in `public/`.
- Do not recreate standalone sibling apps for `svelte*` or `react-*`.
- Keep wrapper changes separate from prototype-specific edits when possible.

## License

GPL-3.0-only. See repository root `LICENSE`.
