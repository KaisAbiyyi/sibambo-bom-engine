# PR Notes: UI Draft 01

## Summary

This draft adds an isolated React react-1 under `react-1/` for reviewing a scroll-based Sibambo model presentation and the existing dark model viewer UI.

## Scope

- Adds a Vite React UI draft for react-1 review.
- Makes **Anatomy Story** the default page.
- Keeps **Model Viewer** available from the top UI tab.
- Uses the copied visual JSON from `react-1/public/Model_SBMBOOST_bom_visual_nonPretty-print.json`.

## Files/Folders Intentionally Added

- `react-1/`
- `react-1/README.md`
- `PR_NOTES_UI_DRAFT_01.md`

## Files/Folders Intentionally Untouched

- `bom_engine_plugin/`
- Ruby SketchUp plugin files
- JSON exporter code
- Root JSON schema and source model files
- `building_anatomy.html`
- `building_anatomy_master.html`
- `house3d_viewer.html`
- `house3d_viewer copy.html`
- `SKETCHUP_PLUGIN_DEV.md`
- `WEB_CANVAS_DEV.md`

## How To Run

```bash
cd react-1
npm install
npm run dev
```

Then open:

```text
http://localhost:5173
```

## Known Limitations

- This is UI Draft 01, not the final production react-1.
- The app uses a copied JSON file for react-1 display only.
- The Anatomy Story uses manual Three.js rendering and CSS transitions, without React Three Fiber, GSAP, Framer Motion, or Tailwind.
- Component grouping depends on the current exported JSON layer/category detection.

## Reviewer Notes

- The PR is intended to be reviewed as a react-1-only draft.
- The Ruby SketchUp plugin and exporter are intentionally out of scope.
- The JSON schema is intentionally unchanged.
- The scroll story now ends with **Hasil Akhir Rumah**, showing the recomposed complete house after the Cerucuk section.
