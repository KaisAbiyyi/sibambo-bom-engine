# Building Classifier Rule Bank v1

Runtime version: `building-classifier-rules/1.0.0`.

Source:

- `model-eval/src/lib/classifier/rule-bank-v1.ts`: declarative general rules.
- `model-eval/src/lib/classifier/classifier.ts`: evidence extraction, scoring, conflict resolution, explanation trace.
- `model-eval/src/lib/classifier/model-overrides.ts`: isolated model-specific overrides. Empty by default.
- `model-eval/src/lib/classifier/metrics.ts`: precision, recall, F1, confusion matrix, unknown, and ambiguity metrics.

## Categories

`roof`, `floor`, `ceiling`, `exterior_wall`, `interior_wall`, `door`, `window`, `column`, `beam`, `stair`, `railing`, `furniture`, `fixture`, `opening`, `room_boundary`, and `unknown`.

`unknown` is a deliberate result. Weak or conflicting evidence is not forced into a building category.

## Rule contract

Each rule contains:

- stable rule ID;
- target category;
- optional required-all and required-any evidence gates;
- positive evidence and weight;
- negative evidence and penalty weight;
- optional base score;
- confidence threshold;
- human-readable explanation.

Rules stay model-agnostic. Any unavoidable exception belongs in `model-overrides.ts`, requires a model and face pattern, includes a reason, and appears in the trace as `modelSpecificOverride`.

## Evidence hierarchy

Evidence is collected before rule evaluation:

1. explicit metadata, tag/layer, hierarchy, group, component, and definition labels;
2. normalized multilingual tokens;
3. definition/instance reuse and repetition;
4. face topology and holes;
5. spatial adjacency and opening clusters;
6. surface orientation;
7. elevation against detected storey levels and building bounds;
8. dimensions, proportions, thinness, and area;
9. enclosure and room-size relationships;
10. wall-host and opening-host relationships;
11. material and texture semantics;
12. building-level perimeter/interior context;
13. low-weight legacy classifier evidence for migration compatibility.

Name evidence alone can classify an explicitly labelled object. Unlabelled geometry requires multiple independent signals. Legacy `PartKey` is never the final category; it only supplies migration evidence.

## Conflict resolution

Candidates are scored from 0 to 1. A result becomes `unknown` when:

- best score is below that candidate rule threshold; or
- top two candidates differ by less than `0.08`; or
- conflicting explicit labels differ by less than `0.18`.

Every face trace contains final category, confidence, all candidates, activated rule IDs, supporting evidence, rejecting evidence, conflict result, explanation, and unknown reason when applicable.

## Debug inspector

`model-eval` shows category distribution plus up to 250 unknown/lowest-confidence faces. Inspector displays complete trace without rendering thousands of DOM options.

## Regression metrics

Unit corpus covers all non-unknown categories, contextual unlabelled windows, ambiguity, and featureless unknown fallback.

Real-model report uses explicit multilingual metadata as silver ground truth because repository has no human-verified face labels. Silver metrics must not be presented as human-labelled accuracy. Geometry-only faces are excluded from precision/recall but included in whole-model unknown and ambiguity rates.

Run:

```powershell
cd model-eval
bun test src/lib/classifier

cd ..
bun scripts/benchmarks/classifier-regression.ts --slug=project-sboost-2
```

Output: `artifacts/<slug>/metrics/phase3-classifier-regression.json`.
