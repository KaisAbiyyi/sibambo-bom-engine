# Implementation Plan: svelte4-3d-presentation (NEKARA)

> Convert the feature design into a series of prompts for a code-generation LLM that will implement each step with incremental progress. Make sure that each prompt builds on the previous prompts, and ends with wiring things together. There should be no hanging or orphaned code that isn't integrated into a previous step. Focus ONLY on tasks that involve writing, modifying, or testing code.

## Overview

Build the NEKARA forensic-tomograph 3D presentation as the `svelte4` app folder, layered bottom-up:

1. Project scaffold, types, and reusable BOM parser port from `svelte1`.
2. Pure data extraction (`extractBomInfo`, `dimensionTagsFromName`) — no Three, no GSAP, fully PBT-covered first.
3. Three.js scene primitives: `NekaraMaterial`, `buildLayerObjects`, `CameraRig`, `EffectComposer` chain.
4. GSAP master timeline, beats, initial reveal, free-orbit handoff.
5. Svelte components and HUD: `NekaraApp`, `CanvasStage`, `LoaderPanel`, `DataPanel`, `ScanlineHUD`, `CursorReticle`.
6. Resize / context-loss / reduced-motion / performance / asset-bundling hardening.

Implementation language: **TypeScript** + **Svelte 5** (locked by design §3.1 and §4). PBT framework: **fast-check** + **vitest**, run with `vitest --run`.

## Tasks

- [x] 1. Bootstrap svelte4 project and shared types
  - [x] 1.1 Scaffold `svelte4/` workspace
    - Create `svelte4/` with `package.json` (bun, vite, svelte 5, three ^0.171, gsap ^3.12, troika-three-text, three-mesh-bvh, fast-check, vitest), `vite.config.ts`, `index.html`, `tsconfig.json`, `src/main.ts`, `src/styles/nekara.css`.
    - Copy `Model_SBMBOOST_bom_visual_nonPretty-print.json` into `svelte4/public/`.
    - Configure vitest with `--run` mode and a jsdom + headless WebGL stub setup file.
    - _Requirements: 21.1, 21.3, 21.4, 21.5, 21.7, 21.8_

  - [x] 1.2 Port reusable libs from `svelte1`
    - Copy `parseBomModel.ts`, `computeModelBounds.ts`, `buildGeometryFromFace.ts`, `detectLayerGroup.ts`, `format.ts` into `svelte4/src/lib/` and reused types `bom.ts`, `model.ts` into `svelte4/src/types/`.
    - Mark `BomModelJson.materials` as optional (`materials?: Record<string, BomMaterial>`); guard every dereference; treat `parseBomModel` as throwing only when `entities` is missing/non-array/empty.
    - _Requirements: 1.3, 1.8, 1.9_

  - [x] 1.3 Define NEKARA-specific types
    - Add `src/types/beat.ts` (`BeatId`, `StateMix`, `DataPanelKind`, `Beat`).
    - Add `src/types/timeline.ts` (`NekaraTweenTargets` with `state`, `camera`, `post`, `scan`, `layers`, `dataPanel.opacity`).
    - Add `src/types/bomInfo.ts` (`DocumentMetadata`, `LayerStats`, `MacroStats`, `EntityTypeName`, `NameTags`).
    - _Requirements: 2.2, 3.1, 3.6, 10.4, 11.1_

