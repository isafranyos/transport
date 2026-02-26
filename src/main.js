import * as THREE from 'https://unpkg.com/three@0.162.0/build/three.module.js';

const MAP_SIZE = 24;
const TILE_SIZE = 1;
const START_CASH = 5000;
const ROAD_COST = 20;
const STATION_COST = 150;
const VEHICLE_COST = 500;
const RUN_COST_PER_SEC = 2;
const REVENUE_PER_PASSENGER = 18;
const MAX_STATION_QUEUE = 60;

const app = document.getElementById('app');
const logEl = document.getElementById('log');
const cashEl = document.getElementById('cash');
const statsEl = document.getElementById('stats');
const roadBtn = document.getElementById('roadBtn');
const stationBtn = document.getElementById('stationBtn');
const vehicleBtn = document.getElementById('vehicleBtn');

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9dc3ff);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
app.appendChild(renderer.domElement);

const aspect = window.innerWidth / window.innerHeight;
let zoom = 22;
const camera = new THREE.OrthographicCamera(-zoom * aspect, zoom * aspect, zoom, -zoom, 0.1, 100);
camera.position.set(12, 18, 12);
camera.lookAt(12, 0, 12);

scene.add(new THREE.AmbientLight(0xffffff, 0.7));
const dir = new THREE.DirectionalLight(0xffffff, 1);
dir.position.set(8, 20, 10);
scene.add(dir);

const groundMat = new THREE.MeshStandardMaterial({ color: 0x3f8f4a });
const tileGeo = new THREE.BoxGeometry(TILE_SIZE, 0.06, TILE_SIZE);
const hoverMat = new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true });

const mapGroup = new THREE.Group();
scene.add(mapGroup);
for (let x = 0; x < MAP_SIZE; x++) {
  for (let z = 0; z < MAP_SIZE; z++) {
    const tile = new THREE.Mesh(tileGeo, groundMat);
    tile.position.set(x + 0.5, -0.03, z + 0.5);
    mapGroup.add(tile);
  }
}

const hoverTile = new THREE.Mesh(new THREE.BoxGeometry(1.02, 0.12, 1.02), hoverMat);
hoverTile.visible = false;
hoverTile.position.y = 0.05;
scene.add(hoverTile);

const roadGeo = new THREE.BoxGeometry(0.82, 0.07, 0.82);
const roadMat = new THREE.MeshStandardMaterial({ color: 0x3d3d3d });
const stationGeo = new THREE.BoxGeometry(0.9, 0.5, 0.9);
const stationMat = new THREE.MeshStandardMaterial({ color: 0x1f87ff });
const vehicleGeo = new THREE.BoxGeometry(0.4, 0.25, 0.6);

const roads = new Map();
const stations = [];
const stationByKey = new Map();
const vehicles = [];

let nextStationId = 1;
let cash = START_CASH;
let mode = 'road';
let pendingVehicleRoute = null;

function setMode(newMode) {
  mode = newMode;
  roadBtn.classList.toggle('active', mode === 'road');
  stationBtn.classList.toggle('active', mode === 'station');
  vehicleBtn.classList.toggle('active', mode === 'vehicle');
  if (mode !== 'vehicle') pendingVehicleRoute = null;
}

roadBtn.onclick = () => setMode('road');
stationBtn.onclick = () => setMode('station');
vehicleBtn.onclick = () => setMode('vehicle');

function key(x, z) { return `${x},${z}`; }
function inBounds(x, z) { return x >= 0 && z >= 0 && x < MAP_SIZE && z < MAP_SIZE; }
function getRoadNeighbors(x, z) {
  const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
  return dirs
    .map(([dx, dz]) => [x + dx, z + dz])
    .filter(([nx, nz]) => roads.has(key(nx, nz)));
}

function spend(amount) {
  if (cash < amount) {
    log('Insufficient funds.');
    return false;
  }
  cash -= amount;
  return true;
}

function log(msg) { logEl.textContent = msg; }

function addRoad(x, z) {
  const k = key(x, z);
  if (roads.has(k)) return;
  if (!spend(ROAD_COST)) return;
  const mesh = new THREE.Mesh(roadGeo, roadMat);
  mesh.position.set(x + 0.5, 0.04, z + 0.5);
  scene.add(mesh);
  roads.set(k, mesh);
}

