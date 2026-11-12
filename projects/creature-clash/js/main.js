// Screens and match flow: main menu, Workshop, Progress, build phase, battle, death screen, results.
import { PARTS, SLOTS, TIERS, BUILD_PHASE_SECONDS, SILHOUETTE_REVEAL_SECONDS, SAVE_SLOTS, DNA_REWARD, partCost, BIOMES, RACE_ITEMS } from './data.js';
import {
  getProfile, onProfileChange, xpProgress, addXP, recordMatch, recordRace, saveSlot, buyPart, isOwned, isUnlocked, DEV_BUILD,
} from './profile.js';
import { starterCreature, computeStats, roleTag, validate } from './creature.js';
import { mountEditor } from './editor.js';
import { Battle, makeBotRoster, partName } from './battle.js';
import { Race, ordinal, fmtRaceTime } from './race.js';
import { creatureThumb } from './thumbs.js';
import { installDevConsole } from './devconsole.js';
import { getSettings, setSetting } from './settings.js';
import { h, fmtTime, toast, dnaIcon } from './ui.js';

const app = document.getElementById('app');
const header = document.getElementById('topbar');
const screen = document.getElementById('screen');

let cleanup = [];
let current = null; // { battle } while a match runs
const runCleanup = () => {
  cleanup.forEach((fn) => fn());
  cleanup = [];
  current = null;
  document.body.classList.remove('in-battle');
  document.querySelectorAll('.overlay').forEach((o) => o.remove());
};

function go(render) {
  runCleanup();
  screen.replaceChildren();
  screen.scrollTop = 0;
  render();
}

// ------------------------------------------------------------ header

function renderHeader() {
  const p = getProfile();
  const xp = xpProgress(p.xp);
  header.replaceChildren(
    h('button', { class: 'logo-small', onclick: () => go(menu), 'aria-label': 'Main menu' }, 'CREATURE', h('span', {}, 'CLASH')),
    h('nav', { class: 'nav' },
      h('button', { class: 'nav-btn', onclick: () => go(menu) }, 'Play'),
      h('button', { class: 'nav-btn', onclick: () => go(workshop) }, 'Workshop'),
      h('button', { class: 'nav-btn', onclick: () => go(progress) }, 'Parts & Progress'),
      h('button', { class: 'nav-btn', onclick: () => go(howTo) }, 'How to play')),
    h('div', { class: 'wallet' },
      h('div', { class: 'level-badge', title: `${xp.into}/${xp.need} XP to next level` },
        h('span', {}, `LV ${xp.level}`),
        h('span', { class: 'xp-track' }, h('span', { class: 'xp-fill', style: { width: `${(xp.into / xp.need) * 100}%` } }))),
      h('div', { class: 'dna-count', title: 'DNA: earned only by killing players or bots' }, dnaIcon(), ` ${p.dna}`),
      DEV_BUILD && h('span', { class: 'chip dev', title: 'Dev build: Ctrl+Shift+C opens the developer console' }, 'DEV')),
  );
}
onProfileChange(renderHeader);

// ------------------------------------------------------------ main menu

