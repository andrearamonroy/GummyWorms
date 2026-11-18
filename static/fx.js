"use strict";

// Sounds and little celebrations for the lesson pages.
// Every sound is made by the browser itself, so there are no sound files to download.
window.FX = (function () {
  const MUTE_KEY = "frenchapp_muted_v1";
  const PRAISE = ["Nice!", "Great!", "Bravo!", "Parfait!", "Magnifique!", "Super!", "Excellent!"];

  const reduceMotion = () =>
    !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  let muted = false;
  try { muted = localStorage.getItem(MUTE_KEY) === "1"; } catch (e) { /* ignore */ }

  /// ---------- sound ----------
  let ctx = null;

  function audio() {
    if (muted) return null;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!ctx) ctx = new AC();                       // created on the first tap, which browsers require
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }

  // one soft note: a quick fade in (no click), then a gentle fade out
  function note(freq, delay, length, type, volume) {
    const c = audio();
    if (!c) return;
    const t = c.currentTime + delay;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = type || "sine";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(volume || 0.15, t + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + length);
    osc.connect(gain);
    gain.connect(c.destination);
    osc.start(t);
    osc.stop(t + length + 0.02);
  }

  function correctSound() {                         // two bright notes going up
    note(659.25, 0, 0.16, "triangle", 0.16);
    note(987.77, 0.11, 0.28, "triangle", 0.16);
  }
  function wrongSound() {                           // two soft notes going down (gentle, not harsh)
    note(293.66, 0, 0.18, "sine", 0.12);
    note(233.08, 0.14, 0.26, "sine", 0.12);
  }
  function popSound() { note(880, 0, 0.09, "sine", 0.10); }     // a matched pair
  function buzzSound() { note(196, 0, 0.14, "sine", 0.10); }    // a pair that doesn't match
  function completeSound() {                        // a little fanfare
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => note(f, i * 0.12, 0.3, "triangle", 0.15));
    note(1318.5, 0.5, 0.5, "sine", 0.10);
  }

  /// ---------- words ----------
  let lastPraise = -1;
  function nextPraise() {
    let i;
    do { i = Math.floor(Math.random() * PRAISE.length); } while (i === lastPraise && PRAISE.length > 1);
    lastPraise = i;
    return PRAISE[i];
  }

  // replays the CSS animation on an element
  function replay(el) {
    el.style.animation = "none";
    void el.offsetWidth;
    el.style.animation = "";
  }

  // called after every exercise: sound plus the feedback line
  function result(correct, type, feedbackEl) {
    if (correct) {
      correctSound();
      if (feedbackEl) {
        feedbackEl.textContent = nextPraise();
        feedbackEl.className = "good";
        replay(feedbackEl);
      }
    } else if (type === "matching") {
      popSound();                                   // finishing matching with a few slips is still a finish
      if (feedbackEl) feedbackEl.className = "ok";
    } else {
      wrongSound();
      if (feedbackEl) {
        feedbackEl.className = "bad";
        replay(feedbackEl);
      }
    }
  }

  /// ---------- the lesson-complete party ----------
  function confetti() {
    if (reduceMotion()) return;
    const canvas = document.createElement("canvas");
    canvas.className = "fx-confetti";
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    document.body.appendChild(canvas);
    const g = canvas.getContext && canvas.getContext("2d");
    if (!g) { canvas.remove(); return; }

    const colors = ["#58cc02", "#ff4b4b", "#1cb0f6", "#ffc800", "#ce82ff"];
    const bits = Array.from({ length: 120 }, () => ({
      x: Math.random() * canvas.width,
      y: -20 - Math.random() * canvas.height * 0.5,
      w: 6 + Math.random() * 6,
      h: 8 + Math.random() * 8,
      vx: -2 + Math.random() * 4,
      vy: 2 + Math.random() * 4,
      spin: Math.random() * Math.PI,
      vspin: -0.2 + Math.random() * 0.4,
      color: colors[Math.floor(Math.random() * colors.length)]
    }));
    const start = performance.now();

    function frame(now) {
      g.clearRect(0, 0, canvas.width, canvas.height);
      bits.forEach(b => {
        b.x += b.vx;
        b.y += b.vy;
        b.vy += 0.06;
        b.spin += b.vspin;
        g.save();
        g.translate(b.x, b.y);
        g.rotate(b.spin);
        g.fillStyle = b.color;
        g.fillRect(-b.w / 2, -b.h / 2, b.w, b.h);
        g.restore();
      });
      if (now - start < 2600) requestAnimationFrame(frame);
      else canvas.remove();
    }
    requestAnimationFrame(frame);
  }

  // the apple and the worm jump for joy
  function hooray() {
    if (reduceMotion()) return;
    ["apple", "worm"].forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      const cls = id === "apple" ? "hooray" : "hop";
      el.classList.remove(cls);
      void el.offsetWidth;
      el.classList.add(cls);
    });
  }

  function celebrate() {
    completeSound();
    confetti();
    hooray();
  }

  /// ---------- sound on / off ----------
  function setMuted(on) {
    muted = !!on;
    try { localStorage.setItem(MUTE_KEY, muted ? "1" : "0"); } catch (e) { /* ignore */ }
  }

  return { result, pop: popSound, buzz: buzzSound, celebrate, setMuted, isMuted: () => muted };
})();