- [ ] 2. BOM information extraction (pure, PBT-first)
  - [x] 2.1 Implement `dimensionTagsFromName`
    - File `src/lib/extractBomInfo.ts` exporting `dimensionTagsFromName(name: string): NameTags`.
    - Run regexes in fixed order: `productCode → prefix code → bracketed code → dimensions`, removing matched substring before next class.
    - Validate output ranges: dims length 0..4, each `>0 ∧ ≤100000`; `code` matches `/^[A-Z][A-Z0-9]*\d+$/` or null; `productCode` matches `/^web_\d+$/` or null.
    - Reject inputs that are non-string, null, undefined, or longer than 512 chars by returning `{ dims: [], code: null, productCode: null }` and surfacing diagnostic without throwing.
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.7_

  - [x] 2.2 Property test for `dimensionTagsFromName`
    - **Property 15: Dimension parser determinism + fixture coverage**
    - Encode determinism arbitrary: `fc.string({ maxLength: 512 })` → assert `deepEqual(fn(s), fn(s))` and idempotence under second invocation in same process.
    - Encode 13-row fixture table from design §4.10.4 as exhaustive coverage assertions.
    - **Validates: Requirements 12.1, 12.2, 12.3, 12.4, 12.5, 12.6**

  - [x] 2.3 Implement `extractDocumentMetadata`
    - In `src/lib/extractBomInfo.ts` add `extractDocumentMetadata(json)` returning `DocumentMetadata`.
    - String fields: pass-through when string, else `""`. `entityCount = (json.entities ?? []).length` when array else `0`. `hasMaterials = Object.prototype.hasOwnProperty.call(json, "materials")`.
    - Recursive sums for `faceCount`, `groupCount`, `componentInstanceCount`, `maxDepth`, `totalAreaM2` over `entities[].children[]`.
    - Treat null/undefined json as empty document (return zeros, "", false).
    - _Requirements: 11.1, 11.2, 11.3, 11.7, 11.8_

  - [x] 2.4 Property test for `extractDocumentMetadata`
    - **Property 14: Document metadata pass-through**
    - **Validates: Requirements 11.1, 11.2**
    - Plus Property 16 fragment for `materials` absent/null/{}/populated → `parseBomModel` succeeds.
    - **Property 16: Optional `materials` safety**
    - **Validates: Requirements 1.6**

  - [x] 2.5 Implement `summarizeLayerStats`, `summarizeMacroStats`, `topLevelTypeHistogram`
    - `summarizeLayerStats(model)`: one entry per non-empty layer key, lexicographic order, `dominantSurfaceType` and `dominantComponentName` via mode of source faces.
    - `summarizeMacroStats(model)`: lexicographic order; sum equals `summarizeLayerStats` sum within `1e-6`.
    - `topLevelTypeHistogram(json)`: bucket missing/non-string `type` under `"unknown"`; empty histogram if `entities` is non-array.
    - Pure, no I/O, no `Math.random`/`Date`/`performance.now`.
    - _Requirements: 11.4, 11.5, 11.6, 11.7, 11.8_

  - [ ] 2.6 Property test for area conservation
    - **Property 13: Area conservation across summarisation**
    - **Validates: Requirements 11.3, 11.4, 11.5**
    - Build a `fc` arbitrary that generates synthetic `ParsedModel`s with known `Σ face.area_m2`; assert `|Σ layerStats.totalAreaM2 − faceSum| < 1e-6` and `|Σ macroStats.totalAreaM2 − faceSum| < 1e-6`.
    - Include the `Model_SBMBOOST_bom_visual_nonPretty-print.json` fixture (expected ≈ 3362.77 m²).

- [ ] 3. Checkpoint - BOM extraction stable
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Beat configuration and validation
  - [x] 4.1 Author `BEATS` constant
    - File `src/data/beatConfig.ts` exporting the 9 beats from design §4.7 verbatim, in order: `index`, `scan`, `cryoLock`, `attribution`, `strata`, `cast`, `assembly`, `archive`, `release`.
    - Each beat has `index === position`, `state.{schematic,cryo,mass} ∈ [0,1]`, `cameraT ∈ [0,1]`, `explodeAmount ∈ [0,1]`, `dataPanel ∈ DataPanelKind ∪ {null}`, `explodeAxis ∈ {"y","radial"}`.
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 6.3_

  - [x] 4.2 Implement `validateBeats(beats)` startup guard
    - File `src/data/validateBeats.ts`. Returns `{ ok: true } | { ok: false, beatId, violation }`.
    - Halts initialization with configuration error identifying the offending beat id and violated constraint when any constraint fails.
    - _Requirements: 3.7, 6.4_

  - [x] 4.3 Property test for beat configuration invariants
    - **Property: Beat configuration invariants (covers Requirements 3.1–3.6, 6.3)**
    - **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 6.3**
    - Generate adversarial beats with `fc` and assert `validateBeats` rejects exactly the violating cases; assert `BEATS` itself passes.

