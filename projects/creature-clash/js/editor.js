// Creature editor: part palette (owned / buyable / sealed pods), appearance customizer, live 3D preview, stat card.
import * as THREE from 'three';
import {
  SLOTS, PARTS, PART_BY_ID, TIERS, SPECIALS, partCost, FINISHES, PATTERNS, HULL_COLORS, GLOW_COLORS, LOOK_PRESETS, DEFAULT_LOOK,
} from './data.js';
import { computeStats, roleTag, validate, buildCreatureMesh, animateCreature, disposeMesh, lookOf, randomLook } from './creature.js';
import { setupLookdev } from './render.js';
import { getProfile, isOwned, isUnlocked, buyPart } from './profile.js';
import { h, statBar, toast, dnaIcon } from './ui.js';

export function mountEditor(container, { creature, actions = [], onChange, compact = false }) {
  let c = structuredClone(creature);
  c.look = lookOf(c);
  delete c.color;
  delete c.pattern;
  let slot = 'legs';
  let pendingBuy = null;
  let leftTab = 'parts';

  const canvasWrap = h('div', { class: 'preview-canvas' });
  const palette = h('div', { class: 'part-grid' });
  const tabs = h('div', { class: 'slot-tabs' });
  const inspector = h('div', { class: 'inspector-body' });
  const budget = h('div', { class: 'budget' });
  const partsPane = h('div', {}, tabs, palette);
  const lookPane = h('div', { class: 'look-pane' });
  const leftTabs = h('div', { class: 'seg-tabs' });

  container.replaceChildren(
    h('div', { class: `editor ${compact ? 'compact' : ''}` },
      h('aside', { class: 'panel palette' }, leftTabs, partsPane, lookPane),
      h('section', { class: 'panel preview' },
        canvasWrap,
        h('div', { class: 'preview-hint' }, 'Drag to orbit · Scroll to zoom'),
        budget),
      h('aside', { class: 'panel inspector' }, inspector)),
  );

  // ---- 3D preview
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(2, devicePixelRatio));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  canvasWrap.append(renderer.domElement);
  const scene = new THREE.Scene();
  setupLookdev(renderer, scene, { exposure: 0.85 });
  scene.add(new THREE.HemisphereLight(0xcfe0ff, 0x101216, 0.5));
  const key = new THREE.DirectionalLight(0xffffff, 2.6);
  key.position.set(3, 7, 4);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.bias = -0.0005;
  key.shadow.normalBias = 0.02;
  Object.assign(key.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4, near: 1, far: 20 });
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x9fd8ff, 1.8);
  rim.position.set(-4, 3, -4);
  scene.add(rim);
  const pad = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.75, 0.16, 64), new THREE.MeshStandardMaterial({ color: 0x15171c, metalness: 0.7, roughness: 0.35 }));
  pad.position.y = -0.08;
  pad.receiveShadow = true;
  scene.add(pad);
  const ringMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0x38e1ff, emissiveIntensity: 1.6 });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(2.62, 0.02, 8, 96), ringMat);
  ring.rotation.x = Math.PI / 2;
  scene.add(ring);
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
  const turn = new THREE.Group();
  scene.add(turn);
  let mesh = null;
  let yaw = -0.6;
  let pitch = 0.32;
  let zoom = 1;
  let dragging = null;
  let lastInput = 0;

  const rebuildMesh = () => {
    if (mesh) {
      turn.remove(mesh.root);
      disposeMesh(mesh.root);
    }
    mesh = buildCreatureMesh(c);
    turn.add(mesh.root);
    ringMat.emissive.set(c.look.glow);
  };
  // throttle rebuilds while dragging sliders or color pickers
  let rebuildQueued = false;
  const queueRebuild = () => {
    if (rebuildQueued) return;
    rebuildQueued = true;
    requestAnimationFrame(() => {
      rebuildQueued = false;
      rebuildMesh();
      onChange?.(c);
    });
  };

  const cv = renderer.domElement;
  cv.addEventListener('pointerdown', (e) => {
    dragging = [e.clientX, e.clientY];
    cv.setPointerCapture(e.pointerId);
  });
  cv.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    yaw += (e.clientX - dragging[0]) * 0.01;
    pitch = Math.max(-0.05, Math.min(1.1, pitch + (e.clientY - dragging[1]) * 0.006));
    dragging = [e.clientX, e.clientY];
    lastInput = performance.now();
  });
  cv.addEventListener('pointerup', () => (dragging = null));
  cv.addEventListener('wheel', (e) => {
    e.preventDefault();
    zoom = Math.max(0.55, Math.min(1.6, zoom * (1 + Math.sign(e.deltaY) * 0.08)));
    lastInput = performance.now();
  }, { passive: false });

  const resize = () => {
    const w = canvasWrap.clientWidth || 300;
    const ht = canvasWrap.clientHeight || 300;
    renderer.setSize(w, ht, false);
    camera.aspect = w / ht;
    camera.updateProjectionMatrix();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(canvasWrap);

  let raf = 0;
  let last = performance.now();
  const loop = (now) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (!dragging && now - lastInput > 2500) yaw += dt * 0.25;
    turn.rotation.y = yaw;
    if (mesh) {
      const ht = Math.max(mesh.height, 2.2);
      const d = (ht * 3.3 * zoom) / Math.min(1, camera.aspect * 1.15); // back off in narrow previews
      camera.position.set(0, ht * 0.45 + Math.sin(pitch) * d, Math.cos(pitch) * d);
      camera.lookAt(0, ht * 0.42, 0);
      animateCreature(mesh.anim, now / 1000, 0, dt);
    }
    renderer.render(scene, camera);
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);

  // ---- UI
  function partCard(p) {
    const equipped = c.parts[p.slot] === p.id;
    if (!isUnlocked(p.id)) {
      return h('div', { class: 'part-card sealed', title: 'Sealed mystery pod' },
        h('div', { class: 'pod' }),
        h('div', { class: 'part-name' }, 'Sealed pod'),
        h('div', { class: 'part-meta' }, `Unlocks at Lv ${p.level}`));
    }
    const owned = isOwned(p.id);
    const tier = TIERS[p.tier];
    const stats = [];
    const s = p.stats || {};
    if (s.speed) stats.push(`${s.speed > 0 ? '+' : ''}${s.speed} spd`);
    if (s.hp) stats.push(`+${s.hp} hp`);
    if (s.armor) stats.push(`${Math.round(s.armor * 100)}% armor`);
    if (s.stability) stats.push(`${s.stability > 0 ? '+' : ''}${s.stability} stab`);
    if (s.vision) stats.push(`+${s.vision} vision`);
    if (s.thorns) stats.push(`${s.thorns} thorns`);
    if (p.attack) stats.push(`${p.attack.name} ${p.attack.dmg}`);
    if (p.weapon) stats.push(`${p.weapon.pellets ? `${p.weapon.pellets}×` : ''}${p.weapon.dmg} dmg · ${(1 / p.weapon.cd).toFixed(1)}/s · ${p.weapon.range}m`);
    if (p.special) stats.push(`★ ${SPECIALS[p.special].name}`);
    const buying = pendingBuy === p.id;
    return h('button', {
      class: `part-card ${equipped ? 'equipped' : ''} ${owned ? '' : 'unowned'} tier-${p.tier}`,
      title: p.desc,
      onclick: () => {
        if (owned) {
          c.parts[p.slot] = equipped && p.slot !== 'legs' ? null : p.id;
          pendingBuy = null;
          changed();
        } else {
          pendingBuy = buying ? null : p.id;
          renderPalette();
        }
      },
    },
    h('div', { class: 'part-name' }, p.name),
    h('div', { class: 'part-meta' }, `${tier.label} · wt ${p.weight}`),
    h('div', { class: 'part-stats' }, stats.join(' · ') || p.family),
    !owned && !buying && h('div', { class: 'price' }, dnaIcon(), ` ${partCost(p)}`),
    buying && h('div', { class: 'buy-confirm' },
      h('span', {}, `Buy for ${partCost(p)} DNA?`),
      h('span', {
        class: 'btn tiny primary',
        role: 'button',
        onclick: (e) => {
          e.stopPropagation();
          const r = buyPart(p.id);
          pendingBuy = null;
          if (r.ok) {
            toast(`${p.name} added to your parts`, 'good');
            c.parts[p.slot] = p.id;
            changed();
          } else {
            toast(r.reason, 'bad');
            renderPalette();
          }
        },
      }, 'Buy')),
    );
  }

  function renderTabs() {
    tabs.replaceChildren(...SLOTS.map((s) => h('button', {
      class: `slot-tab ${slot === s.id ? 'active' : ''}`,
      onclick: () => {
        slot = s.id;
        pendingBuy = null;
        renderTabs();
        renderPalette();
      },
    }, h('span', {}, s.label), h('small', {}, PART_BY_ID[c.parts[s.id]]?.name || '—'))));
  }

  function renderPalette() {
    const list = PARTS.filter((p) => p.slot === slot);
    const none = slot !== 'legs' && h('button', {
      class: `part-card none ${!c.parts[slot] ? 'equipped' : ''}`,
      onclick: () => {
        c.parts[slot] = null;
        changed();
      },
    }, h('div', { class: 'part-name' }, 'None'), h('div', { class: 'part-meta' }, 'Empty slot'));
    palette.replaceChildren(...[none, ...list.map(partCard)].filter(Boolean));
  }

  function renderLeftTabs() {
    leftTabs.replaceChildren(...[['parts', 'Parts'], ['look', 'Customize']].map(([id, label]) => h('button', {
      class: `seg-tab ${leftTab === id ? 'active' : ''}`,
      onclick: () => {
        leftTab = id;
        renderLeftTabs();
      },
    }, label)));
    partsPane.hidden = leftTab !== 'parts';
    lookPane.hidden = leftTab !== 'look';
    if (leftTab === 'look') renderLook();
  }

  // Appearance only: none of these change stats or hitboxes.
  function setLook(patch, rerender = true) {
    c.look = { ...c.look, ...patch };
    queueRebuild();
    if (rerender) renderLook();
  }

  function colorRow(label, key, choices) {
    return h('div', { class: 'look-row' },
      h('div', { class: 'look-label' }, h('span', {}, label), h('code', {}, c.look[key])),
      h('div', { class: 'swatches' },
        ...choices.map((col) => h('button', {
          class: `swatch ${c.look[key].toLowerCase() === col ? 'active' : ''}`, style: { background: col }, 'aria-label': `${label} ${col}`,
          onclick: () => setLook({ [key]: col }),
        })),
        h('label', { class: 'swatch custom', title: 'Custom color' },
          h('input', { type: 'color', value: c.look[key], oninput: (e) => setLook({ [key]: e.target.value }, false), onchange: () => renderLook() }))));
  }

  function slider(label, key, min, max, step, fmt) {
    const out = h('span', { class: 'look-val' }, fmt(c.look[key]));
    return h('div', { class: 'look-row' },
      h('div', { class: 'look-label' }, h('span', {}, label), out),
      h('input', {
        type: 'range', class: 'range', min, max, step, value: c.look[key],
        oninput: (e) => {
          const val = Number(e.target.value);
          out.textContent = fmt(val);
          setLook({ [key]: val }, false);
        },
      }));
  }

  function renderLook() {
    const pct = (x) => `${Math.round(x * 100)}%`;
    lookPane.replaceChildren(
      h('div', { class: 'look-row' },
        h('div', { class: 'look-label' }, h('span', {}, 'Presets')),
        h('div', { class: 'chip-row' }, ...LOOK_PRESETS.map(({ name, ...preset }) => h('button', { class: 'btn tiny', onclick: () => setLook(preset) }, name)))),
      colorRow('Hull', 'primary', HULL_COLORS),
      colorRow('Trim', 'secondary', HULL_COLORS),
      colorRow('Glow', 'glow', GLOW_COLORS),
      slider('Glow intensity', 'glowStrength', 0, 1, 0.05, pct),
      h('div', { class: 'look-row' },
        h('div', { class: 'look-label' }, h('span', {}, 'Finish')),
        h('div', { class: 'chip-row' }, ...Object.entries(FINISHES).map(([id, f]) => h('button', {
          class: `btn tiny ${c.look.finish === id ? 'primary' : ''}`, onclick: () => setLook({ finish: id }),
        }, f.label)))),
      h('div', { class: 'look-row' },
        h('div', { class: 'look-label' }, h('span', {}, 'Pattern')),
        h('div', { class: 'chip-row' }, ...Object.entries(PATTERNS).map(([id, label]) => h('button', {
          class: `btn tiny ${c.look.pattern === id ? 'primary' : ''}`, onclick: () => setLook({ pattern: id }),
        }, label)))),
      h('h4', { class: 'look-head' }, 'Proportions'),
      slider('Size', 'size', 0.85, 1.15, 0.01, pct),
      slider('Body length', 'length', 0.85, 1.2, 0.01, pct),
      slider('Bulk', 'bulk', 0.85, 1.2, 0.01, pct),
      h('p', { class: 'look-note muted' }, 'Appearance is cosmetic. It never changes stats or hitboxes.'),
      h('div', { class: 'chip-row' },
        h('button', { class: 'btn tiny', onclick: () => setLook(randomLook()) }, 'Randomize'),
        h('button', { class: 'btn tiny', onclick: () => setLook({ ...DEFAULT_LOOK }) }, 'Reset')),
    );
  }

  function renderInspector() {
    const st = computeStats(c);
    const v = validate(c, getProfile().owned);
    const pct = Math.min(100, (st.weight / st.budget) * 100);
    budget.replaceChildren(
      h('div', { class: 'budget-label' }, h('span', {}, 'Weight budget'), h('b', { class: st.overBudget ? 'bad' : '' }, `${st.weight} / ${st.budget}`)),
      h('div', { class: `budget-track ${st.overBudget ? 'over' : ''}` }, h('div', { class: 'budget-fill', style: { width: `${pct}%` } })),
    );
    const nameInput = h('input', {
      class: 'name-input', value: c.name, maxlength: 24, 'aria-label': 'Creature name',
      oninput: (e) => {
        c.name = e.target.value.slice(0, 24) || 'Unnamed';
        onChange?.(c);
      },
    });
    inspector.replaceChildren(...[
      nameInput,
      h('div', { class: 'role-row' }, h('span', { class: 'chip role' }, roleTag(c)), h('span', { class: 'muted' }, `${st.maxHp} hp`)),
      h('div', { class: 'stat-card' },
        statBar('Speed', st.card.speed), statBar('Toughness', st.card.toughness),
        statBar('Damage', st.card.damage), statBar('Stability', st.card.stability)),
      h('div', { class: 'moves' },
        h('h4', {}, 'Attacks'),
        h('div', { class: 'move' }, h('kbd', {}, 'F'), ` ${st.weapon.name}`, h('span', { class: 'muted' }, ` ${st.weapon.pellets > 1 ? `${st.weapon.pellets}×` : ''}${st.weapon.dmg} ${st.weapon.kind}${c.parts.weapon ? '' : ' (no weapon equipped)'}`)),
        ...st.attacks.map((a, i) => h('div', { class: 'move' }, h('kbd', {}, ['1', '2', '3'][i]), ` ${a.name}`, h('span', { class: 'muted' }, ` ${a.dmg} ${a.dtype}`))),
        h('h4', {}, 'Special'),
        st.specialIds.length > 1
          ? h('select', {
            class: 'special-select',
            onchange: (e) => {
              c.special = e.target.value;
              changed();
            },
          }, ...st.specialIds.map((id) => h('option', { value: id, selected: id === st.special }, SPECIALS[id].name)))
          : h('div', { class: 'move' }, h('kbd', {}, 'E'), ` ${st.special ? SPECIALS[st.special].name : 'None — add a part with ★'}`)),
      !v.ok && h('ul', { class: 'problems' }, ...v.problems.map((p) => h('li', {}, p))),
      h('div', { class: 'editor-actions' }, ...actions.map((a) => h('button', {
        class: `btn ${a.primary ? 'primary' : ''}`,
        onclick: () => a.onClick(structuredClone(c), v),
      }, a.label))),
    ].filter(Boolean));
  }

  function changed() {
    rebuildMesh();
    renderTabs();
    renderPalette();
    renderInspector();
    onChange?.(c);
  }

  rebuildMesh();
  renderLeftTabs();
  renderTabs();
  renderPalette();
  renderInspector();
  resize();

  return {
    getCreature: () => structuredClone(c),
    refresh: () => {
      renderPalette();
      renderInspector();
    },
    destroy() {
      cancelAnimationFrame(raf);
      ro.disconnect();
      if (mesh) disposeMesh(mesh.root);
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
