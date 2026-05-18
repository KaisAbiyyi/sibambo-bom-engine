import { BufferGeometry, Float32BufferAttribute, Vector3 } from "three";
import type { BomEntity } from "../types/bom";

export type BuiltFaceGeometry = {
  geometry: BufferGeometry;
  position: [number, number, number];
  triangleCount: number;
};

export function buildGeometryFromFace(face: BomEntity): BuiltFaceGeometry | null {
  if (!face.vertices || face.vertices.length < 3) return null;

  const verts = face.vertices
    .filter((vertex) => vertex.position)
    .map((vertex) => new Vector3(vertex.position.x, vertex.position.z, -vertex.position.y));

  if (verts.length < 3) return null;

  const centroid = new Vector3();
  verts.forEach((vertex) => centroid.add(vertex));
  centroid.divideScalar(verts.length);

  const relative = verts.map((vertex) => vertex.clone().sub(centroid));
  const positions: number[] = [];

  for (let index = 1; index < relative.length - 1; index += 1) {
    positions.push(relative[0].x, relative[0].y, relative[0].z);
    positions.push(relative[index].x, relative[index].y, relative[index].z);
    positions.push(relative[index + 1].x, relative[index + 1].y, relative[index + 1].z);
  }

  if (!positions.length) return null;

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();

  return {
    geometry,
    position: [centroid.x, centroid.y, centroid.z],
    triangleCount: positions.length / 9
  };
}
