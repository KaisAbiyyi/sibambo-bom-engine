# Requirements Document

## Introduction

NEKARA (codename for the `svelte4-3d-presentation` feature) is a forensic-instrument 3D presentation app that renders the SBM BOOST BOM model as a single pinned WebGL canvas driven by a GSAP master timeline scrubbed by ScrollTrigger. The app blends three visual states — Schematic, Cryo, and Mass — across nine narrative beats, ending in free-orbit. It diverges from sibling apps `svelte1`, `svelte2`, and `svelte3` by replacing per-section CSS choreography, manual `requestAnimationFrame` lerp, and click-driven scene switching with a single declarative timeline that owns every uniform, camera position, post-processing weight, and DOM HUD value. The output is the `svelte4` app folder consuming the same BOM JSON file (`Model_SBMBOOST_bom_visual_nonPretty-print.json`) used by the sibling apps.

This document derives requirements from the approved design (`design.md`) covering: model loading, the master timeline, the nine beats, the custom shader, post-processing, MSDF labels, the scan plane integral, the HUD DataPanel, BOM information extraction, free-orbit handoff, resize stability, accessibility, and error recovery.

## Glossary

- **NEKARA_App**: The svelte4 application as a whole; the root Svelte component (`NekaraApp.svelte`) and its mounted services.
- **CanvasStage**: The Three.js renderer + scene + EffectComposer host (`CanvasStage.svelte` plus `three/createScene.ts`).
- **MasterTimeline**: The single GSAP timeline produced by `buildMasterTimeline(beats, targets, layerKeys)`; bound to `ScrollTrigger.scrub`.
- **Beat**: One of nine `Beat` records in `BEATS` (`src/data/beatConfig.ts`); has `id`, `index`, `state`, `cameraT`, post-processing weights, `dataPanel` kind, etc.
- **StateMix**: `{ schematic: number; cryo: number; mass: number }` blend weights driving the fragment shader.
- **NekaraMaterial**: The single custom `ShaderMaterial` (`three/materials/nekaraMaterial.ts`) blending Schematic/Cryo/Mass.
- **CameraRig**: Object returned by `createCameraRig(controlPoints, bounds)` exposing perspective + orthographic cameras and a `sample(t, lookAhead, orthoMix)` method backed by a `CatmullRomCurve3`.
- **NekaraTweenTargets**: The mutable target object whose fields GSAP tweens (`src/types/timeline.ts`) — single source of truth for every visible numeric value.
- **LayerHandle**: Per-layer record returned by `buildLayerObjects(model, targets)` with `key`, `group`, `mesh`, `material`, `homePosition`, `explodeVector`, `dissolveBand`.
- **ScanPlane**: Beat-02 horizontal slab whose Y position is GSAP-driven; reveals layers as it descends.
- **DataPanel**: HUD DOM panel (`DataPanel.svelte`) mounted once and content-swapped per beat across six `DataPanelKind` values plus `null`.
- **DataPanelKind**: One of `metadata | scanCounters | layerCard | macroSummary | specimenCard | componentBrowser | null`.
- **OutlinePass**: Full-screen post-processing pass that detects depth + normal edges (`three/postprocessing/outlinePass.ts`).
- **Composer**: The `EffectComposer` chain `Render → SSAO → Outline → UnrealBloom → Grain → Vignette → Output`.
- **Parser**: `parseBomModel(json, name)` plus the recursive `walkEntity` traversal; produces a `ParsedModel`.
- **BomInfoExtractor**: Pure functions in `src/lib/extractBomInfo.ts` — `extractDocumentMetadata`, `summarizeLayerStats`, `summarizeMacroStats`, `topLevelTypeHistogram`, `dimensionTagsFromName`.
- **BomModelJson**: Source JSON document; fields `schema_version`, `export_level`, `exported_at`, `entities`, optional `materials`.
- **ParsedModel**: In-memory model structure produced by `parseBomModel` (reused from svelte1).
- **LayerKey**: String key derived from entity name via `detectLayerKeyFromName`; falls back to `Face.surface_type` when name resolution fails.
- **MacroGroupKey**: One of the canonical macro buckets (`roof`, `walls`, `structure`, `floor`, `foundation`, plus any extras defined in the reused svelte1 `model.ts`).
- **ReducedMotion**: Browser preference `prefers-reduced-motion: reduce`.
- **FreeOrbit**: Beat-09 mode where `OrbitControls` is enabled and the master timeline pin is released.
- **HUD**: The DOM overlay containing `ScanlineHUD`, `CursorReticle`, `DataPanel`, `LoaderPanel`.
- **NameTags**: `{ dims: number[]; code: string | null; productCode: string | null }` returned by `dimensionTagsFromName`.
- **DocumentMetadata**: Result of `extractDocumentMetadata(json)` — schema/level/exported-at strings plus recursive counts and total area.

## Requirements

### Requirement 1: BOM JSON Loading

**User Story:** As a viewer, I want to load the SBM BOOST BOM JSON model from either the bundled file path or an uploaded file, so that I can present any compatible BOM model in the NEKARA instrument.

#### Acceptance Criteria

