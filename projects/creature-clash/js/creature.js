// Creature model: stats from parts (form equals function), validation, bot builds, and 3D meshes.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { PARTS, PART_BY_ID, SLOTS, BUDGET, SPECIALS, BOT_NAMES, FINISHES, LOOK_PRESETS, GLOW_COLORS, DEFAULT_LOOK, SIDEARM } from './data.js';

const FLAIL = { name: 'Strike', kind: 'melee', range: 1.8, arc: 90, dmg: 4, dtype: 'blunt', cost: 8, cd: 0.5, kb: 2 };

export const emptyParts = () => Object.fromEntries(SLOTS.map((s) => [s.id, null]));

export function starterCreature(name = 'Prototype') {
  return {
    id: crypto.randomUUID(),
    name,
    look: { ...DEFAULT_LOOK },
    special: null,
    parts: { ...emptyParts(), legs: 'stubby_legs', weapon: 'pulse_blaster', mouth: 'basic_jaw', arms: 'small_claws', eyes: 'googly_eyes' },
  };
}

// Older saves stored one bright paint color and a pattern; map them onto the hull look.
const LEGACY_PATTERN = { spots: 'camo', stripes: 'stripes', belly: 'split', none: 'none' };
export function lookOf(c) {
  if (c.look) return { ...DEFAULT_LOOK, ...c.look };
  const legacy = {};
  if (c.color) {
    const hsl = {};
    new THREE.Color(c.color).getHSL(hsl);
    legacy.primary = `#${new THREE.Color().setHSL(hsl.h, hsl.s * 0.55, Math.min(0.42, hsl.l * 0.6)).getHexString()}`;
  }
  if (c.pattern) legacy.pattern = LEGACY_PATTERN[c.pattern] || 'panels';
  return { ...DEFAULT_LOOK, ...legacy };
}

export const partsOf = (c) => SLOTS.map((s) => PART_BY_ID[c.parts[s.id]]).filter(Boolean);

export function computeStats(c) {
  const parts = partsOf(c);
  let weight = 0, speed = 0, hp = 100, armor = 0, stability = 4, vision = 14, kbResist = 0, thorns = 0;
  for (const p of parts) {
    const s = p.stats || {};
    weight += p.weight;
    speed += s.speed || 0;
    hp += s.hp || 0;
    armor += s.armor || 0;
    stability += s.stability || 0;
    vision += s.vision || 0;
    kbResist += s.kbResist || 0;
    thorns += s.thorns || 0;
  }
  const legs = PART_BY_ID[c.parts.legs];
  if (!legs) speed += 2; // crawling on its belly
  speed = Math.max(1.5, speed - Math.max(0, weight - 40) / 20);
  hp += Math.round(weight * 0.6); // bigger creatures are a little tougher
  armor = Math.min(0.6, armor);

  const attacks = parts.filter((p) => p.attack).map((p) => ({ ...p.attack, partId: p.id }));
  if (!attacks.length) attacks.push({ ...FLAIL });
  const specialIds = [...new Set(parts.filter((p) => p.special).map((p) => p.special))];
  const special = specialIds.includes(c.special) ? c.special : specialIds[0] || null;

  // every creature can shoot: an empty weapon slot falls back to a weak sidearm
  const weaponPart = PART_BY_ID[c.parts.weapon];
  const weapon = weaponPart ? { ...weaponPart.weapon, partId: weaponPart.id, model: weaponPart.id } : { ...SIDEARM };
  const dps = attacks.slice(0, 3).reduce((sum, a) => sum + a.dmg / a.cd, 0) + (weapon.dmg * (weapon.pellets || 1) * 0.6) / weapon.cd;
  const clamp = (v) => Math.max(0, Math.min(10, v));
  return {
    weight, budget: BUDGET, overBudget: weight > BUDGET,
    speed, maxHp: hp, armor, stability, vision, kbResist: Math.min(0.6, kbResist), thorns,
    legH: legs ? legs.legH : 0.25,
    attacks: attacks.slice(0, 3), weapon, specialIds, special,
    card: {
      speed: clamp((speed / 8) * 10),
      toughness: clamp(((hp - 90) / 70) * 10 * 0.7 + armor * 12),
      damage: clamp(dps / 6),
      stability: clamp(((stability + 3) / 11) * 10),
    },
  };
}

export function roleTag(c) {
  const st = computeStats(c);
  const ids = Object.values(c.parts);
  if (st.special === 'heal' || st.special === 'shield') return 'Support';
  if (ids.includes('spit_gland')) return 'Ranged';
  if (st.armor >= 0.25 || st.maxHp >= 150) return 'Tank';
  if (st.speed >= 6.3) return 'Skirmisher';
  return 'Brawler';
}

// Problems that keep a creature from being selected for battle.
export function validate(c, ownedIds) {
  const problems = [];
  const st = computeStats(c);
  if (!c.parts.legs) problems.push('Needs a locomotion part');
  if (st.overBudget) problems.push(`Over budget (${st.weight}/${st.budget})`);
  if (ownedIds) {
    const missing = partsOf(c).filter((p) => !ownedIds.includes(p.id));
    if (missing.length) problems.push(`Uses parts you don't own: ${missing.map((p) => p.name).join(', ')}`);
  }
  return { ok: problems.length === 0, problems };
}

export function randomLook(rand = Math.random) {
  const preset = LOOK_PRESETS[Math.floor(rand() * LOOK_PRESETS.length)];
  const { name, ...look } = preset;
  return {
    ...DEFAULT_LOOK, ...look,
    glow: rand() < 0.5 ? look.glow : GLOW_COLORS[Math.floor(rand() * GLOW_COLORS.length)],
    size: 0.94 + rand() * 0.12, length: 0.9 + rand() * 0.2, bulk: 0.9 + rand() * 0.2,
  };
}

export function randomBuild(rand = Math.random, pool = PARTS, name) {
  const c = {
    id: crypto.randomUUID(),
    name: name || BOT_NAMES[Math.floor(rand() * BOT_NAMES.length)],
    look: randomLook(rand),
    special: null,
    parts: emptyParts(),
  };
  const chance = { legs: 1, weapon: 0.95, mouth: 0.9, arms: 0.75, head: 0.6, back: 0.6, tail: 0.6, utility: 0.55, eyes: 0.9, hat: 0.35 };
  const order = SLOTS.map((s) => s.id).sort((a, b) => (a === 'legs' ? -1 : b === 'legs' ? 1 : rand() - 0.5));
  let weight = 0;
  for (const slot of order) {
    if (rand() > chance[slot]) continue;
    const options = pool.filter((p) => p.slot === slot && weight + p.weight <= BUDGET);
    if (!options.length) continue;
    const p = options[Math.floor(rand() * options.length)];
    c.parts[slot] = p.id;
    weight += p.weight;
  }
  if (!c.parts.legs) c.parts.legs = 'stubby_legs';
  if (!c.parts.weapon && rand() < 0.9) c.parts.weapon = 'pulse_blaster';
  return c;
}

// ---------------------------------------------------------------- meshes

