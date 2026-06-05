# Sibambo Model Viewer App Index

`model-viewer` is the canonical host for all legacy viewer prototypes.

The standalone `svelte1`-`svelte5` and `react-1`-`react-5` apps were removed. Their runtime source is preserved inside one wrapper app and exposed as native routes.

## Routes

| Route | Source |
| --- | --- |
| `/svelte1` | `model-viewer/src/embedded/svelte1/Page.svelte` |
| `/svelte2` | `model-viewer/src/embedded/svelte2/Page.svelte` |
| `/svelte3` | `model-viewer/src/embedded/svelte3/Page.svelte` |
| `/svelte4` | `model-viewer/src/embedded/svelte4/Page.svelte` |
| `/svelte5` | `model-viewer/src/embedded/svelte5/Page.svelte` |
| `/react-1` | `model-viewer/src/embedded/react-1/Page.svelte` |
| `/react-2` | `model-viewer/src/embedded/react-2/Page.svelte` |
| `/react-3` | `model-viewer/src/embedded/react-3/Page.svelte` |
| `/react-4` | `model-viewer/src/embedded/react-4/Page.svelte` |
| `/react-5` | `model-viewer/src/embedded/react-5/Page.svelte` |

## Run

```powershell
npm run dev:model-viewer
```

Open:

```text
http://127.0.0.1:5200/svelte1
http://127.0.0.1:5200/react-5
```

## Build

```powershell
npm run build:model-viewer
```

Shared visual model:

```text
model-viewer/public/Model_SBMBOOST_bom_visual_nonPretty-print.json
```
