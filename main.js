// Entry point: start screen (nickname, create/join room) and hand-off to the 3D game.
// The 3D engine is loaded with a dynamic import so a blocked CDN shows a clear message instead of a blank page.

import { Net } from './net.js';
import { Hud } from './hud.js';
import { Sfx } from './audio.js';
import { ROOM_CODE_LENGTH, NAME_MAX_LENGTH } from './constants.js';

const $ = (id) => document.getElementById(id);
const nameInput = $('nameInput');
const codeInput = $('codeInput');
const createBtn = $('createBtn');
const joinBtn = $('joinBtn');
const errorEl = $('startError');

const net = new Net();
const hud = new Hud();
const sfx = new Sfx();
let game = null;
let pending = [];        // messages that arrive while the game is still being set up
let busy = false;

const gameModule = import('./game.js').catch((err) => {
  console.error(err);
  return { loadError: err };
});

// ---------- Start screen ----------

const params = new URLSearchParams(location.search);
nameInput.value = localStorage.getItem('tinyheist:name') || '';
if (params.get('room')) codeInput.value = params.get('room').toUpperCase().slice(0, ROOM_CODE_LENGTH);
(nameInput.value ? (codeInput.value ? joinBtn : createBtn) : nameInput).focus();

codeInput.addEventListener('input', () => {
  codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, ROOM_CODE_LENGTH);
});
nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') (codeInput.value ? joinBtn : createBtn).click(); });
codeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') joinBtn.click(); });

function showError(text) { errorEl.textContent = text; }

function setBusy(b, label) {
  busy = b;
  createBtn.disabled = b;
  joinBtn.disabled = b;
  if (label) errorEl.textContent = label;
}

async function enter(kind) {
  if (busy) return;
  const name = nameInput.value.trim().slice(0, NAME_MAX_LENGTH);
  if (!name) { showError('Enter a nickname first.'); nameInput.focus(); return; }
  const code = codeInput.value.trim();
  if (kind === 'join' && code.length !== ROOM_CODE_LENGTH) { showError(`Room codes are ${ROOM_CODE_LENGTH} letters, like KQWZ.`); codeInput.focus(); return; }
  localStorage.setItem('tinyheist:name', name);
  sfx.unlock();
  setBusy(true, kind === 'create' ? 'Creating room…' : `Joining ${code}…`);

  const mod = await gameModule;
  if (mod.loadError) {
    setBusy(false);
    showError('The 3D engine could not load from cdn.jsdelivr.net. Check your internet connection, or ask whoever manages your network to allow that site.');
    return;
  }
  try {
    await net.connect();
  } catch {
    setBusy(false);
    showError("Can't reach the game server. Make sure it's running (npm start) and that you opened the address it printed.");
    return;
  }
  net.send(kind === 'create' ? { t: 'create', name } : { t: 'join', name, code });
}

createBtn.addEventListener('click', () => enter('create'));
joinBtn.addEventListener('click', () => enter('join'));

// ---------- Messages ----------

net.onMessage = async (m) => {
  if (game) { game.onMessage(m); return; }
  if (m.t === 'err') { setBusy(false); showError(m.msg); return; }
  if (m.t !== 'joined') { pending.push(m); return; }

  const mod = await gameModule;
  await document.fonts?.ready; // so canvas-drawn signs and name tags use the right fonts
  $('start').hidden = true;
  history.replaceState(null, '', `?room=${m.code}`);
  try {
    game = new mod.Game({ canvas: $('game'), net, hud, sfx, joined: m });
  } catch (err) {
    console.error(err);
    hud.showLost('Your browser could not start the 3D view (WebGL). Try updating Chrome or Edge, or enable hardware acceleration in browser settings.');
    return;
  }
  for (const msg of pending) game.onMessage(msg);
  pending = [];
};

net.onClose = () => {
  hud.showLost(game ? 'The connection to the game server was lost.' : 'The game server closed the connection.');
};

// ---------- Buttons inside the game ----------

$('restartBtn').addEventListener('click', () => game?.requestRestart());
$('lostBtn').addEventListener('click', () => { location.href = location.pathname + (game ? `?room=${game.code}` : ''); });
$('copyInvite').addEventListener('click', async () => {
  if (!game) return;
  const link = `${location.origin}${location.pathname}?room=${game.code}`;
  try {
    await navigator.clipboard.writeText(link);
    hud.toast('Invite link copied');
  } catch {
    hud.toast(`Share this link: ${link}`);
  }
});

// Handy for debugging in the browser console: window.tinyHeist.game
window.tinyHeist = { get game() { return game; } };