const SIL = new THREE.MeshBasicMaterial({ color: 0x07080f });
const UP = new THREE.Vector3(0, 1, 0);
const geoCache = new Map();
const geo = (key, make) => (geoCache.has(key) ? geoCache.get(key) : geoCache.set(key, make()).get(key));
const r2 = (n) => Math.round(n * 100) / 100;
const sphere = (r, w = 20, hs = 14) => geo(`s${r},${w}`, () => new THREE.SphereGeometry(r, w, hs));
const rbox = (w, hgt, d, rad = 0.03) => geo(`rb${r2(w)},${r2(hgt)},${r2(d)},${rad}`, () => new RoundedBoxGeometry(w, hgt, d, 2, Math.min(rad, w / 2.1, hgt / 2.1, d / 2.1)));
const cone = (r, len, seg = 8) => geo(`c${r},${len},${seg}`, () => new THREE.ConeGeometry(r, len, seg));
const v = (x, y, z) => new THREE.Vector3(x, y, z);

// Tapered strut between two points.
function seg(a, b, r0, r1, mat) {
  const d = b.clone().sub(a);
  const len = d.length();
  const m = new THREE.Mesh(geo(`cy${r2(r0)},${r2(r1)},${r2(len)}`, () => new THREE.CylinderGeometry(r1, r0, len, 12)), mat);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(UP, d.normalize());
  return m;
}
const at = (mesh, x, y, z) => (mesh.position.set(x, y, z), mesh);

function shade(hex, f) {
  const c = new THREE.Color(hex);
  const hsl = {};
  c.getHSL(hsl);
  return new THREE.Color().setHSL(hsl.h, hsl.s, Math.max(0, Math.min(1, hsl.l * f)));
}
const css = (col) => `#${col.getHexString()}`;

// Hull textures: color (pattern + grime), bump (engraved panel lines), emissive (light seams).
// Sphere UVs: canvas top = spine, bottom = belly, x=128 = front, x=384 = rear.
function hullTextures(look) {
  const W = 512, H = 256;
  const mk = () => {
    const cv = document.createElement('canvas');
    cv.width = W;
    cv.height = H;
    return [cv, cv.getContext('2d')];
  };
  const [mc, m] = mk();
  const [bc, b] = mk();
  const [ec, e] = mk();
  let seed = 11;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  m.fillStyle = look.primary;
  m.fillRect(0, 0, W, H);
  b.fillStyle = '#fff';
  b.fillRect(0, 0, W, H);
  e.fillStyle = '#000';
  e.fillRect(0, 0, W, H);
  const groove = css(shade(look.primary, 0.55));
  const line = (y0, y1, x0, x1, w = 2) => {
    for (const [g, col, lw] of [[m, groove, w], [b, '#000', w + 1]]) {
      g.strokeStyle = col;
      g.lineWidth = lw;
      g.beginPath();
      g.moveTo(x0, y0);
      g.lineTo(x1, y1);
      g.stroke();
    }
  };
  switch (look.pattern) {
    case 'panels':
      for (const y of [58, 104, 150, 196]) line(y, y, 0, W);
      for (let band = 0; band < 5; band++) {
        const y0 = [10, 58, 104, 150, 196][band];
        const y1 = [58, 104, 150, 196, 250][band];
        for (let x = rand() * 60; x < W; x += 50 + rand() * 70) line(y0, y1, x, x);
      }
      m.fillStyle = css(shade(look.primary, 0.45));
      for (let i = 0; i < 70; i++) m.fillRect(Math.floor(rand() * W), [62, 108, 154, 200][i % 4], 2, 2);
      break;
    case 'hex': {
      const s = 18;
      for (let row = 0; row < H / (s * 1.5) + 1; row++) {
        for (let col = 0; col < W / (s * 1.73) + 1; col++) {
          const cx = col * s * 1.732 + (row % 2) * s * 0.866;
          const cy = row * s * 1.5;
          for (let k = 0; k < 6; k++) {
            const a0 = (Math.PI / 3) * k + Math.PI / 6;
            const a1 = a0 + Math.PI / 3;
            line(cy + Math.sin(a0) * s, cy + Math.sin(a1) * s, cx + Math.cos(a0) * s, cx + Math.cos(a1) * s, 1.5);
          }
        }
      }
      break;
    }
    case 'stripes':
      m.fillStyle = look.secondary;
      // flank slashes that stay clear of the spine, where UV lines would converge
      for (let x = -40; x < W + 40; x += 38) {
        m.beginPath();
        m.moveTo(x, 44);
        m.lineTo(x + 16, 44);
        m.lineTo(x + 30, 160);
        m.lineTo(x + 22, 175);
        m.closePath();
        m.fill();
      }
      break;
    case 'camo':
      for (const [col, size, n] of [[look.secondary, 28, 40], [css(shade(look.primary, 0.7)), 18, 70], [css(shade(look.primary, 1.25)), 10, 90]]) {
        m.fillStyle = col;
        for (let i = 0; i < n; i++) {
          const x = Math.floor((rand() * W) / 6) * 6;
          const y = Math.floor((rand() * H) / 6) * 6;
          m.fillRect(x, y, Math.ceil((size * (0.5 + rand())) / 6) * 6, Math.ceil((size * (0.4 + rand() * 0.6)) / 6) * 6);
        }
      }
      break;
    case 'split':
      m.fillStyle = look.secondary;
      m.fillRect(0, 150, W, H - 150);
      line(150, 150, 0, W, 2);
      break;
  }
  if (look.finish === 'carbon') {
    m.globalAlpha = 0.14;
    for (let y = 0; y < H; y += 6) for (let x = 0; x < W; x += 6) {
      m.fillStyle = ((x + y) / 6) % 2 ? '#000' : '#fff';
      m.fillRect(x, y, 6, 3);
    }
    m.globalAlpha = 1;
  }
  // light seams along both flanks and the spine
  e.strokeStyle = '#fff';
  e.lineWidth = 3;
  for (const [x0, x1] of [[200, 330], [440, 512], [0, 60]]) {
    e.beginPath();
    e.moveTo(x0, 132);
    e.lineTo(x1, 132);
    e.stroke();
  }
  e.lineWidth = 2;
  e.beginPath();
  e.moveTo(150, 22);
  e.lineTo(380, 22);
  e.stroke();
  // grime: darker belly, subtle speckle
  const shadeGrad = m.createLinearGradient(0, 0, 0, H);
  shadeGrad.addColorStop(0, 'rgba(255,255,255,0.06)');
  shadeGrad.addColorStop(0.55, 'rgba(0,0,0,0)');
  shadeGrad.addColorStop(1, 'rgba(0,0,0,0.35)');
  m.fillStyle = shadeGrad;
  m.fillRect(0, 0, W, H);
  m.fillStyle = 'rgba(0,0,0,0.08)';
  for (let i = 0; i < 500; i++) m.fillRect(rand() * W, rand() * H, 1 + rand() * 2, 1 + rand() * 2);

  const tex = (cv, srgb) => {
    const t = new THREE.CanvasTexture(cv);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  };
  return { map: tex(mc, true), bump: tex(bc, false), emissive: tex(ec, true) };
}