function menu() {
  const p = getProfile();
  let size = 3;
  const sizeBtns = [3, 4].map((n) => h('button', {
    class: `seg ${n === size ? 'active' : ''}`,
    onclick: (e) => {
      size = n;
      sizeBtns.forEach((b) => b.classList.toggle('active', b === e.currentTarget));
    },
  }, `${n}v${n}`));
  screen.append(h('div', { class: 'menu' },
    h('div', { class: 'title-block' },
      h('div', { class: 'title-kicker' }, 'BIO-MECH COMBAT DIVISION'),
      h('h1', { class: 'game-title' }, 'CREATURE', h('br'), h('span', {}, 'CLASH')),
      h('p', { class: 'tagline' }, 'Engineer a combat organism. Hold the lanes. Break their nests.')),
    h('div', { class: 'menu-grid' },
      h('div', { class: 'panel menu-card play' },
        h('h2', {}, 'Battle'),
        h('p', {}, 'Two-minute build phase, then up to ten minutes of three-lane nest warfare against bots. Permadeath: if your creature falls, your match is over.'),
        h('div', { class: 'seg-row' }, h('span', { class: 'muted' }, 'Team size'), ...sizeBtns),
        h('button', { class: 'btn primary big', onclick: () => go(() => buildPhase(size)) }, 'Find match')),
      h('button', { class: 'panel menu-card link', onclick: () => go(workshop) },
        h('h2', {}, 'Workshop'),
        h('p', {}, `Build and customize without time pressure. ${p.slots.filter(Boolean).length}/${SAVE_SLOTS} slots used. Test Drive on the range.`)),
      h('button', { class: 'panel menu-card link', onclick: () => go(progress) },
        h('h2', {}, 'Parts & Progress'),
        h('p', {}, `${p.owned.length} parts owned · ${p.unlocked.length - p.owned.length} unlocked to buy · ${PARTS.length - p.unlocked.length} sealed`)),
      h('button', { class: 'panel menu-card link rally', onclick: () => go(raceSetup) },
        h('div', { class: 'title-kicker' }, 'NEW MODE'),
        h('h2', {}, 'Rift Rally'),
        h('p', {}, 'A combat race. Drift for boosts, grab item pods, shoot and slam rivals. Knocked-out racers get launched into orbit and respawn. First across the line after three laps wins.')),
      h('div', { class: 'panel menu-card stats' },
        h('h2', {}, 'Record'),
        h('div', { class: 'record' },
          ...[['Matches', p.stats.matches], ['Wins', p.stats.wins], ['Kills', p.stats.kills], ['Deaths', p.stats.deaths], ['Races', p.stats.races || 0], ['Race wins', p.stats.raceWins || 0]]
            .map(([k, v]) => h('div', {}, h('b', {}, v), h('span', {}, k)))))),
  ));
}

// ------------------------------------------------------------ workshop

function workshop() {
  const p = getProfile();
  const grid = h('div', { class: 'slot-grid' });
  p.slots.forEach((c, i) => {
    if (!c) {
      grid.append(h('button', { class: 'panel slot empty', onclick: () => go(() => editorScreen(i, starterCreature(`Creature ${i + 1}`))) },
        h('div', { class: 'plus' }, '+'), h('div', {}, 'New creature')));
      return;
    }
    const v = validate(c, p.owned);
    grid.append(h('div', { class: `panel slot ${v.ok ? '' : 'flagged'}` },
      h('img', { class: 'slot-thumb', src: creatureThumb(c), alt: `${c.name} portrait` }),
      h('div', { class: 'slot-name' }, c.name),
      h('div', { class: 'slot-meta' }, h('span', { class: 'chip role' }, roleTag(c)), ` wt ${computeStats(c).weight}`),
      !v.ok && h('div', { class: 'flag' }, `⚠ ${v.problems[0]} — can't be picked until fixed`),
      h('div', { class: 'slot-actions' },
        h('button', { class: 'btn tiny primary', onclick: () => go(() => editorScreen(i, c)) }, 'Edit'),
        h('button', { class: 'btn tiny', onclick: () => go(() => testDrive(c, () => go(workshop))) }, 'Test Drive'),
        h('button', {
          class: 'btn tiny danger',
          onclick: (e) => {
            if (e.currentTarget.dataset.armed) {
              saveSlot(i, null);
              go(workshop);
            } else {
              e.currentTarget.dataset.armed = '1';
              e.currentTarget.textContent = 'Really delete?';
            }
          },
        }, 'Delete'))));
  });
  screen.append(h('div', { class: 'page' },
    h('div', { class: 'page-head' }, h('h1', {}, 'Workshop'), h('p', { class: 'muted' }, 'Saved creatures can be picked during the build phase. No DNA can be earned in Test Drive.')),
    grid));
}

function editorScreen(index, creature) {
  const wrap = h('div', { class: 'editor-page' });
  screen.append(h('div', { class: 'page wide' },
    h('div', { class: 'page-head' },
      h('button', { class: 'btn tiny', onclick: () => go(workshop) }, '← Workshop'),
      h('h1', {}, `Slot ${index + 1}`)),
    wrap));
  const ed = mountEditor(wrap, {
    creature,
    actions: [
      {
        label: 'Save', primary: true,
        onClick: (c) => {
          saveSlot(index, c);
          toast(`Saved ${c.name}`, 'good');
        },
      },
      {
        label: 'Save & Test Drive',
        onClick: (c) => {
          saveSlot(index, c);
          go(() => testDrive(c, () => go(() => editorScreen(index, getProfile().slots[index]))));
        },
      },
    ],
  });
  cleanup.push(() => ed.destroy());
  cleanup.push(onProfileChange(() => ed.refresh()));
}

