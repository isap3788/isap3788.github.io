// Player settings (camera, mouse, graphics), kept per browser.
const KEY = 'creatureclash.settings';
const DEFAULTS = { camera: 'third', sensitivity: 1, invertY: false, quality: 'high', mouseLook: false, raceCamera: 'track' };
let settings = { ...DEFAULTS };
try {
  settings = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
} catch {}

export const getSettings = () => settings;
export function setSetting(key, value) {
  settings = { ...settings, [key]: value };
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {}
  return settings;
}