1. WHEN the NEKARA_App first mounts, THE NEKARA_App SHALL issue exactly one fetch for `Model_SBMBOOST_bom_visual_nonPretty-print.json` from the same-origin `public/` directory and SHALL complete the fetch within 10 seconds before transitioning out of the loading state.
2. WHEN the user supplies a JSON file via the LoaderPanel upload control with size up to 50 MB, THE NEKARA_App SHALL parse the uploaded file in place of the default fetch and SHALL discard any in-flight default fetch result.
3. WHEN a BOM JSON is parsed successfully, THE NEKARA_App SHALL pass the resulting `ParsedModel` to `buildLayerObjects`, `createCameraRig`, and `buildMasterTimeline` exactly once per load, in that order, before rendering the first frame.
4. IF the fetch returns a non-OK HTTP status (status code outside the 200-299 range), THEN THE LoaderPanel SHALL display an error message that includes the numeric HTTP status code, SHALL keep the loader open, and SHALL retain the previously parsed `ParsedModel` if one exists.
5. IF the fetch fails due to a network error or exceeds the 10 second fetch timeout, THEN THE LoaderPanel SHALL display an error message identifying the failure type and SHALL keep the loader open.
6. IF `parseBomModel` throws because `entities` is missing, not an array, or has length 0, THEN THE LoaderPanel SHALL display the error message in a region with `role="alert"` and `tabindex="-1"`, SHALL move keyboard focus to that region within 100 ms, and SHALL keep the loader open.
7. IF the uploaded file is not valid JSON or exceeds 50 MB, THEN THE LoaderPanel SHALL display an error message identifying the validation failure and SHALL keep the loader open.
8. WHERE `BomModelJson.materials` is absent, null, or an empty object, THE Parser SHALL produce a usable `ParsedModel` with an empty material map without throwing.
9. THE Parser SHALL derive each `LayerKey` from the entity name chain via `detectLayerKeyFromName` and SHALL fall back to `Face.surface_type` only when `detectLayerKeyFromName` returns no match for the entire name chain.

### Requirement 2: Single Pinned Canvas Driven by GSAP Master Timeline

**User Story:** As a viewer, I want the entire scroll experience to be driven by one timeline scrubbed by my scroll position, so that scrubbing forward and backward produces identical visual states without animation drift.

#### Acceptance Criteria

1. THE NEKARA_App SHALL render exactly one pinned WebGL canvas, pinned from the scroll position at which master timeline progress equals 0 to the scroll position at which master timeline progress equals 1.
2. THE MasterTimeline SHALL be the sole owner of every numeric value tweened in `NekaraTweenTargets` (state mix, camera, post, scan, layers), and no other code path SHALL write to those numeric values while the master timeline is active.
3. THE MasterTimeline SHALL be bound to a `ScrollTrigger` instance whose `scrub` value is a finite number in the inclusive range 0.1 to 2.0 seconds.
4. WHEN `buildMasterTimeline(beats, targets, layerKeys)` is invoked with `beats.length >= 2` and returns, THE MasterTimeline SHALL have `tl.duration() === beats.length - 1`.
5. WHEN `buildMasterTimeline` returns with `beats.length >= 2`, THE MasterTimeline SHALL contain exactly one label per beat whose label time in seconds equals `beat.index`.
6. WHEN the timeline progress equals `beat.index / (beats.length - 1)` for any beat, reached by scrolling in either direction, THE NekaraTweenTargets SHALL match `beat.state` and `beat.post` within an absolute tolerance of 1e-3 for every numeric field.
7. WHILE the master timeline is active, THE NEKARA_App SHALL NOT run a manual `requestAnimationFrame` lerp loop outside the renderer loop and ScrollTrigger scrubber.
8. IF `buildMasterTimeline` is invoked with `beats.length < 2`, THEN THE NEKARA_App SHALL reject the call with an error indicating insufficient beats and SHALL NOT mutate `NekaraTweenTargets`.
9. WHEN the same scroll position within the pinned range is visited more than once in any direction, THE NekaraTweenTargets SHALL produce identical numeric values within an absolute tolerance of 1e-3 for every field across visits.

### Requirement 3: Nine Beat Configuration

**User Story:** As a viewer, I want the presentation to follow nine ordered survey beats with distinct camera, state-mix, and post-processing values, so that I experience a deliberate forensic narrative from index to release.

#### Acceptance Criteria

1. THE NEKARA_App SHALL define exactly nine beats, with unique `id` values appearing in this exact order: `index`, `scan`, `cryoLock`, `attribution`, `strata`, `cast`, `assembly`, `archive`, `release`.
2. THE NEKARA_App SHALL assign each beat an integer `index` in the inclusive range `[0, 8]`, equal to its timeline label time in seconds, with each index used exactly once and matching the position of its `id` in the order defined by criterion 1.
3. THE NEKARA_App SHALL constrain every beat's `state.schematic`, `state.cryo`, and `state.mass` values to finite numbers in the inclusive range `[0, 1]`.
4. THE NEKARA_App SHALL constrain every beat's `cameraT` to a finite number in the inclusive range `[0, 1]`.
5. THE NEKARA_App SHALL constrain every beat's `explodeAmount` to a finite number in the inclusive range `[0, 1]`.
6. THE NEKARA_App SHALL set every beat's `dataPanel` to either `null` or exactly one of the six `DataPanelKind` enumeration values defined in the glossary.
7. IF the beat configuration violates any of criteria 1 through 6 at application startup, THEN THE NEKARA_App SHALL halt presentation initialization and surface a configuration error indicating the offending beat `id` and the violated constraint, without rendering any beat.

