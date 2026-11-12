// Static game data for Creature Clash: parts, tiers, rewards, biomes, captions.
// Values follow references/game-design.md from the creature-clash skill.

export const BUDGET = 70; // weight / complexity budget per creature
export const XP_PER_LEVEL = 150;
export const MAX_LEVEL = 10;
export const SAVE_SLOTS = 6;

// DNA is only earned by killing players or bots (never Test Drive, neutrals, nests, or winning).
export const DNA_REWARD = { player: 25, bot: 15 };
export const PART_DROP_CHANCE = 0.5;

export const XP_REWARD = { played: 50, win: 60, kill: 25, nest: 30, revive: 10 };

export const BUILD_PHASE_SECONDS = 120;
export const SILHOUETTE_REVEAL_SECONDS = 15;
export const BATTLE_SECONDS = 600;
export const DOWNED_SECONDS = 12;

export const TIERS = {
  basic: { label: 'Basic', cost: 50 },
  standard: { label: 'Standard', cost: 65 },
  advanced: { label: 'Advanced', cost: 80 },
  rare: { label: 'Rare', cost: 90 },
};

export const SLOTS = [
  { id: 'legs', label: 'Locomotion', required: true },
  { id: 'weapon', label: 'Weapon' },
  { id: 'mouth', label: 'Mouth' },
  { id: 'arms', label: 'Arms' },
  { id: 'head', label: 'Head' },
  { id: 'back', label: 'Back' },
  { id: 'tail', label: 'Tail' },
  { id: 'utility', label: 'Utility' },
  { id: 'eyes', label: 'Eyes' },
  { id: 'hat', label: 'Cosmetic' },
];

// dtype: bite | slash | blunt | venom | acid | zap. Armor beats claws (slash), venom beats armor.
const atk = (o) => ({ kind: 'melee', arc: 80, kb: 2, ...o });
// Weapons fire on left click. 'shot' = projectiles, 'lob' = arcing blast, 'beam' = instant piercing line, 'chain' = jumping lightning.
const gun = (o) => ({ kind: 'shot', speed: 38, range: 22, spread: 0, pellets: 1, homing: 4, kb: 1, dtype: 'energy', ...o });
export const SIDEARM = gun({ name: 'Sidearm', dmg: 3.5, cd: 0.38, speed: 34, range: 18, color: 0x9fb4c8, model: 'sidearm' });