function testDrive(creature, back) {
  document.body.classList.add('in-battle');
  const battle = new Battle({ container: screen, mode: 'testdrive', playerCreature: creature, onExit: back });
  current = { battle };
  cleanup.push(() => battle.destroy());
  const exit = h('button', { class: 'btn exit-td', onclick: back }, '← Exit Test Drive');
  document.body.append(h('div', { class: 'overlay passthrough' }, exit));
}

// ------------------------------------------------------------ progress / DNA lab

function progress() {
  const p = getProfile();
  const xp = xpProgress(p.xp);
  const sections = SLOTS.map((slot) => h('section', { class: 'collection' },
    h('h3', {}, slot.label),
    h('div', { class: 'collection-grid' }, ...PARTS.filter((x) => x.slot === slot.id).map((part) => {
      if (!isUnlocked(part.id)) {
        return h('div', { class: 'part-card sealed' }, h('div', { class: 'pod' }), h('div', { class: 'part-name' }, 'Sealed pod'), h('div', { class: 'part-meta' }, `Unlocks at Lv ${part.level}`));
      }
      const owned = isOwned(part.id);
      return h('div', { class: `part-card tier-${part.tier} ${owned ? 'owned' : 'unowned'}` },
        h('div', { class: 'part-name' }, part.name),
        h('div', { class: 'part-meta' }, `${TIERS[part.tier].label} · wt ${part.weight}`),
        h('div', { class: 'part-stats' }, part.desc),
        owned ? h('div', { class: 'owned-tag' }, 'Owned')
          : h('button', {
            class: 'btn tiny primary',
            disabled: p.dna < partCost(part),
            onclick: () => {
              const r = buyPart(part.id);
              toast(r.ok ? `${part.name} bought` : r.reason, r.ok ? 'good' : 'bad');
              go(progress);
            },
          }, dnaIcon(), ` Buy ${partCost(part)}`));
    }))));
  screen.append(h('div', { class: 'page' },
    h('div', { class: 'page-head' }, h('h1', {}, 'Parts & Progress')),
    h('div', { class: 'progress-top' },
      h('div', { class: 'panel prog-card' },
        h('div', { class: 'big-num' }, `Level ${xp.level}`),
        h('div', { class: 'xp-track wide' }, h('span', { class: 'xp-fill', style: { width: `${(xp.into / xp.need) * 100}%` } })),
        h('p', { class: 'muted' }, `${xp.into} / ${xp.need} XP. XP comes from playing matches and unlocks new parts.`)),
      h('div', { class: 'panel prog-card' },
        h('div', { class: 'big-num' }, dnaIcon(), ` ${p.dna} DNA`),
        h('p', { class: 'muted' }, `DNA buys unlocked parts. Earned only by kills: ${DNA_REWARD.player} per player, ${DNA_REWARD.bot} per bot. Kill a creature wearing a part you haven't unlocked for a 50% chance it drops.`))),
    ...sections));
}

