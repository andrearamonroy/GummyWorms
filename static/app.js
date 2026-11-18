let frVoice = null;

function loadVoice() {
  frVoice = speechSynthesis.getVoices()
    .find(v => v.lang.startsWith("fr")) || null;
}

loadVoice();
speechSynthesis.addEventListener("voiceschanged", loadVoice);

function speak(text, rate = 1) {
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "fr-FR";
  u.rate = rate;
  if (frVoice) u.voice = frVoice;
  speechSynthesis.speak(u);
}

document.querySelectorAll(".card").forEach(card => {
  card.addEventListener("click", () => speak(card.dataset.fr));
});

const exerciseBox = document.getElementById("exercise");
const feedback = document.getElementById("feedback");

function renderExercise(ex) {
  exerciseBox.innerHTML = "";
  feedback.textContent = "";
  if (ex.type === "multiple_choice") renderMultipleChoice(ex);
  else if (ex.type === "word_bank") renderWordBank(ex);
  else if (ex.type === "matching") renderMatching(ex);
}

/// multiple choice
function renderMultipleChoice(ex) {
  const prompt = document.createElement("p");
  prompt.textContent = ex.prompt;
  exerciseBox.appendChild(prompt);

  if (ex.speak) {
    //normal
    const listen = document.createElement("button");
    listen.className = "listen";
    listen.textContent = "🔊 Listen";
    listen.addEventListener("click", () => speak(ex.speak));

    //listen slow
    const slow = document.createElement("button");
    slow.className = "listen";
    slow.textContent = "🐢 Slow";
    slow.addEventListener("click", () => speak(ex.speak, 0.6));

    exerciseBox.append(listen, slow);
  }

  shuffle(ex.choices.slice()).forEach(choice => {
    const btn = document.createElement("button");
    btn.className = "choice";
    btn.textContent = choice;
    btn.addEventListener("click", () => checkChoice(ex, btn));
    exerciseBox.appendChild(btn);
  });
    if (ex.speak) setTimeout(() => speak(ex.speak), 300);   // plays by itself; 🔊 Listen and 🐢 Slow still replay it
}


function checkChoice(ex, clicked) {
  const buttons = exerciseBox.querySelectorAll(".choice");
  buttons.forEach(b => {
    b.disabled = true;
    if (b.textContent === ex.answer) b.classList.add("correct");
  });

  const correct = clicked.textContent === ex.answer;

  if (correct) {
    feedback.textContent = "Correct!";
  } else {
    clicked.classList.add("wrong");
    feedback.textContent = "Not quite. The answer is " + ex.answer + ".";
  }
  answered(correct);
}

/// word bank
function renderWordBank(ex) {
  const prompt = document.createElement("p");
  prompt.textContent = ex.prompt;

  const sentenceLabel = document.createElement("p");
  sentenceLabel.textContent = "Your sentence:";

  const answerArea = document.createElement("div");
  answerArea.className = "answer-area";

  const bankLabel = document.createElement("p");
  bankLabel.textContent = "Word bank:";

  const bankArea = document.createElement("div");
  bankArea.className = "bank-area";

  const checkBtn = document.createElement("button");
  checkBtn.textContent = "Check";

  exerciseBox.append(prompt, sentenceLabel, answerArea, bankLabel, bankArea, checkBtn);

  let chosen = [];

  function makeTile(index, onClick) {
    const tile = document.createElement("button");
    tile.className = "tile";
    tile.textContent = ex.bank[index];
    tile.addEventListener("click", () => {
      speak(ex.bank[index]);
      onClick();
    });
    return tile;
  }

  function redraw() {
    answerArea.innerHTML = "";
    bankArea.innerHTML = "";

    if (chosen.length === 0) {
      answerArea.textContent = "Tap the words below…";
    }

    chosen.forEach(index => {
      answerArea.appendChild(makeTile(index, () => {
        chosen = chosen.filter(i => i !== index);
        redraw();
      }));
    });

    ex.bank.forEach((word, index) => {
      if (chosen.includes(index)) return;
      bankArea.appendChild(makeTile(index, () => {
        chosen.push(index);
        redraw();
      }));
    });
  }

  checkBtn.addEventListener("click", () => checkWordBank(ex, chosen));
  redraw();
}

function checkWordBank(ex, chosen) {
  const attempt = chosen.map(i => ex.bank[i]).join(" ").toLowerCase();
  const target = ex.answer.join(" ").toLowerCase();
  const correct = attempt === target;

  exerciseBox.querySelectorAll("button").forEach(b => b.disabled = true);

  if (correct) {
    feedback.textContent = "Correct!";
  } else {
    feedback.textContent = "Not quite. The answer is " + ex.answer.join(" ") + ".";
  }
  answered(correct);
}

