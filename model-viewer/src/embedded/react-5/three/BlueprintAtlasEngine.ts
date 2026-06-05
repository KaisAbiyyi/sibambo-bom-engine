import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  ATLAS_STEP_BY_ID,
  ATLAS_STEPS,
  type CameraPreset,
  detectAtlasStepId
} from "../data/blueprintAtlasSteps";

interface BomVertex {
  position: { x: number; y: number; z: number };
}

interface BomFace {
  type?: string;
  id?: string;
  name?: string;
  layer?: string;
  visGroup?: string;
  category?: string;
  surface_type?: string;
  vertices?: BomVertex[];
  material_front?: { name?: string; color?: { hex?: string } };
}

interface BomEntity {
  type?: string;
  id?: string;
  name?: string;
  definition_name?: string;
  category?: string;
  layer?: string;
  visGroup?: string;
  size?: { x: number; y: number; z: number };
  center?: { x: number; y: number; z: number };
  children?: Array<BomEntity | BomFace>;
}

interface BomModel {
  entities?: Array<BomEntity | BomFace>;
}

export interface AtlasView {
  selectedId: string;
  exploded: boolean;
  xray: boolean;
  finalSheet: boolean;
}

type AtlasMeshState = "active" | "connected" | "muted" | "hidden" | "final";

interface AtlasGroup {
  id: string;
  root: THREE.Group;
  meshes: THREE.Mesh[];
  originalPosition: THREE.Vector3;
  originalRotation: THREE.Euler;
  originalScale: THREE.Vector3;
  originalVisible: boolean;
  originalBounds: THREE.Box3;
  state?: AtlasMeshState;
  offsetKey?: string;
}

const CHUNK_SIZE = 640;
const SYNC_LIMIT = 420;
const CERUCUK_RENDER_MODE: "original" | "proxy" = "original";
const MAX_VERTICES_PER_FACE = 256;
const MAX_COORDINATE_ABS = 100000;