function howTo() {
  const rules = [
    ['Build', 'Every part changes how your creature moves and fights. Long legs are fast but easy to stagger. Heavy heads hit hard but are top-heavy. Stay under the weight budget.'],
    ['Customize', 'Open Customize in the editor to set hull, trim and glow colors, finish, pattern and proportions. Appearance never changes stats or hitboxes.'],
    ['Build phase', 'You get 2 minutes before each match to pick a saved creature, tweak it, or start from scratch. Hit Ready to lock in early. Enemy silhouettes appear in the final 15 seconds.'],
    ['Lanes & nests', 'Each team has 2 nests in each of the 3 lanes plus a much tougher main nest. Nests shoot intruders. Lose every nest and you lose.'],
    ['Tiebreakers', 'If both main nests fall, the team that destroyed more nests wins. If that\'s tied, fewer total deaths wins.'],
    ['Permadeath', 'At zero health you are downed for 12 seconds. A teammate standing next to you can revive you. If nobody does, your match is over: spectate or start a new game.'],
    ['DNA & XP', 'XP levels you up and unlocks parts. DNA buys them. DNA only comes from kills, never from Test Drive, wild critters, nests, or winning.'],
    ['Wild space', 'Scavengers drop health or temporary boosts. Vents launch anything standing on them. Bringing down the Titan gives your team a 90-second buff.'],
    ['Rift Rally', 'A combat race mode on the main menu. WASD moves relative to the camera, F shoots, E uses items, Q slams, Space jumps, Shift drifts for boosts, right-drag looks around. Knocked-out racers launch into the sky and respawn. Races give XP; DNA still comes only from battle kills.'],
    ['Mutations', 'Defeat an enemy to absorb one of its traits (like Venom from a stinger) for the rest of the match.'],
    ['Weapons', 'Every creature has a gun on F (or left click). Equip one in the Weapon slot: Pulse Blaster, Scatter Cannon, Plasma Mortar, Needle Swarm, Rail Lance or Arc Caster. Shots lock onto the enemy nearest your aim (red brackets) and curve toward it. No weapon equipped means a weak Sidearm.'],
    ['Controls', 'Third-person: WASD moves relative to the camera, hold right-click and drag to look around, scroll zooms. F shoots (left click too), 1 / 2 / 3 use part attacks, E special, Space jumps, C dodges, Shift sprints. V switches to the tactical top-down camera. Esc pauses and opens settings, including captured-mouse look.'],
  ];
  screen.append(h('div', { class: 'page' },
    h('div', { class: 'page-head' }, h('h1', {}, 'How to play')),
    h('div', { class: 'rules' }, ...rules.map(([t, d]) => h('div', { class: 'panel rule' }, h('h3', {}, t), h('p', {}, d))))));
}

// ------------------------------------------------------------ build phase

function buildPhase(teamSize) {
  const p = getProfile();
  const names = new Set();
  const allies = makeBotRoster(teamSize - 1, PARTS, names);
  const enemies = makeBotRoster(teamSize, PARTS, names);
  const savedValid = p.slots.map((c) => c && validate(c, p.owned).ok);
  const firstValid = p.slots.find((c, i) => savedValid[i]);
  let working = structuredClone(firstValid || starterCreature());
  let lastValid = validate(working, p.owned).ok ? structuredClone(working) : null;
  let left = BUILD_PHASE_SECONDS;
  let done = false;

  const timerEl = h('div', { class: 'build-timer' });
  const readyBtn = h('button', { class: 'btn primary big ready' }, 'Ready');
  const status = h('div', { class: 'ready-status muted' });
  const editorWrap = h('div', { class: 'build-editor' });
  const enemyList = h('div', { class: 'roster enemy' });

  const slotList = h('div', { class: 'pick-list' },
    ...p.slots.map((c, i) => c && h('button', {
      class: `pick ${savedValid[i] ? '' : 'flagged'}`,
      disabled: !savedValid[i],
      title: savedValid[i] ? `Use ${c.name}` : validate(c, p.owned).problems.join(', '),
      onclick: () => mountWith(c),
    }, h('img', { src: creatureThumb(c, { size: 128 }), alt: '' }), h('span', {}, c.name), !savedValid[i] && h('small', {}, '⚠ fix in Workshop'))),
    h('button', { class: 'pick', onclick: () => mountWith(starterCreature()) }, h('div', { class: 'pick-plus' }, '+'), h('span', {}, 'From scratch')));

  let ed;
  function mountWith(c) {
    ed?.destroy();
    working = structuredClone(c);
    track(working);
    ed = mountEditor(editorWrap, { creature: working, compact: true, actions: [], onChange: track });
  }
  function track(c) {
    working = c;
    const v = validate(c, getProfile().owned);
    if (v.ok) lastValid = structuredClone(c);
    readyBtn.disabled = !v.ok;
    status.textContent = v.ok ? 'Teammates are ready. Hit Ready to start now.' : `Can't ready up: ${v.problems[0]}`;
  }

  const teamList = h('div', { class: 'roster' }, ...allies.map((c) => h('div', { class: 'roster-row' },
    h('img', { src: creatureThumb(c, { size: 128 }), alt: '' }),
    h('div', {}, h('b', {}, c.name), h('small', {}, `${roleTag(c)} · bot`)), h('span', { class: 'ok' }, 'READY'))));

  function renderEnemies() {
    const reveal = left <= SILHOUETTE_REVEAL_SECONDS;
    enemyList.replaceChildren(...enemies.map((c) => h('div', { class: 'roster-row' },
      reveal ? h('img', { src: creatureThumb(c, { silhouette: true, size: 128 }), alt: 'enemy silhouette' }) : h('div', { class: 'unknown' }, '?'),
      h('div', {}, h('b', {}, reveal ? 'Silhouette' : 'Unknown'), h('small', {}, reveal ? 'Revealed' : `Revealed at ${fmtTime(SILHOUETTE_REVEAL_SECONDS)}`)))));
  }

  readyBtn.onclick = () => start();
  function start() {
    if (done) return;
    done = true;
    const pick = validate(working, getProfile().owned).ok ? working : lastValid || starterCreature();
    go(() => match(pick, allies, enemies, teamSize));
  }

  screen.append(h('div', { class: 'page wide build' },
    h('div', { class: 'build-head' },
      h('div', {}, h('div', { class: 'title-kicker' }, `BUILD PHASE · ${teamSize}v${teamSize} vs bots`), h('h1', {}, 'Prepare your specimen')),
      timerEl,
      h('div', { class: 'ready-box' }, readyBtn, status)),
    h('div', { class: 'build-grid' },
      h('aside', { class: 'panel' }, h('h3', { class: 'panel-title' }, 'Your creatures'), slotList),
      editorWrap,
      h('aside', { class: 'panel' }, h('h3', { class: 'panel-title' }, 'Teammates'), teamList, h('h3', { class: 'panel-title' }, 'Enemies'), enemyList))));

  mountWith(working);
  renderEnemies();
  timerEl.textContent = fmtTime(left);
  const tick = setInterval(() => {
    left -= 1;
    timerEl.textContent = fmtTime(left);
    timerEl.classList.toggle('urgent', left <= SILHOUETTE_REVEAL_SECONDS);
    if (left === SILHOUETTE_REVEAL_SECONDS) renderEnemies();
    if (left <= 0) {
      toast('Time! Locking in your last valid build.');
      start();
    }
  }, 1000);
  cleanup.push(() => clearInterval(tick), () => ed?.destroy());
}