### Requirement 4: Three-State Blendable Shader

**User Story:** As a viewer, I want the building to render as a continuous blend of Schematic, Cryo, and Mass styles, so that the visual identity changes smoothly with scroll instead of cross-fading three duplicate meshes.

#### Acceptance Criteria

1. THE NekaraMaterial SHALL use a single fragment shader that evaluates the Schematic, Cryo, and Mass shading branches every fragment and outputs `gl_FragColor.rgb` as the weighted sum `uSchematic * schematicColor + uCryo * cryoColor + uMass * massColor`, where each of `uSchematic`, `uCryo`, and `uMass` is a float uniform clamped to the range `[0.0, 1.0]` before use.
2. WHEN any frame is rendered, THE NekaraMaterial SHALL clamp each channel of `gl_FragColor.rgb` to the range `[0.0, 1.0]` after the depth-based far-fade attenuation is applied, and the final per-channel value SHALL be finite (no NaN, no +/-Inf).
3. WHILE `uSchematic + uCryo + uMass` lies in the range `[0.5, 1.5]`, THE NekaraMaterial SHALL produce, for every fragment that is not discarded by the dissolve gate, a fragment color whose RGB and alpha components are finite floats in `[0.0, 1.0]` and SHALL NOT emit a shader-compile or shader-link error.
4. IF `uSchematic + uCryo + uMass` falls outside the range `[0.5, 1.5]`, THEN THE NekaraMaterial SHALL still output a finite fragment color in `[0.0, 1.0]` per channel by relying on the per-weight `[0.0, 1.0]` clamp from criterion 1, without discarding fragments solely due to the out-of-range sum.
5. THE NekaraMaterial SHALL bind the same `nekaraSharedUniforms` object reference to every material instance at construction time, and SHALL NOT reassign, replace, or deep-copy that uniform object reference for the lifetime of the instance, so that mutating a uniform value on `nekaraSharedUniforms` is observable on every NekaraMaterial instance within the next rendered frame.

### Requirement 5: Per-Layer Dissolve Reveal

**User Story:** As a viewer, I want each layer to materialise via a blue-noise dissolve gated by a per-layer band and a global progress value, so that reveals look like forensic scans rather than alpha fades.

#### Acceptance Criteria

1. WHILE `uDissolve` is in the inclusive range `[0, 1]` and `vDissolveBand` is in the inclusive range `[0, 1]`, THE NekaraMaterial SHALL compute a dissolve threshold from `vDissolveBand` and `uDissolve` and SHALL discard any fragment whose blue-noise sample (in the inclusive range `[0, 1]`) is greater than that threshold.
2. WHEN `uDissolve === 1`, THE NekaraMaterial SHALL pass every fragment whose `vDissolveBand` is greater than or equal to `0` and less than or equal to `1` through the dissolve gate without discarding.
3. WHEN `uDissolve === 0`, THE NekaraMaterial SHALL discard every fragment regardless of `vDissolveBand` value.
4. IF `uDissolve` is outside `[0, 1]` or `vDissolveBand` is outside `[0, 1]` or the blue-noise sample cannot be read, THEN THE NekaraMaterial SHALL discard the fragment and SHALL clamp the offending input into `[0, 1]` for any subsequent fragment without throwing a runtime error.
5. WHILE a beat's `layerDissolveStaggerMs === 0` AND that beat's tween is active, THE MasterTimeline SHALL drive `targets.layers[k].dissolve` for every layer `k` such that the value is monotonic (the sign of the discrete derivative across consecutive animation frames is constant or zero) for the full duration of the tween, with start and end values in the inclusive range `[0, 1]`.
6. WHEN a beat's tween starts with `layerDissolveStaggerMs === 0`, THE MasterTimeline SHALL begin updating `targets.layers[k].dissolve` for all layers within the same animation frame (delta less than or equal to 16 ms) so that no layer lags the others.

### Requirement 6: Per-Layer Explode and Reversibility

**User Story:** As a viewer, I want layers to translate along their explode vectors during strata and assembly beats and return cleanly to their home positions, so that the assembly metaphor stays geometrically exact.

#### Acceptance Criteria

1. WHEN the renderer frame loop runs, THE CanvasStage SHALL set each layer mesh position to `homePosition + explodeVector * e`, where `e` is the value of `targets.layers[key].explode` constrained to the closed range `[0, 1]` and treated as `0` if the value is non-finite or undefined.
2. WHEN `targets.layers[k].explode` transitions from `1` to `0` for any layer handle, THE CanvasStage SHALL, on the next frame loop tick, place that layer's mesh at a position whose Euclidean distance from `homePosition` is less than `1e-6` scene units.
3. THE NEKARA_App SHALL accept exactly two `explodeAxis` values per beat: `"y"` and `"radial"`, and no other values.
4. IF a beat configuration specifies an `explodeAxis` value other than `"y"` or `"radial"`, THEN THE NEKARA_App SHALL reject the configuration at load time with an error indicating the invalid axis value and SHALL NOT begin runtime playback.
5. IF a layer handle referenced by `targets.layers` has no defined `explodeVector` or `homePosition`, THEN THE CanvasStage SHALL leave that layer's mesh at its last valid position for the current frame and SHALL surface a diagnostic indicating the missing layer handle.

