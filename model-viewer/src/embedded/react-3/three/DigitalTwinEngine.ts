import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  COMPONENTS,
  COMPONENT_BY_ID,
  LOAD_PATH_IDS,
  TIMELINE_IDS,
  type AnalysisMode,
  type CameraPreset,
  detectComponentId
} from "../data/componentRegistry";

interface BomVertex {
  position: { x: number; y: number; z: number };
}

interface BomFace {
  type?: string;
  id?: string;
  name?: string;
  layer?: string;
  surface_type?: string;
  area_m2?: number;
  volume_m3?: number;
  vertices?: BomVertex[];
  material_front?: { name?: string; color?: { hex?: string } };
}

interface BomEntity {
  type?: string;
  id?: string;
  name?: string;
  definition_name?: string;
  category?: string;
  size?: { x: number; y: number; z: number };
  center?: { x: number; y: number; z: number };
  children?: Array<BomEntity | BomFace>;
}

interface BomModel {
  entities?: Array<BomEntity | BomFace>;
  model_name?: string;
}

type MeshState = "active" | "context" | "muted" | "hidden" | "material";

interface ComponentGroup {
  id: string;
  meshes: THREE.Mesh[];
  state?: MeshState;
}

interface ViewState {
  mode: AnalysisMode;
  selectedId: string;
  scanDepth: number;
}

const STORY_CHUNK_SIZE = 620;
const SYNC_LIMIT = 420;
const CERUCUK_RENDER_MODE: "original" | "proxy" = "original";
const MAX_VERTICES_PER_FACE = 256;
const MAX_COORDINATE_ABS = 100000;

