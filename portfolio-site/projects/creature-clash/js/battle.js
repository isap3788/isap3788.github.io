// Battle engine: randomized mirrored three-lane map, nests, bots, combat, permadeath, Test Drive.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import {
  BIOMES, BOT_NAMES, BATTLE_SECONDS, DOWNED_SECONDS, PART_DROP_CHANCE, XP_REWARD, MUTATIONS, PART_MUTATION, PART_BY_ID, SPECIALS, DEATH_CAPTIONS,
} from './data.js';
import { computeStats, buildCreatureMesh, animateCreature, disposeMesh, randomBuild, partsOf } from './creature.js';
import { setupLookdev, surfaceTexture } from './render.js';
import { getSettings, setSetting } from './settings.js';
import { getProfile, grantKillDNA, obtainDrop } from './profile.js';
import { devConsole } from './devconsole.js';
import { h, fmtTime } from './ui.js';
import { creatureThumb } from './thumbs.js';

const TEAM_COLOR = { blue: 0x38c8ff, red: 0xff4060 };
const TEAM_LABEL = { blue: 'Blue', red: 'Red' };
const ENEMY = { blue: 'red', red: 'blue' };
const LANE_NAMES = ['Left', 'Mid', 'Right'];
const NEST = {
  lane: { hp: 420, radius: 1.9, range: 9, dmg: 8, cd: 1.3 },
  main: { hp: 1200, radius: 3.6, range: 11, dmg: 12, cd: 1.1 },
};
const GLUMP_HP = 45;
const BOSS_HP = 1100;

const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const dist2 = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const angTo = (a, b) => Math.atan2(b.x - a.x, b.z - a.z);
const angDiff = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
const lifted = (mesh, y) => (mesh.position.y = y, mesh);
const wrapAng = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const glowMat = (color, intensity = 2) => new THREE.MeshStandardMaterial({ color: 0x000000, emissive: color, emissiveIntensity: intensity });