export const PARTS = [
  // Locomotion (no wheels, no slime trails)
  { id: 'stubby_legs', name: 'Bulwark Legs', slot: 'legs', family: 'locomotion', tier: 'basic', level: 1, starter: true, weight: 10,
    stats: { speed: 5, stability: 3 }, legH: 0.45, desc: 'Four short armored legs. Hard to knock down, not built for speed.' },
  { id: 'stilt_legs', name: 'Stilt Struts', slot: 'legs', family: 'locomotion', tier: 'standard', level: 2, weight: 12,
    stats: { speed: 7.5, stability: -3 }, legH: 1.3, desc: 'Long digitigrade struts. Very fast, but easy to stagger.' },
  { id: 'frog_legs', name: 'Spring Haunches', slot: 'legs', family: 'locomotion', tier: 'standard', level: 3, weight: 12,
    stats: { speed: 6, stability: 1 }, legH: 0.7, special: 'pounce', desc: 'Coiled hind legs. Special: Leap Strike, a jump that lands with a shockwave.' },
  { id: 'flippy_fins', name: 'Skim Fins', slot: 'legs', family: 'locomotion', tier: 'basic', level: 4, weight: 8,
    stats: { speed: 5.6, stability: 2 }, legH: 0.35, desc: 'Low stabilizer fins. Light and surprisingly steady.' },
  { id: 'skitter_legs', name: 'Arachnid Legs', slot: 'legs', family: 'locomotion', tier: 'advanced', level: 6, weight: 14,
    stats: { speed: 6.8, stability: 4 }, legH: 0.8, desc: 'Six jointed legs. Fast and stable.' },

  // Weapons (left click)
  { id: 'pulse_blaster', name: 'Pulse Blaster', slot: 'weapon', family: 'offense', tier: 'basic', level: 1, starter: true, weight: 5,
    weapon: gun({ name: 'Pulse Blaster', dmg: 5, cd: 0.3, color: 0x38e1ff }), desc: 'Rapid energy bolts. Hold left click to keep firing.' },
  { id: 'scatter_cannon', name: 'Scatter Cannon', slot: 'weapon', family: 'offense', tier: 'basic', level: 2, weight: 7,
    weapon: gun({ name: 'Scatter Cannon', dmg: 4, pellets: 5, spread: 0.22, cd: 0.85, speed: 32, range: 12, kb: 2, homing: 2, color: 0xffb020 }), desc: 'A spread of heavy pellets. Brutal up close.' },
  { id: 'plasma_mortar', name: 'Plasma Mortar', slot: 'weapon', family: 'offense', tier: 'standard', level: 3, weight: 9,
    weapon: { kind: 'lob', name: 'Plasma Mortar', dmg: 18, radius: 3.2, cd: 1.5, range: 22, flight: 0.75, kb: 6, dtype: 'blast', color: 0xb46bff }, desc: 'Lobs a plasma shell that bursts where you aim. Hits groups.' },
  { id: 'needle_swarm', name: 'Needle Swarm', slot: 'weapon', family: 'offense', tier: 'standard', level: 4, weight: 6,
    weapon: gun({ name: 'Needle Swarm', dmg: 2.2, cd: 0.1, speed: 30, range: 16, homing: 10, spread: 0.1, color: 0x7dff2a }), desc: 'A stream of homing needles that find their target.' },
  { id: 'rail_lance', name: 'Rail Lance', slot: 'weapon', family: 'offense', tier: 'advanced', level: 5, weight: 10,
    weapon: { kind: 'beam', name: 'Rail Lance', dmg: 28, cd: 1.5, range: 40, kb: 5, dtype: 'energy', color: 0xf2f6ff }, desc: 'An instant beam that pierces everything in a line.' },
  { id: 'arc_caster', name: 'Arc Caster', slot: 'weapon', family: 'offense', tier: 'rare', level: 7, weight: 8,
    weapon: { kind: 'chain', name: 'Arc Caster', dmg: 10, cd: 0.6, range: 15, chains: 2, chainRange: 6.5, kb: 1, dtype: 'zap', color: 0x9fd8ff }, desc: 'Lightning that jumps to up to two more enemies.' },

  // Mouths (offense)
  { id: 'basic_jaw', name: 'Mandibles', slot: 'mouth', family: 'offense', tier: 'basic', level: 1, starter: true, weight: 6,
    attack: atk({ name: 'Bite', range: 2.0, dmg: 9, dtype: 'bite', cost: 12, cd: 0.6 }), desc: 'Paired cutting mandibles. Reliable close-range damage.' },
  { id: 'pecky_beak', name: 'Piercer Beak', slot: 'mouth', family: 'offense', tier: 'basic', level: 2, weight: 5,
    attack: atk({ name: 'Pierce', range: 2.2, dmg: 6, dtype: 'bite', cost: 8, cd: 0.35, kb: 1 }), desc: 'A narrow armored beak. Fast, precise strikes.' },
  { id: 'spit_gland', name: 'Acid Projector', slot: 'mouth', family: 'offense', tier: 'advanced', level: 4, weight: 10,
    attack: { name: 'Acid Bolt', kind: 'ranged', range: 14, dmg: 8, dtype: 'acid', cost: 14, cd: 0.7, speed: 18 }, desc: 'Fires pressurized acid bolts. Fights from range.' },
  { id: 'mega_chompers', name: 'Crusher Jaws', slot: 'mouth', family: 'offense', tier: 'advanced', level: 5, weight: 14,
    stats: { stability: -2 }, attack: atk({ name: 'Crush', range: 2.3, dmg: 16, dtype: 'bite', cost: 22, cd: 1.0, kb: 4 }), desc: 'Hydraulic jaws with huge bite force. Front-heavy.' },

  // Arms
  { id: 'small_claws', name: 'Talons', slot: 'arms', family: 'offense', tier: 'basic', level: 1, starter: true, weight: 6,
    attack: atk({ name: 'Slash', range: 1.9, dmg: 7, dtype: 'slash', cost: 9, cd: 0.45, kb: 1 }), desc: 'Quick forelimb slashes.' },
  { id: 'noodle_arms', name: 'Tendrils', slot: 'arms', family: 'offense', tier: 'basic', level: 2, weight: 5,
    attack: atk({ name: 'Lash', range: 2.8, dmg: 5, dtype: 'blunt', cost: 10, cd: 0.5, kb: 7 }), desc: 'Long whipping tendrils with heavy knockback.' },
  { id: 'crab_pincers', name: 'Hydraulic Pincers', slot: 'arms', family: 'offense', tier: 'standard', level: 3, weight: 10,
    attack: atk({ name: 'Clamp', range: 2.1, dmg: 11, dtype: 'slash', cost: 14, cd: 0.7 }), desc: 'Heavy pincers. Armor still blunts them.' },
  { id: 'zappy_feelers', name: 'Arc Antennae', slot: 'arms', family: 'offense', tier: 'rare', level: 8, weight: 9,
    attack: { name: 'Arc Discharge', kind: 'aoe', range: 3.2, dmg: 9, dtype: 'zap', cost: 20, cd: 1.2, kb: 3 }, desc: 'Discharges an electric arc that hits everything nearby.' },

  // Head
  { id: 'spiky_crest', name: 'Blade Crest', slot: 'head', family: 'offense', tier: 'basic', level: 2, weight: 5,
    attack: atk({ name: 'Crest Ram', range: 1.9, dmg: 8, dtype: 'blunt', cost: 12, cd: 0.7, kb: 5 }), desc: 'A bladed head crest for ramming strikes.' },
  { id: 'horns', name: 'Ram Horns', slot: 'head', family: 'offense', tier: 'standard', level: 2, weight: 8,
    special: 'charge', desc: 'Special: Ram. Charge forward and throw enemies aside.' },
  { id: 'satellite_ears', name: 'Sensor Dishes', slot: 'head', family: 'utility', tier: 'basic', level: 3, weight: 4,
    stats: { vision: 6 }, desc: 'Acoustic sensors. Wider minimap detection.' },
  { id: 'bonk_dome', name: 'Battering Dome', slot: 'head', family: 'offense', tier: 'advanced', level: 5, weight: 12,
    stats: { stability: -2, hp: 10 }, attack: atk({ name: 'Skull Bash', range: 2.0, dmg: 13, dtype: 'blunt', cost: 18, cd: 0.9, kb: 8 }), desc: 'Reinforced skull plate that hits hard. Top-heavy.' },

  // Back
  { id: 'squishy_padding', name: 'Gel Padding', slot: 'back', family: 'defense', tier: 'basic', level: 2, weight: 6,
    stats: { hp: 20, kbResist: 0.3 }, desc: 'Impact gel. More health, less knockback.' },
  { id: 'back_spikes', name: 'Dorsal Spines', slot: 'back', family: 'defense', tier: 'standard', level: 3, weight: 8,
    stats: { thorns: 4 }, desc: 'Melee attackers take damage back.' },
  { id: 'armor_plates', name: 'Armor Plating', slot: 'back', family: 'defense', tier: 'standard', level: 4, weight: 12,
    stats: { armor: 0.25, speed: -0.3 }, desc: 'Layered plates. Strong against slashes, useless against venom.' },
  { id: 'turtle_shell', name: 'Carapace', slot: 'back', family: 'defense', tier: 'advanced', level: 5, weight: 16,
    stats: { armor: 0.35, hp: 25, speed: -0.8 }, special: 'hide', desc: 'Heavy shell. Special: Lockdown, near-immune for a moment.' },
  { id: 'wings', name: 'Membrane Wings', slot: 'back', family: 'locomotion', tier: 'rare', level: 6, weight: 10,
    stats: { speed: 0.8 }, special: 'glide', desc: 'Special: Glide. A long airborne dash.' },

  // Tail
  { id: 'fluffy_tail', name: 'Counterweight Tail', slot: 'tail', family: 'defense', tier: 'basic', level: 2, weight: 4,
    stats: { stability: 2 }, desc: 'A weighted tail that keeps you balanced.' },
  { id: 'whip_tail', name: 'Whip Tail', slot: 'tail', family: 'offense', tier: 'standard', level: 3, weight: 7,
    attack: atk({ name: 'Whip', range: 3.4, arc: 130, dmg: 7, dtype: 'slash', cost: 12, cd: 0.6, kb: 3 }), desc: 'Long reach, wide arc.' },
  { id: 'tail_club', name: 'Mace Tail', slot: 'tail', family: 'offense', tier: 'advanced', level: 4, weight: 12,
    stats: { stability: 1 }, special: 'spin', desc: 'Special: Tail Sweep. Hits everything around you.' },
  { id: 'stinger', name: 'Venom Stinger', slot: 'tail', family: 'offense', tier: 'rare', level: 7, weight: 8,
    attack: atk({ name: 'Sting', range: 2.6, dmg: 6, dtype: 'venom', cost: 14, cd: 0.8, poison: 3 }), desc: 'Venom ignores armor and keeps hurting.' },

  // Glands / utility
  { id: 'sniffer_nose', name: 'Scent Receptor', slot: 'utility', family: 'utility', tier: 'basic', level: 2, weight: 3,
    stats: { vision: 5 }, desc: 'Chemical sensors. Detect enemies further away.' },
  { id: 'puff_sac', name: 'Pressure Sac', slot: 'utility', family: 'utility', tier: 'standard', level: 4, weight: 6,
    special: 'puff', desc: 'Special: Repulse. Deflect attacks and blast enemies back.' },
  { id: 'ink_sac', name: 'Smoke Gland', slot: 'utility', family: 'utility', tier: 'standard', level: 5, weight: 6,
    special: 'ink', desc: 'Special: Smoke Screen. Slows and blinds enemies inside.' },
  { id: 'healing_gland', name: 'Regen Gland', slot: 'utility', family: 'utility', tier: 'rare', level: 6, weight: 7,
    special: 'heal', desc: 'Special: Regen Pulse for you and nearby teammates.' },
  { id: 'shield_bubble', name: 'Shield Emitter', slot: 'utility', family: 'utility', tier: 'advanced', level: 7, weight: 8,
    special: 'shield', desc: 'Special: Shield Dome for you and nearby teammates.' },

  // Eyes
  { id: 'googly_eyes', name: 'Dual Optics', slot: 'eyes', family: 'cosmetic', tier: 'basic', level: 1, starter: true, weight: 0,
    desc: 'Standard twin optical sensors.' },
  { id: 'wide_eyes', name: 'Wide Visor', slot: 'eyes', family: 'utility', tier: 'basic', level: 2, weight: 2,
    stats: { vision: 4 }, desc: 'Panoramic visor. See a bit further.' },
  { id: 'stalk_eyes', name: 'Periscope Optics', slot: 'eyes', family: 'utility', tier: 'standard', level: 4, weight: 3,
    stats: { vision: 8 }, desc: 'Raised optics. See over everything.' },

  // Hats (cosmetic, no stats)
  { id: 'party_hat', name: 'Antenna Mast', slot: 'hat', family: 'cosmetic', tier: 'basic', level: 1, weight: 0, desc: 'Cosmetic. A signal mast with a beacon.' },
  { id: 'propeller_cap', name: 'Escort Drone', slot: 'hat', family: 'cosmetic', tier: 'basic', level: 3, weight: 0, desc: 'Cosmetic. A small drone that follows you.' },
  { id: 'top_hat', name: 'Command Fin', slot: 'hat', family: 'cosmetic', tier: 'standard', level: 5, weight: 0, desc: 'Cosmetic. A tall dorsal command fin.' },
  { id: 'tiny_crown', name: 'Halo Ring', slot: 'hat', family: 'cosmetic', tier: 'rare', level: 9, weight: 0, desc: 'Cosmetic. A floating energy ring.' },
];

