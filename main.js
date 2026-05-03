import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { translations } from './translations.js';

// --- State ---
const state = {
  h: 1,
  k: 1,
  l: 1,
  notation: 'plane', // 'plane', 'direction', 'plane-family', 'direction-family'
  lattice: 'none',
  showAtoms: true,
  sweep: false,
  savedEntries: [], // Array of {h, k, l, notation, color, id}
  lang: 'en'
};

const PALETTE = [
  '#00f0ff', '#ff00ea', '#ffeb3b', '#00ff73', '#ff5722', '#b388ff'
];
let colorIndex = 0;

// --- Three.js Setup ---
const container = document.getElementById('canvas-container');
const scene = new THREE.Scene();

// Camera setup
const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(2.5, 2, 3);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
container.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;

// Lights
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambientLight);
const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
directionalLight.position.set(5, 10, 7);
scene.add(directionalLight);

// --- Crystal Setup ---
const crystalGroup = new THREE.Group();

// **AXIS SWAP**
// We want Local X -> World Z (Out), Local Y -> World X (Right), Local Z -> World Y (Up)
const swapMat = new THREE.Matrix4().set(
  0, 1, 0, 0,
  0, 0, 1, 0,
  1, 0, 0, 0,
  0, 0, 0, 1
);
crystalGroup.applyMatrix4(swapMat);

scene.add(crystalGroup);
// Set orbit controls target to the center of the unit cell in WORLD space
// The center of local [0,1]^3 is (0.5, 0.5, 0.5). With our matrix, it's still (0.5, 0.5, 0.5) in world space!
controls.target.set(0.5, 0.5, 0.5);

// Dynamic objects
let dynamicMeshes = [];
let atomMeshes = [];
let sweepTime = 0;
let existingLabels = [];

function createTextSprite(message, color = "rgba(255, 255, 255, 1)") {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  canvas.width = 256;
  canvas.height = 64;
  context.font = "Bold 32px Arial";
  context.fillStyle = color;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(message, 128, 32);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  const spriteMaterial = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(spriteMaterial);
  sprite.scale.set(1.0, 0.25, 1);
  return sprite;
}

function drawUnitCell() {
  const toRemove = [];
  crystalGroup.children.forEach(c => {
    if (c.userData.isStatic) toRemove.push(c);
  });
  toRemove.forEach(c => crystalGroup.remove(c));

  // 1. Draw Axes
  const axesHelper = new THREE.AxesHelper(1.5);
  axesHelper.userData.isStatic = true;
  crystalGroup.add(axesHelper);

  // Axes labels - Local coordinates
  const xLabel = createTextSprite("x (a)", "rgba(255, 100, 100, 1)");
  xLabel.position.set(1.6, 0, 0);
  xLabel.userData.isStatic = true;
  crystalGroup.add(xLabel);

  const yLabel = createTextSprite("y (b)", "rgba(100, 255, 100, 1)");
  yLabel.position.set(0, 1.6, 0);
  yLabel.userData.isStatic = true;
  crystalGroup.add(yLabel);

  const zLabel = createTextSprite("z (c)", "rgba(100, 100, 255, 1)");
  zLabel.position.set(0, 0, 1.6);
  zLabel.userData.isStatic = true;
  crystalGroup.add(zLabel);
  
  // Ticks at 1
  const tickLabelX = createTextSprite("1", "rgba(200, 200, 200, 1)");
  tickLabelX.position.set(1, -0.1, 0);
  tickLabelX.userData.isStatic = true;
  crystalGroup.add(tickLabelX);

  const tickLabelY = createTextSprite("1", "rgba(200, 200, 200, 1)");
  tickLabelY.position.set(-0.1, 1, 0);
  tickLabelY.userData.isStatic = true;
  crystalGroup.add(tickLabelY);

  const tickLabelZ = createTextSprite("1", "rgba(200, 200, 200, 1)");
  tickLabelZ.position.set(0, -0.1, 1);
  tickLabelZ.userData.isStatic = true;
  crystalGroup.add(tickLabelZ);

  // 2. Draw Unit Cell Box
  const a = 1;
  const boxGeom = new THREE.BoxGeometry(a, a, a);
  const edges = new THREE.EdgesGeometry(boxGeom);
  const lineMat = new THREE.LineBasicMaterial({ color: 0x445566, linewidth: 2 });
  const boxLines = new THREE.LineSegments(edges, lineMat);
  boxLines.position.set(a/2, a/2, a/2);
  boxLines.userData.isStatic = true;
  crystalGroup.add(boxLines);
}

drawUnitCell();

