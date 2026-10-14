/**
 * WorkOut Timer Pro - app.js
 *
 * Features:
 * - Stage types: Countdown, Tabata (Work/Rest sets), Lap Time (Count Up)
 * - Web Audio API beep sounds (3-beep warning + finish tone)
 * - Color visualization: work=green, rest=red, wait=gray
 * - LocalStorage routine save/load
 * - Responsive, fully keyboard-accessible
 */

'use strict';

/* =============================================
   AUDIO ENGINE (Web Audio API – no files needed)
   ============================================= */
const AudioEngine = (() => {
  let ctx = null;

  function getCtx() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    return ctx;
  }

  function beep(freq = 880, duration = 0.12, gain = 0.5, type = 'sine', delay = 0) {
    const ac = getCtx();
    const osc = ac.createOscillator();
    const gainNode = ac.createGain();
    osc.connect(gainNode);
    gainNode.connect(ac.destination);

    osc.type = type;
    osc.frequency.value = freq;
    gainNode.gain.setValueAtTime(0, ac.currentTime + delay);
    gainNode.gain.linearRampToValueAtTime(gain, ac.currentTime + delay + 0.01);
    gainNode.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + delay + duration);

    osc.start(ac.currentTime + delay);
    osc.stop(ac.currentTime + delay + duration + 0.05);
  }

  return {
    // 3 short beeps: 삐 삐 삐 (warning before end)
    playWarning() {
      beep(880, 0.1, 0.4, 'sine', 0.0);
      beep(880, 0.1, 0.4, 'sine', 0.25);
      beep(880, 0.1, 0.4, 'sine', 0.50);
    },

    // Long descending tone: 삐이- (transition/finish)
    playFinish() {
      beep(660, 0.5, 0.5, 'triangle', 0.0);
    },

    // Short click on button actions
    playClick() {
      beep(440, 0.05, 0.2, 'square', 0);
    },

    resume() {
      if (ctx && ctx.state === 'suspended') ctx.resume();
    }
  };
})();

/* =============================================
   STATE
   ============================================= */
const state = {
  stages: [],           // Array of stage configs
  currentStageIdx: -1,  // Which stage is running
  currentPhase: 'idle', // 'idle' | 'wait' | 'work' | 'rest'
  currentLap: 0,        // For tabata / laptime
  timeLeft: 0,          // Seconds remaining (countdown) or elapsed (laptime)
  running: false,
  intervalId: null,
  totalTime: 0,         // For SVG progress
};

/* =============================================
   DOM REFS
   ============================================= */
const $ = id => document.getElementById(id);

const DOM = {
  stageList:        $('stage-list'),
  stageEmptyMsg:    $('stage-empty-msg'),
  btnAddStage:      $('btn-add-stage'),
  btnSaveRoutine:   $('btn-save-routine'),
  btnLoadRoutine:   $('btn-load-routine'),

  // Timer
  timerDisplay:     $('timer-display'),
  statusBar:        $('timer-status-bar'),
  statusLabel:      $('status-label'),
  stageCounter:     $('stage-counter'),
  stageNameDisplay: $('stage-name-display'),
  stageTypeBadge:   $('stage-type-badge'),
  lapCountDisplay:  $('lap-count-display'),
  svgProgress:      $('svg-progress'),
  timerCircleWrap:  $('timer-circle-wrap'),

  // Controls
  btnStartPause:    $('btn-start-pause'),
  btnNextStage:     $('btn-next-stage'),
  btnPrev:          $('btn-prev'),
  btnStop:          $('btn-stop'),

  // Modal Add
  modalAdd:         $('modal-add-stage'),
  modalClose:       $('modal-close'),
  modalCancel:      $('modal-cancel'),
  modalConfirm:     $('modal-confirm'),
  inputStageName:   $('input-stage-name'),
  typeBtns:         document.querySelectorAll('.type-btn'),
  optsCountdown:    $('opts-countdown'),
  optsTabata:       $('opts-tabata'),
  optsLaptime:      $('opts-laptime'),

  cdWorkTime:   $('cd-work-time'),
  cdRestTime:   $('cd-rest-time'),
  cdWaitTime:   $('cd-wait-time'),
  tbWorkTime:   $('tb-work-time'),
  tbRestTime:   $('tb-rest-time'),
  tbSets:       $('tb-sets'),
  tbWaitTime:   $('tb-wait-time'),
  ltLaps:       $('lt-laps'),
  ltWaitTime:   $('lt-wait-time'),

  // Modal Load
  modalLoad:        $('modal-load-routine'),
  loadModalClose:   $('load-modal-close'),
  loadModalCancel:  $('load-modal-cancel'),
  routineList:      $('routine-list'),
  noRoutinesMsg:    $('no-routines-msg'),

  // Toast
  toast:            $('toast'),

  // Recommend
  recBtns: document.querySelectorAll('.recommend-item'),
};

