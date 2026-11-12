// Shared offscreen renderer for creature portraits (slots, rosters, death screen, silhouettes).
import * as THREE from 'three';
import { buildCreatureMesh, animateCreature, disposeMesh, lookOf } from './creature.js';
import { setupLookdev } from './render.js';

let renderer, scene, camera;
const cache = new Map();

function setup() {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setSize(256, 256);
  scene = new THREE.Scene();
  setupLookdev(renderer, scene, { exposure: 0.9 });
  scene.add(new THREE.HemisphereLight(0xcfe0ff, 0x1a1c22, 0.6));
  const key = new THREE.DirectionalLight(0xffffff, 2.4);
  key.position.set(3, 5, 4);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x9fd8ff, 1.6);
  rim.position.set(-4, 2, -3);
  scene.add(rim);
  camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
}

export function creatureThumb(creature, { silhouette = false, size = 256 } = {}) {
  const key = JSON.stringify([creature.parts, lookOf(creature), silhouette]);
  if (cache.has(key)) return cache.get(key);
  if (!renderer) setup();
  const { root, anim, height } = buildCreatureMesh(creature, { silhouette });
  animateCreature(anim, 0.4, 0, 0);
  root.rotation.y = -0.65;
  scene.add(root);
  const h = Math.max(height, 2.2);
  camera.position.set(0, h * 0.72, h * 2.35);
  camera.lookAt(0, h * 0.42, 0);
  renderer.setSize(size, size);
  renderer.render(scene, camera);
  const url = renderer.domElement.toDataURL('image/png');
  scene.remove(root);
  disposeMesh(root);
  cache.set(key, url);
  return url;
}