/// matching
function renderMatching(ex) {
  const prompt = document.createElement("p");
  prompt.textContent = ex.prompt;

  const board = document.createElement("div");
  board.className = "match-board";
  const leftCol = document.createElement("div");
  const rightCol = document.createElement("div");
  leftCol.className = "match-col";
  rightCol.className = "match-col";
  board.append(leftCol, rightCol);
  exerciseBox.append(prompt, board);

  let picked = null;
  let mistakes = 0;
  let matched = 0;

  function checkPair(a, b) {
    a.b.classList.remove("picked");
    if (a.pair === b.pair) {
      [a.b, b.b].forEach(x => {
        x.classList.add("matched");
        x.disabled = true;
      });
      matched++;
      if (window.FX) FX.pop();
      if (matched === ex.pairs.length) {
        feedback.textContent = mistakes === 0 ? "Perfect!" : "All matched!";
        answered(mistakes === 0);
      }
    } else {
      mistakes++;
      if (window.FX) FX.buzz();
      [a.b, b.b].forEach(x => x.classList.add("wrong"));
      setTimeout(() => {
        [a.b, b.b].forEach(x => x.classList.remove("wrong"));
      }, 500);
    }
  }

  function makeBtn(text, pair, side) {
    const b = document.createElement("button");
    b.className = "match-btn";
    b.textContent = text;
    b.addEventListener("click", () => {
        speak(pair.right); //both tiles say the french word
        if (b.classList.contains("matched")) return; //tiles only replay the sound

      if (picked && picked.b === b) {          // same tile again: unpick
        b.classList.remove("picked");
        picked = null;
        return;
      }
      if (picked && picked.side === side) {    // another tile in the same column
        picked.b.classList.remove("picked");
        picked = null;
      }
      if (!picked) {                           // first pick
        picked = { b, pair, side };
        b.classList.add("picked");
        return;
      }
      checkPair(picked, { b, pair, side });    // second pick, other column
      picked = null;
    });
    return b;
  }

  const shuffled = [...ex.pairs].sort(() => Math.random() - 0.5);
  ex.pairs.forEach(p => leftCol.appendChild(makeBtn(p.left, p, "left")));
  shuffled.forEach(p => rightCol.appendChild(makeBtn(p.right, p, "right")));
}

///flow controller
const progress = document.getElementById("progress");
let currentIndex = 0;
let score = 0;
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
shuffle(EXERCISES);                 // new order every time you open the lesson

/// worm progress bar
const worm = document.getElementById("worm");
const fill = document.getElementById("fill");
const MAX_STEPS = Number(progress.dataset.max);
const WALK_MS = 1400;
//worm width 
const apple = document.getElementById("apple");
const WORM_W = worm.offsetWidth || 120;      // read from the CSS, so only the CSS needs changing
const TRAVEL = (WORM_W + (apple.offsetWidth || 64) - 4) + "px";
//end of worm width
const stretchSrc = worm.dataset.stretch;
const humpSrc = worm.dataset.hump;
new Image().src = humpSrc;              // preload so the swap doesn't flicker
let frameTimer = null;
let stopTimer = null;

function stopWalking() {
  clearInterval(frameTimer);
  worm.src = stretchSrc;
}

function setProgress(step, instant = false) {
  const frac = step / MAX_STEPS;
  worm.style.transition = fill.style.transition = instant ? "none" : "";
  worm.style.left = "calc((100% - " + TRAVEL + ") * " + frac + ")";
    fill.style.width = frac === 0 ? "0px" : "calc((100% - " + TRAVEL + ") * " + frac + " + " + WORM_W + "px)";

  clearInterval(frameTimer);
  clearTimeout(stopTimer);
  if (instant) { worm.src = stretchSrc; return; }

  let hump = true;
  worm.src = humpSrc;
  frameTimer = setInterval(() => {
    hump = !hump;
    worm.src = hump ? humpSrc : stretchSrc;
  }, WALK_MS / 6);
  stopTimer = setTimeout(stopWalking, WALK_MS);
}



const vocabSection = document.getElementById("vocab-section");
const practice = document.getElementById("practice");

const tipsSection = document.getElementById("tips-section");   // null if the lesson has no tips
const OFFSET = tipsSection ? 1 : 0;                            // extra bar step when tips exist

function startPractice() {
  practice.hidden = false;
  window.scrollTo(0, 0);
  showExercise();
}

document.getElementById("vocab-continue").addEventListener("click", () => {
  vocabSection.hidden = true;
    setProgress(1);

  window.scrollTo(0, 0);
  if (tipsSection) {
    tipsSection.hidden = false;
  } else {
    startPractice();
  }
});

if (tipsSection) {
  document.getElementById("tips-continue").addEventListener("click", () => {
    tipsSection.hidden = true;
    setProgress(2);
    startPractice();
  });
}

function showExercise(){
    if (currentIndex >= EXERCISES.length) {
        showResults();
        return;
    }
    renderExercise(EXERCISES[currentIndex]);
}

function answered(correct){
    if (correct) score++;
    if (window.FX) FX.result(correct, EXERCISES[currentIndex].type, feedback);
    setProgress(currentIndex + 2 + OFFSET);

    const next = document.createElement("button");
    const isLast = currentIndex === EXERCISES.length -1;
    next.textContent = isLast ? "Finish" : "Continue";
    next.addEventListener("click", () => {
        currentIndex++;
        showExercise();
    });
    exerciseBox.appendChild(next);   
}

function showResults(){
    exerciseBox.innerHTML = "";
    feedback.textContent= "";

    const result = document.createElement("p");
    result.textContent = "Lesson Complete! Score: " +  score + " / " + EXERCISES.length;

    const again = document.createElement("button");
    again.textContent = "Try again";
    again.className = "again-btn";
    again.addEventListener("click", () => {
        currentIndex = 0;
        score = 0;
        shuffle(EXERCISES);
        setProgress(1 + OFFSET, true);
        showExercise();

    });

    const starLine = document.createElement("p");
    starLine.className = "result-stars";
    if (window.GW) {
        const earned = GW.record(LESSON_ID, score, EXERCISES.length);
        const n = GW.starsFor(score, EXERCISES.length);
        starLine.textContent = "★".repeat(n) + "☆".repeat(3 - n) + (earned && earned.isNewBest ? "  New best!" : "");
    }

    exerciseBox.append(result,starLine, again);

    if (typeof NEXT_LESSON !== "undefined" && NEXT_LESSON) {
        const nextLink = document.createElement("a");
        nextLink.className = "continue-btn";
        nextLink.href = "/lesson/" + NEXT_LESSON.id;
        nextLink.textContent = "Next: " + NEXT_LESSON.title;
        exerciseBox.append(nextLink);
    }
    if (window.FX) FX.celebrate();
}