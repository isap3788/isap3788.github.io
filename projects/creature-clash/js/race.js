// Rift Rally: a combat race. Creatures sprint a generated neon circuit, drift for boosts, grab item pods,
// shoot and slam each other. Knocked-out racers rocket into the sky and respawn on the track.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { BIOMES, RACE_ITEMS, RACE_XP } from './data.js';
import { computeStats, buildCreatureMesh, animateCreature, disposeMesh } from './creature.js';
import { setupLookdev, surfaceTexture } from './render.js';
import { getSettings, setSetting } from './settings.js';
import { Fx } from './fx.js';
import { devConsole } from './devconsole.js';
import { h } from './ui.js';
import { creatureThumb } from './thumbs.js';

const M = 900; // track samples
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const wrap = (i) => ((i % M) + M) % M;
const wrapAng = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const flatDist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const glowMat = (color, intensity = 2) => new THREE.MeshStandardMaterial({ color: 0x000000, emissive: color, emissiveIntensity: intensity });
export const ordinal = (n) => `${n}${n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'}`;
export const fmtRaceTime = (s) => (s == null ? '—' : `${Math.floor(s / 60)}:${(s % 60).toFixed(2).padStart(5, '0')}`);

const INTRO = 2.6;
const COUNTDOWN = 3;

