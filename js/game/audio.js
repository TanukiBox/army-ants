// 効果音：すべてコードで作る（音の素材ファイルは使わない）。
// 指示書 6：ゲート通過・数の増加・射撃・繭が割れる・変異・相殺・ボス撃破・クリア・ゲームオーバー

let ctx = null;
let master = null;
let enabled = true;
let noiseBuf = null;
const last = {};   // 同じ音を鳴らしすぎないための時刻

export function initAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = enabled ? 0.55 : 0;
  const comp = ctx.createDynamicsCompressor();
  master.connect(comp);
  comp.connect(ctx.destination);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
}

export function setSoundEnabled(on) {
  enabled = on;
  if (master) master.gain.value = on ? 0.55 : 0;
}

function ok(name, gap) {
  if (!ctx || !enabled) return false;
  const now = ctx.currentTime;
  if (last[name] && now - last[name] < gap) return false;
  last[name] = now;
  return true;
}

function tone(freq, dur, { type = 'square', vol = 0.2, to = null, delay = 0, attack = 0.005 } = {}) {
  const t0 = ctx.currentTime + delay;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (to) o.frequency.exponentialRampToValueAtTime(Math.max(20, to), t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g);
  g.connect(master);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}

function noise(dur, { vol = 0.25, freq = 1200, q = 0.8, type = 'lowpass', to = null, delay = 0 } = {}) {
  const t0 = ctx.currentTime + delay;
  const s = ctx.createBufferSource();
  s.buffer = noiseBuf;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.setValueAtTime(freq, t0);
  if (to) f.frequency.exponentialRampToValueAtTime(Math.max(30, to), t0 + dur);
  f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  s.connect(f);
  f.connect(g);
  g.connect(master);
  s.start(t0, Math.random() * 0.5);
  s.stop(t0 + dur + 0.02);
}

