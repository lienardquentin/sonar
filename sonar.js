"use strict";
// Sonar in a web page. The speaker plays a steady tone above hearing (around 19 kHz); the microphone hears it back,
// straight from the speaker and bounced off everything in the room. An audio worklet mixes what it hears with the
// same tone (I/Q demodulation), leaving a slowly turning arrow: the still things add up to a fixed part, and
// anything that moves turns its own part by a full circle for every half wavelength (about 9 mm) it travels.
// That arrow, 500 times a second, is all the rest reads: fast turns are a hand, slow sways are a chest breathing.
const $ = (s) => document.querySelector(s);
const C = 343;  // the speed of sound, m/s
let ctx, osc, gain, analyser, F0 = 0, RATE = 500;  // readings a second: fast enough for a hand at 2 m/s

const WORKLET = `class IQ extends AudioWorkletProcessor {
  constructor() { super(); this.f = 0; this.ph = 0; this.n = 0; this.i = 0; this.q = 0; this.out = []; this.dec = Math.round(sampleRate / 500);
    this.port.onmessage = (e) => { this.f = e.data; }; }
  process(inputs) {
    const x = inputs[0] && inputs[0][0]; if (!x || !this.f) return true;
    const w = 2 * Math.PI * this.f / sampleRate;
    for (let k = 0; k < x.length; k++) {
      this.i += x[k] * Math.cos(this.ph); this.q -= x[k] * Math.sin(this.ph);
      this.ph += w; if (this.ph > 6.283185307179586) this.ph -= 6.283185307179586;
      if (++this.n === this.dec) { this.out.push(this.i / this.dec, this.q / this.dec); this.i = this.q = 0; this.n = 0; }
    }
    if (this.out.length >= 20) { this.port.postMessage(this.out); this.out = []; }
    return true;
  }
}
registerProcessor("iq", IQ);`;

