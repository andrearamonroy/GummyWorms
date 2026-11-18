"use strict";

// Everything lives inside window.FC so it can't clash with the names in app.js.
window.FC = (function () {
  const KEY = "frenchapp_sets_v1";
  // the menu uses the same apple.png as the progress bar; it lives next to this script, in the static folder
  const SCRIPT_SRC = document.currentScript ? document.currentScript.src : "";
  const MENU_ICON = SCRIPT_SRC ? new URL("apple.png", SCRIPT_SRC).href : "/static/apple.png";

  /// small helpers
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text) e.textContent = text;
    return e;
  }
  const clean = (s, max) => String(s || "").trim().slice(0, max);
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  /// storage: a local copy in the browser (fast, works offline) that is also saved to
  /// the learner's account on the server when they are signed in
  const OWNER_KEY = "frenchapp_sets_owner_v1";     // "anon" or the id of the account the local copy belongs to
  const DIRTY_KEY = "frenchapp_sets_dirty_v1";     // "1" when local edits haven't reached the server yet
  let me = { signedIn: false };
  const PENDING_KEY = "frenchapp_pending_save_v1";  // a save that was waiting for sign-in (sessionStorage)
  let isReady = false;
  let meFailed = false;                            // true when the server couldn't be reached at all
  let chain = Promise.resolve();                   // server updates run one after another, in order

  const getItem = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const setItem = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } };
  const isDirty = () => getItem(DIRTY_KEY) === "1";
  const setDirty = on => setItem(DIRTY_KEY, on ? "1" : "0");

  // Saving needs an account. The one exception: someone who signed in on this device before and is
  // offline right now can keep saving; it is uploaded the next time they are online.
  function canSave() {
    if (me.signedIn) return true;
    const owner = getItem(OWNER_KEY);
    return meFailed && !!owner && owner !== "anon";
  }

  function api(method, url, body) {
    return fetch(url, {
      method,
      credentials: "same-origin",
      headers: Object.assign({ "X-Requested-With": "fetch" }, body ? { "Content-Type": "application/json" } : {}),
      body: body ? JSON.stringify(body) : undefined
    }).then(r => {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    });
  }

  // sends one change to the server (after it was already applied locally)
  function push(method, url, body, recover) {
    if (!me.signedIn) { setDirty(true); return; }
    chain = chain.then(() => api(method, url, body)).catch(() => {
      if (recover) return syncAll().catch(() => setDirty(true));
      toast("Couldn’t update your account. Check your connection.");
    });
  }

  // uploads everything we have (adding only, never deleting), then takes the server's version
  function syncAll() {
    return api("POST", "/api/sets/merge", { sets: loadSets() }).then(out => {
      saveSets(out.sets);
      setDirty(false);
    });
  }

  function loadSets() {
    try {
      const data = JSON.parse(localStorage.getItem(KEY));
      return Array.isArray(data) ? data : [];
    } catch (e) {
      return [];
    }
  }

  function saveSets(sets) {
    try {
      localStorage.setItem(KEY, JSON.stringify(sets));
      return true;
    } catch (e) {
      return false;
    }
  }

  /// cards: { kind: "word", fr, en, note }  or  { kind: "rule", title, text, examples }
  function normalize(card) {
    if (card.kind === "rule") {
      const title = clean(card.title, 120);
      const text = clean(card.text, 600);
      if (!title || !text) return null;
      const examples = (card.examples || []).slice(0, 12).map(e => ({
        fr: clean(e.fr, 120),
        en: clean(e.en, 120),
        formula: clean(e.formula, 200)
      })).filter(e => e.fr);
      return { id: uid(), kind: "rule", title, text, examples };
    }
    const fr = clean(card.fr, 120);
    const en = clean(card.en, 120);
    if (!fr || !en) return null;
    return { id: uid(), kind: "word", fr, en, note: clean(card.note, 200) };
  }

  function keyOf(c) {
    return c.kind === "rule"
      ? "rule|" + c.title.toLowerCase()
      : "word|" + c.fr.toLowerCase() + "|" + c.en.toLowerCase();
  }

  function createSet(name) {
    if (!canSave()) return null;
    const n = clean(name, 40);
    if (!n) return null;
    const sets = loadSets();
    const existing = sets.find(s => s.name.toLowerCase() === n.toLowerCase());
    if (existing) return existing;
    const set = { id: uid(), name: n, cards: [] };
    sets.push(set);
    if (!saveSets(sets)) return null;
    push("POST", "/api/sets", { id: set.id, name: set.name }, true);
    return set;
  }

  function addCards(setId, cards) {
    if (!canSave()) return { added: 0, skipped: 0, failed: true, needsSignIn: true };
    const sets = loadSets();
    const set = sets.find(s => s.id === setId);
    if (!set) return { added: 0, skipped: 0, failed: true };
    const have = new Set(set.cards.map(keyOf));
    let added = 0;
    let skipped = 0;
    const fresh = [];
    cards.forEach(raw => {
      const c = normalize(raw);
      if (!c) return;
      const k = keyOf(c);
      if (have.has(k)) { skipped++; return; }
      have.add(k);
      set.cards.push(c);
      fresh.push(c);
      added++;
    });
    const failed = !saveSets(sets);
    if (!failed && fresh.length) push("POST", "/api/sets/" + encodeURIComponent(setId) + "/cards", { cards: fresh }, true);
    return { added, skipped, failed };
  }

  function removeCard(setId, cardId) {
    if (!canSave()) return;
    const sets = loadSets();
    const set = sets.find(s => s.id === setId);
    if (!set) return;
    set.cards = set.cards.filter(c => c.id !== cardId);
    if (saveSets(sets)) {
      push("DELETE", "/api/sets/" + encodeURIComponent(setId) + "/cards/" + encodeURIComponent(cardId), null, false);
    }
  }

  function deleteSet(setId) {
    if (!canSave()) return;
    if (saveSets(loadSets().filter(s => s.id !== setId))) {
      push("DELETE", "/api/sets/" + encodeURIComponent(setId), null, false);
    }
  }

  /// the French voice (same idea as in app.js, kept separate on purpose)
  let voice = null;
  const canSpeak = "speechSynthesis" in window;

  function loadVoice() {
    voice = speechSynthesis.getVoices().find(v => v.lang.startsWith("fr")) || null;
  }
  if (canSpeak) {
    loadVoice();
    speechSynthesis.addEventListener("voiceschanged", loadVoice);
  }

  function speak(text, rate = 1) {
    if (!canSpeak) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "fr-FR";
    u.rate = rate;
    if (voice) u.voice = voice;
    speechSynthesis.speak(u);
  }

  /// "Save to a set" popup
  function toast(msg) {
    document.querySelectorAll(".fc-toast").forEach(old => old.remove());
    const t = el("div", "fc-toast", msg);
    t.setAttribute("role", "status");
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2400);
  }

  function closePicker() {
    const old = document.getElementById("fc-overlay");
    if (old) old.remove();
  }

  function openPicker(cards, label) {
    if (!isReady) { ready.then(() => openPicker(cards, label)); return; }
    if (!canSave()) { openSignInPrompt(cards, label); return; }
    closePicker();

    function finish(setId, setName) {
      const r = addCards(setId, cards);
      closePicker();
      if (r.failed) toast("Couldn’t save. Is the browser blocking storage?");
      else if (!r.added && !r.skipped) toast("Nothing to save");
      else if (!r.added) toast("Already in " + setName);
      else toast("Saved " + r.added + (r.added === 1 ? " card" : " cards") + " to " + setName +
                 (r.skipped ? " (" + r.skipped + " already there)" : ""));
    }

    const overlay = el("div", "fc-overlay");
    overlay.id = "fc-overlay";
    const modal = el("div", "fc-modal");
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.append(el("h3", "", "Save to a set"), el("p", "fc-sub", label));

    const sets = loadSets();
    const list = el("div", "fc-setlist");
    sets.forEach(s => {
      const b = el("button", "", s.name + " (" + s.cards.length + ")");
      b.type = "button";
      b.addEventListener("click", () => finish(s.id, s.name));
      list.appendChild(b);
    });
    if (sets.length) modal.appendChild(list);

    const form = el("form", "fc-new");
    const input = el("input");
    input.type = "text";
    input.placeholder = "New set name";
    input.maxLength = 40;
    input.setAttribute("aria-label", "New set name");
    const create = el("button", "primary", "Create and save");
    create.type = "submit";
    form.append(input, create);
    form.addEventListener("submit", e => {
      e.preventDefault();
      const set = createSet(input.value);
      if (!set) { input.focus(); return; }
      finish(set.id, set.name);
    });
    modal.appendChild(form);

    const cancel = el("button", "", "Cancel");
    cancel.type = "button";
    cancel.addEventListener("click", closePicker);
    modal.appendChild(cancel);

    overlay.appendChild(modal);
    overlay.addEventListener("click", e => { if (e.target === overlay) closePicker(); });
    document.body.appendChild(overlay);
    (sets.length ? list.querySelector("button") : input).focus();
  }

  function openSignInPrompt(cards, label) {
    closePicker();
    const overlay = el("div", "fc-overlay");
    overlay.id = "fc-overlay";
    const modal = el("div", "fc-modal");
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.append(
      el("h3", "", "Sign in to save flashcards"),
      el("p", "fc-sub", label),
      el("p", "", "Flashcards are saved to your account, so you can study them on any device. The lessons stay free to use without signing in.")
    );

    const link = el("a", "signin", "Sign in with Google");
    link.href = loginUrl();
    link.addEventListener("click", () => {
      // remember what they were saving, so it can finish when they come back
      try {
        sessionStorage.setItem(PENDING_KEY, JSON.stringify({
          cards: cards.slice(0, 500), label: label, path: location.pathname
        }));
      } catch (e) { /* ignore */ }
    });
    const cancel = el("button", "", "Not now");
    cancel.type = "button";
    cancel.addEventListener("click", closePicker);
    const row = el("div", "fc-new");
    row.append(link, cancel);
    modal.appendChild(row);

    overlay.appendChild(modal);
    overlay.addEventListener("click", e => { if (e.target === overlay) closePicker(); });
    document.body.appendChild(overlay);
    link.focus();
  }

  function takePending() {
    try {
      const raw = sessionStorage.getItem(PENDING_KEY);
      sessionStorage.removeItem(PENDING_KEY);
      const p = JSON.parse(raw);
      if (!p || !Array.isArray(p.cards) || !p.cards.length || p.path !== location.pathname) return null;
      return { cards: p.cards.slice(0, 500), label: clean(p.label, 200) };
    } catch (e) {
      return null;
    }
  }

  document.addEventListener("keydown", e => {
    if (e.key === "Escape") closePicker();
  });

  /// accounts: who is signed in, and the bar that shows it
  let resolveReady;
  const ready = new Promise(res => { resolveReady = res; });

  function markReady() {
    isReady = true;
    resolveReady();
  }

  const loginUrl = () => "/login?next=" + encodeURIComponent(location.pathname + location.search);

  function clearLocal() {
    saveSets([]);
    setItem(OWNER_KEY, "anon");
    setDirty(false);
  }

  function renderAccountBar() {
    const bar = document.getElementById("account-bar");
    if (!bar) return;
    bar.innerHTML = "";

    // the apple button
    const btn = el("button", "menu-btn");
    btn.type = "button";
    btn.setAttribute("aria-label", "Menu");
    btn.setAttribute("aria-expanded", "false");
    btn.setAttribute("aria-controls", "menu-panel");
    const img = el("img");
    img.src = MENU_ICON;
    img.alt = "";
    img.addEventListener("error", () => { img.remove(); btn.textContent = "Menu"; });   // picture missing: show a word instead
    btn.appendChild(img);

    // the panel that opens under it
    const panel = el("div", "menu-panel");
    panel.id = "menu-panel";
    panel.hidden = true;

    function setOpen(open) {
      panel.hidden = !open;
      btn.setAttribute("aria-expanded", String(open));
    }
    function link(text, href) {
      const a = el("a", "menu-item", text);
      a.href = href;
      if (href === location.pathname) {
        a.classList.add("current");
        a.setAttribute("aria-current", "page");
      }
      return a;
    }
    function action(text, cls, fn) {
      const b = el("button", "menu-item " + cls, text);
      b.type = "button";
      b.addEventListener("click", () => { setOpen(false); fn(); });
      return b;
    }

    panel.appendChild(el("p", "menu-who", me.signedIn ? "Signed in as " + me.name : "You’re not signed in"));
    panel.append(link("Home", "/"), link("My flashcards", "/flashcards"));
        if (window.FX) {
      const snd = el("button", "menu-item", FX.isMuted() ? "Sound: off" : "Sound: on");
      snd.type = "button";
      snd.addEventListener("click", () => {
        FX.setMuted(!FX.isMuted());
        snd.textContent = FX.isMuted() ? "Sound: off" : "Sound: on";
        if (!FX.isMuted()) FX.pop();                    // a little blip to confirm it's on
      });
      panel.appendChild(snd);
    }
    panel.appendChild(el("hr", "menu-divider"));
    if (me.signedIn) {
      panel.append(action("Sign out", "", signOut), action("Delete account", "danger-item", deleteAccount));
    } else {
      const a = el("a", "menu-item signin-item", "Sign in with Google");
      a.href = loginUrl();
      panel.appendChild(a);
    }

    // open and close
    btn.addEventListener("click", () => {
      setOpen(panel.hidden);
      if (!panel.hidden) panel.querySelector(".menu-item").focus();
    });
    document.addEventListener("click", e => {
      if (!bar.contains(e.target)) setOpen(false);          // tapping anywhere else closes it
    });
    document.addEventListener("keydown", e => {
      if (e.key === "Escape" && !panel.hidden) { setOpen(false); btn.focus(); }
    });

    bar.append(btn, panel);
  }

  function flush() {
    return chain.then(() => (me.signedIn && isDirty() ? syncAll().catch(() => {}) : null));
  }

  function signOut() {
    return flush()
      .then(() => api("POST", "/logout"))
      .catch(() => {})
      .then(() => { clearLocal(); location.href = "/"; });
  }

  function deleteAccount() {
    if (!confirm("Delete your account and all your saved sets? This can’t be undone.")) return;
    api("DELETE", "/api/me")
      .then(() => { clearLocal(); location.href = "/"; })
      .catch(() => toast("Couldn’t delete the account. Try again."));
  }

  async function boot() {
    try {
      me = await api("GET", "/api/me");
    } catch (e) {
      me = { signedIn: false };
      meFailed = true;                    // couldn't reach the server (different from "not signed in")
    }
    const owner = getItem(OWNER_KEY);
    if (me.signedIn) {
      const id = String(me.id);
      try {
        if (owner && owner !== "anon" && owner !== id) saveSets([]);   // someone else's copy: drop it
        if (owner !== id || isDirty()) {
          await syncAll();                                              // first time here, or unsynced edits
        } else {
          saveSets((await api("GET", "/api/sets")).sets);               // normal visit: take the server's version
        }
        setItem(OWNER_KEY, id);
      } catch (e) {
        /* offline or server problem: keep working from the local copy */
      }
    } else if (!owner) {
      setItem(OWNER_KEY, "anon");
    }
    markReady();
    renderAccountBar();
    const params = new URLSearchParams(location.search);
    if (params.get("signin") === "failed") {
      toast("Sign-in didn’t finish. Please try again.");
      history.replaceState(null, "", location.pathname);
    }
    // they came back from Google: finish the save they started
    const pending = takePending();
    if (pending && canSave()) openPicker(pending.cards, pending.label);
  }

  if (typeof fetch === "function") {
    boot();
  } else {
    markReady();
  }

  return {
    el, loadSets, createSet, addCards, removeCard, deleteSet, speak, openPicker, toast,
    ready, isReady: () => isReady, me: () => me, canSave, loginUrl, flush, signOut
  };
})();