# Sibambo Native Svelte Pages

`index-app` is the native Svelte host app.

It does not iframe or link out to `svelte1`-`svelte5` or `react-1`-`react-5`. The source from each original project is copied under:

```text
index-app/src/embedded/svelte1
index-app/src/embedded/svelte2
index-app/src/embedded/svelte3
index-app/src/embedded/svelte4
index-app/src/embedded/svelte5
index-app/src/embedded/react-1
index-app/src/embedded/react-2
index-app/src/embedded/react-3
index-app/src/embedded/react-4
index-app/src/embedded/react-5
```

## Routes

| Route | Native source |
| --- | --- |
| `/svelte1` | `index-app/src/embedded/svelte1/Page.svelte` |
| `/svelte2` | `index-app/src/embedded/svelte2/Page.svelte` |
| `/svelte3` | `index-app/src/embedded/svelte3/Page.svelte` |
| `/svelte4` | `index-app/src/embedded/svelte4/Page.svelte` |
| `/svelte5` | `index-app/src/embedded/svelte5/Page.svelte` |
| `/react-1` | `index-app/src/embedded/react-1/Page.svelte` |
| `/react-2` | `index-app/src/embedded/react-2/Page.svelte` |
| `/react-3` | `index-app/src/embedded/react-3/Page.svelte` |
| `/react-4` | `index-app/src/embedded/react-4/Page.svelte` |
| `/react-5` | `index-app/src/embedded/react-5/Page.svelte` |

## Run

```powershell
npm.cmd run dev:index
```

Open:

```text
http://127.0.0.1:5200/svelte1
http://127.0.0.1:5200/react-5
```

## Build

```powershell
npm.cmd run build:index
```

The shared model JSON is served from:

```text
index-app/public/Model_SBMBOOST_bom_visual_nonPretty-print.json
```