- [x] 5. Camera MotionPath
  - [x] 5.1 Implement `createCameraRig`
    - Files `src/three/camera/createCamera.ts` and `src/three/camera/motionPath.ts`.
    - Build non-closed `CatmullRomCurve3` from 4..32 control points; expose `perspective`, `ortho`, `curve`, `sample(t, lookAhead, orthoMix)`.
    - `sample` clamps args to declared ranges (`t ∈ [0,1]`, `lookAhead ∈ [0,0.25]`, `orthoMix ∈ [0,1]`), sets `perspective.position` to `curve.getPointAt(t)` within 1e-6, looks at `curve.getPointAt(min(t+lookAhead,1))`, calls `updateMatrixWorld` so caller observes consistent transform.
    - Throw construction error on `< 4` control points or non-finite components.
    - _Requirements: 7.1, 7.2, 7.3, 7.6, 7.7, 7.8_

  - [x] 5.2 Implement `motionPathConfig` control point builder
    - File `src/data/motionPathConfig.ts` returns control points relative to `bounds.center` and `bounds.fitRadius` such that every sample lies in `[0.4·fitRadius, 4·fitRadius]` from center.
    - Implement orthographic blending logic in `sample` consuming `orthoMix` for cross-fade target.
    - _Requirements: 7.4, 7.5_

  - [x] 5.3 Property test for camera path bounds containment
    - **Property 4: Camera path bounds containment**
    - **Validates: Requirements 7.2, 7.4**
    - Sample 256 evenly spaced t values; assert distance to bounds.center within `[0.4·fitRadius, 4·fitRadius]`.
    - Add property: `t ∈ [0,1]` ⇒ `perspective.position` finite and equal to `curve.getPointAt(t)` within 1e-6.

- [ ] 6. Custom shader and per-layer geometry
  - [x] 6.1 Implement `nekaraMaterial`
    - Files `src/three/materials/nekaraMaterial.ts`, `nekaraMaterial.vert`, `nekaraMaterial.frag` from design §4.3.
    - Export shared `nekaraSharedUniforms` object reference; every material instance binds the same reference and never reassigns it.
    - Clamp `uSchematic`, `uCryo`, `uMass` to `[0,1]` per-weight before mixing; emit weighted sum; clamp final `gl_FragColor.rgb` to `[0,1]` after far-fade.
    - Dissolve gate: discard when blue-noise sample > threshold; for `uDissolve == 1` pass all `vDissolveBand ∈ [0,1]`; for `uDissolve == 0` discard all.
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 5.1, 5.2, 5.3, 5.4_

  - [x] 6.2 Implement `buildLayerObjects` with deterministic dissolve seeding
    - File `src/three/buildLayerObjects.ts`. One `LayerHandle` per non-empty layer; merge geometry via `BufferGeometryUtils.mergeGeometries`; bake per-vertex `aDissolveBand` attribute.
    - Add deterministic 32-bit seed override (`buildLayerObjects(model, targets, { seed })`) in addition to default `Math.random()` for non-cryptographic seeding.
    - Reject seeds outside `[0, 4294967295]` or non-integer with validation error; retain previous behavior unchanged.
    - Insertion order = lexicographic by layer key; populate `targets.layers[key] = { dissolve: 0, explode: 0 }` for every emitted handle.
    - _Requirements: 5.5, 5.6, 19.1, 19.2, 19.3, 19.4, 19.5, 20.3_

  - [x] 6.3 Property test for shader weight non-negativity and dissolve gate
    - **Property 7: Shader weight non-negativity**
    - **Validates: Requirements 3.3, 4.1, 4.4**
    - **Property 5: Layer dissolve monotonicity per beat (frame-stepped simulation)**
    - **Validates: Requirements 5.4, 5.5**
    - Use `fc` to drive `uSchematic + uCryo + uMass` outside `[0.5, 1.5]` and assert the JS-side clamp keeps every per-weight uniform in `[0,1]`; simulate beat tween with `layerDissolveStaggerMs === 0` and assert sign of discrete derivative is constant or zero per layer.

  - [x] 6.4 Property test for deterministic build
    - **Property 12: Deterministic build given same model**
    - **Validates: Requirements 19.1, 19.4**
    - Run `buildLayerObjects(m, t1, { seed: s })` twice with identical inputs; assert byte-identical `key` strings (NFC), insertion order, and `homePosition` components within 1e-9 per axis.

  - [x] 6.5 Implement explode reversibility in frame loop
    - In `nekaraFrame` set `mesh.position = homePosition + explodeVector * clamp(explode, 0, 1)`; treat non-finite/undefined as 0; on missing handle leave last valid position and surface diagnostic.
    - _Requirements: 6.1, 6.2, 6.5_

  - [ ] 6.6 Property test for explode reversibility
    - **Property 6: Explode reversibility**
    - **Validates: Requirements 6.1, 6.2**
    - Generate explode sequences `[1, 0]` and assert `|mesh.position − homePosition| < 1e-6`.