/* =============================================
   STAGE LIST RENDERING
   ============================================= */
function renderStageList() {
  DOM.stageList.innerHTML = '';

  if (state.stages.length === 0) {
    DOM.stageEmptyMsg.classList.add('visible');
    return;
  }
  DOM.stageEmptyMsg.classList.remove('visible');

  state.stages.forEach((stage, idx) => {
    const li = document.createElement('li');
    li.className = 'stage-item' + (idx === state.currentStageIdx ? ' active' : '');
    li.dataset.idx = idx;

    const typeTagClass = { countdown: 'tag-countdown', tabata: 'tag-tabata', laptime: 'tag-laptime' }[stage.type];
    const typeLabel    = { countdown: 'COUNT DOWN', tabata: 'TABATA', laptime: 'LAP TIME' }[stage.type];

    let metaText = '';
    if (stage.type === 'countdown') {
      metaText = `운동 ${stage.workTime}초 / 휴식 ${stage.restTime}초 / 대기 ${stage.waitTime}초`;
    } else if (stage.type === 'tabata') {
      metaText = `${stage.workTime}초 운동 · ${stage.restTime}초 휴식 × ${stage.sets}세트`;
    } else if (stage.type === 'laptime') {
      metaText = `${stage.laps}랩`;
    }

    li.innerHTML = `
      <div class="stage-num">${idx + 1}</div>
      <div class="stage-info">
        <div class="stage-name">${escHtml(stage.name)}</div>
        <div class="stage-meta">${metaText}</div>
      </div>
      <span class="stage-type-tag ${typeTagClass}">${typeLabel}</span>
      <button class="stage-del-btn" data-idx="${idx}" aria-label="스테이지 삭제" title="삭제">✕</button>
    `;

    li.addEventListener('click', (e) => {
      if (e.target.classList.contains('stage-del-btn')) return;
      jumpToStage(idx);
    });

    li.querySelector('.stage-del-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      deleteStage(idx);
    });

    DOM.stageList.appendChild(li);
  });
}

/* =============================================
   MODAL: Add Stage
   ============================================= */
let selectedType = 'countdown';

function openAddModal() {
  selectedType = 'countdown';
  DOM.inputStageName.value = '';
  DOM.typeBtns.forEach(b => {
    b.classList.toggle('active', b.dataset.type === 'countdown');
    b.setAttribute('aria-checked', b.dataset.type === 'countdown' ? 'true' : 'false');
  });
  showTypeOpts('countdown');
  DOM.modalAdd.removeAttribute('hidden');
  DOM.inputStageName.focus();
}

function closeAddModal() {
  DOM.modalAdd.setAttribute('hidden', '');
}

function showTypeOpts(type) {
  DOM.optsCountdown.hidden = (type !== 'countdown');
  DOM.optsTabata.hidden    = (type !== 'tabata');
  DOM.optsLaptime.hidden   = (type !== 'laptime');
}

DOM.btnAddStage.addEventListener('click', () => {
  AudioEngine.resume();
  openAddModal();
});

DOM.modalClose.addEventListener('click',  closeAddModal);
DOM.modalCancel.addEventListener('click', closeAddModal);
DOM.modalAdd.addEventListener('click', (e) => {
  if (e.target === DOM.modalAdd) closeAddModal();
});