// --- Crystallography Logic ---

function getPlaneIntersections(A, B, C, D) {
  const points = [];
  const edges = [
    [[0,0,0], [1,0,0]], [[1,0,0], [1,1,0]], [[1,1,0], [0,1,0]], [[0,1,0], [0,0,0]], // bottom
    [[0,0,1], [1,0,1]], [[1,0,1], [1,1,1]], [[1,1,1], [0,1,1]], [[0,1,1], [0,0,1]], // top
    [[0,0,0], [0,0,1]], [[1,0,0], [1,0,1]], [[1,1,0], [1,1,1]], [[0,1,0], [0,1,1]]  // pillars
  ];

  for (let edge of edges) {
    const [p1, p2] = edge;
    const denom = A*(p2[0]-p1[0]) + B*(p2[1]-p1[1]) + C*(p2[2]-p1[2]);
    const num = D - (A*p1[0] + B*p1[1] + C*p1[2]);
    if (Math.abs(denom) > 1e-6) {
      const t = num / denom;
      if (t >= -1e-6 && t <= 1 + 1e-6) {
        const x = p1[0] + t*(p2[0]-p1[0]);
        const y = p1[1] + t*(p2[1]-p1[1]);
        const z = p1[2] + t*(p2[2]-p1[2]);
        points.push(new THREE.Vector3(x, y, z));
      }
    } else {
      if (Math.abs(num) < 1e-6) {
        points.push(new THREE.Vector3(...p1));
        points.push(new THREE.Vector3(...p2));
      }
    }
  }

  const uniquePoints = [];
  for (let p of points) {
    let duplicate = false;
    for (let up of uniquePoints) {
      if (p.distanceTo(up) < 1e-4) {
        duplicate = true; break;
      }
    }
    if (!duplicate) uniquePoints.push(p);
  }

  if (uniquePoints.length < 3) return null;

  const center = new THREE.Vector3(0,0,0);
  for (let p of uniquePoints) center.add(p);
  center.divideScalar(uniquePoints.length);

  const normal = new THREE.Vector3(A, B, C).normalize();
  if (normal.length() < 1e-6) return uniquePoints;

  let up = new THREE.Vector3(0, 1, 0);
  if (Math.abs(normal.y) > 0.99) up = new THREE.Vector3(1, 0, 0);
  const u = new THREE.Vector3().crossVectors(up, normal).normalize();
  const v = new THREE.Vector3().crossVectors(normal, u).normalize();

  uniquePoints.sort((a, b) => {
    const da = new THREE.Vector3().subVectors(a, center);
    const db = new THREE.Vector3().subVectors(b, center);
    return Math.atan2(da.dot(v), da.dot(u)) - Math.atan2(db.dot(v), db.dot(u));
  });

  return uniquePoints;
}

function createPolygonMesh(points, color, opacity) {
  const geometry = new THREE.BufferGeometry();
  const vertices = [];
  for (let i = 1; i < points.length - 1; i++) {
    vertices.push(points[0].x, points[0].y, points[0].z);
    vertices.push(points[i].x, points[i].y, points[i].z);
    vertices.push(points[i+1].x, points[i+1].y, points[i+1].z);
  }
  
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.computeVertexNormals();

  const material = new THREE.MeshBasicMaterial({ 
    color: color, side: THREE.DoubleSide, transparent: true, opacity: opacity, depthWrite: false
  });
  const mesh = new THREE.Mesh(geometry, material);

  const edgesGeometry = new THREE.BufferGeometry();
  const edgeVerts = [];
  for(let i=0; i<points.length; i++) {
    const p1 = points[i];
    const p2 = points[(i+1)%points.length];
    edgeVerts.push(p1.x, p1.y, p1.z);
    edgeVerts.push(p2.x, p2.y, p2.z);
  }
  edgesGeometry.setAttribute('position', new THREE.Float32BufferAttribute(edgeVerts, 3));
  const edgeMaterial = new THREE.LineBasicMaterial({ color: color, linewidth: 2 });
  const edges = new THREE.LineSegments(edgesGeometry, edgeMaterial);
  mesh.add(edges);

  return mesh;
}

function formatLabel(h, k, l, notation) {
  const overline = (v) => v < 0 ? String.fromCharCode(Math.abs(v) + 0x2080) + '\u0304' : v; 
  // ASCII approximation for simplicity:
  const fmt = (v) => v < 0 ? `-${Math.abs(v)}` : v;
  const str = `${fmt(h)}${fmt(k)}${fmt(l)}`;
  if (notation === 'plane') return `(${str})`;
  if (notation === 'plane-family') return `{${str}}`;
  if (notation === 'direction') return `[${str}]`;
  if (notation === 'direction-family') return `<${str}>`;
  return str;
}