### Requirement 7: Camera MotionPath

**User Story:** As a viewer, I want the camera to travel along a smooth 3D bezier path keyed to scroll progress, so that camera motion is continuous and never re-samples discrete presets.

#### Acceptance Criteria

1. THE CameraRig SHALL be constructed from between 4 and 32 control points inclusive and SHALL expose a non-closed `CatmullRomCurve3` built from those control points with C1 continuity across all interior segments.
2. WHEN `rig.sample(t, lookAhead, orthoMix)` is called with `t` in `[0, 1]`, `lookAhead` in `[0, 0.25]`, and `orthoMix` in `[0, 1]`, THE CameraRig SHALL set `perspective.position` to a finite `Vector3` whose components each equal the corresponding component of `curve.getPointAt(t)` within an absolute tolerance of `1e-6`.
3. WHEN `rig.sample(t, lookAhead, orthoMix)` returns, THE CameraRig SHALL leave `perspective.matrixWorld` consistent with the just-written `perspective.position` and look-at target such that a caller reading `matrixWorld` immediately afterward observes the updated transform without invoking `updateMatrixWorld`.
4. FOR ALL `t` in `[0, 1]` sampled at 256 evenly spaced points, THE CameraRig SHALL place `curve.getPointAt(t)` at a distance from `bounds.center` between `0.4 * bounds.fitRadius` and `4 * bounds.fitRadius` inclusive.
5. WHEN a beat with `ortho` equal to `true` becomes active, THE CameraRig SHALL tween `targets.camera.orthoMix` from its current value toward `1` over 600 ms using a monotonically non-decreasing easing, ending with `targets.camera.orthoMix` equal to `1` within `1e-3` so the renderer cross-fades to the orthographic projection.
6. WHEN `rig.sample(t, lookAhead, orthoMix)` is called, THE CameraRig SHALL orient the camera to look at `curve.getPointAt(min(t + lookAhead, 1))` so the view direction tracks the path tangent.
7. IF `rig.sample` is called with `t` outside `[0, 1]`, `lookAhead` outside `[0, 0.25]`, or `orthoMix` outside `[0, 1]`, THEN THE CameraRig SHALL clamp each out-of-range argument to the nearest boundary of its declared range before sampling and SHALL NOT throw.
8. IF the CameraRig is constructed with fewer than 4 control points or with any control point containing a non-finite component, THEN THE CameraRig SHALL raise a construction error indicating invalid control points and SHALL NOT expose a curve.

### Requirement 8: Post-Processing Pipeline

**User Story:** As a viewer, I want a forensic-instrument visual feel via outline, SSAO, bloom, grain, and vignette passes whose weights track the timeline, so that the post-processing language matches each beat.

#### Acceptance Criteria

1. THE Composer SHALL chain the passes in exactly this order with no additional passes inserted between them: `RenderPass → NormalDepth → SSAOPass → OutlinePass → UnrealBloomPass → GrainPass → VignettePass → OutputPass`.
2. WHEN any frame is rendered, THE CanvasStage SHALL read `targets.post.{outline, bloom, grain, vignette, ssao}` and assign them to `outlinePass.uniforms.uThickness.value`, `bloomPass.strength`, `grainPass.uniforms.uAmount.value`, `vignettePass.uniforms.uAmount.value`, and `ssaoPass.intensity` respectively, before the composer render call for that frame.
3. WHEN any frame is rendered, THE CanvasStage SHALL clamp each `targets.post` value to the inclusive range `0.0` to `1.0` before assignment, treating values below `0.0` as `0.0` and values above `1.0` as `1.0`.
4. IF any of `targets.post.outline`, `targets.post.bloom`, `targets.post.grain`, `targets.post.vignette`, or `targets.post.ssao` is `undefined`, `null`, or `NaN` for the current frame, THEN THE CanvasStage SHALL substitute the value `0.0` for that channel for that frame and continue rendering without throwing.
5. THE OutlinePass SHALL detect edges using the scene depth buffer and the scene normal buffer produced by the `NormalDepth` pass, and SHALL NOT use `EdgesGeometry` or any per-mesh CPU-side edge geometry as the edge source.
6. THE Composer SHALL allocate the `UnrealBloomPass` render target at one quarter of the composer output resolution on each axis (width/4, height/4) and the `SSAOPass` render target at one half of the composer output resolution on each axis (width/2, height/2), and SHALL upsample their results to full composer resolution before the next pass consumes them.
7. WHEN the composer output resolution changes, THE Composer SHALL resize the `UnrealBloomPass` and `SSAOPass` render targets to maintain the one-quarter and one-half ratios specified in criterion 6 before the next frame is rendered.

### Requirement 9: Scan Plane and Live Integrating Area Counter

**User Story:** As a viewer, I want Beat 02 to descend a scan plane through the building while the HUD integrates the swept area in real time, so that the model "develops" like a CT plate with a numeric narration.

#### Acceptance Criteria