export class DigitalTwinEngine {
  private canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(45, 1, 0.01, 500);
  private controls: OrbitControls;
  private modelRoot = new THREE.Group();
  private lineLayer = new THREE.Group();
  private scanLayer = new THREE.Group();
  private gridHelper = new THREE.GridHelper(24, 24, 0xb8c2c9, 0xd7dde1);
  private ground: THREE.Mesh;
  private sceneBox = new THREE.Box3();
  private target = new THREE.Vector3(0, 1.2, 0);
  private spherical = { theta: 0.72, phi: 0.58, r: 16 };
  private groups = new Map<string, ComponentGroup>();
  private allMeshes: THREE.Mesh[] = [];
  private unmappedMeshes: THREE.Mesh[] = [];
  private cerucukOriginalMeshes: THREE.Mesh[] = [];
  private cerucukProxyGroup: THREE.Group | null = null;
  private materials = new Map<string, THREE.Material>();
  private activeMaterials = new Map<string, THREE.Material>();
  private contextMaterial = new THREE.MeshBasicMaterial({ color: 0x9aa5ad, side: THREE.DoubleSide });
  private mutedMaterial = new THREE.MeshBasicMaterial({ color: 0xd4dade, side: THREE.DoubleSide });
  private hiddenMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, visible: false });
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
    this.renderer.setClearColor(0xf7f9fa);

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

    this.scene.fog = new THREE.Fog(0xf7f9fa, 48, 120);
    this.scene.add(this.modelRoot, this.lineLayer, this.scanLayer);
    this.gridHelper.position.y = -0.03;
    this.scene.add(this.gridHelper);

    this.ground = new THREE.Mesh(
      new THREE.PlaneGeometry(42, 42),
      new THREE.MeshBasicMaterial({ color: 0xf3f6f7, side: THREE.DoubleSide })
    );
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.position.y = -0.04;
    this.scene.add(this.ground);

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xb6c0c7, 1.55));
    const key = new THREE.DirectionalLight(0xffffff, 0.75);
    key.position.set(10, 16, 12);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xdde8ee, 0.45);
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
    this.materials.forEach((material) => material.dispose());
    this.activeMaterials.forEach((material) => material.dispose());
    this.contextMaterial.dispose();
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
    this.fitToModel();
    this.buildLoadPathLines();
    this.buildScanIndicator();
    this.debugGroups();
    this.applyView({ mode: "overview", selectedId: "hasil_final", scanDepth: 50 });
  }

  applyView(view: ViewState) {
    const token = this.cancelPendingUpdates();
    const started = performance.now();
    this.lineLayer.visible = view.mode === "load-path";
    this.scanLayer.visible = view.mode === "section-scan";
    this.setScanDepth(view.scanDepth);

    const desired = this.computeDesiredStates(view);
    this.setCerucukRepresentation(CERUCUK_RENDER_MODE, view);
    let updated = 0;
    let pending = 0;
    const done = (count: number) => {
      updated += count;
      pending -= 1;
      if (pending === 0) {
        this.devLog("state", {
          mode: view.mode,
          selected: view.selectedId,
          selectedLabel: COMPONENT_BY_ID[view.selectedId]?.label ?? view.selectedId,
          updatedMeshes: updated,
          ms: Math.round((performance.now() - started) * 10) / 10,
          cerucukOriginalCount: this.cerucukOriginalMeshes.length,
          proxyVisible: this.cerucukProxyGroup?.visible ?? false,
          controlsEnabled: this.controls.enabled
        });
      }
    };

    this.groups.forEach((group, id) => {
      const next = desired.get(id) ?? "hidden";
      if (group.state === next) return;
      group.state = next;
      pending += 1;
      this.updateGroup(group, next, token, done);
    });

    if (pending === 0) {
      this.devLog("state", {
        mode: view.mode,
        selected: view.selectedId,
        selectedLabel: COMPONENT_BY_ID[view.selectedId]?.label ?? view.selectedId,
        updatedMeshes: 0,
        ms: Math.round((performance.now() - started) * 10) / 10,
        cerucukOriginalCount: this.cerucukOriginalMeshes.length,
        proxyVisible: this.cerucukProxyGroup?.visible ?? false,
        controlsEnabled: this.controls.enabled
      });
    }

    this.moveCameraFor(view);
    this.invalidate();
  }

  private computeDesiredStates(view: ViewState) {
    const desired = new Map<string, MeshState>();
    if (view.mode === "overview") {
      COMPONENTS.forEach((component) => {
        if (component.id !== "hasil_final") desired.set(component.id, "material");
      });
      return desired;
    }

    if (view.mode === "material-map") {
      COMPONENTS.forEach((component) => {
        if (component.id === "hasil_final") return;
        desired.set(component.id, component.id === view.selectedId ? "active" : "material");
      });
      return desired;
    }

    if (view.mode === "assembly") {
      const currentIndex = TIMELINE_IDS.indexOf(view.selectedId);
      TIMELINE_IDS.forEach((id, index) => {
        if (id === "hasil_final") return;
        if (index < currentIndex) desired.set(id, "context");
        if (index === currentIndex) desired.set(id, "active");
        if (view.selectedId === "hasil_final") desired.set(id, "material");
      });
      return desired;
    }

    if (view.mode === "component-focus") {
      const selected = COMPONENT_BY_ID[view.selectedId] ?? COMPONENT_BY_ID.hasil_final;
      if (selected.id === "hasil_final") {
        COMPONENTS.forEach((component) => {
          if (component.id !== "hasil_final") desired.set(component.id, "material");
        });
        return desired;
      }
      desired.set(selected.id, "active");
      if (selected.id !== "cerucuk") {
        selected.connected.forEach((id) => desired.set(id, "context"));
      }
      return desired;
    }

    if (view.mode === "load-path") {
      const focus = LOAD_PATH_IDS.includes(view.selectedId) ? view.selectedId : "kolom";
      LOAD_PATH_IDS.forEach((id) => desired.set(id, id === focus ? "active" : "context"));
      return desired;
    }

    const band = this.scanBand(view.scanDepth);
    band.active.forEach((id) => desired.set(id, "active"));
    band.context.forEach((id) => {
      if (!desired.has(id)) desired.set(id, "context");
    });
    return desired;
  }

  private scanBand(depth: number) {
    if (depth <= 15) return { active: ["atap_spandek", "perabung"], context: ["balok_ring"] };
    if (depth <= 25) return { active: ["plafon"], context: ["dinding_bata"] };
    if (depth <= 40) return { active: ["pintu", "jendela", "dinding_bata"], context: ["kolom", "balok_ring"] };
    if (depth <= 55) return { active: ["balok_ring", "kolom"], context: ["dinding_bata", "sloof"] };
    if (depth <= 68) return { active: ["keramik_lantai", "cor_lantai"], context: ["urugan"] };
    if (depth <= 80) return { active: ["urugan", "sloof"], context: ["cor_lantai", "pondasi_batu"] };
    if (depth <= 92) return { active: ["pondasi_batu"], context: ["sloof", "cerucuk", "urugan"] };
    return { active: ["cerucuk"], context: ["pondasi_batu", "urugan"] };
  }

  private updateGroup(group: ComponentGroup, state: MeshState, token: number, done: (count: number) => void) {
    const meshes = group.meshes;
    let cursor = 0;
    let updated = 0;
    const step = () => {
      if (token !== this.stateVersion) return;
      const end = meshes.length <= SYNC_LIMIT ? meshes.length : Math.min(cursor + STORY_CHUNK_SIZE, meshes.length);
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

  private applyMeshState(mesh: THREE.Mesh, componentId: string, state: MeshState) {
    const nextVisible = state !== "hidden";
    const nextMaterial = this.materialFor(componentId, state);
    if (mesh.userData.twinState === state && mesh.visible === nextVisible && mesh.material === nextMaterial) return 0;
    mesh.userData.twinState = state;
    mesh.visible = nextVisible;
    mesh.renderOrder = state === "active" ? 10 : 0;
    mesh.material = nextMaterial;
    return 1;
  }

  private materialFor(componentId: string, state: MeshState) {
    if (state === "hidden") return this.hiddenMaterial;
    if (state === "active") return this.activeMaterial(componentId);
    if (state === "context") return this.contextMaterial;
    if (state === "muted") return this.mutedMaterial;
    return this.baseMaterial(componentId);
  }

  private baseMaterial(componentId: string) {
    const existing = this.materials.get(componentId);
    if (existing) return existing;
    const color = COMPONENT_BY_ID[componentId]?.color ?? "#94A3B8";
    const material = new THREE.MeshPhongMaterial({
      color,
      shininess: 10,
      specular: new THREE.Color(0x72808a),
      side: THREE.DoubleSide,
      transparent: false,
      opacity: 1,
      depthWrite: true,
      depthTest: true
    });
    this.materials.set(componentId, material);
    return material;
  }

  private activeMaterial(componentId: string) {
    const existing = this.activeMaterials.get(componentId);
    if (existing) return existing;
    const base = new THREE.Color(COMPONENT_BY_ID[componentId]?.color ?? "#0F766E");
    const material = new THREE.MeshPhongMaterial({
      color: base.lerp(new THREE.Color(0xffffff), 0.18),
      shininess: 18,
      specular: new THREE.Color(0x6e7d86),
      side: THREE.DoubleSide,
      transparent: false,
      opacity: 1,
      depthWrite: true,
      depthTest: true
    });
    this.activeMaterials.set(componentId, material);
    return material;
  }

  private setCerucukRepresentation(mode: "original" | "proxy", view: ViewState) {
    if (view.selectedId === "hasil_final" || view.mode === "overview" || view.mode === "material-map") {
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

  private moveCameraFor(view: ViewState) {
    const preset =
      view.mode === "overview" || view.selectedId === "hasil_final"
        ? COMPONENT_BY_ID.hasil_final.camera
        : view.mode === "section-scan"
          ? { theta: 0.66, phi: 0.76, rFactor: 1.08, targetYBias: -0.08 }
          : COMPONENT_BY_ID[view.selectedId]?.camera ?? COMPONENT_BY_ID.hasil_final.camera;
    this.moveCamera(preset, view.selectedId === "hasil_final" ? 760 : 560);
  }

  private moveCamera(preset: CameraPreset, duration: number) {
    if (this.sceneBox.isEmpty()) return;
    if (!this.camAnim) this.syncSphericalFromCamera();
    this.cameraVersion += 1;
    const version = this.cameraVersion;
    const center = this.sceneBox.getCenter(new THREE.Vector3());
    const size = this.sceneBox.getSize(new THREE.Vector3());
    const footprint = Math.max(size.x, size.z);
    const endTarget = new THREE.Vector3(center.x, center.y + size.y * preset.targetYBias, center.z);
    const endR = Math.max(footprint * preset.rFactor, 4);
    this.camAnim = {
      version,
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
    this.controls.enabled = true;
    this.invalidate();
  }

  private walk(entities: Array<BomEntity | BomFace>, parentComponent: string | null, path: string[]) {
    entities.forEach((entity, index) => {
      if (this.isFace(entity)) {
        this.buildFace(entity, parentComponent, path);
        return;
      }

      const name = entity.name || entity.definition_name || entity.category || entity.type || `entity-${index}`;
      const detected = detectComponentId([name, entity.category], parentComponent);
      if (entity.size && entity.center) this.buildBox(entity, detected, [...path, name]);
      if (entity.children?.length) this.walk(entity.children, detected, [...path, name]);
    });
  }

  private buildFace(face: BomFace, parentComponent: string | null, path: string[]) {
    if (!face.vertices || face.vertices.length < 3) return;
    if (face.vertices.length > MAX_VERTICES_PER_FACE) throw new Error("Face has too many vertices.");
    const componentId = detectComponentId([face.name, face.layer, face.surface_type, face.material_front?.name, path.join(" ")], parentComponent);
    if (!componentId) return this.registerUnmappedFace(face);

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
    const mesh = new THREE.Mesh(geometry, this.baseMaterial(componentId));
    mesh.position.set(cx, cy, cz);
    mesh.userData = {
      componentId,
      name: face.name || face.material_front?.name || face.surface_type || componentId,
      layer: face.layer,
      surfaceType: face.surface_type,
      sourcePath: path.join(" > ")
    };
    this.registerMesh(componentId, mesh);
    this.sceneBox.union(new THREE.Box3().setFromObject(mesh));
  }

  private buildBox(entity: BomEntity, componentId: string | null, path: string[]) {
    if (!componentId || !entity.size || !entity.center) return;
    const geometry = new THREE.BoxGeometry(entity.size.x, entity.size.z, entity.size.y);
    const mesh = new THREE.Mesh(geometry, this.baseMaterial(componentId));
    mesh.position.set(entity.center.x, entity.center.z, -entity.center.y);
    mesh.userData = {
      componentId,
      name: entity.name || entity.definition_name || componentId,
      sourcePath: path.join(" > ")
    };
    this.registerMesh(componentId, mesh);
    this.sceneBox.union(new THREE.Box3().setFromObject(mesh));
  }

  private registerMesh(componentId: string, mesh: THREE.Mesh) {
    this.modelRoot.add(mesh);
    this.allMeshes.push(mesh);
    if (!this.groups.has(componentId)) this.groups.set(componentId, { id: componentId, meshes: [] });
    this.groups.get(componentId)?.meshes.push(mesh);
    if (componentId === "cerucuk") this.cerucukOriginalMeshes.push(mesh);
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
    this.disposeObjectTree(this.lineLayer);
    this.disposeObjectTree(this.scanLayer);
    this.allMeshes = [];
    this.unmappedMeshes = [];
    this.cerucukOriginalMeshes = [];
    this.groups.clear();
    this.lineLayer.clear();
    this.scanLayer.clear();
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

  private buildLoadPathLines() {
    if (this.sceneBox.isEmpty()) return;
    const box = this.sceneBox;
    const material = new THREE.LineBasicMaterial({ color: 0x0f766e, transparent: true, opacity: 0.78 });
    const xs = [0.2, 0.38, 0.55, 0.72, 0.86].map((t) => THREE.MathUtils.lerp(box.min.x, box.max.x, t));
    xs.forEach((x, i) => {
      const z = THREE.MathUtils.lerp(box.min.z, box.max.z, i % 2 ? 0.38 : 0.62);
      const points = [
        new THREE.Vector3(x, box.max.y - 0.2, z),
        new THREE.Vector3(x, box.max.y - box.getSize(new THREE.Vector3()).y * 0.34, z),
        new THREE.Vector3(x, box.min.y + 0.5, z),
        new THREE.Vector3(x, box.min.y - 0.5, z)
      ];
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), material);
      this.lineLayer.add(line);
    });
    this.lineLayer.visible = false;
  }

  private buildScanIndicator() {
    if (this.sceneBox.isEmpty()) return;
    const box = this.sceneBox;
    const material = new THREE.LineBasicMaterial({ color: 0xb45309, transparent: true, opacity: 0.8 });
    const points = [
      new THREE.Vector3(box.min.x, 0, box.min.z),
      new THREE.Vector3(box.max.x, 0, box.min.z),
      new THREE.Vector3(box.max.x, 0, box.max.z),
      new THREE.Vector3(box.min.x, 0, box.max.z),
      new THREE.Vector3(box.min.x, 0, box.min.z)
    ];
    this.scanLayer.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), material));
    this.scanLayer.visible = false;
  }

  private setScanDepth(depth: number) {
    if (this.sceneBox.isEmpty()) return;
    const y = THREE.MathUtils.lerp(this.sceneBox.max.y, this.sceneBox.min.y, depth / 100);
    this.scanLayer.position.y = y;
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

  private finiteCoordinate(value: unknown) {
    const numberValue = Number(value);
    if (!Number.isFinite(numberValue) || Math.abs(numberValue) > MAX_COORDINATE_ABS) throw new Error("Invalid model coordinate.");
    return numberValue;
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
    console.log(`[DigitalTwinEngine] ${label}`, data);
  }
}
