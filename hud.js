// All DOM-side UI for the in-game HUD and overlays.

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export class Hud {
  constructor() {
    this.el = $('hud');
    this.lastLoot = -1;
    this.promptText = null;
    this.spottedShown = false;
  }

  show() { this.el.hidden = false; }

  setRoom(code) {
    $('hudRoom').textContent = code;
  }

  setPlayers(list) {
    $('hudCount').textContent = String(list.length);
    $('hudPlayers').innerHTML = list
      .map((p) => `<li><i style="background:${esc(p.color)}"></i>${esc(p.name)}${p.you ? ' (you)' : ''}</li>`)
      .join('');
  }

  setLoot(n, total, money) {
    $('hudMoney').textContent = `$${money.toLocaleString('en-US')}`;
    const el = $('hudLoot');
    el.textContent = `VALUABLES: ${n} / ${total}`;
    if (this.lastLoot !== -1 && n > this.lastLoot) {
      el.classList.remove('bump');
      void el.offsetWidth;
      el.classList.add('bump');
    }
    this.lastLoot = n;
  }

  setCarry(text) {
    const el = $('hudCarry');
    el.hidden = !text;
    if (text) el.textContent = text;
  }

  setPrompt(key, text) {
    const html = text ? `<kbd>${esc(key)}</kbd>${esc(text)}` : null;
    if (html === this.promptText) return;
    this.promptText = html;
    const el = $('hudPrompt');
    el.hidden = !html;
    if (html) el.innerHTML = html;
    document.querySelector('.crosshair').classList.toggle('active', !!html);
  }

  setSpotted(level) {
    const show = level > 0.02;
    if (show !== this.spottedShown) { $('hudSpotted').hidden = !show; this.spottedShown = show; }
    if (show) $('hudSpottedBar').style.width = `${Math.round(level * 100)}%`;
  }

  setAlarm(on) {
    clearTimeout(this.alarmTimer);
    $('alarmBanner').hidden = !on;
    // Flash the big banner, then leave the police countdown on screen.
    if (on) this.alarmTimer = setTimeout(() => { $('alarmBanner').hidden = true; }, 3000);
  }

  setPolice(seconds) {
    const el = $('hudPolice');
    el.hidden = seconds === null;
    if (seconds === null) return;
    const s = Math.max(0, Math.ceil(seconds));
    el.textContent = `POLICE IN ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    el.classList.toggle('urgent', s <= 10);
  }

  setStatus(text) {
    const el = $('hudStatus');
    el.hidden = !text;
    if (text && el.textContent !== text) el.textContent = text;
  }

  setLockHint(show) { $('lockHint').hidden = !show; }

  toast(text) {
    const box = $('hudToasts');
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = text;
    box.appendChild(t);
    setTimeout(() => t.remove(), 4100);
    while (box.children.length > 4) box.firstChild.remove();
  }

  /** info = { failed, time, alarms, money, rare, record } or null to hide. */
  showComplete(info) {
    if (!info) { $('completeOverlay').hidden = true; return; }
    const title = $('completeTitle');
    const money = `$${(info.money || 0).toLocaleString('en-US')}`;
    if (info.failed) {
      title.textContent = 'BUSTED';
      title.classList.add('failed');
      $('completeStats').textContent = `The police arrived before you got out. You had stashed ${money}.`;
      $('completeRecord').textContent = '';
    } else {
      title.textContent = 'HEIST COMPLETE';
      title.classList.remove('failed');
      const secs = Math.round(info.time / 1000);
      const time = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
      const alarms = info.alarms === 0 ? 'without a single alarm' : info.alarms === 1 ? 'with 1 alarm' : `with ${info.alarms} alarms`;
      const ring = info.rare ? ' You even found the diamond ring!' : ' Somewhere in the store a diamond ring was hidden...';
      $('completeStats').textContent = `Your crew stole ${money} in ${time}, ${alarms}.${ring}`;
      $('completeRecord').textContent = info.record || '';
    }
    $('completeOverlay').hidden = false;
  }

  showLost(text) {
    $('lostText').textContent = text;
    $('lostOverlay').hidden = false;
  }
}