// ------------------------------------------------------------ match

function match(creature, allies, enemies, teamSize) {
  document.body.classList.add('in-battle');
  let committed = null;
  const commit = (summary) => {
    if (committed) return committed;
    const lvl = addXP(summary.xp);
    recordMatch({ won: summary.won, kills: summary.kills, died: !summary.survived });
    committed = { summary, lvl };
    return committed;
  };
  const battle = new Battle({
    container: screen, mode: 'match', playerCreature: creature, allies, enemies,
    onPlayerDeath: (info) => deathScreen(info, battle, creature),
    onEnd: (summary) => results(commit(summary), teamSize, creature),
    onExit: (kind) => {
      commit(battle.rewardSummary(false));
      if (kind === 'newgame') go(() => buildPhase(teamSize));
      else go(menu);
    },
  });
  current = { battle };
  cleanup.push(() => battle.destroy());
}

function deathScreen({ caption, killer, stats, rewards }, battle, creature) {
  document.querySelectorAll('.overlay').forEach((o) => o.remove());
  const ov = h('div', { class: 'overlay death' },
    h('div', { class: 'panel death-card' },
      h('div', { class: 'title-kicker' }, 'SIGNAL LOST'),
      h('h1', { class: 'death-title' }, 'ELIMINATED'),
      h('div', { class: 'death-scene' },
        h('img', { class: 'ragdoll', src: creatureThumb(creature), alt: 'your creature' }),
        killer && h('div', { class: 'killer' }, h('img', { class: 'emote', src: creatureThumb(killer.data), alt: '' }), h('small', {}, `Eliminated by ${killer.name}`))),
      h('p', { class: 'caption' }, caption),
      h('div', { class: 'death-stats' },
        ...[['Kills', stats.kills], ['Nests', stats.nests], ['Revives', stats.revives], ['DNA kept', rewards.dna], ['XP so far', rewards.xp]]
          .map(([k, v]) => h('div', {}, h('b', {}, v), h('span', {}, k)))),
      h('div', { class: 'death-actions' },
        h('button', {
          class: 'btn',
          onclick: () => {
            ov.remove();
            battle.spectate();
          },
        }, 'Spectate team'),
        h('button', { class: 'btn primary', onclick: () => battle.onExit('newgame') }, 'New game'),
        h('button', { class: 'btn', onclick: () => battle.onExit('menu') }, 'Main menu'))));
  document.body.append(ov);
}