export const PART_BY_ID = Object.fromEntries(PARTS.map((p) => [p.id, p]));
export const partCost = (p) => TIERS[p.tier].cost;

export const SPECIALS = {
  charge: { name: 'Ram', cd: 6, desc: 'Charge forward, throwing enemies aside.' },
  spin: { name: 'Tail Sweep', cd: 6, desc: 'Hit everything around you.' },
  glide: { name: 'Glide', cd: 7, desc: 'Long airborne dash.' },
  hide: { name: 'Lockdown', cd: 10, desc: 'Take 80% less damage for 2.5s. Can\'t move.' },
  heal: { name: 'Regen Pulse', cd: 12, desc: 'Heal you and nearby teammates.' },
  shield: { name: 'Shield Dome', cd: 12, desc: 'Absorb damage for you and nearby teammates.' },
  ink: { name: 'Smoke Screen', cd: 10, desc: 'Slow and blind enemies.' },
  puff: { name: 'Repulse', cd: 9, desc: 'Deflect attacks and blast enemies back.' },
  pounce: { name: 'Leap Strike', cd: 7, desc: 'Leap toward your aim and land with a shockwave.' },
};

// Traits absorbed on a kill (in-match mutations, reset each match)
export const MUTATIONS = {
  venom: { name: 'Venom', desc: 'Attacks poison' },
  hide: { name: 'Hardened', desc: '+10% armor' },
  thorns: { name: 'Barbs', desc: 'Damage attackers' },
  regen: { name: 'Regen', desc: 'Slowly heal' },
  zoom: { name: 'Overdrive', desc: '+10% speed' },
  brute: { name: 'Brute', desc: '+15% damage' },
  adrenaline: { name: 'Adrenaline', desc: '+10% damage' },
};
export const PART_MUTATION = {
  stinger: 'venom', turtle_shell: 'hide', armor_plates: 'hide', back_spikes: 'thorns',
  healing_gland: 'regen', wings: 'zoom', stilt_legs: 'zoom', mega_chompers: 'brute', bonk_dome: 'brute',
};

