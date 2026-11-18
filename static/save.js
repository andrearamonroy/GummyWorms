"use strict";

// Runs on lesson pages only: connects the ＋ buttons to the "Save to a set" popup.
(function () {
  function ruleFromTip(tip) {
    return {
      kind: "rule",
      title: tip.title,
      text: tip.text,
      examples: (tip.examples || []).map(ex => ({
        fr: ex.result.fr,
        en: ex.result.en,
        formula: ex.parts.map(p => p.fr + " (" + p.en + ")").join(" " + (ex.op || "+") + " ")
      }))
    };
  }

  // one word
  document.querySelectorAll(".save-word").forEach(btn => {
    btn.addEventListener("click", () => {
      FC.openPicker(
        [{ kind: "word", fr: btn.dataset.fr, en: btn.dataset.en, note: "" }],
        btn.dataset.fr + " · " + btn.dataset.en
      );
    });
  });

  // every word in the lesson
  const saveAll = document.getElementById("save-all");
  if (saveAll) {
    saveAll.addEventListener("click", () => {
      const cards = VOCAB.map(w => ({ kind: "word", fr: w.fr, en: w.en, note: "" }));
      FC.openPicker(cards, "All " + cards.length + " words from this lesson");
    });
  }

  // a rule from the tips step
  document.querySelectorAll(".save-rule").forEach(btn => {
    const tip = JSON.parse(btn.dataset.rule);
    btn.addEventListener("click", () => FC.openPicker([ruleFromTip(tip)], tip.title));
  });
})();