function makeMaterials(look, silhouette) {
  if (silhouette) return new Proxy({}, { get: () => SIL });
  const f = FINISHES[look.finish] || FINISHES.satin;
  const glowI = 0.3 + look.glowStrength * 2.6;
  const tex = hullTextures(look);
  const phys = (o) => new THREE.MeshPhysicalMaterial({ roughness: f.roughness, metalness: f.metalness, clearcoat: f.clearcoat, clearcoatRoughness: 0.2, ...o });
  return {
    hull: phys({ color: 0xffffff, map: tex.map, bumpMap: tex.bump, bumpScale: 2, emissive: look.glow, emissiveMap: tex.emissive, emissiveIntensity: glowI }),
    armor: phys({ color: look.primary }),
    plate: phys({ color: look.secondary, roughness: Math.max(0.2, f.roughness * 0.8), metalness: Math.max(0.35, f.metalness) }),
    mech: new THREE.MeshStandardMaterial({ color: 0x1c1e23, roughness: 0.4, metalness: 0.85 }),
    glow: new THREE.MeshStandardMaterial({ color: 0x000000, emissive: look.glow, emissiveIntensity: glowI + 0.6 }),
    lens: new THREE.MeshPhysicalMaterial({ color: 0x050608, roughness: 0.05, metalness: 0.3, clearcoat: 1 }),
    ceramic: new THREE.MeshStandardMaterial({ color: 0xd6d1c4, roughness: 0.3, metalness: 0.15 }),
    gel: new THREE.MeshPhysicalMaterial({ color: look.glow, transparent: true, opacity: 0.6, roughness: 0.1, emissive: look.glow, emissiveIntensity: 0.5 }),
    regen: new THREE.MeshPhysicalMaterial({ color: 0x4dff9a, transparent: true, opacity: 0.7, roughness: 0.1, emissive: 0x4dff9a, emissiveIntensity: 1.2 }),
    membrane: new THREE.MeshStandardMaterial({ color: look.secondary, transparent: true, opacity: 0.8, side: THREE.DoubleSide, roughness: 0.6, emissive: look.glow, emissiveIntensity: 0.12 }),
    glowI,
  };
}

// The torso is a deformed sphere: tapered rear, flatter belly, a spine ridge and shoulders.
function torsoShape(x, y, z) {
  const taper = z < 0 ? 1 + z * 0.3 : 1 - z * z * 0.14;
  const shoulder = 1 + 0.09 * Math.exp(-((z - 0.35) ** 2) / 0.08);
  let yy = y < 0 ? y * 0.78 : y;
  if (y > 0) yy += 0.07 * Math.exp(-(x * x) / 0.03) * y;
  return [x * taper * shoulder, yy * taper, z];
}
function torsoGeometry(rx, ry, rz) {
  return geo(`torso${r2(rx)},${r2(ry)},${r2(rz)}`, () => {
    const g = new THREE.SphereGeometry(1, 48, 32);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const [x, y, z] = torsoShape(p.getX(i), p.getY(i), p.getZ(i));
      p.setXYZ(i, x * rx, y * ry, z * rz);
    }
    g.computeVertexNormals();
    return g;
  });
}

// Arched band over the back (open cylinder segment, axis along z).
const bandGeo = (arc) => geo(`band${arc}`, () => new THREE.CylinderGeometry(1, 1, 1, 24, 1, true, Math.PI - arc / 2, arc).rotateX(Math.PI / 2));

