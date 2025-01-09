/********************************************************
 * app.js - Advanced Metronome with Speed Trainer & BPM Monitor
 *******************************************************/

// DOM references
const currentBpmMonitor = document.getElementById("currentBpmMonitor");
const beatsPerMeasureInput = document.getElementById("beatsPerMeasure");
const toggleBtn = document.getElementById("toggleBtn");

const sequencerContainer = document.getElementById("sequencerContainer");
const accentsContainer = document.getElementById("accentsContainer");

// Mode elements
const modeSelect = document.getElementById("modeSelect");
const constantControls = document.getElementById("constantControls");
const constantBpmInput = document.getElementById("constantBpmInput");

const byMeasuresControls = document.getElementById("byMeasuresControls");
const startBpmInput = document.getElementById("startBpmInput");
const endBpmInput = document.getElementById("endBpmInput");
const increaseEveryInput = document.getElementById("increaseEveryInput");
const increaseByInput = document.getElementById("increaseByInput");

// AudioContext
let audioContext = null;

// State & scheduling
let isPlaying = false;
let lookahead = 25.0;         // ms: how often we call the scheduler
let scheduleAheadTime = 0.2;  // sec: how far ahead we schedule audio
let nextNoteTime = 0.0;
let timerID = null;

// Beat tracking
let beatIndex = 0;
let beatsPerMeasure = 4;

let beats = [];        // array of .beat divs
let accentStates = []; // boolean accent array

/********************************************************
 *  RENDER / INIT
 *******************************************************/

function renderSequencer(numBeats) {
  sequencerContainer.innerHTML = "";
  accentsContainer.innerHTML = "";

  // Build new accent state array
  const newAccentStates = [];
  for (let i = 0; i < numBeats; i++) {
    newAccentStates[i] = accentStates[i] || false;
  }
  accentStates = newAccentStates;

  // Create beat divs
  for (let i = 0; i < numBeats; i++) {
    const beatDiv = document.createElement("div");
    beatDiv.classList.add("beat");
    beatDiv.id = `beat-${i + 1}`;
    beatDiv.textContent = i + 1;
    sequencerContainer.appendChild(beatDiv);
  }
  beats = Array.from(document.querySelectorAll(".beat"));

  // Create accent checkboxes
  for (let i = 0; i < numBeats; i++) {
    const accentBlock = document.createElement("div");
    accentBlock.classList.add("accent-block");

    const label = document.createElement("label");
    label.textContent = `B${i + 1}`;

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = accentStates[i];
    checkbox.addEventListener("change", () => {
      accentStates[i] = checkbox.checked;
    });

    accentBlock.appendChild(label);
    accentBlock.appendChild(checkbox);
    accentsContainer.appendChild(accentBlock);
  }
}

function init() {
  modeSelect.addEventListener("change", updateModeUI);

  // Rerender if beats/measure changes
  beatsPerMeasureInput.addEventListener("change", () => {
    const newValue = parseInt(beatsPerMeasureInput.value, 10);
    if (newValue >= 1 && newValue <= 24) {
      beatsPerMeasure = newValue;
      renderSequencer(beatsPerMeasure);
    }
  });

  // Initial
  updateModeUI();
  renderSequencer(beatsPerMeasure);

  currentBpmMonitor.value = "120"; // default
}

// Show/hide constant or byMeasures controls
function updateModeUI() {
  if (modeSelect.value === "constant") {
    constantControls.style.display = "block";
    byMeasuresControls.style.display = "none";
    currentBpmMonitor.value = constantBpmInput.value;
  } else {
    constantControls.style.display = "none";
    byMeasuresControls.style.display = "block";
    currentBpmMonitor.value = startBpmInput.value;
  }
}

init();

/********************************************************
 *  METRONOME LOGIC
 *******************************************************/

let bpmLevels = [];
let totalMeasures = 0;
let currentBpmIndex = 0;
let measuresAtThisBpm = 0;
let measureCount = 0;