// ---- starting: the microphone raw (no echo cancelling: the echo is the point), then the tone search ----
$("#go").addEventListener("click", start);
async function start() {
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 } }); }
  catch (e) { $("#status").textContent = "no microphone: allow it in the address bar"; return; }
  ctx = new AudioContext({ latencyHint: "interactive" });
  await ctx.resume();
  const mic = ctx.createMediaStreamSource(stream);
  analyser = ctx.createAnalyser(); analyser.fftSize = 8192; analyser.smoothingTimeConstant = 0; mic.connect(analyser);
  await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([WORKLET], { type: "text/javascript" })));
  const iq = new AudioWorkletNode(ctx, "iq"), mute = ctx.createGain(); mute.gain.value = 0;
  mic.connect(iq); iq.connect(mute).connect(ctx.destination);
  iq.port.onmessage = (e) => onIQ(e.data);
  osc = ctx.createOscillator(); gain = ctx.createGain(); gain.gain.value = 0; osc.connect(gain).connect(ctx.destination); osc.start();
  try { await navigator.wakeLock?.request("screen"); } catch (e) {}
  $("#intro").hidden = true;
  F0 = await findTone();
  if (!F0) return;
  iq.port.postMessage(F0); osc.frequency.value = F0;
  gain.gain.setTargetAtTime(0.3, ctx.currentTime, 0.05);
  $("#tabs").hidden = false; show("wave");
  $("#status").textContent = `${(F0 / 1000).toFixed(2)} kHz · listening`;
  requestAnimationFrame(frame);
}
async function findTone() {
  // each candidate tone long enough to really come out of the speaker (phones can take a quarter of a second), then the
  // loudest of a few readings, against the hiss next to it
  $("#calib").hidden = false;
  const top = Math.min(21000, ctx.sampleRate / 2 - 1500), tones = [];
  for (let f = 16000; f <= top; f += 250) tones.push(f);
  $("#calib-top").textContent = `${(top / 1000).toFixed(1)} kHz`;
  document.querySelector("#calib .legend span").textContent = "16 kHz";
  $("#bars").replaceChildren(...tones.map(() => document.createElement("i")));
  const buf = new Float32Array(analyser.frequencyBinCount), bin = ctx.sampleRate / analyser.fftSize, snr = [];
  const lag = (ctx.outputLatency || 0) + (ctx.baseLatency || 0), dwell = Math.max(350, Math.round((lag + 0.25) * 1000));
  gain.gain.setTargetAtTime(0.5, ctx.currentTime, 0.02);
  for (const [k, f] of tones.entries()) {
    osc.frequency.setValueAtTime(f, ctx.currentTime);
    await new Promise((r) => setTimeout(r, dwell));
    const c = Math.round(f / bin); let best = -Infinity;
    for (let read = 0; read < 3; read++) {
      analyser.getFloatFrequencyData(buf);
      let peak = -Infinity, floor = 0, n = 0;
      for (let j = c - 2; j <= c + 2; j++) peak = Math.max(peak, buf[j]);
      for (let j = c - 40; j <= c + 40; j++) if (Math.abs(j - c) > 6) { floor += buf[j]; n++; }
      best = Math.max(best, peak - floor / n);
      await new Promise((r) => setTimeout(r, 60));
    }
    snr.push(best);
    $("#bars").children[k].style.height = `${Math.max(2, Math.min(100, best * 1.6))}%`;
  }
  gain.gain.setTargetAtTime(0, ctx.currentTime, 0.02);
  // the highest tone that comes back clearly, above 18.5 kHz if possible (where adults stop hearing), lower if need be
  const pickFrom = (min, need) => { for (let k = tones.length - 1; k >= 0; k--) if (tones[k] >= min && snr[k] > need) return k; return -1; };
  let pick = pickFrom(18500, 20);
  if (pick < 0) pick = pickFrom(17000, 15);
  if (pick < 0) pick = pickFrom(16000, 12);
  const top3 = tones.map((f, k) => [f, snr[k]]).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([f, v]) => `${(f / 1000).toFixed(2)} kHz ${Math.round(v)} dB`).join(", ");
  const diag = `(audio ${ctx.sampleRate / 1000} kHz, delay ${Math.round(lag * 1000)} ms; best: ${top3})`;
  if (pick < 0) { $("#calib-note").textContent = `None of the high tones came back clearly: this speaker or microphone may filter them out. Check the volume, no headphones, and try again. ${diag}`; return 0; }
  $("#bars").children[pick].classList.add("pick");
  $("#calib-note").textContent = `${(tones[pick] / 1000).toFixed(2)} kHz comes back ${Math.round(snr[pick])} dB above the hiss${tones[pick] < 18500 ? ": you may just hear it, a faint whine" : ", above what most adults can hear"}. ${diag}`;
  setTimeout(() => ($("#calib").hidden = true), 4000);
  return tones[pick];
}

// ---- reading the echo, 500 times a second ----
const S = {
  mean: null, rot: 0, rotRate: 0, ring: [], tick: 0, floor: 1e-6, spec: new Float32Array(64),
  v: 0, motion: 0, disp: 0, active: false, quietFor: 0, flips: [], lastSign: 0, gestures: 0, orb: 0,
  slow: { mean: null, buf: [] }, pres: [], lastMove: 0,
};
const lam = () => C / F0;  // the wavelength, m (about 18 mm at 19 kHz)
function onIQ(a) {
  for (let k = 0; k < a.length; k += 2) step(a[k], a[k + 1]);
}
function step(i, q) {
  const dt = 1 / RATE;
  // the speaker's and the microphone's clocks can differ by a hair, which turns even the still echo slowly: follow that turn and undo it
  if (S.prevRaw) { const d = Math.atan2(q * S.prevRaw[0] - i * S.prevRaw[1], i * S.prevRaw[0] + q * S.prevRaw[1]); S.rotRate += (d - S.rotRate) * 0.0004; }
  S.prevRaw = [i, q]; S.rot += S.rotRate;
  const cr = Math.cos(-S.rot), sr = Math.sin(-S.rot), x = i * cr - q * sr, y = i * sr + q * cr;
  // the still part: a running average over about a second; what's left over is what moves
  if (!S.mean) S.mean = [x, y];
  S.mean[0] += (x - S.mean[0]) * 0.002; S.mean[1] += (y - S.mean[1]) * 0.002;
  S.ring.push([x - S.mean[0], y - S.mean[1]]); if (S.ring.length > N) S.ring.shift();
  if (++S.tick % 16 === 0 && S.ring.length === N) doppler(Math.hypot(...S.mean) || 1e-9);
  breathing(x, y);
  presence();
}