- [x] 7. Post-processing chain
  - [x] 7.1 Implement `createComposer` pipeline
    - File `src/three/postprocessing/createComposer.ts`. Order exactly: `RenderPass → NormalDepth → SSAOPass → OutlinePass → UnrealBloomPass → GrainPass → VignettePass → OutputPass`.
    - Allocate UnrealBloom render target at `(width/4, height/4)` and SSAO at `(width/2, height/2)`; upsample before the next pass.
    - On `composer.setSize` update both render targets to maintain the ratios.
    - _Requirements: 8.1, 8.6, 8.7_

  - [x] 7.2 Implement `OutlinePass`, `GrainPass`, `VignettePass`
    - Files `outlinePass.ts/.frag`, `grainPass.ts/.frag`, `vignettePass.ts`.
    - `OutlinePass` uses depth + normal buffers from `NormalDepth`; never `EdgesGeometry`.
    - Each frame, before composer render, push `targets.post.{outline, bloom, grain, vignette, ssao}` clamped to `[0,1]` into the corresponding pass uniform; substitute `0.0` when value is `undefined | null | NaN`.
    - _Requirements: 8.2, 8.3, 8.4, 8.5_

  - [x] 7.3 Property test for post-uniform clamp + substitution
    - **Property: Post uniform clamp/substitution (Requirements 8.3, 8.4)**
    - **Validates: Requirements 8.3, 8.4**
    - Drive each `targets.post.*` with adversarial `fc.option(fc.double())` (incl. NaN, Infinity, undefined, null); assert pass uniforms end up in `[0,1]` and frame does not throw.

- [ ] 8. Master GSAP timeline
  - [x] 8.1 Implement `gsapSetup` plugin registration
    - File `src/animation/gsapSetup.ts`. Register `ScrollTrigger`, `MotionPathPlugin`, `Observer`, `Flip`, `CustomEase`; create `CustomEase("nekara", "M0,0 C0.18,0 0.04,1 1,1")`.
    - _Requirements: 2.3_

  - [x] 8.2 Implement `buildMasterTimeline`
    - File `src/animation/timeline.ts`.
    - Reject `beats.length < 2` with insufficient-beats error; do not mutate `targets`.
    - For each beat add label at time `i`; tween `targets.state`, `targets.camera`, `targets.post`, `targets.scan`, `targets.dataPanel.opacity`, and per-layer `dissolve`/`explode` so `tl.duration() === beats.length - 1`.
    - Bind `ScrollTrigger.scrub` to a finite value in `[0.1, 2.0]` (default 1.2); pin `#nekara-canvas-pin`.
    - Loop invariant: after adding tween for beat `i`, `tl.duration() === i`.
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9_

  - [x] 8.3 Implement `dissolveStagger` scheduler
    - File `src/animation/dissolveStagger.ts`. When `layerDissolveStaggerMs === 0`, begin updating every layer dissolve within the same animation frame (delta ≤ 16 ms); when > 0 use `gsap` `stagger` config with the beat's millisecond value.
    - _Requirements: 5.5, 5.6_

  - [ ] 8.4 Property test for timeline duration and labels
    - **Property 1: Timeline duration matches beat count**
    - **Validates: Requirements 2.4**
    - **Property 2: Each beat label resolves to its index time**
    - **Validates: Requirements 2.5, 3.2**
    - Generate `fc` arbitrary of `n ∈ [2, 16]` synthetic beats; assert `tl.duration() === n - 1` and `Math.abs(tl.labels[id] - index) < 1e-6` for every beat.

  - [ ] 8.5 Property test for state/post determinism at each label
    - **Property 3: At each label, state matches beat exactly**
    - **Validates: Requirements 2.6, 2.9**
    - Drive `tl.progress(beat.index / (n - 1))` for each beat; assert all `targets.state.*` and `targets.post.*` equal `beat.state`/`beat.post` within 1e-3.
    - Re-visit each progress value twice in random direction and assert numeric-identical results within 1e-3 (Requirement 2.9).