export class BlueprintAtlasEngine {
  private canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(45, 1, 0.01, 500);
  private controls: OrbitControls;
  private modelRoot = new THREE.Group();
  private guideLayer = new THREE.Group();
  private gridHelper = new THREE.GridHelper(28, 28, 0x244867, 0x102d4d);
  private ground: THREE.Mesh;
  private sceneBox = new THREE.Box3();
  private modelSize = new THREE.Vector3(1, 1, 1);
  private target = new THREE.Vector3(0, 1.2, 0);
  private spherical = { theta: 0.72, phi: 0.58, r: 16 };
  private groups = new Map<string, AtlasGroup>();
  private allMeshes: THREE.Mesh[] = [];
  private unmappedMeshes: THREE.Mesh[] = [];
  private cerucukOriginalMeshes: THREE.Mesh[] = [];
  private cerucukProxyGroup: THREE.Group | null = null;
  private baseMaterials = new Map<string, THREE.Material>();
  private activeMaterials = new Map<string, THREE.Material>();
  private finalMaterials = new Map<string, THREE.Material>();
  private connectedMaterial = new THREE.MeshPhongMaterial({ color: 0x9db5c9, shininess: 8, side: THREE.DoubleSide });
  private mutedMaterial = new THREE.MeshPhongMaterial({ color: 0x203b56, shininess: 4, side: THREE.DoubleSide });
  private hiddenMaterial = new THREE.MeshBasicMaterial({ color: 0x071b2f, visible: false });
  private frameId = 0;
  private dirty = true;
  private disposed = false;
  private cameraVersion = 0;
  private stateVersion = 0;
  private transformVersion = 0;
  private pendingFrames: number[] = [];
  private transformAnim: {
    version: number;
    startTime: number;
    duration: number;
    items: Array<{
      group: AtlasGroup;
      startPosition: THREE.Vector3;
      endPosition: THREE.Vector3;
      startRotation: THREE.Euler;
      endRotation: THREE.Euler;
      startScale: THREE.Vector3;
      endScale: THREE.Vector3;
    }>;
  } | null = null;
  private camAnim: {
    version: number;
    startTheta: number;
    startPhi: number;
    startR: number;
    startTarget: THREE.Vector3;
    endTheta: number;
    endPhi: number;
    endR: number;
    endTarget: THREE.Vector3;
    startTime: number;
    duration: number;
  } | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1));
    this.renderer.shadowMap.enabled = false;
    this.renderer.setClearColor(0x071b2f);

    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.enableRotate = true;
    this.controls.enableZoom = true;
    this.controls.enablePan = true;
    this.controls.screenSpacePanning = true;
    this.controls.minDistance = 2;
    this.controls.maxDistance = 86;
    this.controls.addEventListener("start", this.cancelCameraTransition);
    this.controls.addEventListener("change", this.invalidate);

    this.scene.fog = new THREE.Fog(0x071b2f, 60, 140);
    this.scene.add(this.modelRoot, this.guideLayer);
    this.scene.add(this.gridHelper);

    this.ground = new THREE.Mesh(
      new THREE.PlaneGeometry(48, 48),
      new THREE.MeshBasicMaterial({
        color: 0x06182b,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.28,
        depthWrite: false
      })
    );
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.position.y = -0.04;
    this.scene.add(this.ground);

    this.scene.add(new THREE.HemisphereLight(0xeaf4ff, 0x16324c, 1.55));
    const key = new THREE.DirectionalLight(0xddeeff, 0.76);
    key.position.set(10, 16, 12);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0x63a4ff, 0.44);
    fill.position.set(-8, 7, -10);
    this.scene.add(fill);

    window.addEventListener("resize", this.resize);
    this.resize();
    this.animate();
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.frameId);
    this.cancelPendingUpdates();
    window.removeEventListener("resize", this.resize);
    this.clear();
    this.baseMaterials.forEach((material) => material.dispose());
    this.activeMaterials.forEach((material) => material.dispose());
    this.finalMaterials.forEach((material) => material.dispose());
    this.connectedMaterial.dispose();
    this.mutedMaterial.dispose();
    this.hiddenMaterial.dispose();
    this.controls.removeEventListener("start", this.cancelCameraTransition);
    this.controls.removeEventListener("change", this.invalidate);
    this.controls.dispose();
    this.renderer.dispose();
  }

  loadModel(data: BomModel) {
    this.clear();
    this.sceneBox.makeEmpty();
    this.walk(data.entities ?? [], null, []);
    this.finalizeGroupBounds();
    this.fitToModel();
    this.debugGroups();
    this.applyAtlas({ selectedId: "atap_spandek", exploded: true, xray: true, finalSheet: false });
  }

  applyAtlas(view: AtlasView) {
    const selectedId = ATLAS_STEP_BY_ID[view.selectedId] ? view.selectedId : "atap_spandek";
    const finalSheet = view.finalSheet || selectedId === "hasil_final";
    const token = this.cancelPendingUpdates();
    const started = performance.now();
    this.setCerucukRepresentation(CERUCUK_RENDER_MODE, selectedId, finalSheet);
    this.updateActiveGuide(selectedId, finalSheet);

    const desired = this.computeDesiredStates(selectedId, view.xray, finalSheet);
    const visibleBounds = this.computeTargetVisibleBounds(desired, view.exploded);
    this.applyExplodeOffsets(view.exploded);
    this.updateGroundPlaneForBounds(visibleBounds);
    let updated = 0;
    let pending = 0;
    const done = (count: number) => {
      updated += count;
      pending -= 1;
      if (pending === 0) this.logState(selectedId, view, updated, started);
    };

    this.groups.forEach((group, id) => {
      const next = desired.get(id) ?? "hidden";
      if (group.state === next) return;
      group.state = next;
      pending += 1;
      this.updateGroup(group, next, token, done);
    });

    if (pending === 0) this.logState(selectedId, view, 0, started);
    this.moveCameraFor(selectedId, finalSheet, view.exploded, visibleBounds);
    this.invalidate();
  }

  private computeDesiredStates(selectedId: string, xray: boolean, finalSheet: boolean) {
    const desired = new Map<string, AtlasMeshState>();
    if (finalSheet) {
      ATLAS_STEPS.forEach((step) => {
        if (step.id !== "hasil_final") desired.set(step.id, "final");
      });
      return desired;
    }

    const selected = ATLAS_STEP_BY_ID[selectedId];
    ATLAS_STEPS.forEach((step) => {
      if (step.id !== "hasil_final") desired.set(step.id, xray ? "muted" : "hidden");
    });
    selected.connected.forEach((id) => desired.set(id, "connected"));
    selected.blockers.forEach((id) => desired.set(id, "hidden"));
    desired.set(selected.id, "active");
    return desired;
  }

  private applyExplodeOffsets(exploded: boolean) {
    this.transformVersion += 1;
    const version = this.transformVersion;
    const duration = exploded ? 820 : 700;
    const items: NonNullable<typeof this.transformAnim>["items"] = [];

    this.groups.forEach((group, id) => {
      const step = ATLAS_STEP_BY_ID[id];
      const offset = exploded && step ? this.scaledExplodeOffset(step.explodeOffset) : group.originalPosition;
      const key = `${offset.x}:${offset.y}:${offset.z}`;
      if (group.offsetKey === key) return;
      group.offsetKey = key;
      items.push({
        group,
        startPosition: group.root.position.clone(),
        endPosition: offset.clone(),
        startRotation: group.root.rotation.clone(),
        endRotation: group.originalRotation.clone(),
        startScale: group.root.scale.clone(),
        endScale: group.originalScale.clone()
      });
    });

    if (!items.length) return;
    this.transformAnim = { version, startTime: performance.now(), duration, items };
    this.devLog("transform-started", {
      exploded,
      groupCount: items.length,
      verticalAxis: "Y"
    });
    this.invalidate();
  }

  private scaledExplodeOffset(offset: { x: number; y: number; z: number }) {
    return new THREE.Vector3(
      offset.x * this.modelSize.x,
      offset.y * this.modelSize.y,
      offset.z * this.modelSize.z
    );
  }

  private computeTargetVisibleBounds(desired: Map<string, AtlasMeshState>, exploded: boolean) {
    const bounds = new THREE.Box3();
    this.groups.forEach((group, id) => {
      const state = desired.get(id) ?? "hidden";
      if (state === "hidden" || group.originalBounds.isEmpty()) return;
      const step = ATLAS_STEP_BY_ID[id];
      const offset = exploded && step ? this.scaledExplodeOffset(step.explodeOffset) : group.originalPosition;
      const box = group.originalBounds.clone().translate(offset);
      bounds.union(box);
    });
    return bounds.isEmpty() ? this.sceneBox.clone() : bounds;
  }

  private updateGroundPlaneForBounds(bounds: THREE.Box3) {
    if (bounds.isEmpty()) return;
    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    const padding = Math.max(size.y * 0.05, this.modelSize.y * 0.04, 0.1);
    const groundY = bounds.min.y - padding;
    this.gridHelper.position.set(center.x, groundY, center.z);
    this.ground.position.set(center.x, groundY - 0.01, center.z);
  }

  private updateGroup(group: AtlasGroup, state: AtlasMeshState, token: number, done: (count: number) => void) {
    const meshes = group.meshes;
    let cursor = 0;
    let updated = 0;
    const step = () => {
      if (token !== this.stateVersion) return;
      const end = meshes.length <= SYNC_LIMIT ? meshes.length : Math.min(cursor + CHUNK_SIZE, meshes.length);
      for (let index = cursor; index < end; index += 1) {
        updated += this.applyMeshState(meshes[index], group.id, state);
      }
      cursor = end;
      this.invalidate();
      if (cursor < meshes.length) {
        this.pendingFrames.push(requestAnimationFrame(step));
        return;
      }
      done(updated);
    };
    step();
  }

  private applyMeshState(mesh: THREE.Mesh, stepId: string, state: AtlasMeshState) {
    const nextVisible = state !== "hidden";
    const nextMaterial = this.materialFor(stepId, state);
    if (mesh.userData.atlasState === state && mesh.visible === nextVisible && mesh.material === nextMaterial) return 0;
    mesh.userData.atlasState = state;
    mesh.visible = nextVisible;
    mesh.renderOrder = state === "active" ? 10 : state === "connected" ? 5 : 0;
    mesh.material = nextMaterial;
    return 1;
  }

  private materialFor(stepId: string, state: AtlasMeshState) {
    if (state === "hidden") return this.hiddenMaterial;
    if (state === "active") return this.activeMaterial(stepId);
    if (state === "connected") return this.connectedMaterial;
    if (state === "muted") return this.mutedMaterial;
    return this.finalMaterial(stepId);
  }

  private baseMaterial(stepId: string) {
    const existing = this.baseMaterials.get(stepId);
    if (existing) return existing;
    const material = new THREE.MeshPhongMaterial({
      color: ATLAS_STEP_BY_ID[stepId]?.color ?? "#9DB5C9",
      shininess: 9,
      specular: new THREE.Color(0x244867),
      side: THREE.DoubleSide,
      transparent: false,
      opacity: 1,
      depthWrite: true,
      depthTest: true
    });
    this.baseMaterials.set(stepId, material);
    return material;
  }

  private activeMaterial(stepId: string) {
    const existing = this.activeMaterials.get(stepId);
    if (existing) return existing;
    const base = new THREE.Color(ATLAS_STEP_BY_ID[stepId]?.color ?? "#D95C4B");
    const material = new THREE.MeshPhongMaterial({
      color: base.lerp(new THREE.Color(0xeaf4ff), 0.1),
      shininess: 18,
      specular: new THREE.Color(0xd6a84f),
      side: THREE.DoubleSide,
      transparent: false,
      opacity: 1,
      depthWrite: true,
      depthTest: true
    });
    this.activeMaterials.set(stepId, material);
    return material;
  }

  private finalMaterial(stepId: string) {
    const existing = this.finalMaterials.get(stepId);
    if (existing) return existing;
    const base = new THREE.Color(ATLAS_STEP_BY_ID[stepId]?.color ?? "#9DB5C9");
    const material = new THREE.MeshPhongMaterial({
      color: base.lerp(new THREE.Color(0xeaf4ff), 0.18),
      shininess: 8,
      specular: new THREE.Color(0x365d7e),
      side: THREE.DoubleSide,
      transparent: false,
      opacity: 1,
      depthWrite: true,
      depthTest: true
    });
    this.finalMaterials.set(stepId, material);
    return material;
  }

  private setCerucukRepresentation(mode: "original" | "proxy", selectedId: string, finalSheet: boolean) {
    if (finalSheet) {
      this.hideCerucukProxy();
      return;
    }
    if (mode === "original") {
      this.hideCerucukProxy();
      return;
    }
    this.cerucukOriginalMeshes.forEach((mesh) => {
      mesh.visible = false;
    });
    if (this.cerucukProxyGroup) {
      if (!this.cerucukProxyGroup.parent) this.scene.add(this.cerucukProxyGroup);
      this.cerucukProxyGroup.visible = true;
    }
  }

  private hideCerucukProxy() {
    if (this.cerucukProxyGroup) this.cerucukProxyGroup.visible = false;
  }

  private updateActiveGuide(selectedId: string, finalSheet: boolean) {
    this.guideLayer.clear();
    if (finalSheet) return;
    const group = this.groups.get(selectedId);
    if (!group?.meshes.length) return;
    const box = new THREE.Box3();
    group.meshes.slice(0, 220).forEach((mesh) => box.union(new THREE.Box3().setFromObject(mesh)));
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const top = new THREE.Vector3(center.x, box.max.y + 0.4, center.z);
    this.guideLayer.add(
      new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([center, top]),
        new THREE.LineBasicMaterial({ color: 0xd95c4b })
      )
    );
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.075, 12, 8), new THREE.MeshBasicMaterial({ color: 0xd6a84f }));
    dot.position.copy(top);
    this.guideLayer.add(dot);
  }

  private moveCameraFor(selectedId: string, finalSheet: boolean, exploded: boolean, bounds: THREE.Box3) {
    const basePreset = finalSheet
      ? ATLAS_STEP_BY_ID.hasil_final.camera
      : ATLAS_STEP_BY_ID[selectedId]?.camera ?? ATLAS_STEP_BY_ID.atap_spandek.camera;
    const preset = exploded ? { ...basePreset, rFactor: Math.max(basePreset.rFactor * 1.36, 1.28) } : basePreset;
    this.moveCamera(preset, finalSheet ? 760 : 560, bounds);
  }

  private moveCamera(preset: CameraPreset, duration: number, bounds = this.sceneBox) {
    if (bounds.isEmpty()) return;
    if (!this.camAnim) this.syncSphericalFromCamera();
    this.cameraVersion += 1;
    const center = bounds.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3());
    const footprint = Math.max(size.x, size.z);
    const endTarget = new THREE.Vector3(center.x, center.y + size.y * preset.targetYBias, center.z);
    const endR = Math.max(footprint * preset.rFactor, size.y * 1.55, 4);
    this.camAnim = {
      version: this.cameraVersion,
      startTheta: this.spherical.theta,
      startPhi: this.spherical.phi,
      startR: this.spherical.r,
      startTarget: this.target.clone(),
      endTheta: preset.theta,
      endPhi: preset.phi,
      endR,
      endTarget,
      startTime: performance.now(),
      duration
    };
    this.invalidate();
  }

  private walk(entities: Array<BomEntity | BomFace>, parentStep: string | null, path: string[]) {
    entities.forEach((entity, index) => {
      if (this.isFace(entity)) {
        this.buildFace(entity, parentStep, path);
        return;
      }
      const name = entity.name || entity.definition_name || entity.category || entity.type || `entity-${index}`;
      const detected = detectAtlasStepId([name, entity.category, entity.layer, entity.visGroup], parentStep);
      if (entity.size && entity.center) this.buildBox(entity, detected, [...path, name]);
      if (entity.children?.length) this.walk(entity.children, detected, [...path, name]);
    });
  }

  private buildFace(face: BomFace, parentStep: string | null, path: string[]) {
    if (!face.vertices || face.vertices.length < 3) return;
    if (face.vertices.length > MAX_VERTICES_PER_FACE) throw new Error("Face has too many vertices.");
    const stepId = detectAtlasStepId(
      [face.name, face.layer, face.visGroup, face.category, face.surface_type, face.material_front?.name, path.join(" ")],
      parentStep
    );
    if (!stepId) return this.registerUnmappedFace(face);

    let cx = 0;
    let cy = 0;
    let cz = 0;
    face.vertices.forEach((vertex) => {
      cx += this.finiteCoordinate(vertex.position.x);
      cy += this.finiteCoordinate(vertex.position.z);
      cz += -this.finiteCoordinate(vertex.position.y);
    });
    const inv = 1 / face.vertices.length;
    cx *= inv;
    cy *= inv;
    cz *= inv;

    const positions = new Float32Array((face.vertices.length - 2) * 9);
    const normals = new Float32Array(positions.length);
    let cursor = 0;
    const write = (vertex: BomVertex) => {
      positions[cursor] = this.finiteCoordinate(vertex.position.x) - cx;
      positions[cursor + 1] = this.finiteCoordinate(vertex.position.z) - cy;
      positions[cursor + 2] = -this.finiteCoordinate(vertex.position.y) - cz;
      cursor += 3;
    };
    for (let i = 1; i < face.vertices.length - 1; i += 1) {
      write(face.vertices[0]);
      write(face.vertices[i]);
      write(face.vertices[i + 1]);
    }
    for (let i = 0; i < positions.length; i += 9) {
      const ax = positions[i + 3] - positions[i];
      const ay = positions[i + 4] - positions[i + 1];
      const az = positions[i + 5] - positions[i + 2];
      const bx = positions[i + 6] - positions[i];
      const by = positions[i + 7] - positions[i + 1];
      const bz = positions[i + 8] - positions[i + 2];
      let nx = ay * bz - az * by;
      let ny = az * bx - ax * bz;
      let nz = ax * by - ay * bx;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len;
      ny /= len;
      nz /= len;
      for (let n = 0; n < 9; n += 3) {
        normals[i + n] = nx;
        normals[i + n + 1] = ny;
        normals[i + n + 2] = nz;
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
    geometry.computeBoundingBox();
    const mesh = new THREE.Mesh(geometry, this.baseMaterial(stepId));
    mesh.position.set(cx, cy, cz);
    mesh.userData = {
      atlasStepId: stepId,
      originalMaterial: mesh.material,
      originalVisible: true,
      originalPosition: mesh.position.clone(),
      originalRotation: mesh.rotation.clone(),
      originalScale: mesh.scale.clone(),
      name: face.name || face.material_front?.name || face.surface_type || stepId,
      layer: face.layer,
      visGroup: face.visGroup,
      sourcePath: path.join(" > ")
    };
    this.registerMesh(stepId, mesh);
    this.sceneBox.union(new THREE.Box3().setFromObject(mesh));
  }

  private buildBox(entity: BomEntity, stepId: string | null, path: string[]) {
    if (!stepId || !entity.size || !entity.center) return;
    const geometry = new THREE.BoxGeometry(entity.size.x, entity.size.z, entity.size.y);
    const mesh = new THREE.Mesh(geometry, this.baseMaterial(stepId));
    mesh.position.set(entity.center.x, entity.center.z, -entity.center.y);
    mesh.userData = {
      atlasStepId: stepId,
      originalMaterial: mesh.material,
      originalVisible: true,
      originalPosition: mesh.position.clone(),
      originalRotation: mesh.rotation.clone(),
      originalScale: mesh.scale.clone(),
      name: entity.name || entity.definition_name || stepId,
      layer: entity.layer,
      visGroup: entity.visGroup,
      sourcePath: path.join(" > ")
    };
    this.registerMesh(stepId, mesh);
    this.sceneBox.union(new THREE.Box3().setFromObject(mesh));
  }

  private registerMesh(stepId: string, mesh: THREE.Mesh) {
    const group = this.ensureGroup(stepId);
    group.root.add(mesh);
    group.meshes.push(mesh);
    this.allMeshes.push(mesh);
    if (stepId === "cerucuk") this.cerucukOriginalMeshes.push(mesh);
  }

  private ensureGroup(stepId: string) {
    const existing = this.groups.get(stepId);
    if (existing) return existing;
    const root = new THREE.Group();
    root.name = `atlas-${stepId}`;
    this.modelRoot.add(root);
    const group: AtlasGroup = {
      id: stepId,
      root,
      meshes: [],
      originalPosition: root.position.clone(),
      originalRotation: root.rotation.clone(),
      originalScale: root.scale.clone(),
      originalVisible: root.visible,
      originalBounds: new THREE.Box3()
    };
    this.groups.set(stepId, group);
    return group;
  }

  private registerUnmappedFace(face: BomFace) {
    if (!face.vertices?.length) return;
    this.unmappedMeshes.push(new THREE.Mesh());
  }

  private finalizeGroupBounds() {
    this.groups.forEach((group) => {
      group.root.updateWorldMatrix(true, true);
      group.originalBounds.copy(new THREE.Box3().setFromObject(group.root));
    });
  }

  private clear() {
    this.cancelPendingUpdates();
    this.allMeshes.forEach((mesh) => {
      mesh.geometry.dispose();
      mesh.parent?.remove(mesh);
    });
    this.groups.forEach((group) => group.root.parent?.remove(group.root));
    this.disposeObjectTree(this.guideLayer);
    this.guideLayer.clear();
    this.transformAnim = null;
    this.allMeshes = [];
    this.unmappedMeshes = [];
    this.cerucukOriginalMeshes = [];
    this.groups.clear();
  }

  private disposeObjectTree(root: THREE.Object3D) {
    root.traverse((object) => {
      const mesh = object as THREE.Mesh | THREE.Line;
      mesh.geometry?.dispose();
      const material = mesh.material;
      if (Array.isArray(material)) material.forEach((item) => item.dispose());
      else material?.dispose();
    });
  }

  private fitToModel() {
    if (this.sceneBox.isEmpty()) return;
    const center = this.sceneBox.getCenter(new THREE.Vector3());
    const size = this.sceneBox.getSize(new THREE.Vector3());
    this.modelSize.copy(size);
    const gridSize = Math.max(Math.ceil(Math.max(size.x, size.z)) + 12, 12);
    this.gridHelper.scale.setScalar(gridSize / 28);
    this.ground.geometry.dispose();
    this.ground.geometry = new THREE.PlaneGeometry(gridSize + 5, gridSize + 5);
    this.updateGroundPlaneForBounds(this.sceneBox);
    this.target.copy(center);
    this.spherical = { theta: 0.74, phi: 0.58, r: Math.max(Math.max(size.x, size.z) * 1.5, size.y * 3, 8) };
    this.updateCamera();
    this.controls.minDistance = Math.max(Math.min(size.x, size.z) * 0.18, 1.5);
    this.controls.maxDistance = Math.max(Math.max(size.x, size.z) * 4.5, size.y * 7, 34);
    this.controls.target.copy(this.target);
    this.controls.update();
  }

  private resize = () => {
    const width = this.canvas.clientWidth || 1;
    const height = this.canvas.clientHeight || 1;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.updateCamera();
    this.invalidate();
  };

  private animate = () => {
    if (this.disposed) return;
    this.frameId = requestAnimationFrame(this.animate);
    let render = this.dirty;
    if (this.camAnim) {
      if (this.camAnim.version !== this.cameraVersion) {
        this.camAnim = null;
      } else {
        render = true;
        const t = Math.min((performance.now() - this.camAnim.startTime) / this.camAnim.duration, 1);
        const ease = 1 - Math.pow(1 - t, 3);
        this.spherical.theta = THREE.MathUtils.lerp(this.camAnim.startTheta, this.camAnim.endTheta, ease);
        this.spherical.phi = THREE.MathUtils.lerp(this.camAnim.startPhi, this.camAnim.endPhi, ease);
        this.spherical.r = THREE.MathUtils.lerp(this.camAnim.startR, this.camAnim.endR, ease);
        this.target.lerpVectors(this.camAnim.startTarget, this.camAnim.endTarget, ease);
        this.updateCamera();
        this.controls.target.copy(this.target);
        this.controls.update();
        if (t >= 1) this.camAnim = null;
      }
    }
    if (!this.camAnim && this.controls.update()) {
      this.syncSphericalFromCamera();
      render = true;
    }
    if (this.transformAnim) {
      if (this.transformAnim.version !== this.transformVersion) {
        this.transformAnim = null;
      } else {
        render = true;
        const t = Math.min((performance.now() - this.transformAnim.startTime) / this.transformAnim.duration, 1);
        const ease = 1 - Math.pow(1 - t, 3);
        this.transformAnim.items.forEach((item) => {
          item.group.root.position.lerpVectors(item.startPosition, item.endPosition, ease);
          item.group.root.rotation.set(
            THREE.MathUtils.lerp(item.startRotation.x, item.endRotation.x, ease),
            THREE.MathUtils.lerp(item.startRotation.y, item.endRotation.y, ease),
            THREE.MathUtils.lerp(item.startRotation.z, item.endRotation.z, ease)
          );
          item.group.root.scale.lerpVectors(item.startScale, item.endScale, ease);
        });
        this.updateGroundPlaneForCurrentVisibleGroups();
        if (t >= 1) {
          this.devLog("transform-ended", {
            groundPlaneY: Math.round(this.ground.position.y * 1000) / 1000,
            verticalAxis: "Y"
          });
          this.transformAnim = null;
        }
      }
    }
    if (render) {
      this.renderer.render(this.scene, this.camera);
      this.dirty = false;
    }
  };

  private updateCamera() {
    const sinPhi = Math.sin(this.spherical.phi);
    this.camera.position.set(
      this.target.x + this.spherical.r * sinPhi * Math.sin(this.spherical.theta),
      this.target.y + this.spherical.r * Math.cos(this.spherical.phi),
      this.target.z + this.spherical.r * sinPhi * Math.cos(this.spherical.theta)
    );
    this.camera.lookAt(this.target);
  }

  private syncSphericalFromCamera() {
    this.target.copy(this.controls.target);
    const offset = this.camera.position.clone().sub(this.target);
    const spherical = new THREE.Spherical().setFromVector3(offset);
    this.spherical.theta = spherical.theta;
    this.spherical.phi = spherical.phi;
    this.spherical.r = spherical.radius;
  }

  private cancelCameraTransition = () => {
    if (!this.camAnim) return;
    this.cameraVersion += 1;
    this.camAnim = null;
    this.syncSphericalFromCamera();
    this.invalidate();
  };

  private cancelPendingUpdates() {
    this.stateVersion += 1;
    this.pendingFrames.forEach((frame) => cancelAnimationFrame(frame));
    this.pendingFrames = [];
    return this.stateVersion;
  }

  private invalidate = () => {
    this.dirty = true;
  };

  private isFace(entity: BomEntity | BomFace): entity is BomFace {
    return entity.type === "Face" && "vertices" in entity;
  }

  private finiteCoordinate(value: unknown) {
    const numberValue = Number(value);
    if (!Number.isFinite(numberValue) || Math.abs(numberValue) > MAX_COORDINATE_ABS) throw new Error("Invalid model coordinate.");
    return numberValue;
  }

  private updateGroundPlaneForCurrentVisibleGroups() {
    const bounds = new THREE.Box3();
    this.groups.forEach((group) => {
      if (group.state === "hidden" || group.originalBounds.isEmpty()) return;
      const box = group.originalBounds.clone().translate(group.root.position);
      bounds.union(box);
    });
    if (!bounds.isEmpty()) this.updateGroundPlaneForBounds(bounds);
  }

  private logState(selectedId: string, view: AtlasView, updatedMeshes: number, started: number) {
    this.devLog("state", {
      selectedId,
      selectedLabel: ATLAS_STEP_BY_ID[selectedId]?.label ?? selectedId,
      exploded: view.exploded,
      xray: view.xray,
      finalSheet: view.finalSheet,
      updatedMeshes,
      transitionMs: Math.round((performance.now() - started) * 10) / 10,
      visibleBounds: this.computeCurrentVisibleBoundsSummary(),
      verticalAxis: "Y",
      groundPlaneY: Math.round(this.ground.position.y * 1000) / 1000,
      cerucukOriginalCount: this.cerucukOriginalMeshes.length,
      proxyVisible: this.cerucukProxyGroup?.visible ?? false
    });
  }

  private computeCurrentVisibleBoundsSummary() {
    const bounds = new THREE.Box3();
    this.groups.forEach((group) => {
      if (group.state === "hidden" || group.originalBounds.isEmpty()) return;
      bounds.union(group.originalBounds.clone().translate(group.root.position));
    });
    if (bounds.isEmpty()) return null;
    return {
      min: bounds.min.toArray().map((value) => Math.round(value * 1000) / 1000),
      max: bounds.max.toArray().map((value) => Math.round(value * 1000) / 1000)
    };
  }

  private debugGroups() {
    this.devLog("groups", {
      totalMeshCount: this.allMeshes.length,
      unmappedMeshCount: this.unmappedMeshes.length,
      cerucukOriginalCount: this.cerucukOriginalMeshes.length,
      atlasCounts: Object.fromEntries([...this.groups.entries()].map(([id, group]) => [id, group.meshes.length]))
    });
  }

  private devLog(label: string, data: unknown) {
    if (!import.meta.env.DEV) return;
    console.log(`[BlueprintAtlasEngine] ${label}`, data);
  }
}