export class Battle {
  constructor({ container, mode = 'match', playerCreature, allies = [], enemies = [], onPlayerDeath, onEnd, onExit }) {
    this.mode = mode;
    this.container = container;
    this.onPlayerDeath = onPlayerDeath;
    this.onEnd = onEnd;
    this.onExit = onExit;
    this.time = 0;
    this.timeLeft = BATTLE_SECONDS;
    this.timeScale = 1;
    this.slowmo = 0;
    this.paused = false;
    this.ended = false;
    this.creatures = [];
    this.nests = [];
    this.projectiles = [];
    this.neutrals = [];
    this.pickups = [];
    this.hazards = [];
    this.clouds = [];
    this.fx = [];
    this.floaters = [];
    this.deaths = { blue: 0, red: 0 };
    this.teamBuff = { blue: 0, red: 0 };
    this.rewards = { dna: 0, drops: [], committed: false };
    this.keys = new Set();
    this.tapped = new Set();
    this.mouse = { x: 0, y: 0, ground: new THREE.Vector3(), buttons: new Set() };
    this.settings = getSettings();
    this.cam = { yaw: 0, pitch: 0.42, dist: 9, locked: false };
    this.lastCombatT = -10;
    this.particles = [];
    this.shake = 0;
    this.hitMarkT = 0;
    this.spectating = null;

    this.biome = pick(BIOMES);
    this.W = mode === 'match' ? 48 : 22;
    this.L = mode === 'match' ? 60 : 22;

    this.setupRenderer();
    this.setupHud();
    if (mode === 'match') this.generateMap();
    else this.generateTestDrive();

    this.player = this.spawnCreature(playerCreature, 'blue', { isPlayer: true });
    if (mode === 'match') {
      allies.forEach((c, i) => this.spawnCreature(c, 'blue', { lane: [0, 2, 1, 0][i % 4] }));
      enemies.forEach((c, i) => this.spawnCreature(c, 'red', { lane: [1, 0, 2, 1][i % 4] }));
    }
    this.camTarget = this.player.pos.clone();
    this.cam.yaw = this.player.face;
    this.applyCameraMode();
    this.bindInput();
    devConsole.battle = this;
    this.last = performance.now();
    this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  // ------------------------------------------------------------ setup

  setupRenderer() {
    this.root = h('div', { class: 'battle' });
    this.container.replaceChildren(this.root);
    const high = this.settings.quality === 'high';
    const r = (this.renderer = new THREE.WebGLRenderer({ antialias: !high, powerPreference: 'high-performance' }));
    r.setPixelRatio(Math.min(high ? 1.5 : 1, devicePixelRatio));
    r.shadowMap.enabled = high;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    this.root.append(r.domElement);
    r.domElement.addEventListener('webglcontextlost', (e) => {
      e.preventDefault(); // lets the browser hand the context back
      if (this.destroyed) return; // destroy() drops the context on purpose
      console.error('Creature Clash: WebGL context lost');
      this.message('The 3D view was lost by the browser. Reload the page, or switch Graphics to Low in the pause menu.');
    });
    this.scene = new THREE.Scene();
    setupLookdev(r, this.scene, { exposure: this.biome.id === 'tundra' ? 0.9 : 1.05 });
    this.scene.background = this.skyTexture();
    this.scene.fog = new THREE.FogExp2(this.biome.fog, 0.0115);
    this.scene.add(new THREE.HemisphereLight(0xdfe8ff, new THREE.Color(this.biome.ground).multiplyScalar(0.6), 0.6));
    const sun = (this.sun = new THREE.DirectionalLight(0xfff2e0, 2.6));
    sun.position.set(-20, 40, -10);
    sun.castShadow = high;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.03;
    Object.assign(sun.shadow.camera, { left: -28, right: 28, top: 28, bottom: -28, near: 1, far: 120 });
    this.scene.add(sun, sun.target);
    const fill = new THREE.DirectionalLight(new THREE.Color(this.biome.accent), 0.5);
    fill.position.set(20, 12, 30);
    this.scene.add(fill);
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 400);
    this.raycaster = new THREE.Raycaster();
    this.groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    if (high) {
      this.composer = new EffectComposer(r, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }));
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(256, 256), 0.55, 0.5, 0.82));
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

  skyTexture() {
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
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  setupHud() {
    const el = (cls, ...kids) => h('div', { class: cls }, ...kids);
    this.hud = {
      timer: el('hud-timer'),
      blueNests: el('hud-nests blue'),
      redNests: el('hud-nests red'),
      biome: el('hud-biome'),
      feed: el('killfeed'),
      center: el('center-msg'),
      hp: el('bar-fill hp'),
      shield: el('bar-fill shield'),
      hpText: el('bar-text'),
      st: el('bar-fill stamina'),
      muts: el('mutations'),
      abilities: el('abilities'),
      downed: el('downed-overlay'),
      spectate: el('spectate-bar'),
      pause: el('pause-menu'),
      floaters: el('floaters'),
    };
    this.minimap = h('canvas', { class: 'minimap', width: 200, height: 250 });
    const isMatch = this.mode === 'match';
    this.root.append(h('div', { class: 'hud' },
      el('hud-top', isMatch && this.hud.blueNests, isMatch ? this.hud.timer : el('hud-timer testdrive', 'TEST DRIVE · no DNA here'), isMatch && this.hud.redNests),
      this.hud.biome,
      this.hud.feed,
      this.minimap,
      this.hud.center,
      this.hud.floaters,
      el('player-panel',
        this.portrait = h('img', { class: 'portrait', alt: '' }),
        el('player-bars',
          this.nameEl = el('player-name'),
          el('bar', this.hud.hp, this.hud.shield, this.hud.hpText),
          el('bar small', this.hud.st),
          this.hud.muts)),
      this.hud.abilities,
      this.crosshair = el('crosshair'),
      this.lockEl = el('target-lock'),
      this.lockHint = el('lock-hint', 'Click to take control of the camera'),
      this.hud.downed,
      this.hud.spectate,
      this.hud.pause,
      this.controlsHint = el('controls-hint'),
    ));
    this.hud.pause.hidden = true;
    this.hud.downed.hidden = true;
    this.hud.spectate.hidden = true;
    this.hud.biome.textContent = this.mode === 'match' ? this.biome.name : `${this.biome.name} · test range`;
  }

  // ---- map

  generateMap() {
    const { W, L, biome } = this;
    this.addGround();
    this.lanes = [];
    for (let i = 0; i < 3; i++) {
      const side = i - 1;
      const xr = (spread) => (side === 0 ? rnd(-spread, spread) : side * 31 + rnd(-spread, spread));
      const half = [[side * 9, -49], [side === 0 ? 0 : side * 26 + rnd(-3, 3), -40], [xr(6), -27], [xr(6), -13], [xr(3), 0]];
      const full = [...half, ...half.slice(0, -1).reverse().map(([x, z]) => [x, -z])];
      const curve = new THREE.CatmullRomCurve3(full.map(([x, z]) => new THREE.Vector3(x, 0, z)));
      const pts = curve.getSpacedPoints(180);
      // enforce exact mirror symmetry after smoothing
      for (let k = 0; k <= 90; k++) {
        const m = pts[180 - k];
        m.set(pts[k].x, 0, -pts[k].z);
      }
      const width = rnd(7, 11);
      this.lanes.push({ pts, width, name: LANE_NAMES[i] });
      this.addLaneStrip(pts, width);
    }

    // nests: 2 per lane per team, mirrored; plus main nests
    for (const [li, lane] of this.lanes.entries()) {
      for (const [slot, z] of [['inner', -36], ['outer', -19]]) {
        const idx = this.closestIdx(lane.pts, z);
        const p = lane.pts[idx];
        this.addNest('blue', 'lane', new THREE.Vector3(p.x, 0, p.z), li, slot, idx);
        this.addNest('red', 'lane', new THREE.Vector3(p.x, 0, -p.z), li, slot, 180 - idx);
      }
    }
    this.addNest('blue', 'main', new THREE.Vector3(0, 0, -L + 6), -1, 'main', 0);
    this.addNest('red', 'main', new THREE.Vector3(0, 0, L - 6), -1, 'main', 180);
    for (const team of ['blue', 'red']) {
      const pad = new THREE.Mesh(new THREE.CircleGeometry(10, 64), new THREE.MeshStandardMaterial({ color: 0x15171c, metalness: 0.7, roughness: 0.4 }));
      pad.rotation.x = -Math.PI / 2;
      pad.position.set(0, 0.02, team === 'blue' ? -L + 7 : L - 7);
      pad.receiveShadow = true;
      const edge = new THREE.Mesh(new THREE.RingGeometry(9.8, 10, 96), glowMat(TEAM_COLOR[team], 1.4));
      edge.rotation.x = -Math.PI / 2;
      edge.position.set(0, 0.03, pad.position.z);
      this.scene.add(pad, edge);
    }

    // wild space content, generated for one half and mirrored
    const wildSpot = (zMin, zMax, clearance) => {
      for (let tries = 0; tries < 60; tries++) {
        const x = rnd(-W + 3, W - 3);
        const z = rnd(zMin, zMax);
        if (this.laneDist(x, z) > clearance && Math.hypot(x - 16, z) > 7) return [x, z];
      }
      return null;
    };
    for (let i = 0; i < 3; i++) {
      const s = wildSpot(-42, -8, 3);
      if (!s) continue;
      const period = rnd(6, 10);
      this.addHazard(s[0], s[1], period);
      this.addHazard(s[0], -s[1], period);
    }
    for (let i = 0; i < 4; i++) {
      const s = wildSpot(-40, -6, 2.5);
      if (!s) continue;
      this.addNeutral('glump', s[0], s[1]);
      this.addNeutral('glump', s[0], -s[1]);
    }
    this.addNeutral('boss', 16, 0);
    for (let i = 0; i < 45; i++) {
      const s = wildSpot(-L + 4, -2, 2);
      if (!s) continue;
      const kind = Math.floor(Math.random() * 3);
      const scale = rnd(0.7, 1.6);
      const rot = rnd(0, Math.PI * 2);
      this.addDecor(s[0], s[1], kind, scale, rot);
      this.addDecor(s[0], -s[1], kind, scale, -rot);
    }
    this.addWalls();
  }

  generateTestDrive() {
    this.addGround();
    this.lanes = [];
    this.addWalls();
    for (const [x, z] of [[-6, 8], [0, 10], [6, 8]]) this.addNeutral('dummy', x, z);
    this.addNeutral('glump', -12, -6);
    this.addHazard(10, -4, 7);
    for (let i = 0; i < 10; i++) {
      const x = rnd(-19, 19);
      const z = rnd(-19, 19);
      if (Math.hypot(x, z) > 7) this.addDecor(x, z, Math.floor(Math.random() * 3), rnd(0.6, 1.2), rnd(0, 6));
    }
    // sample terrain: a ramp-shaped mound to bump around on
    const mound = new THREE.Mesh(new THREE.SphereGeometry(4, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: this.biome.lane, roughness: 0.8 }));
    mound.scale.y = 0.25;
    mound.receiveShadow = true;
    mound.position.set(-10, 0, 10);
    this.scene.add(mound);
  }

  addGround() {
    const { biome } = this;
    const map = surfaceTexture(biome.ground, { noise: 0.18, tile: biome.id === 'neon' ? 4 : 0 });
    const size = Math.max(this.W, this.L) * 2 + 60;
    map.repeat.set(size / 16, size / 16);
    const g = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshStandardMaterial({ map, roughness: biome.id === 'tundra' ? 0.6 : 0.92, metalness: 0.05, envMapIntensity: 0.25 }));
    g.rotation.x = -Math.PI / 2;
    g.receiveShadow = true;
    this.scene.add(g);
  }

  addLaneStrip(pts, width) {
    const pos = [];
    const uv = [];
    const idx = [];
    let along = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[Math.max(0, i - 1)];
      const b = pts[Math.min(pts.length - 1, i + 1)];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const len = Math.hypot(dx, dz) || 1;
      const nx = -dz / len;
      const nz = dx / len;
      if (i) along += pts[i].distanceTo(pts[i - 1]);
      pos.push(pts[i].x + nx * width / 2, 0.03, pts[i].z + nz * width / 2, pts[i].x - nx * width / 2, 0.03, pts[i].z - nz * width / 2);
      uv.push(0, along / width, 1, along / width);
      if (i > 0) {
        const k = i * 2;
        idx.push(k - 2, k - 1, k, k - 1, k + 1, k);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    if (!this.laneMats) {
      const map = surfaceTexture(this.biome.lane, {
        noise: 0.1, tile: 4,
        seams: (g, n) => {
          g.fillStyle = 'rgba(0,0,0,0.45)';
          g.fillRect(0, 0, n * 0.04, n);
          g.fillRect(n * 0.96, 0, n * 0.04, n);
        },
      });
      const emissiveMap = surfaceTexture('#000000', {
        noise: 0,
        seams: (g, n) => {
          g.fillStyle = '#fff';
          g.fillRect(n * 0.045, 0, n * 0.012, n);
          g.fillRect(n * 0.943, 0, n * 0.012, n);
          g.fillRect(n * 0.49, n * 0.1, n * 0.02, n * 0.3);
        },
      });
      this.laneMats = new THREE.MeshStandardMaterial({
        map, emissiveMap, emissive: this.biome.accent, emissiveIntensity: 1.1, roughness: 0.6, metalness: 0.4, envMapIntensity: 0.35, side: THREE.DoubleSide,
        polygonOffset: true, polygonOffsetFactor: -1,
      });
    }
    const m = new THREE.Mesh(geo, this.laneMats);
    m.receiveShadow = true;
    this.scene.add(m);
  }

  addWalls() {
    const mat = new THREE.MeshStandardMaterial({ color: 0x1a1c22, roughness: 0.4, metalness: 0.8 });
    const strip = glowMat(this.biome.accent, 1.6);
    const { W, L } = this;
    for (const [x, z, w, d] of [[0, -L - 0.5, W * 2 + 2, 1], [0, L + 0.5, W * 2 + 2, 1], [-W - 0.5, 0, 1, L * 2], [W + 0.5, 0, 1, L * 2]]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, 1.4, d), mat);
      m.position.set(x, 0.7, z);
      m.castShadow = m.receiveShadow = true;
      const s = new THREE.Mesh(new THREE.BoxGeometry(w + 0.02, 0.06, d + 0.02), strip);
      s.position.set(x, 1.2, z);
      this.scene.add(m, s);
    }
  }

  addDecor(x, z, kind, scale, rot) {
    const b = this.biome.id;
    const g = new THREE.Group();
    const M = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.85, ...o });
    const rock = (r, color) => {
      const geo = new THREE.DodecahedronGeometry(r, 1);
      const p = geo.attributes.position;
      for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) * rnd(0.8, 1.15), p.getY(i) * rnd(0.6, 1), p.getZ(i) * rnd(0.8, 1.15));
      geo.computeVertexNormals();
      return lifted(new THREE.Mesh(geo, M(color, { flatShading: true })), r * 0.4);
    };
    const accent = this.biome.accent;
    if (b === 'volcanic') {
      if (kind === 0) {
        for (let i = 0; i < 5; i++) {
          const hgt = rnd(1, 3.2);
          const col = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.42, hgt, 6), M(0x241e1c, { flatShading: true }));
          col.position.set(rnd(-0.7, 0.7), hgt / 2, rnd(-0.7, 0.7));
          g.add(col);
        }
      } else if (kind === 1) {
        g.add(rock(1.2, 0x2e2624));
        const crack = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.05, 1.8), glowMat(0xff5a1f, 2.2));
        crack.position.set(0.9, 0.03, 0);
        crack.rotation.y = 0.4;
        g.add(crack);
      } else {
        const p = new THREE.Mesh(new THREE.CircleGeometry(1.3, 20), glowMat(0xff4a10, 1.6));
        p.rotation.x = -Math.PI / 2;
        p.position.y = 0.04;
        g.add(p, rock(0.5, 0x1e1a18));
      }
    } else if (b === 'swamp') {
      if (kind === 0) {
        const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.24, 1.6, 10), M(0x3a4038));
        stem.position.y = 0.8;
        const cap = new THREE.Mesh(new THREE.SphereGeometry(0.9, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2), M(0x2a3a30, { roughness: 0.5 }));
        cap.scale.y = 0.45;
        cap.position.y = 1.55;
        const gills = new THREE.Mesh(new THREE.CircleGeometry(0.85, 20), glowMat(accent, 1.4));
        gills.rotation.x = Math.PI / 2;
        gills.position.y = 1.54;
        g.add(stem, cap, gills);
      } else if (kind === 1) {
        for (let i = 0; i < 6; i++) {
          const hgt = rnd(1.4, 2.6);
          const r = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.06, hgt, 5), M(0x2f3a28));
          r.position.set(rnd(-0.5, 0.5), hgt / 2, rnd(-0.5, 0.5));
          r.rotation.z = rnd(-0.2, 0.2);
          g.add(r);
        }
        const tip = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), glowMat(accent, 2));
        tip.position.set(0, 2.4, 0);
        g.add(tip);
      } else {
        const p = new THREE.Mesh(new THREE.CircleGeometry(1.7, 24), new THREE.MeshStandardMaterial({ color: 0x0c1a10, roughness: 0.05, metalness: 0.6, emissive: accent, emissiveIntensity: 0.12 }));
        p.rotation.x = -Math.PI / 2;
        p.position.y = 0.04;
        g.add(p);
      }
    } else if (b === 'tundra') {
      if (kind === 0) {
        for (let i = 0; i < 4; i++) {
          const c = new THREE.Mesh(new THREE.OctahedronGeometry(0.55), new THREE.MeshPhysicalMaterial({ color: 0xbfe8ff, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.85, clearcoat: 1, emissive: 0x2a6a90, emissiveIntensity: 0.25 }));
          c.scale.y = rnd(1.8, 3);
          c.position.set(rnd(-0.6, 0.6), 1, rnd(-0.6, 0.6));
          c.rotation.z = rnd(-0.35, 0.35);
          g.add(c);
        }
      } else if (kind === 1) {
        g.add(rock(1.1, 0x5a6672));
        const snow = rock(0.9, 0xe8eef4);
        snow.position.y = 0.6;
        snow.scale.y = 0.4;
        g.add(snow);
      } else {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.25, 2.6, 0.25), M(0x30363e, { metalness: 0.8, roughness: 0.4 }));
        post.position.y = 1.3;
        const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.1, 0.3), glowMat(accent, 2.5));
        lamp.position.y = 2.65;
        g.add(post, lamp);
      }
    } else {
      if (kind === 0) {
        const hgt = rnd(2.5, 5);
        const tower = new THREE.Mesh(new RoundedBoxGeometry(1, hgt, 1, 2, 0.06), M(0x1c1a24, { metalness: 0.7, roughness: 0.35 }));
        tower.position.y = hgt / 2;
        g.add(tower);
        for (let i = 0; i < 3; i++) {
          const strip = new THREE.Mesh(new THREE.BoxGeometry(1.02, 0.05, 1.02), glowMat(pick([accent, 0x38e1ff]), 2));
          strip.position.y = hgt * (0.3 + i * 0.25);
          g.add(strip);
        }
      } else if (kind === 1) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.06, 8, 40), glowMat(accent, 2.2));
        ring.position.y = 1.6;
        const base = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.55, 0.3, 16), M(0x22202a, { metalness: 0.8, roughness: 0.3 }));
        base.position.y = 0.15;
        g.add(ring, base);
      } else {
        for (let i = 0; i < 3; i++) {
          const crate = new THREE.Mesh(new RoundedBoxGeometry(1, 0.8, 0.8, 2, 0.05), M(pick([0x2a2a34, 0x3a3644]), { metalness: 0.6, roughness: 0.45 }));
          crate.position.set(i === 2 ? 0.2 : i * 1.05 - 0.5, i === 2 ? 1.2 : 0.4, 0);
          crate.rotation.y = rnd(-0.2, 0.2);
          g.add(crate);
        }
      }
    }
    g.position.set(x, 0, z);
    g.scale.setScalar(scale);
    g.rotation.y = rot;
    g.traverse((o) => {
      if (o.isMesh && o.geometry.type !== 'CircleGeometry') o.castShadow = o.receiveShadow = true;
    });
    this.scene.add(g);
  }

  closestIdx(pts, z) {
    let best = 0;
    for (let i = 0; i < pts.length; i++) if (Math.abs(pts[i].z - z) < Math.abs(pts[best].z - z)) best = i;
    return best;
  }

  laneDist(x, z) {
    let d = Infinity;
    for (const lane of this.lanes) for (const p of lane.pts) d = Math.min(d, Math.hypot(p.x - x, p.z - z) - lane.width / 2);
    return d;
  }

  // Nests are hive spires: armored base, a glowing core crystal, claw pylons and a slow ring.
  addNest(team, kind, pos, lane, slot, pathIdx) {
    const cfg = NEST[kind];
    const g = new THREE.Group();
    const col = TEAM_COLOR[team];
    const r = cfg.radius;
    const metal = new THREE.MeshStandardMaterial({ color: 0x1d2027, roughness: 0.35, metalness: 0.85 });
    const shell = new THREE.MeshPhysicalMaterial({ color: 0x3a3f4a, roughness: 0.45, metalness: 0.6, clearcoat: 0.5 });
    const base = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.95, r * 1.08, r * 0.35, 6), metal);
    base.position.y = r * 0.17;
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.55, r * 0.8, r * 0.3, 6), shell);
    collar.position.y = r * 0.48;
    g.add(base, collar);
    const n = kind === 'main' ? 6 : 3;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const claw = new THREE.Group();
      claw.position.set(Math.cos(a) * r * 0.78, r * 0.3, Math.sin(a) * r * 0.78);
      claw.rotation.y = -a;
      const lower = new THREE.Mesh(new RoundedBoxGeometry(r * 0.16, r * 1.1, r * 0.22, 2, r * 0.04), shell);
      lower.position.set(0, r * 0.5, 0);
      lower.rotation.z = 0.25;
      const upper = new THREE.Mesh(new THREE.ConeGeometry(r * 0.08, r * 0.8, 5), metal);
      upper.position.set(-r * 0.22, r * 1.35, 0);
      upper.rotation.z = 0.55;
      const light = new THREE.Mesh(new THREE.BoxGeometry(r * 0.03, r * 0.7, r * 0.03), glowMat(col, 2));
      light.position.set(r * 0.08, r * 0.5, 0);
      light.rotation.z = 0.25;
      claw.add(lower, upper, light);
      g.add(claw);
    }
    const coreMat = new THREE.MeshPhysicalMaterial({ color: col, emissive: col, emissiveIntensity: 1.6, roughness: 0.1, transparent: true, opacity: 0.92, clearcoat: 1 });
    const egg = new THREE.Mesh(new THREE.OctahedronGeometry(r * 0.38, 0), coreMat);
    egg.scale.y = 1.9;
    egg.position.y = r * 1.25;
    g.add(egg);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r * 0.62, r * 0.025, 8, 48), glowMat(col, 2));
    ring.position.y = r * 1.25;
    ring.rotation.x = Math.PI / 2;
    g.add(ring);
    const range = new THREE.Mesh(new THREE.RingGeometry(cfg.range - 0.06, cfg.range, 96), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false }));
    range.rotation.x = -Math.PI / 2;
    range.position.y = 0.05;
    g.add(range);
    g.traverse((o) => {
      if (o.isMesh && o !== range) o.castShadow = o.receiveShadow = true;
    });
    const bar = this.makeBar(kind === 'main' ? 4.5 : 2.6, col);
    bar.group.position.y = r * 2.4 + 0.4;
    g.add(bar.group);
    g.position.copy(pos);
    this.scene.add(g);
    this.nests.push({ type: 'nest', team, kind, lane, slot, pathIdx, pos, radius: r, hp: cfg.hp, maxHp: cfg.hp, cfg, cd: rnd(0, 1), mesh: g, egg, ring, coreMat, bar, alive: true, hitT: 0 });
  }

  addHazard(x, z, period) {
    const accent = this.biome.accent;
    const grate = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.7, 0.12, 24), new THREE.MeshStandardMaterial({ color: 0x1a1c22, metalness: 0.85, roughness: 0.4 }));
    grate.position.set(x, 0.06, z);
    grate.receiveShadow = true;
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.75, 2.2, 48), new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.25, side: THREE.DoubleSide, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, 0.07, z);
    const hole = new THREE.Mesh(new THREE.CircleGeometry(1.0, 24), glowMat(accent, 0.8));
    hole.rotation.x = -Math.PI / 2;
    hole.position.set(x, 0.13, z);
    const col = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.8, 9, 24, 1, true), new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
    col.position.set(x, 4.5, z);
    this.scene.add(grate, ring, hole, col);
    this.hazards.push({ pos: new THREE.Vector3(x, 0, z), radius: 2.3, period, t: rnd(0, period), state: 'idle', ring, col, hole });
  }

  addNeutral(kind, x, z) {
    const g = new THREE.Group();
    let radius = 0.8, hp = GLUMP_HP;
    const shell = (c) => new THREE.MeshPhysicalMaterial({ color: c, roughness: 0.45, metalness: 0.5, clearcoat: 0.6 });
    const metal = new THREE.MeshStandardMaterial({ color: 0x1c1e23, roughness: 0.4, metalness: 0.85 });
    if (kind === 'glump') {
      // scavenger: a small armored crawler
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.6, 20, 14), shell(0x6a6250));
      body.scale.set(0.9, 0.6, 1.2);
      body.position.y = 0.55;
      g.add(body);
      for (let i = 0; i < 3; i++) {
        const plate = new THREE.Mesh(new THREE.SphereGeometry(0.62, 16, 8, 0, Math.PI * 2, 0, 1.0), shell(0x3e3a32));
        plate.scale.set(0.95, 0.65, 0.5);
        plate.position.set(0, 0.6, 0.35 - i * 0.35);
        g.add(plate);
      }
      for (const s of [-1, 1]) {
        for (const zz of [0.35, 0, -0.35]) {
          const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.02, 0.75, 6), metal);
          leg.position.set(s * 0.6, 0.3, zz);
          leg.rotation.z = s * 0.9;
          g.add(leg);
        }
      }
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), glowMat(0xffb020, 2.5));
      eye.position.set(0, 0.65, 0.68);
      g.add(eye);
    } else if (kind === 'boss') {
      // the Titan: a massive armored brute with a reactor core
      radius = 2.6;
      hp = BOSS_HP;
      const body = new THREE.Mesh(new THREE.SphereGeometry(2.3, 32, 20), shell(0x3a3448));
      body.scale.set(1, 0.75, 1.15);
      body.position.y = 2.1;
      g.add(body);
      for (let i = 0; i < 4; i++) {
        const plate = new THREE.Mesh(new THREE.CylinderGeometry(2.45, 2.45, 0.7, 28, 1, true, Math.PI - 1.1, 2.2).rotateX(Math.PI / 2), shell(0x5a5068));
        plate.material.side = THREE.DoubleSide;
        plate.scale.set(1, 0.8, 1);
        plate.position.set(0, 2.1, 1.4 - i * 0.9);
        g.add(plate);
      }
      for (const [lx, lz] of [[-1.5, 1.2], [1.5, 1.2], [-1.5, -1.2], [1.5, -1.2]]) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.5, 1.6, 10), metal);
        leg.position.set(lx, 0.8, lz);
        g.add(leg);
      }
      const core = new THREE.Mesh(new THREE.SphereGeometry(0.55, 20, 14), glowMat(0xb46bff, 3));
      core.position.set(0, 2.0, 2.45);
      g.add(core);
      for (const s of [-1, 1]) {
        const eye = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.08, 0.1), glowMat(0xb46bff, 3));
        eye.position.set(s * 0.7, 2.9, 2.25);
        eye.rotation.z = s * -0.2;
        g.add(eye);
      }
      const halo = new THREE.Mesh(new THREE.TorusGeometry(1.1, 0.06, 8, 48), glowMat(0xb46bff, 2.4));
      halo.rotation.x = Math.PI / 2;
      halo.position.y = 4.3;
      g.add(halo);
    } else if (kind === 'dummy') {
      // target drone on a pylon
      radius = 0.9;
      hp = 300;
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.18, 1.6, 10), metal);
      post.position.y = 0.8;
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.6, 0.15, 16), metal);
      base.position.y = 0.075;
      const pod = new THREE.Mesh(new RoundedBoxGeometry(1.1, 1.0, 0.7, 3, 0.12), shell(0x8a8f98));
      pod.position.y = 2.0;
      const target = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.04, 8, 32), glowMat(0xff3b4e, 2.5));
      target.position.set(0, 2.0, -0.37);
      const dot = new THREE.Mesh(new THREE.CircleGeometry(0.08, 16), glowMat(0xff3b4e, 2.5));
      dot.position.set(0, 2.0, -0.37);
      dot.rotation.y = Math.PI;
      g.add(post, base, pod, target, dot);
      g.rotation.y = Math.PI;
    }
    g.traverse((o) => {
      if (o.isMesh) o.castShadow = o.receiveShadow = true;
    });
    const bar = this.makeBar(kind === 'boss' ? 4 : 1.6, kind === 'boss' ? 0xb46bff : 0xc8c0a8);
    bar.group.position.y = kind === 'boss' ? 5.2 : kind === 'dummy' ? 2.9 : 1.6;
    g.add(bar.group);
    g.position.set(x, 0, z);
    this.scene.add(g);
    this.neutrals.push({ type: 'neutral', kind, team: 'neutral', pos: g.position, home: new THREE.Vector3(x, 0, z), radius, hp, maxHp: hp, mesh: g, bar, alive: true, aggro: null, aggroT: 0, cd: 0, respawn: 0, wander: rnd(0, 6), hitT: 0, lastHitT: 0 });
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

  // Billboard a child object even when its parent is rotated.
  faceCamera(obj) {
    obj.parent.getWorldQuaternion(this.tmpQ || (this.tmpQ = new THREE.Quaternion()));
    obj.quaternion.copy(this.tmpQ.invert().multiply(this.camera.quaternion));
  }

  // ---- creatures

  spawnCreature(data, team, { isPlayer = false, lane = 1, at = null } = {}) {
    const st = computeStats(data);
    const built = buildCreatureMesh(data);
    const group = new THREE.Group();
    group.add(built.root);
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.2, 1.3, 48), new THREE.MeshBasicMaterial({ color: isPlayer ? 0xffffff : TEAM_COLOR[team], transparent: true, opacity: isPlayer ? 0.8 : 0.5, side: THREE.DoubleSide, depthWrite: false, toneMapped: false }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.05;
    // contact shadow under the feet; real shadows come from the sun on High graphics
    const shadow = new THREE.Mesh(new THREE.CircleGeometry(1.1, 24), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: this.renderer.shadowMap.enabled ? 0.18 : 0.35, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.04;
    const bar = this.makeBar(1.8, TEAM_COLOR[team]);
    bar.group.position.y = built.height + 0.7;
    const shieldBubble = new THREE.Mesh(new THREE.SphereGeometry(1.7, 32, 20), new THREE.MeshBasicMaterial({ color: 0x5ae0ff, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false }));
    shieldBubble.position.y = built.height * 0.5;
    shieldBubble.visible = false;
    group.add(ring, shadow, bar.group, shieldBubble);
    this.scene.add(group);

    const base = this.mode === 'match' ? (team === 'blue' ? -this.L + 13 : this.L - 13) : -8;
    const n = this.creatures.filter((c) => c.team === team).length;
    const pos = at ? at.clone() : new THREE.Vector3((n % 4) * 3 - 4.5, 0, base + (team === 'blue' ? 1 : -1) * Math.floor(n / 4) * 3);
    const e = {
      type: 'creature', id: data.id || crypto.randomUUID(), name: data.name, data, team, st, built, group, ring, bar, shieldBubble,
      pos, vel: new THREE.Vector3(), kb: new THREE.Vector3(), y: 0, vy: 0, face: team === 'blue' ? 0 : Math.PI,
      hp: st.maxHp, maxHp: st.maxHp, stamina: 100, state: 'alive', downedT: 0, downedHp: 0, reviveT: 0, downedBy: null,
      cds: st.attacks.map(() => 0), weaponCd: 0, specialCd: 0, dodgeCd: 0, moveAmt: 0, radius: 1.0,
      fx: { poison: null, slowT: 0, hideT: 0, shield: 0, shieldT: 0, invulnT: 0, stunT: 0, dashT: 0, dashVel: new THREE.Vector3(), glideT: 0, puffT: 0, buffDmgT: 0, buffSpdT: 0, attackT: 0, fireT: 0, emoteT: 0, hitT: 0 },
      mut: new Set(), k: { kills: 0, nests: 0, revives: 0, dmg: 0 },
      isPlayer, isBot: !isPlayer, ai: { lane, think: 0, target: null, goal: null, strafe: Math.random() < 0.5 ? -1 : 1 },
      deathT: 0, spin: 0,
    };
    group.position.copy(pos);
    this.creatures.push(e);
    if (isPlayer) {
      this.portrait.src = creatureThumb(data, { size: 128 });
      this.nameEl.textContent = data.name;
      this.buildAbilityBar(e);
    }
    return e;
  }

  buildAbilityBar(e) {
    const keys = ['1', '2', '3'];
    this.abilityEls = [];
    const wcd = h('div', { class: 'ab-cd' });
    this.abilityEls.push({ cd: wcd, get: () => [e.weaponCd, e.st.weapon.cd] });
    const weaponSlot = h('div', { class: 'ability weapon' }, h('kbd', {}, 'F'), h('span', {}, e.st.weapon.name), wcd);
    const slots = e.st.attacks.map((a, i) => {
      const cd = h('div', { class: 'ab-cd' });
      this.abilityEls.push({ cd, get: () => [e.cds[i], a.cd] });
      return h('div', { class: 'ability' }, h('kbd', {}, keys[i]), h('span', {}, a.name), cd);
    });
    if (e.st.special) {
      const cd = h('div', { class: 'ab-cd' });
      const sp = SPECIALS[e.st.special];
      this.abilityEls.push({ cd, get: () => [e.specialCd, sp.cd] });
      slots.push(h('div', { class: 'ability special' }, h('kbd', {}, 'E'), h('span', {}, sp.name), cd));
    }
    const dcd = h('div', { class: 'ab-cd' });
    this.abilityEls.push({ cd: dcd, get: () => [e.dodgeCd, 0.8] });
    slots.push(h('div', { class: 'ability' }, h('kbd', {}, 'C'), h('span', {}, 'Dodge'), dcd));
    slots.push(h('div', { class: 'ability' }, h('kbd', {}, 'Space'), h('span', {}, 'Jump')));
    this.hud.abilities.replaceChildren(weaponSlot, ...slots);
  }

  devSpawnBot() {
    const fwd = new THREE.Vector3(Math.sin(this.player.face), 0, Math.cos(this.player.face));
    const at = (this.player.state === 'alive' ? this.player.pos : this.camTarget).clone().addScaledVector(fwd, 6);
    const bot = this.spawnCreature(randomBuild(), 'red', { at, lane: 1 });
    bot.ai.devBot = true;
    this.message(`Test bot "${bot.name}" spawned`);
  }

  // ------------------------------------------------------------ input

  bindInput() {
    const isTyping = () => devConsole.isOpen || document.activeElement?.tagName === 'INPUT';
    const cv = this.renderer.domElement;
    this.onKeyDown = (e) => {
      if (isTyping()) return;
      const k = e.key.toLowerCase();
      if (k === 'escape') {
        // the browser already released pointer lock and we paused for it
        if (performance.now() - (this.unlockedAt || 0) < 300) return;
        return this.togglePause();
      }
      if (k === 'v' && !e.repeat) return this.setCameraMode(this.settings.camera === 'third' ? 'tactical' : 'third');
      if ([' ', 'tab'].includes(k)) e.preventDefault();
      if (!e.repeat) this.tapped.add(k); // a quick tap can be shorter than a frame; remember it until the next one
      this.keys.add(k);
    };
    this.onKeyUp = (e) => this.keys.delete(e.key.toLowerCase());
    this.onMouseMove = (e) => {
      const r = cv.getBoundingClientRect();
      this.mouse.x = ((e.clientX - r.left) / r.width) * 2 - 1;
      this.mouse.y = -((e.clientY - r.top) / r.height) * 2 + 1;
      // captured mouse looks around freely; otherwise holding right-click and dragging orbits the camera
      const dragging = this.orbit && this.mouse.buttons.has(2);
      if (this.cam.locked || dragging) {
        const sens = (dragging ? 0.005 : 0.0024) * this.settings.sensitivity;
        const dx = dragging ? e.clientX - this.orbit.x : e.movementX;
        const dy = dragging ? e.clientY - this.orbit.y : e.movementY;
        if (dragging) this.orbit = { x: e.clientX, y: e.clientY };
        this.cam.yaw -= dx * sens;
        this.cam.pitch = Math.max(0.05, Math.min(1.25, this.cam.pitch + dy * sens * (this.settings.invertY ? -1 : 1)));
      }
    };
    this.onMouseDown = (e) => {
      if (e.target !== cv) return;
      if (this.wantsLock()) {
        // first click only grabs the mouse; it doesn't attack
        this.requestLock();
        return;
      }
      this.mouse.buttons.add(e.button);
      if (e.button === 2) this.orbit = { x: e.clientX, y: e.clientY };
    };
    this.onMouseUp = (e) => {
      this.mouse.buttons.delete(e.button);
      if (e.button === 2) this.orbit = null;
    };
    this.onWheel = (e) => {
      if (e.target !== cv && !this.cam.locked) return;
      this.cam.dist = Math.max(5, Math.min(16, this.cam.dist * (1 + Math.sign(e.deltaY) * 0.08)));
    };
    this.onContext = (e) => e.target === cv && e.preventDefault();
    this.onBlur = () => {
      this.keys.clear();
      this.mouse.buttons.clear();
    };
    this.onLockChange = () => {
      const locked = document.pointerLockElement === cv;
      if (this.cam.locked && !locked) {
        this.unlockedAt = performance.now();
        this.mouse.buttons.clear();
        if (!this.paused && this.wantsControl()) this.togglePause(true);
      }
      this.cam.locked = locked;
      this.updateCursorUi();
    };
    addEventListener('keydown', this.onKeyDown);
    addEventListener('keyup', this.onKeyUp);
    addEventListener('mousemove', this.onMouseMove);
    addEventListener('mousedown', this.onMouseDown);
    addEventListener('mouseup', this.onMouseUp);
    addEventListener('wheel', this.onWheel, { passive: true });
    addEventListener('contextmenu', this.onContext);
    addEventListener('blur', this.onBlur);
    document.addEventListener('pointerlockchange', this.onLockChange);
  }

  // The player is steering a live creature (not dead, spectating, paused or finished).
  wantsControl() {
    return this.player.state !== 'dead' && !this.ended && !this.deathCam;
  }

  wantsLock() {
    return this.settings.camera === 'third' && this.settings.mouseLook && !this.cam.locked && !this.paused && this.wantsControl() && !!this.renderer.domElement.requestPointerLock;
  }

  requestLock() {
    try {
      const p = this.renderer.domElement.requestPointerLock();
      p?.catch?.(() => {});
    } catch {}
  }

  releaseLock() {
    if (document.pointerLockElement === this.renderer.domElement) document.exitPointerLock();
  }

  setCameraMode(mode) {
    this.settings = setSetting('camera', mode);
    if (mode === 'third') this.cam.yaw = this.player.face;
    else this.releaseLock();
    this.applyCameraMode();
    if (!this.paused) this.message(mode === 'third' ? 'Third-person camera' : 'Tactical camera');
  }

  applyCameraMode() {
    const third = this.settings.camera === 'third';
    this.controlsHint.textContent = third
      ? `WASD move · ${this.settings.mouseLook ? 'Mouse look' : 'Right-drag camera'} · F shoot · 1/2/3 attacks · E special · Space jump · C dodge · Shift sprint · Scroll zoom · V camera · Esc menu`
      : 'WASD move · Mouse aim · F shoot · 1/2/3 attacks · E special · Space jump · C dodge · Shift sprint · V camera · Esc menu';
    this.renderer.domElement.style.cursor = third ? 'default' : 'crosshair';
    this.updateCursorUi();
  }

  updateCursorUi() {
    const third = this.settings.camera === 'third';
    const live = this.wantsControl() && !this.paused;
    this.crosshair.hidden = !(third && live);
    this.lockHint.hidden = !(third && live && this.settings.mouseLook && !this.cam.locked);
  }

  togglePause(force) {
    this.paused = force ?? !this.paused;
    this.hud.pause.hidden = !this.paused;
    if (this.paused) {
      this.releaseLock();
      this.renderPauseMenu();
    } else if (this.settings.camera === 'third' && this.wantsControl()) {
      this.requestLock();
    }
    this.updateCursorUi();
  }

  renderPauseMenu() {
    const set = this.settings;
    const seg = (key, options, after) => h('div', { class: 'seg-row' }, ...options.map(([val, label]) => h('button', {
      class: `seg ${set[key] === val ? 'active' : ''}`,
      onclick: () => {
        if (key === 'camera') this.setCameraMode(val);
        else this.settings = setSetting(key, val);
        after?.(val);
        this.renderPauseMenu();
      },
    }, label)));
    const sens = h('input', {
      type: 'range', class: 'range', min: 0.3, max: 2.5, step: 0.05, value: set.sensitivity,
      oninput: (e) => {
        this.settings = setSetting('sensitivity', Number(e.target.value));
        sensVal.textContent = `${this.settings.sensitivity.toFixed(2)}×`;
      },
    });
    const sensVal = h('span', { class: 'look-val' }, `${set.sensitivity.toFixed(2)}×`);
    this.hud.pause.replaceChildren(
      h('div', { class: 'panel pause-card' },
        h('div', { class: 'title-kicker' }, this.mode === 'match' ? this.biome.name : 'TEST RANGE'),
        h('h2', {}, 'Paused'),
        h('button', { class: 'btn primary', onclick: () => this.togglePause(false) }, 'Resume'),
        h('div', { class: 'settings' },
          h('label', {}, 'Camera'), seg('camera', [['third', 'Third-person'], ['tactical', 'Tactical']]),
          h('label', {}, 'Mouse sensitivity'), h('div', { class: 'range-row' }, sens, sensVal),
          h('label', {}, 'Camera control'), seg('mouseLook', [[false, 'Right-drag'], [true, 'Captured mouse']], () => {
            this.releaseLock();
            this.applyCameraMode();
          }),
          h('label', {}, 'Invert look'), seg('invertY', [[false, 'Off'], [true, 'On']]),
          h('label', {}, 'Graphics'), seg('quality', [['high', 'High'], ['low', 'Low']], () => this.message('Graphics change applies to your next match')),
        ),
        h('p', { class: 'muted small' }, 'F (or left click) fires your weapon and locks onto the enemy nearest your aim. 1, 2 and 3 use your part attacks, which snap to targets in front of you. Space jumps, C dodges, Shift sprints.'),
        h('button', { class: 'btn', onclick: () => this.onExit?.(this.mode === 'match' ? 'forfeit' : 'exit') }, this.mode === 'match' ? 'Leave match' : 'Back to Workshop')));
  }

  // ------------------------------------------------------------ main loop

  loop(now) {
    const realDt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    if (!this.paused) {
      if (this.slowmo > 0) {
        this.slowmo -= realDt;
        this.timeScale = 0.25;
        if (this.slowmo <= 0) {
          this.timeScale = 1;
          this.afterSlowmo?.();
          this.afterSlowmo = null;
        }
      }
      this.update(realDt * this.timeScale);
    }
    this.updateCamera(realDt);
    this.updateHud();
    if (this.composer) this.composer.render(realDt);
    else this.renderer.render(this.scene, this.camera);
  }

  // One bad frame must not freeze the match: keep the loop alive and surface the error.
  frame(now) {
    this.raf = requestAnimationFrame((t) => this.frame(t));
    try {
      this.loop(now);
    } catch (err) {
      console.error(err);
      if (!this.errorShown) {
        this.errorShown = true;
        this.message(`Something broke: ${err.message}`);
      }
    }
  }

  update(dt) {
    this.time += dt;
    if (this.mode === 'match' && !this.ended) {
      this.timeLeft -= dt;
      if (this.timeLeft <= 0) this.tiebreak('The 10-minute limit was reached');
    }
    for (const t of ['blue', 'red']) this.teamBuff[t] = Math.max(0, this.teamBuff[t] - dt);

    this.updateAim();
    this.lockTarget = this.player.state === 'alive' ? this.assistTarget(this.player, this.player.st.weapon.range) : null;

    for (const c of this.creatures) this.updateCreature(c, dt);
    this.separate();
    for (const n of this.nests) this.updateNest(n, dt);
    for (const n of this.neutrals) this.updateNeutral(n, dt);
    this.updateProjectiles(dt);
    this.updateHazards(dt);
    this.updatePickups(dt);
    this.updateClouds(dt);
    this.updateFx(dt);
    this.updateParticles(dt);
    if (this.mode === 'match' && !this.ended) {
      const alive = (t) => this.creatures.some((c) => c.team === t && c.state !== 'dead');
      if (!alive('blue') && !alive('red')) this.tiebreak('Both teams were wiped out');
    }
  }

  // ---- creature update

  updateCreature(e, dt) {
    const fx = e.fx;
    for (const k of ['slowT', 'hideT', 'invulnT', 'stunT', 'dashT', 'glideT', 'puffT', 'buffDmgT', 'buffSpdT', 'attackT', 'fireT', 'emoteT', 'hitT']) fx[k] = Math.max(0, fx[k] - dt);
    fx.shieldT = Math.max(0, fx.shieldT - dt);
    if (fx.shieldT <= 0) fx.shield = 0;
    e.shieldBubble.visible = fx.shield > 0 || fx.puffT > 0;
    e.shieldBubble.scale.setScalar(fx.puffT > 0 ? 1.25 : 1);

    if (e.state === 'dead') return this.updateCorpse(e, dt);

    e.cds = e.cds.map((v) => Math.max(0, v - dt));
    e.specialCd = Math.max(0, e.specialCd - dt);
    e.weaponCd = Math.max(0, e.weaponCd - dt);
    e.dodgeCd = Math.max(0, e.dodgeCd - dt);

    if (e.state === 'downed') {
      e.downedT -= dt;
      const helper = this.creatures.find((o) => o !== e && o.team === e.team && o.state === 'alive' && dist2(o.pos, e.pos) < 2.6);
      if (helper) {
        e.reviveT += dt;
        if (e.reviveT >= 3) {
          e.state = 'alive';
          e.hp = Math.round(e.maxHp * 0.3);
          e.reviveT = 0;
          helper.k.revives += 1;
          this.floatText(e.pos, 'REVIVED', '#4dff9a');
          if (e.isPlayer) this.message('A teammate revived you!');
          if (helper.isPlayer) this.message(`You revived ${e.name}!`);
        }
      } else e.reviveT = Math.max(0, e.reviveT - dt * 0.5);
      if (e.state === 'downed' && e.downedT <= 0) this.kill(e, e.downedBy);
      e.kb.multiplyScalar(Math.exp(-5 * dt));
      e.pos.addScaledVector(e.kb, dt);
      this.clampBounds(e);
      this.syncCreatureMesh(e, dt, 0);
      return;
    }

    // status ticks
    if (fx.poison) {
      fx.poison.t -= dt;
      this.damageCreature(e, fx.poison.dps * dt, 'venom', fx.poison.src, { silent: true });
      if (fx.poison && fx.poison.t <= 0) fx.poison = null; // may already be cleared by being downed
      if (e.state !== 'alive') return;
    }
    let regen = 0;
    if (e.mut.has('regen')) regen += 1.5;
    if (this.teamBuff[e.team] > 0) regen += 2;
    if (this.mode === 'match' && this.nests.some((n) => n.alive && n.team === e.team && dist2(n.pos, e.pos) < n.cfg.range)) {
      const mine = this.creatures.filter((c) => c.team === e.team && c.state !== 'dead').length;
      const theirs = this.creatures.filter((c) => c.team === ENEMY[e.team] && c.state !== 'dead').length;
      regen += mine < theirs ? 9 : 4; // outnumbered teams heal faster near their own nests
    }
    e.hp = Math.min(e.maxHp, e.hp + regen * dt);
    e.stamina = Math.min(100, e.stamina + 28 * dt);

    // intent
    let move = new THREE.Vector3();
    if (e.isPlayer) move = this.playerInput(e);
    else move = this.botThink(e, dt);

    let speed = e.st.speed * (e.mut.has('zoom') ? 1.1 : 1) * (fx.buffSpdT > 0 ? 1.25 : 1);
    if (e.sprinting) {
      speed *= 1.4;
      e.stamina = Math.max(0, e.stamina - 46 * dt); // net drain once regen is counted
    }
    if (fx.slowT > 0 || this.inEnemyInk(e)) speed *= 0.5;
    if (fx.hideT > 0 || fx.stunT > 0 || fx.attackT > 0.15) speed *= fx.hideT > 0 || fx.stunT > 0 ? 0 : 0.5;

    if (fx.dashT > 0) {
      e.vel.copy(fx.dashVel);
    } else {
      // quicker to start than to stop gives weight without feeling sluggish
      const target = move.multiplyScalar(speed);
      const accel = target.lengthSq() > e.vel.lengthSq() ? 10 : 7;
      e.vel.lerp(target, 1 - Math.exp(-accel * dt));
    }
    if (e.isPlayer && e.wantFace != null && fx.stunT <= 0 && fx.dashT <= 0) {
      const diff = wrapAng(e.wantFace - e.face);
      e.face = wrapAng(e.face + Math.sign(diff) * Math.min(Math.abs(diff), 14 * dt));
    }
    e.kb.multiplyScalar(Math.exp(-4 * dt));
    e.pos.addScaledVector(e.vel, dt).addScaledVector(e.kb, dt);
    this.clampBounds(e);

    // airborne (geysers, pounces)
    if (e.y > 0 || e.vy !== 0) {
      e.vy -= 30 * dt;
      e.y += e.vy * dt;
      if (e.y <= 0) {
        e.y = 0;
        e.vy = 0;
        if (e.pounceLand) {
          this.pounceLand(e);
          e.pounceLand = false;
        }
      }
    }
    if (e.chargeHits) this.chargeTick(e);
    e.moveAmt = Math.min(1, e.vel.length() / 5);
    this.syncCreatureMesh(e, dt, e.moveAmt);
  }

  syncCreatureMesh(e, dt, moveAmt) {
    const g = e.group;
    g.position.set(e.pos.x, e.y, e.pos.z);
    const root = e.built.root;
    const a = e.built.anim;
    let tilt = 0;
    if (e.state === 'downed') tilt = 1.4;
    else if (e.fx.stunT > 0) tilt = 0.5 * Math.min(1, e.fx.stunT * 3);
    root.rotation.z += (tilt - root.rotation.z) * Math.min(1, dt * 10);
    // bank into turns, rear up on a kill
    const turn = wrapAng(e.face - (e.lastFace ?? e.face)) / Math.max(dt, 1e-3);
    e.lastFace = e.face;
    e.bank = (e.bank || 0) + (Math.max(-0.25, Math.min(0.25, -turn * 0.03 * moveAmt)) - (e.bank || 0)) * Math.min(1, dt * 8);
    root.rotation.y = e.face;
    root.rotation.x = e.fx.emoteT > 0 ? -Math.sin(Math.min(1, e.fx.emoteT) * Math.PI) * 0.35 : 0;
    root.rotation.z += e.bank * 0.4 - (root.userData.bank || 0);
    root.userData.bank = e.bank * 0.4;
    const crouch = e.fx.hideT > 0 ? 0.78 : 1;
    const puff = e.fx.puffT > 0 ? 1.12 : 1;
    root.scale.set(a.baseScale * puff, a.baseScale * crouch * puff, a.baseScale * puff);
    const attack = e.fx.attackT > 0 ? Math.sin((e.fx.attackT / 0.25) * Math.PI) : 0;
    const t = this.time + e.id.charCodeAt(0);
    animateCreature(a, t, e.state === 'downed' ? 0 : moveAmt, dt, {
      attack, fire: e.fx.fireT / 0.12, hit: e.fx.hitT > 0 ? e.fx.hitT / 0.12 : 0, lean: moveAmt * 0.05 * (e.sprinting ? 2 : 1),
      dim: e.state === 'downed' ? 0.35 + Math.abs(Math.sin(this.time * 6)) * 0.4 : 1,
    });
    e.bar.set(e.state === 'downed' ? e.downedHp / 30 : e.hp / e.maxHp);
    e.bar.fill.material.color.set(e.state === 'downed' ? 0xffae3d : TEAM_COLOR[e.team]);
    this.faceCamera(e.bar.group);
    e.bar.group.visible = !(e.isPlayer && this.settings.camera === 'third');
    e.ring.material.opacity = e.state === 'downed' ? 0.4 + Math.sin(this.time * 10) * 0.4 : e.isPlayer ? 0.8 : 0.5;
  }

  // Corpses rocket into the sky, spinning and trailing light, then burst like a flare.
  updateCorpse(e, dt) {
    e.deathT += dt;
    e.bar.group.visible = false;
    e.ring.visible = false;
    if (e.skyDone) return;
    e.vy -= 9 * dt;
    e.y += e.vy * dt;
    e.kb.multiplyScalar(Math.exp(-1.5 * dt));
    e.pos.addScaledVector(e.kb, dt);
    const root = e.built.root;
    root.rotation.x += e.spin * dt;
    root.rotation.z += e.spin * 0.6 * dt;
    e.group.position.set(e.pos.x, e.y, e.pos.z);
    const flicker = Math.sin(e.deathT * 40) > 0 ? 1 : 0.4;
    animateCreature(e.built.anim, this.time, 1, dt, { hit: 0.35 * flicker, dim: 1.6 * flicker });
    e.trailT -= dt;
    if (e.trailT <= 0) {
      e.trailT = 0.012;
      const col = e.built.anim.mats?.glow.emissive ?? new THREE.Color(TEAM_COLOR[e.team]);
      this.puff(new THREE.Vector3(e.pos.x + rnd(-0.2, 0.2), e.y + 0.8, e.pos.z + rnd(-0.2, 0.2)), col, 0.5, 1.1);
    }
    if (e.y > 34 || e.deathT > 3.4) {
      e.skyDone = true;
      const at = new THREE.Vector3(e.pos.x, e.y + 1, e.pos.z);
      this.skyBurst(at, TEAM_COLOR[e.team]);
      e.group.visible = false;
      if (!e.isPlayer) disposeMesh(e.built.root);
      if (e.isPlayer && this.afterSkyBurst) {
        const done = this.afterSkyBurst;
        this.afterSkyBurst = null;
        setTimeout(done, 900);
      }
    }
  }

  clampBounds(e) {
    e.pos.x = Math.max(-this.W + 1, Math.min(this.W - 1, e.pos.x));
    e.pos.z = Math.max(-this.L + 1, Math.min(this.L - 1, e.pos.z));
  }

  separate() {
    const live = this.creatures.filter((c) => c.state !== 'dead');
    for (let i = 0; i < live.length; i++) {
      const a = live[i];
      for (let j = i + 1; j < live.length; j++) {
        const b = live[j];
        const dx = b.pos.x - a.pos.x;
        const dz = b.pos.z - a.pos.z;
        const d = Math.hypot(dx, dz);
        const min = a.radius + b.radius;
        if (d > 0.001 && d < min) {
          const push = (min - d) / 2;
          a.pos.x -= (dx / d) * push;
          a.pos.z -= (dz / d) * push;
          b.pos.x += (dx / d) * push;
          b.pos.z += (dz / d) * push;
        }
      }
      // creatures can waddle over their own nests; enemy nests, the boss and dummies are solid
      for (const o of [...this.nests.filter((n) => n.alive && n.team !== a.team), ...this.neutrals.filter((n) => n.alive && n.kind !== 'glump')]) {
        const d = dist2(a.pos, o.pos);
        const min = a.radius + o.radius;
        if (d > 0.001 && d < min) {
          a.pos.x = o.pos.x + ((a.pos.x - o.pos.x) / d) * min;
          a.pos.z = o.pos.z + ((a.pos.z - o.pos.z) / d) * min;
        }
      }
    }
  }

  // ---- player

  // Where the player is aiming: the screen center in third-person, the mouse in tactical.
  updateAim() {
    const third = this.settings.camera === 'third';
    this.raycaster.setFromCamera(third ? new THREE.Vector2(0, 0) : new THREE.Vector2(this.mouse.x, this.mouse.y), this.camera);
    const hit = this.raycaster.ray.intersectPlane(this.groundPlane, this.mouse.ground);
    const p = this.player.pos;
    if (!hit || (third && dist2(this.mouse.ground, p) > 28)) {
      const fwd = third ? new THREE.Vector3(Math.sin(this.cam.yaw), 0, Math.cos(this.cam.yaw)) : new THREE.Vector3(Math.sin(this.player.face), 0, Math.cos(this.player.face));
      this.mouse.ground.set(p.x, 0, p.z).addScaledVector(fwd, 28);
    }
  }

  playerInput(e) {
    e.sprinting = false;
    if (devConsole.isOpen || this.ended) return new THREE.Vector3();
    const held = this.keys;
    const tapped = new Set(this.tapped);
    this.tapped.clear();
    const k = { has: (key) => held.has(key) || tapped.has(key) };
    const third = this.settings.camera === 'third';
    const fwdIn = (k.has('w') || k.has('arrowup') ? 1 : 0) - (k.has('s') || k.has('arrowdown') ? 1 : 0);
    const rightIn = (k.has('d') || k.has('arrowright') ? 1 : 0) - (k.has('a') || k.has('arrowleft') ? 1 : 0);
    // camera-relative in third-person; the tactical camera looks toward +z, so screen-right is -x
    const yaw = third ? this.cam.yaw : 0;
    const fwd = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const right = new THREE.Vector3(-Math.cos(yaw), 0, Math.sin(yaw));
    const move = fwd.multiplyScalar(fwdIn).addScaledVector(right, rightIn);
    if (move.lengthSq() > 0) move.normalize();
    const moving = move.lengthSq() > 0;
    e.sprinting = moving && k.has('shift') && e.stamina > 5 && e.fx.attackT <= 0;

    const firing = k.has('f') || this.mouse.buttons.has(0);
    const attacking = firing || k.has('1') || k.has('2') || k.has('3');
    if (attacking) this.lastCombatT = this.time;
    const aimFace = angTo(e.pos, this.mouse.ground);
    // tactical: always face the mouse. third-person: face where you run, and the crosshair while fighting
    if (!third || this.time - this.lastCombatT < 1.2) e.wantFace = aimFace;
    else if (moving) e.wantFace = Math.atan2(move.x, move.z);

    if (firing) this.fireWeapon(e, this.mouse.ground, this.lockTarget);
    // part attacks sit on a numbered hotbar
    if (k.has('1')) this.playerAttack(e, 0, aimFace);
    if (k.has('2')) this.playerAttack(e, 1, aimFace);
    if (k.has('3')) this.playerAttack(e, 2, aimFace);
    if (k.has('e')) {
      if (e.st.special && e.specialCd <= 0) e.face = aimFace;
      this.trySpecial(e, this.mouse.ground);
    }
    if (k.has('c')) this.tryDodge(e, moving ? move : new THREE.Vector3(Math.sin(e.face), 0, Math.cos(e.face)));
    if (k.has(' ')) this.tryJump(e);
    return move;
  }

  tryJump(e) {
    if (e.state !== 'alive' || e.y > 0 || e.vy !== 0 || e.fx.stunT > 0 || e.fx.hideT > 0) return;
    e.vy = 10;
    e.y = 0.01;
    this.ringFx(e.pos, 1.4, 0xffffff);
  }

  // Attacks fire toward the aim instantly; melee snaps to the best target near the aim line.
  playerAttack(e, i, aimFace) {
    const a = e.st.attacks[i];
    if (!a || e.cds[i] > 0) return;
    let face = aimFace;
    if (a.kind === 'melee') {
      let best = null;
      for (const t of this.targetsFor(e)) {
        const d = dist2(t.pos, e.pos) - t.radius;
        const off = angDiff(aimFace, angTo(e.pos, t.pos));
        if (d > a.range + 1.2 || off > 0.75) continue;
        const score = d + off * 3;
        if (!best || score < best[1]) best = [t, score];
      }
      if (best) face = angTo(e.pos, best[0].pos);
    }
    const prev = e.face;
    e.face = face;
    if (this.tryAttack(e, i)) {
      e.wantFace = face;
      this.lastCombatT = this.time;
    } else e.face = prev;
  }

  // ---- bots

  botThink(b, dt) {
    const ai = b.ai;
    ai.think -= dt;
    const confused = this.inEnemyInk(b);
    if (ai.think <= 0) {
      ai.think = 0.25 + Math.random() * 0.15;
      ai.target = null;
      ai.goal = null;
      const enemies = this.creatures.filter((c) => c.team !== b.team && c.state !== 'dead');
      const aggro = confused ? 3 : Math.max(9, b.st.vision * 0.7);
      const hpf = b.hp / b.maxHp;
      // don't chase into enemy nest fire unless healthy
      const underNest = (c) => this.nests.some((n) => n.alive && n.team !== b.team && dist2(n.pos, c.pos) < n.cfg.range);
      const near = enemies.map((c) => [c, dist2(c.pos, b.pos)])
        .filter(([c, d]) => d < aggro && (hpf > 0.6 || d < 3 || !underNest(c))).sort((x, y) => x[1] - y[1]);
      const downedAlly = this.creatures.find((c) => c.team === b.team && c.state === 'downed' && dist2(c.pos, b.pos) < 16);
      // retreat to heal at a friendly nest when hurt, until mostly healed
      if (hpf < 0.35) ai.retreating = true;
      else if (hpf > 0.85) ai.retreating = false;
      const myNeutral = this.neutrals.find((n) => n.alive && n.aggro === b && dist2(n.pos, b.pos) < 12);
      if (downedAlly && (!near.length || near[0][1] > 6)) ai.goal = { kind: 'revive', pos: downedAlly.pos };
      else if (ai.retreating && this.mode === 'match' && !ai.devBot) ai.goal = { kind: 'retreat' };
      else if (near.length) ai.target = near[0][0];
      else if (myNeutral) ai.target = myNeutral;
      else if (this.mode === 'match') ai.goal = { kind: 'push' };
      else ai.target = this.creatures.find((c) => c.isPlayer && c.state !== 'dead') || null;
    }

    let dest = null;
    let target = ai.target && (ai.target.state === 'dead' || ai.target.alive === false) ? null : ai.target;
    const ranged = b.st.attacks.some((a) => a.kind === 'ranged');
    if (ai.goal?.kind === 'revive') dest = ai.goal.pos;
    else if (ai.goal?.kind === 'retreat') {
      const home = this.nests.filter((n) => n.alive && n.team === b.team).sort((x, y) => dist2(x.pos, b.pos) - dist2(y.pos, b.pos))[0];
      dest = home ? home.pos : null;
      if (this.nearestEnemyWithin(b, 3)) target = this.nearestEnemyWithin(b, 3);
    } else if (ai.goal?.kind === 'push') {
      const nest = this.nextNestFor(b);
      if (nest) {
        target = nest;
        const reach = Math.max(...b.st.attacks.map((a) => a.range));
        if (dist2(nest.pos, b.pos) - nest.radius > reach * 0.85) dest = this.laneWaypoint(b, nest);
      }
    }

    if (target) {
      const d = dist2(target.pos, b.pos) - (target.radius || 1);
      b.face = angTo(b.pos, target.pos);
      if (!dest) {
        const pref = ranged ? 7 : 1.1;
        if (d > pref) dest = target.pos;
        else if (ranged && d < 4) dest = b.pos.clone().multiplyScalar(2).sub(target.pos);
        else {
          // circle-strafe a little
          const side = new THREE.Vector3(Math.cos(b.face), 0, -Math.sin(b.face)).multiplyScalar(ai.strafe * 3);
          dest = b.pos.clone().add(side);
          if (Math.random() < 0.01) ai.strafe *= -1;
        }
      }
      b.st.attacks.forEach((a, i) => {
        if (d <= a.range && (a.kind !== 'ranged' || d > 1)) this.tryAttack(b, i);
      });
      if (d <= b.st.weapon.range * 0.9 && !confused) this.fireWeapon(b, target.pos, target);
      if (target.type === 'creature' && Math.random() < dt * 0.6) this.botSpecial(b, target, d);
    } else if (b.st.special === 'heal' && b.hp < b.maxHp * 0.6) this.trySpecial(b, b.pos);

    let move = new THREE.Vector3();
    if (dest) {
      move.set(dest.x - b.pos.x, 0, dest.z - b.pos.z);
      if (move.length() < 0.8) move.set(0, 0, 0);
      else {
        move.normalize();
        if (!target) b.face = Math.atan2(move.x, move.z);
      }
    }
    // dodge geysers about to erupt
    for (const hz of this.hazards) {
      if (hz.state === 'warn' && dist2(hz.pos, b.pos) < hz.radius + 1.2) {
        move.add(new THREE.Vector3(b.pos.x - hz.pos.x, 0, b.pos.z - hz.pos.z).normalize().multiplyScalar(1.5)).normalize();
      }
    }
    if (confused) move.add(new THREE.Vector3(Math.sin(this.time * 3 + b.pos.x), 0, Math.cos(this.time * 2.3))).normalize();
    return move;
  }

  botSpecial(b, target, d) {
    const sp = b.st.special;
    if (!sp || b.specialCd > 0) return;
    const hpf = b.hp / b.maxHp;
    const crowd = this.creatures.filter((c) => c.team !== b.team && c.state === 'alive' && dist2(c.pos, b.pos) < 4).length;
    const use = {
      charge: d > 2.5 && d < 8,
      pounce: d > 3 && d < 9,
      spin: crowd >= 1 && d < 3,
      glide: hpf < 0.3,
      hide: hpf < 0.35,
      heal: hpf < 0.6,
      shield: hpf < 0.75,
      ink: crowd >= 2 || hpf < 0.4,
      puff: d < 2.5 && hpf < 0.6,
    }[sp];
    if (use) this.trySpecial(b, sp === 'glide' ? b.pos.clone().multiplyScalar(2).sub(target.pos) : target.pos);
  }

  nearestEnemyWithin(b, r) {
    return this.creatures.filter((c) => c.team !== b.team && c.state !== 'dead' && dist2(c.pos, b.pos) < r)
      .sort((x, y) => dist2(x.pos, b.pos) - dist2(y.pos, b.pos))[0] || null;
  }

  nextNestFor(b) {
    const enemy = ENEMY[b.team];
    const inLane = this.nests.filter((n) => n.alive && n.team === enemy && n.lane === b.ai.lane)
      .sort((x, y) => (x.slot === 'outer' ? 0 : 1) - (y.slot === 'outer' ? 0 : 1));
    if (inLane.length) return inLane[0];
    const others = this.nests.filter((n) => n.alive && n.team === enemy && n.kind === 'lane').sort((x, y) => dist2(x.pos, b.pos) - dist2(y.pos, b.pos));
    const main = this.nests.find((n) => n.alive && n.team === enemy && n.kind === 'main');
    // with its own lane cleared, head for the main nest
    return main || others[0] || null;
  }

  laneWaypoint(b, nest) {
    if (nest.kind === 'main' || !this.lanes[b.ai.lane]) {
      const lane = this.lanes[b.ai.lane];
      if (!lane) return nest.pos;
      const myIdx = this.nearestPathIdx(lane.pts, b.pos);
      const endIdx = nest.team === 'red' ? lane.pts.length - 1 : 0;
      if (Math.abs(endIdx - myIdx) < 10 || dist2(lane.pts[myIdx], b.pos) > 12) return nest.pos;
      return lane.pts[myIdx + Math.sign(endIdx - myIdx) * 5];
    }
    const lane = this.lanes[b.ai.lane];
    const myIdx = this.nearestPathIdx(lane.pts, b.pos);
    if (dist2(lane.pts[myIdx], b.pos) > 10) return lane.pts[myIdx];
    const dir = Math.sign(nest.pathIdx - myIdx);
    if (dir === 0 || Math.abs(nest.pathIdx - myIdx) < 6) return nest.pos;
    return lane.pts[Math.max(0, Math.min(lane.pts.length - 1, myIdx + dir * 5))];
  }

  nearestPathIdx(pts, pos) {
    let best = 0, bd = Infinity;
    for (let i = 0; i < pts.length; i += 2) {
      const d = (pts[i].x - pos.x) ** 2 + (pts[i].z - pos.z) ** 2;
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    return best;
  }

  // ------------------------------------------------------------ combat

  dmgMul(e) {
    let m = 1;
    if (e.mut.has('brute')) m += 0.15;
    if (e.mut.has('adrenaline')) m += 0.1;
    if (e.fx.buffDmgT > 0) m += 0.25;
    if (this.teamBuff[e.team] > 0) m += 0.2;
    return m;
  }

  targetsFor(e) {
    const list = [];
    for (const c of this.creatures) if (c.team !== e.team && c.state !== 'dead') list.push(c);
    for (const n of this.nests) if (n.alive && n.team !== e.team) list.push(n);
    for (const n of this.neutrals) if (n.alive) list.push(n);
    return list;
  }

  tryAttack(e, i) {
    const a = e.st.attacks[i];
    if (!a || e.state !== 'alive' || e.cds[i] > 0 || e.stamina < a.cost || e.fx.hideT > 0 || e.fx.stunT > 0 || e.fx.puffT > 0) return false;
    e.cds[i] = a.cd;
    e.stamina -= a.cost;
    e.fx.attackT = 0.25;
    const mul = this.dmgMul(e);
    const fwd = new THREE.Vector3(Math.sin(e.face), 0, Math.cos(e.face));
    if (a.kind === 'ranged') {
      const m = this.boltMesh(0x9dff3a, 0.16);
      m.position.set(e.pos.x + fwd.x * 1.4, 1.2, e.pos.z + fwd.z * 1.4);
      this.scene.add(m);
      this.projectiles.push({ mesh: m, pos: m.position, vel: fwd.multiplyScalar(a.speed), team: e.team, src: e, dmg: a.dmg * mul, dtype: a.dtype, life: a.range / a.speed, kb: 1 });
      return true;
    }
    if (a.kind === 'aoe') {
      this.ringFx(e.pos, a.range, 0xffe14d);
      for (const t of this.targetsFor(e)) if (dist2(t.pos, e.pos) - t.radius <= a.range) this.damage(t, a.dmg * mul, a.dtype, e, { kb: a.kb });
      return true;
    }
    this.swingFx(e, a);
    for (const t of this.targetsFor(e)) {
      const d = dist2(t.pos, e.pos) - t.radius;
      if (d > a.range) continue;
      if (d > 0.4 && angDiff(e.face, angTo(e.pos, t.pos)) > ((a.arc || 80) * Math.PI) / 360) continue;
      this.damage(t, a.dmg * mul, a.dtype, e, { kb: a.kb, melee: true, poison: a.poison });
    }
    return true;
  }

  tryDodge(e, dir) {
    if (e.dodgeCd > 0 || e.stamina < 25 || e.state !== 'alive' || e.fx.stunT > 0 || e.fx.hideT > 0) return;
    e.dodgeCd = 0.8;
    e.stamina -= 25;
    e.fx.dashT = 0.22;
    e.fx.invulnT = 0.25;
    e.fx.dashVel.copy(dir).normalize().multiplyScalar(16);
  }

  trySpecial(e, aimPoint) {
    const sp = e.st.special;
    if (!sp || e.specialCd > 0 || e.state !== 'alive' || e.fx.stunT > 0) return;
    e.specialCd = SPECIALS[sp].cd;
    const fwd = new THREE.Vector3(Math.sin(e.face), 0, Math.cos(e.face));
    const mul = this.dmgMul(e);
    const allies = this.creatures.filter((c) => c.team === e.team && c.state === 'alive' && dist2(c.pos, e.pos) < 6);
    switch (sp) {
      case 'charge':
        e.fx.dashT = 0.45;
        e.fx.dashVel.copy(fwd).multiplyScalar(22);
        e.chargeHits = new Set();
        e.chargeMul = mul;
        break;
      case 'spin':
        e.fx.emoteT = 0.4;
        this.ringFx(e.pos, 3.6, 0xffffff);
        for (const t of this.targetsFor(e)) if (dist2(t.pos, e.pos) - t.radius < 3.6) this.damage(t, 18 * mul, 'blunt', e, { kb: 7, melee: true });
        break;
      case 'glide': {
        const dir = aimPoint ? new THREE.Vector3(aimPoint.x - e.pos.x, 0, aimPoint.z - e.pos.z).normalize() : fwd;
        e.fx.dashT = 0.6;
        e.fx.glideT = 0.7;
        e.fx.dashVel.copy(dir).multiplyScalar(24);
        e.vy = 6;
        e.y = 0.01;
        break;
      }
      case 'hide':
        e.fx.hideT = 2.5;
        break;
      case 'heal':
        this.ringFx(e.pos, 6, 0x5aff9a);
        for (const a of allies) {
          const amt = a === e ? 30 : 20;
          a.hp = Math.min(a.maxHp, a.hp + amt);
          this.floatText(a.pos, `+${amt}`, '#5aff9a');
        }
        break;
      case 'shield':
        this.ringFx(e.pos, 6, 0x5ae0ff);
        for (const a of allies) {
          a.fx.shield = 40;
          a.fx.shieldT = 5;
        }
        break;
      case 'ink': {
        const m = new THREE.Mesh(new THREE.SphereGeometry(5, 24, 14), new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 1, transparent: true, opacity: 0.55, depthWrite: false }));
        m.scale.y = 0.35;
        m.position.set(e.pos.x, 0.8, e.pos.z);
        this.scene.add(m);
        this.clouds.push({ pos: e.pos.clone(), r: 5, t: 4.5, team: e.team, mesh: m });
        break;
      }
      case 'puff':
        e.fx.puffT = 1.5;
        for (const t of this.targetsFor(e)) {
          if (t.type === 'creature' && dist2(t.pos, e.pos) < 3.2) this.knock(t, e.pos, 9);
        }
        break;
      case 'pounce': {
        const target = aimPoint ? aimPoint.clone() : e.pos.clone().addScaledVector(fwd, 8);
        const v = new THREE.Vector3(target.x - e.pos.x, 0, target.z - e.pos.z);
        const d = Math.min(9, v.length());
        v.normalize();
        e.vy = 11;
        e.y = 0.01;
        e.fx.dashT = 0.72;
        e.fx.dashVel.copy(v).multiplyScalar(d / 0.72);
        e.pounceLand = true;
        e.pounceMul = mul;
        break;
      }
    }
  }

  chargeTick(e) {
    if (e.fx.dashT <= 0) {
      e.chargeHits = null;
      return;
    }
    for (const t of this.targetsFor(e)) {
      if (e.chargeHits.has(t) || dist2(t.pos, e.pos) - t.radius > 1.4) continue;
      e.chargeHits.add(t);
      this.damage(t, 15 * e.chargeMul, 'blunt', e, { kb: 10, melee: true });
    }
  }

  pounceLand(e) {
    this.ringFx(e.pos, 3.4, 0xffffff);
    for (const t of this.targetsFor(e)) if (dist2(t.pos, e.pos) - t.radius < 3.4) this.damage(t, 12 * (e.pounceMul || 1), 'blunt', e, { kb: 6 });
  }

  knock(t, from, amount) {
    const dir = new THREE.Vector3(t.pos.x - from.x, 0, t.pos.z - from.z);
    if (dir.lengthSq() < 0.0001) dir.set(Math.random() - 0.5, 0, Math.random() - 0.5);
    dir.normalize();
    const impulse = amount * (1 - (t.st?.kbResist || 0)) * 1.6;
    t.kb.addScaledVector(dir, impulse);
    // long legs and big heads tip over; stable builds shrug it off
    if (t.st && impulse > 7 + t.st.stability * 1.3 && t.state === 'alive') {
      t.fx.stunT = 0.9;
      this.floatText(t.pos, 'STAGGERED', '#ffd84d');
    }
  }

  damage(t, amt, dtype, src, o = {}) {
    if (src?.isPlayer && !o.silent && (t.type === 'creature' ? t.state !== 'dead' : t.alive)) this.hitMarkT = 0.14;
    if (t.type === 'creature') return this.damageCreature(t, amt, dtype, src, o);
    if (!t.alive) return;
    if (t.type === 'nest') {
      t.hp -= amt;
      t.hitT = 0.15;
      if (src) t.lastHit = src;
      this.floatText(t.pos, Math.round(amt), '#ffffff', 2.5);
      if (t.hp <= 0) this.destroyNest(t, src);
      return;
    }
    // neutrals
    t.hp -= amt;
    t.hitT = 0.15;
    t.lastHitT = this.time;
    if (src?.type === 'creature') {
      t.aggro = src;
      t.aggroT = 6;
    }
    if (t.kind !== 'dummy') this.floatText(t.pos, Math.round(amt), '#ffffff', t.kind === 'boss' ? 4.5 : 1.5);
    else this.floatText(t.pos, `${Math.round(amt)} ${dtype}`, '#ffd84d', 2.5);
    if (t.hp <= 0) this.killNeutral(t, src);
  }

  damageCreature(t, amt, dtype, src, o = {}) {
    if (t.state === 'dead') return;
    if (t.isPlayer && devConsole.godMode) return o.silent || this.floatText(t.pos, 'GOD', '#ffd84d');
    if (t.fx.invulnT > 0 && !o.silent) return this.floatText(t.pos, 'dodged', '#7cf2ff');
    if (t.fx.glideT > 0 && o.hazard) return;
    if (t.fx.puffT > 0 && !o.silent) {
      if (src?.type === 'creature' && o.melee) this.knock(src, t.pos, 6);
      return this.floatText(t.pos, 'deflected', '#9fd8ff');
    }
    const armor = t.st.armor + (t.mut.has('hide') ? 0.1 : 0);
    const factor = { slash: 1.5, venom: 0, acid: 0.5, zap: 0.5 }[dtype] ?? 1;
    amt *= 1 - Math.min(0.75, armor * factor);
    if (t.fx.hideT > 0) amt *= 0.2;
    if (t.fx.shield > 0) {
      const absorbed = Math.min(t.fx.shield, amt);
      t.fx.shield -= absorbed;
      amt -= absorbed;
    }
    if (src?.type === 'creature') src.k.dmg += amt;
    if (!o.silent) {
      t.fx.hitT = 0.12;
      this.floatText(t.pos, Math.max(1, Math.round(amt)), t.isPlayer ? '#ff6f8b' : '#ffffff');
    }
    if (o.kb) this.knock(t, src?.pos || t.pos, o.kb);

    if (t.state === 'downed') {
      t.downedHp -= amt;
      if (t.downedHp <= 0) this.kill(t, t.downedBy || src);
      return;
    }
    t.hp -= amt;
    if (src) t.lastHit = src;
    if (o.poison) t.fx.poison = { dps: o.poison, t: 4, src };
    if (src?.type === 'creature' && src.mut.has('venom') && o.melee && !t.fx.poison) t.fx.poison = { dps: 2, t: 3, src };
    const thorns = t.st.thorns + (t.mut.has('thorns') ? 3 : 0);
    if (o.melee && thorns > 0 && src?.type === 'creature' && src.state === 'alive') this.damageCreature(src, thorns, 'blunt', t, {});
    if (t.hp <= 0) this.down(t, src);
  }

  down(t, src) {
    if (this.mode === 'testdrive' && !t.ai.devBot) {
      // no permadeath while test driving
      t.hp = t.maxHp;
      this.floatText(t.pos, 'Restored (Test Drive)', '#ffd84d');
      return;
    }
    if (this.mode === 'testdrive') return this.kill(t, src);
    t.state = 'downed';
    t.hp = 0;
    t.downedT = DOWNED_SECONDS;
    t.downedHp = 30;
    t.reviveT = 0;
    t.downedBy = src?.type === 'creature' ? src : t.lastHit?.type === 'creature' ? t.lastHit : null;
    t.fx.poison = null;
    t.vel.set(0, 0, 0);
    this.feed(`${t.name} is down`, t.team);
    if (t.isPlayer) this.message('You\'re downed! A teammate can revive you.');
  }

  kill(t, src) {
    if (t.state === 'dead') return;
    t.state = 'dead';
    t.deathT = 0;
    // launched skyward, spinning, trailing light; it bursts high above the arena
    t.vy = rnd(24, 30);
    t.y = Math.max(t.y, 0.01);
    t.spin = rnd(7, 12) * (Math.random() < 0.5 ? -1 : 1);
    t.trailT = 0;
    const away = src?.pos ? new THREE.Vector3(t.pos.x - src.pos.x, 0, t.pos.z - src.pos.z).normalize() : new THREE.Vector3(0, 0, 1);
    t.kb.copy(away.multiplyScalar(4));
    this.deathBurst(t);
    const close = dist2(t.pos, this.player.pos) < 22;
    if (src?.isPlayer || close) {
      this.slowmo = Math.max(this.slowmo, 0.45); // hit-stop
      this.shake = Math.max(this.shake, close ? 0.6 : 0.3);
    }
    if (src?.isPlayer) {
      this.killMarkT = 0.5;
      this.killCam = { e: t, t: 0 }; // tilt the view up to watch it fly
    }
    this.deaths[t.team] += 1;
    const killer = src?.type === 'creature' && src.team !== t.team ? src : null;
    this.feed(killer ? `${killer.name} ⟶ ${t.name}` : `${t.name} was defeated`, killer ? killer.team : t.team);
    if (killer) {
      killer.k.kills += 1;
      killer.fx.emoteT = 1.2;
      this.absorbMutation(killer, t);
      if (killer.isPlayer) this.playerKillRewards(t);
    }
    if (t.isPlayer) this.playerDied(killer);
  }

  absorbMutation(killer, victim) {
    const options = [...new Set(partsOf(victim.data).map((p) => PART_MUTATION[p.id]).filter(Boolean))].filter((m) => !killer.mut.has(m));
    const m = options.length ? pick(options) : killer.mut.has('adrenaline') ? null : 'adrenaline';
    if (!m) return;
    killer.mut.add(m);
    if (killer.isPlayer) this.message(`Mutation absorbed: ${MUTATIONS[m].name} (${MUTATIONS[m].desc})`);
  }

  playerKillRewards(victim) {
    const dna = grantKillDNA({ mode: this.mode, killerIsLocalPlayer: true, victimIsBot: victim.isBot });
    if (dna) {
      this.rewards.dna += dna;
      this.floatText(victim.pos, `+${dna} DNA`, '#9dff6a', 3);
    }
    if (this.mode !== 'match') return;
    const unlocked = getProfile().unlocked;
    const candidates = partsOf(victim.data).filter((p) => !unlocked.includes(p.id));
    if (candidates.length && Math.random() < PART_DROP_CHANCE) {
      const part = pick(candidates);
      obtainDrop(part.id);
      this.rewards.drops.push(part.id);
      this.message(`Part dropped: ${part.name}! It's yours for your next battle.`);
    }
  }

  playerDied(killer) {
    this.slowmo = 1.1;
    this.deathCam = true;
    this.deathAnchor = this.player.pos.clone();
    this.hud.downed.hidden = true;
    this.releaseLock();
    this.updateCursorUi();
    const caption = pick(DEATH_CAPTIONS);
    if (killer) killer.fx.emoteT = 3;
    // shown once the creature bursts in the sky (see updateCorpse)
    this.afterSkyBurst = () => {
      this.deathCam = false;
      this.onPlayerDeath?.({ caption, killer: killer ? { name: killer.name, data: killer.data } : null, stats: { ...this.player.k }, rewards: this.rewardSummary(false) });
    };
  }

  destroyNest(n, src) {
    n.alive = false;
    n.hp = 0;
    n.mesh.children.forEach((c) => c !== n.bar.group && (c.visible = false));
    n.bar.group.visible = false;
    const debris = new THREE.MeshStandardMaterial({ color: 0x1a1c20, roughness: 0.7, metalness: 0.6 });
    const rubble = new THREE.Mesh(new THREE.CylinderGeometry(n.radius * 0.9, n.radius * 1.1, 0.3, 6), debris);
    rubble.position.y = 0.15;
    n.mesh.add(rubble);
    for (let i = 0; i < 6; i++) {
      const chunk = new THREE.Mesh(new THREE.BoxGeometry(rnd(0.3, 0.8), rnd(0.2, 0.5), rnd(0.3, 0.8)).scale(n.radius / 2, n.radius / 2, n.radius / 2), debris);
      chunk.position.set(rnd(-1, 1) * n.radius, 0.3, rnd(-1, 1) * n.radius);
      chunk.rotation.set(rnd(0, 3), rnd(0, 3), rnd(0, 3));
      n.mesh.add(chunk);
    }
    this.ringFx(n.pos, n.radius * 3, TEAM_COLOR[n.team]);
    if (src?.type === 'creature') src.k.nests += 1;
    const label = n.kind === 'main' ? 'MAIN NEST' : `${LANE_NAMES[n.lane]} ${n.slot} nest`;
    this.feed(`${TEAM_LABEL[n.team]} ${label} destroyed!`, ENEMY[n.team]);
    this.message(`${n.team === 'blue' ? 'Our' : 'Enemy'} ${label} destroyed!`);
    this.checkWin();
  }

  checkWin() {
    if (this.mode !== 'match' || this.ended) return;
    const alive = (t) => this.nests.filter((n) => n.team === t && n.alive).length;
    if (alive('blue') === 0) return this.end('red', 'Blue lost all its nests');
    if (alive('red') === 0) return this.end('blue', 'Red lost all its nests');
    const mainsDown = this.nests.filter((n) => n.kind === 'main' && !n.alive).length === 2;
    if (mainsDown) this.tiebreak('Both main nests were destroyed');
  }

  // Destroyed-nest count, then fewer total deaths.
  tiebreak(reason) {
    if (this.ended) return;
    const destroyedBy = (t) => this.nests.filter((n) => n.team === ENEMY[t] && !n.alive).length;
    const b = destroyedBy('blue');
    const r = destroyedBy('red');
    if (b !== r) return this.end(b > r ? 'blue' : 'red', `${reason}. Nests destroyed ${b}–${r}`);
    if (this.deaths.blue !== this.deaths.red) return this.end(this.deaths.blue < this.deaths.red ? 'blue' : 'red', `${reason}. Nests tied ${b}–${r}; fewer deaths (${this.deaths.blue}–${this.deaths.red})`);
    this.end(null, `${reason}. Nests and deaths tied`);
  }

  end(winner, reason) {
    this.ended = true;
    this.winner = winner;
    this.endReason = reason;
    this.message(winner === 'blue' ? 'VICTORY' : winner === 'red' ? 'DEFEAT' : 'DRAW', 'big');
    setTimeout(() => this.onEnd?.(this.rewardSummary(true)), 2600);
  }

  rewardSummary(final) {
    const k = this.player.k;
    const won = final && this.winner === 'blue';
    const xp = XP_REWARD.played + (won ? XP_REWARD.win : 0) + k.kills * XP_REWARD.kill + k.nests * XP_REWARD.nest + k.revives * XP_REWARD.revive;
    return {
      final, won, draw: final && this.winner === null, reason: this.endReason, xp,
      dna: this.rewards.dna, drops: [...this.rewards.drops], kills: k.kills, nests: k.nests, revives: k.revives,
      survived: this.player.state !== 'dead', biome: this.biome.name,
      roster: this.creatures.filter((c) => !c.ai.devBot).map((c) => ({ name: c.name, team: c.team, isPlayer: c.isPlayer, kills: c.k.kills, nests: c.k.nests, alive: c.state !== 'dead' })),
      deaths: { ...this.deaths },
      nestsDestroyed: { blue: this.nests.filter((n) => n.team === 'red' && !n.alive).length, red: this.nests.filter((n) => n.team === 'blue' && !n.alive).length },
    };
  }

  // ---- nests, neutrals, projectiles, hazards

  updateNest(n, dt) {
    if (!n.alive) return;
    n.bar.set(n.hp / n.maxHp);
    this.faceCamera(n.bar.group);
    n.hitT = Math.max(0, n.hitT - dt);
    n.egg.rotation.y += dt * 0.6;
    n.egg.position.y = n.radius * 1.25 + Math.sin(this.time * 1.6 + n.pos.x) * 0.08;
    n.ring.rotation.z -= dt * 0.9;
    n.coreMat.emissiveIntensity = 1.4 + Math.sin(this.time * 3) * 0.2 + n.hitT * 10;
    n.cd -= dt;
    if (n.cd > 0) return;
    const foes = this.creatures.filter((c) => c.team !== n.team && c.state === 'alive' && dist2(c.pos, n.pos) < n.cfg.range)
      .sort((a, b) => dist2(a.pos, n.pos) - dist2(b.pos, n.pos));
    if (!foes.length) return;
    n.cd = n.cfg.cd;
    const t = foes[0];
    const from = new THREE.Vector3(n.pos.x, n.radius * 1.25, n.pos.z);
    const dir = new THREE.Vector3(t.pos.x - from.x, 1 - from.y, t.pos.z - from.z).normalize();
    const m = this.boltMesh(TEAM_COLOR[n.team], 0.18);
    m.position.copy(from);
    this.scene.add(m);
    this.projectiles.push({ mesh: m, pos: m.position, vel: dir.multiplyScalar(18), team: n.team, src: n, dmg: n.cfg.dmg, dtype: 'acid', life: 1.2, homing: t });
  }

  updateNeutral(n, dt) {
    if (!n.alive) {
      n.respawn -= dt;
      if (n.respawn <= 0 && n.kind !== 'dummy') {
        n.alive = true;
        n.hp = n.maxHp;
        n.pos.copy(n.home);
        n.mesh.visible = true;
        n.aggro = null;
      }
      return;
    }
    n.bar.set(n.hp / n.maxHp);
    this.faceCamera(n.bar.group);
    n.hitT = Math.max(0, n.hitT - dt);
    n.mesh.scale.setScalar(1 + n.hitT * 0.4);
    if (n.kind === 'dummy') {
      n.mesh.rotation.z = Math.sin(this.time * 20) * n.hitT * 2;
      if (this.time - n.lastHitT > 3) n.hp = n.maxHp;
      return;
    }
    n.aggroT -= dt;
    if (n.aggro && (n.aggroT <= 0 || n.aggro.state === 'dead' || dist2(n.aggro.pos, n.home) > 16)) {
      n.aggro = null;
      if (n.kind === 'boss') n.hp = n.maxHp; // leash reset
    }
    n.cd -= dt;
    if (n.kind === 'glump') {
      let dir;
      if (n.aggro) dir = new THREE.Vector3(n.aggro.pos.x - n.pos.x, 0, n.aggro.pos.z - n.pos.z);
      else {
        n.wander += dt * 0.5;
        const goal = n.home.clone().add(new THREE.Vector3(Math.cos(n.wander) * 3, 0, Math.sin(n.wander * 1.3) * 3));
        dir = goal.sub(n.pos);
      }
      if (dir.length() > 1.4) n.pos.addScaledVector(dir.normalize(), dt * (n.aggro ? 3.2 : 1.2));
      n.mesh.rotation.y = Math.atan2(dir.x, dir.z);
      n.mesh.position.y = Math.abs(Math.sin(this.time * 9 + n.home.x)) * 0.04;
      if (n.aggro && n.cd <= 0 && dist2(n.aggro.pos, n.pos) < 2) {
        n.cd = 1.2;
        this.damageCreature(n.aggro, 4, 'bite', n, {});
      }
    } else if (n.kind === 'boss') {
      n.mesh.scale.y = 1 + Math.sin(this.time * 1.4) * 0.015;
      const near = this.creatures.filter((c) => c.state === 'alive' && dist2(c.pos, n.pos) < 5.5);
      if ((n.aggro || near.length) && n.cd <= 0 && near.length) {
        n.cd = 2.6;
        this.ringFx(n.pos, 5.5, 0xb46bff);
        for (const c of near) this.damageCreature(c, 16, 'blunt', n, { kb: 7 });
      }
    }
  }

  killNeutral(n, src) {
    n.alive = false;
    n.mesh.visible = false;
    if (n.kind === 'dummy') {
      n.alive = true;
      n.hp = n.maxHp;
      n.mesh.visible = true;
      this.floatText(n.pos, 'Target reset', '#ffd84d', 3);
      return;
    }
    n.respawn = n.kind === 'boss' ? 120 : 40;
    if (n.kind === 'boss') {
      if (src?.type === 'creature') {
        this.teamBuff[src.team] = 90;
        this.feed(`${TEAM_LABEL[src.team]} brought down the Titan!`, src.team);
        this.message(src.team === 'blue' ? 'Titan Core: +20% damage and regen for 90s' : 'Enemy team took the Titan Core!');
      }
      return;
    }
    // neutral creatures give health or a temporary mutation, never DNA
    const health = Math.random() < 0.6;
    const m = new THREE.Mesh(new THREE.OctahedronGeometry(0.35), glowMat(health ? 0x4dff9a : 0xffb020, 2.4));
    m.position.set(n.pos.x, 0.8, n.pos.z);
    this.scene.add(m);
    this.pickups.push({ mesh: m, pos: m.position, kind: health ? 'health' : pick(['speed', 'damage']), t: 30 });
  }

  updatePickups(dt) {
    this.pickups = this.pickups.filter((p) => {
      p.t -= dt;
      p.mesh.rotation.y += dt * 3;
      p.mesh.position.y = 0.8 + Math.sin(this.time * 4) * 0.2;
      const c = this.creatures.find((x) => x.state === 'alive' && dist2(x.pos, p.pos) < 1.6);
      if (c) {
        if (p.kind === 'health') {
          c.hp = Math.min(c.maxHp, c.hp + 35);
          this.floatText(c.pos, '+35', '#5aff9a');
        } else if (p.kind === 'speed') {
          c.fx.buffSpdT = 40;
          this.floatText(c.pos, 'OVERDRIVE', '#ffb020');
        } else {
          c.fx.buffDmgT = 40;
          this.floatText(c.pos, 'FRENZY', '#ffb020');
        }
      }
      if (c || p.t <= 0) {
        this.scene.remove(p.mesh);
        return false;
      }
      return true;
    });
  }

  updateProjectiles(dt) {
    this.projectiles = this.projectiles.filter((p) => {
      p.life -= dt;
      if (p.homing && p.homing.state === 'alive') {
        const want = new THREE.Vector3(p.homing.pos.x - p.pos.x, 1 - p.pos.y, p.homing.pos.z - p.pos.z).normalize().multiplyScalar(18);
        p.vel.lerp(want, Math.min(1, dt * 6));
      }
      // weapon shots steer toward their locked target
      if (p.seek && p.target && (p.target.type === 'creature' ? p.target.state !== 'dead' : p.target.alive)) {
        const speed = p.vel.length();
        const want = new THREE.Vector3(p.target.pos.x - p.pos.x, 1 + (p.target.y || 0) - p.pos.y, p.target.pos.z - p.pos.z).normalize().multiplyScalar(speed);
        p.vel.lerp(want, Math.min(1, dt * p.seek)).setLength(speed);
      }
      if (p.gravity) p.vel.y -= p.gravity * dt;
      p.pos.addScaledVector(p.vel, dt);
      p.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), p.vel.clone().normalize());
      if (p.lob) {
        if (p.pos.y > 0.15 && p.life > 0) return true;
        this.blast(p.pos, p.radius, p.dmg, p.dtype, p.src, p.kb, p.color);
        this.removeProjectile(p);
        return false;
      }
      let hit = null;
      const r = p.hitR ?? 0.3;
      if (p.src.type === 'nest') {
        hit = this.creatures.find((c) => c.team !== p.team && c.state === 'alive' && dist2(c.pos, p.pos) < c.radius + r);
      } else {
        hit = this.targetsFor(p.src).find((t) => dist2(t.pos, p.pos) < t.radius + r);
      }
      if (hit) {
        this.damage(hit, p.dmg, p.dtype, p.src, { kb: p.kb || 0 });
        if (p.color) this.sparks(p.pos, p.color, 6, 6);
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

  // ---- weapons (left click)

  // Aim assist: the target nearest the aim line within the weapon's reach, favoring creatures.
  assistTarget(e, range) {
    const aimYaw = angTo(e.pos, this.mouse.ground);
    let best = null;
    for (const t of this.targetsFor(e)) {
      const d = dist2(e.pos, t.pos);
      if (d - t.radius > range) continue;
      const off = angDiff(aimYaw, angTo(e.pos, t.pos));
      if (off > 0.7) continue;
      const miss = d * Math.sin(off) - t.radius;
      if (miss > 2.2 + d * 0.06) continue;
      const score = miss + d * 0.05 + (t.type === 'creature' ? 0 : 2);
      if (!best || score < best[1]) best = [t, score];
    }
    return best?.[0] || null;
  }

  muzzleOf(e) {
    const m = e.built.anim.muzzle;
    const v = new THREE.Vector3();
    if (!m) return v.set(e.pos.x, 1.2 + e.y, e.pos.z);
    m.updateWorldMatrix(true, false);
    return m.getWorldPosition(v);
  }

  // Fires toward a locked target (leading it a little) or the aim point.
  fireWeapon(e, aimPoint, lock) {
    const w = e.st.weapon;
    if (e.state !== 'alive' || e.weaponCd > 0 || e.fx.hideT > 0 || e.fx.stunT > 0 || e.fx.puffT > 0) return false;
    if (lock && (lock.type === 'creature' ? lock.state === 'dead' : !lock.alive)) lock = null;
    e.weaponCd = w.cd * (e.isBot ? 1.6 : 1);
    e.fx.fireT = 0.12;
    const mul = this.dmgMul(e);
    let aim = aimPoint.clone();
    if (lock) {
      aim.set(lock.pos.x, 0, lock.pos.z);
      if (lock.vel && w.kind === 'shot') aim.addScaledVector(lock.vel, Math.min(0.6, dist2(e.pos, lock.pos) / (w.speed || 30)));
    }
    e.face = angTo(e.pos, aim);
    if (e.isPlayer) e.wantFace = e.face;
    e.group.updateMatrixWorld(true);
    const muzzle = this.muzzleOf(e);
    this.flash(muzzle, w.color, 0.35, 0.06);
    const sloppy = e.isBot ? 0.09 : 0;
    const aimH = new THREE.Vector3(aim.x - muzzle.x, 0, aim.z - muzzle.z);
    const flat = aimH.length();
    switch (w.kind) {
      case 'shot':
        for (let i = 0; i < (w.pellets || 1); i++) {
          const yaw = Math.atan2(aimH.x, aimH.z) + (Math.random() - 0.5) * 2 * ((w.spread || 0) + sloppy);
          const drop = (1 - muzzle.y) / Math.max(4, flat);
          const dir = new THREE.Vector3(Math.sin(yaw), drop, Math.cos(yaw)).normalize();
          const m = this.boltMesh(w.color, w.pellets > 1 ? 0.06 : 0.08);
          m.position.copy(muzzle);
          this.scene.add(m);
          this.projectiles.push({
            mesh: m, pos: m.position, vel: dir.multiplyScalar(w.speed), team: e.team, src: e, dmg: w.dmg * mul, dtype: w.dtype, life: w.range / w.speed, kb: w.kb,
            target: lock, seek: lock ? w.homing * (e.isBot ? 0.3 : 1) : 0, hitR: e.isPlayer ? 0.75 : 0.35, color: w.color,
          });
        }
        break;
      case 'lob': {
        const dest = new THREE.Vector3(aim.x, 0, aim.z);
        const off = dest.clone().sub(new THREE.Vector3(e.pos.x, 0, e.pos.z));
        if (off.length() > w.range) dest.copy(e.pos).add(off.setLength(w.range)).setY(0);
        if (sloppy) dest.add(new THREE.Vector3(rnd(-1.5, 1.5), 0, rnd(-1.5, 1.5)));
        const t = w.flight;
        const g = 24;
        const vel = new THREE.Vector3((dest.x - muzzle.x) / t, (0 - muzzle.y + 0.5 * g * t * t) / t, (dest.z - muzzle.z) / t);
        const m = this.boltMesh(w.color, 0.2);
        m.position.copy(muzzle);
        this.scene.add(m);
        this.projectiles.push({ mesh: m, pos: m.position, vel, gravity: g, lob: true, team: e.team, src: e, dmg: w.dmg * mul, dtype: w.dtype, life: t + 0.5, kb: w.kb, radius: w.radius, color: w.color });
        this.groundMarker(dest, w.radius, w.color, t);
        break;
      }
      case 'beam': {
        const yaw = Math.atan2(aimH.x, aimH.z) + (Math.random() - 0.5) * sloppy;
        const dir = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
        const tol = e.isPlayer ? 0.9 : 0.4;
        for (const t of this.targetsFor(e)) {
          const rel = new THREE.Vector3(t.pos.x - e.pos.x, 0, t.pos.z - e.pos.z);
          const along = rel.dot(dir);
          if (along < 0 || along > w.range) continue;
          if (rel.addScaledVector(dir, -along).length() > t.radius + tol) continue;
          this.damage(t, w.dmg * mul, w.dtype, e, { kb: w.kb });
          this.sparks(new THREE.Vector3(t.pos.x, 1, t.pos.z), w.color, 8, 7);
        }
        const end = muzzle.clone().addScaledVector(dir, w.range);
        end.y = 1;
        this.beamFx(muzzle, end, w.color, 0.09, 0.22);
        if (e.isPlayer || dist2(e.pos, this.player.pos) < 15) this.shake = Math.max(this.shake || 0, 0.15);
        break;
      }
      case 'chain': {
        let cur = lock && dist2(lock.pos, e.pos) - lock.radius <= w.range ? lock : null;
        if (!cur) {
          const yaw = Math.atan2(aimH.x, aimH.z);
          cur = this.targetsFor(e).filter((t) => dist2(t.pos, e.pos) - t.radius <= w.range && angDiff(yaw, angTo(e.pos, t.pos)) < 0.5)
            .sort((a, b) => dist2(a.pos, e.pos) - dist2(b.pos, e.pos))[0];
        }
        let from = muzzle;
        const hit = new Set();
        for (let i = 0; cur && i <= w.chains; i++) {
          hit.add(cur);
          const to = new THREE.Vector3(cur.pos.x, 1 + (cur.y || 0), cur.pos.z);
          this.lightningFx(from, to, w.color);
          this.damage(cur, w.dmg * mul * (i ? 0.75 : 1), w.dtype, e, { kb: w.kb });
          from = to;
          cur = this.targetsFor(e).filter((t) => !hit.has(t) && dist2(t.pos, cur.pos) < w.chainRange).sort((a, b) => dist2(a.pos, cur.pos) - dist2(b.pos, cur.pos))[0];
        }
        if (!hit.size) {
          const yaw = Math.atan2(aimH.x, aimH.z);
          this.lightningFx(muzzle, muzzle.clone().add(new THREE.Vector3(Math.sin(yaw) * 5, 0, Math.cos(yaw) * 5)), w.color);
        }
        break;
      }
    }
    return true;
  }

  blast(pos, radius, dmg, dtype, src, kb, color) {
    const at = new THREE.Vector3(pos.x, 0, pos.z);
    this.ringFx(at, radius, color);
    this.flash(new THREE.Vector3(pos.x, 0.6, pos.z), color, radius * 0.7, 0.18);
    this.sparks(new THREE.Vector3(pos.x, 0.4, pos.z), color, 16, 9);
    for (const t of this.targetsFor(src)) if (dist2(t.pos, at) - t.radius <= radius) this.damage(t, dmg, dtype, src, { kb });
    if (dist2(at, this.player.pos) < 18) this.shake = Math.max(this.shake || 0, 0.25);
  }

  updateHazards(dt) {
    for (const hz of this.hazards) {
      hz.t += dt;
      const phase = hz.t % hz.period;
      const warnAt = hz.period - 1.9;
      const state = phase < warnAt ? 'idle' : phase < hz.period - 0.6 ? 'warn' : 'erupt';
      if (state === 'erupt' && hz.state !== 'erupt') {
        for (const c of this.creatures) {
          if (c.state === 'dead' || dist2(c.pos, hz.pos) > hz.radius) continue;
          if (c.fx.glideT > 0) continue;
          this.damageCreature(c, 14, 'blunt', null, { hazard: true });
          c.vy = 12;
          c.y = 0.01;
          this.knock(c, hz.pos, 4);
        }
      }
      hz.state = state;
      hz.ring.material.opacity = state === 'warn' ? 0.5 + Math.sin(this.time * 25) * 0.4 : 0.2;
      hz.hole.material.emissiveIntensity = state === 'erupt' ? 4 : state === 'warn' ? 1.5 + Math.sin(this.time * 25) : 0.6;
      hz.col.material.opacity = state === 'erupt' ? 0.55 : 0;
      hz.col.scale.y = state === 'erupt' ? 1 + Math.sin(this.time * 30) * 0.05 : 0.1;
    }
  }

  inEnemyInk(c) {
    return this.clouds.some((cl) => cl.team !== c.team && dist2(cl.pos, c.pos) < cl.r);
  }

  updateClouds(dt) {
    this.clouds = this.clouds.filter((cl) => {
      cl.t -= dt;
      cl.mesh.material.opacity = Math.min(0.55, cl.t * 0.4);
      if (cl.t > 0) return true;
      this.scene.remove(cl.mesh);
      return false;
    });
  }

  // ---- visual fx

  ringFx(pos, r, color) {
    const m = new THREE.Mesh(new THREE.RingGeometry(r * 0.9, r, 64), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(pos.x, 0.15, pos.z);
    this.scene.add(m);
    this.fx.push({ mesh: m, t: 0, life: 0.4, grow: true });
  }

  swingFx(e, a) {
    const arc = ((a.arc || 80) * Math.PI) / 180;
    const col = new THREE.Color(e.built.anim.mats?.glow.emissive ?? 0xffffff);
    const m = new THREE.Mesh(new THREE.RingGeometry(a.range * 0.75, a.range + 0.5, 24, 1, -arc / 2, arc), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
    m.rotation.x = -Math.PI / 2;
    m.rotation.z = e.face - Math.PI / 2;
    m.position.set(e.pos.x, 0.9, e.pos.z);
    this.scene.add(m);
    this.fx.push({ mesh: m, t: 0, life: 0.15 });
  }

  updateFx(dt) {
    this.fx = this.fx.filter((f) => {
      f.t += dt;
      const k = f.t / f.life;
      f.mesh.material.opacity = Math.max(0, 0.8 * (1 - k));
      if (f.grow) f.mesh.scale.setScalar(0.6 + k * 0.5);
      if (k < 1) return true;
      this.scene.remove(f.mesh);
      f.mesh.geometry.dispose();
      return false;
    });
  }

  // ---- particles and impact fx (all additive, so they glow under bloom)

  addParticle(mesh, vel, life, { gravity = 0, grow = 0, drag = 0 } = {}) {
    this.scene.add(mesh);
    this.particles.push({ mesh, vel, life, t: 0, gravity, grow, drag, base: mesh.scale.x, opacity: mesh.material.opacity });
  }

  updateParticles(dt) {
    this.particles = this.particles.filter((p) => {
      p.t += dt;
      const k = p.t / p.life;
      if (p.vel) {
        p.vel.y -= p.gravity * dt;
        if (p.drag) p.vel.multiplyScalar(Math.exp(-p.drag * dt));
        p.mesh.position.addScaledVector(p.vel, dt);
        if (p.mesh.userData.align) p.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), p.vel.clone().normalize());
      }
      if (p.grow) p.mesh.scale.setScalar(p.base * (1 + p.grow * k));
      p.mesh.material.opacity = p.opacity * Math.max(0, 1 - k);
      if (k < 1) return true;
      this.scene.remove(p.mesh);
      p.mesh.material.dispose();
      if (!p.mesh.userData.shared) p.mesh.geometry.dispose();
      return false;
    });
  }

  glowMaterial(color, opacity = 1) {
    return new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(2), transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  }

  sharedGeo(key, make) {
    this.geoCache ??= {};
    return (this.geoCache[key] ??= make());
  }

  flash(pos, color, size, life) {
    const m = new THREE.Mesh(this.sharedGeo('flash', () => new THREE.SphereGeometry(1, 16, 12)), this.glowMaterial(color));
    m.userData.shared = true;
    m.scale.setScalar(size);
    m.position.copy(pos);
    this.addParticle(m, null, life, { grow: 1.5 });
  }

  puff(pos, color, size, life) {
    const m = new THREE.Mesh(this.sharedGeo('puff', () => new THREE.SphereGeometry(1, 14, 10)), this.glowMaterial(color, 0.6));
    m.userData.shared = true;
    m.scale.setScalar(size);
    m.position.copy(pos);
    this.addParticle(m, new THREE.Vector3(0, 0.5, 0), life, { grow: -0.8 });
  }

  sparks(pos, color, n, speed) {
    if (this.particles.length > 400) return;
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(this.sharedGeo('spark', () => new THREE.BoxGeometry(0.05, 0.35, 0.05)), this.glowMaterial(color));
      m.userData.shared = true;
      m.userData.align = true;
      m.position.copy(pos);
      const dir = new THREE.Vector3(rnd(-1, 1), rnd(-0.2, 1), rnd(-1, 1)).normalize().multiplyScalar(speed * rnd(0.5, 1.2));
      this.addParticle(m, dir, rnd(0.25, 0.5), { gravity: 14, drag: 2 });
    }
  }

  beamFx(from, to, color, width, life) {
    const d = to.clone().sub(from);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(width, width, d.length(), 8, 1, true), this.glowMaterial(color));
    m.position.copy(from).addScaledVector(d, 0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    this.addParticle(m, null, life, { grow: -0.6 });
  }

  lightningFx(from, to, color) {
    const pts = [];
    const n = 8;
    for (let i = 0; i <= n; i++) {
      const p = from.clone().lerp(to, i / n);
      if (i && i < n) p.add(new THREE.Vector3(rnd(-0.35, 0.35), rnd(-0.35, 0.35), rnd(-0.35, 0.35)));
      pts.push(p);
    }
    for (let i = 0; i < n; i++) this.beamFx(pts[i], pts[i + 1], color, 0.045, 0.16);
    this.flash(to, color, 0.4, 0.12);
  }

  groundMarker(at, r, color, life) {
    const m = new THREE.Mesh(new THREE.RingGeometry(r * 0.92, r, 48), this.glowMaterial(color, 0.6));
    m.rotation.x = -Math.PI / 2;
    m.position.set(at.x, 0.08, at.z);
    this.addParticle(m, null, life);
  }

  // Death: white flash, double shockwave, a shower of sparks and a big callout.
  deathBurst(t) {
    const at = new THREE.Vector3(t.pos.x, 1, t.pos.z);
    const col = TEAM_COLOR[t.team];
    this.flash(at, 0xffffff, 1.2, 0.3);
    this.flash(at, col, 1.5, 0.45);
    this.ringFx(t.pos, 4, col);
    this.ringFx(t.pos, 6.5, 0xffffff);
    this.sparks(at, col, 26, 13);
    this.sparks(at, 0xffffff, 12, 9);
    this.floatText(t.pos, t.isPlayer ? 'ELIMINATED' : `${t.name} ELIMINATED`, t.team === 'blue' ? '#7fd8ff' : '#ff7a8a', 3, 'big');
  }

  // A flare-like burst high in the sky where the corpse ends up.
  skyBurst(at, color) {
    this.flash(at, 0xffffff, 1.5, 0.35);
    this.flash(at, color, 4, 0.9);
    for (let i = 0; i < 40 && this.particles.length < 450; i++) {
      const m = new THREE.Mesh(this.sharedGeo('spark', () => new THREE.BoxGeometry(0.05, 0.35, 0.05)), this.glowMaterial(i % 3 ? color : 0xffffff));
      m.userData.shared = true;
      m.userData.align = true;
      m.scale.setScalar(2.5);
      m.position.copy(at);
      const dir = new THREE.Vector3().setFromSphericalCoords(1, Math.acos(rnd(-1, 1)), rnd(0, Math.PI * 2)).multiplyScalar(rnd(10, 18));
      this.addParticle(m, dir, rnd(0.8, 1.4), { gravity: 6, drag: 1.5 });
    }
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.6, 2, 48), this.glowMaterial(color));
    ring.position.copy(at);
    ring.lookAt(this.camera.position);
    this.addParticle(ring, null, 0.7, { grow: 4 });
  }

  boltMesh(color, r) {
    return new THREE.Mesh(new THREE.CapsuleGeometry(r, r * 5, 4, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(2.5), toneMapped: false }));
  }

  floatText(pos, text, color, lift = 2.2, cls = '') {
    if (this.floaters.length > 40) return;
    const el = h('div', { class: `floater ${cls}`, style: { color } }, String(text));
    this.hud.floaters.append(el);
    this.floaters.push({ el, pos: new THREE.Vector3(pos.x + rnd(-0.4, 0.4), lift, pos.z), t: 0, life: cls === 'big' ? 1.8 : 0.9, rise: cls === 'big' ? 0.8 : 2 });
  }

  // ------------------------------------------------------------ camera & HUD

  spectate(next = false) {
    const alive = this.creatures.filter((c) => c.state !== 'dead');
    const pool = [...alive.filter((c) => c.team === 'blue'), ...alive.filter((c) => c.team !== 'blue')];
    if (!pool.length) return;
    const i = pool.indexOf(this.spectating);
    this.spectating = next || i < 0 ? pool[(i + 1) % pool.length] : this.spectating;
    this.hud.spectate.hidden = false;
    this.hud.spectate.replaceChildren(
      h('span', {}, 'Spectating ', h('b', {}, this.spectating.name), ` (${TEAM_LABEL[this.spectating.team]})`),
      h('button', { class: 'btn tiny', onclick: () => this.spectate(true) }, 'Next'),
      h('button', { class: 'btn tiny primary', onclick: () => this.onExit?.('newgame') }, 'New game'),
      h('button', { class: 'btn tiny', onclick: () => this.onExit?.('menu') }, 'Main menu'));
  }

  updateCamera(dt) {
    let focus = this.player;
    if (this.player.state === 'dead' && !this.deathCam) {
      if (this.spectating?.state === 'dead') this.spectate(true);
      focus = this.spectating || this.player;
    }
    this.camTarget.lerp(focus.pos, 1 - Math.exp(-10 * dt));
    const t = this.camTarget;
    let want, look;
    if (this.deathCam) {
      // watch your creature rocket into the sky from where it fell
      const a = this.deathAnchor || this.player.pos;
      const fwd = new THREE.Vector3(Math.sin(this.cam.yaw), 0, Math.cos(this.cam.yaw));
      want = new THREE.Vector3(a.x, 2.5, a.z).addScaledVector(fwd, -11);
      look = new THREE.Vector3(this.player.pos.x, this.player.y + 1, this.player.pos.z);
      this.camera.position.lerp(want, 1 - Math.exp(-3 * dt));
    } else if (this.settings.camera === 'third') {
      // orbit behind the creature with a slight over-the-shoulder offset
      if (!this.cam.locked && focus !== this.player) this.cam.yaw += wrapAng(focus.face - this.cam.yaw) * (1 - Math.exp(-1.5 * dt));
      const { yaw, pitch } = this.cam;
      const ht = Math.max(1.6, (focus.built?.height || 2) * 0.75);
      const dist = this.cam.dist * (0.8 + ht * 0.12);
      const fwd = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
      const right = new THREE.Vector3(-Math.cos(yaw), 0, Math.sin(yaw));
      look = new THREE.Vector3(t.x, ht + focus.y * 0.5, t.z).addScaledVector(right, 0.9).addScaledVector(fwd, 2.5);
      // kill cam: ease the view up toward your victim's flight, then back
      if (this.killCam) {
        const kc = this.killCam;
        kc.t += dt;
        const w = Math.sin(Math.min(1, kc.t / 2.2) * Math.PI) * 0.75;
        const v = kc.e;
        if (kc.t > 2.2 || v.skyDone && kc.t > 1.6) this.killCam = null;
        else look.lerp(new THREE.Vector3(v.pos.x, v.y + 1, v.pos.z), w);
      }
      want = new THREE.Vector3(t.x, ht + focus.y * 0.5, t.z).addScaledVector(right, 0.9)
        .addScaledVector(fwd, -Math.cos(pitch) * dist).add(new THREE.Vector3(0, Math.sin(pitch) * dist, 0));
      want.y = Math.max(0.6, want.y);
      this.camera.position.lerp(want, 1 - Math.exp(-18 * dt));
    } else {
      const zoom = this.cam.dist / 9;
      want = new THREE.Vector3(t.x, 18 * zoom + 1, t.z - 14 * zoom);
      look = new THREE.Vector3(t.x, 0.5, t.z + 2.5 * zoom);
      this.camera.position.lerp(want, 1 - Math.exp(-6 * dt));
    }
    this.camera.lookAt(look);
    if (this.shake > 0.001) {
      const k = this.shake * this.shake * 0.6;
      this.camera.position.add(new THREE.Vector3(rnd(-k, k), rnd(-k, k), rnd(-k, k)));
      this.camera.rotation.z += rnd(-k, k) * 0.05;
      this.shake *= Math.exp(-7 * dt);
    }
    // keep the shadow map centered on the action
    if (this.sun) {
      this.sun.position.set(t.x - 20, 40, t.z - 10);
      this.sun.target.position.set(t.x, 0, t.z);
    }
  }

  feed(text, team) {
    const row = h('div', { class: `feed-row ${team || ''}` }, text);
    this.hud.feed.prepend(row);
    while (this.hud.feed.childElementCount > 6) this.hud.feed.lastChild.remove();
    setTimeout(() => row.remove(), 9000);
  }

  message(text, cls = '') {
    const el = h('div', { class: `msg ${cls}` }, text);
    this.hud.center.append(el);
    setTimeout(() => el.remove(), cls === 'big' ? 3000 : 3200);
  }

  updateHud() {
    const p = this.player;
    if (this.mode === 'match') {
      this.hud.timer.textContent = fmtTime(this.timeLeft);
      const count = (t) => this.nests.filter((n) => n.team === t && n.alive).length;
      this.hud.blueNests.textContent = `BLUE nests ${count('blue')}/7`;
      this.hud.redNests.textContent = `RED nests ${count('red')}/7`;
    }
    this.hud.hp.style.width = `${(Math.max(0, p.hp) / p.maxHp) * 100}%`;
    this.hud.shield.style.width = `${Math.min(100, (p.fx.shield / p.maxHp) * 100)}%`;
    this.hud.hpText.textContent = p.state === 'dead' ? 'DEAD' : p.state === 'downed' ? `DOWNED ${Math.ceil(p.downedT)}s` : `${Math.ceil(p.hp)} / ${p.maxHp}`;
    this.hud.st.style.width = `${p.stamina}%`;
    const muts = [...p.mut].map((m) => MUTATIONS[m].name);
    if (p.fx.buffSpdT > 0) muts.push('Overdrive');
    if (p.fx.buffDmgT > 0) muts.push('Frenzy');
    if (this.teamBuff.blue > 0) muts.push('Titan Core');
    const mutKey = muts.join('|');
    if (this.lastMutKey !== mutKey) {
      this.lastMutKey = mutKey;
      this.hud.muts.replaceChildren(...muts.map((m) => h('span', { class: 'chip mut' }, m)));
    }
    for (const a of this.abilityEls || []) {
      const [left, total] = a.get();
      a.cd.style.height = `${(left / total) * 100}%`;
    }
    const downed = p.state === 'downed';
    this.hud.downed.hidden = !downed;
    if (downed) this.hud.downed.textContent = `DOWNED — hang on ${Math.ceil(p.downedT)}s. A teammate standing next to you revives you${p.reviveT > 0 ? ` (${Math.round((p.reviveT / 3) * 100)}%)` : ''}.`;

    const w = this.renderer.domElement.clientWidth;
    const hgt = this.renderer.domElement.clientHeight;
    // target lock bracket over whatever left click will hit
    const lock = this.lockTarget;
    this.lockEl.hidden = !lock || this.paused;
    if (lock) {
      const v = new THREE.Vector3(lock.pos.x, (lock.y || 0) + (lock.type === 'creature' ? lock.built.height * 0.55 : lock.radius * 1.2), lock.pos.z).project(this.camera);
      const size = Math.max(36, Math.min(110, 900 / Math.max(4, this.camera.position.distanceTo(lock.pos))));
      this.lockEl.style.transform = `translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * hgt}px) translate(-50%, -50%)`;
      this.lockEl.style.width = this.lockEl.style.height = `${size}px`;
    }
    this.hitMarkT = Math.max(0, this.hitMarkT - 1 / 60);
    this.killMarkT = Math.max(0, (this.killMarkT || 0) - 1 / 60);
    this.crosshair.classList.toggle('hit', this.hitMarkT > 0);
    this.crosshair.classList.toggle('kill', this.killMarkT > 0);
    this.lockEl.classList.toggle('hit', this.hitMarkT > 0);

    // floating numbers
    this.floaters = this.floaters.filter((f) => {
      f.t += 1 / 60;
      const v = f.pos.clone();
      v.y += f.t * f.rise;
      v.project(this.camera);
      f.el.style.transform = `translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * hgt}px) translate(-50%, -50%)`;
      f.el.style.opacity = String(Math.min(1, 2 * (1 - f.t / f.life)));
      if (f.t < f.life) return true;
      f.el.remove();
      return false;
    });
    this.drawMinimap();
  }

  drawMinimap() {
    const cv = this.minimap;
    const g = cv.getContext('2d');
    const { W, L } = this;
    const sx = (x) => ((W - x) / (2 * W)) * cv.width;
    const sz = (z) => ((L - z) / (2 * L)) * cv.height;
    g.clearRect(0, 0, cv.width, cv.height);
    g.fillStyle = 'rgba(8,10,14,0.8)';
    g.fillRect(0, 0, cv.width, cv.height);
    g.lineCap = 'round';
    for (const lane of this.lanes) {
      g.strokeStyle = 'rgba(180,200,230,0.18)';
      g.lineWidth = (lane.width / (2 * W)) * cv.width;
      g.beginPath();
      lane.pts.forEach((pt, i) => (i ? g.lineTo(sx(pt.x), sz(pt.z)) : g.moveTo(sx(pt.x), sz(pt.z))));
      g.stroke();
    }
    for (const hz of this.hazards) {
      g.fillStyle = hz.state === 'warn' ? '#ffd84d' : 'rgba(255,216,77,0.35)';
      g.fillRect(sx(hz.pos.x) - 2, sz(hz.pos.z) - 2, 4, 4);
    }
    for (const n of this.neutrals) {
      if (!n.alive || n.kind === 'dummy') continue;
      g.fillStyle = n.kind === 'boss' ? '#b46bff' : 'rgba(200,192,168,0.7)';
      g.beginPath();
      g.arc(sx(n.pos.x), sz(n.pos.z), n.kind === 'boss' ? 5 : 2, 0, Math.PI * 2);
      g.fill();
    }
    for (const n of this.nests) {
      g.strokeStyle = n.team === 'blue' ? '#38c8ff' : '#ff4060';
      g.fillStyle = g.strokeStyle;
      g.lineWidth = 2;
      g.beginPath();
      g.arc(sx(n.pos.x), sz(n.pos.z), n.kind === 'main' ? 7 : 4.5, 0, Math.PI * 2);
      if (n.alive) g.fill();
      else g.stroke();
    }
    // team vision: enemies only show near something of ours
    const eyes = [...this.creatures.filter((c) => c.team === 'blue' && c.state !== 'dead').map((c) => [c.pos, c.st.vision]), ...this.nests.filter((n) => n.team === 'blue' && n.alive).map((n) => [n.pos, n.cfg.range + 3])];
    for (const c of this.creatures) {
      if (c.state === 'dead') continue;
      if (c.team !== 'blue' && !eyes.some(([pos, r]) => dist2(pos, c.pos) < r)) continue;
      g.fillStyle = c.isPlayer ? '#ffffff' : c.team === 'blue' ? '#8fdcff' : '#ff7a8a';
      g.beginPath();
      g.arc(sx(c.pos.x), sz(c.pos.z), c.isPlayer ? 4 : 3, 0, Math.PI * 2);
      g.fill();
      if (c.isPlayer) {
        g.strokeStyle = '#ffffff';
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(sx(c.pos.x), sz(c.pos.z));
        g.lineTo(sx(c.pos.x) - Math.sin(c.face) * 10, sz(c.pos.z) - Math.cos(c.face) * 10);
        g.stroke();
      }
      if (c.state === 'downed') {
        g.strokeStyle = '#ffae3d';
        g.stroke();
      }
    }
  }

  // ------------------------------------------------------------ teardown

  destroy() {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    removeEventListener('resize', this.resize);
    removeEventListener('keydown', this.onKeyDown);
    removeEventListener('keyup', this.onKeyUp);
    removeEventListener('mousemove', this.onMouseMove);
    removeEventListener('mousedown', this.onMouseDown);
    removeEventListener('mouseup', this.onMouseUp);
    removeEventListener('contextmenu', this.onContext);
    removeEventListener('blur', this.onBlur);
    removeEventListener('wheel', this.onWheel);
    document.removeEventListener('pointerlockchange', this.onLockChange);
    this.releaseLock();
    if (devConsole.battle === this) devConsole.battle = null;
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

export function makeBotRoster(count, pool, takenNames = new Set()) {
  return Array.from({ length: count }, () => {
    const name = BOT_NAMES.filter((n) => !takenNames.has(n)).sort(() => Math.random() - 0.5)[0] || `Bot ${takenNames.size + 1}`;
    takenNames.add(name);
    return randomBuild(Math.random, pool, name);
  });
}

export const partName = (id) => PART_BY_ID[id]?.name || id;