function renderEntry(entry, isPreview) {
  const h = entry.h;
  const k = entry.k;
  const l = entry.l;
  const notation = entry.notation;
  let color = isPreview ? 0xffffff : new THREE.Color(entry.color).getHex();
  const opacity = isPreview ? 0.2 : 0.5;

  if (h === 0 && k === 0 && l === 0) return;

  const labelText = formatLabel(h, k, l, notation);
  const meshesToReturn = [];

  const addLabel = (pos) => {
    if(isPreview) return; // don't label preview
    
    let currentPos = pos.clone();
    let iterations = 0;
    while(iterations < 50) {
      let overlap = false;
      for(let existing of existingLabels) {
        if(currentPos.distanceTo(existing) < 0.25) {
          const dir = new THREE.Vector3().subVectors(currentPos, existing);
          if (dir.lengthSq() < 0.001) {
             dir.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5);
          }
          dir.normalize().multiplyScalar(0.05);
          currentPos.add(dir);
          overlap = true;
        }
      }
      if(!overlap) break;
      iterations++;
    }
    
    existingLabels.push(currentPos.clone());
    
    if (currentPos.distanceTo(pos) > 0.05) {
      const lineGeom = new THREE.BufferGeometry().setFromPoints([pos, currentPos]);
      const lineMat = new THREE.LineBasicMaterial({ color: entry.color, opacity: 0.5, transparent: true });
      const line = new THREE.Line(lineGeom, lineMat);
      crystalGroup.add(line);
      meshesToReturn.push(line);
    }

    const label = createTextSprite(labelText, entry.color);
    label.position.copy(currentPos);
    crystalGroup.add(label);
    meshesToReturn.push(label);
  };

  if (notation.includes('plane')) {
    let dVal = 1;
    if (!state.sweep || !isPreview) {
        const Ox = h < 0 ? 1 : 0;
        const Oy = k < 0 ? 1 : 0;
        const Oz = l < 0 ? 1 : 0;
        dVal = 1 + h*Ox + k*Oy + l*Oz;
    } else {
        const sumPos = Math.max(0, h) + Math.max(0, k) + Math.max(0, l);
        const sumNeg = Math.min(0, h) + Math.min(0, k) + Math.min(0, l);
        dVal = sumNeg + (sumPos - sumNeg) * ((Math.sin(sweepTime) + 1) / 2);
    }

    if (notation === 'plane') {
      const pts = getPlaneIntersections(h, k, l, dVal);
      if (pts) {
        const mesh = createPolygonMesh(pts, color, opacity);
        crystalGroup.add(mesh);
        meshesToReturn.push(mesh);
        // add label to first vertex
        addLabel(pts[0].clone().add(new THREE.Vector3(0.1, 0.1, 0.1))); 
      }
    } else if (notation === 'plane-family') {
      const perms = new Set();
      const vals = [Math.abs(h), Math.abs(k), Math.abs(l)];
      const p1 = [vals[0],vals[1],vals[2]], p2 = [vals[0],vals[2],vals[1]];
      const p3 = [vals[1],vals[0],vals[2]], p4 = [vals[1],vals[2],vals[0]];
      const p5 = [vals[2],vals[0],vals[1]], p6 = [vals[2],vals[1],vals[0]];
      
      [p1,p2,p3,p4,p5,p6].forEach(p => {
        for(let i=0; i<8; i++) {
          perms.add(`${p[0]*((i&1)?-1:1)},${p[1]*((i&2)?-1:1)},${p[2]*((i&4)?-1:1)}`);
        }
      });

      let addedLabel = false;
      perms.forEach(str => {
        const parts = str.split(',').map(Number);
        const ph = parts[0], pk = parts[1], pl = parts[2];
        const pOx = ph < 0 ? 1 : 0, pOy = pk < 0 ? 1 : 0, pOz = pl < 0 ? 1 : 0;
        const pd = 1 + ph*pOx + pk*pOy + pl*pOz;
        const pts = getPlaneIntersections(ph, pk, pl, pd);
        if (pts) {
          const mesh = createPolygonMesh(pts, color, opacity * 0.5);
          crystalGroup.add(mesh);
          meshesToReturn.push(mesh);
          if(!addedLabel) {
            addLabel(pts[0].clone().add(new THREE.Vector3(0.1, 0.1, 0.1)));
            addedLabel = true;
          }
        }
      });
    }
  }

  if (notation.includes('direction')) {
    if (notation === 'direction') {
      const dir = new THREE.Vector3(h, k, l);
      const mesh = new THREE.ArrowHelper(dir.clone().normalize(), new THREE.Vector3(0,0,0), dir.length() || 1, color, 0.2, 0.1);
      crystalGroup.add(mesh);
      meshesToReturn.push(mesh);
      addLabel(dir.clone().add(new THREE.Vector3(0.1, 0.1, 0.1)));
    } else if (notation === 'direction-family') {
      const perms = new Set();
      const vals = [Math.abs(h), Math.abs(k), Math.abs(l)];
      const p1 = [vals[0],vals[1],vals[2]], p2 = [vals[0],vals[2],vals[1]];
      const p3 = [vals[1],vals[0],vals[2]], p4 = [vals[1],vals[2],vals[0]];
      const p5 = [vals[2],vals[0],vals[1]], p6 = [vals[2],vals[1],vals[0]];
      
      [p1,p2,p3,p4,p5,p6].forEach(p => {
        for(let i=0; i<8; i++) {
          perms.add(`${p[0]*((i&1)?-1:1)},${p[1]*((i&2)?-1:1)},${p[2]*((i&4)?-1:1)}`);
        }
      });

      let addedLabel = false;
      perms.forEach(str => {
        const parts = str.split(',').map(Number);
        const dir = new THREE.Vector3(parts[0], parts[1], parts[2]);
        const mesh = new THREE.ArrowHelper(dir.clone().normalize(), new THREE.Vector3(0,0,0), dir.length() || 1, color, 0.2, 0.1);
        crystalGroup.add(mesh);
        meshesToReturn.push(mesh);
        if(!addedLabel) {
           addLabel(dir.clone().add(new THREE.Vector3(0.1, 0.1, 0.1)));
           addedLabel = true;
        }
      });
    }
  }
  return meshesToReturn;
}