1. WHILE Beat 02 (`scan`) is active, THE CanvasStage SHALL set `scanPlane.visible` to `true` and SHALL render the ScanPlane with its Y position equal to `targets.scan.y` on every render frame.
2. WHILE Beat 02 is active, THE NEKARA_App SHALL recompute `integratedAreaM2` and `faceCount` once per render frame such that `integratedAreaM2 === Σ mesh.areaM2 over { mesh | mesh.centroidY > targets.scan.y }` and `faceCount === count of { mesh | mesh.centroidY > targets.scan.y }`.
3. WHILE the scan plane Y descends monotonically through Beat 02, THE NEKARA_App SHALL produce a non-decreasing sequence of displayed `integratedAreaM2` values, with each displayed value rounded to 2 decimal places.
4. WHEN Beat 02 begins, THE NEKARA_App SHALL initialize `integratedAreaM2` to `0` and `faceCount` to `0` before the first scan-integral evaluation of the beat.
5. WHEN Beat 02 ends, THE CanvasStage SHALL hide the ScanPlane by setting `scanPlane.visible` to `false`.
6. WHEN Beat 02 ends with the scan plane Y at or below the minimum `mesh.centroidY` across all meshes, THE NEKARA_App SHALL ensure displayed `integratedAreaM2` equals `Σ mesh.areaM2 over all meshes` within a tolerance of `0.01 m²`.
7. THE CanvasStage SHALL precompute and cache each mesh's `centroidY` once at `buildLayerObjects` time and SHALL reuse the cached value on every scan-integral evaluation.

### Requirement 10: HUD DataPanel

**User Story:** As a viewer, I want one HUD panel that swaps content per beat while preserving its layout via `Flip`, so that I receive contextual BOM information without reflow flicker.

#### Acceptance Criteria

1. THE NEKARA_App SHALL mount the DataPanel exactly once during the app lifecycle, and the DataPanel instance SHALL persist across all beat changes without unmount or remount.
2. WHEN a beat's `dataPanel` kind changes, THE DataPanel SHALL capture layout via `Flip.getState` before the Svelte content update and SHALL invoke `Flip.from` after the content commit, with the Flip transition completing within 200 to 600 milliseconds.
3. IF a beat's `dataPanel` is `null`, THEN THE DataPanel SHALL render with opacity equal to `0` and SHALL reject all pointer and click input such that no interactive callback fires.
4. THE DataPanel SHALL render its visible opacity as a value in the range `0` to `1` driven by the MasterTimeline via `targets.dataPanel.opacity`, with no other source permitted to override that value.
5. WHILE the active beat's `dataPanel` kind equals `componentBrowser`, THE DataPanel SHALL accept user click input forwarded by the canvas raycaster; for every other non-null `dataPanel` kind, THE DataPanel SHALL ignore raycaster click input.
6. IF a beat's `dataPanel` kind is not recognized by the DataPanel, THEN THE DataPanel SHALL retain the previously rendered kind, SHALL set opacity to `0`, and SHALL surface an error indication that the kind is unsupported.

### Requirement 11: BOM Information Extraction

**User Story:** As a viewer, I want the document metadata, layer statistics, macro statistics, and entity-name dimension tags surfaced accurately in the HUD, so that the data shown traces back to the source JSON.

#### Acceptance Criteria

1. WHEN `extractDocumentMetadata(json)` returns, THE BomInfoExtractor SHALL set `schemaVersion`, `exportLevel`, and `exportedAt` to the corresponding input value when that value is a string, and to `""` when the field is absent, `null`, `undefined`, or not of type string.
2. WHEN `extractDocumentMetadata(json)` returns, THE BomInfoExtractor SHALL set `entityCount` to `(json.entities ?? []).length` when `json.entities` is an array or absent, set `entityCount` to `0` when `json.entities` is present but not an array, and set `hasMaterials` to `Object.prototype.hasOwnProperty.call(json, "materials")`.
3. WHEN `extractDocumentMetadata(json)` returns, THE BomInfoExtractor SHALL set `totalAreaM2` to the sum of `face.area_m2` over every entity whose `type` equals `"Face"` reachable by recursive traversal of `json.entities` and each entity's `children` array, treating any `area_m2` that is absent, `null`, `undefined`, or not a finite number as `0`.
4. WHEN `summarizeLayerStats(model)` returns, THE BomInfoExtractor SHALL produce exactly one entry for each key in `model.layerRegistry` whose associated mesh count is greater than `0`, SHALL order entries by ascending layer key using lexicographic comparison, and SHALL satisfy `|Σ entry.totalAreaM2 − Σ over model.meshes of mesh.areaM2| ≤ 1e-6`.
5. WHEN `summarizeMacroStats(model)` returns, THE BomInfoExtractor SHALL order entries by ascending macro key using lexicographic comparison and SHALL satisfy `|Σ entry.totalAreaM2 − Σ summarizeLayerStats(model).totalAreaM2| ≤ 1e-6`.
6. WHEN `topLevelTypeHistogram(json)` returns, THE BomInfoExtractor SHALL satisfy `Σ values === (json.entities ?? []).length` when `json.entities` is an array or absent, SHALL bucket every entity whose `type` is absent, `null`, `undefined`, or not of type string under the key `"unknown"`, and SHALL return an empty histogram when `json.entities` is present but not an array.
7. IF `json` passed to any BomInfoExtractor function is `null` or `undefined`, THEN THE BomInfoExtractor SHALL return the same shape of output it returns for an empty document, with all string fields set to `""`, all numeric fields set to `0`, all boolean fields set to `false`, and all collection fields set to empty, without throwing.
8. THE BomInfoExtractor functions SHALL be pure: they SHALL NOT perform I/O, SHALL NOT mutate their input or any object reachable from it, and SHALL NOT call `Date.now`, `Date()`, `performance.now`, or `Math.random`.