export function buildCreatureMesh(c, { silhouette = false } = {}) {
  const st = computeStats(c);
  const look = lookOf(c);
  const M = makeMaterials(look, silhouette);
  const rx = 0.76 * look.bulk;
  const ry = 0.58;
  const rz = 1.05 * look.length;
  const legH = st.legH;
  const bodyY = legH + 0.7;
  const topAt = (z) => {
    const zn = Math.max(-0.98, Math.min(0.98, z / rz));
    const y = Math.sqrt(1 - zn * zn);
    return bodyY + torsoShape(0, y, zn)[1] * ry;
  };

  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const anim = {
    root, body, legs: [], legStyle: 'walk', arms: [], mandibles: [], wings: [], tailSegs: [], jaw: null, head: null,
    drone: null, rotors: [], halo: null, beacon: null, torso: null, weapon: null, muzzle: null, bodyY, mats: silhouette ? null : M, baseScale: look.size,
  };

  const torso = new THREE.Mesh(torsoGeometry(rx, ry, rz), M.hull);
  torso.position.y = bodyY;
  body.add(torso);
  anim.torso = torso;

  // --- head module (eyes, mouth, head parts and cosmetics attach here)
  const head = new THREE.Group();
  head.position.set(0, bodyY + 0.14, rz * 0.8);
  body.add(head);
  anim.head = head;
  const HX = 0.34, HY = 0.26, HZ = 0.46;
  const skull = new THREE.Mesh(sphere(1, 28, 20), M.armor);
  skull.scale.set(HX, HY, HZ);
  head.add(skull);
  // armored brow ridge and cheek plates give the head a hard, angular read
  for (const s of [-1, 1]) {
    const brow = new THREE.Mesh(rbox(0.2, 0.06, 0.42, 0.025), M.plate);
    brow.position.set(s * 0.13, 0.19, 0.08);
    brow.rotation.set(0.22, s * 0.22, s * -0.25);
    const cheek = new THREE.Mesh(rbox(0.06, 0.16, 0.34, 0.025), M.plate);
    cheek.position.set(s * 0.29, -0.04, 0.08);
    cheek.rotation.y = s * 0.3;
    head.add(brow, cheek);
  }
  const HF = HZ - 0.03; // head front surface

  // --- locomotion
  const hipY = bodyY - 0.32;
  const H = hipY;
  const legGroup = (x, z, phase, y = hipY) => {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    g.userData.phase = phase;
    body.add(g);
    anim.legs.push(g);
    return g;
  };
  switch (c.parts.legs) {
    case 'stubby_legs':
      for (const [sx, sz, ph] of [[-1, 1, 0], [1, 1, Math.PI], [-1, -1, Math.PI], [1, -1, 0]]) {
        const s = sx;
        const g = legGroup(s * 0.55 * look.bulk, sz * 0.48 * look.length, ph);
        const knee = v(s * 0.2, -H * 0.5, 0.06);
        const ankle = v(s * 0.13, -H + 0.14, 0);
        g.add(seg(v(0, 0, 0), knee, 0.17, 0.13, M.armor), at(new THREE.Mesh(sphere(0.12), M.mech), knee.x, knee.y, knee.z));
        g.add(seg(knee, ankle, 0.1, 0.08, M.mech));
        g.add(at(new THREE.Mesh(rbox(0.2, H * 0.32, 0.22, 0.05), M.plate), s * 0.17, -H * 0.72, 0.06));
        g.add(at(new THREE.Mesh(rbox(0.3, 0.12, 0.4, 0.04), M.plate), s * 0.13, -H + 0.06, 0.06));
      }
      break;
    case 'stilt_legs':
      for (const [s, ph] of [[-1, 0], [1, Math.PI]]) {
        const g = legGroup(s * 0.45 * look.bulk, 0, ph);
        const knee = v(s * 0.06, -H * 0.36, 0.26);
        const hock = v(s * 0.06, -H * 0.76, -0.2);
        const toe = v(s * 0.05, -H + 0.05, 0.08);
        g.add(seg(v(0, 0, 0), knee, 0.15, 0.1, M.armor), seg(knee, hock, 0.08, 0.06, M.mech), seg(hock, toe, 0.06, 0.05, M.mech));
        for (const j of [knee, hock]) g.add(at(new THREE.Mesh(sphere(0.085), M.plate), j.x, j.y, j.z));
        g.add(at(new THREE.Mesh(rbox(0.14, 0.06, 0.42, 0.02), M.plate), toe.x, -H + 0.03, toe.z + 0.08));
      }
      break;
    case 'frog_legs':
      for (const [s, ph] of [[-1, 0], [1, 0]]) {
        const g = legGroup(s * 0.58 * look.bulk, -0.35 * look.length, ph);
        const knee = v(s * 0.34, -H * 0.38, -0.45);
        const ankle = v(s * 0.2, -H * 0.86, 0.12);
        const thigh = seg(v(0, 0, 0), knee, 0.24, 0.16, M.armor);
        g.add(thigh, seg(knee, ankle, 0.1, 0.08, M.mech), at(new THREE.Mesh(sphere(0.12), M.plate), knee.x, knee.y, knee.z));
        g.add(at(new THREE.Mesh(rbox(0.24, 0.08, 0.52, 0.03), M.plate), s * 0.18, -H + 0.04, 0.3));
      }
      for (const [s, ph] of [[-1, 0], [1, Math.PI]]) {
        const g = legGroup(s * 0.4 * look.bulk, 0.55 * look.length, ph);
        g.add(seg(v(0, 0, 0), v(s * 0.05, -H + 0.08, 0.08), 0.08, 0.06, M.mech));
        g.add(at(new THREE.Mesh(rbox(0.16, 0.06, 0.24, 0.02), M.plate), s * 0.05, -H + 0.03, 0.12));
      }
      break;
    case 'flippy_fins':
      anim.legStyle = 'flap';
      for (const [x, z, ph] of [[-1, 1, 0], [1, 1, 0], [-1, -1, Math.PI], [1, -1, Math.PI]]) {
        const g = legGroup(x * 0.5 * look.bulk, z * 0.4 * look.length, ph, bodyY - 0.42);
        g.add(seg(v(0, 0.1, 0), v(x * 0.32, -0.05, 0), 0.06, 0.05, M.mech));
        const blade = new THREE.Group();
        blade.position.set(x * 0.32, -0.06, 0);
        blade.rotation.set(0, x * 0.35, x * -0.18);
        blade.add(at(new THREE.Mesh(rbox(0.66, 0.045, 0.34, 0.02), M.armor), x * 0.3, 0, 0));
        blade.add(at(new THREE.Mesh(rbox(0.6, 0.02, 0.03, 0.008), M.glow), x * 0.3, 0, -0.17));
        g.add(blade);
      }
      break;
    case 'skitter_legs':
      for (const [s, sideP] of [[-1, 0], [1, Math.PI]]) {
        for (const [z, i] of [[0.48, 0], [0, 1], [-0.48, 2]]) {
          const g = legGroup(s * 0.55 * look.bulk, z * look.length, sideP + i * Math.PI);
          const knee = v(s * 0.62, 0.38, z * 0.3);
          const foot = v(s * 1.0, -H + 0.04, z * 0.55);
          g.add(seg(v(0, 0, 0), knee, 0.08, 0.06, M.armor), seg(knee, foot, 0.055, 0.025, M.mech));
          g.add(at(new THREE.Mesh(sphere(0.075), M.plate), knee.x, knee.y, knee.z));
          g.add(at(new THREE.Mesh(sphere(0.035), M.glow), foot.x, foot.y + 0.02, foot.z));
        }
      }
      break;
    default: // no legs: belly crawl
      break;
  }

  // --- mouth (head-local)
  switch (c.parts.mouth) {
    case 'basic_jaw':
      for (const s of [-1, 1]) {
        const g = new THREE.Group();
        g.position.set(s * 0.15, -0.14, HF - 0.08);
        g.userData.side = s;
        g.add(seg(v(0, 0, 0), v(s * 0.08, -0.02, 0.22), 0.05, 0.035, M.plate));
        const tip = new THREE.Mesh(cone(0.035, 0.16, 6), M.ceramic);
        tip.position.set(s * 0.03, -0.03, 0.3);
        tip.rotation.set(Math.PI / 2, 0, s * 0.9);
        g.add(tip);
        head.add(g);
        anim.mandibles.push(g);
      }
      break;
    case 'pecky_beak': {
      const upper = new THREE.Mesh(cone(0.13, 0.6, 5), M.plate);
      upper.rotation.x = Math.PI / 2;
      upper.position.set(0, -0.04, HF + 0.24);
      head.add(upper);
      const jaw = new THREE.Group();
      jaw.position.set(0, -0.12, HF - 0.04);
      const lower = new THREE.Mesh(cone(0.08, 0.42, 5), M.mech);
      lower.rotation.x = Math.PI / 2;
      lower.position.z = 0.22;
      jaw.add(lower);
      head.add(jaw);
      anim.jaw = jaw;
      break;
    }
    case 'spit_gland': {
      head.add(seg(v(0, -0.16, HF - 0.1), v(0, -0.17, HF + 0.32), 0.1, 0.08, M.mech));
      const ring = new THREE.Mesh(geo('muzzle', () => new THREE.TorusGeometry(0.085, 0.025, 8, 20)), M.glow);
      ring.position.set(0, -0.17, HF + 0.32);
      head.add(ring);
      for (const s of [-1, 1]) {
        const tank = new THREE.Mesh(geo('tank', () => new THREE.CapsuleGeometry(0.07, 0.22, 4, 10)), M.gel);
        tank.rotation.x = Math.PI / 2;
        tank.position.set(s * 0.16, -0.2, HF - 0.12);
        head.add(tank);
      }
      break;
    }
    case 'mega_chompers': {
      head.add(at(new THREE.Mesh(rbox(0.52, 0.16, 0.42, 0.05), M.armor), 0, -0.1, HF + 0.08));
      const jaw = new THREE.Group();
      jaw.position.set(0, -0.2, HF - 0.12);
      jaw.add(at(new THREE.Mesh(rbox(0.48, 0.12, 0.44, 0.04), M.armor), 0, -0.04, 0.24));
      for (let i = 0; i < 5; i++) {
        const x = -0.18 + i * 0.09;
        const lowT = new THREE.Mesh(cone(0.03, 0.1, 5), M.ceramic);
        lowT.position.set(x, 0.05, 0.4);
        jaw.add(lowT);
        const upT = new THREE.Mesh(cone(0.03, 0.1, 5), M.ceramic);
        upT.rotation.x = Math.PI;
        upT.position.set(x, -0.2, HF + 0.24);
        head.add(upT);
      }
      head.add(jaw);
      anim.jaw = jaw;
      break;
    }
  }

  // --- arms (pivot at the shoulder so attacks can swing them)
  const shoulderY = bodyY - 0.08;
  for (const s of [-1, 1]) {
    if (!c.parts.arms) break;
    const g = new THREE.Group();
    g.position.set(s * 0.58 * look.bulk, shoulderY, rz * 0.48);
    g.userData.side = s;
    body.add(g);
    anim.arms.push(g);
    switch (c.parts.arms) {
      case 'small_claws': {
        const elbow = v(s * 0.24, -0.26, 0.22);
        const wrist = v(s * 0.16, -0.36, 0.52);
        g.add(seg(v(0, 0, 0), elbow, 0.1, 0.08, M.armor), seg(elbow, wrist, 0.065, 0.055, M.mech), at(new THREE.Mesh(sphere(0.07), M.plate), elbow.x, elbow.y, elbow.z));
        for (const o of [-0.06, 0, 0.06]) {
          const t = new THREE.Mesh(cone(0.028, 0.2, 6), M.ceramic);
          t.position.set(wrist.x + o, wrist.y - 0.04, wrist.z + 0.09);
          t.rotation.x = Math.PI / 2 + 0.5;
          g.add(t);
        }
        break;
      }
      case 'crab_pincers': {
        const elbow = v(s * 0.3, -0.12, 0.25);
        const wrist = v(s * 0.24, -0.16, 0.55);
        g.add(seg(v(0, 0, 0), elbow, 0.12, 0.1, M.armor), seg(elbow, wrist, 0.09, 0.08, M.mech));
        g.add(at(new THREE.Mesh(sphere(0.14), M.plate), wrist.x, wrist.y, wrist.z));
        for (const k of [-1, 1]) {
          const jaw = new THREE.Mesh(rbox(0.1, 0.09, 0.42, 0.03), M.plate);
          jaw.position.set(wrist.x, wrist.y + k * 0.07, wrist.z + 0.24);
          jaw.rotation.x = k * -0.2;
          g.add(jaw);
        }
        break;
      }
      case 'noodle_arms': {
        const curve = new THREE.CatmullRomCurve3([v(0, 0, 0), v(s * 0.35, -0.1, 0.1), v(s * 0.45, -0.4, 0.5), v(s * 0.2, -0.35, 1.0)]);
        g.add(new THREE.Mesh(geo(`tend${s}`, () => new THREE.TubeGeometry(curve, 24, 0.045, 8, false)), M.armor));
        g.add(at(new THREE.Mesh(sphere(0.06), M.glow), s * 0.2, -0.35, 1.0));
        break;
      }
      case 'zappy_feelers': {
        const base = v(s * -0.4, 0.42, -0.12);
        const tip = v(s * -0.2, 1.15, 0.35);
        g.add(seg(base, tip, 0.03, 0.018, M.mech));
        for (const k of [0.35, 0.6]) {
          const ring = new THREE.Mesh(geo('coil', () => new THREE.TorusGeometry(0.05, 0.012, 6, 14)), M.glow);
          ring.position.lerpVectors(base, tip, k);
          ring.quaternion.setFromUnitVectors(v(0, 0, 1), tip.clone().sub(base).normalize());
          g.add(ring);
        }
        g.add(at(new THREE.Mesh(sphere(0.07), M.glow), tip.x, tip.y, tip.z));
        break;
      }
    }
  }

  // --- head parts (head-local)
  let hatLift = 0;
  switch (c.parts.head) {
    case 'spiky_crest':
      for (let i = 0; i < 3; i++) {
        const blade = new THREE.Mesh(rbox(0.04, 0.36 - i * 0.08, 0.3, 0.015), M.plate);
        blade.position.set(0, 0.36 - i * 0.03, 0.08 - i * 0.2);
        blade.rotation.x = -0.6;
        const edge = new THREE.Mesh(rbox(0.05, 0.3 - i * 0.08, 0.02, 0.008), M.glow);
        edge.position.set(0, 0.38 - i * 0.03, 0.2 - i * 0.2);
        edge.rotation.x = -0.6;
        head.add(blade, edge);
      }
      hatLift = 0.12;
      break;
    case 'horns':
      for (const s of [-1, 1]) {
        const pts = [v(s * 0.2, 0.16, -0.02), v(s * 0.42, 0.32, -0.18), v(s * 0.6, 0.3, 0.06), v(s * 0.56, 0.14, 0.34)];
        const rads = [0.09, 0.075, 0.055, 0.035];
        for (let i = 0; i < 3; i++) head.add(seg(pts[i], pts[i + 1], rads[i], rads[i + 1], M.plate));
        const tip = new THREE.Mesh(cone(0.035, 0.18, 8), M.ceramic);
        tip.position.copy(pts[3]).add(v(-s * 0.02, -0.02, 0.08));
        tip.quaternion.setFromUnitVectors(UP, v(-s * 0.2, -0.2, 1).normalize());
        head.add(tip);
      }
      break;
    case 'satellite_ears':
      for (const s of [-1, 1]) {
        const end = v(s * 0.5, 0.22, -0.1);
        head.add(seg(v(s * 0.28, 0.06, -0.05), end, 0.035, 0.03, M.mech));
        const dish = new THREE.Mesh(geo('dish', () => new THREE.SphereGeometry(0.2, 18, 8, 0, Math.PI * 2, 0, 0.95)), M.plate);
        const facing = v(s * 0.8, 0.2, 0.55).normalize();
        dish.position.copy(end).addScaledVector(facing, 0.17);
        dish.quaternion.setFromUnitVectors(UP, facing.clone().negate());
        head.add(dish, at(new THREE.Mesh(sphere(0.04), M.glow), end.x + s * 0.02, end.y, end.z + 0.02));
      }
      break;
    case 'bonk_dome': {
      const dome = new THREE.Mesh(geo('dome', () => new THREE.SphereGeometry(1, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2)), M.plate);
      dome.scale.set(0.44, 0.34, 0.5);
      dome.position.set(0, 0.06, 0.02);
      head.add(dome);
      for (const x of [-0.14, 0, 0.14]) {
        const rib = new THREE.Mesh(bandGeo(2.2), M.mech);
        rib.rotation.y = Math.PI / 2;
        rib.scale.set(0.035, 0.36, 0.46);
        rib.position.set(x, 0.06, 0.02);
        head.add(rib);
      }
      hatLift = 0.14;
      break;
    }
  }

  // --- back
  switch (c.parts.back) {
    case 'squishy_padding':
      for (const [x, z] of [[-0.24, 0.25], [0.24, 0.25], [-0.24, -0.3], [0.24, -0.3]]) {
        const pod = new THREE.Mesh(geo('pod', () => new THREE.CapsuleGeometry(0.13, 0.3, 4, 12)), M.gel);
        pod.rotation.x = Math.PI / 2;
        pod.position.set(x * look.bulk, topAt(z * look.length) - 0.02, z * look.length);
        body.add(pod);
      }
      for (const z of [0.25, -0.3]) {
        const strap = new THREE.Mesh(bandGeo(1.6), M.mech);
        strap.scale.set(rx * 1.04, ry * 1.07, 0.1);
        strap.position.set(0, bodyY, z * look.length);
        body.add(strap);
      }
      break;
    case 'back_spikes':
      for (let i = 0; i < 5; i++) {
        const z = (0.45 - i * 0.28) * look.length;
        const sp = new THREE.Mesh(cone(0.09, 0.5 - i * 0.05, 6), M.plate);
        sp.position.set(0, topAt(z) + 0.16, z);
        sp.rotation.x = -0.65;
        body.add(sp);
      }
      break;
    case 'armor_plates':
      for (let i = 0; i < 4; i++) {
        const z = (0.45 - i * 0.32) * look.length;
        const zn = z / rz;
        const taper = zn < 0 ? 1 + zn * 0.3 : 1 - zn * zn * 0.14;
        const p = new THREE.Mesh(bandGeo(2.1), M.plate);
        p.material.side = THREE.DoubleSide;
        p.scale.set(rx * 1.1 * taper * 1.05, ry * 1.18 * taper, 0.36);
        p.position.set(0, bodyY + 0.02, z);
        p.rotation.x = -0.08;
        body.add(p);
      }
      break;
    case 'turtle_shell': {
      const sh = new THREE.Mesh(geo('shell', () => new THREE.SphereGeometry(1, 36, 14, 0, Math.PI * 2, 0, Math.PI / 2)), M.plate);
      sh.scale.set(rx * 1.16, ry * 1.32, rz * 0.94);
      sh.position.set(0, bodyY - 0.04, -0.12);
      body.add(sh);
      const rim = new THREE.Mesh(geo('shellrim', () => new THREE.TorusGeometry(1, 0.025, 6, 48)), M.glow);
      rim.rotation.x = Math.PI / 2;
      rim.scale.set(rx * 1.16, rz * 0.94, 1);
      rim.position.set(0, bodyY - 0.02, -0.12);
      body.add(rim);
      for (const x of [-0.2, 0.2]) {
        const ridge = new THREE.Mesh(bandGeo(2.4), M.mech);
        ridge.rotation.y = Math.PI / 2;
        ridge.scale.set(0.03, ry * 1.34, rz * 0.94);
        ridge.position.set(x * look.bulk, bodyY - 0.04, -0.12);
        body.add(ridge);
      }
      hatLift = Math.max(hatLift, 0.05);
      break;
    }
    case 'wings':
      for (const s of [-1, 1]) {
        const g = new THREE.Group();
        g.position.set(s * 0.32 * look.bulk, topAt(0) - 0.04, -0.05);
        g.userData.side = s;
        const tips = [v(s * 1.45, 0.3, 0.12), v(s * 1.25, 0.16, -0.5), v(s * 0.7, 0.02, -0.78)];
        for (const t of tips) g.add(seg(v(0, 0, 0), t, 0.035, 0.015, M.mech));
        const mg = new THREE.BufferGeometry().setFromPoints([v(0, 0, 0), tips[0], tips[1], v(0, 0, 0), tips[1], tips[2]]);
        mg.computeVertexNormals();
        g.add(new THREE.Mesh(mg, M.membrane));
        body.add(g);
        anim.wings.push(g);
      }
      break;
  }

  // --- tail: a chain of segments that sway
  const tailRoot = new THREE.Group();
  tailRoot.position.set(0, bodyY - 0.02, -rz * 0.86);
  body.add(tailRoot);
  const chain = (n, len, r0, r1, pitch, mat = M.armor) => {
    let parent = tailRoot;
    for (let i = 0; i < n; i++) {
      const g = new THREE.Group();
      g.position.z = i ? -len : 0;
      g.rotation.x = pitch;
      g.userData.pitch = pitch;
      g.userData.i = i;
      const ra = r0 + ((r1 - r0) * i) / n;
      const rb = r0 + ((r1 - r0) * (i + 1)) / n;
      g.add(seg(v(0, 0, 0), v(0, 0, -len), ra, rb, mat));
      if (i) g.add(new THREE.Mesh(sphere(r2(ra * 1.05)), M.mech));
      parent.add(g);
      anim.tailSegs.push(g);
      parent = g;
    }
    const end = new THREE.Group();
    end.position.z = -len;
    parent.add(end);
    return end;
  };
  switch (c.parts.tail) {
    case 'fluffy_tail': {
      const end = chain(3, 0.34, 0.15, 0.1, -0.12);
      end.add(at(new THREE.Mesh(rbox(0.3, 0.26, 0.42, 0.06), M.plate), 0, 0, -0.16));
      end.add(at(new THREE.Mesh(rbox(0.32, 0.04, 0.04, 0.01), M.glow), 0, 0, -0.02));
      break;
    }
    case 'whip_tail': {
      const end = chain(6, 0.36, 0.1, 0.025, 0.04);
      const blade = new THREE.Mesh(cone(0.05, 0.3, 4), M.glow);
      blade.rotation.x = -Math.PI / 2;
      blade.position.z = -0.12;
      end.add(blade);
      break;
    }
    case 'tail_club': {
      const end = chain(4, 0.3, 0.14, 0.09, 0.05);
      end.add(at(new THREE.Mesh(geo('mace', () => new THREE.IcosahedronGeometry(0.28, 0)), M.plate), 0, 0, -0.2));
      for (let i = 0; i < 8; i++) {
        const dir = new THREE.Vector3().setFromSphericalCoords(1, Math.acos(1 - (2 * (i + 0.5)) / 8), i * 2.4);
        const sp = new THREE.Mesh(cone(0.05, 0.2, 5), M.ceramic);
        sp.position.copy(dir.clone().multiplyScalar(0.3)).add(v(0, 0, -0.2));
        sp.quaternion.setFromUnitVectors(UP, dir);
        end.add(sp);
      }
      break;
    }
    case 'stinger': {
      const end = chain(5, 0.3, 0.13, 0.07, 0.5);
      end.add(at(new THREE.Mesh(sphere(0.15), M.gel), 0, 0, -0.08));
      const barb = new THREE.Mesh(cone(0.05, 0.32, 6), M.ceramic);
      barb.position.set(0, -0.1, -0.24);
      barb.rotation.x = -2.2;
      end.add(barb);
      break;
    }
    default:
      chain(2, 0.28, 0.13, 0.05, 0.08);
  }

  // --- utility
  switch (c.parts.utility) {
    case 'sniffer_nose': {
      head.add(at(new THREE.Mesh(rbox(0.2, 0.1, 0.2, 0.03), M.mech), 0, 0.12, HF - 0.06));
      for (const y of [0.1, 0.13, 0.16]) head.add(at(new THREE.Mesh(rbox(0.14, 0.012, 0.02, 0.005), M.glow), 0, y - 0.01, HF + 0.04));
      break;
    }
    case 'puff_sac': {
      const sac = new THREE.Mesh(sphere(0.26), M.gel);
      sac.scale.set(1, 0.8, 1.1);
      sac.position.set(0, -0.3, HF - 0.3);
      head.add(sac);
      break;
    }
    case 'ink_sac':
      for (const s of [-1, 1]) {
        const can = seg(v(s * rx * 0.92, bodyY + 0.06, 0.05), v(s * rx * 0.92, bodyY + 0.06, -0.55), 0.11, 0.11, M.mech);
        body.add(can);
        const cap = new THREE.Mesh(geo('vent', () => new THREE.TorusGeometry(0.1, 0.02, 6, 16)), M.plate);
        cap.position.set(s * rx * 0.92, bodyY + 0.06, -0.56);
        body.add(cap);
      }
      break;
    case 'healing_gland': {
      const z = -0.35 * look.length;
      const y = topAt(z) + 0.14;
      const vial = new THREE.Mesh(geo('vial', () => new THREE.CapsuleGeometry(0.12, 0.34, 4, 12)), M.regen);
      vial.rotation.x = Math.PI / 2;
      vial.position.set(0, y, z);
      body.add(vial);
      for (const [x, yy] of [[-0.13, 0.08], [0.13, 0.08], [0, 0.15]]) body.add(seg(v(x, y + yy - 0.02, z + 0.26), v(x, y + yy - 0.02, z - 0.26), 0.015, 0.015, M.mech));
      for (const dz of [0.26, -0.26]) body.add(at(new THREE.Mesh(geo('vialcap', () => new THREE.CylinderGeometry(0.15, 0.15, 0.05, 16).rotateX(Math.PI / 2)), M.plate), 0, y, z + dz));
      break;
    }
    case 'shield_bubble': {
      const y = topAt(-0.15) + 0.06;
      body.add(at(new THREE.Mesh(geo('emitbase', () => new THREE.CylinderGeometry(0.2, 0.26, 0.1, 20)), M.mech), 0, y, -0.15));
      const ring = new THREE.Mesh(geo('emitring', () => new THREE.TorusGeometry(0.24, 0.025, 8, 28)), M.glow);
      ring.rotation.x = Math.PI / 2;
      ring.position.set(0, y + 0.08, -0.15);
      body.add(ring, at(new THREE.Mesh(sphere(0.08), M.glow), 0, y + 0.1, -0.15));
      break;
    }
  }

  // --- eyes (head-local)
  switch (c.parts.eyes) {
    case 'googly_eyes':
      // two primary optics plus a smaller pair, set into the brow and angled outward
      for (const s of [-1, 1]) {
        for (const [x, y, z, r, yawOut] of [[0.17, 0.08, HF - 0.1, 0.045, 0.45], [0.24, 0.13, HF - 0.22, 0.026, 0.8]]) {
          const g = new THREE.Group();
          g.position.set(s * x, y, z);
          g.rotation.y = s * yawOut;
          const lensM = new THREE.Mesh(geo(`elens${r}`, () => new THREE.SphereGeometry(r, 14, 10)), M.glow);
          lensM.scale.set(1.3, 0.75, 0.6);
          const lid = new THREE.Mesh(rbox(r * 3.2, r * 0.9, r * 2.4, r * 0.3), M.mech);
          lid.position.set(0, r * 0.7, -r * 0.4);
          g.add(lensM, lid);
          head.add(g);
        }
      }
      break;
    case 'wide_eyes': {
      const housing = new THREE.Mesh(geo('visorh', () => new THREE.CylinderGeometry(0.4, 0.4, 0.14, 28, 1, true, -1.0, 2.0)), M.lens);
      housing.material.side = THREE.DoubleSide;
      housing.position.set(0, 0.07, 0.02);
      const band = new THREE.Mesh(geo('visor', () => new THREE.CylinderGeometry(0.405, 0.405, 0.05, 28, 1, true, -0.85, 1.7)), M.glow);
      band.position.set(0, 0.07, 0.02);
      head.add(housing, band);
      break;
    }
    case 'stalk_eyes':
      for (const s of [-1, 1]) {
        const top = v(s * 0.26, 0.66, 0.05);
        head.add(seg(v(s * 0.12, 0.2, -0.05), top, 0.035, 0.025, M.mech));
        head.add(at(new THREE.Mesh(rbox(0.16, 0.12, 0.18, 0.03), M.armor), top.x, top.y + 0.04, top.z));
        const lensM = new THREE.Mesh(geo('slens', () => new THREE.CylinderGeometry(0.045, 0.045, 0.02, 14).rotateX(Math.PI / 2)), M.glow);
        lensM.position.set(top.x, top.y + 0.04, top.z + 0.095);
        head.add(lensM);
      }
      break;
    default:
      head.add(at(new THREE.Mesh(rbox(0.32, 0.035, 0.03, 0.01), M.glow), 0, 0.07, HF + 0.005));
  }

  // --- weapon: a turret on the right shoulder; barrel points along +z, muzzle marks where shots leave
  {
    const mount = new THREE.Group();
    mount.position.set(rx * 0.62, bodyY + ry * 0.62, rz * 0.2);
    body.add(mount);
    mount.add(at(new THREE.Mesh(geo('wmount', () => new THREE.CylinderGeometry(0.11, 0.15, 0.1, 16)), M.mech), 0, 0, 0));
    const gun = new THREE.Group();
    gun.position.y = 0.12;
    mount.add(gun);
    const muzzle = new THREE.Object3D();
    const barrel = (len, r, x = 0, y = 0, z0 = 0.1) => {
      const b = seg(v(x, y, z0), v(x, y, z0 + len), r, r * 0.9, M.mech);
      gun.add(b);
      return z0 + len;
    };
    const glowRing = (r, z, y = 0) => {
      const ring = new THREE.Mesh(geo(`wring${r}`, () => new THREE.TorusGeometry(r, r * 0.22, 6, 18)), M.glow);
      ring.position.set(0, y, z);
      gun.add(ring);
    };
    switch (st.weapon.model) {
      case 'pulse_blaster': {
        gun.add(at(new THREE.Mesh(rbox(0.16, 0.15, 0.46, 0.04), M.armor), 0, 0, 0.05));
        const end = barrel(0.32, 0.045, 0, 0.01, 0.26);
        glowRing(0.055, 0.34, 0.01);
        glowRing(0.055, 0.44, 0.01);
        muzzle.position.set(0, 0.01, end);
        break;
      }
      case 'scatter_cannon': {
        gun.add(at(new THREE.Mesh(rbox(0.26, 0.17, 0.4, 0.04), M.armor), 0, 0, 0.02));
        for (const [x, y] of [[-0.06, 0.03], [0.06, 0.03], [0, -0.05]]) barrel(0.22, 0.04, x, y, 0.2);
        gun.add(at(new THREE.Mesh(rbox(0.28, 0.03, 0.04, 0.01), M.glow), 0, 0.09, 0.18));
        muzzle.position.set(0, 0, 0.44);
        break;
      }
      case 'plasma_mortar': {
        gun.rotation.x = -0.55;
        gun.add(at(new THREE.Mesh(rbox(0.2, 0.18, 0.24, 0.05), M.armor), 0, 0, -0.04));
        gun.add(seg(v(0, 0, 0.05), v(0, 0, 0.42), 0.11, 0.1, M.plate));
        glowRing(0.1, 0.42);
        muzzle.position.set(0, 0, 0.44);
        break;
      }
      case 'needle_swarm': {
        gun.add(at(new THREE.Mesh(rbox(0.24, 0.2, 0.3, 0.05), M.armor), 0, 0, 0.05));
        for (let i = 0; i < 6; i++) gun.add(at(new THREE.Mesh(sphere(0.022, 8, 6), M.glow), -0.06 + (i % 3) * 0.06, i < 3 ? 0.04 : -0.04, 0.2));
        muzzle.position.set(0, 0, 0.22);
        break;
      }
      case 'rail_lance': {
        gun.add(at(new THREE.Mesh(rbox(0.18, 0.16, 0.3, 0.04), M.armor), 0, 0, -0.08));
        for (const x of [-0.05, 0.05]) gun.add(at(new THREE.Mesh(rbox(0.03, 0.06, 0.85, 0.01), M.plate), x, 0, 0.45));
        gun.add(at(new THREE.Mesh(rbox(0.025, 0.02, 0.8, 0.008), M.glow), 0, 0, 0.45));
        muzzle.position.set(0, 0, 0.88);
        break;
      }
      case 'arc_caster': {
        gun.add(seg(v(0, 0, -0.05), v(0, 0, 0.38), 0.07, 0.05, M.armor));
        for (const z of [0.1, 0.2, 0.3]) glowRing(0.075, z);
        for (const a of [0, 2.1, 4.2]) gun.add(seg(v(Math.cos(a) * 0.05, Math.sin(a) * 0.05, 0.36), v(Math.cos(a) * 0.08, Math.sin(a) * 0.08, 0.5), 0.012, 0.008, M.mech));
        muzzle.position.set(0, 0, 0.5);
        break;
      }
      default: { // sidearm
        gun.add(at(new THREE.Mesh(rbox(0.12, 0.12, 0.3, 0.03), M.armor), 0, 0, 0.02));
        const end = barrel(0.18, 0.03, 0, 0.01, 0.17);
        muzzle.position.set(0, 0.01, end);
      }
    }
    gun.add(muzzle);
    gun.userData.z = gun.position.z;
    anim.weapon = gun;
    anim.muzzle = muzzle;
  }

  // --- cosmetics (head-local)
  const HT = HY + hatLift;
  switch (c.parts.hat) {
    case 'party_hat': {
      head.add(at(new THREE.Mesh(rbox(0.1, 0.06, 0.1, 0.02), M.mech), 0.12, HT - 0.02, -0.12));
      head.add(seg(v(0.12, HT, -0.12), v(0.14, HT + 0.9, -0.24), 0.018, 0.01, M.mech));
      const beacon = new THREE.Mesh(sphere(0.045), M.glow.clone());
      beacon.position.set(0.14, HT + 0.92, -0.24);
      head.add(beacon);
      anim.beacon = beacon;
      break;
    }
    case 'propeller_cap': {
      const drone = new THREE.Group();
      drone.position.set(0.75, bodyY + 1.0, -0.35);
      drone.add(new THREE.Mesh(rbox(0.24, 0.08, 0.24, 0.03), M.armor));
      drone.add(at(new THREE.Mesh(sphere(0.035), M.glow), 0, -0.02, 0.12));
      for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        drone.add(seg(v(0, 0, 0), v(x * 0.2, 0.02, z * 0.2), 0.015, 0.015, M.mech));
        const rotor = new THREE.Mesh(rbox(0.22, 0.008, 0.03, 0.004), M.mech);
        rotor.position.set(x * 0.2, 0.05, z * 0.2);
        drone.add(rotor);
        anim.rotors.push(rotor);
      }
      body.add(drone);
      anim.drone = drone;
      break;
    }
    case 'top_hat': {
      const fin = new THREE.Mesh(rbox(0.04, 0.55, 0.42, 0.02), M.plate);
      fin.position.set(0, HT + 0.18, -0.12);
      fin.rotation.x = -0.4;
      const edge = new THREE.Mesh(rbox(0.05, 0.5, 0.02, 0.008), M.glow);
      edge.position.set(0, HT + 0.2, 0.08);
      edge.rotation.x = -0.4;
      head.add(fin, edge);
      break;
    }
    case 'tiny_crown': {
      const halo = new THREE.Mesh(geo('halo', () => new THREE.TorusGeometry(0.28, 0.022, 8, 40)), M.glow);
      halo.rotation.x = Math.PI / 2;
      halo.position.set(0, HT + 0.32, -0.05);
      halo.userData.y = HT + 0.32;
      head.add(halo);
      anim.halo = halo;
      break;
    }
  }

  root.scale.setScalar(look.size);
  if (!silhouette) {
    root.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      o.receiveShadow = true;
    });
  }
  const top = new THREE.Box3().setFromObject(root).max.y;
  return { root, anim, height: Math.max((bodyY + 0.8) * look.size, top), radius: 1.1 };
}