// sky: [zenith, horizon] for the background gradient
export const BIOMES = [
  { id: 'volcanic', name: 'Volcanic Rift', ground: 0x3a302c, lane: 0x4a4440, accent: 0xff5a1f, fog: 0x1c0d08, sky: ['#070304', '#3a1408'], hazard: 'Magma Vent' },
  { id: 'swamp', name: 'Toxic Marsh', ground: 0x2c3a2e, lane: 0x3c4640, accent: 0x7dff4a, fog: 0x0e1a12, sky: ['#030806', '#16301c'], hazard: 'Gas Vent' },
  { id: 'tundra', name: 'Cryo Shelf', ground: 0x8696a4, lane: 0x56626e, accent: 0x38d6ff, fog: 0x2a3a4a, sky: ['#0a1220', '#4a6680'], hazard: 'Cryo Vent' },
  { id: 'neon', name: 'Neon Sprawl', ground: 0x24212e, lane: 0x34303f, accent: 0xff3dd2, fog: 0x120c1c, sky: ['#05030a', '#2a0f3a'], hazard: 'Plasma Vent' },
];

export const DEATH_CAPTIONS = [
  'Specimen lost. Genome archived.',
  'Vital signs: none.',
  'Outmatched, outmaneuvered, out of the gene pool.',
  'This build has been retired from service.',
  'Natural selection has filed its report.',
  'Signal lost.',
  'The lane claims another.',
  'Combat data recorded for the next generation.',
];

