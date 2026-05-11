# BOM Engine Web Canvas — 3D Viewer Development Guide

> **Stack:** Vanilla JS + Three.js r128 + Tailwind CSS  
> **Input:** `house_model.json` from SketchUp Plugin  
> **Purpose:** Interactive 3D visualization, per-face BOM inspection, analysis overlays  
> **Target browsers:** Chrome 90+, Firefox 88+, Safari 14+, Edge 90+

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Project Structure](#2-project-structure)
3. [Environment Setup](#3-environment-setup)
4. [Core Systems](#4-core-systems)
   - 4.1 [Scene Initialization](#41-scene-initialization)
   - 4.2 [JSON Model Loader](#42-json-model-loader)
   - 4.3 [Geometry Builder](#43-geometry-builder)
   - 4.4 [Material System](#44-material-system)
   - 4.5 [Camera & Controls](#45-camera--controls)
   - 4.6 [Raycaster & Selection](#46-raycaster--selection)
5. [Render Modes](#5-render-modes)
6. [Analysis Overlays](#6-analysis-overlays)
   - 6.1 [BOM Overlay](#61-bom-overlay)
   - 6.2 [Lighting Heatmap](#62-lighting-heatmap)
   - 6.3 [Acoustic Heatmap](#63-acoustic-heatmap)
7. [UI Panel System](#7-ui-panel-system)
8. [State Management](#8-state-management)
9. [BOM Integration](#9-bom-integration)
10. [WebGL Performance Optimization](#10-webgl-performance-optimization)
11. [Export & Screenshot](#11-export--screenshot)
12. [Full Application Entry Point](#12-full-application-entry-point)
13. [API Reference](#13-api-reference)

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                      WEB APPLICATION                        │
│                                                             │
│  ┌──────────────┐   ┌─────────────────────────────────┐    │
│  │  UI Layer    │   │       Three.js Renderer          │    │
│  │  (HTML/CSS)  │   │                                  │    │
│  │              │   │  Scene → Groups → Meshes         │    │
│  │  Sidebar     │   │  Camera → OrbitControls          │    │
│  │  Inspector   │   │  Raycaster → Selection           │    │
│  │  BOM Panel   │   │  PostProcessing → Effects        │    │
│  └──────┬───────┘   └──────────────┬──────────────────┘    │
│         │                          │                        │
│         └──────────┬───────────────┘                        │
│                    │                                        │
│         ┌──────────▼───────────┐                            │
│         │    App State Store   │                            │
│         │  (selectedFace,      │                            │
│         │   renderMode,        │                            │
│         │   layerVisibility,   │                            │
│         │   bomData)           │                            │
│         └──────────┬───────────┘                            │
│                    │                                        │
│         ┌──────────▼───────────┐                            │
│         │   JSON Model Data    │ ← house_model.json         │
│         │   (parsed + cached)  │                            │
│         └──────────────────────┘                            │
└─────────────────────────────────────────────────────────────┘
```

**Key design principles:**
- Single source of truth: `AppState` object drives all UI and render updates
- No framework dependencies — pure JS for performance and portability
- Three.js objects map 1:1 to JSON entities via `userData` metadata
- Coordinate system: JSON Y → Three.js Z (SketchUp uses Z-up; Three.js uses Y-up)

---

## 2. Project Structure

```
bom_web_viewer/
│
├── index.html                    # App shell
├── package.json                  # Dev dependencies
│
├── src/
│   ├── main.js                   # Entry point, app bootstrap
│   ├── state.js                  # Centralized state management
│   │
│   ├── core/
│   │   ├── scene.js              # Three.js scene, renderer, lights setup
│   │   ├── loader.js             # JSON model loader + validator
│   │   ├── geometry.js           # Mesh builders from JSON entities
│   │   ├── materials.js          # Three.js material factory
│   │   ├── camera.js             # Camera setup + orbit controls
│   │   └── raycaster.js          # Mouse picking + selection system
│   │
│   ├── render/
│   │   ├── modes.js              # Render mode switching (shaded/wire/xray/surface)
│   │   ├── lighting.js           # Lighting heatmap overlay
│   │   ├── acoustic.js           # Acoustic heatmap overlay
│   │   └── section.js            # Section cut plane
│   │
│   ├── bom/
│   │   ├── engine.js             # BOM calculation engine
│   │   ├── ahsp_db.js            # SNI-AHSP coefficient database
│   │   └── price_list.js         # Regional price list
│   │
│   └── ui/
│       ├── sidebar.js            # Left sidebar: layers, stats, controls
│       ├── inspector.js          # Right panel: selected face details
│       ├── bom_panel.js          # BOM results table
│       ├── toolbar.js            # Top toolbar buttons
│       └── tooltip.js            # Hover tooltip
│
├── styles/
│   └── main.css                  # App styles (or Tailwind config)
│
├── data/
│   ├── ahsp_db.json              # SNI-AHSP coefficient database
│   └── price_list.json           # Regional material prices
│
└── public/
    └── demo_house.json           # Demo model for testing
```

---

## 3. Environment Setup

### 3.1 Dependencies

```json
// package.json
{
  "name": "bom-engine-web-viewer",
  "version": "2.0.0",
  "type": "module",
  "scripts": {
    "dev":   "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "three": "^0.128.0"
  },
  "devDependencies": {
    "vite": "^5.0.0"
  }
}
```

```bash
npm install
npm run dev    # → http://localhost:5173
```

### 3.2 CDN Alternative (No Build Tool)

```html
<!-- For standalone deployment without npm -->
<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
```

---

## 4. Core Systems

### 4.1 Scene Initialization

```javascript
// src/core/scene.js

export class SceneManager {

  constructor(canvasElement) {
    this.canvas   = canvasElement;
    this.scene    = null;
    this.renderer = null;
    this.lights   = {};
    this.helpers  = {};
    this._rafId   = null;

    this._init();
  }

  _init() {
    // ── Renderer ──────────────────────────────────────────
    this.renderer = new THREE.WebGLRenderer({
      canvas:    this.canvas,
      antialias: true,
      alpha:     false,
      powerPreference: "high-performance"
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type    = THREE.PCFSoftShadowMap;
    this.renderer.outputEncoding    = THREE.sRGBEncoding;
    this.renderer.toneMapping       = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.setClearColor(0x0a0c0f);

    // ── Scene ─────────────────────────────────────────────
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0x0a0c0f, 40, 120);

    // ── Lights ────────────────────────────────────────────
    this._setupLights();

    // ── Helpers ───────────────────────────────────────────
    this._setupHelpers();

    // ── Resize handler ────────────────────────────────────
    this._onResize = this._handleResize.bind(this);
    window.addEventListener('resize', this._onResize);
    this._handleResize();
  }

  _setupLights() {
    // Ambient — soft fill
    const ambient = new THREE.AmbientLight(0xffffff, 0.35);
    this.scene.add(ambient);
    this.lights.ambient = ambient;

    // Sun — directional with shadows
    const sun = new THREE.DirectionalLight(0xfff4e0, 1.4);
    sun.position.set(15, 25, 15);
    sun.castShadow = true;
    sun.shadow.mapSize.width  = 2048;
    sun.shadow.mapSize.height = 2048;
    sun.shadow.camera.near    = 0.5;
    sun.shadow.camera.far     = 200;
    sun.shadow.camera.left    = -30;
    sun.shadow.camera.right   =  30;
    sun.shadow.camera.top     =  30;
    sun.shadow.camera.bottom  = -30;
    sun.shadow.bias = -0.0003;
    this.scene.add(sun);
    this.lights.sun = sun;

    // Fill light — blue bounce from opposite side
    const fill = new THREE.DirectionalLight(0x4d9fff, 0.4);
    fill.position.set(-15, 5, -15);
    this.scene.add(fill);
    this.lights.fill = fill;

    // Hemisphere — sky/ground gradient
    const hemi = new THREE.HemisphereLight(0x87ceeb, 0x8b7355, 0.3);
    this.scene.add(hemi);
    this.lights.hemi = hemi;
  }

  _setupHelpers() {
    // Ground grid
    const grid = new THREE.GridHelper(80, 80, 0x1e2229, 0x151820);
    grid.position.y = 0;
    this.scene.add(grid);
    this.helpers.grid = grid;

    // World axes (small, at origin)
    const axes = new THREE.AxesHelper(0.5);
    this.scene.add(axes);
    this.helpers.axes = axes;
  }

  // ── Render loop ───────────────────────────────────────────
  startLoop(onFrame) {
    const tick = () => {
      this._rafId = requestAnimationFrame(tick);
      onFrame();
      this.renderer.render(this.scene, this._camera);
    };
    tick();
  }

  stopLoop() {
    cancelAnimationFrame(this._rafId);
  }

  setCamera(camera) {
    this._camera = camera;
  }

  _handleResize() {
    const container = this.canvas.parentElement;
    const w = container.clientWidth;
    const h = container.clientHeight;
    this.renderer.setSize(w, h);
    if (this._camera) {
      this._camera.aspect = w / h;
      this._camera.updateProjectionMatrix();
    }
  }

  // ── Shadow quality ────────────────────────────────────────
  setSunPosition(lat, northAngle, dateTime) {
    // Simplified solar position calculation
    const hour    = dateTime.getHours() + dateTime.getMinutes() / 60;
    const hourAngle = (hour - 12) * 15 * Math.PI / 180;
    const decl    = 0.0; // simplified: equinox

    const altitude = Math.asin(
      Math.sin(lat * Math.PI/180) * Math.sin(decl) +
      Math.cos(lat * Math.PI/180) * Math.cos(decl) * Math.cos(hourAngle)
    );
    const azimuth = Math.atan2(
      -Math.cos(decl) * Math.sin(hourAngle),
      Math.cos(lat * Math.PI/180) * Math.sin(decl) -
        Math.sin(lat * Math.PI/180) * Math.cos(decl) * Math.cos(hourAngle)
    );

    const r = 30;
    this.lights.sun.position.set(
      r * Math.cos(altitude) * Math.sin(azimuth + northAngle * Math.PI/180),
      r * Math.sin(altitude),
      r * Math.cos(altitude) * Math.cos(azimuth + northAngle * Math.PI/180)
    );
  }

  dispose() {
    this.stopLoop();
    window.removeEventListener('resize', this._onResize);
    this.renderer.dispose();
  }
}
```

---

### 4.2 JSON Model Loader

```javascript
// src/core/loader.js

export class ModelLoader {

  // Load from file input element
  static async fromFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload  = e => {
        try {
          const data = JSON.parse(e.target.result);
          resolve(ModelLoader.validate(data));
        } catch(err) {
          reject(new Error(`JSON parse error: ${err.message}`));
        }
      };
      reader.onerror = () => reject(new Error('File read error'));
      reader.readAsText(file);
    });
  }

  // Load from URL
  static async fromURL(url) {
    const res  = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
    const data = await res.json();
    return ModelLoader.validate(data);
  }

  // Load from raw JSON object
  static fromObject(data) {
    return ModelLoader.validate(data);
  }

  // Validate and normalize schema
  static validate(data) {
    const required = ['entities', 'spatial_analysis'];
    const missing  = required.filter(k => !data[k]);

    if (missing.length > 0) {
      console.warn(`[Loader] Missing fields: ${missing.join(', ')}. Using defaults.`);
    }

    // Fill defaults for missing fields
    return {
      schema_version:  data.schema_version || '1.0',
      exported_at:     data.exported_at    || null,
      metadata:        data.metadata       || { name: 'Unknown Model' },
      units:           data.units          || { output_unit: 'meters' },
      tags:            data.tags           || data.layers || [],
      materials:       data.materials      || [],
      spatial_analysis: data.spatial_analysis || {
        surface_summary: {},
        openings: [],
        facade_orientations: {}
      },
      scenes:          data.scenes         || [],
      entities:        data.entities       || [],
    };
  }
}
```

---

### 4.3 Geometry Builder

```javascript
// src/core/geometry.js

// Coordinate mapping: JSON (SketchUp Z-up) → Three.js (Y-up)
// JSON: { x, y, z }  →  Three.js: new THREE.Vector3(x, z, -y)
function j2t(p) {
  return new THREE.Vector3(p.x, p.z, -p.y);
}

function j2tNormal(n) {
  return new THREE.Vector3(n.x, n.z, -n.y).normalize();
}

export class GeometryBuilder {

  constructor(scene) {
    this.scene    = scene;
    this.meshes   = [];       // All face meshes — for raycasting
    this.groups   = new Map(); // name → THREE.Group
    this.root     = new THREE.Group();
    this.root.name = 'model_root';
    scene.add(this.root);
  }

  // Build entire model from JSON entities array
  build(entities, materialRegistry) {
    this._walk(entities, this.root, materialRegistry);
    this._centerModel();
    return this;
  }

  _walk(entities, parentGroup, materialRegistry) {
    if (!Array.isArray(entities)) return;

    for (const entity of entities) {
      if (!entity || !entity.type) continue;

      switch (entity.type) {
        case 'Face':
          this._buildFace(entity, parentGroup, materialRegistry);
          break;
        case 'Group':
        case 'ComponentInstance': {
          const group = new THREE.Group();
          group.name      = entity.name || entity.definition_name || 'group';
          group.userData  = {
            type:        entity.type,
            id:          entity.id,
            layer:       entity.layer,
            attributes:  entity.attributes || {}
          };
          parentGroup.add(group);
          this.groups.set(entity.id, group);
          this._walk(entity.children || [], group, materialRegistry);
          break;
        }
        // ImageEntity, Text — skip for now
      }
    }
  }

  _buildFace(faceData, parent, materialRegistry) {
    const verts = faceData.vertices;
    if (!verts || verts.length < 3) return;

    // Fan triangulation from vertex 0
    const positions = [];
    const normals   = [];
    const uvCoords  = [];

    const threeVerts = verts.map(v => j2t(v.position));
    const normal3    = j2tNormal(faceData.normal || { x:0, y:1, z:0 });

    for (let i = 1; i < threeVerts.length - 1; i++) {
      positions.push(
        threeVerts[0].x, threeVerts[0].y, threeVerts[0].z,
        threeVerts[i].x, threeVerts[i].y, threeVerts[i].z,
        threeVerts[i+1].x, threeVerts[i+1].y, threeVerts[i+1].z
      );
      for (let k = 0; k < 3; k++) {
        normals.push(normal3.x, normal3.y, normal3.z);
      }
      const uvSrc = [verts[0], verts[i], verts[i+1]];
      for (const uv of uvSrc) {
        uvCoords.push(uv.uv?.u || 0, uv.uv?.v || 0);
      }
    }

    if (positions.length === 0) return;

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geom.setAttribute('normal',   new THREE.Float32BufferAttribute(normals, 3));
    geom.setAttribute('uv',       new THREE.Float32BufferAttribute(uvCoords, 2));

    // Get or create Three.js material
    const mat = materialRegistry.get(faceData, faceData.material_front);

    const mesh = new THREE.Mesh(geom, mat);
    mesh.castShadow    = true;
    mesh.receiveShadow = true;
    mesh.userData = {
      type:             'face',
      id:               faceData.id,
      layer:            faceData.layer,
      surface_type:     faceData.surface_type,
      area_m2:          faceData.area_m2,
      material_name:    faceData.material_front?.name || 'default',
      reflectance:      faceData.material_front?.reflectance,
      absorption:       faceData.material_front?.acoustic_absorption,
      has_holes:        faceData.has_holes,
      normal_data:      faceData.normal,
      originalMat:      mat,
      // Store color for render mode switching
      baseColor:        this._getSurfaceColor(faceData),
    };

    // Edge outline
    const edgesGeom = new THREE.EdgesGeometry(geom, 15);
    const edgesMat  = new THREE.LineBasicMaterial({
      color: 0x1a1e24,
      linewidth: 1
    });
    const edges = new THREE.LineSegments(edgesGeom, edgesMat);
    mesh.add(edges);
    mesh.userData.edgeLines = edges;

    parent.add(mesh);
    this.meshes.push(mesh);
  }

  _getSurfaceColor(faceData) {
    // Priority: actual material color → surface type default
    if (faceData.material_front?.color) {
      const c = faceData.material_front.color;
      return new THREE.Color(c.r / 255, c.g / 255, c.b / 255);
    }
    const defaults = {
      floor:         0x8ab4a0,
      ceiling:       0xb0b8c4,
      wall_x_pos:    0xc8b89a,
      wall_x_neg:    0xc4b496,
      wall_y_pos:    0xbfad91,
      wall_y_neg:    0xbba98d,
      roof_slope:    0x967860,
      opening:       0x4d9fff,
      unknown:       0x9095a0,
    };
    return new THREE.Color(defaults[faceData.surface_type] || defaults.unknown);
  }

  _centerModel() {
    const box    = new THREE.Box3().setFromObject(this.root);
    const center = box.getCenter(new THREE.Vector3());
    const size   = box.getSize(new THREE.Vector3());

    // Center horizontally, sit on ground plane
    this.root.position.set(
      -center.x,
      -box.min.y,
      -center.z
    );

    return { box, center, size };
  }

  // ── Visibility control ────────────────────────────────────
  setLayerVisibility(layerName, visible) {
    this.meshes.forEach(m => {
      if (m.userData.layer === layerName) {
        m.visible = visible;
        if (m.userData.edgeLines) m.userData.edgeLines.visible = visible;
      }
    });
  }

  setSurfaceTypeVisibility(surfaceType, visible) {
    this.meshes.forEach(m => {
      if (m.userData.surface_type === surfaceType ||
          m.userData.surface_type?.startsWith(surfaceType)) {
        m.visible = visible;
      }
    });
  }

  dispose() {
    this.meshes.forEach(m => {
      m.geometry.dispose();
      if (Array.isArray(m.material)) m.material.forEach(mat => mat.dispose());
      else m.material.dispose();
    });
    this.scene.remove(this.root);
  }
}
```

---

### 4.4 Material System

```javascript
// src/core/materials.js

export class MaterialRegistry {

  constructor() {
    this._cache      = new Map();   // materialName → THREE.Material
    this._textures   = new Map();   // filename → THREE.Texture
    this._loader     = new THREE.TextureLoader();
    this._textureDir = null;        // base URL for texture files
  }

  setTextureBase(baseURL) {
    this._textureDir = baseURL;
  }

  // Get or create material for a face
  get(faceData, materialData) {
    const key      = `${faceData.surface_type}:${materialData?.name || 'default'}`;
    const isCeil   = faceData.surface_type === 'ceiling';

    if (this._cache.has(key)) return this._cache.get(key);

    // Determine base color
    let color;
    if (materialData?.color) {
      const c = materialData.color;
      color = new THREE.Color(c.r/255, c.g/255, c.b/255);
    } else {
      color = this._defaultColor(faceData.surface_type);
    }

    const mat = new THREE.MeshLambertMaterial({
      color,
      side:        THREE.DoubleSide,
      transparent: isCeil,
      opacity:     isCeil ? 0.4 : 1.0,
    });

    // Load texture if available
    if (materialData?.texture?.filename && this._textureDir) {
      const texURL = `${this._textureDir}/${materialData.texture.filename}`;
      this._loader.load(
        texURL,
        texture => {
          texture.wrapS = THREE.RepeatWrapping;
          texture.wrapT = THREE.RepeatWrapping;
          // Scale texture repeat based on physical size
          const w = materialData.texture.width_m  || 1.0;
          const h = materialData.texture.height_m || 1.0;
          texture.repeat.set(1/w, 1/h);
          mat.map = texture;
          mat.needsUpdate = true;
        },
        undefined,
        err => console.warn(`[Materials] Texture load failed: ${texURL}`)
      );
    }

    this._cache.set(key, mat);
    return mat;
  }

  // Create a fresh emissive highlight copy (for selection)
  createHighlight(baseMat, intensity = 0.4) {
    const m = baseMat.clone();
    m.emissive          = new THREE.Color(0x4fffb0);
    m.emissiveIntensity = intensity;
    return m;
  }

  _defaultColor(surfaceType) {
    const map = {
      floor:      0x8ab4a0,
      ceiling:    0xb0b8c4,
      roof_slope: 0x967860,
      opening:    0x4d9fff,
    };
    if (surfaceType?.startsWith('wall')) return new THREE.Color(0xc8b89a);
    return new THREE.Color(map[surfaceType] || 0x9095a0);
  }

  dispose() {
    this._cache.forEach(mat => mat.dispose());
    this._textures.forEach(tex => tex.dispose());
    this._cache.clear();
  }
}
```

---

### 4.5 Camera & Controls

```javascript
// src/core/camera.js

export class CameraController {

  constructor(renderer, initialRadius = 20) {
    this.renderer = renderer;
    this.camera   = new THREE.PerspectiveCamera(45, 1, 0.05, 500);

    // Spherical coordinates for orbit
    this._spherical = {
      theta:  Math.PI / 4,
      phi:    Math.PI / 3,
      radius: initialRadius
    };
    this._target  = new THREE.Vector3(0, 0, 0);
    this._isDragging   = false;
    this._isRightDrag  = false;
    this._prevMouse    = { x: 0, y: 0 };

    // Smooth damping
    this._targetSpherical = { ...this._spherical };
    this._targetTarget    = this._target.clone();
    this._dampFactor      = 0.1;

    this._bindEvents();
    this.updateCamera();
  }

  _bindEvents() {
    const canvas = this.renderer.domElement;

    canvas.addEventListener('mousedown', e => {
      this._isDragging  = true;
      this._isRightDrag = e.button === 2;
      this._prevMouse   = { x: e.clientX, y: e.clientY };
      canvas.style.cursor = 'grabbing';
    });

    canvas.addEventListener('contextmenu', e => e.preventDefault());

    window.addEventListener('mousemove', e => {
      if (!this._isDragging) return;
      const dx = (e.clientX - this._prevMouse.x) * 0.005;
      const dy = (e.clientY - this._prevMouse.y) * 0.005;
      this._prevMouse = { x: e.clientX, y: e.clientY };

      if (this._isRightDrag) {
        // Pan: move target
        const right = new THREE.Vector3();
        const up    = new THREE.Vector3(0, 1, 0);
        right.crossVectors(
          this.camera.position.clone().sub(this._target), up
        ).normalize();
        const panSpeed = this._targetSpherical.radius * 0.35;
        this._targetTarget.addScaledVector(right, -dx * panSpeed);
        this._targetTarget.y += dy * panSpeed;
      } else {
        // Orbit
        this._targetSpherical.theta -= dx;
        this._targetSpherical.phi = Math.max(
          0.05,
          Math.min(Math.PI - 0.05, this._targetSpherical.phi - dy)
        );
      }
    });

    window.addEventListener('mouseup', () => {
      this._isDragging = false;
      canvas.style.cursor = 'default';
    });

    canvas.addEventListener('wheel', e => {
      const factor = e.deltaY > 0 ? 1.1 : 0.9;
      this._targetSpherical.radius = Math.max(
        1,
        Math.min(150, this._targetSpherical.radius * factor)
      );
    }, { passive: true });

    // Touch support
    let lastTouchDist = null;
    canvas.addEventListener('touchstart', e => {
      if (e.touches.length === 1) {
        this._isDragging = true;
        this._isRightDrag = false;
        this._prevMouse = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      }
      if (e.touches.length === 2) {
        lastTouchDist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
      }
    }, { passive: true });

    canvas.addEventListener('touchmove', e => {
      if (e.touches.length === 1 && this._isDragging) {
        const dx = (e.touches[0].clientX - this._prevMouse.x) * 0.006;
        const dy = (e.touches[0].clientY - this._prevMouse.y) * 0.006;
        this._prevMouse = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        this._targetSpherical.theta -= dx;
        this._targetSpherical.phi = Math.max(0.05, Math.min(Math.PI-0.05, this._targetSpherical.phi - dy));
      }
      if (e.touches.length === 2) {
        const dist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
        if (lastTouchDist) {
          const scale = lastTouchDist / dist;
          this._targetSpherical.radius = Math.max(1, Math.min(150, this._targetSpherical.radius * scale));
        }
        lastTouchDist = dist;
      }
      e.preventDefault();
    }, { passive: false });

    canvas.addEventListener('touchend', () => {
      this._isDragging = false;
      lastTouchDist = null;
    });

    // Keyboard shortcuts
    window.addEventListener('keydown', e => this._handleKey(e));
  }

  _handleKey(e) {
    switch(e.key.toUpperCase()) {
      case 'R':
        this.resetView();
        break;
      case 'F':
        if (window.AppState?.selectedMesh) this.focusOn(window.AppState.selectedMesh);
        break;
    }
  }

  // ── Smooth update (call every frame) ─────────────────────
  update() {
    // Lerp towards target values for smooth damping
    this._spherical.theta  += (this._targetSpherical.theta  - this._spherical.theta)  * this._dampFactor;
    this._spherical.phi    += (this._targetSpherical.phi    - this._spherical.phi)    * this._dampFactor;
    this._spherical.radius += (this._targetSpherical.radius - this._spherical.radius) * this._dampFactor;
    this._target.lerp(this._targetTarget, this._dampFactor);
    this.updateCamera();
  }

  updateCamera() {
    const { theta, phi, radius } = this._spherical;
    this.camera.position.set(
      this._target.x + radius * Math.sin(phi) * Math.sin(theta),
      this._target.y + radius * Math.cos(phi),
      this._target.z + radius * Math.sin(phi) * Math.cos(theta)
    );
    this.camera.lookAt(this._target);
  }

  // ── Named view presets ────────────────────────────────────
  setView(preset) {
    const presets = {
      perspective: { theta: Math.PI/4,     phi: Math.PI/3 },
      top:         { theta: Math.PI/4,     phi: 0.01 },
      bottom:      { theta: Math.PI/4,     phi: Math.PI - 0.01 },
      front:       { theta: 0,             phi: Math.PI/2.1 },
      back:        { theta: Math.PI,       phi: Math.PI/2.1 },
      right:       { theta: Math.PI/2,     phi: Math.PI/2.1 },
      left:        { theta: -Math.PI/2,    phi: Math.PI/2.1 },
      iso:         { theta: -Math.PI/4,    phi: Math.PI/4 },
    };
    const v = presets[preset];
    if (!v) return;
    this._targetSpherical.theta = v.theta;
    this._targetSpherical.phi   = v.phi;
  }

  resetView(modelSize = null) {
    if (modelSize) {
      const maxDim = Math.max(modelSize.x, modelSize.y, modelSize.z);
      this._targetSpherical.radius = maxDim * 2.2;
    }
    this._targetSpherical.theta = Math.PI/4;
    this._targetSpherical.phi   = Math.PI/3;
    this._targetTarget.set(0, 0, 0);
  }

  focusOn(object) {
    const box    = new THREE.Box3().setFromObject(object);
    const center = box.getCenter(new THREE.Vector3());
    const size   = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    this._targetTarget.copy(center);
    this._targetSpherical.radius = maxDim * 2.5;
  }

  // For resize
  updateAspect(width, height) {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }
}
```

---

### 4.6 Raycaster & Selection

```javascript
// src/core/raycaster.js

export class SelectionManager {

  constructor(camera, renderer) {
    this._camera      = camera;
    this._renderer    = renderer;
    this._raycaster   = new THREE.Raycaster();
    this._mouse       = new THREE.Vector2();
    this._meshes      = [];
    this._selected    = null;
    this._hovered     = null;
    this._onSelect    = null;   // callback(mesh | null)
    this._onHover     = null;   // callback(mesh | null, event)
    this._isDragging  = false;
    this._mouseDownPos = null;

    this._bindEvents();
  }

  setMeshes(meshes) {
    this._meshes = meshes.filter(m => m.visible);
  }

  onSelect(cb) { this._onSelect = cb; }
  onHover(cb)  { this._onHover  = cb; }

  _bindEvents() {
    const canvas = this._renderer.domElement;

    canvas.addEventListener('mousedown', e => {
      this._isDragging   = false;
      this._mouseDownPos = { x: e.clientX, y: e.clientY };
    });

    canvas.addEventListener('mousemove', e => {
      // Detect drag vs click
      if (this._mouseDownPos) {
        const d = Math.hypot(e.clientX - this._mouseDownPos.x, e.clientY - this._mouseDownPos.y);
        if (d > 4) this._isDragging = true;
      }
      this._updateMouse(e);
      this._checkHover(e);
    });

    canvas.addEventListener('click', e => {
      if (this._isDragging) return;
      this._updateMouse(e);
      this._checkSelect();
    });
  }

  _updateMouse(e) {
    const rect = this._renderer.domElement.getBoundingClientRect();
    this._mouse.x =  ((e.clientX - rect.left) / rect.width)  * 2 - 1;
    this._mouse.y = -((e.clientY - rect.top)  / rect.height) * 2 + 1;
  }

  _checkHover(e) {
    this._raycaster.setFromCamera(this._mouse, this._camera);
    const visible   = this._meshes.filter(m => m.visible);
    const intersects = this._raycaster.intersectObjects(visible);

    const hit = intersects.length > 0 ? intersects[0].object : null;

    if (hit !== this._hovered) {
      // Un-highlight previous hover
      if (this._hovered && this._hovered !== this._selected) {
        this._restoreHighlight(this._hovered);
      }
      this._hovered = hit;
      // Highlight new hover
      if (hit && hit !== this._selected) {
        this._applyHighlight(hit, 0.25);
      }
      if (this._onHover) this._onHover(hit, e);
    }
  }

  _checkSelect() {
    this._raycaster.setFromCamera(this._mouse, this._camera);
    const visible    = this._meshes.filter(m => m.visible);
    const intersects = this._raycaster.intersectObjects(visible);

    // Un-select previous
    if (this._selected) {
      this._restoreHighlight(this._selected);
    }

    const hit = intersects.length > 0 ? intersects[0].object : null;
    this._selected = hit;

    if (hit) {
      this._applyHighlight(hit, 0.55);
    }

    if (this._onSelect) this._onSelect(hit);
  }

  _applyHighlight(mesh, intensity) {
    mesh.material.emissive          = new THREE.Color(0x4fffb0);
    mesh.material.emissiveIntensity = intensity;
  }

  _restoreHighlight(mesh) {
    if (mesh.material.emissive) {
      mesh.material.emissive.set(0x000000);
      mesh.material.emissiveIntensity = 0;
    }
  }

  clearSelection() {
    if (this._selected) {
      this._restoreHighlight(this._selected);
      this._selected = null;
    }
    if (this._onSelect) this._onSelect(null);
  }
}
```

---

## 5. Render Modes

```javascript
// src/render/modes.js

export const MODES = ['shaded', 'wireframe', 'xray', 'surface_type', 'thermal'];

export class RenderModeManager {

  constructor(meshes) {
    this._meshes       = meshes;
    this._currentMode  = 'shaded';
  }

  updateMeshes(meshes) {
    this._meshes = meshes;
  }

  setMode(mode) {
    this._currentMode = mode;
    this._meshes.forEach(m => this._applyMode(m, mode));
  }

  _applyMode(mesh, mode) {
    const ud  = mesh.userData;
    const mat = mesh.material;

    // Reset
    mat.wireframe    = false;
    mat.transparent  = false;
    mat.opacity      = 1.0;
    if (mesh.userData.edgeLines) mesh.userData.edgeLines.visible = true;

    switch (mode) {
      case 'shaded':
        mat.color.copy(ud.baseColor);
        mat.transparent = ud.surface_type === 'ceiling';
        mat.opacity     = ud.surface_type === 'ceiling' ? 0.35 : 1.0;
        break;

      case 'wireframe':
        mat.wireframe  = true;
        mat.color.set(0x4fffb0);
        if (mesh.userData.edgeLines) mesh.userData.edgeLines.visible = false;
        break;

      case 'xray':
        mat.transparent = true;
        mat.opacity     = 0.15;
        mat.color.copy(ud.baseColor);
        break;

      case 'surface_type': {
        const colors = {
          floor:      0x4fffb0,
          ceiling:    0xff6b35,
          wall_x_pos: 0x4d9fff,
          wall_x_neg: 0x3a8bee,
          wall_y_pos: 0x5580dd,
          wall_y_neg: 0x4470cc,
          roof_slope: 0xffcc44,
          opening:    0xff99cc,
          unknown:    0x778899,
        };
        const st = ud.surface_type;
        const c  = colors[st] ?? (st?.startsWith('wall') ? 0x4d9fff : 0x778899);
        mat.color.set(c);
        if (mesh.userData.edgeLines) mesh.userData.edgeLines.visible = false;
        break;
      }

      case 'thermal': {
        // Color by reflectance: blue (low) → green → red (high)
        const r = ud.reflectance ?? 0.5;
        mat.color.setHSL((1.0 - r) * 0.667, 1.0, 0.5);  // hue: 0=red, 0.667=blue
        if (mesh.userData.edgeLines) mesh.userData.edgeLines.visible = false;
        break;
      }
    }

    mat.needsUpdate = true;
  }
}
```

---

## 6. Analysis Overlays

### 6.1 BOM Overlay

```javascript
// When a face is selected, compute and display its BOM contribution

export function computeFaceBOM(faceData, ahspDB, priceList) {
  const surfType  = faceData.surface_type;
  const area      = faceData.area_m2;
  const matName   = faceData.material_name?.toLowerCase() || '';

  // Find matching work item
  const workItem = findWorkItem(ahspDB, surfType, matName);
  if (!workItem) return null;

  const materials = {};
  let   matCost   = 0;

  for (const [matId, coeff] of Object.entries(workItem.materials)) {
    const qty   = parseFloat((coeff.qty * area).toFixed(3));
    const price = priceList.materials[matId] || 0;
    const cost  = qty * price;
    materials[matId] = {
      qty,
      unit:       coeff.unit,
      unit_price: price,
      total:      Math.round(cost)
    };
    matCost += cost;
  }

  const labor = {};
  let   laborCost = 0;

  for (const [lId, coeff] of Object.entries(workItem.labor || {})) {
    const qty   = parseFloat((coeff.qty * area).toFixed(3));
    const price = priceList.labor[lId] || 0;
    const cost  = qty * price;
    labor[lId] = { qty, unit: coeff.unit, rate: price, total: Math.round(cost) };
    laborCost += cost;
  }

  return {
    work_item:     workItem.name,
    snl_ref:       workItem.id,
    area_m2:       area,
    materials,
    labor,
    subtotal_material: Math.round(matCost),
    subtotal_labor:    Math.round(laborCost),
    total:             Math.round(matCost + laborCost)
  };
}

function findWorkItem(ahspDB, surfType, matName) {
  for (const [, item] of Object.entries(ahspDB.work_items)) {
    if (!item.surface_type.some(st => surfType?.startsWith(st.split('_')[0]))) continue;
    if (item.trigger_keywords?.some(kw => matName.includes(kw))) return item;
  }
  // Fallback: first matching by surface type only
  for (const [, item] of Object.entries(ahspDB.work_items)) {
    if (item.surface_type.some(st => surfType?.startsWith(st.split('_')[0]))) return item;
  }
  return null;
}
```

### 6.2 Lighting Heatmap

```javascript
// src/render/lighting.js

export class LightingAnalyzer {

  // Estimate daylight factor per face based on:
  // - face normal vector
  // - facade orientation (north/south/east/west)
  // - time of day from model geolocation
  // Returns 0.0 – 1.0 normalized daylight score
  static score(faceData, spatialAnalysis, hourOfDay = 12) {
    const n = faceData.normal;
    if (!n) return 0;

    const surfType = faceData.surface_type;

    // Floors and ceilings don't receive direct window light (simplified)
    if (surfType === 'floor') return 0.1;
    if (surfType === 'ceiling') return 0.05;

    // Sun direction (simplified, 12:00 equinox, latitude-based)
    const lat     = spatialAnalysis.geolocation?.latitude || 0;
    const north   = spatialAnalysis.facade_orientations?.north_angle_deg || 0;
    const latRad  = lat * Math.PI / 180;
    const hourAngle = (hourOfDay - 12) * 15 * Math.PI / 180;

    // Sun direction vector (Z-up convention → Y-up for Three.js)
    const sunAlt  = Math.asin(Math.cos(latRad) * Math.cos(hourAngle));
    const sunAz   = Math.atan2(-Math.sin(hourAngle), Math.sin(latRad) * Math.cos(hourAngle));
    const sunX    = Math.cos(sunAlt) * Math.sin(sunAz + north * Math.PI/180);
    const sunY    = Math.cos(sunAlt) * Math.cos(sunAz + north * Math.PI/180);
    const sunZ    = Math.sin(sunAlt);

    // Dot product of face normal with sun direction
    // Normal is in JSON coords (Y-forward, Z-up)
    const dot = n.x * sunX + n.y * sunY + n.z * sunZ;
    const direct = Math.max(0, dot);

    // Window contribution (faces with openings receive more light)
    const windowBonus = faceData.has_holes ? 0.2 : 0;

    // Reflectance contribution
    const reflect = faceData.reflectance || 0.5;

    return Math.min(1.0, direct * 0.7 + reflect * 0.1 + windowBonus + 0.05);
  }

  static applyHeatmap(meshes, spatialAnalysis, hourOfDay = 12) {
    meshes.forEach(mesh => {
      if (!mesh.visible) return;
      const s = LightingAnalyzer.score(mesh.userData, spatialAnalysis, hourOfDay);
      // Map 0→blue (dark), 0.5→green, 1→yellow/red (bright)
      mesh.material.color.setHSL((1 - s) * 0.6, 0.9, 0.45);
      mesh.material.needsUpdate = true;
    });
  }
}
```

### 6.3 Acoustic Heatmap

```javascript
// src/render/acoustic.js

export class AcousticAnalyzer {

  // Simplified Sabine RT60 calculation per room
  // RT60 = 0.161 × V / (S × α_avg)
  // V = volume (m³), S = total surface area (m²), α = avg absorption coefficient
  static computeRT60(spatialAnalysis, meshes) {
    const V   = spatialAnalysis.estimated_volume_m3 || 100;
    const ss  = spatialAnalysis.surface_summary;
    const S   = (ss?.total_wall_area_m2 || 0) +
                (ss?.total_floor_area_m2 || 0) +
                (ss?.total_ceiling_area_m2 || 0);

    if (S === 0) return { rt60: null, rating: 'unknown' };

    // Weighted average absorption
    let totalAbsArea = 0;
    meshes.forEach(mesh => {
      const abs  = mesh.userData.absorption || 0.05;
      const area = mesh.userData.area_m2    || 0;
      totalAbsArea += abs * area;
    });

    const alpha_avg = totalAbsArea / S;
    const rt60      = (0.161 * V) / (S * alpha_avg);

    // Classify by use-case target
    let rating, color;
    if (rt60 < 0.3) {
      rating = 'Very Dead (anechoic)'; color = 0x4444ff;
    } else if (rt60 < 0.5) {
      rating = 'Good for speech';      color = 0x44ff44;
    } else if (rt60 < 0.8) {
      rating = 'Residential ideal';   color = 0xffff44;
    } else if (rt60 < 1.2) {
      rating = 'Slightly reverberant'; color = 0xff8844;
    } else {
      rating = 'Too reverberant';      color = 0xff4444;
    }

    return { rt60: rt60.toFixed(2), rating, color, alpha_avg: alpha_avg.toFixed(3), V, S };
  }

  static applyHeatmap(meshes) {
    meshes.forEach(mesh => {
      const abs = mesh.userData.absorption || 0.05;
      // Low absorption → red (hard/reflective), high → blue (soft/absorptive)
      mesh.material.color.setHSL(abs * 1.8, 0.85, 0.45);
      mesh.material.needsUpdate = true;
    });
  }
}
```

---

## 7. UI Panel System

```javascript
// src/ui/inspector.js

export class InspectorPanel {

  constructor(containerId) {
    this._el = document.getElementById(containerId);
  }

  show(mesh) {
    if (!mesh) { this.clear(); return; }
    const ud = mesh.userData;

    this._el.innerHTML = `
      <div class="inspector-header">
        <span class="type-badge ${ud.surface_type}">${ud.surface_type}</span>
        <span class="face-id">#${ud.id}</span>
      </div>

      <div class="inspector-section">
        <h4>Geometry</h4>
        <div class="row"><span>Area</span><span>${ud.area_m2} m²</span></div>
        <div class="row"><span>Layer</span><span>${ud.layer}</span></div>
        <div class="row"><span>Has openings</span><span>${ud.has_holes ? '✓ Yes' : 'No'}</span></div>
        <div class="row"><span>Normal</span>
          <span>${this._fmtVec(ud.normal_data)}</span></div>
      </div>

      <div class="inspector-section">
        <h4>Material</h4>
        <div class="row"><span>Name</span><span>${ud.material_name}</span></div>
        <div class="row"><span>Reflectance</span>
          <span>${ud.reflectance !== undefined ? (ud.reflectance*100).toFixed(0)+'%' : '—'}</span></div>
        <div class="row"><span>Acoustic α</span>
          <span>${ud.absorption !== undefined ? ud.absorption : '—'}</span></div>
      </div>

      <div id="bom-result-container">
        <div class="loading-text">Computing BOM...</div>
      </div>
    `;
  }

  showBOM(bomData) {
    const container = document.getElementById('bom-result-container');
    if (!container || !bomData) return;

    const matRows = Object.entries(bomData.materials)
      .map(([id, d]) => `
        <tr>
          <td>${id.replace(/_/g, ' ')}</td>
          <td>${d.qty} ${d.unit}</td>
          <td>${this._fmtCurrency(d.unit_price)}/${d.unit}</td>
          <td>${this._fmtCurrency(d.total)}</td>
        </tr>
      `).join('');

    container.innerHTML = `
      <div class="inspector-section">
        <h4>BOM — ${bomData.work_item}</h4>
        <div class="row muted"><span>SNI Ref:</span><span>${bomData.snl_ref}</span></div>
        <div class="row muted"><span>Area:</span><span>${bomData.area_m2} m²</span></div>

        <table class="bom-table">
          <thead>
            <tr><th>Material</th><th>Qty</th><th>Unit Price</th><th>Total</th></tr>
          </thead>
          <tbody>${matRows}</tbody>
        </table>

        <div class="bom-totals">
          <div class="row"><span>Material</span><span>${this._fmtCurrency(bomData.subtotal_material)}</span></div>
          <div class="row"><span>Labor</span><span>${this._fmtCurrency(bomData.subtotal_labor)}</span></div>
          <div class="row total"><span>Subtotal</span><span>${this._fmtCurrency(bomData.total)}</span></div>
        </div>
      </div>
    `;
  }

  clear() {
    this._el.innerHTML = `
      <div class="inspector-empty">
        <span>Click any face to inspect</span>
      </div>
    `;
  }

  _fmtVec(n) {
    if (!n) return '—';
    return `(${n.x.toFixed(2)}, ${n.y.toFixed(2)}, ${n.z.toFixed(2)})`;
  }

  _fmtCurrency(val) {
    return 'Rp ' + Math.round(val).toLocaleString('id-ID');
  }
}
```

---

## 8. State Management

```javascript
// src/state.js

// Simple reactive state store (no framework needed)
class Store {

  constructor(initial) {
    this._state     = { ...initial };
    this._listeners = {};
  }

  get(key)         { return this._state[key]; }
  getAll()         { return { ...this._state }; }

  set(key, value) {
    const prev = this._state[key];
    this._state[key] = value;
    if (prev !== value) {
      this._emit(key, value, prev);
      this._emit('*', { key, value, prev });
    }
  }

  on(key, handler) {
    if (!this._listeners[key]) this._listeners[key] = [];
    this._listeners[key].push(handler);
    return () => this.off(key, handler);  // returns unsubscribe fn
  }

  off(key, handler) {
    this._listeners[key] = (this._listeners[key] || []).filter(h => h !== handler);
  }

  _emit(key, value, prev) {
    (this._listeners[key] || []).forEach(h => h(value, prev));
  }
}

export const AppState = new Store({
  // Model data
  modelData:         null,

  // Render
  renderMode:        'shaded',
  showGrid:          true,
  showEdges:         true,

  // Selection
  selectedMesh:      null,
  hoveredMesh:       null,
  selectedBOM:       null,

  // Layer visibility: { layerName: true/false }
  layerVisibility:   {},

  // Surface type visibility
  surfaceVisibility: {
    floor:      true,
    ceiling:    true,
    wall:       true,
    roof_slope: true,
    opening:    true,
  },

  // Analysis overlay
  activeOverlay:     null,   // 'lighting' | 'acoustic' | null
  lightingHour:      12,

  // UI
  sidebarTab:        'layers',  // 'layers' | 'stats' | 'bom'
  isLoading:         false,
  loadProgress:      0,
  statusMessage:     'Ready',
});

// Example reactive wiring:
// AppState.on('renderMode', (mode) => renderModeManager.setMode(mode));
// AppState.on('selectedMesh', (mesh) => inspector.show(mesh));
```

---

## 9. BOM Integration

```javascript
// src/bom/engine.js — same logic as paper, adapted for browser

import { AHSP_DB }    from './ahsp_db.js';
import { PRICE_LIST } from './price_list.js';

export class BOMEngine {

  constructor(ahspDB = AHSP_DB, priceList = PRICE_LIST) {
    this.ahsp   = ahspDB;
    this.prices = priceList;
  }

  // Full model BOM from spatial analysis
  analyzeModel(modelData) {
    const sa      = modelData.spatial_analysis;
    const items   = this._mapWorkItems(sa);
    const bom     = this._calcBOM(items);
    const rab     = this._calcRAB(bom);
    return { items, bom, rab, metadata: modelData.metadata };
  }

  // Single face BOM (for inspector)
  analyzeFace(faceUserData) {
    const workItem = this._findWorkItem(
      faceUserData.surface_type,
      faceUserData.material_name?.toLowerCase() || ''
    );
    if (!workItem) return null;

    const area = faceUserData.area_m2;
    const mats = {}, labor = {};
    let   matCost = 0, laborCost = 0;

    for (const [id, c] of Object.entries(workItem.materials)) {
      const qty  = +(c.qty * area).toFixed(3);
      const cost = qty * (this.prices.materials[id] || 0);
      mats[id]   = { qty, unit: c.unit, unit_price: this.prices.materials[id] || 0, total: Math.round(cost) };
      matCost   += cost;
    }

    for (const [id, c] of Object.entries(workItem.labor || {})) {
      const qty  = +(c.qty * area).toFixed(3);
      const cost = qty * (this.prices.labor[id] || 0);
      labor[id]  = { qty, unit: c.unit, rate: this.prices.labor[id] || 0, total: Math.round(cost) };
      laborCost += cost;
    }

    return {
      work_item:         workItem.name,
      snl_ref:           workItem.id,
      area_m2:           area,
      materials:         mats,
      labor,
      subtotal_material: Math.round(matCost),
      subtotal_labor:    Math.round(laborCost),
      total:             Math.round(matCost + laborCost)
    };
  }

  _findWorkItem(surfType, matName) {
    const entries = Object.values(this.ahsp.work_items);
    const byKeyword = entries.find(item =>
      item.surface_type.some(st => surfType?.startsWith(st.split('_')[0])) &&
      item.trigger_keywords?.some(kw => matName.includes(kw))
    );
    return byKeyword || entries.find(item =>
      item.surface_type.some(st => surfType?.startsWith(st.split('_')[0]))
    ) || null;
  }

  _mapWorkItems(sa) {
    const ss   = sa.surface_summary;
    const opArea = sa.openings?.reduce((s, o) => s + (o.estimated_area_m2 || 0), 0) || 0;
    const netWall = Math.max(0, (ss.net_wall_area_m2 || ss.total_wall_area_m2) - opArea);

    return [
      { ahsp_id: 'dinding_bata_merah_half_1pc5pp', volume: netWall,   label: 'Brick Wall (½ brick)' },
      { ahsp_id: 'plesteran_1pc5pp',               volume: netWall*2, label: 'Plastering (both sides)' },
      { ahsp_id: 'acian',                           volume: netWall*2, label: 'Skim Coat' },
      { ahsp_id: 'cat_dinding_interior',            volume: netWall*2, label: 'Interior Paint' },
      { ahsp_id: 'lantai_keramik_40x40',            volume: ss.total_floor_area_m2 || 0, label: 'Ceramic Floor 40×40' },
    ].filter(item => item.volume > 0);
  }

  _calcBOM(items) {
    const mTotals = {};
    const lTotals = {};
    const detail  = [];

    for (const item of items) {
      const wi = this.ahsp.work_items[item.ahsp_id];
      if (!wi) continue;

      const mBreak = {}, lBreak = {};

      for (const [id, c] of Object.entries(wi.materials)) {
        const qty = +(c.qty * item.volume).toFixed(3);
        mBreak[id]              = { qty, unit: c.unit };
        mTotals[id]             = mTotals[id] || { qty: 0, unit: c.unit };
        mTotals[id].qty        += qty;
      }

      for (const [id, c] of Object.entries(wi.labor || {})) {
        const qty = +(c.qty * item.volume).toFixed(3);
        lBreak[id]              = { qty, unit: c.unit };
        lTotals[id]             = lTotals[id] || { qty: 0, unit: c.unit };
        lTotals[id].qty        += qty;
      }

      detail.push({ ...item, breakdown: { materials: mBreak, labor: lBreak } });
    }

    return { materialTotals: mTotals, laborTotals: lTotals, itemDetails: detail };
  }

  _calcRAB(bom) {
    let matCost = 0, laborCost = 0;
    const mRAB = {}, lRAB = {}, itemRAB = [];

    for (const [id, d] of Object.entries(bom.materialTotals)) {
      const p = this.prices.materials[id] || 0;
      const c = d.qty * p;
      mRAB[id] = { qty: d.qty, unit: d.unit, unit_price: p, total: Math.round(c) };
      matCost += c;
    }

    for (const [id, d] of Object.entries(bom.laborTotals)) {
      const p = this.prices.labor[id] || 0;
      const c = d.qty * p;
      lRAB[id] = { qty: d.qty, unit: d.unit, rate: p, total: Math.round(c) };
      laborCost += c;
    }

    bom.itemDetails.forEach(item => {
      const wi = this.ahsp.work_items[item.ahsp_id];
      let mc = 0, lc = 0;
      for (const [id, d] of Object.entries(item.breakdown.materials || {})) {
        mc += d.qty * (this.prices.materials[id] || 0);
      }
      for (const [id, d] of Object.entries(item.breakdown.labor || {})) {
        lc += d.qty * (this.prices.labor[id] || 0);
      }
      itemRAB.push({ label: item.label, volume: item.volume, unit: wi?.unit || 'm2',
                     mat: Math.round(mc), labor: Math.round(lc), total: Math.round(mc+lc) });
    });

    const ppn = (matCost + laborCost) * 0.11;

    return {
      item_rab:            itemRAB,
      material_rekapitulasi: mRAB,
      labor_rekapitulasi:  lRAB,
      cost_summary: {
        material:   Math.round(matCost),
        labor:      Math.round(laborCost),
        subtotal:   Math.round(matCost + laborCost),
        ppn_11pct:  Math.round(ppn),
        grand_total: Math.round(matCost + laborCost + ppn)
      }
    };
  }
}
```

---

## 10. WebGL Performance Optimization

```javascript
// src/core/geometry.js — performance additions

// 1. INSTANCED MESH for repeated components
// If same ComponentDefinition appears >10 times, use InstancedMesh
function buildInstancedComponents(definitions, scene) {
  definitions.forEach(defn => {
    if (defn.instance_count < 10) return;  // not worth instancing

    const instanceMesh = new THREE.InstancedMesh(
      mergedGeometry(defn),  // merged geometry of all faces in definition
      sharedMaterial,
      defn.instance_count
    );

    defn.instances.forEach((inst, i) => {
      const matrix = new THREE.Matrix4();
      matrix.fromArray(inst.transformation_matrix);
      instanceMesh.setMatrixAt(i, matrix);
    });

    instanceMesh.instanceMatrix.needsUpdate = true;
    scene.add(instanceMesh);
  });
}

// 2. FRUSTUM CULLING — automatic in Three.js
// Ensure bounding spheres are computed
function ensureBoundingSpheres(meshes) {
  meshes.forEach(m => {
    m.geometry.computeBoundingSphere();
    m.geometry.computeBoundingBox();
  });
}

// 3. LEVEL OF DETAIL — reduce geometry at distance
function buildLOD(faceData, materialRegistry) {
  const lod = new THREE.LOD();

  // High detail: full polygon count
  lod.addLevel(buildHighDetail(faceData, materialRegistry), 0);

  // Low detail at >50m: single quad
  lod.addLevel(buildLowDetail(faceData, materialRegistry), 50);

  return lod;
}

// 4. MERGE STATIC GEOMETRY per layer (reduces draw calls dramatically)
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

function mergeByLayer(meshes) {
  const byLayer = {};
  meshes.forEach(m => {
    const layer = m.userData.layer || 'default';
    if (!byLayer[layer]) byLayer[layer] = [];
    byLayer[layer].push(m.geometry);
  });

  return Object.entries(byLayer).map(([layer, geoms]) => {
    const merged = mergeGeometries(geoms);
    return new THREE.Mesh(merged, new THREE.MeshLambertMaterial({ side: THREE.DoubleSide }));
  });
}

// 5. PROGRESSIVE LOADING — stream entities in chunks
async function loadEntitiesProgressive(entities, builder, chunkSize = 200) {
  const total  = entities.length;
  let   loaded = 0;

  while (loaded < total) {
    const chunk = entities.slice(loaded, loaded + chunkSize);
    await new Promise(resolve => {
      setTimeout(() => {
        builder._walk(chunk, builder.root);
        loaded += chunk.length;
        AppState.set('loadProgress', loaded / total);
        resolve();
      }, 0);
    });
  }
}
```

---

## 11. Export & Screenshot

```javascript
// src/ui/toolbar.js — export functions

export function screenshotCanvas(renderer, filename = 'model_view.png') {
  // Must call before renderer.render() clears the buffer
  renderer.render(scene, camera);

  const link = document.createElement('a');
  link.href     = renderer.domElement.toDataURL('image/png');
  link.download = filename;
  link.click();
}

export function exportBOMasCSV(rabData) {
  const rows = [
    ['Work Item', 'Volume', 'Unit', 'Material Cost (IDR)', 'Labor Cost (IDR)', 'Total (IDR)'],
    ...rabData.item_rab.map(r => [r.label, r.volume, r.unit, r.mat, r.labor, r.total]),
    [],
    ['GRAND TOTAL', '', '', '', '', rabData.cost_summary.grand_total]
  ];

  const csv  = rows.map(r => r.join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href     = URL.createObjectURL(blob);
  link.download = 'bom_report.csv';
  link.click();
}

export function exportModelJSON(modelData) {
  const json = JSON.stringify(modelData, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const link = document.createElement('a');
  link.href     = URL.createObjectURL(blob);
  link.download = 'house_model_export.json';
  link.click();
}
```

---

## 12. Full Application Entry Point

```javascript
// src/main.js

import { SceneManager }      from './core/scene.js';
import { ModelLoader }       from './core/loader.js';
import { GeometryBuilder }   from './core/geometry.js';
import { MaterialRegistry }  from './core/materials.js';
import { CameraController }  from './core/camera.js';
import { SelectionManager }  from './core/raycaster.js';
import { RenderModeManager } from './render/modes.js';
import { LightingAnalyzer }  from './render/lighting.js';
import { AcousticAnalyzer }  from './render/acoustic.js';
import { BOMEngine }         from './bom/engine.js';
import { InspectorPanel }    from './ui/inspector.js';
import { AppState }          from './state.js';

// ── Bootstrap ──────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {

  // Core systems
  const canvas    = document.getElementById('canvas-3d');
  const scene     = new SceneManager(canvas);
  const camera    = new CameraController(scene.renderer, 25);
  const matReg    = new MaterialRegistry();
  const selector  = new SelectionManager(camera.camera, scene.renderer);
  const inspector = new InspectorPanel('inspector-panel');
  const bom       = new BOMEngine();

  scene.setCamera(camera.camera);

  let geoBuilder    = null;
  let renderModes   = null;
  let currentModel  = null;

  // ── Render loop ────────────────────────────────────────
  scene.startLoop(() => {
    camera.update();
  });

  // ── Load model ─────────────────────────────────────────
  async function loadModel(data) {
    AppState.set('isLoading', true);
    AppState.set('statusMessage', 'Building geometry...');

    // Cleanup previous model
    if (geoBuilder) geoBuilder.dispose();
    matReg.dispose();

    currentModel = data;
    geoBuilder   = new GeometryBuilder(scene.scene);
    renderModes  = new RenderModeManager([]);

    // Build geometry
    geoBuilder.build(data.entities, matReg);
    selector.setMeshes(geoBuilder.meshes);
    renderModes.updateMeshes(geoBuilder.meshes);

    // Reset camera to fit model
    const box  = new THREE.Box3().setFromObject(geoBuilder.root);
    const size = box.getSize(new THREE.Vector3());
    camera.resetView(size);

    // Update UI
    updateSidebarStats(data);
    updateLayerList(data);

    AppState.set('isLoading',     false);
    AppState.set('statusMessage', `${geoBuilder.meshes.length} faces loaded`);
    AppState.set('modelData',     data);

    // Hide upload zone
    document.getElementById('upload-zone').style.display = 'none';
  }

  // ── Reactive state wiring ──────────────────────────────
  AppState.on('renderMode', mode => {
    renderModes?.setMode(mode);
    document.querySelectorAll('[data-mode]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mode === mode);
    });
  });

  AppState.on('selectedMesh', mesh => {
    inspector.show(mesh);
    if (mesh && currentModel) {
      const bomResult = bom.analyzeFace(mesh.userData);
      inspector.showBOM(bomResult);
      AppState.set('selectedBOM', bomResult);
    }
  });

  AppState.on('activeOverlay', overlay => {
    if (!geoBuilder || !currentModel) return;
    const meshes = geoBuilder.meshes;
    const sa     = currentModel.spatial_analysis;

    if (overlay === 'lighting') {
      LightingAnalyzer.applyHeatmap(meshes, sa, AppState.get('lightingHour'));
    } else if (overlay === 'acoustic') {
      AcousticAnalyzer.applyHeatmap(meshes);
      const rt60 = AcousticAnalyzer.computeRT60(sa, meshes);
      updateAcousticDisplay(rt60);
    } else {
      renderModes.setMode(AppState.get('renderMode'));
    }
  });

  // ── Selection callbacks ────────────────────────────────
  selector.onSelect(mesh => AppState.set('selectedMesh', mesh));
  selector.onHover((mesh, event) => updateTooltip(mesh, event));

  // ── File input ─────────────────────────────────────────
  document.getElementById('file-input').addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const data = await ModelLoader.fromFile(file);
      await loadModel(data);
    } catch(err) {
      AppState.set('statusMessage', `Error: ${err.message}`);
    }
  });

  // ── Demo model ─────────────────────────────────────────
  document.getElementById('load-demo-btn')?.addEventListener('click', async () => {
    try {
      const data = await ModelLoader.fromURL('./public/demo_house.json');
      await loadModel(data);
    } catch(err) {
      AppState.set('statusMessage', `Demo load failed: ${err.message}`);
    }
  });

  // ── UI button wiring ───────────────────────────────────
  document.querySelectorAll('[data-mode]').forEach(btn => {
    btn.addEventListener('click', () => AppState.set('renderMode', btn.dataset.mode));
  });

  document.querySelectorAll('[data-view]').forEach(btn => {
    btn.addEventListener('click', () => camera.setView(btn.dataset.view));
  });

  document.querySelectorAll('[data-overlay]').forEach(btn => {
    btn.addEventListener('click', () => {
      const ov = btn.dataset.overlay;
      AppState.set('activeOverlay', AppState.get('activeOverlay') === ov ? null : ov);
    });
  });

  // Keyboard shortcuts
  window.addEventListener('keydown', e => {
    const map = { '1':'shaded', '2':'wireframe', '3':'xray', '4':'surface_type' };
    if (map[e.key]) AppState.set('renderMode', map[e.key]);
  });
});

// ── Helpers ────────────────────────────────────────────────
function updateSidebarStats(data) {
  const ss = data.spatial_analysis?.surface_summary || {};
  const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  setEl('stat-wall',   (ss.net_wall_area_m2 || 0).toFixed(1));
  setEl('stat-floor',  (ss.total_floor_area_m2 || 0).toFixed(1));
  setEl('stat-faces',  ss.total_faces || 0);
  setEl('stat-open',   (data.spatial_analysis?.openings?.length || 0));
  setEl('model-name',  data.metadata?.name || 'Model');
}

function updateLayerList(data) {
  const list = document.getElementById('layers-list');
  if (!list) return;
  list.innerHTML = '';

  (data.tags || []).forEach(tag => {
    const div = document.createElement('div');
    div.className = 'layer-row';
    div.innerHTML = `
      <input type="checkbox" id="layer-${tag.name}" checked>
      <label for="layer-${tag.name}">${tag.name}</label>
    `;
    div.querySelector('input').addEventListener('change', e => {
      geoBuilder?.setLayerVisibility(tag.name, e.target.checked);
    });
    list.appendChild(div);
  });
}

function updateTooltip(mesh, event) {
  const tooltip = document.getElementById('tooltip');
  if (!tooltip) return;
  if (!mesh) { tooltip.style.opacity = 0; return; }

  const ud = mesh.userData;
  tooltip.innerHTML = `
    <div class="tt-title">${ud.material_name || ud.surface_type}</div>
    <div class="tt-row">Type: <b>${ud.surface_type}</b></div>
    <div class="tt-row">Area: <b>${ud.area_m2} m²</b></div>
    <div class="tt-row">Layer: <b>${ud.layer}</b></div>
  `;
  tooltip.style.opacity = 1;
  tooltip.style.left    = (event.clientX + 14) + 'px';
  tooltip.style.top     = (event.clientY - 10) + 'px';
}

function updateAcousticDisplay(rt60) {
  const el = document.getElementById('rt60-display');
  if (!el) return;
  el.innerHTML = `RT60: <b>${rt60.rt60}s</b> — ${rt60.rating}`;
  el.style.color = '#' + new THREE.Color(rt60.color).getHexString();
}
```

---

## 13. API Reference

### AppState keys

| Key | Type | Description |
|-----|------|-------------|
| `modelData` | Object \| null | Loaded JSON model data |
| `renderMode` | String | `shaded` \| `wireframe` \| `xray` \| `surface_type` \| `thermal` |
| `selectedMesh` | THREE.Mesh \| null | Currently selected face mesh |
| `selectedBOM` | Object \| null | BOM result for selected face |
| `activeOverlay` | String \| null | `lighting` \| `acoustic` \| null |
| `lightingHour` | Number | 0–23, hour for lighting simulation |
| `layerVisibility` | Object | `{ layerName: boolean }` |
| `surfaceVisibility` | Object | `{ surface_type: boolean }` |
| `isLoading` | Boolean | Loading indicator flag |
| `statusMessage` | String | Bottom status bar text |

### GeometryBuilder methods

| Method | Description |
|--------|-------------|
| `build(entities, matReg)` | Build full model from JSON entities |
| `setLayerVisibility(name, bool)` | Toggle visibility by layer name |
| `setSurfaceTypeVisibility(type, bool)` | Toggle visibility by surface type |
| `dispose()` | Free GPU memory |

### CameraController methods

| Method | Description |
|--------|-------------|
| `setView(preset)` | `perspective` \| `top` \| `front` \| `right` \| `iso` \| ... |
| `resetView(size?)` | Reset to default orbit with optional model size |
| `focusOn(object)` | Zoom to fit a specific Three.js object |
| `update()` | Call every frame for smooth damping |

### BOMEngine methods

| Method | Description |
|--------|-------------|
| `analyzeModel(modelData)` | Full model BOM from spatial analysis |
| `analyzeFace(faceUserData)` | Single face BOM for inspector |

---

*Documentation maintained by [Research Team], [Institution Name], 2026.*
