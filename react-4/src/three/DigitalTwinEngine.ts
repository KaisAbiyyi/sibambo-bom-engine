import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  INSPECTION_ORDER,
  INSPECTION_STEP_BY_ID,
  INSPECTION_STEPS,
  type CameraPreset,
  detectInspectionStepId
} from "../data/inspectionSteps";

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

type InspectionMeshState = "inspected" | "active" | "context" | "pending" | "hidden" | "final";

interface InspectionGroup {
  id: string;
  meshes: THREE.Mesh[];
  state?: InspectionMeshState;
}

interface InspectionView {
  selectedId: string;
}

const CHUNK_SIZE = 640;
const SYNC_LIMIT = 420;
const CERUCUK_RENDER_MODE: "original" | "proxy" = "original";

export class DigitalTwinEngine {
  private canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(45, 1, 0.01, 500);
  private controls: OrbitControls;
  private modelRoot = new THREE.Group();
  private anchorLayer = new THREE.Group();
  private gridHelper = new THREE.GridHelper(24, 24, 0xcfc6b7, 0xe3dcca);
  private ground: THREE.Mesh;
  private sceneBox = new THREE.Box3();
  private target = new THREE.Vector3(0, 1.2, 0);
  private spherical = { theta: 0.72, phi: 0.58, r: 16 };
  private groups = new Map<string, InspectionGroup>();
  private allMeshes: THREE.Mesh[] = [];
  private unmappedMeshes: THREE.Mesh[] = [];
  private cerucukOriginalMeshes: THREE.Mesh[] = [];
  private cerucukProxyGroup: THREE.Group | null = null;
  private baseMaterials = new Map<string, THREE.Material>();
  private activeMaterials = new Map<string, THREE.Material>();
  private finalMaterials = new Map<string, THREE.Material>();
  private inspectedMaterial = new THREE.MeshPhongMaterial({ color: 0xcac2b4, shininess: 6, side: THREE.DoubleSide });
  private contextMaterial = new THREE.MeshPhongMaterial({ color: 0x9aa7b2, shininess: 8, side: THREE.DoubleSide });
  private pendingMaterial = new THREE.MeshBasicMaterial({ color: 0xf3efe6, visible: false });
  private hiddenMaterial = new THREE.MeshBasicMaterial({ color: 0xf3efe6, visible: false });
  private frameId = 0;
  private dirty = true;
  private disposed = false;
  private cameraVersion = 0;
  private stateVersion = 0;
  private pendingFrames: number[] = [];
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
    this.renderer.setClearColor(0xf8f5ee);

    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.enableRotate = true;
    this.controls.enableZoom = true;
    this.controls.enablePan = true;
    this.controls.screenSpacePanning = true;
    this.controls.minDistance = 2;
    this.controls.maxDistance = 80;
    this.controls.addEventListener("start", this.cancelCameraTransition);
    this.controls.addEventListener("change", this.invalidate);

    this.scene.fog = new THREE.Fog(0xf8f5ee, 58, 135);
    this.scene.add(this.modelRoot, this.anchorLayer);
    this.scene.add(this.gridHelper);