// ---- the Doppler spectrum: every 32 ms, the last eighth of a second split into frequencies ----
// the still room sits at 0 Hz; a hand coming closer at v m/s shows up 2v/λ Hz above it, going away the same below
const N = 64, COS = [], SIN = [];
for (let k = 0; k < N; k++) for (let n = 0; n < N; n++) { COS.push(Math.cos(2 * Math.PI * k * n / N)); SIN.push(Math.sin(2 * Math.PI * k * n / N)); }
const HANN = Array.from({ length: N }, (_, n) => 0.5 - 0.5 * Math.cos(2 * Math.PI * n / (N - 1)));
function doppler(ref) {
  const pw = new Float32Array(N);
  for (let k = 0; k < N; k++) {
    let re = 0, im = 0;
    for (let n = 0; n < N; n++) { const [a, b] = S.ring[n], h = HANN[n], c = COS[k * N + n], sn = SIN[k * N + n]; re += (a * c + b * sn) * h; im += (b * c - a * sn) * h; }
    pw[k] = (re * re + im * im) / (ref * ref * N * N);
  }
  // bins 2..31 are coming closer, 33..62 going away (bin k is k × 500/64 ≈ 7.8 Hz); 0 and its neighbours are the still room
  let tot = 0, mom = 0;
  for (let k = 2; k < N - 1; k++) {
    if (k === N / 2) continue;
    const f = (k < N / 2 ? k : k - N) * RATE / N, e = Math.max(0, pw[k] - S.floor * 1.5);
    tot += pw[k]; mom += e * f; S.spec[k] = pw[k];
  }
  // the room's own noise level, followed: down at once, up slowly
  S.floor += (tot / (N - 4) < S.floor ? 0.2 : 0.002) * (tot / (N - 4) - S.floor);
  const strength = tot / (N - 4) / Math.max(S.floor, 1e-12), wsum = Math.max(1e-12, tot - S.floor * 1.5 * (N - 4));
  S.motion += ((strength > 3 ? Math.log10(strength) : 0) - S.motion) * 0.3;  // 0 when still, about 1 for a hand
  const v = strength > 3 ? (mom / wsum) * lam() / 2 : 0;
  S.v += (v - S.v) * 0.5;
  gestures(16 / RATE);
}

// ---- gestures: a push, a pull, a wave ----
function gestures(dt) {
  const moving = S.motion > 0.4;
  if (moving) { S.active = true; S.quietFor = 0; S.disp += S.v * dt; }
  else if (S.active && (S.quietFor += dt) > 0.2) {  // the hand has stopped: what was that?
    const sign = Math.sign(S.disp);
    (S.ends = S.ends || []).push(+(S.disp * 100).toFixed(1));
    if (Math.abs(S.disp) > 0.04 && !S.waved) say(sign > 0 ? "Push  →|" : "|←  Pull");
    S.active = false; S.disp = 0; S.waved = false;
  }
  const sgn = moving && Math.abs(S.v) > 0.15 ? Math.sign(S.v) : 0, now = performance.now();
  if (sgn && sgn !== S.lastSign) { S.flips.push(now); S.lastSign = sgn; }
  S.flips = S.flips.filter((t) => now - t < 1500);
  if (S.flips.length >= 4) { say("Wave  👋"); S.flips = []; S.waved = true; }
  S.orb = Math.max(-0.25, Math.min(0.25, S.orb * 0.99 + S.v * dt));  // the orb follows the hand, then drifts back
}
let sayTimer;
function say(t) {
  S.gestures++; $("#w-count").textContent = S.gestures;
  const g = $("#gesture"); g.textContent = t; g.style.opacity = 1; clearTimeout(sayTimer); sayTimer = setTimeout(() => (g.style.opacity = 0), 1100);
  S.flash = performance.now();
}

