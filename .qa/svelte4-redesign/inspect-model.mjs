import fs from "node:fs";

const json = JSON.parse(fs.readFileSync("Model_SBMBOOST_bom_visual_nonPretty-print.json", "utf8"));

const groups = [];
const faces = [];

function walk(entity, depth = 1, path = []) {
  const name = entity.name || entity.definition_name || entity.type || "unnamed";
  if (entity.type !== "Face") {
    groups.push({
      type: entity.type,
      name,
      depth,
      children: entity.children?.length || 0,
      faceCount: entity.face_count || 0,
      path: [...path, name].join(" > ")
    });
  } else {
    faces.push({
      surface: entity.surface_type || "other",
      area: entity.area_m2 || 0,
      material: entity.material_front?.name || "",
      path: path.join(" > ")
    });
  }
  for (const child of entity.children || []) walk(child, depth + 1, [...path, name]);
}

for (const entity of json.entities || []) walk(entity);

groups.sort((a, b) => b.children - a.children || b.faceCount - a.faceCount);
console.log("GROUPS");
for (const row of groups.slice(0, 80)) {
  console.log([row.type, row.children, row.faceCount, row.name, row.path].join("\t"));
}

const bySurface = new Map();
for (const face of faces) {
  const row = bySurface.get(face.surface) || { area: 0, count: 0, paths: new Map() };
  row.area += face.area;
  row.count += 1;
  row.paths.set(face.path, (row.paths.get(face.path) || 0) + face.area);
  bySurface.set(face.surface, row);
}

console.log("\nSURFACES");
for (const [surface, row] of [...bySurface].sort((a, b) => b[1].area - a[1].area)) {
  const paths = [...row.paths]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([path, area]) => `${path}:${area.toFixed(1)}`)
    .join(" | ");
  console.log([surface, row.area.toFixed(1), row.count, paths].join("\t"));
}