DOM.typeBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    selectedType = btn.dataset.type;
    DOM.typeBtns.forEach(b => {
      b.classList.toggle('active', b === btn);
      b.setAttribute('aria-checked', b === btn ? 'true' : 'false');
    });
    showTypeOpts(selectedType);
  });
});

DOM.modalConfirm.addEventListener('click', () => {
  const name = DOM.inputStageName.value.trim() || `스테이지 ${state.stages.length + 1}`;

  let stage = { name, type: selectedType };

  if (selectedType === 'countdown') {
    stage.workTime = parseInt(DOM.cdWorkTime.value) || 30;
    stage.restTime = parseInt(DOM.cdRestTime.value) || 0;
    stage.waitTime = parseInt(DOM.cdWaitTime.value) || 3;
  } else if (selectedType === 'tabata') {
    stage.workTime = parseInt(DOM.tbWorkTime.value) || 20;
    stage.restTime = parseInt(DOM.tbRestTime.value) || 10;
    stage.sets     = parseInt(DOM.tbSets.value)     || 8;
    stage.waitTime = parseInt(DOM.tbWaitTime.value) || 3;
  } else if (selectedType === 'laptime') {
    stage.laps     = parseInt(DOM.ltLaps.value)     || 4;
    stage.waitTime = parseInt(DOM.ltWaitTime.value) || 3;
  }

  state.stages.push(stage);
  closeAddModal();
  renderStageList();
  showToast(`"${name}" 스테이지가 추가되었습니다.`);
  AudioEngine.playClick();
});

// Allow Enter key in name input to confirm
DOM.inputStageName.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') DOM.modalConfirm.click();
  if (e.key === 'Escape') closeAddModal();
});

DOM.modalAdd.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeAddModal();
});

/* =============================================
   DELETE STAGE
   ============================================= */
function deleteStage(idx) {
  const wasRunning = state.running;
  if (state.running) stopTimer();
  state.stages.splice(idx, 1);

  // Adjust current index
  if (state.currentStageIdx >= state.stages.length) {
    state.currentStageIdx = state.stages.length - 1;
  }

  renderStageList();
  updateTimerUI();
  showToast('스테이지가 삭제되었습니다.');
}

/* =============================================
   TIMER ENGINE
   ============================================= */

function startTimer() {
  if (state.stages.length === 0) {
    showToast('먼저 스테이지를 추가하세요!');
    return;
  }

  AudioEngine.resume();

  if (state.currentStageIdx === -1) {
    state.currentStageIdx = 0;
    initStage(0);
  }

  state.running = true;
  DOM.btnStartPause.textContent = '⏸';
  DOM.btnStartPause.classList.add('paused');

  state.intervalId = setInterval(tick, 1000);
}

function pauseTimer() {
  state.running = false;
  clearInterval(state.intervalId);
  DOM.btnStartPause.textContent = '▶';
  DOM.btnStartPause.classList.remove('paused');
}

function stopTimer() {
  pauseTimer();
  state.currentStageIdx = -1;
  state.currentPhase = 'idle';
  state.currentLap = 0;
  state.timeLeft = 0;
  state.totalTime = 0;
  renderStageList();
  updateTimerUI();
}

function initStage(idx) {
  const stage = state.stages[idx];
  if (!stage) return;

  state.currentLap = 0;

  if (stage.waitTime > 0) {
    state.currentPhase = 'wait';
    state.timeLeft = stage.waitTime;
    state.totalTime = stage.waitTime;
  } else {
    startWorkPhase();
  }
  renderStageList();
  updateTimerUI();
}

function startWorkPhase() {
  const stage = state.stages[state.currentStageIdx];
  state.currentPhase = 'work';

  if (stage.type === 'countdown') {
    state.timeLeft  = stage.workTime;
    state.totalTime = stage.workTime;
  } else if (stage.type === 'tabata') {
    state.timeLeft  = stage.workTime;
    state.totalTime = stage.workTime;
  } else if (stage.type === 'laptime') {
    state.timeLeft  = 0; // count up
    state.totalTime = 0;
  }
  updateTimerUI();
}

function startRestPhase() {
  const stage = state.stages[state.currentStageIdx];
  state.currentPhase = 'rest';
  state.timeLeft  = stage.restTime;
  state.totalTime = stage.restTime;
  updateTimerUI();
}