### Requirement 12: Entity-Name Dimension Parser

**User Story:** As a viewer, I want top-level entity names parsed into dimensions, engineering codes, and product codes in a deterministic total order, so that labels like `J0006 - Jendela 120x120_web_159` produce stable structured tags.

#### Acceptance Criteria

1. WHEN `dimensionTagsFromName(name)` is invoked with a string of length 0 to 512 characters, THE BomInfoExtractor SHALL execute the regex chain in the fixed order `productCode → prefix code → bracketed code → dimensions`, removing each matched substring from the working buffer before the next class runs, and SHALL return a result object containing the fields `dims`, `code`, and `productCode`.
2. WHEN `dimensionTagsFromName(name)` returns, THE BomInfoExtractor SHALL produce `dims` as an array of length 0 to 4 where each element is a finite number greater than `0` and less than or equal to `100000`, ordered by the position of its match in the input string from left to right.
3. WHEN `dimensionTagsFromName(name)` returns, THE BomInfoExtractor SHALL produce `code` either as `null` when no prefix or bracketed code matches, or as a string of length 2 to 16 characters matching `/^[A-Z][A-Z0-9]*\d+$/`.
4. WHEN `dimensionTagsFromName(name)` returns, THE BomInfoExtractor SHALL produce `productCode` either as `null` when no product code matches, or as a string of length 5 to 32 characters matching `/^web_\d+$/`.
5. FOR ALL strings `s` of length 0 to 512 characters, THE BomInfoExtractor SHALL ensure that two invocations of `dimensionTagsFromName(s)` within the same process return results that are deeply equal in field set, field types, and field values, with no dependence on invocation order, wall-clock time, or prior call history.
6. FOR ALL 13 fixture entries defined in §4.10.4 of the design document, WHEN `dimensionTagsFromName(name)` is invoked with the fixture `name`, THE BomInfoExtractor SHALL return a result deeply equal to the fixture's expected `NameTags` row across the fields `dims`, `code`, and `productCode`.
7. IF `name` is `null`, `undefined`, not a string, or exceeds 512 characters, THEN THE BomInfoExtractor SHALL return a result with `dims` as an empty array, `code` as `null`, and `productCode` as `null`, and SHALL surface an error indication to the caller identifying the invalid input without throwing an unhandled exception.

### Requirement 13: MSDF Scene Labels and Connectors

**User Story:** As a viewer, I want layer labels rendered as MSDF text meshes inside the WebGL scene with `Line2` connectors, so that labels integrate with depth, outline, and post-processing without reprojecting DOM elements every frame.

#### Acceptance Criteria

1. WHILE Beat 04 (`attribution`) is active, THE CanvasStage SHALL render exactly one MSDF text mesh and one `Line2` connector for each layer whose mesh has non-zero opacity and intersects the active camera frustum, up to a maximum of 12 layers per beat.
2. WHEN Beat 04 begins, THE MasterTimeline SHALL animate each connector's draw length from `0` to `1` over 200 ms with a 60 ms stagger between successive connectors, and SHALL start each label's opacity tween from `0` to `1` over 160 ms beginning 80 ms after that connector's draw animation starts.
3. THE NEKARA_App SHALL bundle the MSDF font file within the application package at build time and SHALL NOT issue network requests to remote origins to load the font at runtime.
4. IF `troika-three-text` reports a font load failure during Beat 04, THEN THE CanvasStage SHALL suppress all label and connector rendering for the remainder of Beat 04, SHALL emit a warning log entry indicating the font load failure with the failing font identifier, and SHALL continue rendering subsequent beats without further label load attempts until the application is reloaded.

### Requirement 14: Free-Orbit Handoff at Beat 09

**User Story:** As a viewer, I want the final beat to release the camera to my mouse so I can orbit the model freely, so that the instrument hands the specimen over to me at the end.

#### Acceptance Criteria

1. WHEN `tl.progress()` exceeds `0.985` for the first time within a single timeline playback, THE MasterTimeline SHALL invoke `release()` exactly once and SHALL set an internal `released` flag to `true` within 16 milliseconds of the threshold being crossed.
2. WHEN `release()` runs, THE NEKARA_App SHALL set `OrbitControls.enabled` to `true`, SHALL release the ScrollTrigger pin by calling its disable/kill method, and SHALL complete both state changes within the same animation frame (within 16 milliseconds).
3. WHILE the page is loaded and the MasterTimeline exists, THE NEKARA_App SHALL satisfy `(OrbitControls.enabled === true) XOR (tl.scrollTrigger.isActive === true)` on every rendered frame, with no frame permitted to violate this invariant.
4. IF `release()` is called while the internal `released` flag is already `true`, THEN THE NEKARA_App SHALL treat the call as a no-op, SHALL leave `OrbitControls.enabled` equal to `true`, SHALL leave the ScrollTrigger pin in its released state, and SHALL NOT re-trigger any release side effects.
5. WHEN `OrbitControls.enabled` transitions to `true` via `release()`, THE NEKARA_App SHALL respond to mouse drag input by orbiting the camera around the model within 100 milliseconds of the first pointer-move event, with no scroll-driven camera updates applied to the same frame.
6. IF `release()` fails to set `OrbitControls.enabled` to `true` or fails to release the ScrollTrigger pin, THEN THE NEKARA_App SHALL retain the pre-call camera control state, SHALL leave the `released` flag as `false`, and SHALL surface an error indication to the developer console identifying which of the two operations failed.