// ---- breathing: the same arrow, much slower ----
function breathing(x, y) {
  const B = S.slow;
  if (!B.mean) B.mean = [x, y];
  B.mean[0] += (x - B.mean[0]) * 0.0001; B.mean[1] += (y - B.mean[1]) * 0.0001;  // the still part over about 20 seconds
  B.acc = B.acc || [0, 0, 0]; B.acc[0] += x - B.mean[0]; B.acc[1] += y - B.mean[1];
  if (++B.acc[2] < 50) return;  // fifty readings averaged: 10 a second is plenty for breaths
  B.buf.push([B.acc[0] / 50, B.acc[1] / 50]); B.acc = [0, 0, 0];
  if (B.buf.length > 600) B.buf.shift();  // a minute
  if (B.buf.length % 10 === 0 && B.buf.length >= 150) estimateBreath();
}
function estimateBreath() {
  // the chest's echo turns around a fixed centre as the chest moves (a full turn per 9 mm of movement): fit that circle,
  // and the angle around it is the chest's position, in millimetres
  const pts = S.slow.buf.slice(-400), n = pts.length;
  const fit = circle(pts);
  let s;
  if (fit && fit.r > 0) {
    let prev = null, off = 0;
    s = pts.map(([x, y]) => { let a = Math.atan2(y - fit.cy, x - fit.cx); if (prev != null) { while (a + off - prev > Math.PI) off -= 2 * Math.PI; while (a + off - prev < -Math.PI) off += 2 * Math.PI; } prev = a + off; return prev * lam() / (4 * Math.PI) * 1000; });
  } else {
    // a circle that won't fit: fall back to the swing along its main line (no millimetres then)
    const mx = pts.reduce((a, p) => a + p[0], 0) / n, my = pts.reduce((a, p) => a + p[1], 0) / n;
    let sxx = 0, syy = 0, sxy = 0; for (const [x, y] of pts) { sxx += (x - mx) ** 2; syy += (y - my) ** 2; sxy += (x - mx) * (y - my); }
    const th = 0.5 * Math.atan2(2 * sxy, sxx - syy); s = pts.map(([x, y]) => (x - mx) * Math.cos(th) + (y - my) * Math.sin(th));
  }
  // drop the slow drift (a 6-second moving average), keep the breaths
  const w = 60, trend = s.map((_, k) => { let a = 0, c = 0; for (let j = Math.max(0, k - w / 2); j < Math.min(n, k + w / 2); j++) { a += s[j]; c++; } return a / c; });
  s = s.map((v, k) => v - trend[k]);
  // the breathing period: the strongest repeat between 1.5 and 10 seconds
  const energy = s.reduce((a, v) => a + v * v, 0) || 1e-12;
  let best = 0, lag = 0;
  for (let L = 15; L <= 100; L++) { let a = 0; for (let k = L; k < n; k++) a += s[k] * s[k - L]; a /= energy; if (a > best) { best = a; lag = L; } }
  const sorted = [...s].sort((a, b) => a - b), span = sorted[Math.floor(n * 0.95)] - sorted[Math.floor(n * 0.05)];
  S.breath = { wave: s, rate: lag ? 600 / lag : null, sure: best, mm: fit ? span : null };
}
function circle(pts) {
  // least-squares circle through the points (Kåsa's method); null when they don't trace a usable arc
  const n = pts.length; let sx = 0, sy = 0; for (const [x, y] of pts) { sx += x; sy += y; }
  const mx = sx / n, my = sy / n; let suu = 0, svv = 0, suv = 0, suuu = 0, svvv = 0, suvv = 0, svuu = 0;
  for (const [x, y] of pts) { const u = x - mx, v = y - my; suu += u * u; svv += v * v; suv += u * v; suuu += u * u * u; svvv += v * v * v; suvv += u * v * v; svuu += v * u * u; }
  const det = suu * svv - suv * suv; if (Math.abs(det) < 1e-30) return null;
  const bu = 0.5 * (suuu + suvv), bv = 0.5 * (svvv + svuu), uc = (bu * svv - bv * suv) / det, vc = (bv * suu - bu * suv) / det;
  const r = Math.sqrt(uc * uc + vc * vc + (suu + svv) / n);
  let res = 0; for (const [x, y] of pts) res += (Math.hypot(x - mx - uc, y - my - vc) - r) ** 2;
  const spread = Math.sqrt((suu + svv) / n);
  return Math.sqrt(res / n) < 0.35 * spread && r < 50 * spread ? { cx: mx + uc, cy: my + vc, r } : null;  // a near-straight line has a useless huge radius
}

