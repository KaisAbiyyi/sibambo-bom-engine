# Iteration 2 — SMBOOST Room, Opening, and Component Visibility

## Result

Both authoritative fixtures now match required logical counts. Downstream readiness is enabled for both.

| Fixture | Before rooms | After rooms | Before door nodes | After logical doors | Before window nodes | After logical windows | Addressable walls | Unresolved | Duplicates |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `smboost-model-1` / `PROJECT SBOOST 1_model-eval.json` | 8 | 7 | 31 | 4 | 34 | 8 | 46 | 0 | 0 |
| `smboost-model-2` / `PROJECT SBOOST 2_model-eval.json` | 16 | 6 | 28 | 4 | 36 | 9 | 48 | 0 | 0 |

Before opening counts were hierarchy-node counts. Frames, leaves, swing helpers, glass, and panels were counted independently. After counts represent root logical assemblies.

## Root causes

- Room detector treated multiple finish/structural layers at 0.04–0.10 m elevation offsets as separate rooms.
- Room IDs depended on traversal order.
- Model 2 contains repeated small entrance-side landing footprints. They are outside the entrance door and are not interior rooms, despite carrying horizontal finish geometry.
- Door/window detection counted descendant nodes rather than top-level component instances.
- Reused definition meshes had category-level visibility only. One occurrence could not be hidden independently.
- Model checker exposed aggregate category rows only.

## Rules and tolerances

### Fixture routing

- Specialized pipeline activates only for recognized source aliases of `PROJECT SBOOST !/1/2` and `SMBOOST model 1/2`.
- Expected counts are used only in validation and tests. They do not truncate, pad, or index-map results.

### Rooms

- Candidate source: target finish-floor hierarchy alias `Keramik Lantai`.
- Top surface: horizontal ratio >= 0.90, upward normal Y > 0.70, area >= 1 m².
- Ceiling: 1.8–5 m above candidate, plan overlap >= 0.35.
- Valid boundary coverage: >= 0.82. Nearly closed door gaps remain valid.
- Merge compatibility: same direct parent group, floor elevation difference <= 0.15 m, height difference <= 0.35 m.
- Shared-boundary match: plane gap <= 0.12 m, overlap >= 0.20 m.
- Partition preservation: wall plane tolerance 0.18 m; meaningful projected wall overlap blocks merge.
- Model 2 landing rejection uses combined evidence: area outlier, real separation from a >=3× larger candidate, entrance door on footprint, then repeated-plan propagation to matching storey footprint.
- IDs hash sorted source evidence. No traversal index is included.

### Openings

- Candidate root is highest hierarchy instance with explicit `P####`/`J####`, `pintu`/`door`, or `jendela`/`window` evidence.
- All descendant frame, panel, leaf, glass, trim, notation, and helper meshes bind to one logical component.
- Door evidence combines explicit name, wall association, floor contact, plausible width/height/depth, and frame/leaf hierarchy.
- Window evidence combines explicit name, wall association, elevated sill, plausible dimensions, and glass/frame hierarchy.
- Wall association is rejected below score 0.25. Cabinet/furniture hierarchy is rejected explicitly.
- Ambiguous candidates stay `unresolved_opening`.
- Duplicate threshold: projected overlap >= 0.80, centroid distance <= 0.12 m, maximum size delta <= 0.12 m. Merged IDs are recorded in `mergedFrom`.

### Visibility and UI

- Runtime binding key is `(instancePath, sourceFaceId)`, not mesh definition ID.
- Reused mesh occurrences split into independently visible component groups.
- Category state and component state are combined centrally. Category-off always wins.
- Wall, door, window, and unresolved-opening rows are collapsible. Parent checkboxes expose checked/unchecked/indeterminate state.
- Component row supports hide/show, hover highlight, and persistent selection highlight.
- Helpers and room/debug overlays remain outside building component state.

## Validation extension

Added:

- expected/detected room count and match state;
- expected/detected door count;
- expected/detected window count;
- unresolved opening count;
- duplicate opening count;
- detected and individually addressable wall count;
- fixture warnings and downstream readiness.

Readiness requires exact fixture validation, zero unresolved openings, addressable walls, and positive room area/volume.

## Files changed for Iteration 2

- `src/lib/smboost-analysis.ts`
- `src/lib/smboost-analysis.test.ts`
- `src/lib/model.ts`
- `src/lib/model-regression.test.ts`
- `src/lib/render/build-runtime-scene.ts`
- `src/lib/render/build-runtime-scene.test.ts`
- `src/lib/render/visibility.ts`
- `src/lib/render/visibility.test.ts`
- `src/lib/ModelCanvas.svelte`
- `src/routes/+page.svelte`
- `docs/ITERATION_2_SMBOOST_ROOM_OPENING_VISIBILITY_REPORT.md`

## Verification

- `bun test src/`: 432 pass, 0 fail, 1,938 assertions.
- `bun run check`: 0 errors, 0 warnings.
- `bun run build`: passed.
- `git diff --check`: passed.
- Build warning: client chunk `664.17 kB` exceeds Vite's 500 kB advisory threshold. Existing code-splitting concern; no functional failure.

## Known limitations

- Pipeline intentionally targets two SMBOOST fixture families. It does not claim general room/opening accuracy for unrelated models.
- Finish-floor alias and orthogonal shared-boundary logic reflect source authoring conventions in these fixtures.
- Merged footprint fallback uses convex hull when exact boundary stitching is unavailable; area remains evidence-area sum.
- Opening topology records nearest host wall and floor. Full room-to-room access graph integration remains separate from this targeted iteration.
- No door/window manual override, confidence UI, furniture classifier, structural merge, or analysis formula changes were added.