// Grounded procedural animation shared by the editor, thumbnails and battle.
// o.attack (0..1) drives strikes, o.hit (0..1) flashes the hull, o.lean tilts into movement.
export function animateCreature(a, t, moveAmt, dt, o = {}) {
  const attack = o.attack || 0;
  const freq = o.freq || 8.5;
  for (const leg of a.legs) {
    const ph = t * freq + leg.userData.phase;
    if (a.legStyle === 'flap') leg.rotation.z = Math.sin(ph) * 0.35 * moveAmt * Math.sign(leg.position.x || 1);
    else {
      leg.rotation.x = Math.sin(ph) * 0.45 * moveAmt;
      leg.position.y = a.bodyY - 0.32 + Math.max(0, Math.cos(ph)) * 0.05 * moveAmt;
    }
  }
  a.body.position.y = Math.abs(Math.sin(t * freq)) * 0.05 * moveAmt + Math.sin(t * 1.7) * 0.012;
  a.body.position.z = attack * 0.18;
  a.body.rotation.x = (o.lean || 0) + attack * 0.08;
  a.body.rotation.z = Math.sin(t * freq * 0.5) * 0.02 * moveAmt;
  if (a.torso) a.torso.scale.y = 1 + Math.sin(t * 1.7) * 0.012;
  if (a.head) {
    a.head.rotation.y = Math.sin(t * 0.6) * 0.12 * (1 - moveAmt);
    a.head.rotation.x = -attack * 0.15;
  }
  if (a.jaw) a.jaw.rotation.x = attack * 0.55;
  if (a.weapon) a.weapon.position.z = a.weapon.userData.z - (o.fire || 0) * 0.12;
  for (const m of a.mandibles) m.rotation.y = -m.userData.side * (0.15 - attack * 0.6);
  for (const arm of a.arms) arm.rotation.x = Math.sin(t * freq + (arm.userData.side > 0 ? Math.PI : 0)) * 0.12 * moveAmt - attack * 0.7;
  a.tailSegs.forEach((s, i) => {
    s.rotation.y = Math.sin(t * 2.2 - i * 0.7) * (0.1 + 0.08 * moveAmt);
    s.rotation.x = s.userData.pitch + Math.sin(t * 1.5 - i * 0.5) * 0.03;
  });
  for (const w of a.wings) w.rotation.z = w.userData.side * (-0.15 + Math.sin(t * 10) * 0.35 * moveAmt);
  if (a.drone) {
    a.drone.position.y = a.bodyY + 1.0 + Math.sin(t * 2.3) * 0.08;
    for (const r of a.rotors) r.rotation.y += dt * 40;
  }
  if (a.halo) {
    a.halo.rotation.z += dt * 0.8;
    a.halo.position.y = a.halo.userData.y + Math.sin(t * 1.8) * 0.03;
  }
  if (a.beacon) a.beacon.visible = Math.sin(t * 4) > -0.3;
  const M = a.mats;
  if (M) {
    const pulse = 0.85 + Math.sin(t * 2.4) * 0.15;
    const dim = o.dim ?? 1;
    M.hull.emissiveIntensity = M.glowI * pulse * dim;
    M.glow.emissiveIntensity = (M.glowI + 0.6) * pulse * dim;
    const flash = 1 + (o.hit || 0) * 2.5;
    M.hull.color.setScalar(flash);
    M.armor.color.set(M.armorBase || (M.armorBase = M.armor.color.clone())).multiplyScalar(flash);
  }
}

export function disposeMesh(root) {
  const cached = new Set(geoCache.values());
  root.traverse((o) => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (m === SIL) continue;
      for (const k of ['map', 'bumpMap', 'emissiveMap']) m[k]?.dispose();
      m.dispose();
    }
    // cached geometries are shared; only dispose one-off ones
    if (!cached.has(o.geometry)) o.geometry.dispose();
  });
}

export const specialInfo = (id) => (id ? SPECIALS[id] : null);