function tick() {
  const stage = state.stages[state.currentStageIdx];
  if (!stage) return;

  if (state.currentPhase === 'wait') {
    // timeLeft === 4: decrement will bring it to 3 → warn exactly once
    if (state.timeLeft === 4) AudioEngine.playWarning();
    state.timeLeft--;
    if (state.timeLeft <= 0) {
      AudioEngine.playFinish();
      startWorkPhase();
    }

  } else if (state.currentPhase === 'work') {

    if (stage.type === 'laptime') {
      // Count UP — user presses ⏭ to advance to next lap
      state.timeLeft++;

    } else {
      // Count DOWN: warn when 4 seconds show → after tick 3 seconds remain
      if (state.timeLeft === 4) AudioEngine.playWarning();
      state.timeLeft--;

      if (state.timeLeft <= 0) {
        AudioEngine.playFinish();
        onWorkPhaseEnd();
      }
    }

  } else if (state.currentPhase === 'rest') {
    if (state.timeLeft === 4) AudioEngine.playWarning();
    state.timeLeft--;

    if (state.timeLeft <= 0) {
      AudioEngine.playFinish();
      onRestPhaseEnd();
    }
  }

  updateTimerUI();
}

function onWorkPhaseEnd() {
  const stage = state.stages[state.currentStageIdx];

  if (stage.type === 'countdown') {
    if (stage.restTime > 0) {
      startRestPhase();
    } else {
      advanceStage();
    }

  } else if (stage.type === 'tabata') {
    // After work phase → rest phase (if not last set)
    startRestPhase();
  }
}

function onRestPhaseEnd() {
  const stage = state.stages[state.currentStageIdx];

  if (stage.type === 'countdown') {
    advanceStage();
  } else if (stage.type === 'tabata') {
    state.currentLap++;
    if (state.currentLap >= stage.sets) {
      // All sets done
      advanceStage();
    } else {
      startWorkPhase();
    }
  }
}

function advanceStage() {
  const next = state.currentStageIdx + 1;
  if (next < state.stages.length) {
    state.currentStageIdx = next;
    initStage(next);
  } else {
    // All stages done
    showToast('🎉 모든 스테이지 완료!');
    stopTimer();
  }
}

function jumpToStage(idx) {
  if (state.running) pauseTimer();
  state.currentStageIdx = idx;
  initStage(idx);
}

/* Previous stage */
DOM.btnPrev.addEventListener('click', () => {
  AudioEngine.resume();
  const prev = state.currentStageIdx - 1;
  if (prev >= 0) {
    jumpToStage(prev);
  } else if (state.stages.length > 0) {
    jumpToStage(0);
  }
});

/* Next stage */
DOM.btnNextStage.addEventListener('click', () => {
  AudioEngine.resume();
  const stage = state.stages[state.currentStageIdx];

  if (stage && stage.type === 'laptime' && state.currentPhase === 'work') {
    // Record lap and advance
    state.currentLap++;
    if (state.currentLap >= stage.laps) {
      AudioEngine.playFinish();
      advanceStage();
    } else {
      // New lap: reset timer
      state.timeLeft  = 0;
      state.totalTime = 0;
      updateTimerUI();
    }
  } else {
    advanceStage();
  }
});

/* Start / Pause */
DOM.btnStartPause.addEventListener('click', () => {
  AudioEngine.resume();
  if (state.running) {
    pauseTimer();
  } else {
    startTimer();
  }
});

/* Stop / Reset */
DOM.btnStop.addEventListener('click', () => {
  AudioEngine.resume();
  stopTimer();
});

/* =============================================
   TIMER UI UPDATE
   ============================================= */
const CIRCUMFERENCE = 2 * Math.PI * 100; // r=100 → 628.3

