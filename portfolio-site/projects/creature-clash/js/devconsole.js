// Developer console (Ctrl+Shift+C). Dev builds only; mirrors DevConsole.cs from the skill.
import { DEV_BUILD, dev, getProfile } from './profile.js';
import { h } from './ui.js';

export const devConsole = { isOpen: false, godMode: false, battle: null };

export function installDevConsole() {
  if (!DEV_BUILD) return; // compiled out of release builds

  const log = h('div', { class: 'dev-log' });
  const input = h('input', { class: 'dev-input', placeholder: 'type a command (help)', spellcheck: 'false', autocomplete: 'off' });
  const box = h('div', { class: 'dev-console', hidden: true, role: 'dialog', 'aria-label': 'Developer console' },
    h('div', { class: 'dev-head' }, h('b', {}, 'DEV CONSOLE'), h('span', {}, 'dev_ profile · Ctrl+Shift+C to close')),
    log, input);
  document.body.append(box);

  const print = (msg, cls = '') => {
    log.append(h('div', { class: cls }, msg));
    log.scrollTop = log.scrollHeight;
  };

  const commands = {
    help: () => Object.entries(HELP).forEach(([k, v]) => print(`${k.padEnd(16)} ${v}`)),
    adddna: (arg) => {
      const n = arg === undefined ? 10 : parseInt(arg, 10);
      if (!Number.isFinite(n)) return print('Usage: addDNA [amount]', 'err');
      dev.addDNA(n);
      print(`+${n} DNA (now ${getProfile().dna})`, 'ok');
    },
    resetdna: () => {
      dev.resetDNA();
      print('DNA reset to 0', 'ok');
    },
    unlockallparts: () => {
      dev.unlockAllParts();
      print('All parts unlocked (buy them with DNA)', 'ok');
    },
    spawnbot: () => {
      if (!devConsole.battle) return print('Only works in a battle or Test Drive', 'err');
      devConsole.battle.devSpawnBot();
      print('Spawned a test bot in front of the camera', 'ok');
    },
    godmode: () => {
      devConsole.godMode = !devConsole.godMode;
      print(`God mode ${devConsole.godMode ? 'ON' : 'OFF'}`, 'ok');
    },
    clear: () => log.replaceChildren(),
  };
  const HELP = {
    help: 'List all commands',
    'addDNA [n]': 'Add DNA (default +10)',
    resetDNA: 'Set DNA back to 0',
    unlockAllParts: 'Unlock every creature part',
    spawnBot: 'Spawn a test bot in front of the camera',
    godMode: 'Toggle invincibility',
    clear: 'Clear the log',
  };

  const history = [];
  let hi = 0;
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      const line = input.value.trim();
      input.value = '';
      if (!line) return;
      history.push(line);
      hi = history.length;
      print(`> ${line}`, 'cmd');
      const [cmd, ...args] = line.split(/\s+/);
      const fn = commands[cmd.toLowerCase()];
      if (fn) fn(...args);
      else print(`Unknown command "${cmd}". Type help.`, 'err');
    } else if (e.key === 'ArrowUp' && hi > 0) {
      input.value = history[--hi];
    } else if (e.key === 'ArrowDown' && hi < history.length) {
      input.value = history[++hi] || '';
    } else if (e.key === 'Escape') {
      toggle(false);
    }
  });

  function toggle(force) {
    devConsole.isOpen = force ?? !devConsole.isOpen;
    box.hidden = !devConsole.isOpen;
    if (devConsole.isOpen) {
      input.focus();
      if (!log.childElementCount) print('Developer console. Type help for commands.');
    } else input.blur();
  }

  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'c') {
      e.preventDefault();
      toggle();
    }
  }, true);
}
