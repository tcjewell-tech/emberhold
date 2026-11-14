// Emberhold's sound effects, made on the spot from a few tones and filtered noise: no audio files.
// Everything runs through a low-pass filter and a short echo so it sits soft rather than shrill.

export function createSound() {
  let ac, out, scale = 1, muted = false;
  try { muted = localStorage.getItem('emberhold-muted') === '1'; } catch { /* private window: start unmuted */ }

  function setup() {
    ac = new AudioContext();
    const lp = ac.createBiquadFilter(), delay = ac.createDelay(), fb = ac.createGain(), wet = ac.createGain();
    lp.type = 'lowpass'; lp.frequency.value = 3400; delay.delayTime.value = 0.13; fb.gain.value = 0.28; wet.gain.value = 0.3;
    lp.connect(ac.destination); lp.connect(delay); delay.connect(fb); fb.connect(delay); delay.connect(wet); wet.connect(ac.destination);
    out = lp;
  }
  function note({ type = 'triangle', f = 440, to = f, at = 0, len = 0.1, vol = 0.2 }) {
    const t = ac.currentTime + at, gain = ac.createGain();
    gain.gain.setValueAtTime(0.0001, t); gain.gain.linearRampToValueAtTime(vol * scale, t + 0.008); gain.gain.exponentialRampToValueAtTime(0.0001, t + len); gain.connect(out);
    let src;
    if (type === 'noise') {
      const buf = ac.createBuffer(1, Math.ceil(ac.sampleRate * len), ac.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = 0.8;
      src = ac.createBufferSource(); src.buffer = buf; src.connect(bp); bp.connect(gain);
    } else {
      src = ac.createOscillator(); src.type = type; src.frequency.setValueAtTime(f, t); src.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + len); src.connect(gain);
    }
    src.start(t); src.stop(t + len + 0.02);
  }
  const seq = (notes, step, extra = {}) => notes.forEach((f, k) => f && note({ f, at: k * step, len: step * 1.8, ...extra }));
  const chord = (fs, extra) => fs.forEach((f) => note({ f, ...extra }));
  const SFX = {
    'Pulse rifle': () => { note({ type: 'square', f: 720, to: 260, len: 0.07, vol: 0.07 }); note({ f: 360, to: 130, len: 0.09, vol: 0.15 }); },
    Scattergun: () => { note({ type: 'noise', f: 1100, len: 0.16, vol: 0.5 }); note({ f: 150, to: 50, len: 0.16, vol: 0.4 }); },
    Needler: () => note({ type: 'sine', f: 1300, to: 700, len: 0.06, vol: 0.14 }),
    'Rivet gun': () => { note({ type: 'noise', f: 900, len: 0.05, vol: 0.3 }); note({ type: 'square', f: 180, to: 90, len: 0.1, vol: 0.12 }); },
    Nailgun: () => { note({ type: 'noise', f: 2600, len: 0.04, vol: 0.25 }); note({ f: 240, to: 160, len: 0.06, vol: 0.18 }); },
    Turret: () => note({ f: 300, to: 180, len: 0.06, vol: 0.12 }),
    Spit: () => note({ type: 'sine', f: 220, to: 420, len: 0.1, vol: 0.14 }),
    Hit: () => note({ type: 'noise', f: 2400, len: 0.05, vol: 0.3 }),
    Dash: () => { note({ type: 'noise', f: 1800, len: 0.18, vol: 0.2 }); note({ type: 'sine', f: 260, to: 1100, len: 0.16, vol: 0.18 }); },
    Shockwave: () => { note({ type: 'noise', f: 320, len: 0.5, vol: 0.6 }); note({ type: 'sine', f: 130, to: 34, len: 0.5, vol: 0.5 }); },
    Mend: () => seq([523, 659, 784, 1047], 0.07, { type: 'sine', vol: 0.2 }),
    Ultimate: () => { chord([196, 294, 392], { len: 0.5, vol: 0.16 }); note({ type: 'sine', f: 392, to: 1568, len: 0.4, vol: 0.14 }); },
    Build: () => { note({ type: 'noise', f: 700, len: 0.05, vol: 0.3 }); seq([220, 330], 0.06, { vol: 0.22 }); },
    Scavenge: () => seq([880, 1175, 1568], 0.05, { type: 'sine', vol: 0.12 }),
    'Power-up': () => seq([659, 784, 988, 1319], 0.045, { type: 'square', vol: 0.08 }),
    'Hero down': () => seq([392, 330, 262, 196], 0.11, { vol: 0.22 }),
    'Ember hit': () => { note({ type: 'sine', f: 96, to: 60, len: 0.3, vol: 0.5 }); note({ type: 'noise', f: 400, len: 0.2, vol: 0.25 }); },
    'Night falls': () => { chord([110, 165], { type: 'sine', len: 1.6, vol: 0.2 }); seq([330, 311, 262, 247, 196], 0.2, { vol: 0.2 }); },
    Dawn: () => { chord([131, 196], { type: 'sine', len: 1.4, vol: 0.18 }); seq([262, 330, 392, 523, 659], 0.13, { vol: 0.2 }); },
    Victory: () => { seq([523, 659, 784, 1047, 784, 1047, 1319], 0.12, { vol: 0.2 }); chord([131, 196, 262], { type: 'sine', at: 0.72, len: 1.2, vol: 0.2 }); },
    'Ember lost': () => { seq([196, 185, 165, 147, 131, 98], 0.2, { vol: 0.25 }); note({ type: 'noise', f: 200, len: 1.4, vol: 0.3 }); },
  };
  return {
    names: Object.keys(SFX),
    /** vol: 0 to 1, how loud this one is (distance from the camera, say). */
    play(name, vol = 1) {
      if (muted || vol <= 0.03 || !SFX[name]) return;
      if (!ac) setup();
      if (ac.state === 'suspended') ac.resume(); // browsers hold audio until the first click or key
      scale = vol;
      SFX[name]();
    },
    muted: () => muted,
    /** Flip sound on or off; returns true when now muted. */
    toggle() {
      muted = !muted;
      try { localStorage.setItem('emberhold-muted', muted ? '1' : '0'); } catch { /* not remembered */ }
      return muted;
    },
  };
}
