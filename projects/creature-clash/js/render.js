// Shared look-dev: filmic tone mapping and a studio environment map so metal and clearcoat read correctly.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

export function setupLookdev(renderer, scene, { exposure = 1.0 } = {}) {
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = exposure;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;
  pmrem.dispose();
  scene.environment = env;
  return env;
}

// Tileable canvas texture for ground and lanes.
export function surfaceTexture(base, { tile = 0, seams = null, noise = 0.12, size = 512 } = {}) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d');
  g.fillStyle = `#${new THREE.Color(base).getHexString()}`;
  g.fillRect(0, 0, size, size);
  for (let i = 0; i < size * 6; i++) {
    const l = Math.random();
    g.fillStyle = l < 0.5 ? `rgba(0,0,0,${noise * Math.random()})` : `rgba(255,255,255,${noise * 0.6 * Math.random()})`;
    const r = 1 + Math.random() * 3;
    g.fillRect(Math.random() * size, Math.random() * size, r, r);
  }
  for (let i = 0; i < 18; i++) {
    const grad = g.createRadialGradient(0, 0, 0, 0, 0, 60 + Math.random() * 90);
    grad.addColorStop(0, `rgba(0,0,0,${0.12 * Math.random()})`);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.save();
    g.translate(Math.random() * size, Math.random() * size);
    g.fillStyle = grad;
    g.fillRect(-150, -150, 300, 300);
    g.restore();
  }
  if (tile) {
    g.strokeStyle = 'rgba(0,0,0,0.35)';
    g.lineWidth = 2;
    for (let x = 0; x <= size; x += size / tile) {
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, size);
      g.stroke();
      g.beginPath();
      g.moveTo(0, x);
      g.lineTo(size, x);
      g.stroke();
    }
  }
  if (seams) seams(g, size);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}
