"use strict";

(function () {
  const el = FC.el;
  const $ = id => document.getElementById(id);

  const views = { gate: $("gate-view"), sets: $("sets-view"), edit: $("edit-view"), study: $("study-view") };
  let currentSetId = null;

  function show(name) {
    Object.keys(views).forEach(k => { views[k].hidden = k !== name; });
    window.scrollTo(0, 0);
  }

  function currentSet() {
    return FC.loadSets().find(s => s.id === currentSetId);
  }

  /// 1. list of sets
  function renderSets() {
    const list = $("set-list");
    list.innerHTML = "";
    const sets = FC.loadSets();
    if (!sets.length) {
      list.appendChild(el("p", "lead", "No sets yet. Create one below, or tap ＋ on any lesson card to save it."));
    }
    sets.forEach(s => {
      const row = el("div", "set-row");
      const info = el("div");
      info.append(
        el("div", "name", s.name),
        el("div", "meta", s.cards.length + (s.cards.length === 1 ? " card" : " cards"))
      );
      const open = el("button", "primary", "Open");
      open.type = "button";
      open.addEventListener("click", () => openSet(s.id));
      row.append(info, open);
      list.appendChild(row);
    });
  }

  $("new-set-form").addEventListener("submit", e => {
    e.preventDefault();
    const input = $("new-set-name");
    const set = FC.createSet(input.value);
    if (!set) { input.focus(); return; }
    input.value = "";
    openSet(set.id);
  });

  /// 2. one set: its cards and the add form
  function openSet(id) {
    currentSetId = id;
    renderEdit();
    show("edit");
  }

  function renderEdit() {
    const set = currentSet();
    if (!set) { renderSets(); show("sets"); return; }

    $("edit-title").textContent = set.name;
    $("study-btn").disabled = set.cards.length === 0;
    $("add-msg").textContent = "";

    const list = $("card-list");
    list.innerHTML = "";
    if (!set.cards.length) {
      list.appendChild(el("p", "lead", "No cards yet. Add one below, or save words and rules from a lesson."));
    }

    set.cards.forEach(c => {
      const row = el("div", "card-row");
      const text = el("div", "text");
      let lead;

      if (c.kind === "rule") {
        lead = el("span", "badge", "Rule");
        text.append(el("div", "fr", c.title), el("div", "en", c.text));
      } else {
        lead = el("button", "", "🔊");
        lead.type = "button";
        lead.setAttribute("aria-label", "Hear " + c.fr);
        lead.addEventListener("click", () => FC.speak(c.fr));
        text.append(el("div", "fr", c.fr), el("div", "en", c.en + (c.note ? " · " + c.note : "")));
      }

      const del = el("button", "", "✕");
      del.type = "button";
      del.setAttribute("aria-label", "Delete this card");
      del.addEventListener("click", () => {
        FC.removeCard(set.id, c.id);
        renderEdit();
      });

      row.append(lead, text, del);
      list.appendChild(row);
    });
  }

  $("add-form").addEventListener("submit", e => {
    e.preventDefault();
    const fr = $("add-fr"), en = $("add-en"), note = $("add-note");
    if (!fr.value.trim() || !en.value.trim()) {
      $("add-msg").textContent = "Add both the French and the translation.";
      return;
    }
    const r = FC.addCards(currentSetId, [{ kind: "word", fr: fr.value, en: en.value, note: note.value }]);
    if (r.failed) {
      $("add-msg").textContent = "Couldn’t save. Is the browser blocking storage?";
    } else if (!r.added) {
      $("add-msg").textContent = "That card is already in this set.";
    } else {
      fr.value = en.value = note.value = "";
      renderEdit();
      fr.focus();
    }
  });

  $("back-to-sets").addEventListener("click", () => { renderSets(); show("sets"); });

  $("delete-set").addEventListener("click", () => {
    const set = currentSet();
    if (set && confirm("Delete “" + set.name + "” and its " + set.cards.length + " cards?")) {
      FC.deleteSet(set.id);
      renderSets();
      show("sets");
    }
  });

  /// 3. study session
  let queue = [];
  let total = 0;
  let revealed = false;
  let side = "fr";

  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function startStudy() {
    const set = currentSet();
    if (!set || !set.cards.length) return;
    side = $("front-side").value;
    queue = shuffle(set.cards.slice());
    total = queue.length;
    $("study-set-name").textContent = set.name;
    $("study-main").hidden = false;
    $("study-done").hidden = true;
    show("study");
    nextCard();
  }

  function nextCard() {
    $("study-bar").max = total;
    $("study-bar").value = total - queue.length;
    if (!queue.length) { finishStudy(); return; }
    revealed = false;
    renderStudyCard();
    const c = queue[0];
    if (c.kind === "word" && side === "fr") FC.speak(c.fr);   // French first: say it as it appears
  }

  function renderStudyCard() {
    const c = queue[0];
    const card = $("study-card");
    card.innerHTML = "";

    if (c.kind === "rule") {
      if (!revealed) {
        card.append(el("span", "study-big", c.title));
        card.append(el("span", "study-hint", "Think of the rule, then tap the card"));
      } else {
        card.append(el("span", "study-sub", c.text));
        card.append(el("span", "study-hint", "Tap the card to flip back"));
      }
    } else {
      card.append(el("span", "study-big", frenchShowing() ? c.fr : c.en));
      if (revealed && c.note) card.append(el("span", "study-hint", c.note));
      card.append(el("span", "study-hint", frenchShowing() ? "Tap the card to flip · 🔊 plays when French shows" : "Tap the card to flip"));
    }

    const ex = $("rule-examples");
    ex.innerHTML = "";
    if (c.kind === "rule" && revealed) {
      c.examples.forEach(e => {
        const row = el("div", "example-row");
        const b = el("button", "", "🔊 " + e.fr);
        b.type = "button";
        b.addEventListener("click", () => FC.speak(e.fr));
        const detail = (e.formula ? e.formula + " = " : "") + e.en;
        row.append(b, el("span", "example-detail", detail));
        ex.appendChild(row);
      });
    }

    $("next-btn").textContent = queue.length === 1 ? "Finish" : "Next";
  }

  // French is on the card: the front when "French first", the back when "translation first"
  function frenchShowing() {
    return side === "fr" ? !revealed : revealed;
  }

  // tap the card to flip it to the other side (and back)
  $("study-card").addEventListener("click", () => {
    const c = queue[0];
    if (!c) return;
    revealed = !revealed;
    renderStudyCard();
    if (c.kind === "word" && frenchShowing()) FC.speak(c.fr);
  });

  $("next-btn").addEventListener("click", () => {
    queue.shift();
    nextCard();
  });

  function finishStudy() {
    $("study-main").hidden = true;
    $("study-done").hidden = false;
    $("done-text").textContent = total + (total === 1 ? " card" : " cards") + " done.";
  }

  $("study-btn").addEventListener("click", startStudy);
  $("again-session").addEventListener("click", startStudy);
  $("back-to-set").addEventListener("click", () => openSet(currentSetId));
  $("quit-btn").addEventListener("click", () => openSet(currentSetId));

  // wait until we know who is signed in: flashcards need an account
  FC.ready.then(() => {
    $("loading").hidden = true;
    if (!FC.canSave()) {
      $("gate-signin").href = FC.loginUrl();
      show("gate");
    } else {
      renderSets();
      show("sets");
    }
  });
})();