function startMetronome() {
  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (isPlaying) return;

  isPlaying = true;
  nextNoteTime = audioContext.currentTime;
  beatIndex = 0;
  measuresAtThisBpm = 0;
  measureCount = 0;
  currentBpmIndex = 0;

  beatsPerMeasure = parseInt(beatsPerMeasureInput.value, 10) || 4;
  clearHighlights();

  if (modeSelect.value === "constant") {
    setupConstantMode();
  } else {
    setupByMeasures();
  }

  scheduler();
  timerID = setInterval(scheduler, lookahead);
  toggleBtn.textContent = "Stop";
}

function setupConstantMode() {
  const cBpm = parseInt(constantBpmInput.value, 10) || 120;
  bpmLevels = [cBpm];
  totalMeasures = Number.POSITIVE_INFINITY;
  currentBpmMonitor.value = cBpm.toString();
}

function setupByMeasures() {
  const startBpm = parseInt(startBpmInput.value, 10) || 80;
  const endBpm = parseInt(endBpmInput.value, 10) || 100;
  const incEvery = parseInt(increaseEveryInput.value, 10) || 8;
  const incBy = parseInt(increaseByInput.value, 10) || 5;

  bpmLevels = [];
  let current = startBpm;
  while (true) {
    bpmLevels.push(current);
    if (current >= endBpm) {
      break;
    }
    current += incBy;
    if (current > endBpm) {
      current = endBpm;
    }
  }
  totalMeasures = bpmLevels.length * incEvery;
  currentBpmMonitor.value = startBpm.toString();
}

function stopMetronome() {
  if (!isPlaying) return;
  isPlaying = false;

  clearInterval(timerID);
  timerID = null;
  clearHighlights();
  toggleBtn.textContent = "Start";
}

function scheduler() {
  while (nextNoteTime < audioContext.currentTime + scheduleAheadTime) {
    scheduleBeat(beatIndex, nextNoteTime);
    const bpm = getCurrentBpm();
    nextNoteTime += 60.0 / bpm;

    // update monitor
    currentBpmMonitor.value = bpm.toString();

    beatIndex = (beatIndex + 1) % beatsPerMeasure;
    if (beatIndex === 0) {
      onMeasureComplete();
      if (!isPlaying) break;
    }
  }
}

function scheduleBeat(beatIdx, time) {
  const osc = audioContext.createOscillator();
  const gainNode = audioContext.createGain();

  // Accent freq
  if (accentStates[beatIdx]) {
    osc.frequency.value = 880;
  } else {
    osc.frequency.value = 440;
  }
  osc.connect(gainNode);
  gainNode.connect(audioContext.destination);

  osc.start(time);
  osc.stop(time + 0.1);

  // Visual highlight
  const timeUntilBeat = (time - audioContext.currentTime) * 1000;
  setTimeout(() => {
    highlightBeat(beatIdx);
  }, timeUntilBeat);
}

function onMeasureComplete() {
  measureCount++;
  if (modeSelect.value === "byMeasures") {
    measuresAtThisBpm++;
    if (measureCount >= totalMeasures) {
      stopMetronome();
      return;
    }
    const incEvery = parseInt(increaseEveryInput.value, 10) || 8;
    if (measuresAtThisBpm >= incEvery) {
      currentBpmIndex++;
      measuresAtThisBpm = 0;
    }
  }
}

function getCurrentBpm() {
  return bpmLevels[currentBpmIndex];
}

/********************************************************
 *  VISUAL
 *******************************************************/

function highlightBeat(idx) {
  clearHighlights();
  if (beats[idx]) {
    beats[idx].classList.add("active");
  }
}

function clearHighlights() {
  beats.forEach((b) => b.classList.remove("active"));
}

/********************************************************
 *  TOGGLE
 *******************************************************/

toggleBtn.addEventListener("click", () => {
  if (!isPlaying) {
    startMetronome();
  } else {
    stopMetronome();
  }
});
