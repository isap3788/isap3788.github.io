// Player progress: XP and levels (unlock parts) are separate from DNA (buys unlocked parts).
// Replaces the old PlayerProgress.cs placeholder from the skill.
import { PARTS, PART_BY_ID, XP_PER_LEVEL, MAX_LEVEL, SAVE_SLOTS, DNA_REWARD, partCost } from './data.js';

// Equivalent of UNITY_EDITOR || DEVELOPMENT_BUILD: dev tools only exist when served locally.
export const DEV_BUILD = false;

// Testing data lives in a separate dev_ profile so it never touches real progress.
const KEY = DEV_BUILD ? 'creatureclash.dev_profile' : 'creatureclash.profile';
const VERSION = 2;

const listeners = new Set();
export const onProfileChange = (fn) => (listeners.add(fn), () => listeners.delete(fn));

let profile = null;

function freshProfile() {
  const starters = PARTS.filter((p) => p.starter).map((p) => p.id);
  return {
    version: VERSION,
    xp: 0,
    dna: 0,
    unlocked: unlockedForLevel(1, starters),
    owned: starters,
    slots: Array(SAVE_SLOTS).fill(null),
    stats: { matches: 0, wins: 0, kills: 0, deaths: 0 },
  };
}

function unlockedForLevel(level, extra = []) {
  const ids = new Set(extra);
  for (const p of PARTS) if (p.level <= level) ids.add(p.id);
  return [...ids];
}

export function getProfile() {
  if (profile) return profile;
  try {
    const raw = JSON.parse(localStorage.getItem(KEY));
    profile = raw && raw.version === VERSION ? { ...freshProfile(), ...raw } : freshProfile();
  } catch {
    profile = freshProfile();
  }
  // Drop ids for parts that no longer exist after a balance update, and hand out starter parts added since
  profile.unlocked = profile.unlocked.filter((id) => PART_BY_ID[id]);
  profile.owned = profile.owned.filter((id) => PART_BY_ID[id]);
  for (const p of PARTS) {
    if (!p.starter) continue;
    if (!profile.unlocked.includes(p.id)) profile.unlocked.push(p.id);
    if (!profile.owned.includes(p.id)) profile.owned.push(p.id);
  }
  return profile;
}

export function saveProfile() {
  try {
    localStorage.setItem(KEY, JSON.stringify(profile));
  } catch {
    /* storage unavailable: progress lasts for this session only */
  }
  listeners.forEach((fn) => fn(profile));
}

export const levelFromXP = (xp) => Math.min(MAX_LEVEL, 1 + Math.floor(xp / XP_PER_LEVEL));
export function xpProgress(xp) {
  const level = levelFromXP(xp);
  if (level >= MAX_LEVEL) return { level, into: XP_PER_LEVEL, need: XP_PER_LEVEL };
  return { level, into: xp % XP_PER_LEVEL, need: XP_PER_LEVEL };
}

export const isUnlocked = (id) => getProfile().unlocked.includes(id);
export const isOwned = (id) => getProfile().owned.includes(id);

// Returns the parts newly unlocked by levelling up.
export function addXP(amount) {
  const p = getProfile();
  const before = levelFromXP(p.xp);
  p.xp += Math.max(0, Math.round(amount));
  const after = levelFromXP(p.xp);
  const newly = [];
  if (after > before) {
    const next = unlockedForLevel(after, p.unlocked);
    for (const id of next) if (!p.unlocked.includes(id)) newly.push(id);
    p.unlocked = next;
  }
  saveProfile();
  return { before, after, newly };
}

export function buyPart(id) {
  const p = getProfile();
  const part = PART_BY_ID[id];
  if (!part) return { ok: false, reason: 'Unknown part' };
  if (!p.unlocked.includes(id)) return { ok: false, reason: 'Locked' };
  if (p.owned.includes(id)) return { ok: false, reason: 'Already owned' };
  const cost = partCost(part);
  if (p.dna < cost) return { ok: false, reason: `Need ${cost - p.dna} more DNA` };
  p.dna -= cost;
  p.owned.push(id);
  saveProfile();
  return { ok: true };
}

// The only gameplay path that adds DNA: a confirmed kill of a player or bot.
// In a networked build this check belongs on the server.
export function grantKillDNA(kill) {
  if (!kill || kill.mode !== 'match' || !kill.killerIsLocalPlayer) return 0;
  const amount = kill.victimIsBot ? DNA_REWARD.bot : DNA_REWARD.player;
  const p = getProfile();
  p.dna += amount;
  saveProfile();
  return amount;
}

// Part drop from a kill: obtained outright, usable next battle.
export function obtainDrop(id) {
  const p = getProfile();
  if (!p.unlocked.includes(id)) p.unlocked.push(id);
  if (!p.owned.includes(id)) p.owned.push(id);
  saveProfile();
}

export function recordMatch({ won, kills, died }) {
  const s = getProfile().stats;
  s.matches += 1;
  if (won) s.wins += 1;
  s.kills += kills;
  if (died) s.deaths += 1;
  saveProfile();
}

export function recordRace({ place }) {
  const s = getProfile().stats;
  s.races = (s.races || 0) + 1;
  if (place === 1) s.raceWins = (s.raceWins || 0) + 1;
  saveProfile();
}

export function saveSlot(index, creature) {
  getProfile().slots[index] = creature ? structuredClone(creature) : null;
  saveProfile();
}

// ---- developer-only (callers must check DEV_BUILD) ----
export const dev = {
  addDNA(n) {
    getProfile().dna += n;
    saveProfile();
  },
  resetDNA() {
    getProfile().dna = 0;
    saveProfile();
  },
  unlockAllParts() {
    getProfile().unlocked = PARTS.map((x) => x.id);
    saveProfile();
  },
};