export const BOT_NAMES = [
  'Vanta', 'Kestrel', 'Obsidian', 'Halcyon', 'Rook', 'Spectre', 'Nyx', 'Tarsus', 'Wraith', 'Cobalt',
  'Ion', 'Mantis', 'Talon', 'Vesper', 'Onyx', 'Helix', 'Riven', 'Echo', 'Strix', 'Corvid',
];

// ---- appearance (cosmetic only; never changes stats or hitboxes)
export const FINISHES = {
  matte: { label: 'Matte', roughness: 0.85, metalness: 0.05, clearcoat: 0 },
  satin: { label: 'Satin', roughness: 0.5, metalness: 0.3, clearcoat: 0.25 },
  gloss: { label: 'Gloss', roughness: 0.28, metalness: 0.1, clearcoat: 1 },
  chrome: { label: 'Chrome', roughness: 0.14, metalness: 1, clearcoat: 0.4 },
  carbon: { label: 'Carbon', roughness: 0.42, metalness: 0.35, clearcoat: 0.8 },
};
export const PATTERNS = { none: 'Solid', panels: 'Panels', hex: 'Hex', stripes: 'Stripes', camo: 'Camo', split: 'Two-tone' };
export const HULL_COLORS = ['#16181c', '#2a2f38', '#4a525e', '#8b939e', '#d9dee4', '#cfc6b4', '#b8a582', '#4b5638', '#1d2a44', '#2a4f8f', '#7a1f26', '#9a5a36', '#2f6b5a', '#3a2a4a'];
export const GLOW_COLORS = ['#38e1ff', '#4dff9a', '#7dff2a', '#ffb020', '#ff3b4e', '#ff4fd0', '#b46bff', '#f2f6ff'];
export const LOOK_PRESETS = [
  { name: 'Stealth', primary: '#16181c', secondary: '#2a2f38', glow: '#ff3b4e', finish: 'matte', pattern: 'panels' },
  { name: 'Arctic', primary: '#d9dee4', secondary: '#4a525e', glow: '#38e1ff', finish: 'satin', pattern: 'split' },
  { name: 'Hazard', primary: '#2a2f38', secondary: '#ffb020', glow: '#ffb020', finish: 'satin', pattern: 'stripes' },
  { name: 'Toxin', primary: '#4b5638', secondary: '#16181c', glow: '#7dff2a', finish: 'matte', pattern: 'camo' },
  { name: 'Royal', primary: '#1d2a44', secondary: '#cfc6b4', glow: '#b46bff', finish: 'gloss', pattern: 'hex' },
  { name: 'Chrome', primary: '#8b939e', secondary: '#16181c', glow: '#38e1ff', finish: 'chrome', pattern: 'panels' },
  { name: 'Ember', primary: '#7a1f26', secondary: '#16181c', glow: '#ffb020', finish: 'carbon', pattern: 'split' },
];
export const DEFAULT_LOOK = { primary: '#2a2f38', secondary: '#4a525e', glow: '#38e1ff', finish: 'satin', pattern: 'panels', glowStrength: 0.7, size: 1, length: 1, bulk: 1 };