export const sfx = {
  shoot() { if (ok('shoot', 0.09)) tone(1400 + Math.random() * 300, 0.035, { type: 'square', vol: 0.025, to: 900 }); },
  hit() { if (ok('hit', 0.05)) noise(0.05, { vol: 0.06, freq: 2500, type: 'bandpass', q: 2 }); },
  gateHit() { if (ok('gatehit', 0.06)) tone(700 + Math.random() * 120, 0.04, { type: 'triangle', vol: 0.05 }); },
  gateGood() {
    if (!ok('gate', 0.05)) return;
    [0, 4, 7, 12].forEach((s, i) => tone(523 * 2 ** (s / 12), 0.12, { type: 'square', vol: 0.09, delay: i * 0.04 }));
  },
  gateBad() {
    if (!ok('gate', 0.05)) return;
    tone(220, 0.25, { type: 'sawtooth', vol: 0.11, to: 110 });
    noise(0.18, { vol: 0.08, freq: 600 });
  },
  /** 数が増えた：匹数が多いほど高い音 */
  count(n) {
    if (!ok('count', 0.06)) return;
    const f = 330 * 2 ** Math.min(2.6, Math.log10(Math.max(1, n)) * 0.75);
    tone(f, 0.07, { type: 'triangle', vol: 0.08, to: f * 1.5 });
  },
  multiply() {
    if (!ok('mul', 0.1)) return;
    tone(392, 0.35, { type: 'square', vol: 0.08, to: 1568 });
    tone(784, 0.3, { type: 'triangle', vol: 0.06, to: 2093, delay: 0.05 });
  },
  cocoonHit() { if (ok('cochit', 0.07)) noise(0.04, { vol: 0.07, freq: 3200, type: 'highpass' }); },
  cocoonBreak() {
    if (!ok('cocoon', 0.1)) return;
    noise(0.3, { vol: 0.3, freq: 4000, to: 500, type: 'bandpass', q: 1.2 });
    [0, 7, 12, 19].forEach((s, i) => tone(660 * 2 ** (s / 12), 0.25, { type: 'sine', vol: 0.08, delay: 0.05 + i * 0.05 }));
  },
  mutate() {
    if (!ok('mutate', 0.2)) return;
    tone(220, 0.6, { type: 'sawtooth', vol: 0.06, to: 1760 });
    tone(330, 0.6, { type: 'square', vol: 0.04, to: 2640, delay: 0.08 });
    noise(0.5, { vol: 0.08, freq: 6000, type: 'highpass' });
  },
  cancel() { if (ok('cancel', 0.07)) noise(0.06, { vol: 0.09, freq: 1800 + Math.random() * 800, type: 'bandpass', q: 3 }); },
  hurt() { if (ok('hurt', 0.1)) { noise(0.15, { vol: 0.15, freq: 900 }); tone(160, 0.15, { type: 'square', vol: 0.06, to: 90 }); } },
  snap() { if (ok('snap', 0.08)) { noise(0.05, { vol: 0.18, freq: 5000, type: 'highpass' }); tone(1800, 0.05, { vol: 0.05, to: 600 }); } },
  venom() { if (ok('venom', 0.12)) tone(500, 0.1, { type: 'sine', vol: 0.05, to: 260 }); },
  sting() { if (ok('sting', 0.1)) { tone(2400, 0.12, { type: 'sawtooth', vol: 0.05, to: 600 }); } },
  explode(big = false) {
    if (!ok('boom', 0.06)) return;
    noise(big ? 0.9 : 0.45, { vol: big ? 0.5 : 0.32, freq: big ? 900 : 1400, to: 60 });
    tone(big ? 90 : 120, big ? 0.6 : 0.3, { type: 'sine', vol: 0.3, to: 35 });
  },
  enemyShot() { if (ok('eshot', 0.1)) noise(0.12, { vol: 0.08, freq: 2400, to: 700, type: 'bandpass', q: 2 }); },
  warn() { if (ok('warn', 0.3)) { tone(880, 0.12, { type: 'square', vol: 0.06 }); tone(880, 0.12, { type: 'square', vol: 0.06, delay: 0.18 }); } },
  swoosh() { if (ok('swoosh', 0.2)) noise(0.35, { vol: 0.2, freq: 300, to: 3000, type: 'bandpass', q: 1 }); },
  send() { if (ok('send', 0.07)) tone(900 + Math.random() * 200, 0.03, { type: 'triangle', vol: 0.025 }); },
  nestHit() { if (ok('nest', 0.05)) noise(0.06, { vol: 0.1, freq: 500 }); },
  bossDown() {
    if (!ok('bossdown', 0.5)) return;
    this.explode(true);
    [12, 7, 4, 0].forEach((s, i) => tone(392 * 2 ** (s / 12), 0.3, { type: 'square', vol: 0.08, delay: 0.3 + i * 0.12 }));
  },
  clear() {
    if (!ok('clear', 0.5)) return;
    [0, 4, 7, 12, 16, 19, 24].forEach((s, i) => tone(392 * 2 ** (s / 12), 0.18, { type: 'square', vol: 0.08, delay: i * 0.07 }));
  },
  gameOver() {
    if (!ok('over', 0.5)) return;
    [0, -3, -7, -12].forEach((s, i) => tone(330 * 2 ** (s / 12), 0.4, { type: 'sawtooth', vol: 0.08, delay: i * 0.22 }));
  },
  ui() { if (ok('ui', 0.04)) tone(1200, 0.04, { type: 'triangle', vol: 0.05 }); },
  /** シロアリが弾けた（高さを少しずつ変える） */
  pop() { if (ok('pop', 0.035)) noise(0.05, { vol: 0.08, freq: 1300 + Math.random() * 1800, type: 'bandpass', q: 4 }); },
  /** 卵が割れて仲間が生まれた */
  hatch() {
    if (!ok('hatch', 0.1)) return;
    [0, 5, 9, 12, 17].forEach((s, i) => tone(587 * 2 ** (s / 12), 0.1, { type: 'triangle', vol: 0.09, delay: i * 0.035 }));
    noise(0.12, { vol: 0.12, freq: 3500, type: 'highpass' });
  },
};