    this.ground = new THREE.Mesh(
      new THREE.PlaneGeometry(42, 42),
      new THREE.MeshBasicMaterial({ color: 0xf5efe3, side: THREE.DoubleSide })
    );
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.position.y = -0.04;
    this.scene.add(this.ground);

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xc8b99d, 1.7));
    const key = new THREE.DirectionalLight(0xffffff, 0.72);
    key.position.set(10, 16, 12);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xf2dfbf, 0.42);
    fill.position.set(-8, 8, -10);
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
    this.inspectedMaterial.dispose();
    this.contextMaterial.dispose();
    this.pendingMaterial.dispose();
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
    this.fitToModel();
    this.debugGroups();
    this.applyInspection({ selectedId: "atap_spandek" });
  }

  applyInspection(view: InspectionView) {
    const selectedId = INSPECTION_STEP_BY_ID[view.selectedId] ? view.selectedId : "atap_spandek";
    const token = this.cancelPendingUpdates();
    const started = performance.now();
    const desired = this.computeDesiredStates(selectedId);
    this.setCerucukRepresentation(CERUCUK_RENDER_MODE, selectedId);
    this.updateActiveAnchor(selectedId);

    let updated = 0;
    let pending = 0;
    const done = (count: number) => {
      updated += count;
      pending -= 1;
      if (pending === 0) this.logState(selectedId, updated, started);
    };

    this.groups.forEach((group, id) => {
      const next = desired.get(id) ?? "hidden";
      if (group.state === next) return;
      group.state = next;
      pending += 1;
      this.updateGroup(group, next, token, done);
    });

    if (pending === 0) this.logState(selectedId, 0, started);
    this.moveCameraFor(selectedId);
    this.invalidate();
  }

  private computeDesiredStates(selectedId: string) {
    const desired = new Map<string, InspectionMeshState>();
    const selected = INSPECTION_STEP_BY_ID[selectedId];

    if (selectedId === "hasil_final") {
      INSPECTION_STEPS.forEach((step) => {
        if (step.id !== "hasil_final") desired.set(step.id, "final");
      });
      return desired;
    }

    INSPECTION_STEPS.forEach((step) => {
      if (step.id === "hasil_final") return;
      desired.set(step.id, step.order < selected.order ? "inspected" : "pending");
    });

    selected.connected.forEach((id) => desired.set(id, "context"));
    desired.set(selected.id, "active");
    selected.blockers.forEach((id) => {
      if (id !== selected.id) desired.set(id, "hidden");
    });

    return desired;
  }

  private updateGroup(group: InspectionGroup, state: InspectionMeshState, token: number, done: (count: number) => void) {
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

  private applyMeshState(mesh: THREE.Mesh, stepId: string, state: InspectionMeshState) {
    const nextVisible = state !== "hidden" && state !== "pending";
    const nextMaterial = this.materialFor(stepId, state);
    if (mesh.userData.inspectionState === state && mesh.visible === nextVisible && mesh.material === nextMaterial) return 0;
    mesh.userData.inspectionState = state;
    mesh.visible = nextVisible;
    mesh.renderOrder = state === "active" ? 10 : state === "context" ? 4 : 0;
    mesh.material = nextMaterial;
    return 1;
  }

  private materialFor(stepId: string, state: InspectionMeshState) {
    if (state === "hidden") return this.hiddenMaterial;
    if (state === "pending") return this.pendingMaterial;
    if (state === "active") return this.activeMaterial(stepId);
    if (state === "context") return this.contextMaterial;
    if (state === "inspected") return this.inspectedMaterial;
    return this.finalMaterial(stepId);
  }

  private baseMaterial(stepId: string) {
    const existing = this.baseMaterials.get(stepId);
    if (existing) return existing;
    const material = new THREE.MeshPhongMaterial({
      color: INSPECTION_STEP_BY_ID[stepId]?.color ?? "#8B96A0",
      shininess: 10,
      specular: new THREE.Color(0x8f8576),
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
    const base = new THREE.Color(INSPECTION_STEP_BY_ID[stepId]?.color ?? "#E86F2D");
    const material = new THREE.MeshPhongMaterial({
      color: base.lerp(new THREE.Color(0xffffff), 0.12),
      shininess: 20,
      specular: new THREE.Color(0xb88954),
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
    const base = new THREE.Color(INSPECTION_STEP_BY_ID[stepId]?.color ?? "#8B96A0");
    const material = new THREE.MeshPhongMaterial({
      color: base.lerp(new THREE.Color(0xf8f5ee), 0.16),
      shininess: 8,
      specular: new THREE.Color(0x9c927f),
      side: THREE.DoubleSide,
      transparent: false,
      opacity: 1,
      depthWrite: true,
      depthTest: true
    });
    this.finalMaterials.set(stepId, material);
    return material;
  }

  private setCerucukRepresentation(mode: "original" | "proxy", selectedId: string) {
    if (selectedId === "hasil_final") {
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

  private updateActiveAnchor(selectedId: string) {
    this.anchorLayer.clear();
    if (selectedId === "hasil_final") return;
    const group = this.groups.get(selectedId);
    if (!group?.meshes.length) return;
    const box = new THREE.Box3();
    group.meshes.slice(0, 260).forEach((mesh) => box.union(new THREE.Box3().setFromObject(mesh)));
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const top = new THREE.Vector3(center.x, box.max.y + 0.35, center.z);
    const material = new THREE.LineBasicMaterial({ color: 0xe86f2d });
    this.anchorLayer.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([center, top]), material));
    this.anchorLayer.add(
      new THREE.Mesh(
        new THREE.SphereGeometry(0.08, 12, 8),
        new THREE.MeshBasicMaterial({ color: 0xe86f2d })
      ).translateX(top.x).translateY(top.y).translateZ(top.z)
    );
  }

  private moveCameraFor(selectedId: string) {
    const preset = INSPECTION_STEP_BY_ID[selectedId]?.camera ?? INSPECTION_STEP_BY_ID.atap_spandek.camera;
    this.moveCamera(preset, selectedId === "hasil_final" ? 760 : 560);
  }

  private moveCamera(preset: CameraPreset, duration: number) {
    if (this.sceneBox.isEmpty()) return;
    if (!this.camAnim) this.syncSphericalFromCamera();
    this.cameraVersion += 1;
    const center = this.sceneBox.getCenter(new THREE.Vector3());
    const size = this.sceneBox.getSize(new THREE.Vector3());
    const footprint = Math.max(size.x, size.z);
    const endTarget = new THREE.Vector3(center.x, center.y + size.y * preset.targetYBias, center.z);
    const endR = Math.max(footprint * preset.rFactor, 4);
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
      const detected = detectInspectionStepId([name, entity.category, entity.layer, entity.visGroup], parentStep);
      if (entity.size && entity.center) this.buildBox(entity, detected, [...path, name]);
      if (entity.children?.length) this.walk(entity.children, detected, [...path, name]);
    });
  }

  private buildFace(face: BomFace, parentStep: string | null, path: string[]) {
    if (!face.vertices || face.vertices.length < 3) return;
    const stepId = detectInspectionStepId(
      [face.name, face.layer, face.visGroup, face.category, face.surface_type, face.material_front?.name, path.join(" ")],
      parentStep
    );
    if (!stepId) return this.registerUnmappedFace(face);

    let cx = 0;
    let cy = 0;
    let cz = 0;
    face.vertices.forEach((vertex) => {
      cx += vertex.position.x;
      cy += vertex.position.z;
      cz += -vertex.position.y;
    });
    const inv = 1 / face.vertices.length;
    cx *= inv;
    cy *= inv;
    cz *= inv;

    const positions = new Float32Array((face.vertices.length - 2) * 9);
    const normals = new Float32Array(positions.length);
    let cursor = 0;
    const write = (vertex: BomVertex) => {
      positions[cursor] = vertex.position.x - cx;
      positions[cursor + 1] = vertex.position.z - cy;
      positions[cursor + 2] = -vertex.position.y - cz;
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
      inspectionStepId: stepId,
      originalMaterial: mesh.material,
      originalVisible: true,
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
      inspectionStepId: stepId,
      originalMaterial: mesh.material,
      originalVisible: true,
      name: entity.name || entity.definition_name || stepId,
      layer: entity.layer,
      visGroup: entity.visGroup,
      sourcePath: path.join(" > ")
    };
    this.registerMesh(stepId, mesh);
    this.sceneBox.union(new THREE.Box3().setFromObject(mesh));
  }

  private registerMesh(stepId: string, mesh: THREE.Mesh) {
    this.modelRoot.add(mesh);
    this.allMeshes.push(mesh);
    if (!this.groups.has(stepId)) this.groups.set(stepId, { id: stepId, meshes: [] });
    this.groups.get(stepId)?.meshes.push(mesh);
    if (stepId === "cerucuk") this.cerucukOriginalMeshes.push(mesh);
  }

  private registerUnmappedFace(face: BomFace) {
    if (!face.vertices?.length) return;
    this.unmappedMeshes.push(new THREE.Mesh());
  }

  private clear() {
    this.cancelPendingUpdates();
    this.allMeshes.forEach((mesh) => {
      mesh.geometry.dispose();
      mesh.parent?.remove(mesh);
    });
    this.anchorLayer.clear();
    this.allMeshes = [];
    this.unmappedMeshes = [];
    this.cerucukOriginalMeshes = [];
    this.groups.clear();
  }

  private fitToModel() {
    if (this.sceneBox.isEmpty()) return;
    const center = this.sceneBox.getCenter(new THREE.Vector3());
    const size = this.sceneBox.getSize(new THREE.Vector3());
    const gridSize = Math.max(Math.ceil(Math.max(size.x, size.z)) + 10, 10);
    this.gridHelper.scale.setScalar(gridSize / 24);
    this.gridHelper.position.set(center.x, this.sceneBox.min.y - 0.03, center.z);
    this.ground.geometry.dispose();
    this.ground.geometry = new THREE.PlaneGeometry(gridSize + 4, gridSize + 4);
    this.ground.position.set(center.x, this.sceneBox.min.y - 0.05, center.z);
    this.target.copy(center);
    this.spherical = { theta: 0.7, phi: 0.58, r: Math.max(Math.max(size.x, size.z) * 1.48, size.y * 3, 8) };
    this.updateCamera();
    this.controls.minDistance = Math.max(Math.min(size.x, size.z) * 0.18, 1.5);
    this.controls.maxDistance = Math.max(Math.max(size.x, size.z) * 4.5, size.y * 7, 32);
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

  private logState(selectedId: string, updatedMeshes: number, started: number) {
    this.devLog("state", {
      selectedId,
      selectedLabel: INSPECTION_STEP_BY_ID[selectedId]?.label ?? selectedId,
      updatedMeshes,
      transitionMs: Math.round((performance.now() - started) * 10) / 10,
      cerucukOriginalCount: this.cerucukOriginalMeshes.length,
      proxyVisible: this.cerucukProxyGroup?.visible ?? false,
      controlsEnabled: this.controls.enabled
    });
  }

  private debugGroups() {
    this.devLog("groups", {
      totalMeshCount: this.allMeshes.length,
      unmappedMeshCount: this.unmappedMeshes.length,
      cerucukOriginalCount: this.cerucukOriginalMeshes.length,
      componentCounts: Object.fromEntries([...this.groups.entries()].map(([id, group]) => [id, group.meshes.length]))
    });
  }

  private devLog(label: string, data: unknown) {
    if (!import.meta.env.DEV) return;
    console.log(`[InspectionEngine] ${label}`, data);
  }
}