function updateTimerUI() {
  const stage = state.stages[state.currentStageIdx];
  const phase = state.currentPhase;

  // Status bar state class
  DOM.statusBar.className = 'timer-status-bar';
  DOM.timerCircleWrap.className = 'timer-circle-wrap';

  let statusText = '대기 중';
  let typeBadge  = '--';
  let stageNameText = '스테이지 이름';
  let lapText = '';

  if (phase === 'wait') {
    DOM.statusBar.classList.add('state-wait');
    DOM.timerCircleWrap.classList.add('state-wait');
    statusText = '대기 중';
    typeBadge  = 'WAIT';
  } else if (phase === 'work') {
    DOM.statusBar.classList.add('state-work');
    DOM.timerCircleWrap.classList.add('state-work');
    statusText = '운동 중';
  } else if (phase === 'rest') {
    DOM.statusBar.classList.add('state-rest');
    DOM.timerCircleWrap.classList.add('state-rest');
    statusText = '휴식 중';
  } else {
    DOM.statusBar.classList.add('state-idle');
    DOM.timerCircleWrap.classList.add('state-idle');
  }

  if (stage) {
    stageNameText = stage.name;
    if (stage.type === 'countdown') typeBadge = 'COUNT DOWN';
    if (stage.type === 'tabata')    typeBadge = `TABATA ${state.currentLap + 1}/${stage.sets}`;
    if (stage.type === 'laptime')   typeBadge = 'LAP TIME';

    if (stage.type === 'laptime' && phase === 'work') {
      lapText = `랩 ${state.currentLap + 1} / ${stage.laps}`;
    } else if (stage.type === 'tabata' && phase !== 'wait') {
      lapText = `${state.currentPhase === 'work' ? '운동' : '휴식'} 세트 ${state.currentLap + 1} / ${stage.sets}`;
    }
  }

  DOM.statusLabel.textContent       = statusText;
  DOM.stageNameDisplay.textContent  = stageNameText;
  DOM.stageTypeBadge.textContent    = typeBadge;
  DOM.lapCountDisplay.textContent   = lapText;
  DOM.stageCounter.textContent      = state.currentStageIdx >= 0
    ? `스테이지 ${state.currentStageIdx + 1} / ${state.stages.length}`
    : `스테이지 0 / ${state.stages.length}`;

  // Time display
  DOM.timerDisplay.textContent = formatTime(state.timeLeft);

  // SVG progress ring
  let progress = 0; // 0 = empty, 1 = full
  if (state.totalTime > 0 && phase !== 'idle') {
    if (stage && stage.type === 'laptime' && phase === 'work') {
      progress = 0; // laptime: always "full" ring as reference
    } else {
      progress = state.timeLeft / state.totalTime;
    }
  } else if (phase === 'idle') {
    progress = 0;
  }
  const offset = CIRCUMFERENCE * (1 - progress);
  DOM.svgProgress.style.strokeDashoffset = offset;
}

function formatTime(seconds) {
  const s = Math.abs(Math.round(seconds));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

/* =============================================
   RECOMMEND SCENARIOS
   ============================================= */
const scenarios = {
  1: {
    name: '인터벌 트레이닝',
    stages: [
      { name: '준비', type: 'countdown', workTime: 5, restTime: 0, waitTime: 0 },
      { name: '고강도 운동', type: 'countdown', workTime: 30, restTime: 15, waitTime: 3 },
      { name: '고강도 운동', type: 'countdown', workTime: 30, restTime: 15, waitTime: 3 },
      { name: '고강도 운동', type: 'countdown', workTime: 30, restTime: 15, waitTime: 3 },
      { name: '고강도 운동', type: 'countdown', workTime: 30, restTime: 15, waitTime: 3 },
      { name: '마무리 스트레칭', type: 'countdown', workTime: 60, restTime: 0, waitTime: 3 },
    ]
  },
  2: {
    name: '타바타',
    stages: [
      { name: '타바타 세트', type: 'tabata', workTime: 20, restTime: 10, sets: 8, waitTime: 3 },
    ]
  },
  3: {
    name: '랩 타임',
    stages: [
      { name: '랩 기록 측정', type: 'laptime', laps: 4, waitTime: 3 },
    ]
  }
};

DOM.recBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    AudioEngine.resume();
    const id = btn.dataset.scenario;
    const scenario = scenarios[id];
    if (!scenario) return;

    if (state.running) stopTimer();

    state.stages = scenario.stages.map(s => ({ ...s }));
    state.currentStageIdx = -1;
    renderStageList();
    updateTimerUI();
    showToast(`"${scenario.name}" 시나리오가 로드되었습니다.`);
    AudioEngine.playClick();
  });
});