function addStation(x, z) {
  const k = key(x, z);
  if (stationByKey.has(k)) {
    log('Station already exists here.');
    return;
  }
  if (!roads.has(k) && getRoadNeighbors(x, z).length === 0) {
    log('Station must be on/next to road.');
    return;
  }
  if (!spend(STATION_COST)) return;

  const mesh = new THREE.Mesh(stationGeo, stationMat);
  mesh.position.set(x + 0.5, 0.28, z + 0.5);
  scene.add(mesh);

  const station = { id: nextStationId++, x, z, queue: 0, mesh, name: `S${nextStationId - 1}` };
  stations.push(station);
  stationByKey.set(k, station);
}

function gridToWorld(c) { return new THREE.Vector3(c.x + 0.5, 0.2, c.z + 0.5); }

function findPath(start, goal) {
  const startKey = key(start.x, start.z);
  const goalKey = key(goal.x, goal.z);
  const open = [startKey];
  const came = new Map();
  const g = new Map([[startKey, 0]]);
  const f = new Map([[startKey, Math.abs(start.x - goal.x) + Math.abs(start.z - goal.z)]]);

  function parse(k) { const [x, z] = k.split(',').map(Number); return { x, z }; }

  while (open.length) {
    open.sort((a, b) => (f.get(a) ?? Infinity) - (f.get(b) ?? Infinity));
    const cur = open.shift();
    if (cur === goalKey) {
      const path = [parse(cur)];
      let c = cur;
      while (came.has(c)) {
        c = came.get(c);
        path.push(parse(c));
      }
      return path.reverse();
    }

    const { x, z } = parse(cur);
    for (const [nx, nz] of [[x+1,z],[x-1,z],[x,z+1],[x,z-1]]) {
      if (!inBounds(nx, nz)) continue;
      const nk = key(nx, nz);
      if (!roads.has(nk) && nk !== goalKey) continue;
      const tg = (g.get(cur) ?? Infinity) + 1;
      if (tg < (g.get(nk) ?? Infinity)) {
        came.set(nk, cur);
        g.set(nk, tg);
        f.set(nk, tg + Math.abs(nx - goal.x) + Math.abs(nz - goal.z));
        if (!open.includes(nk)) open.push(nk);
      }
    }
  }
  return null;
}

function buyVehicle(a, b) {
  if (!spend(VEHICLE_COST)) return;
  const pathAB = findPath(a, b);
  const pathBA = findPath(b, a);
  if (!pathAB || !pathBA) {
    cash += VEHICLE_COST;
    log('No valid road path between stations.');
    return;
  }

  const material = new THREE.MeshStandardMaterial({ color: 0xf5b041 });
  const mesh = new THREE.Mesh(vehicleGeo, material);
  scene.add(mesh);

  const vehicle = {
    route: [a, b],
    pathAB,
    pathBA,
    forward: true,
    index: 0,
    t: 0,
    speed: 2.2,
    capacity: 16,
    load: 0,
    mesh,
  };

  const p = gridToWorld(pathAB[0]);
  mesh.position.copy(p);
  vehicles.push(vehicle);
  log(`Vehicle purchased on route ${a.name} ↔ ${b.name}`);
}

function nearestStationFromTile(x, z) {
  const k = key(x, z);
  if (stationByKey.has(k)) return stationByKey.get(k);
  let best = null;
  let bestDist = Infinity;
  for (const s of stations) {
    const d = Math.abs(s.x - x) + Math.abs(s.z - z);
    if (d < bestDist && d <= 1) {
      best = s;
      bestDist = d;
    }
  }
  return best;
}

const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
let isPanning = false;
let panStart = { x: 0, y: 0 };
let camStart = new THREE.Vector3();

function resize() {
  renderer.setSize(window.innerWidth, window.innerHeight);
  const a = window.innerWidth / window.innerHeight;
  camera.left = -zoom * a;
  camera.right = zoom * a;
  camera.top = zoom;
  camera.bottom = -zoom;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);

renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());
renderer.domElement.addEventListener('pointerdown', (e) => {
  if (e.button === 2) {
    isPanning = true;
    panStart = { x: e.clientX, y: e.clientY };
    camStart.copy(camera.position);
    return;
  }

  const tile = pickTile(e.clientX, e.clientY);
  if (!tile) return;
  const { x, z } = tile;

  if (mode === 'road') {
    addRoad(x, z);
  } else if (mode === 'station') {
    addStation(x, z);
  } else if (mode === 'vehicle') {
    if (stations.length < 2) {
      log('Place at least two stations first.');
      return;
    }
    const station = nearestStationFromTile(x, z);
    if (!station) {
      log('Click on/near a station to set route.');
      return;
    }
    if (!pendingVehicleRoute) {
      pendingVehicleRoute = [station];
      log(`Route start selected: ${station.name}. Select destination.`);
    } else if (pendingVehicleRoute[0].id === station.id) {
      log('Pick a different destination station.');
    } else {
      buyVehicle(pendingVehicleRoute[0], station);
      pendingVehicleRoute = null;
    }
  }
});

window.addEventListener('pointermove', (e) => {
  if (isPanning) {
    const dx = (e.clientX - panStart.x) * 0.03;
    const dy = (e.clientY - panStart.y) * 0.03;
    camera.position.x = camStart.x - dx;
    camera.position.z = camStart.z - dy;
    camera.lookAt(camera.position.x, 0, camera.position.z);
    return;
  }

  const tile = pickTile(e.clientX, e.clientY);
  if (!tile) {
    hoverTile.visible = false;
    return;
  }
  hoverTile.visible = true;
  hoverTile.position.x = tile.x + 0.5;
  hoverTile.position.z = tile.z + 0.5;
});

window.addEventListener('pointerup', () => { isPanning = false; });
window.addEventListener('wheel', (e) => {
  zoom = THREE.MathUtils.clamp(zoom + (e.deltaY > 0 ? 1.5 : -1.5), 8, 40);
  resize();
}, { passive: true });

function pickTile(clientX, clientY) {
  mouse.x = (clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);
  const hits = raycaster.intersectObjects(mapGroup.children);
  if (!hits.length) return null;
  const p = hits[0].point;
  const x = Math.floor(p.x);
  const z = Math.floor(p.z);
  if (!inBounds(x, z)) return null;
  return { x, z };
}

let prev = performance.now();
let passengerTimer = 0;
let monthTimer = 0;

function update(dt) {
  passengerTimer += dt;
  monthTimer += dt;

  if (passengerTimer > 1.25) {
    passengerTimer = 0;
    for (const s of stations) {
      s.queue = Math.min(MAX_STATION_QUEUE, s.queue + Math.floor(Math.random() * 4));
      const t = 0.3 + Math.min(0.7, s.queue / MAX_STATION_QUEUE);
      s.mesh.material.color.setRGB(0.1, 0.2 + t * 0.5, 0.9);
    }
  }

  for (const v of vehicles) {
    const path = v.forward ? v.pathAB : v.pathBA;
    if (path.length < 2) continue;

    const a = gridToWorld(path[v.index]);
    const b = gridToWorld(path[Math.min(v.index + 1, path.length - 1)]);
    v.t += (dt * v.speed);

    if (v.t >= 1) {
      v.t = 0;
      v.index++;
      if (v.index >= path.length - 1) {
        const station = v.forward ? v.route[1] : v.route[0];
        const drop = v.load;
        cash += drop * REVENUE_PER_PASSENGER;
        v.load = Math.min(v.capacity, station.queue);
        station.queue -= v.load;
        v.forward = !v.forward;
        v.index = 0;
      }
    }

    v.mesh.position.lerpVectors(a, b, v.t);
    cash -= RUN_COST_PER_SEC * dt;
  }

  if (monthTimer > 10) {
    monthTimer = 0;
    cash -= stations.length * 8;
  }

  cashEl.textContent = `Cash: $${Math.floor(cash)}`;
  statsEl.textContent = `Stations: ${stations.length} · Vehicles: ${vehicles.length}`;
}

function animate(now) {
  const dt = Math.min(0.05, (now - prev) / 1000);
  prev = now;
  update(dt);
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

setMode('road');
log('Build roads first, then place two stations.');
animate(performance.now());