// ---- presence: is anything moving in the room ----
function presence() {
  S.presAcc = (S.presAcc || 0) + S.motion; S.presN = (S.presN || 0) + 1;
  if (S.presN < 250) return;  // two points a second
  const level = S.presAcc / S.presN; S.presAcc = 0; S.presN = 0;
  S.pres.push(level); if (S.pres.length > 240) S.pres.shift();
  if (level > 0.25) S.lastMove = Date.now();
}

// ---- drawing ----
function fit(c) {  // the canvas's height as written in the page (kept: resizing for a sharp screen rewrites the attribute)
  const r = devicePixelRatio || 1, w = c.clientWidth, h = +(c.dataset.h ||= c.getAttribute("height"));
  if (c.width !== Math.round(w * r)) { c.width = Math.round(w * r); c.height = Math.round(h * r); c.style.height = h + "px"; }
  return [c.getContext("2d"), w, h, r];
}
const fbuf = { data: null };
function frame() {
  requestAnimationFrame(frame);
  const tab = document.querySelector("[aria-selected=true]")?.dataset.tab;
  if (tab === "wave") { drawOrb(); drawFall(); $("#w-speed").textContent = Math.abs(S.v).toFixed(2); $("#w-move").textContent = (S.disp * 100).toFixed(1); }
  if (tab === "breathe") drawBreath();
  if (tab === "presence") drawPresence();
}
function drawOrb() {
  const [g, w, h, r] = fit($("#orb")); g.setTransform(r, 0, 0, r, 0, 0); g.clearRect(0, 0, w, h);
  const flash = S.flash ? Math.max(0, 1 - (performance.now() - S.flash) / 600) : 0;
  const rad = 46 * (1 + S.orb * 3.2), cx = w / 2, cy = h / 2 - 10, act = Math.min(1, S.motion);
  // rings: the sound going out
  const t = performance.now() / 1000;
  for (let k = 0; k < 4; k++) { const p = (t * 0.6 + k / 4) % 1; g.strokeStyle = `rgba(93,255,176,${(1 - p) * 0.25})`; g.lineWidth = 1.5; g.beginPath(); g.arc(cx, cy, rad + p * 120, 0, 7); g.stroke(); }
  const grd = g.createRadialGradient(cx, cy, 0, cx, cy, rad * 1.6);
  grd.addColorStop(0, `rgba(${Math.round(93 + 162 * flash)},255,${Math.round(176 - 70 * flash)},${0.55 + act * 0.45})`); grd.addColorStop(1, "rgba(93,255,176,0)");
  g.fillStyle = grd; g.beginPath(); g.arc(cx, cy, rad * 1.6, 0, 7); g.fill();
  g.fillStyle = `rgba(230,255,243,${0.6 + act * 0.4})`; g.beginPath(); g.arc(cx, cy, rad * 0.45, 0, 7); g.fill();
}
function drawFall() {
  // the echo's spectrum around the tone, one row a frame: a moving hand draws a streak off the centre line
  const c = $("#fall"), [g, w, h, r] = fit(c);
  if (!fbuf.data || fbuf.data.length !== analyser.frequencyBinCount) fbuf.data = new Float32Array(analyser.frequencyBinCount);
  analyser.getFloatFrequencyData(fbuf.data);
  const bin = ctx.sampleRate / analyser.fftSize, c0 = F0 / bin, span = Math.round(250 / bin);
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.drawImage(c, 0, 0, c.width, c.height - 2 * r, 0, 2 * r, c.width, c.height - 2 * r);  // scroll down
  const peak = fbuf.data[Math.round(c0)];
  for (let px = 0; px < c.width; px++) {
    const j = Math.round(c0 - span + (px / c.width) * 2 * span), db = fbuf.data[j] - peak;  // loudness against the tone itself
    const v = Math.max(0, Math.min(1, (db + 75) / 55)), near = Math.abs(j - c0) < 2.5;
    g.fillStyle = near ? `rgba(255,207,106,${0.35 + v * 0.4})` : `rgb(${Math.round(v * v * 120)},${Math.round(v * 255)},${Math.round(60 + v * 120)})`;
    g.fillRect(px, 0, 1, 2 * r);
  }
}
function drawBreath() {
  const [g, w, h, r] = fit($("#breath")); g.setTransform(r, 0, 0, r, 0, 0); g.clearRect(0, 0, w, h);
  const B = S.breath;
  g.strokeStyle = "rgba(120,255,190,.12)"; g.beginPath(); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke();
  if (!B) { g.fillStyle = "#8fb5a5"; g.font = "14px ui-sans-serif, system-ui"; g.textAlign = "center"; g.fillText(`Listening… ${Math.min(100, Math.round(S.slow.buf.length / 1.5))}%`, w / 2, h / 2 - 12); return; }
  const s = B.wave.slice(-300), m = Math.max(...s.map(Math.abs)) || 1;
  g.strokeStyle = "#5dffb0"; g.lineWidth = 2.2; g.shadowColor = "#5dffb0"; g.shadowBlur = 8; g.beginPath();
  s.forEach((v, k) => { const x = (k / (s.length - 1)) * w, y = h / 2 - (v / m) * (h * 0.4); k ? g.lineTo(x, y) : g.moveTo(x, y); });
  g.stroke(); g.shadowBlur = 0;
  const sure = B.sure > 0.5 ? "sure" : B.sure > 0.3 ? "fairly" : "not yet";
  $("#b-rate").textContent = B.rate && B.sure > 0.3 ? Math.round(B.rate) : "–"; $("#b-depth").textContent = B.sure > 0.3 && B.mm != null ? B.mm.toFixed(1) : "–"; $("#b-sure").textContent = sure;
}
function drawPresence() {
  const [g, w, h, r] = fit($("#pres")); g.setTransform(r, 0, 0, r, 0, 0); g.clearRect(0, 0, w, h);
  const p = S.pres, m = Math.max(1, ...p), bw = w / 240;
  p.forEach((v, k) => { const bh = Math.max(1, (v / m) * (h - 10)); g.fillStyle = v > 0.25 ? "#5dffb0" : "#1d3a2f"; g.fillRect(w - (p.length - k) * bw, h - bh, Math.max(1, bw - 1), bh); });
  const now = p[p.length - 1] || 0, ago = S.lastMove ? Math.round((Date.now() - S.lastMove) / 1000) : null;
  $("#p-now").textContent = now > 0.25 ? "movement" : "still"; $("#p-level").textContent = Math.round(Math.min(100, now * 60));
  $("#p-last").textContent = ago == null ? "–" : ago < 2 ? "now" : ago < 60 ? `${ago} s ago` : `${Math.round(ago / 60)} min ago`;
}

// ---- tabs ----
function show(tab) {
  for (const b of $("#tabs").children) b.setAttribute("aria-selected", String(b.dataset.tab === tab));
  for (const id of ["wave", "breathe", "presence"]) $("#" + id).hidden = id !== tab;
}
$("#tabs").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) show(b.dataset.tab); });