function results({ summary: s, lvl }, teamSize) {
  document.querySelectorAll('.overlay').forEach((o) => o.remove());
  const title = s.won ? 'VICTORY' : s.draw ? 'DRAW' : 'DEFEAT';
  const ov = h('div', { class: `overlay results ${s.won ? 'win' : ''}` },
    h('div', { class: 'panel results-card' },
      h('div', { class: 'title-kicker' }, `${s.biome} · ${teamSize}v${teamSize}`),
      h('h1', { class: 'result-title' }, title),
      h('p', { class: 'muted' }, s.reason),
      h('div', { class: 'earnings' },
        h('div', { class: 'earn' }, h('b', {}, `+${s.xp}`), h('span', {}, 'XP')),
        h('div', { class: 'earn' }, h('b', {}, dnaIcon(), ` +${s.dna}`), h('span', {}, 'DNA from kills')),
        h('div', { class: 'earn' }, h('b', {}, s.kills), h('span', {}, 'Kills')),
        h('div', { class: 'earn' }, h('b', {}, s.nests), h('span', {}, 'Nests'))),
      lvl.after > lvl.before && h('div', { class: 'levelup' },
        h('b', {}, `LEVEL UP! Lv ${lvl.after}`),
        lvl.newly.length ? h('span', {}, ` · ${lvl.newly.length} new part${lvl.newly.length > 1 ? 's' : ''} unlocked: ${lvl.newly.map(partName).join(', ')}`) : null),
      s.drops.length > 0 && h('div', { class: 'drops' }, h('b', {}, 'Parts dropped: '), s.drops.map(partName).join(', ')),
      h('table', { class: 'roster-table' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Creature'), h('th', {}, 'Team'), h('th', {}, 'Kills'), h('th', {}, 'Nests'), h('th', {}, 'Status'))),
        h('tbody', {}, ...s.roster.map((r) => h('tr', { class: `${r.team} ${r.isPlayer ? 'me' : ''}` },
          h('td', {}, r.name, r.isPlayer ? ' (you)' : ''), h('td', {}, r.team), h('td', {}, r.kills), h('td', {}, r.nests), h('td', {}, r.alive ? 'Survived' : 'Extinct'))))),
      h('div', { class: 'death-actions' },
        h('button', { class: 'btn primary', onclick: () => go(() => buildPhase(teamSize)) }, 'Play again'),
        h('button', { class: 'btn', onclick: () => go(workshop) }, 'Workshop'),
        h('button', { class: 'btn', onclick: () => go(menu) }, 'Main menu'))));
  document.body.append(ov);
}

// ------------------------------------------------------------ Rift Rally

const raceOpts = { biome: 'random', laps: 3, racers: 8 };

function raceSetup() {
  const p = getProfile();
  const choices = [...p.slots.filter((c) => c && validate(c, p.owned).ok), starterCreature()];
  let chosen = choices[0];
  const names = new Set(choices.map((c) => c.name));
  let rivals = makeBotRoster(raceOpts.racers - 1, PARTS, names);

  const pickList = h('div', { class: 'pick-list' });
  const rivalList = h('div', { class: 'roster enemy' });
  const opts = h('div', { class: 'rr-opts' });
  const renderPicks = () => pickList.replaceChildren(...choices.map((c) => h('button', {
    class: `pick ${c === chosen ? 'chosen' : ''}`,
    onclick: () => {
      chosen = c;
      renderPicks();
    },
  }, h('img', { src: creatureThumb(c, { size: 128 }), alt: '' }), h('span', {}, c.name), h('small', { class: 'muted' }, ((st) => `${st.weapon.name} · spd ${st.speed.toFixed(1)}`)(computeStats(c))))));
  const renderRivals = () => rivalList.replaceChildren(...rivals.map((c) => h('div', { class: 'roster-row' },
    h('img', { src: creatureThumb(c, { size: 128 }), alt: '' }),
    h('div', {}, h('b', {}, c.name), h('small', {}, `${computeStats(c).weapon.name} · bot`)))));
  const seg = (key, options, after) => h('div', { class: 'seg-row' }, ...options.map(([val, label]) => h('button', {
    class: `seg ${raceOpts[key] === val ? 'active' : ''}`,
    onclick: () => {
      raceOpts[key] = val;
      after?.();
      renderOpts();
    },
  }, label)));
  const camSeg = () => h('div', { class: 'seg-row' }, ...[['track', 'Follow track'], ['mouse', 'Mouse steer']].map(([id, label]) => h('button', {
    class: `seg ${getSettings().raceCamera === id ? 'active' : ''}`,
    onclick: () => {
      setSetting('raceCamera', id);
      renderOpts();
    },
  }, label)));
  const renderOpts = () => opts.replaceChildren(
    h('label', {}, 'Camera'), camSeg(),
    h('small', { class: 'muted' }, getSettings().raceCamera === 'mouse'
      ? 'Click to grab the mouse, then look where you want to go and hold W. A/D angle you sideways.'
      : 'The view turns with the road. Hold W to ride the curves; A/D angle you across the track. No mouse needed.'),
    h('label', {}, 'Circuit'), seg('biome', [['random', 'Random'], ...BIOMES.map((b) => [b.id, b.name])]),
    h('label', {}, 'Laps'), seg('laps', [[2, '2'], [3, '3'], [5, '5']]),
    h('label', {}, 'Racers'), seg('racers', [[6, '6'], [8, '8']], () => {
      rivals = makeBotRoster(raceOpts.racers - 1, PARTS, new Set(choices.map((c) => c.name)));
      renderRivals();
    }),
  );
  screen.append(h('div', { class: 'page rr-setup' },
    h('div', { class: 'page-head' },
      h('div', {}, h('div', { class: 'title-kicker' }, 'COMBAT RACING'), h('h1', {}, 'Rift Rally')),
      h('button', { class: 'btn primary big', style: { marginLeft: 'auto' }, onclick: () => go(() => raceScreen(chosen, rivals)) }, 'Start race')),
    h('div', { class: 'rr-setup-grid' },
      h('aside', { class: 'panel' }, h('h3', { class: 'panel-title' }, 'Your racer'), pickList,
        h('p', { class: 'muted small' }, 'Speed, weight and stability from your parts matter here. Heavy builds win slams, light ones accelerate.')),
      h('section', { class: 'panel rr-how' },
        h('h3', { class: 'panel-title' }, 'Race settings'), opts,
        h('h3', { class: 'panel-title' }, 'How it works'),
        h('ul', { class: 'rr-tips' },
          h('li', {}, h('b', {}, 'Move: '), 'hold W to run where the camera points; A / D angle you sideways, S brakes and reverses, Space jumps. With Follow track the camera turns with the road for you; with Mouse steer you look where you want to go. V switches between them mid-race.'),
          h('li', {}, h('b', {}, 'Drift: '), 'hold Shift while turning. Sparks go blue, orange, then pink. Let go for a boost.'),
          h('li', {}, h('b', {}, 'Fight: '), 'F shoots your creature\'s weapon; shots lock onto the nearest rival ahead and curve into them (left click works too). Q lunges into the closest rival. With Overdrive or a Phase Shield active, just run into people.'),
          h('li', {}, h('b', {}, 'Items: '), 'drive through glowing pods to fill your two item slots. Press E to use the highlighted one right away, or save it; R (or the scroll wheel) swaps which one is selected. Watch out for orange-tinted decoy pods.'),
          h('li', {}, h('b', {}, 'Track: '), 'orange chevrons boost you, ramps launch you, vents erupt and the red sweeper arm swats racers.'),
          h('li', {}, h('b', {}, 'Knockouts: '), 'empty a rival\'s health and they rocket into the sky, then respawn a little behind. Same goes for you.')),
        h('h3', { class: 'panel-title' }, 'Items'),
        h('div', { class: 'rr-items' }, ...Object.values(RACE_ITEMS).map((it) => h('div', { class: 'rr-itemrow' },
          h('span', { class: 'rr-key', style: { color: `#${it.color.toString(16).padStart(6, '0')}` } }, it.key), h('b', {}, it.name), h('span', { class: 'muted' }, it.desc))))),
      h('aside', { class: 'panel' }, h('h3', { class: 'panel-title' }, 'Rivals'), rivalList))));
  renderPicks();
  renderRivals();
  renderOpts();
}

function raceScreen(creature, rivals) {
  document.body.classList.add('in-battle');
  const race = new Race({
    container: screen, playerCreature: structuredClone(creature), rivals: rivals.map((c) => structuredClone(c)),
    laps: raceOpts.laps, biome: raceOpts.biome === 'random' ? null : raceOpts.biome,
    onFinish: (summary) => raceResults(summary, creature, rivals),
    onExit: (kind) => (kind === 'restart' ? go(() => raceScreen(creature, rivals)) : go(menu)),
  });
  current = { race };
  cleanup.push(() => race.destroy());
}

function raceResults(s, creature, rivals) {
  const lvl = addXP(s.xp);
  recordRace({ place: s.place });
  document.querySelectorAll('.overlay').forEach((o) => o.remove());
  const win = s.place === 1;
  const ov = h('div', { class: `overlay results ${win ? 'win' : ''}` },
    h('div', { class: 'panel results-card' },
      h('div', { class: 'title-kicker' }, `RIFT RALLY · ${s.biome} · ${s.laps} LAPS`),
      h('h1', { class: 'result-title' }, `${ordinal(s.place).toUpperCase()} PLACE`),
      h('p', { class: 'muted' }, win ? 'Checkered flag. Nobody caught you.' : s.place <= 3 ? 'On the podium.' : 'Off the podium this time.'),
      h('div', { class: 'earnings' },
        h('div', { class: 'earn' }, h('b', {}, `+${s.xp}`), h('span', {}, 'XP')),
        h('div', { class: 'earn' }, h('b', {}, fmtRaceTime(s.time)), h('span', {}, 'Time')),
        h('div', { class: 'earn' }, h('b', {}, fmtRaceTime(s.bestLap)), h('span', {}, 'Best lap')),
        h('div', { class: 'earn' }, h('b', {}, s.kos), h('span', {}, 'Knockouts'))),
      lvl.after > lvl.before && h('div', { class: 'levelup' },
        h('b', {}, `LEVEL UP! Lv ${lvl.after}`),
        lvl.newly.length ? h('span', {}, ` · unlocked: ${lvl.newly.map(partName).join(', ')}`) : null),
      h('table', { class: 'roster-table' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Pos'), h('th', {}, 'Racer'), h('th', {}, 'Time'), h('th', {}, 'Best lap'), h('th', {}, 'KOs'))),
        h('tbody', {}, ...s.standings.map((r) => h('tr', { class: r.isPlayer ? 'me blue' : '' },
          h('td', {}, r.place), h('td', {}, r.name, r.isPlayer ? ' (you)' : ''), h('td', {}, r.time == null ? 'DNF' : fmtRaceTime(r.time)), h('td', {}, fmtRaceTime(r.bestLap)), h('td', {}, r.kos))))),
      h('p', { class: 'muted small' }, 'Races give XP only. DNA still comes from battle kills.'),
      h('div', { class: 'death-actions' },
        h('button', { class: 'btn primary', onclick: () => go(() => raceScreen(creature, rivals)) }, 'Race again'),
        h('button', { class: 'btn', onclick: () => go(raceSetup) }, 'New race'),
        h('button', { class: 'btn', onclick: () => go(menu) }, 'Main menu'))));
  document.body.append(ov);
}

// ------------------------------------------------------------ boot

function starfield() {
  const cv = document.getElementById('stars');
  const g = cv.getContext('2d');
  let stars = [];
  const resize = () => {
    cv.width = innerWidth;
    cv.height = innerHeight;
    stars = Array.from({ length: Math.round((innerWidth * innerHeight) / 5000) }, () => ({ x: Math.random() * cv.width, y: Math.random() * cv.height, r: Math.random() * 1.4 + 0.2, s: Math.random() * 0.08 + 0.02, p: Math.random() * 6 }));
  };
  resize();
  addEventListener('resize', resize);
  const draw = (t) => {
    if (!document.body.classList.contains('in-battle')) {
      g.clearRect(0, 0, cv.width, cv.height);
      for (const s of stars) {
        s.y += s.s;
        if (s.y > cv.height) s.y = 0;
        g.globalAlpha = 0.25 + Math.sin(t / 900 + s.p) * 0.2;
        g.fillStyle = '#b8c8dc';
        g.beginPath();
        g.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        g.fill();
      }
    }
    requestAnimationFrame(draw);
  };
  requestAnimationFrame(draw);
}

installDevConsole();
starfield();
renderHeader();
go(menu);
app.hidden = false;