### Requirement 15: Initial Reveal

**User Story:** As a viewer, I want a brief intro animation that builds the schematic in before scroll-driven beats take over, so that the first frame is not a blank canvas.

#### Acceptance Criteria

1. WHEN the model is committed, THE NEKARA_App SHALL invoke `initialReveal(targets, layerKeys, releaseGate)` exactly once per commit event, with total animation duration between 400 and 2000 milliseconds inclusive.
2. WHILE `initialReveal` is running, THE NEKARA_App SHALL keep `releaseGate.value` equal to `false` so scroll-driven beats are suppressed until the reveal completes.
3. WHEN `initialReveal` completes successfully, THE NEKARA_App SHALL set `targets.layers[k].dissolve` to exactly `1` for every `k` in `layerKeys`.
4. WHEN `initialReveal` completes successfully, THE NEKARA_App SHALL set `releaseGate.value` to `true`.
5. IF `initialReveal` fails to complete or any `k` in `layerKeys` is missing from `targets.layers`, THEN THE NEKARA_App SHALL set `targets.layers[k].dissolve` to `1` for every reachable `k`, set `releaseGate.value` to `true`, and surface an error indication identifying the missing or failed layer keys.

### Requirement 16: Resize Stability

**User Story:** As a viewer, I want the app to handle window resize without losing my scroll position or jumping the timeline, so that I can resize during a scrub without the scene jumping.

#### Acceptance Criteria

1. WHEN a `resize` event fires on `window` and at least 150 ms has elapsed since the previous handled `resize` event (debounce window), THE NEKARA_App SHALL call `scrollTrigger.refresh()`, set `rig.perspective.aspect` to `window.innerWidth / window.innerHeight`, call `rig.perspective.updateProjectionMatrix()`, and call `composer.setSize(window.innerWidth, window.innerHeight)` within 100 ms of the debounce window expiring.
2. WHEN `rebuild()` runs in response to a resize, THE MasterTimeline SHALL capture `tl.progress()` before teardown, restore it after rebuild, and the absolute difference between restored and captured progress SHALL be at most `0.005` (0.5%).
3. WHEN `rebuild()` runs, THE NEKARA_App SHALL animate HUD chrome position and size transitions via `Flip.from` using the pre-rebuild captured state, and SHALL NOT unmount or remount any HUD chrome DOM node during the rebuild.
4. IF a `resize` event fires while a `rebuild()` is already in progress, THEN THE NEKARA_App SHALL queue at most one pending rebuild, discard additional resize events until the in-progress rebuild completes, and run the queued rebuild using the latest `window.innerWidth` and `window.innerHeight` values observed at queue-flush time.
5. IF `rebuild()` fails to restore `tl.progress()` within the `0.005` tolerance, THEN THE NEKARA_App SHALL retain the prior timeline state, surface a recoverable error indicating resize-rebuild failure, and leave `composer` size and `rig.perspective.aspect` matching the current `window.innerWidth` and `window.innerHeight`.

### Requirement 17: Reduced Motion Accessibility

**User Story:** As a viewer who prefers reduced motion, I want the scrub to be instant and bloom/grain pulses damped, so that I can use the app without motion-sickness triggers.

#### Acceptance Criteria

1. WHILE `prefers-reduced-motion: reduce` matches, THE NEKARA_App SHALL set `tl.timeScale(2)` and configure `ScrollTrigger.scrub` to `true` such that timeline progress tracks scroll position with no interpolation delay.
2. WHILE `prefers-reduced-motion: reduce` matches, THE NEKARA_App SHALL clamp bloom and grain pulse tween amplitude to no more than 25% of the default amplitude and clamp pulse frequency to no more than 50% of the default frequency.
3. WHEN the `prefers-reduced-motion` media query state changes, THE NEKARA_App SHALL apply the new `timeScale`, `scrub`, and pulse-clamp settings within 500 ms and without requiring a page reload.
4. WHILE `prefers-reduced-motion: reduce` does not match, THE NEKARA_App SHALL use the default `timeScale`, default `ScrollTrigger.scrub` easing, and default bloom and grain pulse amplitude and frequency without applying the reduced-motion clamps.
5. IF the `prefers-reduced-motion` media query is unsupported or returns no value at runtime, THEN THE NEKARA_App SHALL treat the preference as "no-preference" and apply default motion settings.

### Requirement 18: WebGL Context Loss Recovery

**User Story:** As a viewer, I want the app to recover from a WebGL context loss event, so that a transient driver hiccup does not leave the canvas permanently black.

#### Acceptance Criteria

1. WHEN the `webglcontextlost` event fires, THE NEKARA_App SHALL pause the renderer loop within 100 ms, call `tl.pause()`, and capture the current `tl.progress()` value as a numeric value in the range `0.0` to `1.0` for later resume.
2. WHILE the WebGL context is in the lost state, THE HUD SHALL display the message `"Instrument offline"`.
3. WHEN the `webglcontextrestored` event fires within 10 seconds of the `webglcontextlost` event, THE NEKARA_App SHALL re-run `mountStage`, rebuild materials and the master timeline, and SHALL resume the timeline at the `tl.progress()` value captured at context loss within 500 ms of the restore event.
4. WHEN the timeline resume completes after context restoration, THE HUD SHALL remove the `"Instrument offline"` message.
5. IF the WebGL context is not restored within 10 seconds of the `webglcontextlost` event, THEN THE HUD SHALL display an error message indicating that the instrument could not recover, and THE NEKARA_App SHALL retain the captured `tl.progress()` value without advancing the timeline.