// ---- Rift Rally (race mode). Racing gives XP only; DNA still comes only from battle kills.
export const RACE_XP = { finish: 40, perRivalBeaten: 12, win: 50, ko: 8 };
// weight(f): f is 0 for 1st place and 1 for last, so trailing racers roll stronger items
export const RACE_ITEMS = {
  volley: { name: 'Seeker Volley', key: 'VOL', color: 0x38e1ff, desc: 'Three homing bolts at the racer ahead', weight: () => 3 },
  mine: { name: 'Grav Mine', key: 'MINE', color: 0xff3b4e, desc: 'Dropped behind you. Launches whoever touches it', weight: (f) => 3 * (1 - f) + 0.5 },
  shockwave: { name: 'Shockwave', key: 'WAVE', color: 0xb46bff, desc: 'Blasts nearby racers away and spins them out', weight: () => 2 },
  overdrive: { name: 'Overdrive', key: 'BOOST', color: 0xffb020, desc: 'A long burst of speed', weight: (f) => 1 + 2 * f },
  shield: { name: 'Phase Shield', key: 'SHLD', color: 0x4dff9a, desc: 'Blocks one hit for 7 seconds', weight: (f) => 2 * (1 - f) + 0.5 },
  tether: { name: 'Tether Hook', key: 'HOOK', color: 0xf2f6ff, desc: 'Grapples the racer ahead, yanks you past and slams them', weight: (f) => 0.5 + 2.5 * f },
  riftjump: { name: 'Rift Jump', key: 'RIFT', color: 0xff4fd0, desc: 'Tears a portal and warps you down the track', weight: (f) => (f > 0.4 ? 3 * f : 0) },
  decoy: { name: 'Decoy Pod', key: 'TRAP', color: 0xff7a1a, desc: 'A fake item pod dropped behind you. It explodes on whoever grabs it', weight: (f) => 2 * (1 - f) + 0.5 },
  storm: { name: 'Ion Storm', key: 'STORM', color: 0x9fd8ff, desc: 'Lightning strikes every racer ahead of you', weight: (f) => (f > 0.6 ? 2 * f : 0) },
};