function updateMillerRender() {
  dynamicMeshes.forEach(m => crystalGroup.remove(m));
  dynamicMeshes = [];
  existingLabels = [];

  // Render saved entries
  state.savedEntries.forEach(entry => {
    const meshes = renderEntry(entry, false);
    dynamicMeshes.push(...meshes);
  });

  // Render current input as preview
  const previewMeshes = renderEntry({
    h: state.h, k: state.k, l: state.l, notation: state.notation
  }, true);
  if(previewMeshes) dynamicMeshes.push(...previewMeshes);
}

function updateAtoms() {
  atomMeshes.forEach(m => crystalGroup.remove(m));
  atomMeshes = [];

  if (!state.showAtoms || state.lattice === 'none') return;

  const positions = [];
  for(let x=0; x<=1; x++) for(let y=0; y<=1; y++) for(let z=0; z<=1; z++) positions.push([x,y,z]);

  if (state.lattice === 'bcc') positions.push([0.5, 0.5, 0.5]);
  if (state.lattice === 'fcc') {
    positions.push([0.5, 0.5, 0], [0.5, 0.5, 1], [0.5, 0, 0.5], [0.5, 1, 0.5], [0, 0.5, 0.5], [1, 0.5, 0.5]);
  }

  const geometry = new THREE.SphereGeometry(0.1, 32, 32);
  const material = new THREE.MeshPhysicalMaterial({ color: 0xcccccc, metalness: 0.5, roughness: 0.2, clearcoat: 1.0 });

  positions.forEach(pos => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(pos[0], pos[1], pos[2]);
    crystalGroup.add(mesh);
    atomMeshes.push(mesh);
  });
}

// --- UI Logic ---
function renderEntriesList() {
  const container = document.getElementById('saved-entries-list');
  container.innerHTML = '';
  
  state.savedEntries.forEach(entry => {
    const item = document.createElement('div');
    item.className = 'entry-item';
    
    let overline = (v) => v < 0 ? `<span style="text-decoration: overline">${Math.abs(v)}</span>` : v;
    let str = `${overline(entry.h)}${overline(entry.k)}${overline(entry.l)}`;
    let lbl = str;
    if (entry.notation === 'plane') lbl = `(${str})`;
    if (entry.notation === 'plane-family') lbl = `{${str}}`;
    if (entry.notation === 'direction') lbl = `[${str}]`;
    if (entry.notation === 'direction-family') lbl = `&lt;${str}&gt;`;

    item.innerHTML = `
      <div class="entry-label">
        <div class="entry-color-dot" style="color: ${entry.color}; background: ${entry.color}"></div>
        <span class="mono">${lbl}</span>
      </div>
      <button class="remove-btn" data-id="${entry.id}">×</button>
    `;
    container.appendChild(item);
  });

  document.querySelectorAll('.remove-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const id = parseInt(e.target.getAttribute('data-id'));
      state.savedEntries = state.savedEntries.filter(en => en.id !== id);
      renderEntriesList();
      updateMillerRender();
    });
  });
}