- [ ] 9. Initial reveal and free-orbit handoff
  - [x] 9.1 Implement `initialReveal`
    - File `src/animation/reveal.ts`. Build intro timeline with total duration in `[400, 2000] ms`; while running keep `releaseGate.value === false`; on complete set every `targets.layers[k].dissolve = 1` and `releaseGate.value = true`.
    - On error set `dissolve = 1` for every reachable `k`, set `releaseGate.value = true`, and surface diagnostic identifying missing/failed keys.
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5_

  - [ ] 9.2 Implement free-orbit `release()` handoff
    - In `buildMasterTimeline` add `eventCallback("onUpdate")` triggering `release()` exactly once when `tl.progress() > 0.985`; set internal `released` flag within 16 ms.
    - `release()` enables `OrbitControls.enabled = true`, kills/disables ScrollTrigger pin, completes both within the same animation frame; idempotent on second call; on partial failure leave `released = false` and surface console error identifying which step failed.
    - Maintain invariant `(controls.enabled === true) XOR (tl.scrollTrigger.isActive === true)` every frame.
    - Mouse drag must orbit camera within 100 ms of first pointer-move; do not run scroll-driven camera updates the same frame.
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 14.6_

  - [ ] 9.3 Property test for reveal completion implies all dissolves at 1
    - **Property 10: Initial reveal completion implies all dissolves at 1**
    - **Validates: Requirements 15.2, 15.3, 15.4**
    - Generate random `layerKeys` via `fc.array(fc.string(), { minLength: 0, maxLength: 32 })`; force `intro.eventCallback("onComplete")`; assert every reachable `targets.layers[k].dissolve === 1` and `releaseGate.value === true`.

  - [ ] 9.4 Property test for free-orbit idempotence and exclusivity
    - **Property 8: Beat-09 release idempotence**
    - **Validates: Requirements 14.1, 14.4**
    - **Property 11: Free-orbit handoff exclusivity**
    - **Validates: Requirements 14.3**
    - Call `release()` twice; assert orbit controls stay enabled, ScrollTrigger pin stays released. Drive a frame-by-frame loop and assert XOR invariant holds at every sampled frame.

- [x] 10. Scene mount, scan plane, and labels
  - [x] 10.1 Implement `createScene` and `createRenderer`
    - Files `src/three/createRenderer.ts`, `src/three/createScene.ts`. Mount `WebGLRenderer`, ambient + 3-point lights, ground plane, `stageGroup → rootRotator → modelGroup`.
    - Cap `renderer.pixelRatio` per Requirement 20.1: `1.5` when viewport > 760 CSS px, `1.0` otherwise; never exceed `devicePixelRatio`.
    - _Requirements: 20.1, 20.3_

  - [x] 10.2 Implement scan plane and live integrating area counter
    - File `src/three/scanPlane.ts`. Beat 02 only: shader-driven slab; precompute per-mesh `centroidY` once at `buildLayerObjects` time.
    - Per render frame compute `integratedAreaM2 = Σ mesh.areaM2 over { centroidY > targets.scan.y }` and `faceCount`; round displayed `integratedAreaM2` to 2 decimals; non-decreasing while plane Y descends monotonically; reset to 0 at beat start; hide plane at beat end; ensure equality (within 0.01 m²) to total face area when plane Y is at or below min centroidY.
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7_

  - [x] 10.3 Property test for scan integral monotonicity
    - **Property 17: Scan integral monotonicity**
    - **Validates: Requirements 9.2, 9.3, 9.5, 9.6**
    - Generate `fc.array(fc.double({ min: -100, max: 100 }))`, sort descending, feed `updateScanIntegral(model, y_i, …)`; assert `s_{i+1} ≥ s_i` for the entire sequence; assert convergence to total face area when last y is at or below min centroidY (tolerance 0.01 m²).

  - [x] 10.4 Implement MSDF labels and `Line2` connectors
    - Files `src/three/labels/buildSceneLabels.ts`, `connectorLines.ts`. Beat 04 only: render up to 12 labels per frame for layers with non-zero opacity intersecting the active camera frustum.
    - Animate connector draw length 0→1 over 200 ms with 60 ms stagger; label opacity 0→1 over 160 ms with 80 ms delay.
    - Bundle MSDF font in `public/`; never request remote origins. On `troika-three-text` font load failure: suppress all labels for the rest of Beat 04, emit warning identifying the font, continue subsequent beats without re-attempting until reload.
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 21.3, 21.5, 21.6_

