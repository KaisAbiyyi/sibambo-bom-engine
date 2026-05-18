# Svelte BOM Viewer UI/UX Audit

Date: 2026-05-14
Scope: `svelte/` app, live browser review at `http://127.0.0.1:5174`, Svelte source review, Vercel Web Interface Guidelines check.

## Changes Completed

- Added persisted light/dark theme toggle.
- Added dark theme tokens for page, loader, status bar, input, and WebGL stage background.
- Forced every story section to `100vh` / `100svh`.
- Tuned desktop and mobile typography so section copy fits inside each viewport.
- Hid story DOM before model load, removing background content noise and screen reader duplication.
- Grouped theme/explore controls into a single fixed control rail.
- Added mobile text shielding and canvas offset so text remains legible over 3D.
- Added basic model label collision suppression.
- Added dark-specific muted/ghost material palette for 3D model.
- Added visible global `:focus-visible` treatment for buttons and inputs.
- Added `name`, `autocomplete="off"`, and `spellcheck="false"` to model path input.
- Added `aria-live="polite"` around model loader form.
- Added skip links.
- Added deterministic number formatting helper.
- Added failed-load error focus.
- Added stronger pressed state styling.
- Fixed loading label to `Loading...`.
- Kept lazy model load behavior: parser and Three renderer still load only after user input.

## Strong Parts

- First screen now respects task flow: model input before 3D load.
- Visual direction has strong architectural-drawing identity: grid, serif display type, technical labels, muted material palette.
- Performance structure is correct: Three.js chunk split, parser split, demand render loop, merged layer geometry.
- The app can communicate model structure quickly after load: layer count, mesh count, layer legend, title blocks, macro index.

## Remaining UI/UX Issues

1. No automated visual regression yet.
   - Candidate fix: add Playwright screenshot diff across desktop/tablet/mobile.

## Accessibility Notes

- Input has label via wrapping `<label>`, good.
- File input has visible label, good.
- Layer controls use checkbox role and checked state, good.
- Main app region has label, acceptable.
- Skip link present.
- Story not mounted before model load.
- Error message receives focus after failed load.

## Performance Notes

- Initial JS chunk is now small relative to previous React build.
- Three.js still downloads after model load, not before. Good.
- Geometry merge happens on main thread after model load. Acceptable for current sample, but large files will block UI.
- Best next performance step: parse + geometry build in Web Worker, then transfer typed arrays back.

## Recommended Next Work

1. Add Web Worker parser/geometry builder.
2. Add automated viewport visual regression screenshots.
