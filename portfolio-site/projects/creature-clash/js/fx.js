// Additive particle effects (they glow under bloom): flashes, sparks, puffs, rings, beams, lightning, sky bursts.
import * as THREE from 'three';

const rnd = (a, b) => a + Math.random() * (b - a);
const UP = new THREE.Vector3(0, 1, 0);

export class Fx {
  constructor(scene) {
    this.scene = scene;
    this.items = [];
    this.geo = {};
  }

  shared(key, make) {
    return (this.geo[key] ??= make());
  }

  mat(color, opacity = 1) {
    return new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(2), transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
  }

  add(mesh, vel, life, { gravity = 0, grow = 0, drag = 0, shared = true, align = false } = {}) {
    mesh.userData.shared = shared;
    mesh.userData.align = align;
    this.scene.add(mesh);
    this.items.push({ mesh, vel, life, t: 0, gravity, grow, drag, base: mesh.scale.clone(), opacity: mesh.material.opacity });
    return mesh;
  }

  update(dt) {
    this.items = this.items.filter((p) => {
      p.t += dt;
      const k = p.t / p.life;
      if (p.vel) {
        p.vel.y -= p.gravity * dt;
        if (p.drag) p.vel.multiplyScalar(Math.exp(-p.drag * dt));
        p.mesh.position.addScaledVector(p.vel, dt);
        if (p.mesh.userData.align && p.vel.lengthSq() > 1e-4) p.mesh.quaternion.setFromUnitVectors(UP, p.vel.clone().normalize());
      }
      if (p.grow) p.mesh.scale.copy(p.base).multiplyScalar(Math.max(0.01, 1 + p.grow * k));
      p.mesh.material.opacity = p.opacity * Math.max(0, 1 - k);
      if (k < 1) return true;
      this.scene.remove(p.mesh);
      p.mesh.material.dispose();
      if (!p.mesh.userData.shared) p.mesh.geometry.dispose();
      return false;
    });
  }

  flash(pos, color, size, life) {
    const m = new THREE.Mesh(this.shared('flash', () => new THREE.SphereGeometry(1, 16, 12)), this.mat(color));
    m.scale.setScalar(size);
    m.position.copy(pos);
    return this.add(m, null, life, { grow: 1.5 });
  }

  puff(pos, color, size, life, vel = new THREE.Vector3(0, 0.5, 0)) {
    const m = new THREE.Mesh(this.shared('puff', () => new THREE.SphereGeometry(1, 14, 10)), this.mat(color, 0.6));
    m.scale.setScalar(size);
    m.position.copy(pos);
    return this.add(m, vel, life, { grow: -0.8 });
  }

  sparks(pos, color, n, speed, { gravity = 14, life = 0.45, scale = 1 } = {}) {
    if (this.items.length > 500) return;
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(this.shared('spark', () => new THREE.BoxGeometry(0.05, 0.35, 0.05)), this.mat(color));
      m.scale.setScalar(scale);
      m.position.copy(pos);
      const dir = new THREE.Vector3(rnd(-1, 1), rnd(-0.2, 1), rnd(-1, 1)).normalize().multiplyScalar(speed * rnd(0.5, 1.2));
      this.add(m, dir, life * rnd(0.6, 1.2), { gravity, drag: 2, align: true });
    }
  }

  ring(pos, r, color, life = 0.45, grow = 0.6) {
    const m = new THREE.Mesh(this.shared('ring', () => new THREE.RingGeometry(0.9, 1, 64)), this.mat(color, 0.8));
    m.rotation.x = -Math.PI / 2;
    m.scale.setScalar(r);
    m.position.set(pos.x, (pos.y || 0) + 0.15, pos.z);
    return this.add(m, null, life, { grow });
  }

  beam(from, to, color, width, life) {
    const d = to.clone().sub(from);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(width, width, d.length(), 8, 1, true), this.mat(color));
    m.position.copy(from).addScaledVector(d, 0.5);
    m.quaternion.setFromUnitVectors(UP, d.normalize());
    return this.add(m, null, life, { grow: -0.6, shared: false });
  }

  lightning(from, to, color, width = 0.05, life = 0.18) {
    const n = Math.max(4, Math.round(from.distanceTo(to) / 2.5));
    let prev = from;
    for (let i = 1; i <= n; i++) {
      const p = from.clone().lerp(to, i / n);
      if (i < n) p.add(new THREE.Vector3(rnd(-0.5, 0.5), rnd(-0.5, 0.5), rnd(-0.5, 0.5)));
      this.beam(prev, p, color, width, life);
      prev = p;
    }
    this.flash(to, color, 0.5, 0.15);
  }

  // A flare-like burst high in the sky: big glow, a shell of sparks, an expanding ring facing the camera.
  skyBurst(at, color, camera) {
    this.flash(at, 0xffffff, 1.5, 0.35);
    this.flash(at, color, 4, 0.9);
    for (let i = 0; i < 40 && this.items.length < 520; i++) {
      const m = new THREE.Mesh(this.shared('spark', () => new THREE.BoxGeometry(0.05, 0.35, 0.05)), this.mat(i % 3 ? color : 0xffffff));
      m.scale.setScalar(2.5);
      m.position.copy(at);
      const dir = new THREE.Vector3().setFromSphericalCoords(1, Math.acos(rnd(-1, 1)), rnd(0, Math.PI * 2)).multiplyScalar(rnd(10, 18));
      this.add(m, dir, rnd(0.8, 1.4), { gravity: 6, drag: 1.5, align: true });
    }
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.6, 2, 48), this.mat(color));
    ring.position.copy(at);
    if (camera) ring.lookAt(camera.position);
    this.add(ring, null, 0.7, { grow: 4, shared: false });
  }

  dispose() {
    for (const p of this.items) {
      this.scene.remove(p.mesh);
      p.mesh.material.dispose();
      if (!p.mesh.userData.shared) p.mesh.geometry.dispose();
    }
    this.items = [];
    Object.values(this.geo).forEach((g) => g.dispose());
  }
}