- [ ] 11. Checkpoint - core scene runnable
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 12. Svelte components and HUD
  - [ ] 12.1 Implement `LoaderPanel.svelte`
    - Same-origin fetch of `/Model_SBMBOOST_bom_visual_nonPretty-print.json` exactly once on mount; AbortController-backed 10 s timeout; discard in-flight default fetch when user uploads.
    - File input accepts `application/json` or `.json` extension up to 50 MB; reject other MIME/size with visible error.
    - Error region with `role="alert"` and `tabindex="-1"`; move keyboard focus within 100 ms; preserve previously parsed `ParsedModel`.
    - _Requirements: 1.1, 1.2, 1.4, 1.5, 1.6, 1.7, 21.1, 21.2_

  - [ ] 12.2 Implement `CanvasStage.svelte`
    - Mounts `WebGLRenderer` + `EffectComposer`, owns `nekaraFrame` loop, raycaster click forwarding for `componentBrowser` kind only.
    - Suspends continuous render when `tl.scrollTrigger.isActive === false` for 800 ms; resumes on scroll/invalidation.
    - _Requirements: 2.7, 10.5, 20.2, 20.3_

  - [ ] 12.3 Implement `DataPanel.svelte`
    - Mounted exactly once for the app lifecycle; persists across all beat changes.
    - On beat `dataPanel` change: capture `Flip.getState`, swap content, run `Flip.from` over 200..600 ms.
    - When kind is `null`, render opacity 0 and reject pointer/click input. Visible opacity sourced solely from `targets.dataPanel.opacity`. Unknown kind retains last kind, sets opacity to 0, surfaces error.
    - Render content kinds: `metadata`, `scanCounters`, `layerCard`, `macroSummary`, `specimenCard`, `componentBrowser`.
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6_

  - [ ] 12.4 Implement `ScanlineHUD.svelte`, `CursorReticle.svelte`
    - HUD overlay with timeline rail, beat ticks, and animated reticle along an SVG path via `MotionPathPlugin`; values pulled from `targets` only.
    - _Requirements: 2.2_

  - [ ] 12.5 Implement `NekaraApp.svelte` shell and wiring
    - Mount `LoaderPanel`, `CanvasStage`, `ScanlineHUD`, `CursorReticle`, `DataPanel`.
    - On model commit run in order: `parseBomModel → buildLayerObjects → createCameraRig → buildMasterTimeline`; render only after sequence completes.
    - Halt initialization with configuration error when `validateBeats(BEATS)` fails.
    - _Requirements: 1.3, 2.1, 3.7_

- [ ] 13. Resilience and accessibility
  - [ ] 13.1 Implement resize handler with debounce + Flip
    - File `src/animation/reveal.ts` or new `src/animation/resize.ts`. Debounce window 150 ms; after debounce call `scrollTrigger.refresh()`, set aspect, `updateProjectionMatrix`, `composer.setSize` within 100 ms.
    - Capture `tl.progress()` before rebuild and restore after, with absolute diff ≤ 0.005; coalesce rapid resizes (queue at most one pending rebuild); use `Flip.from` for HUD chrome without unmount/remount.
    - On restore failure, retain prior timeline state, surface recoverable error, leave composer/aspect matching latest viewport.
    - _Requirements: 16.1, 16.2, 16.3, 16.4, 16.5_

  - [ ] 13.2 Property test for resize stability
    - **Property 9: Resize stability**
    - **Validates: Requirements 16.2**
    - Drive synthetic `tl.progress()` values in `[0,1]` and assert post-rebuild progress within 0.005 of captured value.

  - [ ] 13.3 Implement reduced-motion mode
    - File `src/animation/reducedMotion.ts`. When `prefers-reduced-motion: reduce` matches, set `tl.timeScale(2)`, `ScrollTrigger.scrub: true`, clamp bloom/grain pulse amplitude ≤ 25% and frequency ≤ 50% of defaults.
    - React to media-query changes within 500 ms without reload; treat unsupported as `no-preference`.
    - _Requirements: 17.1, 17.2, 17.3, 17.4, 17.5_

  - [ ] 13.4 Implement WebGL context loss recovery
    - On `webglcontextlost` within 100 ms: pause renderer loop, `tl.pause()`, capture `tl.progress() ∈ [0,1]`; HUD displays `"Instrument offline"`.
    - On `webglcontextrestored` within 10 s: re-run `mountStage`, rebuild materials and master timeline, resume timeline at captured progress within 500 ms; HUD removes message.
    - On non-restore within 10 s: HUD shows recovery error; retain captured progress without advancing.
    - _Requirements: 18.1, 18.2, 18.3, 18.4, 18.5_

  - [ ] 13.5 Implement adaptive performance throttle
    - Track 1-second rolling mean frame time; when > 24 ms during active scrolling, reduce `renderer.pixelRatio` in 0.25 steps to a floor of 0.75 until rolling mean returns to ≤ 16 ms; persist for the page lifetime.
    - Merge geometry per layer or use `InstancedMesh` when `layer.meshes.length > 16` to keep ≤ 2 draw calls per active layer.
    - _Requirements: 20.3, 20.4, 20.5_

  - [ ] 13.6 Enforce same-origin asset bundling and CSP
    - Bundle MSDF font and blue-noise PNG in `public/`; configure vite to fail the build if any runtime fetch targets non-same-origin; assert no `eval` / `new Function` usage; reject any shader source from user input or external origins.
    - Surface error within 10 s if a required bundled asset fails to load; never fall back to a third-party CDN.
    - _Requirements: 21.3, 21.4, 21.5, 21.6, 21.7, 21.8_