function updateUI() {
  const overline = (val) => val < 0 ? `<span style="text-decoration: overline">${Math.abs(val)}</span>` : val;
  document.getElementById('h-val').innerHTML = overline(state.h);
  document.getElementById('k-val').innerHTML = overline(state.k);
  document.getElementById('l-val').innerHTML = overline(state.l);

  const xInt = state.h === 0 ? '∞' : (1 / state.h).toFixed(2);
  const yInt = state.k === 0 ? '∞' : (1 / state.k).toFixed(2);
  const zInt = state.l === 0 ? '∞' : (1 / state.l).toFixed(2);
  document.getElementById('intercepts-val').textContent = `${xInt}, ${yInt}, ${zInt}`;

  const sum = state.h*state.h + state.k*state.k + state.l*state.l;
  const d = sum === 0 ? '∞' : (1 / Math.sqrt(sum)).toFixed(3);
  document.getElementById('d-spacing-val').textContent = `${d} a`;
  
  updateAtoms();
  updateMillerRender();
}

function attachListeners() {
  const updateState = (axis, delta) => { state[axis] += delta; updateUI(); };

  document.getElementById('h-inc').addEventListener('click', () => updateState('h', 1));
  document.getElementById('h-dec').addEventListener('click', () => updateState('h', -1));
  document.getElementById('k-inc').addEventListener('click', () => updateState('k', 1));
  document.getElementById('k-dec').addEventListener('click', () => updateState('k', -1));
  document.getElementById('l-inc').addEventListener('click', () => updateState('l', 1));
  document.getElementById('l-dec').addEventListener('click', () => updateState('l', -1));

  document.getElementById('notation-type').addEventListener('change', (e) => {
    state.notation = e.target.value; updateUI();
  });

  document.getElementById('add-entry-btn').addEventListener('click', () => {
    state.savedEntries.push({
      id: Date.now(),
      h: state.h, k: state.k, l: state.l,
      notation: state.notation,
      color: PALETTE[colorIndex % PALETTE.length]
    });
    colorIndex++;
    renderEntriesList();
    updateMillerRender();
  });

  document.getElementById('lattice-type').addEventListener('change', (e) => {
    state.lattice = e.target.value; updateUI();
  });

  document.getElementById('toggle-atoms').addEventListener('change', (e) => {
    state.showAtoms = e.target.checked; updateUI();
  });

  document.getElementById('toggle-sweep').addEventListener('change', (e) => {
    state.sweep = e.target.checked;
    if(!state.sweep) updateMillerRender();
  });

  document.getElementById('lang-selector').addEventListener('change', (e) => {
    state.lang = e.target.value;
    localStorage.setItem('crystalens-lang', state.lang);
    updateLanguage(state.lang);
  });

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
}

// --- i18n Logic ---
function initLanguage() {
  const savedLang = localStorage.getItem('crystalens-lang');
  if (savedLang && translations[savedLang]) {
    state.lang = savedLang;
  } else {
    const browserLang = navigator.language.split('-')[0];
    state.lang = translations[browserLang] ? browserLang : 'en';
  }
  
  const selector = document.getElementById('lang-selector');
  if (selector) selector.value = state.lang;
  
  updateLanguage(state.lang);
}

function updateLanguage(lang) {
  const t = translations[lang];
  if (!t) return;
  
  document.documentElement.lang = lang;
  
  document.title = t.title;
  const metaTitle = document.querySelector('meta[name="title"]');
  if (metaTitle) metaTitle.setAttribute('content', t.title);
  const metaDesc = document.querySelector('meta[name="description"]');
  if (metaDesc) metaDesc.setAttribute('content', t.description);
  const metaKeywords = document.querySelector('meta[name="keywords"]');
  if (metaKeywords) metaKeywords.setAttribute('content', t.keywords);
  
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    if (t[key]) {
      el.textContent = t[key];
    }
  });
}

initLanguage();
attachListeners();
updateUI();
renderEntriesList();

// --- Render Loop ---
const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  const delta = clock.getDelta();
  if (state.sweep && state.notation.includes('plane')) {
    sweepTime += delta * 2;
    updateMillerRender();
  }
  controls.update();
  renderer.render(scene, camera);
}
animate();