/* =============================================
   LOCALSTORAGE — Save / Load Routines
   ============================================= */
const STORAGE_KEY = 'workout_timer_routines';

function getSavedRoutines() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch { return []; }
}

function saveRoutines(routines) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(routines));
}

DOM.btnSaveRoutine.addEventListener('click', () => {
  if (state.stages.length === 0) {
    showToast('저장할 스테이지가 없습니다.');
    return;
  }
  const routineName = prompt('루틴 이름을 입력하세요:', `루틴 ${new Date().toLocaleDateString('ko-KR')}`);
  if (!routineName) return;

  const routines = getSavedRoutines();
  routines.push({
    id: Date.now(),
    name: routineName.trim(),
    stages: state.stages.map(s => ({ ...s })),
    savedAt: new Date().toISOString(),
  });
  saveRoutines(routines);
  showToast(`"${routineName}" 루틴이 저장되었습니다. 💾`);
  AudioEngine.playClick();
});

DOM.btnLoadRoutine.addEventListener('click', () => {
  AudioEngine.resume();
  openLoadModal();
});

DOM.loadModalClose.addEventListener('click',  closeLoadModal);
DOM.loadModalCancel.addEventListener('click', closeLoadModal);
DOM.modalLoad.addEventListener('click', (e) => {
  if (e.target === DOM.modalLoad) closeLoadModal();
});
DOM.modalLoad.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeLoadModal();
});

function openLoadModal() {
  const routines = getSavedRoutines();
  DOM.routineList.innerHTML = '';

  if (routines.length === 0) {
    DOM.noRoutinesMsg.hidden = false;
  } else {
    DOM.noRoutinesMsg.hidden = true;
    routines.forEach(routine => {
      const li = document.createElement('li');
      li.className = 'routine-item';
      const date = new Date(routine.savedAt).toLocaleDateString('ko-KR');
      li.innerHTML = `
        <div>
          <div class="routine-item-name">${escHtml(routine.name)}</div>
          <div class="routine-item-meta">${routine.stages.length}개 스테이지 · ${date}</div>
        </div>
        <div class="routine-actions">
          <button class="btn btn-primary btn-sm" data-id="${routine.id}" data-action="load">불러오기</button>
          <button class="btn btn-ghost btn-sm" data-id="${routine.id}" data-action="delete" style="color:var(--neon-red)">삭제</button>
        </div>
      `;
      DOM.routineList.appendChild(li);
    });
  }

  DOM.modalLoad.removeAttribute('hidden');
}

function closeLoadModal() {
  DOM.modalLoad.setAttribute('hidden', '');
}

DOM.routineList.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;

  const id     = parseInt(btn.dataset.id);
  const action = btn.dataset.action;
  let routines = getSavedRoutines();

  if (action === 'load') {
    const routine = routines.find(r => r.id === id);
    if (routine) {
      if (state.running) stopTimer();
      state.stages = routine.stages.map(s => ({ ...s }));
      state.currentStageIdx = -1;
      renderStageList();
      updateTimerUI();
      closeLoadModal();
      showToast(`"${routine.name}" 루틴을 불러왔습니다.`);
      AudioEngine.playClick();
    }
  } else if (action === 'delete') {
    const routine = routines.find(r => r.id === id);
    if (routine && confirm(`"${routine.name}" 루틴을 삭제하시겠습니까?`)) {
      routines = routines.filter(r => r.id !== id);
      saveRoutines(routines);
      openLoadModal(); // re-render
      showToast('루틴이 삭제되었습니다.');
    }
  }
});

/* =============================================
   TOAST
   ============================================= */
let toastTimeout;

function showToast(msg) {
  DOM.toast.textContent = msg;
  DOM.toast.classList.add('show');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => DOM.toast.classList.remove('show'), 3000);
}

/* =============================================
   UTILITY
   ============================================= */
function escHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/* =============================================
   INIT
   ============================================= */
function init() {
  updateTimerUI();
  renderStageList();
}

init();
