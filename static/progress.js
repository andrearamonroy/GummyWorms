"use strict";

// Remembers finished lessons and their stars. Lives in window.GW so it can't clash with app.js.
// Saved in this browser always; also sent to your account when you are signed in.
window.GW = (function () {
  const KEY = "frenchapp_progress_v1";            // { lessonId: {stars, best, total, at} }
  const OWNER_KEY = "frenchapp_progress_owner_v1"; // "anon" or the id of the account this copy belongs to

  const getItem = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const setItem = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } };

  function load() {
    try {
      const data = JSON.parse(getItem(KEY));
      return data && typeof data === "object" && !Array.isArray(data) ? data : {};
    } catch (e) {
      return {};
    }
  }
  const save = map => setItem(KEY, JSON.stringify(map));

  // 3 stars = no mistakes, 2 stars = at least 70% right, 1 star = you finished
  function starsFor(score, total) {
    if (!total) return 1;
    if (score === total) return 3;
    return score / total >= 0.7 ? 2 : 1;
  }

  // the better result wins; a worse attempt never lowers what you earned
  function better(a, b) {
    if (!a) return b;
    if (!b) return a;
    const ra = a.best / a.total, rb = b.best / b.total;
    const winner = (b.stars > a.stars || (b.stars === a.stars && rb > ra)) ? b : a;
    return Object.assign({}, winner, { at: Math.max(a.at || 0, b.at || 0) });
  }

  function mergeInto(map, incoming) {
    Object.keys(incoming || {}).forEach(id => { map[id] = better(map[id], incoming[id]); });
    return map;
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

  let signedIn = false;
  let chain = Promise.resolve();

  function syncUp() {
    return api("POST", "/api/progress/merge", { lessons: load() }).then(out => {
      save(mergeInto(load(), out.lessons));
    });
  }

  /// called when a lesson is finished
  function record(lessonId, score, total) {
    if (!lessonId || !(total > 0)) return null;
    const result = { stars: starsFor(score, total), best: score, total, at: Date.now() };
    const map = load();
    const before = map[lessonId];
    map[lessonId] = better(before, result);
    save(map);
    if (signedIn) chain = chain.then(syncUp).catch(() => { /* kept locally; sent on the next visit */ });
    return { stars: result.stars, bestStars: map[lessonId].stars, isNewBest: !before || result.stars > before.stars };
  }

  const all = load;
  const stars = id => (load()[id] || { stars: 0 }).stars;

  const ready = (window.FC && FC.ready ? FC.ready : Promise.resolve()).then(async () => {
    const me = window.FC && FC.me ? FC.me() : { signedIn: false };
    signedIn = !!me.signedIn;
    const owner = getItem(OWNER_KEY);
    if (signedIn) {
      const id = String(me.id);
      if (owner && owner !== "anon" && owner !== id) save({});     // someone else's copy: drop it
      try {
        await syncUp();                                              // adds ours, takes the server's best
        setItem(OWNER_KEY, id);
      } catch (e) { /* offline: keep working locally */ }
    } else {
      // signed out: a copy that belonged to an account isn't ours any more,
      // unless we're just offline (then that account's copy is still the right one)
      const offlineButKnown = window.FC && FC.canSave && FC.canSave();
      if (owner && owner !== "anon" && !offlineButKnown) {
        save({});
        setItem(OWNER_KEY, "anon");
      } else if (!owner) {
        setItem(OWNER_KEY, "anon");
      }
    }
  });

  /// home page: checkmarks, stars, Continue button, words learned
  function decorateHome() {
    const list = document.getElementById("lesson-list");
    if (!list) return;
    const map = all();
    let words = 0, done = 0, next = null;
    const items = Array.from(list.querySelectorAll("li[data-lesson]"));

    items.forEach(li => {
      const p = map[li.dataset.lesson];
      const badge = li.querySelector(".lesson-stars");
      if (p) {
        done++;
        words += Number(li.dataset.words) || 0;
        badge.textContent = "★".repeat(p.stars) + "☆".repeat(3 - p.stars);
        badge.setAttribute("aria-label", p.stars + " of 3 stars");
        li.classList.add("done");
      } else {
        badge.textContent = "";
        li.classList.remove("done");
        const locked = li.dataset.locked === "1" && !signedIn;
        if (!next && !locked) next = li;        // first unfinished lesson that can be opened
      }
    });

    const box = document.getElementById("continue-box");
    if (!box) return;
    box.innerHTML = "";
    if (next) {
      const a = document.createElement("a");
      a.className = "continue-btn";
      a.href = next.querySelector("a").getAttribute("href");
      a.textContent = (done ? "Continue: " : "Start: ") + next.dataset.title;
      box.appendChild(a);
    } else if (items.length && done === items.length) {
      box.textContent = "🎉 You finished every lesson!";
    } else if (items.length) {
      box.textContent = "Sign in to unlock the next lessons.";   // only locked lessons are left
    }
    const stats = document.getElementById("stats");
    if (stats) {
      stats.textContent = done ? done + (done === 1 ? " lesson" : " lessons") + " done · " + words + " words learned" : "";
    }
  }

  ready.then(decorateHome);
  document.addEventListener("DOMContentLoaded", decorateHome);   // show local progress right away

  return { record, all, stars, starsFor, ready };
})();
