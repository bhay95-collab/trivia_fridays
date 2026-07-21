/* ============================================================
   SOUND — every effect is synthesised live with the Web Audio
   API. Nothing is downloaded, nothing is licensed, and it all
   sounds agreeably like a 1983 quiz machine.

   Off by default. The toggle in the header persists the choice
   and doubles as the user gesture browsers require before any
   audio is allowed to play.
   ============================================================ */

const STORE_KEY = "tf-sound";
const MASTER_LEVEL = 0.4;

let ctx = null;
let master = null;

export function soundOn() {
  return localStorage.getItem(STORE_KEY) === "on";
}

function ensure() {
  if (!soundOn()) return null;
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = MASTER_LEVEL;
    master.connect(ctx.destination);
  }
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

/* One enveloped oscillator. The building block of everything below. */
function tone({ freq, to = freq, type = "square", at = 0, dur = 0.15, peak = 0.4 }) {
  if (!ensure()) return;
  const t = ctx.currentTime + at;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (to !== freq) osc.frequency.exponentialRampToValueAtTime(Math.max(to, 1), t + dur);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(peak, t + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(gain).connect(master);
  osc.start(t);
  osc.stop(t + dur + 0.05);
}

/* A filtered white-noise hit. Snare-ish, thud-ish, depending on freq. */
function thump({ at = 0, dur = 0.08, peak = 0.5, freq = 1600, out = null }) {
  if (!ensure()) return;
  const t = ctx.currentTime + at;
  const len = Math.ceil(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const filter = ctx.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = freq;
  filter.Q.value = 0.9;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(peak, t);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(filter).connect(gain).connect(out || master);
  src.start(t);
  src.stop(t + dur + 0.05);
}

export const sfx = {
  /* Small click for ordinary actions: question opened, answer saved. */
  tick() {
    tone({ freq: 1150, to: 900, type: "square", dur: 0.05, peak: 0.18 });
  },

  /* The lock-in buzz. Low, rude, unmistakably a gameshow. */
  buzz() {
    tone({ freq: 120, to: 46, type: "sawtooth", dur: 0.4, peak: 0.45 });
    tone({ freq: 62, to: 40, type: "square", dur: 0.4, peak: 0.3 });
  },

  /* Correct answer. Two bright notes and a sparkle on top. */
  chime() {
    tone({ freq: 659, type: "sine", dur: 0.16, peak: 0.4 });
    tone({ freq: 988, type: "sine", at: 0.09, dur: 0.3, peak: 0.4 });
    tone({ freq: 1976, type: "sine", at: 0.09, dur: 0.3, peak: 0.12 });
  },

  /* Streak sting: a quick rising arpeggio. */
  sting() {
    const notes = [523, 659, 784, 1047];
    notes.forEach((freq, i) =>
      tone({ freq, type: "square", at: i * 0.07, dur: 0.14, peak: 0.28 }));
    tone({ freq: 1047, type: "sine", at: notes.length * 0.07, dur: 0.35, peak: 0.3 });
  },

  /* The gentle trombone shrug for a broken streak or a zero. */
  womp() {
    tone({ freq: 330, to: 262, type: "triangle", dur: 0.28, peak: 0.35 });
    tone({ freq: 262, to: 208, type: "triangle", at: 0.24, dur: 0.4, peak: 0.35 });
  },

  /* A plinth landing on the stage. */
  slam() {
    thump({ freq: 190, dur: 0.14, peak: 0.7 });
    tone({ freq: 92, to: 44, type: "sine", dur: 0.26, peak: 0.7 });
  },

  /* Drum roll. Returns a handle so the reveal can cut it off clean. */
  drumroll(seconds = 3) {
    if (!ensure()) return { stop() {} };
    const roll = ctx.createGain();
    roll.gain.value = 1;
    roll.connect(master);
    const HIT_GAP = 0.034;
    for (let at = 0; at < seconds; at += HIT_GAP) {
      thump({ at, dur: 0.05, peak: 0.16 + Math.random() * 0.08, freq: 1500, out: roll });
    }
    return {
      stop() {
        if (!ctx) return;
        roll.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.02);
      },
    };
  },

  /* Winner fanfare: three stabs and a held chord. */
  fanfare() {
    [0, 0.14, 0.28].forEach((at) =>
      tone({ freq: 523, type: "sawtooth", at, dur: 0.12, peak: 0.3 }));
    [392, 523, 659, 784].forEach((freq) =>
      tone({ freq, type: "sawtooth", at: 0.44, dur: 1.3, peak: 0.16 }));
    tone({ freq: 1568, type: "sine", at: 0.44, dur: 1.3, peak: 0.1 });
    tone({ freq: 2093, type: "sine", at: 0.62, dur: 1.1, peak: 0.07 });
  },
};

/* ============================================================
   THE TOGGLE — present in every page header.
   ============================================================ */
function paintToggle(btn) {
  const on = soundOn();
  btn.setAttribute("aria-pressed", String(on));
  btn.textContent = on ? "Sound on" : "Sound off";
  btn.classList.toggle("is-on", on);
}

const toggleBtn = document.getElementById("sound-toggle");
if (toggleBtn) {
  paintToggle(toggleBtn);
  toggleBtn.addEventListener("click", () => {
    localStorage.setItem(STORE_KEY, soundOn() ? "off" : "on");
    paintToggle(toggleBtn);
    if (soundOn()) sfx.chime(); // the click is the unlock gesture; confirm audibly
  });
}