- [ ] 14. Final wiring and integration
  - [ ] 14.1 Wire `nekaraFrame` master loop
    - Implement frame loop per design §4.8: camera sample → push state uniforms → push per-layer uniforms (dissolve + position) → push post uniforms (with clamp/substitute) → scan plane → composer render.
    - Maintain assertion `targets.state.schematic + targets.state.cryo + targets.state.mass >= 0` (Property 7).
    - _Requirements: 2.2, 2.7, 4.1, 4.2, 4.3, 6.1, 8.2, 8.3, 8.4_

  - [ ] 14.2 Wire raycaster `componentBrowser`
    - Beat 09 only: canvas raycaster forwards click to `DataPanel` and writes `selectedComponentId`; render `name`, `type`, `layerKey`, `macroGroup`, `areaM2`, `dimensionTagsFromName(name)`.
    - _Requirements: 10.5_

  - [ ] 14.3 Integration test - full timeline scrub
    - Drive `window.scrollTo` programmatically across full pinned range; assert `tl.progress()` within 1% of expected at each viewport-height step; assert beat label snap behavior.
    - Scroll to bottom; assert `OrbitControls.enabled === true` and `tl.scrollTrigger?.isActive` falsy.
    - Emulate `prefers-reduced-motion`; assert no bloom pulse and instant scrub.
    - _Requirements: 2.6, 14.3, 17.1_

- [ ] 15. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP delivery.
- All 17 correctness properties in design §11 are mapped to a PBT sub-task: P1→8.4, P2→8.4, P3→8.5, P4→5.3, P5→6.3, P6→6.6, P7→6.3, P8→9.4, P9→13.2, P10→9.3, P11→9.4, P12→6.4, P13→2.6, P14→2.4, P15→2.2, P16→2.4, P17→10.3.
- All 21 requirements have at least one implementation sub-task referencing their numbered acceptance criteria.
- Property tests use `fast-check` with `vitest --run` (no watch mode); fixture-based tests cover the 13-row table from design §4.10.4 and the bundled BOM JSON.
- Checkpoints at tasks 3, 11, and 15 ensure incremental validation between BOM extraction, scene rendering, and full integration.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3"] },
    { "id": 2, "tasks": ["2.1", "4.1", "5.1", "6.1", "7.1", "8.1", "10.1"] },
    { "id": 3, "tasks": ["2.2", "2.3", "4.2", "5.2", "6.2", "7.2", "8.2", "10.2"] },
    { "id": 4, "tasks": ["2.4", "2.5", "4.3", "5.3", "6.3", "6.4", "6.5", "7.3", "8.3", "9.1", "10.3", "10.4"] },
    { "id": 5, "tasks": ["2.6", "6.6", "8.4", "8.5", "9.2", "12.1", "12.2", "12.3", "12.4"] },
    { "id": 6, "tasks": ["9.3", "9.4", "12.5", "13.1", "13.3", "13.4", "13.5", "13.6"] },
    { "id": 7, "tasks": ["13.2", "14.1", "14.2"] },
    { "id": 8, "tasks": ["14.3"] }
  ]
}
```