export class Race {
  constructor({ container, playerCreature, rivals, laps = 3, biome = null, onFinish, onExit }) {
    this.container = container;
    this.laps = laps;
    this.onFinish = onFinish;
    this.onExit = onExit;
    this.biome = biome ? BIOMES.find((b) => b.id === biome) || pick(BIOMES) : pick(BIOMES);
    this.settings = getSettings();
    this.time = 0;
    this.phase = 'intro';
    this.phaseT = 0;
    this.raceTime = 0;
    this.paused = false;
    this.slowmo = 0;
    this.shake = 0;
    this.keys = new Set();
    this.tapped = new Set();
    this.buttons = new Set();
    this.racers = [];
    this.projectiles = [];
    this.mines = [];
    this.strikes = [];
    this.floaters = [];
    this.finishCount = 0;
    this.hitMarkT = 0;
    this.camOrbit = 0; // right-drag orbit offset, eases back behind you
    this.orbitIdleT = 0;

    this.setupRenderer();
    this.fx = new Fx(this.scene);
    this.buildTrack();
    this.buildScenery();
    this.buildFeatures();
    this.setupHud();

    const all = [...rivals];
    all.splice(Math.min(all.length, Math.floor(all.length / 2) + 1), 0, playerCreature); // start mid-pack
    all.forEach((c, i) => this.spawnRacer(c, i, c === playerCreature));
    this.player = this.racers.find((r) => r.isPlayer);
    this.camYaw = this.player.heading;
    this.camera.position.set(this.player.pos.x + 20, 10, this.player.pos.z);

    this.bindInput();
    devConsole.battle = null;
    devConsole.race = this;
    this.last = performance.now();
    this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  // ------------------------------------------------------------ setup

  setupRenderer() {
    this.root = h('div', { class: 'battle race' });
    this.container.replaceChildren(this.root);
    const high = this.settings.quality === 'high';
    const r = (this.renderer = new THREE.WebGLRenderer({ antialias: !high, powerPreference: 'high-performance' }));
    r.setPixelRatio(Math.min(high ? 1.5 : 1, devicePixelRatio));
    r.shadowMap.enabled = high;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    this.root.append(r.domElement);
    r.domElement.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      if (this.destroyed) return;
      console.error('Rift Rally: WebGL context lost');
      this.banner('3D view lost. Reload the page, or set Graphics to Low.');
    });
    this.scene = new THREE.Scene();
    setupLookdev(r, this.scene, { exposure: this.biome.id === 'tundra' ? 0.9 : 1.05 });
    const cv = document.createElement('canvas');
    cv.width = 4;
    cv.height = 256;
    const g = cv.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, this.biome.sky[0]);
    grad.addColorStop(0.75, this.biome.sky[1]);
    grad.addColorStop(1, `#${new THREE.Color(this.biome.fog).getHexString()}`);
    g.fillStyle = grad;
    g.fillRect(0, 0, 4, 256);
    this.scene.background = new THREE.CanvasTexture(cv);
    this.scene.background.colorSpace = THREE.SRGBColorSpace;
    this.scene.fog = new THREE.FogExp2(this.biome.fog, 0.0065);
    this.scene.add(new THREE.HemisphereLight(0xdfe8ff, new THREE.Color(this.biome.ground).multiplyScalar(0.6), 0.6));
    const sun = (this.sun = new THREE.DirectionalLight(0xfff2e0, 2.6));
    sun.castShadow = high;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.03;
    Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, near: 1, far: 160 });
    this.scene.add(sun, sun.target);
    const fill = new THREE.DirectionalLight(new THREE.Color(this.biome.accent), 0.5);
    fill.position.set(30, 14, 40);
    this.scene.add(fill);
    this.camera = new THREE.PerspectiveCamera(64, 1, 0.1, 900);
    if (high) {
      this.composer = new EffectComposer(r, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }));
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(256, 256), 0.6, 0.5, 0.82));
      this.composer.addPass(new OutputPass());
    }
    this.resize = () => {
      const w = this.root.clientWidth || innerWidth;
      const hgt = this.root.clientHeight || innerHeight;
      r.setSize(w, hgt);
      this.composer?.setSize(w, hgt);
      this.camera.aspect = w / hgt;
      this.camera.updateProjectionMatrix();
    };
    addEventListener('resize', this.resize);
    this.resize();
  }

  // A closed loop drawn in polar form (radius > 0 everywhere), so it can never cross itself.
  buildTrack() {
    const n = 14;
    const base = rnd(105, 130);
    const [p1, p2, p3] = [rnd(0, 6.3), rnd(0, 6.3), rnd(0, 6.3)];
    const a1 = rnd(0.16, 0.3);
    const a2 = rnd(0.06, 0.14);
    const ctrl = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const r = base * (1 + a1 * Math.sin(a * 2 + p1) + a2 * Math.sin(a * 3 + p2) + 0.05 * Math.sin(a * 5 + p3));
      ctrl.push(new THREE.Vector3(Math.cos(a) * r * 1.3, 0, Math.sin(a) * r));
    }
    const curve = new THREE.CatmullRomCurve3(ctrl, true, 'centripetal');
    const pts = curve.getSpacedPoints(M).slice(0, M);
    const tan = [];
    const right = [];
    const width = [];
    const wp = rnd(0, 6.3);
    for (let i = 0; i < M; i++) {
      const t = pts[wrap(i + 1)].clone().sub(pts[wrap(i - 1)]).normalize();
      tan.push(t);
      right.push(new THREE.Vector3(-t.z, 0, t.x));
      width.push(17 + 3 * Math.sin((i / M) * Math.PI * 6 + wp));
    }
    // curvature for the racing line and the bots' braking
    const curv = pts.map((_, i) => wrapAng(Math.atan2(tan[wrap(i + 12)].x, tan[wrap(i + 12)].z) - Math.atan2(tan[i].x, tan[i].z)));
    const len = curve.getLength();
    this.track = { pts, tan, right, width, curv, len, step: len / M };
    const box = new THREE.Box3().setFromPoints(pts);
    this.track.box = box;

    // road surface
    const pos = [];
    const uv = [];
    const idx = [];
    let along = 0;
    for (let k = 0; k <= M; k++) {
      const i = wrap(k);
      if (k) along += this.track.step;
      const w = width[i] / 2;
      const p = pts[i];
      const r = right[i];
      pos.push(p.x - r.x * w, 0.02, p.z - r.z * w, p.x + r.x * w, 0.02, p.z + r.z * w);
      uv.push(0, along / 14, 1, along / 14);
      if (k) {
        const j = k * 2;
        idx.push(j - 2, j, j - 1, j - 1, j, j + 1);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const map = surfaceTexture(this.biome.lane, {
      noise: 0.1, tile: 4,
      seams: (g, s) => {
        g.fillStyle = 'rgba(0,0,0,0.5)';
        g.fillRect(0, 0, s * 0.05, s);
        g.fillRect(s * 0.95, 0, s * 0.05, s);
        g.fillStyle = 'rgba(255,255,255,0.18)';
        g.fillRect(s * 0.33, 0, s * 0.008, s * 0.4);
        g.fillRect(s * 0.66, s * 0.5, s * 0.008, s * 0.4);
      },
    });
    const emissiveMap = surfaceTexture('#000000', {
      noise: 0,
      seams: (g, s) => {
        g.fillStyle = '#fff';
        g.fillRect(s * 0.055, 0, s * 0.01, s);
        g.fillRect(s * 0.935, 0, s * 0.01, s);
        g.fillRect(s * 0.495, s * 0.05, s * 0.01, s * 0.35);
      },
    });
    const road = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map, emissiveMap, emissive: this.biome.accent, emissiveIntensity: 1.2, roughness: 0.55, metalness: 0.4, envMapIntensity: 0.35, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1 }));
    road.receiveShadow = true;
    this.scene.add(road);

    // barriers on both edges with a light strip along the top
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x1a1c22, roughness: 0.4, metalness: 0.8, side: THREE.DoubleSide });
    const stripMat = glowMat(this.biome.accent, 2);
    for (const side of [-1, 1]) {
      for (const [y0, y1, mat, out] of [[0, 1.1, wallMat, 0.6], [1.05, 1.2, stripMat, 0.62]]) {
        const wp2 = [];
        const wi = [];
        for (let k = 0; k <= M; k++) {
          const i = wrap(k);
          const off = side * (width[i] / 2 + out);
          const x = pts[i].x + right[i].x * off;
          const z = pts[i].z + right[i].z * off;
          wp2.push(x, y0, z, x, y1, z);
          if (k) {
            const j = k * 2;
            wi.push(j - 2, j - 1, j, j - 1, j + 1, j);
          }
        }
        const g2 = new THREE.BufferGeometry();
        g2.setAttribute('position', new THREE.Float32BufferAttribute(wp2, 3));
        g2.setIndex(wi);
        g2.computeVertexNormals();
        const wall = new THREE.Mesh(g2, mat);
        wall.castShadow = mat === wallMat;
        this.scene.add(wall);
      }
    }

    // ground
    const gmap = surfaceTexture(this.biome.ground, { noise: 0.18, tile: this.biome.id === 'neon' ? 4 : 0 });
    const size = Math.max(box.max.x - box.min.x, box.max.z - box.min.z) + 400;
    gmap.repeat.set(size / 16, size / 16);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshStandardMaterial({ map: gmap, roughness: 0.92, metalness: 0.05, envMapIntensity: 0.25 }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);
  }

  // distance from a point to the track centerline (coarse)
  trackDist(x, z) {
    let d = Infinity;
    const { pts, width } = this.track;
    for (let i = 0; i < M; i += 6) d = Math.min(d, Math.hypot(pts[i].x - x, pts[i].z - z) - width[i] / 2);
    return d;
  }

  buildScenery() {
    const { pts, tan, right, width, box } = this.track;
    const accent = this.biome.accent;
    const metal = new THREE.MeshStandardMaterial({ color: 0x1c1e24, roughness: 0.35, metalness: 0.85 });
    const shell = new THREE.MeshPhysicalMaterial({ color: 0x3a3f4a, roughness: 0.45, metalness: 0.6, clearcoat: 0.5 });
    const glowA = glowMat(accent, 2.2);
    const glowB = glowMat(0x38e1ff, 2);

    // start/finish gantry with a checkered beam
    const s = 0;
    const p0 = pts[s];
    const gantry = new THREE.Group();
    const w0 = width[s] / 2 + 1.5;
    for (const side of [-1, 1]) {
      const pillar = new THREE.Mesh(new RoundedBoxGeometry(1.2, 9, 1.2, 2, 0.1), metal);
      pillar.position.set(side * w0, 4.5, 0);
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.1, 8, 1.22), glowA);
      strip.position.set(side * (w0 - 0.62), 4.5, 0);
      gantry.add(pillar, strip);
    }
    const cv = document.createElement('canvas');
    cv.width = 1024;
    cv.height = 128;
    const g = cv.getContext('2d');
    for (let x = 0; x < 64; x++) for (let y = 0; y < 8; y++) {
      g.fillStyle = (x + y) % 2 ? '#e8eef4' : '#101216';
      g.fillRect(x * 16, y * 16, 16, 16);
    }
    g.fillStyle = 'rgba(8,10,14,0.85)';
    g.fillRect(300, 20, 424, 88);
    g.font = '600 64px "Chakra Petch", sans-serif';
    g.fillStyle = '#fff';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('RIFT RALLY', 512, 66);
    const beamTex = new THREE.CanvasTexture(cv);
    beamTex.colorSpace = THREE.SRGBColorSpace;
    const beam = new THREE.Mesh(new THREE.BoxGeometry(w0 * 2 + 1.2, 1.6, 0.8), [metal, metal, metal, metal, new THREE.MeshStandardMaterial({ map: beamTex, emissiveMap: beamTex, emissive: 0xffffff, emissiveIntensity: 0.5 }), new THREE.MeshStandardMaterial({ map: beamTex, emissiveMap: beamTex, emissive: 0xffffff, emissiveIntensity: 0.5 })]);
    beam.position.y = 8.6;
    gantry.add(beam);
    gantry.position.copy(p0);
    gantry.lookAt(p0.clone().add(tan[s]));
    this.scene.add(gantry);
    const ccv = document.createElement('canvas');
    ccv.width = 256;
    ccv.height = 32;
    const cg = ccv.getContext('2d');
    for (let x = 0; x < 16; x++) for (let y = 0; y < 2; y++) {
      cg.fillStyle = (x + y) % 2 ? '#e8eef4' : '#101216';
      cg.fillRect(x * 16, y * 16, 16, 16);
    }
    const ctex = new THREE.CanvasTexture(ccv);
    ctex.colorSpace = THREE.SRGBColorSpace;
    const line = new THREE.Mesh(new THREE.PlaneGeometry(width[s], 2), new THREE.MeshStandardMaterial({ map: ctex, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2 }));
    line.rotation.x = -Math.PI / 2;
    const lineHolder = new THREE.Group(); // +z along the track, so the plane's width spans it
    lineHolder.add(line);
    lineHolder.position.set(p0.x, 0.04, p0.z);
    lineHolder.lookAt(p0.clone().add(tan[s]).setY(0.04));
    this.scene.add(lineHolder);

    // light posts every so often on both sides
    for (let i = 20; i < M; i += 30) {
      for (const side of [-1, 1]) {
        const off = side * (width[i] / 2 + 2);
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.25, 4, 0.25), metal);
        post.position.set(pts[i].x + right[i].x * off, 2, pts[i].z + right[i].z * off);
        const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.5), (i / 30) % 2 ? glowA : glowB);
        lamp.position.set(post.position.x, 4.05, post.position.z);
        post.castShadow = true;
        this.scene.add(post, lamp);
      }
    }
    // glowing arches across the track
    for (let k = 1; k < 7; k++) {
      const i = Math.round((k / 7) * M);
      const arch = new THREE.Mesh(new THREE.TorusGeometry(width[i] / 2 + 1.2, 0.18, 8, 48, Math.PI), k % 2 ? glowA : glowB);
      arch.position.copy(pts[i]);
      arch.lookAt(pts[i].clone().add(tan[i]));
      this.scene.add(arch);
    }
    // landscape outside and inside the loop
    const kinds = this.biome.id === 'tundra' ? ['crystal', 'rock', 'tower'] : this.biome.id === 'swamp' ? ['shroom', 'rock', 'tower'] : this.biome.id === 'volcanic' ? ['column', 'rock', 'tower'] : ['tower', 'ring', 'crate'];
    for (let n = 0, tries = 0; n < 110 && tries < 900; tries++) {
      const x = rnd(box.min.x - 90, box.max.x + 90);
      const z = rnd(box.min.z - 90, box.max.z + 90);
      if (this.trackDist(x, z) < 7) continue;
      n++;
      const o = new THREE.Group();
      const kind = pick(kinds);
      const sc = rnd(0.8, 2.2);
      if (kind === 'tower') {
        const hgt = rnd(6, 22);
        const t = new THREE.Mesh(new RoundedBoxGeometry(2.4, hgt, 2.4, 2, 0.12), metal);
        t.position.y = hgt / 2;
        o.add(t);
        for (let i = 0; i < 3; i++) {
          const st = new THREE.Mesh(new THREE.BoxGeometry(2.44, 0.12, 2.44), i % 2 ? glowA : glowB);
          st.position.y = hgt * (0.3 + i * 0.25);
          o.add(st);
        }
      } else if (kind === 'ring') {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(2, 0.12, 8, 40), glowA);
        ring.position.y = 3.5;
        ring.rotation.y = rnd(0, 3);
        o.add(ring, lifted(new THREE.Mesh(new THREE.CylinderGeometry(0.8, 1, 0.5, 16), metal), 0.25));
      } else if (kind === 'crate') {
        o.add(lifted(new THREE.Mesh(new RoundedBoxGeometry(2, 1.6, 1.6, 2, 0.08), shell), 0.8));
      } else if (kind === 'crystal') {
        for (let i = 0; i < 4; i++) {
          const c = new THREE.Mesh(new THREE.OctahedronGeometry(0.8), new THREE.MeshPhysicalMaterial({ color: 0xbfe8ff, roughness: 0.05, transparent: true, opacity: 0.85, clearcoat: 1, emissive: 0x2a6a90, emissiveIntensity: 0.3 }));
          c.scale.y = rnd(2, 3.5);
          c.position.set(rnd(-1, 1), 1.5, rnd(-1, 1));
          c.rotation.z = rnd(-0.3, 0.3);
          o.add(c);
        }
      } else if (kind === 'shroom') {
        const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.4, 3, 10), new THREE.MeshStandardMaterial({ color: 0x3a4038, roughness: 0.8 }));
        stem.position.y = 1.5;
        const cap = new THREE.Mesh(new THREE.SphereGeometry(1.6, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x2a3a30, roughness: 0.5 }));
        cap.scale.y = 0.45;
        cap.position.y = 2.9;
        const gills = new THREE.Mesh(new THREE.CircleGeometry(1.5, 20), glowA);
        gills.rotation.x = Math.PI / 2;
        gills.position.y = 2.88;
        o.add(stem, cap, gills);
      } else if (kind === 'column') {
        for (let i = 0; i < 5; i++) {
          const hgt = rnd(2, 6);
          const col = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.7, hgt, 6), new THREE.MeshStandardMaterial({ color: 0x241e1c, roughness: 0.9, flatShading: true }));
          col.position.set(rnd(-1.2, 1.2), hgt / 2, rnd(-1.2, 1.2));
          o.add(col);
        }
      } else {
        const geo = new THREE.DodecahedronGeometry(1.4, 1);
        const p = geo.attributes.position;
        for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) * rnd(0.8, 1.15), p.getY(i) * rnd(0.6, 1), p.getZ(i) * rnd(0.8, 1.15));
        geo.computeVertexNormals();
        o.add(lifted(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: new THREE.Color(this.biome.ground).multiplyScalar(0.7), roughness: 0.9, flatShading: true })), 0.5));
      }
      o.position.set(x, 0, z);
      o.scale.setScalar(sc);
      o.traverse((m) => m.isMesh && (m.castShadow = m.receiveShadow = true));
      this.scene.add(o);
    }
  }

  // Boost pads, item pod rows, jump ramps, plasma vents and a spinning sweeper.
  buildFeatures() {
    const { pts, tan, right, width } = this.track;
    const at = (frac, lat = 0) => {
      const i = wrap(Math.round(frac * M));
      return { i, pos: pts[i].clone().addScaledVector(right[i], lat), yaw: Math.atan2(tan[i].x, tan[i].z) };
    };
    // chevron texture shared by pads
    const cv = document.createElement('canvas');
    cv.width = 128;
    cv.height = 256;
    const g = cv.getContext('2d');
    g.fillStyle = '#000';
    g.fillRect(0, 0, 128, 256);
    g.strokeStyle = '#fff';
    g.lineWidth = 18;
    for (let y = -32; y < 256; y += 64) {
      g.beginPath();
      g.moveTo(14, y + 52);
      g.lineTo(64, y + 12);
      g.lineTo(114, y + 52);
      g.stroke();
    }
    this.chevron = new THREE.CanvasTexture(cv);
    this.chevron.wrapT = THREE.RepeatWrapping;
    this.chevron.colorSpace = THREE.SRGBColorSpace;

    this.pads = [];
    for (const frac of [0.11, 0.3, 0.52, 0.74, 0.9]) {
      const f = at(frac, rnd(-4, 4));
      const m = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 7), new THREE.MeshBasicMaterial({ map: this.chevron, color: new THREE.Color(0xffb020).multiplyScalar(2.2), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
      m.rotation.set(-Math.PI / 2, 0, f.yaw + Math.PI);
      m.position.set(f.pos.x, 0.06, f.pos.z);
      this.scene.add(m);
      this.pads.push({ ...f, mesh: m });
    }

    this.pods = [];
    const podGeo = new THREE.OctahedronGeometry(0.75, 0);
    for (const frac of [0.06, 0.38, 0.64, 0.82]) {
      const base = at(frac);
      const w = width[base.i];
      for (let k = 0; k < 5; k++) {
        const lat = (k - 2) * (w / 6);
        const pos = pts[base.i].clone().addScaledVector(right[base.i], lat);
        const m = new THREE.Mesh(podGeo, new THREE.MeshPhysicalMaterial({ color: 0x9fd8ff, emissive: 0x38e1ff, emissiveIntensity: 1.4, roughness: 0.1, transparent: true, opacity: 0.9, clearcoat: 1 }));
        m.position.set(pos.x, 1.3, pos.z);
        const halo = new THREE.Mesh(new THREE.TorusGeometry(1, 0.05, 6, 32), glowMat(0x38e1ff, 2));
        halo.rotation.x = Math.PI / 2;
        m.add(halo);
        this.scene.add(m);
        this.pods.push({ pos, mesh: m, active: true, t: 0, phase: k });
      }
    }

    this.ramps = [];
    for (const frac of [0.22, 0.58]) {
      const f = at(frac);
      const w = width[f.i];
      const shape = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(5, 0), new THREE.Vector2(5, 1.3), new THREE.Vector2(4.6, 1.3)]);
      const geo = new THREE.ExtrudeGeometry(shape, { depth: w - 1.6, bevelEnabled: false });
      geo.translate(-5, 0, -(w - 1.6) / 2);
      const ramp = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x2a2e36, roughness: 0.4, metalness: 0.7 }));
      const grp = new THREE.Group();
      ramp.rotation.y = -Math.PI / 2;
      grp.add(ramp);
      const lip = new THREE.Mesh(new THREE.BoxGeometry(w - 1.6, 0.08, 0.2), glowMat(0xffb020, 2.5));
      lip.position.set(0, 1.32, 0);
      grp.add(lip);
      grp.position.copy(f.pos);
      grp.rotation.y = f.yaw;
      grp.traverse((m) => m.isMesh && (m.castShadow = m.receiveShadow = true));
      this.scene.add(grp);
      this.ramps.push({ ...f });
    }

    this.vents = [];
    for (const frac of [0.45, 0.69, 0.95]) {
      const f = at(frac, rnd(-5, 5));
      const grate = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.4, 0.12, 24), new THREE.MeshStandardMaterial({ color: 0x1a1c22, metalness: 0.85, roughness: 0.4 }));
      grate.position.set(f.pos.x, 0.06, f.pos.z);
      const core = new THREE.Mesh(new THREE.CircleGeometry(1.5, 24), glowMat(this.biome.accent, 0.8));
      core.rotation.x = -Math.PI / 2;
      core.position.set(f.pos.x, 0.14, f.pos.z);
      const col = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 2.4, 12, 24, 1, true), new THREE.MeshBasicMaterial({ color: this.biome.accent, transparent: true, opacity: 0, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
      col.position.set(f.pos.x, 6, f.pos.z);
      this.scene.add(grate, core, col);
      this.vents.push({ ...f, core, col, period: rnd(3.2, 4.5), t: rnd(0, 3), state: 'idle', radius: 2.6 });
    }

    const sw = at(0.16);
    const len = width[sw.i] + 1;
    const sweeper = new THREE.Group();
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.2, 2.2, 16), new THREE.MeshStandardMaterial({ color: 0x1c1e24, metalness: 0.85, roughness: 0.35 }));
    hub.position.y = 1.1;
    const bar = new THREE.Mesh(new RoundedBoxGeometry(len, 0.7, 0.7, 2, 0.12), new THREE.MeshPhysicalMaterial({ color: 0x3a3f4a, metalness: 0.6, roughness: 0.4, clearcoat: 0.5 }));
    bar.position.y = 1.4;
    const barGlow = new THREE.Mesh(new THREE.BoxGeometry(len, 0.08, 0.72), glowMat(0xff3b4e, 2.5));
    barGlow.position.y = 1.78;
    sweeper.add(hub, bar, barGlow);
    sweeper.position.copy(sw.pos);
    sweeper.traverse((m) => m.isMesh && (m.castShadow = true));
    this.scene.add(sweeper);
    this.sweeper = { ...sw, mesh: sweeper, len, angle: 0, speed: 1.3 };
  }

  setupHud() {
    const el = (cls, ...kids) => h('div', { class: cls }, ...kids);
    this.hud = {
      place: el('rr-place'),
      lap: el('rr-lap'),
      time: el('rr-time'),
      standings: el('rr-standings'),
      slots: [el('rr-item'), el('rr-item small')],
      itemName: el('rr-item-name'),
      speed: el('rr-speed'),
      drift: el('rr-drift-fill'),
      hp: el('bar-fill hp'),
      hpText: el('bar-text'),
      center: el('rr-center'),
      banner: el('rr-banner'),
      feed: el('killfeed'),
      floaters: el('floaters'),
      pause: el('pause-menu'),
      lock: el('target-lock'),
      crosshair: el('crosshair rr-cross'),
      wrong: el('rr-wrong', 'WRONG WAY'),
      abilities: el('abilities'),
    };
    this.minimap = h('canvas', { class: 'minimap rr-map', width: 220, height: 220 });
    this.root.append(h('div', { class: 'hud rr-hud' },
      el('rr-topleft', el('rr-placebox', this.hud.place, el('rr-of', '')), this.hud.lap, this.hud.time, this.hud.standings),
      this.hud.itemBox = el('rr-itembox', el('rr-slots', ...this.hud.slots), this.hud.itemName),
      this.minimap,
      this.hud.feed,
      this.hud.floaters,
      this.hud.lock,
      this.hud.crosshair,
      this.lockHint = el('lock-hint', 'Click to steer with the mouse'),
      this.hud.center,
      this.hud.banner,
      this.hud.wrong,
      el('player-panel rr-panel',
        this.portrait = h('img', { class: 'portrait', alt: '' }),
        el('player-bars',
          this.nameEl = el('player-name'),
          el('bar', this.hud.hp, this.hud.hpText),
          el('rr-drift', h('span', {}, 'DRIFT'), el('rr-drift-track', this.hud.drift)))),
      this.hud.abilities,
      el('rr-speedbox', this.hud.speed, el('rr-unit', 'KM/H')),
      this.hud.pause,
      this.controlsHint = el('controls-hint'),
    ));
    this.hud.pause.hidden = true;
    this.hud.wrong.hidden = true;
    this.hud.lock.hidden = true;
    this.updateHint();
    this.updateLockHint();
  }

  buildAbilities() {
    const r = this.player;
    const mk = (key, label, get) => {
      const cd = h('div', { class: 'ab-cd' });
      this.abilityEls.push({ cd, get });
      return h('div', { class: 'ability' }, h('kbd', {}, key), h('span', {}, label), cd);
    };
    this.abilityEls = [];
    this.hud.abilities.replaceChildren(
      mk('F', r.st.weapon.name, () => [r.weaponCd, r.st.weapon.cd * 1.1]),
      mk('E / R', 'Use / swap', () => [0, 1]),
      mk('Q', 'Slam', () => [r.slamCd, 1.3]),
      mk('Space', 'Jump', () => [r.y > 0.05 ? 1 : 0, 1]),
      mk('Shift', 'Drift', () => [0, 1]));
    this.hud.abilities.firstChild.classList.add('weapon');
  }

  // ------------------------------------------------------------ racers

  spawnRacer(data, slot, isPlayer) {
    const st = computeStats(data);
    const built = buildCreatureMesh(data);
    const group = new THREE.Group();
    group.add(built.root);
    const glow = built.anim.mats?.glow.emissive.getHex() ?? 0xffffff;
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.15, 1.3, 40), new THREE.MeshBasicMaterial({ color: isPlayer ? 0xffffff : glow, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false, toneMapped: false }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.05;
    const shadow = new THREE.Mesh(new THREE.CircleGeometry(1.1, 24), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.04;
    const shield = new THREE.Mesh(new THREE.SphereGeometry(1.8, 28, 18), new THREE.MeshBasicMaterial({ color: new THREE.Color(0x4dff9a).multiplyScalar(1.5), transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    shield.position.y = built.height * 0.5;
    shield.visible = false;
    const bar = this.makeBar(1.8, isPlayer ? 0xffffff : glow);
    bar.group.position.y = built.height + 0.8;
    group.add(ring, shadow, shield, bar.group);
    this.scene.add(group);

    const { pts, tan, right } = this.track;
    const row = Math.floor(slot / 2);
    const i = wrap(-6 - row * 7);
    const lat = (slot % 2 ? 1 : -1) * 3.6;
    const pos = pts[i].clone().addScaledVector(right[i], lat);
    const r = {
      name: data.name, data, st, built, group, ring, shield, bar, glow, isPlayer,
      pos, vel: new THREE.Vector3(), kb: new THREE.Vector3(), y: 0, vy: 0,
      heading: Math.atan2(tan[i].x, tan[i].z), speed: 0, lat: 0,
      maxSpeed: 30 * (0.93 + 0.14 * clamp(st.speed / 7.5, 0, 1)), mass: 1 + st.weight / 45, spinMul: clamp(1 - st.stability * 0.03, 0.6, 1.2),
      hp: 100, maxHp: 100, idx: i, lapsDone: -1, cp: false, finished: false, finishTime: null, place: slot + 1, lapStart: 0, bestLap: null,
      items: [], sel: 0, rolling: 0, rampT: 0, boostT: 0, spinT: 0, spinVis: 0, shieldT: 0, invulnT: 0, hitT: 0, slamT: 0, slamCd: 0, weaponCd: 0, fireT: 0,
      drifting: false, driftDir: 0, driftCharge: 0, airT: 0, padCd: 0, sweepCd: 0, wallT: 0, wrongT: 0, trailT: 0, flameT: 0,
      ko: false, koT: 0, kos: 0, tether: null,
      // the player gets an autopilot too, used once they cross the finish
      ai: { offset: rnd(-4, 4), phase: rnd(0, 10), skill: isPlayer ? 1 : rnd(0.95, 1.03), think: 0, band: 1 },
    };
    group.position.copy(pos);
    this.racers.push(r);
    if (isPlayer) {
      this.portrait.src = creatureThumb(data, { size: 128 });
      this.nameEl.textContent = data.name;
      this.player = r;
      this.buildAbilities();
    }
    return r;
  }

  makeBar(width, color) {
    const group = new THREE.Group();
    const bg = new THREE.Mesh(new THREE.PlaneGeometry(width + 0.06, 0.16), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.65, depthTest: false, fog: false }));
    const fg = new THREE.PlaneGeometry(width, 0.1);
    fg.translate(width / 2, 0, 0);
    const fill = new THREE.Mesh(fg, new THREE.MeshBasicMaterial({ color, depthTest: false, fog: false, toneMapped: false }));
    fill.position.set(-width / 2, 0, 0.01);
    bg.renderOrder = 10;
    fill.renderOrder = 11;
    group.add(bg, fill);
    return { group, fill, set: (f) => (fill.scale.x = Math.max(0.001, Math.min(1, f))) };
  }

  progress(r) {
    return r.lapsDone * M + r.idx;
  }

  // ------------------------------------------------------------ input

  bindInput() {
    const typing = () => devConsole.isOpen || document.activeElement?.tagName === 'INPUT';
    this.onKeyDown = (e) => {
      if (typing()) return;
      const k = e.key.toLowerCase();
      if (k === 'escape') {
        if (performance.now() - (this.unlockedAt || 0) < 300) return; // the browser already released the mouse and we paused
        return this.togglePause();
      }
      if (k === 'v' && !e.repeat) return this.setRaceCamera(this.settings.raceCamera === 'mouse' ? 'track' : 'mouse');
      if ([' ', 'tab', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) e.preventDefault();
      if (!e.repeat) this.tapped.add(k); // a quick tap can be shorter than a frame; remember it until the next one
      this.keys.add(k);
    };
    this.onKeyUp = (e) => this.keys.delete(e.key.toLowerCase());
    const cv = this.renderer.domElement;
    this.onMouseDown = (e) => {
      if (e.target !== cv) return;
      if (this.settings.raceCamera === 'mouse' && !this.locked && !this.paused) {
        this.requestLock(); // the first click only grabs the mouse
        return;
      }
      this.buttons.add(e.button);
      if (e.button === 2) this.orbitX = e.clientX;
    };
    this.onMouseUp = (e) => {
      this.buttons.delete(e.button);
      if (e.button === 2) this.orbitX = null;
    };
    this.onMouseMove = (e) => {
      if (this.locked) {
        // mouse steer: the view turns with the mouse and WASD runs relative to it
        this.camYaw = wrapAng(this.camYaw - e.movementX * 0.0026 * this.settings.sensitivity);
        return;
      }
      if (this.orbitX == null) return;
      this.camOrbit = wrapAng(this.camOrbit - (e.clientX - this.orbitX) * 0.008 * this.settings.sensitivity);
      this.orbitX = e.clientX;
      this.orbitIdleT = 0;
    };
    this.onWheel = (e) => {
      if (e.target === cv || this.locked) this.tapped.add('r');
    };
    addEventListener('wheel', this.onWheel, { passive: true });
    this.onContext = (e) => e.target === cv && e.preventDefault();
    this.onBlur = () => {
      this.keys.clear();
      this.buttons.clear();
    };
    addEventListener('keydown', this.onKeyDown);
    addEventListener('keyup', this.onKeyUp);
    addEventListener('mousedown', this.onMouseDown);
    addEventListener('mouseup', this.onMouseUp);
    addEventListener('mousemove', this.onMouseMove);
    addEventListener('contextmenu', this.onContext);
    addEventListener('blur', this.onBlur);
    this.onLockChange = () => {
      const locked = document.pointerLockElement === cv;
      if (this.locked && !locked) {
        this.unlockedAt = performance.now();
        this.buttons.clear();
        if (!this.paused && this.phase !== 'done') this.togglePause(true);
      }
      this.locked = locked;
      this.updateLockHint();
    };
    document.addEventListener('pointerlockchange', this.onLockChange);
  }

  requestLock() {
    try {
      this.renderer.domElement.requestPointerLock()?.catch?.(() => {});
    } catch {}
  }

  releaseLock() {
    if (document.pointerLockElement === this.renderer.domElement) document.exitPointerLock();
  }

  updateLockHint() {
    this.lockHint.hidden = !(this.settings.raceCamera === 'mouse' && !this.locked && !this.paused && this.phase !== 'done');
  }

  // 'track' turns the view with the curves ahead; 'mouse' hands the view (and steering) to the mouse.
  setRaceCamera(mode) {
    this.settings = setSetting('raceCamera', mode);
    if (mode === 'track') this.releaseLock();
    this.camOrbit = 0;
    this.updateLockHint();
    this.updateHint();
    if (!this.paused) this.banner(mode === 'mouse' ? 'MOUSE STEER · CLICK TO GRAB' : 'FOLLOW-TRACK CAMERA');
  }

  updateHint() {
    this.controlsHint.textContent = this.settings.raceCamera === 'mouse'
      ? 'Mouse steers · W go · S brake · A/D strafe · F shoot · E item · R swap · Q slam · Space jump · Shift drift · V camera · Esc menu'
      : 'W follows the track · A/D shift across · S brake · F shoot · E item · R swap · Q slam · Space jump · Shift drift · V camera · Esc menu';
  }

  togglePause(force) {
    if (this.phase === 'done') return;
    this.paused = force ?? !this.paused;
    this.hud.pause.hidden = !this.paused;
    if (this.paused) {
      this.hud.pause.replaceChildren(h('div', { class: 'panel pause-card' },
        h('div', { class: 'title-kicker' }, `RIFT RALLY · ${this.biome.name}`),
        h('h2', {}, 'Paused'),
        h('button', { class: 'btn primary', onclick: () => this.togglePause(false) }, 'Resume'),
        h('div', { class: 'settings' },
          h('label', {}, 'Camera'),
          h('div', { class: 'seg-row' }, ...[['track', 'Follow track'], ['mouse', 'Mouse steer']].map(([id, label]) => h('button', {
            class: `seg ${this.settings.raceCamera === id ? 'active' : ''}`,
            onclick: () => {
              this.setRaceCamera(id);
              this.togglePause(true);
            },
          }, label)))),
        h('button', { class: 'btn', onclick: () => this.onExit?.('restart') }, 'Restart race'),
        h('button', { class: 'btn', onclick: () => this.onExit?.('menu') }, 'Quit to menu')));
      this.releaseLock();
    } else if (this.settings.raceCamera === 'mouse') {
      this.requestLock();
    }
    this.updateLockHint();
  }

  // Third-person steering: WASD point where you want to go relative to the camera, and the creature turns to face it.
  // S on its own brakes and reverses. F (or left click) fires, E uses the item, Q slams, Space jumps.
  playerControls() {
    const held = this.keys;
    const tapped = new Set(this.tapped);
    this.tapped.clear();
    const k = { has: (key) => held.has(key) || tapped.has(key) };
    const r = this.player;
    const fwdIn = (k.has('w') || k.has('arrowup') ? 1 : 0) - (k.has('s') || k.has('arrowdown') ? 1 : 0);
    const rightIn = (k.has('d') || k.has('arrowright') ? 1 : 0) - (k.has('a') || k.has('arrowleft') ? 1 : 0);
    let throttle = 0;
    let steer = 0;
    if (fwdIn < 0) {
      throttle = -1;
      steer = rightIn;
    } else if (fwdIn > 0 || rightIn) {
      // the camera already points down the road (or where the mouse looks), so A/D only angle you across it
      const yaw = this.camYaw + this.camOrbit;
      const side = rightIn * 0.6;
      const want = Math.atan2(Math.sin(yaw) - Math.cos(yaw) * side, Math.cos(yaw) + Math.sin(yaw) * side);
      const diff = wrapAng(want - r.heading);
      steer = clamp(-diff * 2.6, -1, 1);
      throttle = Math.abs(diff) > 2.2 ? 0.35 : 1; // asked to go the other way: slow down and swing around
    }
    return {
      throttle, steer,
      drift: k.has('shift'),
      fire: k.has('f') || this.buttons.has(0),
      item: tapped.has('e'), // one item per press, so holding E doesn't spend both
      swap: tapped.has('r'),
      slam: k.has('q'),
      jump: k.has(' '),
    };
  }

  // Bots follow a lane offset along the racing line, brake into tight corners, and rubber-band a little.
  botControls(r, dt) {
    const ai = r.ai;
    const { pts, right, width, curv } = this.track;
    const look = Math.round(10 + Math.abs(r.speed) * 0.45);
    const ti = wrap(r.idx + look);
    let off = ai.offset + Math.sin(this.time * 0.35 + ai.phase) * 3 - curv[ti] * 9;
    for (const m of this.mines) {
      if (flatDist(m.pos, pts[ti]) < 8) off += Math.sign(off - this.latOf(m.pos, ti) || 1) * 4;
    }
    off = clamp(off, -width[ti] / 2 + 2.2, width[ti] / 2 - 2.2);
    const target = pts[ti].clone().addScaledVector(right[ti], off);
    const want = Math.atan2(target.x - r.pos.x, target.z - r.pos.z);
    const diff = wrapAng(want - r.heading);
    const sharp = Math.abs(curv[wrap(r.idx + 20)]);
    const c = {
      steer: clamp(-diff * 2.4, -1, 1),
      throttle: Math.abs(diff) > 0.8 ? 0.4 : sharp > 0.55 && r.speed > r.maxSpeed * 0.8 ? 0.5 : 1,
      drift: sharp > 0.3 && r.speed > 16 && Math.abs(diff) > 0.12,
      fire: false, item: false, slam: false,
    };
    if (r.finished) c.throttle = 0.55;
    // rubber band toward the player's progress
    const gap = (this.progress(this.player) - this.progress(r)) / M;
    ai.band = clamp(1 + gap * 0.3, 0.93, 1.09) * ai.skill;
    ai.think -= dt;
    if (ai.think <= 0 && !r.finished) {
      ai.think = rnd(0.3, 0.6);
      c.fire = !!this.lockFor(r, r.st.weapon.range * 1.4);
      r.sel = 0;
      if (r.items.length) c.item = this.botWantsItem(r);
      const side = this.racers.find((o) => o !== r && !o.ko && flatDist(o.pos, r.pos) < 3.2);
      if (side && Math.random() < 0.5) {
        c.slam = true;
        c.steer = Math.sign(this.latOf(side.pos, r.idx) - this.latOf(r.pos, r.idx)) || 1;
      }
    }
    ai.firing = c.fire || (ai.firing && ai.think > 0.1);
    c.fire = ai.firing;
    return c;
  }

  botWantsItem(r) {
    const ahead = this.racerAhead(r);
    const behind = this.racers.find((o) => o.place === r.place + 1);
    switch (r.items[0]) {
      case 'volley': case 'tether': return !!ahead && this.progress(ahead) - this.progress(r) < 120;
      case 'mine': return !!behind && this.progress(r) - this.progress(behind) < 60;
      case 'shockwave': return this.racers.some((o) => o !== r && !o.ko && flatDist(o.pos, r.pos) < 7);
      case 'storm': return r.place > 1;
      default: return Math.random() < 0.6;
    }
  }

  latOf(pos, i) {
    const p = this.track.pts[i];
    return (pos.x - p.x) * this.track.right[i].x + (pos.z - p.z) * this.track.right[i].z;
  }

  racerAhead(r) {
    return this.racers.find((o) => o.place === r.place - 1 && !o.ko) || null;
  }

  // ------------------------------------------------------------ main loop

  frame(now) {
    this.raf = requestAnimationFrame((t) => this.frame(t));
    try {
      this.loop(now);
    } catch (err) {
      console.error(err);
      if (!this.errorShown) {
        this.errorShown = true;
        this.banner(`Something broke: ${err.message}`);
      }
    }
  }

  loop(now) {
    const realDt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    if (!this.paused) {
      let dt = realDt;
      if (this.slowmo > 0) {
        this.slowmo -= realDt;
        dt *= 0.3;
      }
      this.update(dt);
    }
    this.updateCamera(realDt);
    this.updateHud(realDt);
    if (this.composer) this.composer.render(realDt);
    else this.renderer.render(this.scene, this.camera);
  }

  update(dt) {
    this.time += dt;
    this.phaseT += dt;
    if (this.phase === 'intro' && this.phaseT >= INTRO) this.setPhase('countdown');
    if (this.phase === 'countdown') {
      const n = Math.ceil(COUNTDOWN - this.phaseT);
      if (n !== this.lastCount && n > 0) {
        this.lastCount = n;
        this.countdown(String(n));
      }
      if (this.phaseT >= COUNTDOWN) {
        this.setPhase('race');
        this.countdown('GO!', 'go');
        // a perfectly timed throttle gives a rocket start
        for (const r of this.racers) if (r.isPlayer ? this.keys.has('w') || this.keys.has('arrowup') : Math.random() < 0.4) r.boostT = 1;
      }
    }
    if (this.phase === 'race' || this.phase === 'finished') this.raceTime += dt;

    for (const r of this.racers) this.updateRacer(r, dt);
    this.collideRacers();
    this.updatePlaces();
    this.updatePods(dt);
    this.updateHazards(dt);
    this.updateProjectiles(dt);
    this.updateMines(dt);
    this.updateStrikes(dt);
    this.chevron.offset.y -= dt * 2.5;
    this.fx.update(dt);
  }

  setPhase(p) {
    this.phase = p;
    this.phaseT = 0;
  }

  updateRacer(r, dt) {
    for (const k of ['boostT', 'spinT', 'shieldT', 'invulnT', 'hitT', 'slamT', 'slamCd', 'weaponCd', 'fireT', 'padCd', 'sweepCd', 'rolling', 'rampT']) {
      const before = r[k];
      r[k] = Math.max(0, r[k] - dt);
      if (k === 'rolling' && before > 0 && r[k] === 0 && r.items.length < 2) r.items.push(this.rollItem(r));
    }
    if (r.ko) return this.updateKo(r, dt);
    const racing = this.phase === 'race' || this.phase === 'finished';
    let c = { throttle: 0, steer: 0, drift: false, fire: false, item: false, slam: false };
    if (racing) c = r.isPlayer && !r.finished ? this.playerControls() : this.botControls(r, dt);
    if (devConsole.isOpen && r.isPlayer) c = { throttle: 0, steer: 0 };
    if (r.tether) return this.updateTether(r, dt);

    const air = r.y > 0.05;
    let cap = r.maxSpeed * (r.ai?.band || 1);
    if (r.boostT > 0) cap *= 1.45;
    if (r.spinT > 0) cap *= 0.35;
    // throttle and braking
    if (c.throttle > 0) r.speed += (r.boostT > 0 ? 55 : 24) * c.throttle * dt;
    else if (c.throttle < 0) r.speed -= (r.speed > 0 ? 48 : 16) * dt;
    else r.speed -= Math.sign(r.speed) * Math.min(Math.abs(r.speed), 9 * dt);
    if (r.speed > cap) r.speed += (cap - r.speed) * (1 - Math.exp(-2.5 * dt));
    r.speed = Math.max(-12, r.speed);
    if (r.boostT > 0 && r.speed < cap * 0.9) r.speed += 40 * dt;

    // steering and drifting
    const sp = Math.abs(r.speed);
    const rate = (1.5 + 1.1 * (1 - clamp(sp / r.maxSpeed, 0, 1))) * (air ? 0.4 : 1);
    if (!r.drifting && c.drift && Math.abs(c.steer) > 0.3 && sp > 12 && !air && r.spinT <= 0) {
      r.drifting = true;
      r.driftDir = Math.sign(c.steer);
      r.driftCharge = 0;
    }
    if (r.drifting && (!c.drift || sp < 9 || r.spinT > 0)) {
      const tier = r.driftCharge > 2.2 ? 3 : r.driftCharge > 1.3 ? 2 : r.driftCharge > 0.6 ? 1 : 0;
      if (tier) {
        r.boostT = Math.max(r.boostT, [0, 0.55, 0.9, 1.4][tier]);
        this.fx.flash(new THREE.Vector3(r.pos.x, r.y + 0.6, r.pos.z), [0, 0x38e1ff, 0xffb020, 0xff4fd0][tier], 0.8, 0.25);
        if (r.isPlayer) this.floatText(r.pos, ['', 'BOOST', 'SUPER BOOST', 'ULTRA BOOST'][tier], ['', '#7fe8ff', '#ffc060', '#ff8fe0'][tier], 2.6);
      }
      r.drifting = false;
    }
    if (r.drifting) {
      const tighten = Math.sign(c.steer) === r.driftDir ? Math.abs(c.steer) : -Math.abs(c.steer) * 0.5;
      r.heading -= r.driftDir * (0.75 + 0.45 * tighten) * rate * 1.25 * dt;
      r.lat -= r.driftDir * 5 * dt;
      r.driftCharge += dt * (tighten > 0.3 ? 1.3 : 0.7);
    } else if (sp > 0.5 && r.spinT <= 0) {
      r.heading -= c.steer * rate * dt * Math.sign(r.speed);
    }
    if (r.spinT > 0) r.spinVis += dt * 16 * Math.min(1, r.spinT * 2);

    // jump: hop over mines, the sweeper arm and slower racers
    if (c.jump && !air && r.vy === 0 && r.spinT <= 0) {
      r.vy = 9.5;
      r.y = 0.01;
      r.airT = 0;
      this.fx.ring(r.pos, 1.6, r.glow, 0.3);
    }
    // slam: a hard sideways (or forward) shove that knocks anyone you touch
    if (c.slam && r.slamCd <= 0 && !air && r.spinT <= 0) {
      r.slamCd = 1.1;
      r.slamT = 0.38;
      // lunge at the nearest rival in reach, so slams land without precise aim
      const near = this.racers.filter((o) => o !== r && !o.ko && flatDist(o.pos, r.pos) < 8 && Math.abs(o.y - r.y) < 2)
        .sort((a, b) => flatDist(a.pos, r.pos) - flatDist(b.pos, r.pos))[0];
      r.slamTarget = near && !(c.steer && !r.isPlayer) ? near : null;
      if (!r.slamTarget && c.steer) r.lat += c.steer * 18;
      else r.speed += 9;
      this.fx.puff(new THREE.Vector3(r.pos.x, 0.6, r.pos.z), r.glow, 1, 0.3, new THREE.Vector3());
    }
    if (c.fire) this.fireWeapon(r);
    if (c.swap && r.items.length > 1) {
      r.sel = (r.sel + 1) % r.items.length;
      if (r.isPlayer) this.hud.itemBox.classList.add('swapped');
    }
    if (c.item && r.items.length) this.useItem(r);

    // integrate
    const fwd = new THREE.Vector3(Math.sin(r.heading), 0, Math.cos(r.heading));
    const right = new THREE.Vector3(-Math.cos(r.heading), 0, Math.sin(r.heading));
    r.lat *= Math.exp(-(r.drifting ? 2.5 : 7) * dt);
    r.kb.multiplyScalar(Math.exp(-3 * dt));
    // a guided slam closes on its target at 20 m/s on top of whatever the target is doing
    const st = r.slamTarget;
    if (r.slamT > 0 && st && !st.ko) {
      const want = new THREE.Vector3(st.pos.x - r.pos.x, 0, st.pos.z - r.pos.z).setLength(20).add(st.vel.clone().setY(0));
      r.kb.copy(want.sub(fwd.clone().multiplyScalar(r.speed).addScaledVector(right, r.lat)));
    } else r.slamTarget = null;
    r.vel.copy(fwd).multiplyScalar(r.speed).addScaledVector(right, r.lat).add(r.kb);
    r.pos.addScaledVector(r.vel, dt);

    // ramps lift you as you climb them, then the lip launches you
    for (const rp of this.ramps) {
      const rel = r.pos.clone().sub(rp.pos);
      const along = rel.dot(this.track.tan[rp.i]);
      if (Math.abs(this.latOf(r.pos, rp.i) - this.latOf(rp.pos, rp.i)) > this.track.width[rp.i] / 2 - 0.8) continue;
      if (along > -5 && along < 0 && r.vy <= 0) r.y = Math.max(r.y, ((along + 5) / 5) * 1.3);
      if (along >= 0 && along < 1.5 && r.y > 1 && r.vy <= 0 && r.speed > 6) {
        r.vy = 6 + r.speed * 0.18;
        r.airT = 0;
        if (r.isPlayer) this.shake = Math.max(this.shake, 0.15);
      }
    }
    if (r.y > 0 || r.vy !== 0) {
      r.airT += dt;
      r.vy -= 24 * dt;
      r.y += r.vy * dt;
      if (r.y <= 0) {
        r.y = 0;
        if (r.vy < -8) {
          this.fx.ring(r.pos, 2.2, r.glow, 0.35);
          if (r.airT > 0.6) r.boostT = Math.max(r.boostT, 0.7); // landing boost
          if (r.isPlayer) this.shake = Math.max(this.shake, 0.25);
        }
        r.vy = 0;
        r.airT = 0;
      }
    }

    this.updateIdx(r);
    this.clampToTrack(r, dt);
    this.checkPads(r);

    // wrong way
    const t = this.track.tan[r.idx];
    r.wrongT = fwd.dot(t) < -0.3 && r.speed > 3 ? r.wrongT + dt : 0;

    // boost flames and drift sparks
    r.flameT -= dt;
    if (r.flameT <= 0) {
      r.flameT = 0.025;
      const back = r.pos.clone().addScaledVector(fwd, -1.3).setY(r.y + 0.7);
      if (r.boostT > 0) this.fx.puff(back, 0xffb020, 0.45, 0.35, fwd.clone().multiplyScalar(-6));
      if (r.drifting) {
        const tier = r.driftCharge > 2.2 ? 3 : r.driftCharge > 1.3 ? 2 : r.driftCharge > 0.6 ? 1 : 0;
        if (tier) this.fx.sparks(back.clone().setY(0.2), [0, 0x38e1ff, 0xffb020, 0xff4fd0][tier], 2, 5, { gravity: 10, life: 0.3 });
      }
    }
    this.syncRacer(r, dt);
  }

  updateIdx(r) {
    const { pts } = this.track;
    let best = r.idx;
    let bd = Infinity;
    for (let k = -15; k <= 40; k++) {
      const i = wrap(r.idx + k);
      const d = (pts[i].x - r.pos.x) ** 2 + (pts[i].z - r.pos.z) ** 2;
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    this.moveIdx(r, best);
  }

  // Lap logic: crossing index 0 forward counts only after the halfway checkpoint.
  moveIdx(r, next) {
    const prev = r.idx;
    r.idx = next;
    if (prev > M * 0.75 && next < M * 0.25) {
      if (r.lapsDone === -1 || r.cp) {
        r.lapsDone += 1;
        r.cp = false;
        if (r.lapsDone >= 1) {
          const lap = this.raceTime - r.lapStart;
          r.bestLap = r.bestLap == null ? lap : Math.min(r.bestLap, lap);
        }
        r.lapStart = this.raceTime;
        this.onLap(r);
      }
    } else if (prev < M * 0.25 && next > M * 0.75) {
      r.lapsDone -= 1;
      r.cp = true;
    }
    if (next > M * 0.45 && next < M * 0.55) r.cp = true;
  }

  onLap(r) {
    if (r.lapsDone >= this.laps && !r.finished) {
      r.finished = true;
      r.finishTime = this.raceTime;
      this.finishCount += 1;
      r.finishPlace = this.finishCount;
      this.feed(`${r.name} finished ${ordinal(r.finishPlace)}`, r.isPlayer ? 'blue' : '');
      if (r.isPlayer) {
        this.setPhase('finished');
        this.banner(`FINISH · ${ordinal(r.finishPlace).toUpperCase()}`, 'finish');
        this.fx.sparks(new THREE.Vector3(r.pos.x, 2, r.pos.z), 0xffffff, 40, 14);
        setTimeout(() => this.endRace(), 3200);
      }
      return;
    }
    if (r.isPlayer && r.lapsDone >= 1) this.banner(r.lapsDone === this.laps - 1 ? 'FINAL LAP' : `LAP ${r.lapsDone + 1} / ${this.laps}`);
  }

  clampToTrack(r, dt) {
    const i = r.idx;
    const lat = this.latOf(r.pos, i);
    const half = this.track.width[i] / 2 - 0.9;
    if (Math.abs(lat) <= half) return;
    const R = this.track.right[i];
    const over = lat - Math.sign(lat) * half;
    r.pos.addScaledVector(R, -over);
    const into = r.vel.dot(R) * Math.sign(lat);
    if (into > 0) {
      r.kb.addScaledVector(R, -Math.sign(lat) * into * 0.5);
      r.lat *= -0.3;
      r.speed *= 1 - clamp(into / 40, 0.01, 0.25);
    }
    r.speed *= 1 - 0.4 * dt;
    r.wallT -= dt;
    if (r.wallT <= 0 && Math.abs(r.speed) > 6) {
      r.wallT = 0.06;
      this.fx.sparks(r.pos.clone().addScaledVector(R, Math.sign(lat) * 0.9).setY(0.6), 0xffd080, 3, 6, { life: 0.3 });
    }
  }

  checkPads(r) {
    if (r.padCd > 0 || r.y > 0.5) return;
    for (const p of this.pads) {
      const rel = r.pos.clone().sub(p.pos);
      if (Math.abs(rel.dot(this.track.tan[p.i])) < 3.5 && Math.abs(rel.dot(this.track.right[p.i])) < 2.4) {
        r.boostT = Math.max(r.boostT, 1.2);
        r.padCd = 0.6;
        if (r.isPlayer) this.shake = Math.max(this.shake, 0.12);
        this.fx.flash(new THREE.Vector3(r.pos.x, 0.5, r.pos.z), 0xffb020, 1, 0.2);
      }
    }
  }

  syncRacer(r, dt) {
    const g = r.group;
    g.position.set(r.pos.x, r.y, r.pos.z);
    const root = r.built.root;
    const a = r.built.anim;
    const turn = wrapAng(r.heading - (r.lastHeading ?? r.heading)) / Math.max(dt, 1e-3);
    r.lastHeading = r.heading;
    r.bank = (r.bank || 0) + (clamp(-turn * 0.04, -0.3, 0.3) - (r.bank || 0)) * Math.min(1, dt * 8);
    root.rotation.set(r.y > 0.3 ? -clamp(r.vy * 0.03, -0.3, 0.3) : 0, r.heading + (r.drifting ? -r.driftDir * 0.35 : 0) + r.spinVis, r.bank * 0.5);
    root.scale.setScalar(a.baseScale);
    const sp = Math.abs(r.speed);
    animateCreature(a, this.time + r.idx * 0.01, clamp(sp / 10, 0, 1), dt, {
      freq: 7 + sp * 0.45, fire: r.fireT / 0.12, hit: r.hitT / 0.15, lean: clamp(sp / 30, 0, 1) * 0.12 + (r.boostT > 0 ? 0.08 : 0),
      attack: r.slamT > 0 ? Math.sin((r.slamT / 0.32) * Math.PI) : 0,
    });
    r.shield.visible = r.shieldT > 0;
    g.visible = !(r.invulnT > 0 && Math.sin(this.time * 40) > 0.3);
    r.bar.set(r.hp / r.maxHp);
    r.bar.group.visible = !r.isPlayer && this.camera.position.distanceTo(r.group.position) > 7;
    r.bar.group.parent.getWorldQuaternion(this.tmpQ ??= new THREE.Quaternion());
    r.bar.group.quaternion.copy(this.tmpQ.invert().multiply(this.camera.quaternion));
  }

  collideRacers() {
    const live = this.racers.filter((r) => !r.ko && !r.tether);
    for (let i = 0; i < live.length; i++) {
      for (let j = i + 1; j < live.length; j++) {
        const a = live[i];
        const b = live[j];
        if (Math.abs(a.y - b.y) > 1.5) continue;
        const dx = b.pos.x - a.pos.x;
        const dz = b.pos.z - a.pos.z;
        const d = Math.hypot(dx, dz);
        const reach = a.slamT > 0 || b.slamT > 0 ? 2.8 : 2.1;
        if (d < 0.01 || d > reach) continue;
        const n = new THREE.Vector3(dx / d, 0, dz / d);
        const push = Math.max(0, 2.1 - d) / 2;
        const ma = a.mass / (a.mass + b.mass);
        a.pos.addScaledVector(n, -push * 2 * (1 - ma));
        b.pos.addScaledVector(n, push * 2 * ma);
        for (const [hitter, victim, dir] of [[a, b, 1], [b, a, -1]]) {
          if (hitter.slamT > 0 && !hitter.slamHit?.has(victim)) {
            (hitter.slamHit ??= new Set()).add(victim);
            setTimeout(() => hitter.slamHit?.delete(victim), 400);
            this.hurt(victim, 14 * (hitter.mass / victim.mass), hitter, { spin: 0.9, kb: n.clone().multiplyScalar(dir * 16 * (hitter.mass / victim.mass)), slow: 0.7 });
            this.fx.sparks(new THREE.Vector3((a.pos.x + b.pos.x) / 2, 1, (a.pos.z + b.pos.z) / 2), 0xffffff, 12, 10);
            if (hitter.isPlayer || victim.isPlayer) this.shake = Math.max(this.shake, 0.4);
          }
        }
        // Overdrive and Phase Shield turn you into a battering ram
        for (const [hitter, victim, dir] of [[a, b, 1], [b, a, -1]]) {
          if ((hitter.rampT > 0 || hitter.shieldT > 0) && !(victim.rampT > 0) && !hitter.slamHit?.has(victim)) {
            (hitter.slamHit ??= new Set()).add(victim);
            setTimeout(() => hitter.slamHit?.delete(victim), 600);
            this.hurt(victim, 12, hitter, { spin: 1, kb: n.clone().multiplyScalar(dir * 18), slow: 0.5, launch: 4 });
            this.fx.sparks(new THREE.Vector3((a.pos.x + b.pos.x) / 2, 1, (a.pos.z + b.pos.z) / 2), 0xffb020, 14, 11);
          }
        }
        if (a.slamT <= 0 && b.slamT <= 0) {
          a.kb.addScaledVector(n, -3 * (1 - ma));
          b.kb.addScaledVector(n, 3 * ma);
        }
      }
    }
  }

  updatePlaces() {
    const order = [...this.racers].sort((a, b) => {
      if (a.finished || b.finished) return (a.finished ? a.finishTime : Infinity) - (b.finished ? b.finishTime : Infinity) || this.progress(b) - this.progress(a);
      return this.progress(b) - this.progress(a);
    });
    order.forEach((r, i) => {
      r.place = i + 1;
    });
    const p = this.player.place;
    if (this.lastPlace && p !== this.lastPlace && this.phase === 'race') {
      this.hud.place.classList.remove('bump');
      void this.hud.place.offsetWidth;
      this.hud.place.classList.add(p < this.lastPlace ? 'bump' : 'drop');
    }
    this.lastPlace = p;
    this.order = order;
  }

  // ------------------------------------------------------------ combat

  lockFor(r, range) {
    const fwd = new THREE.Vector3(Math.sin(r.heading), 0, Math.cos(r.heading));
    let best = null;
    for (const o of this.racers) {
      if (o === r || o.ko) continue;
      const rel = new THREE.Vector3(o.pos.x - r.pos.x, 0, o.pos.z - r.pos.z);
      const d = rel.length();
      if (d > range || d < 0.8) continue;
      const ang = Math.acos(clamp(rel.dot(fwd) / d, -1, 1));
      if (ang > (r.isPlayer ? 0.9 : 0.55)) continue;
      const score = ang * 25 + d * 0.3;
      if (!best || score < best[1]) best = [o, score];
    }
    return best?.[0] || null;
  }

  muzzleOf(r) {
    const m = r.built.anim.muzzle;
    const v = new THREE.Vector3();
    if (!m) return v.set(r.pos.x, r.y + 1.2, r.pos.z);
    r.group.updateMatrixWorld(true);
    return m.getWorldPosition(v);
  }

  // Your creature's weapon, tuned for racing: shots inherit your speed and home in on the racer you're locked onto.
  fireWeapon(r) {
    const w = r.st.weapon;
    if (r.weaponCd > 0 || r.ko || r.spinT > 0.3 || this.phase === 'intro' || this.phase === 'countdown') return;
    r.weaponCd = w.cd * (r.isPlayer ? 1.1 : 1.9);
    r.fireT = 0.12;
    const lock = this.lockFor(r, (w.range || 20) * 1.6);
    const muzzle = this.muzzleOf(r);
    const fwd = new THREE.Vector3(Math.sin(r.heading), 0, Math.cos(r.heading));
    this.fx.flash(muzzle, w.color, 0.35, 0.06);
    const aimAt = lock ? new THREE.Vector3(lock.pos.x, lock.y + 1, lock.pos.z).addScaledVector(lock.vel, 0.25) : muzzle.clone().addScaledVector(fwd, 30).setY(1);
    const dir = aimAt.clone().sub(muzzle).normalize();
    const sloppy = r.isPlayer ? 0 : 0.08;
    switch (w.kind) {
      case 'shot':
        for (let i = 0; i < (w.pellets || 1); i++) {
          const d = dir.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), (Math.random() - 0.5) * 2 * ((w.spread || 0) + sloppy));
          const vel = d.multiplyScalar(w.speed + 12).addScaledVector(fwd, Math.max(0, r.speed));
          this.shoot(r, muzzle, vel, { dmg: w.dmg * 1.7, target: lock, seek: lock ? Math.max(6, w.homing * 2.5) * (r.isPlayer ? 1 : 0.2) : 0, life: 1.6, color: w.color, size: w.pellets > 1 ? 0.07 : 0.09 });
        }
        break;
      case 'lob': {
        const dest = lock ? new THREE.Vector3(lock.pos.x, 0, lock.pos.z).addScaledVector(lock.vel, 0.7) : r.pos.clone().addScaledVector(fwd, 22 + r.speed * 0.7);
        const t = 0.7;
        const vel = new THREE.Vector3((dest.x - muzzle.x) / t, (0 - muzzle.y + 0.5 * 24 * t * t) / t, (dest.z - muzzle.z) / t);
        this.shoot(r, muzzle, vel, { dmg: w.dmg * 1.4, lob: true, gravity: 24, radius: w.radius, life: t + 0.6, color: w.color, size: 0.2 });
        break;
      }
      case 'beam': {
        const end = muzzle.clone().addScaledVector(dir, w.range * 1.6);
        for (const o of this.racers) {
          if (o === r || o.ko) continue;
          const rel = new THREE.Vector3(o.pos.x, o.y + 1, o.pos.z).sub(muzzle);
          const along = rel.dot(dir);
          if (along < 0 || along > w.range * 1.6) continue;
          if (rel.addScaledVector(dir, -along).length() < (r.isPlayer ? 2.6 : 1)) this.hurt(o, w.dmg * 1.3, r, { spin: 0.4, slow: 0.85 });
        }
        this.fx.beam(muzzle, end, w.color, 0.1, 0.22);
        if (r.isPlayer) this.shake = Math.max(this.shake, 0.15);
        break;
      }
      case 'chain': {
        let cur = lock && flatDist(lock.pos, r.pos) < w.range * 1.5 ? lock : null;
        let from = muzzle;
        const hit = new Set();
        for (let i = 0; cur && i <= w.chains; i++) {
          hit.add(cur);
          const to = new THREE.Vector3(cur.pos.x, cur.y + 1, cur.pos.z);
          this.fx.lightning(from, to, w.color);
          this.hurt(cur, w.dmg * 1.4 * (i ? 0.75 : 1), r, { spin: 0.25, slow: 0.9 });
          from = to;
          const c = cur;
          cur = this.racers.filter((o) => o !== r && !o.ko && !hit.has(o) && flatDist(o.pos, c.pos) < w.chainRange * 1.3).sort((x, y) => flatDist(x.pos, c.pos) - flatDist(y.pos, c.pos))[0];
        }
        if (!hit.size) this.fx.lightning(muzzle, muzzle.clone().addScaledVector(fwd, 8), w.color);
        break;
      }
    }
  }

  shoot(owner, from, vel, o) {
    const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(o.size || 0.09, (o.size || 0.09) * 5, 4, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(o.color).multiplyScalar(2.5), toneMapped: false }));
    mesh.position.copy(from);
    this.scene.add(mesh);
    this.projectiles.push({ mesh, pos: mesh.position, vel, owner, hitR: owner.isPlayer ? 1.9 : 0.7, ...o });
  }

  updateProjectiles(dt) {
    this.projectiles = this.projectiles.filter((p) => {
      p.life -= dt;
      if (p.seek && p.target && !p.target.ko) {
        const speed = p.vel.length();
        const want = new THREE.Vector3(p.target.pos.x, p.target.y + 1, p.target.pos.z).sub(p.pos).normalize().multiplyScalar(speed);
        p.vel.lerp(want, Math.min(1, dt * p.seek)).setLength(speed);
      }
      if (p.gravity) p.vel.y -= p.gravity * dt;
      p.pos.addScaledVector(p.vel, dt);
      p.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), p.vel.clone().normalize());
      if (p.lob) {
        if (p.pos.y > 0.15 && p.life > 0) return true;
        this.fx.ring(p.pos, p.radius, p.color);
        this.fx.flash(new THREE.Vector3(p.pos.x, 0.6, p.pos.z), p.color, p.radius * 0.7, 0.18);
        this.fx.sparks(new THREE.Vector3(p.pos.x, 0.4, p.pos.z), p.color, 14, 9);
        for (const o of this.racers) if (o !== p.owner && !o.ko && flatDist(o.pos, p.pos) < p.radius + 0.8) this.hurt(o, p.dmg, p.owner, { spin: 0.7, launch: 6 });
        this.removeProjectile(p);
        return false;
      }
      const hit = this.racers.find((o) => o !== p.owner && !o.ko && Math.abs(o.y + 1 - p.pos.y) < 2.2 && flatDist(o.pos, p.pos) < 0.9 + p.hitR);
      if (hit) {
        this.hurt(hit, p.dmg, p.owner, { spin: p.spin ?? 0.15, slow: p.slow ?? 0.92, kb: p.vel.clone().setY(0).setLength(p.push ?? 2) });
        this.fx.sparks(p.pos, p.color, 6, 6);
      }
      if (hit || p.life <= 0) {
        this.removeProjectile(p);
        return false;
      }
      return true;
    });
  }

  removeProjectile(p) {
    this.scene.remove(p.mesh);
    p.mesh.geometry.dispose();
    p.mesh.material.dispose();
  }

  // Every hit goes through here: shields block it, spin-outs and slowdowns apply, empty health means a knockout.
  hurt(t, amt, src, o = {}) {
    if (t.ko || t.invulnT > 0 || this.phase === 'intro' || this.phase === 'countdown' || t.tether) return false;
    if (t.shieldT > 0) {
      t.shieldT = 0;
      this.fx.ring(t.pos, 2.4, 0x4dff9a, 0.4, 1);
      this.fx.flash(new THREE.Vector3(t.pos.x, t.y + 1, t.pos.z), 0x4dff9a, 1.6, 0.25);
      if (t.isPlayer || src?.isPlayer) this.floatText(t.pos, 'BLOCKED', '#4dff9a');
      return false;
    }
    t.hp -= amt;
    t.hitT = 0.15;
    if (o.spin) t.spinT = Math.max(t.spinT, o.spin * t.spinMul);
    if (o.slow) t.speed *= o.slow;
    if (o.kb) t.kb.add(o.kb);
    if (o.launch) {
      t.vy = Math.max(t.vy, o.launch);
      t.y = Math.max(t.y, 0.01);
    }
    if (t.drifting && o.spin) t.drifting = false;
    if (t.isPlayer || src?.isPlayer) this.floatText(t.pos, Math.max(1, Math.round(amt)), t.isPlayer ? '#ff6f8b' : '#ffffff');
    if (src?.isPlayer) this.hitMarkT = 0.14;
    if (t.isPlayer) this.shake = Math.max(this.shake, 0.3);
    if (t.hp <= 0) this.knockout(t, src);
    return true;
  }

  knockout(t, src) {
    t.ko = true;
    t.koT = 0;
    t.burst = false;
    t.vy = rnd(24, 30);
    t.y = Math.max(t.y, 0.01);
    t.spinRate = rnd(7, 12) * (Math.random() < 0.5 ? -1 : 1);
    t.kb.copy(t.vel).setY(0).multiplyScalar(0.3);
    t.speed = 0;
    t.drifting = false;
    t.boostT = 0;
    const at = new THREE.Vector3(t.pos.x, t.y + 1, t.pos.z);
    this.fx.flash(at, 0xffffff, 1.2, 0.3);
    this.fx.flash(at, t.glow, 1.5, 0.45);
    this.fx.ring(t.pos, 4, t.glow);
    this.fx.ring(t.pos, 6.5, 0xffffff);
    this.fx.sparks(at, t.glow, 26, 13);
    this.fx.sparks(at, 0xffffff, 12, 9);
    this.floatText(t.pos, t.isPlayer ? 'KNOCKED OUT' : `${t.name} KO`, t.isPlayer ? '#ff6f8b' : '#ffffff', 3, 'big');
    const killer = src && src !== t ? src : null;
    if (killer) killer.kos += 1;
    this.feed(killer ? `${killer.name} ⟶ ${t.name}` : `${t.name} wiped out`, killer?.isPlayer ? 'blue' : t.isPlayer ? 'red' : '');
    const close = flatDist(t.pos, this.player.pos) < 25;
    if (killer?.isPlayer || t.isPlayer) this.slowmo = Math.max(this.slowmo, 0.4);
    if (close) this.shake = Math.max(this.shake, 0.6);
    if (killer?.isPlayer) {
      this.killMarkT = 0.5;
      this.killCam = { r: t, t: 0 };
    }
  }

  // Knocked-out racers rocket skyward trailing light, burst, then drop back onto the track.
  updateKo(r, dt) {
    r.koT += dt;
    if (!r.burst) {
      r.vy -= 9 * dt;
      r.y += r.vy * dt;
      r.kb.multiplyScalar(Math.exp(-1.5 * dt));
      r.pos.addScaledVector(r.kb, dt);
      const root = r.built.root;
      root.rotation.x += r.spinRate * dt;
      root.rotation.z += r.spinRate * 0.6 * dt;
      r.group.position.set(r.pos.x, r.y, r.pos.z);
      r.bar.group.visible = false;
      const flick = Math.sin(r.koT * 40) > 0 ? 1 : 0.4;
      animateCreature(r.built.anim, this.time, 1, dt, { hit: 0.35 * flick, dim: 1.6 * flick, freq: 20 });
      r.trailT -= dt;
      if (r.trailT <= 0) {
        r.trailT = 0.012;
        this.fx.puff(new THREE.Vector3(r.pos.x + rnd(-0.2, 0.2), r.y + 0.8, r.pos.z + rnd(-0.2, 0.2)), r.glow, 0.5, 1.1);
      }
      if (r.y > 32 || r.koT > 3) {
        r.burst = true;
        this.fx.skyBurst(new THREE.Vector3(r.pos.x, r.y + 1, r.pos.z), r.glow, this.camera);
        r.group.visible = false;
      }
    } else if (r.koT > 3.6) {
      this.respawn(r);
    }
  }

  respawn(r) {
    const i = wrap(r.idx - 6);
    const { pts, tan } = this.track;
    r.ko = false;
    r.pos.copy(pts[i]);
    r.idx = i;
    r.y = 3;
    r.vy = 0;
    r.heading = Math.atan2(tan[i].x, tan[i].z);
    r.speed = 8;
    r.lat = 0;
    r.kb.set(0, 0, 0);
    r.hp = r.maxHp;
    r.invulnT = 2;
    r.spinT = 0;
    r.spinVis = 0;
    r.built.root.rotation.set(0, r.heading, 0);
    r.group.visible = true;
    this.fx.ring(r.pos, 3, r.glow, 0.5, 1);
    this.fx.flash(new THREE.Vector3(r.pos.x, 2, r.pos.z), r.glow, 1.4, 0.3);
    if (r.isPlayer) this.banner('BACK IN THE RACE');
  }

  // ------------------------------------------------------------ items

  rollItem(r) {
    const n = this.racers.length;
    const f = n > 1 ? (r.place - 1) / (n - 1) : 0;
    const entries = Object.entries(RACE_ITEMS).map(([id, it]) => [id, it.weight(f)]).filter(([, w]) => w > 0);
    let x = Math.random() * entries.reduce((s, [, w]) => s + w, 0);
    for (const [id, w] of entries) if ((x -= w) <= 0) return id;
    return entries[0][0];
  }

  useItem(r) {
    const id = r.items.splice(r.sel, 1)[0];
    r.sel = Math.min(r.sel, Math.max(0, r.items.length - 1));
    const it = RACE_ITEMS[id];
    const fwd = new THREE.Vector3(Math.sin(r.heading), 0, Math.cos(r.heading));
    const at = new THREE.Vector3(r.pos.x, r.y + 1.2, r.pos.z);
    if (r.isPlayer) this.floatText(r.pos, it.name.toUpperCase(), `#${new THREE.Color(it.color).getHexString()}`, 2.8);
    switch (id) {
      case 'volley': {
        const target = this.racerAhead(r) || this.lockFor(r, 80);
        for (let k = 0; k < 3; k++) {
          setTimeout(() => {
            if (r.ko || this.destroyed) return;
            const from = this.muzzleOf(r);
            const d = fwd.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), (k - 1) * 0.25).setY(0.15);
            this.shoot(r, from, d.normalize().multiplyScalar(42).addScaledVector(fwd, Math.max(0, r.speed)), { dmg: 12, target, seek: target ? 14 : 0, life: 4, color: it.color, size: 0.14, spin: 0.6, slow: 0.7, push: 6 });
          }, k * 120);
        }
        break;
      }
      case 'mine': {
        const pos = r.pos.clone().addScaledVector(fwd, -2.6).setY(0);
        const mesh = new THREE.Group();
        const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.55, 0), new THREE.MeshPhysicalMaterial({ color: 0x1c1e24, metalness: 0.8, roughness: 0.3, emissive: it.color, emissiveIntensity: 0.4 }));
        core.position.y = 0.6;
        const halo = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.05, 6, 28), glowMat(it.color, 2.5));
        halo.rotation.x = Math.PI / 2;
        halo.position.y = 0.2;
        mesh.add(core, halo);
        mesh.position.copy(pos);
        this.scene.add(mesh);
        this.mines.push({ pos, mesh, core, halo, owner: r, armT: 0.6, life: 45 });
        if (this.mines.length > 14) this.detonate(this.mines[0], null);
        break;
      }
      case 'decoy': {
        // looks like an item pod, tinted a little hot
        const pos = r.pos.clone().addScaledVector(fwd, -2.8).setY(0);
        const mesh = new THREE.Group();
        const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.75, 0), new THREE.MeshPhysicalMaterial({ color: 0xffc8a0, emissive: it.color, emissiveIntensity: 1.2, roughness: 0.1, transparent: true, opacity: 0.9, clearcoat: 1 }));
        core.position.y = 1.3;
        const halo = new THREE.Mesh(new THREE.TorusGeometry(1, 0.05, 6, 32), glowMat(it.color, 2));
        halo.rotation.x = Math.PI / 2;
        halo.position.y = 1.3;
        mesh.add(core, halo);
        mesh.position.copy(pos);
        this.scene.add(mesh);
        this.mines.push({ pos, mesh, core, halo, owner: r, armT: 0.6, life: 45, decoy: true });
        if (this.mines.length > 14) this.detonate(this.mines[0], null);
        break;
      }
      case 'shockwave':
        this.fx.ring(r.pos, 9, it.color, 0.5, 0.2);
        this.fx.flash(at, it.color, 3, 0.3);
        this.fx.sparks(at, it.color, 24, 14);
        for (const o of this.racers) {
          if (o === r || o.ko || flatDist(o.pos, r.pos) > 9) continue;
          const away = new THREE.Vector3(o.pos.x - r.pos.x, 0, o.pos.z - r.pos.z).normalize();
          this.hurt(o, 12, r, { spin: 0.9, kb: away.multiplyScalar(18), launch: 5 });
        }
        if (flatDist(r.pos, this.player.pos) < 20) this.shake = Math.max(this.shake, 0.4);
        break;
      case 'overdrive':
        r.boostT = Math.max(r.boostT, 2.6);
        r.rampT = 2.6; // plough through anyone in the way
        this.fx.flash(at, it.color, 1.6, 0.25);
        break;
      case 'shield':
        r.shieldT = 7;
        this.fx.ring(r.pos, 2.2, it.color, 0.4, 0.8);
        break;
      case 'tether': {
        const target = this.racerAhead(r) || this.lockFor(r, 90);
        if (!target || flatDist(target.pos, r.pos) > 90) {
          r.boostT = Math.max(r.boostT, 2);
          break;
        }
        r.tether = { target, t: 0 };
        break;
      }
      case 'riftjump': {
        this.portal(r.pos, r.heading, it.color);
        let i = r.idx;
        for (let k = 0; k < 85; k++) {
          const next = wrap(i + 1);
          this.moveIdx(r, next);
          i = next;
        }
        const { pts, tan, right } = this.track;
        r.pos.copy(pts[i]).addScaledVector(right[i], clamp(this.latOf(r.pos, i), -3, 3));
        r.heading = Math.atan2(tan[i].x, tan[i].z);
        r.kb.set(0, 0, 0);
        r.lat = 0;
        r.invulnT = Math.max(r.invulnT, 0.8);
        r.boostT = Math.max(r.boostT, 1);
        this.portal(r.pos, r.heading, it.color);
        if (r.isPlayer) this.shake = Math.max(this.shake, 0.35);
        break;
      }
      case 'storm': {
        const victims = this.racers.filter((o) => o.place < r.place && !o.ko);
        for (const v of victims) {
          const marker = new THREE.Mesh(new THREE.RingGeometry(1.3, 1.6, 40), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff3b4e).multiplyScalar(2), transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false, toneMapped: false }));
          marker.rotation.x = -Math.PI / 2;
          this.scene.add(marker);
          this.strikes.push({ target: v, t: 0.9, marker, src: r });
          if (v.isPlayer) this.banner('ION STORM INCOMING', 'warn');
        }
        if (r.isPlayer) this.banner(`ION STORM · ${victims.length} TARGETS`);
        break;
      }
    }
  }

  portal(pos, heading, color) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(2, 0.15, 8, 48), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(2.5), transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    ring.position.set(pos.x, 1.6, pos.z);
    ring.rotation.y = heading;
    this.fx.add(ring, null, 0.7, { grow: 0.8, shared: false });
    this.fx.flash(new THREE.Vector3(pos.x, 1.6, pos.z), color, 1.8, 0.35);
    this.fx.sparks(new THREE.Vector3(pos.x, 1.6, pos.z), color, 20, 10);
  }

  updateTether(r, dt) {
    const tg = r.tether.target;
    r.tether.t += dt;
    const to = new THREE.Vector3(tg.pos.x - r.pos.x, 0, tg.pos.z - r.pos.z);
    const d = to.length();
    if (tg.ko || r.tether.t > 1.8) {
      r.tether = null;
      return;
    }
    const from = this.muzzleOf(r);
    this.fx.beam(from, new THREE.Vector3(tg.pos.x, tg.y + 1, tg.pos.z), 0xf2f6ff, 0.05, 0.05);
    if (d < 2.4) {
      r.tether = null;
      this.hurt(tg, 15, r, { spin: 1, slow: 0.5, kb: to.normalize().multiplyScalar(8) });
      r.boostT = Math.max(r.boostT, 1.3);
      r.speed = Math.max(r.speed, r.maxSpeed);
      this.fx.flash(new THREE.Vector3(tg.pos.x, 1, tg.pos.z), 0xffffff, 1.5, 0.25);
      if (r.isPlayer || tg.isPlayer) this.shake = Math.max(this.shake, 0.45);
      return;
    }
    to.normalize();
    r.pos.addScaledVector(to, 60 * dt);
    r.heading += wrapAng(Math.atan2(to.x, to.z) - r.heading) * Math.min(1, dt * 10);
    r.y = Math.max(0, r.y + (1.2 - r.y) * dt * 6);
    r.vel.copy(to).multiplyScalar(60);
    this.updateIdx(r);
    this.clampToTrack(r, dt);
    this.syncRacer(r, dt);
  }

  updatePods(dt) {
    for (const p of this.pods) {
      if (!p.active) {
        p.t -= dt;
        if (p.t <= 0) {
          p.active = true;
          p.mesh.visible = true;
        }
        continue;
      }
      p.mesh.rotation.y += dt * 2;
      p.mesh.position.y = 1.3 + Math.sin(this.time * 3 + p.phase) * 0.2;
      const r = this.racers.find((o) => !o.ko && flatDist(o.pos, p.pos) < 1.9 && o.y < 3);
      if (!r) continue;
      p.active = false;
      p.t = 3;
      p.mesh.visible = false;
      this.fx.flash(p.mesh.position, 0x38e1ff, 1, 0.2);
      this.fx.sparks(p.mesh.position, 0x9fd8ff, 10, 8);
      if (r.items.length < 2 && r.rolling <= 0) r.rolling = r.isPlayer ? 0.9 : 0.6;
    }
  }

  updateMines(dt) {
    this.mines = this.mines.filter((m) => {
      m.armT -= dt;
      m.life -= dt;
      m.core.rotation.y += dt * (m.decoy ? 2 : 3);
      if (m.decoy) m.core.position.y = 1.3 + Math.sin(this.time * 3) * 0.2;
      m.halo.scale.setScalar(1 + Math.sin(this.time * 8) * 0.15);
      if (m.life <= 0) return this.removeMine(m);
      if (m.armT > 0) return true;
      const hit = this.racers.find((r) => !r.ko && r.y < (m.decoy ? 3 : 1.5) && flatDist(r.pos, m.pos) < 1.9);
      if (!hit) return true;
      this.detonate(m, hit);
      return false;
    });
  }

  detonate(m, victim) {
    const at = new THREE.Vector3(m.pos.x, 0.8, m.pos.z);
    this.fx.flash(at, 0xff3b4e, 2.4, 0.3);
    this.fx.ring(m.pos, 4, 0xff3b4e);
    this.fx.sparks(at, 0xffb020, 22, 12);
    if (victim) this.hurt(victim, 18, m.owner, { spin: 1.2, slow: 0.3, launch: 10 });
    if (flatDist(m.pos, this.player.pos) < 20) this.shake = Math.max(this.shake, 0.45);
    this.removeMine(m);
    this.mines = this.mines.filter((x) => x !== m);
  }

  removeMine(m) {
    this.scene.remove(m.mesh);
    m.mesh.traverse((o) => {
      if (!o.isMesh) return;
      o.geometry.dispose();
      o.material.dispose();
    });
    return false;
  }

  updateStrikes(dt) {
    this.strikes = this.strikes.filter((s) => {
      s.t -= dt;
      const v = s.target;
      s.marker.position.set(v.pos.x, 0.1, v.pos.z);
      s.marker.scale.setScalar(0.6 + s.t);
      if (s.t > 0 && !v.ko) return true;
      if (!v.ko) {
        const to = new THREE.Vector3(v.pos.x, v.y + 1, v.pos.z);
        this.fx.lightning(to.clone().setY(45), to, 0x9fd8ff, 0.12, 0.3);
        this.fx.flash(to, 0x9fd8ff, 2.5, 0.3);
        this.fx.ring(v.pos, 3, 0x9fd8ff);
        this.hurt(v, 22, s.src, { spin: 1.1, slow: 0.4 });
        if (flatDist(v.pos, this.player.pos) < 25) this.shake = Math.max(this.shake, 0.35);
      }
      this.scene.remove(s.marker);
      s.marker.geometry.dispose();
      s.marker.material.dispose();
      return false;
    });
  }

  updateHazards(dt) {
    for (const v of this.vents) {
      v.t += dt;
      const ph = v.t % v.period;
      const state = ph < v.period - 1.6 ? 'idle' : ph < v.period - 0.5 ? 'warn' : 'erupt';
      if (state === 'erupt' && v.state !== 'erupt') {
        for (const r of this.racers) if (!r.ko && flatDist(r.pos, v.pos) < v.radius) this.hurt(r, 10, null, { spin: 0.9, launch: 13, slow: 0.6 });
      }
      v.state = state;
      v.core.material.emissiveIntensity = state === 'erupt' ? 4 : state === 'warn' ? 1.5 + Math.sin(this.time * 25) : 0.6;
      v.col.material.opacity = state === 'erupt' ? 0.5 : 0;
      v.col.scale.y = state === 'erupt' ? 1 + Math.sin(this.time * 30) * 0.05 : 0.1;
    }
    const sw = this.sweeper;
    sw.angle += sw.speed * dt;
    sw.mesh.rotation.y = sw.angle;
    const dir = new THREE.Vector3(Math.cos(sw.angle), 0, -Math.sin(sw.angle));
    for (const r of this.racers) {
      if (r.ko || r.y > 1.6 || r.sweepCd > 0) continue;
      const rel = new THREE.Vector3(r.pos.x - sw.pos.x, 0, r.pos.z - sw.pos.z);
      const along = clamp(rel.dot(dir), -sw.len / 2, sw.len / 2);
      const perp = rel.clone().addScaledVector(dir, -along);
      if (perp.length() > 1.3) continue;
      r.sweepCd = 1;
      const push = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(Math.sign(along) * sw.speed * 14 + Math.sign(perp.dot(new THREE.Vector3(-dir.z, 0, dir.x))) * 6);
      this.hurt(r, 8, null, { spin: 1, kb: push, launch: 4, slow: 0.5 });
      this.fx.sparks(new THREE.Vector3(r.pos.x, 1.2, r.pos.z), 0xff3b4e, 14, 10);
    }
  }

  // ------------------------------------------------------------ camera & HUD

  updateCamera(dt) {
    const p = this.player;
    const fwd = new THREE.Vector3(Math.sin(this.camYaw), 0, Math.cos(this.camYaw));
    let want;
    let look;
    if (this.phase === 'intro') {
      // sweeping flyover that settles behind your creature
      const k = this.phaseT / INTRO;
      const a = p.heading + Math.PI * (1.3 - k * 1.3);
      const d = 26 - k * 16;
      want = new THREE.Vector3(p.pos.x + Math.sin(a) * d, 12 - k * 8, p.pos.z + Math.cos(a) * d);
      look = new THREE.Vector3(p.pos.x, 1.5, p.pos.z);
      this.camera.position.lerp(want, 1 - Math.exp(-4 * dt));
      this.camYaw = p.heading;
    } else if (p.ko && !p.burst) {
      look = new THREE.Vector3(p.pos.x, p.y + 1, p.pos.z);
    } else {
      if (this.settings.raceCamera !== 'mouse') {
        // follow the track: aim along the road a little ahead, so holding W rides the curves.
        // After a spin-out it keeps pointing down the road, so holding W turns you back around.
        const { tan } = this.track;
        const ahead = new THREE.Vector3();
        for (let k = 4; k <= 28; k += 4) ahead.add(tan[wrap(p.idx + k + Math.round(Math.abs(p.speed) * 0.25))]);
        const roadYaw = Math.atan2(ahead.x, ahead.z);
        this.camYaw += wrapAng(roadYaw - this.camYaw) * (1 - Math.exp(-4.5 * dt));
      }
      // after you let go of right-drag, the camera eases back behind you
      this.orbitIdleT += dt;
      if (this.orbitX == null && this.orbitIdleT > 0.8) this.camOrbit *= Math.exp(-2 * dt);
      fwd.set(Math.sin(this.camYaw + this.camOrbit), 0, Math.cos(this.camYaw + this.camOrbit));
      const dist = 8.5 + clamp(p.speed / p.maxSpeed, 0, 1.5) * 1.5;
      want = new THREE.Vector3(p.pos.x, p.y * 0.6 + 3.6, p.pos.z).addScaledVector(fwd, -dist);
      look = new THREE.Vector3(p.pos.x, p.y * 0.8 + 1.3, p.pos.z).addScaledVector(fwd, 6);
      this.camera.position.lerp(want, 1 - Math.exp(-10 * dt));
      if (this.killCam) {
        const kc = this.killCam;
        kc.t += dt;
        const w = Math.sin(Math.min(1, kc.t / 1.8) * Math.PI) * 0.6;
        if (kc.t > 1.8) this.killCam = null;
        else look.lerp(new THREE.Vector3(kc.r.pos.x, kc.r.y + 1, kc.r.pos.z), w);
      }
    }
    this.camera.lookAt(look);
    const speedFrac = clamp(Math.abs(p.speed) / p.maxSpeed, 0, 1.5);
    const fov = 62 + speedFrac * 12 + (p.boostT > 0 ? 8 : 0);
    this.camera.fov += (fov - this.camera.fov) * (1 - Math.exp(-5 * dt));
    this.camera.updateProjectionMatrix();
    if (this.shake > 0.001) {
      const k = this.shake * this.shake * 0.6;
      this.camera.position.add(new THREE.Vector3(rnd(-k, k), rnd(-k, k), rnd(-k, k)));
      this.shake *= Math.exp(-7 * dt);
    }
    this.sun.position.set(p.pos.x - 30, 60, p.pos.z - 15);
    this.sun.target.position.set(p.pos.x, 0, p.pos.z);
  }

  countdown(text, cls = '') {
    const el = h('div', { class: `rr-count ${cls}` }, text);
    this.hud.center.replaceChildren(el);
    setTimeout(() => el.remove(), 900);
  }

  banner(text, cls = '') {
    const el = h('div', { class: `rr-bannertext ${cls}` }, text);
    this.hud.banner.replaceChildren(el);
    setTimeout(() => el.remove(), 2200);
  }

  feed(text, team) {
    const row = h('div', { class: `feed-row ${team || ''}` }, text);
    this.hud.feed.prepend(row);
    while (this.hud.feed.childElementCount > 5) this.hud.feed.lastChild.remove();
    setTimeout(() => row.remove(), 7000);
  }

  floatText(pos, text, color, lift = 2.2, cls = '') {
    if (this.floaters.length > 40) return;
    const el = h('div', { class: `floater ${cls}`, style: { color } }, String(text));
    this.hud.floaters.append(el);
    this.floaters.push({ el, pos: new THREE.Vector3(pos.x, lift, pos.z), t: 0, life: cls === 'big' ? 1.8 : 0.9, rise: cls === 'big' ? 0.8 : 2 });
  }

  updateHud(dt) {
    const p = this.player;
    const n = this.racers.length;
    this.hud.place.textContent = ordinal(p.place).toUpperCase();
    this.hud.place.nextSibling.textContent = `/ ${n}`;
    this.hud.lap.textContent = `LAP ${clamp(p.lapsDone + 1, 1, this.laps)} / ${this.laps}`;
    this.hud.time.textContent = fmtRaceTime(p.finished ? p.finishTime : this.raceTime);
    this.hud.speed.textContent = Math.round(Math.abs(p.speed) * 3.6);
    this.hud.speed.parentElement.classList.toggle('boost', p.boostT > 0);
    this.root.classList.toggle('boosting', p.boostT > 0 && !p.ko);
    this.hud.hp.style.width = `${(Math.max(0, p.hp) / p.maxHp) * 100}%`;
    this.hud.hpText.textContent = p.ko ? 'KNOCKED OUT' : `${Math.ceil(p.hp)} / ${p.maxHp}`;
    const tier = p.driftCharge > 2.2 ? 3 : p.driftCharge > 1.3 ? 2 : p.driftCharge > 0.6 ? 1 : 0;
    this.hud.drift.style.width = p.drifting ? `${clamp(p.driftCharge / 2.2, 0, 1) * 100}%` : '0%';
    this.hud.drift.dataset.tier = tier;
    // item box with a short roulette
    // two item slots: E uses the highlighted one, R or the scroll wheel swaps
    const color = (id) => `#${new THREE.Color(RACE_ITEMS[id].color).getHexString()}`;
    const ids = Object.keys(RACE_ITEMS);
    this.hud.slots.forEach((el, i) => {
      const id = p.items[i];
      const rollingHere = p.rolling > 0 && i === p.items.length;
      const show = rollingHere ? ids[Math.floor(this.time * 14) % ids.length] : id;
      el.textContent = show ? RACE_ITEMS[show].key : '';
      el.style.color = show ? color(show) : '';
      el.className = `rr-item ${i === p.sel && id ? 'sel' : ''} ${rollingHere ? 'rolling' : id ? 'ready' : ''}`;
    });
    const cur = p.items[p.sel];
    this.hud.itemName.textContent = cur ? `${RACE_ITEMS[cur].name} · E use${p.items.length > 1 ? ' · R swap' : ''}` : p.rolling > 0 ? '···' : 'Drive through a pod';
    if (this.hud.itemBox.classList.contains('swapped')) setTimeout(() => this.hud.itemBox.classList.remove('swapped'), 150);
    this.standT = (this.standT || 0) - dt;
    if (this.standT <= 0 && this.order) {
      this.standT = 0.25;
      this.hud.standings.replaceChildren(...this.order.map((r) => h('div', { class: `rr-row ${r.isPlayer ? 'me' : ''} ${r.ko ? 'ko' : ''}` },
        h('b', {}, r.place), h('span', {}, r.isPlayer ? `${r.name} (you)` : r.name), r.finished ? h('small', {}, fmtRaceTime(r.finishTime)) : r.ko ? h('small', {}, 'KO') : null)));
    }
    for (const a of this.abilityEls) {
      const [left, total] = a.get();
      a.cd.style.height = `${(left / total) * 100}%`;
    }
    this.hud.wrong.hidden = !(p.wrongT > 1 && this.phase === 'race');

    const w = this.renderer.domElement.clientWidth;
    const hgt = this.renderer.domElement.clientHeight;
    const lock = !p.ko && this.phase !== 'intro' ? this.lockFor(p, p.st.weapon.range * 1.6) : null;
    this.hud.lock.hidden = !lock;
    if (lock) {
      const v = new THREE.Vector3(lock.pos.x, lock.y + lock.built.height * 0.55, lock.pos.z).project(this.camera);
      const size = clamp(900 / Math.max(4, this.camera.position.distanceTo(lock.pos)), 32, 110);
      this.hud.lock.style.transform = `translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * hgt}px) translate(-50%, -50%)`;
      this.hud.lock.style.width = this.hud.lock.style.height = `${size}px`;
    }
    this.hitMarkT = Math.max(0, this.hitMarkT - dt);
    this.killMarkT = Math.max(0, (this.killMarkT || 0) - dt);
    this.hud.crosshair.classList.toggle('hit', this.hitMarkT > 0);
    this.hud.crosshair.classList.toggle('kill', this.killMarkT > 0);
    this.hud.lock.classList.toggle('hit', this.hitMarkT > 0);

    this.floaters = this.floaters.filter((f) => {
      f.t += dt;
      const v = f.pos.clone();
      v.y += f.t * f.rise;
      v.project(this.camera);
      f.el.style.transform = `translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * hgt}px) translate(-50%, -50%)`;
      f.el.style.opacity = String(Math.min(1, 2 * (1 - f.t / f.life)));
      f.el.style.visibility = v.z > 1 ? 'hidden' : 'visible';
      if (f.t < f.life) return true;
      f.el.remove();
      return false;
    });
    this.drawMinimap();
  }

  drawMinimap() {
    const cv = this.minimap;
    const g = cv.getContext('2d');
    const { pts, box } = this.track;
    const pad = 14;
    const sx = (cv.width - pad * 2) / (box.max.x - box.min.x);
    const sz = (cv.height - pad * 2) / (box.max.z - box.min.z);
    const s = Math.min(sx, sz);
    const ox = (cv.width - (box.max.x - box.min.x) * s) / 2;
    const oz = (cv.height - (box.max.z - box.min.z) * s) / 2;
    const X = (x) => ox + (box.max.x - x) * s;
    const Z = (z) => oz + (box.max.z - z) * s;
    g.clearRect(0, 0, cv.width, cv.height);
    g.fillStyle = 'rgba(8,10,14,0.8)';
    g.fillRect(0, 0, cv.width, cv.height);
    g.lineJoin = 'round';
    g.strokeStyle = 'rgba(180,200,230,0.3)';
    g.lineWidth = 7;
    g.beginPath();
    pts.forEach((p, i) => (i ? g.lineTo(X(p.x), Z(p.z)) : g.moveTo(X(p.x), Z(p.z))));
    g.closePath();
    g.stroke();
    g.fillStyle = '#fff';
    g.fillRect(X(pts[0].x) - 4, Z(pts[0].z) - 1.5, 8, 3);
    for (const m of this.mines) {
      g.fillStyle = '#ff3b4e';
      g.fillRect(X(m.pos.x) - 1.5, Z(m.pos.z) - 1.5, 3, 3);
    }
    for (const r of [...this.racers].sort((a) => (a.isPlayer ? 1 : -1))) {
      g.fillStyle = r.isPlayer ? '#ffffff' : `#${new THREE.Color(r.glow).getHexString()}`;
      g.globalAlpha = r.ko ? 0.35 : 1;
      g.beginPath();
      g.arc(X(r.pos.x), Z(r.pos.z), r.isPlayer ? 5 : 3.5, 0, Math.PI * 2);
      g.fill();
      if (r.isPlayer) {
        g.strokeStyle = '#000';
        g.lineWidth = 1.5;
        g.stroke();
      }
      g.globalAlpha = 1;
    }
  }

  // ------------------------------------------------------------ results

  endRace() {
    if (this.phase === 'done' || this.destroyed) return;
    this.updatePlaces();
    this.phase = 'done';
    const p = this.player;
    const n = this.racers.length;
    const place = p.place;
    const xp = RACE_XP.finish + (n - place) * RACE_XP.perRivalBeaten + (place === 1 ? RACE_XP.win : 0) + p.kos * RACE_XP.ko;
    this.onFinish?.({
      place, racers: n, xp, kos: p.kos, time: p.finishTime, bestLap: p.bestLap, biome: this.biome.name, laps: this.laps,
      standings: this.order.map((r) => ({ name: r.name, isPlayer: r.isPlayer, place: r.place, time: r.finishTime, kos: r.kos, bestLap: r.bestLap })),
    });
  }

  destroy() {
    this.destroyed = true;
    if (devConsole.race === this) devConsole.race = null;
    cancelAnimationFrame(this.raf);
    removeEventListener('resize', this.resize);
    removeEventListener('keydown', this.onKeyDown);
    removeEventListener('keyup', this.onKeyUp);
    removeEventListener('mousedown', this.onMouseDown);
    removeEventListener('mouseup', this.onMouseUp);
    removeEventListener('mousemove', this.onMouseMove);
    removeEventListener('contextmenu', this.onContext);
    removeEventListener('blur', this.onBlur);
    removeEventListener('wheel', this.onWheel);
    document.removeEventListener('pointerlockchange', this.onLockChange);
    this.releaseLock();
    this.fx.dispose();
    for (const r of this.racers) disposeMesh(r.built.root);
    this.scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => {
        for (const k of ['map', 'bumpMap', 'emissiveMap']) m[k]?.dispose();
        m.dispose();
      });
    });
    this.scene.environment?.dispose();
    this.scene.background?.dispose?.();
    this.composer?.dispose?.();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.root.remove();
  }
}

function lifted(mesh, y) {
  mesh.position.y = y;
  return mesh;
}