### Requirement 19: Build Determinism

**User Story:** As a developer, I want repeated builds of layer handles from the same parsed model to be deterministic, so that snapshot tests and dissolve bands stay stable across reloads.

#### Acceptance Criteria

1. WHEN `buildLayerObjects(m, t)` is invoked two or more times with the same `ParsedModel m` instance (byte-for-byte identical input) within a single process lifetime, THE NEKARA_App SHALL return `LayerHandle` arrays of identical length where, for every index `i`, the entries satisfy: identical insertion order, strictly equal `key` string values (case-sensitive, Unicode NFC-normalized), and `homePosition` vector components equal within an absolute tolerance of `1e-9` per axis.
2. IF `buildLayerObjects` is invoked with a `ParsedModel` whose layer set is empty or malformed (missing required `key` or `homePosition` fields on any layer), THEN THE NEKARA_App SHALL return an empty `LayerHandle` array and SHALL surface a build error indicating the offending layer index without mutating any prior cached build state.
3. THE NEKARA_App SHALL restrict use of `Math.random()` to non-cryptographic dissolve-band seeding only and SHALL NOT invoke `Math.random()` from any code path reachable by `buildLayerObjects`.
4. WHEN a deterministic seed override is supplied for dissolve-band seeding (a 32-bit unsigned integer in the range `0` to `4294967295`), THE NEKARA_App SHALL use that seed in place of `Math.random()` such that two runs with the same seed and same `ParsedModel` produce byte-identical dissolve-band output, and SHALL expose this override through a documented test-only entry point.
5. IF a supplied deterministic seed override is outside the 32-bit unsigned integer range, not an integer, or not a number, THEN THE NEKARA_App SHALL reject the override with a validation error indicating the invalid seed value and SHALL retain the previously active seeding behavior unchanged.

### Requirement 20: Performance Budget

**User Story:** As a viewer on a mid-range desktop, I want the app to render within a 16 ms frame budget at 1080p, so that scrubbing stays smooth.

#### Acceptance Criteria

1. THE NEKARA_App SHALL cap `renderer.pixelRatio` at `1.5` on viewports wider than 760 CSS pixels and at `1.0` on viewports of 760 CSS pixels or narrower, and SHALL never exceed the device's native `devicePixelRatio`.
2. WHILE `tl.scrollTrigger.isActive` remains `false` for at least 800 ms, THE CanvasStage SHALL halt the continuous render loop and SHALL only repaint in response to a resumed scroll event or an explicit invalidation of a tracked render input.
3. THE CanvasStage SHALL keep per-frame draw calls at no more than 2 draw calls per active layer, by merging geometry per layer or using `InstancedMesh` when `layer.meshes.length` is greater than 16.
4. WHILE the viewport is rendered at 1920×1080 CSS pixels on the designated mid-range desktop test profile (4 logical CPU cores at 2.5 GHz or faster, integrated GPU at the level of Intel Iris Xe or better, 16 GB RAM), THE CanvasStage SHALL keep the median frame time at or below 16 ms and the 95th percentile frame time at or below 24 ms, measured over any continuous 5-second scroll window.
5. IF the rolling 1-second mean frame time exceeds 24 ms during active scrolling, THEN THE CanvasStage SHALL reduce `renderer.pixelRatio` in steps of `0.25` down to a floor of `0.75` until the rolling 1-second mean frame time returns to 16 ms or less, and SHALL retain the reduced value until the next page load.

### Requirement 21: Asset Bundling and Same-Origin Loading

**User Story:** As a security reviewer, I want all assets and JSON loaded from the same origin, so that the app does not depend on third-party CDNs at runtime.

#### Acceptance Criteria

1. THE NEKARA_App SHALL load JSON model data only from the bundled `public/` directory served by the same origin as the application document, or from a user-supplied file selected via the local file input.
2. WHEN a user supplies a JSON file via the file input, THE NEKARA_App SHALL accept files with MIME type `application/json` or `.json` extension up to 50 MB and reject any other file with a visible error indicating unsupported file type or size.
3. THE NEKARA_App SHALL bundle the MSDF font asset with the application and serve it from the same origin as the application document.
4. THE NEKARA_App SHALL bundle the blue-noise PNG asset with the application and serve it from the same origin as the application document.
5. THE NEKARA_App SHALL NOT issue runtime network requests for JSON, fonts, textures, shaders, or scripts to any origin other than the application's own origin.
6. IF a required bundled asset (MSDF font or blue-noise PNG) fails to load within 10 seconds, THEN THE NEKARA_App SHALL display an error indicating the missing asset and SHALL NOT attempt to fetch a replacement from a third-party origin.
7. THE NEKARA_App SHALL NOT invoke `eval`, `new Function`, or equivalent dynamic code-execution constructs at runtime.
8. THE NEKARA_App SHALL NOT compile, link, or execute shader source code obtained from user-supplied input or from any external origin.
