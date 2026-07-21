const socket = io();

// State variables
let playerToken = localStorage.getItem('drrr_rejoin_token') || null;
let currentRole = 'Caretaker';
let pendingSwapRequestId = null;

// Multi-touch movement tracking state
const touchState = {
  up: false,
  down: false,
  left: false,
  right: false,
  jump: false
};

// UI Elements
const warningOverlay = document.getElementById('warning-overlay');
const warningTitle = document.getElementById('warning-title');
const lookoutBanner = document.getElementById('lookout-banner');

const hpBarFill = document.getElementById('hp-bar-fill');
const hpNum = document.getElementById('hp-num');
const foodBarFill = document.getElementById('food-bar-fill');
const foodNum = document.getElementById('food-num');
const shelterBarFill = document.getElementById('shelter-bar-fill');
const shelterNum = document.getElementById('shelter-num');

const swapModal = document.getElementById('swap-modal');
const swapModalText = document.getElementById('swap-modal-text');

// Connect & Join Game
socket.on('connect', () => {
  socket.emit('join_game', {
    name: `Player_${Math.floor(Math.random() * 1000)}`,
    rejoinToken: playerToken
  });
});

socket.on('joined_successfully', (data) => {
  playerToken = data.rejoinToken;
  localStorage.setItem('drrr_rejoin_token', playerToken);
});

// Render Text Progress Bar Utility Function
function generateAsciiBar(value, max = 100, barLength = 10) {
  const filledLength = Math.round((value / max) * barLength);
  const emptyLength = barLength - filledLength;
  const filledBar = '█'.repeat(Math.max(0, filledLength));
  const emptyBar = '░'.repeat(Math.max(0, emptyLength));
  return `${filledBar}${emptyBar} ${value}`;
}

// Game State Sync
socket.on('game_state_update', (state) => {
  if (state.shelterIntegrity !== undefined) {
    shelterBarFill.style.width = `${state.shelterIntegrity}%`;
    shelterNum.innerText = generateAsciiBar(state.shelterIntegrity, 100);
  }

  const me = state.players[socket.id];
  if (me) {
    hpBarFill.style.width = `${me.health}%`;
    hpNum.innerText = generateAsciiBar(me.health, 100);

    foodBarFill.style.width = `${me.food}%`;
    foodNum.innerText = generateAsciiBar(me.food, 100);

    currentRole = me.role;
    document.getElementById('current-role-label').innerText = me.role;
  }
});

// Warning Overlays & Lookout Handling
socket.on('disaster_warning_overlay', (data) => {
  if (currentRole === 'Lookout') return; // Lookout receives unobtrusive toast instead

  warningTitle.innerText = data.message;
  warningOverlay.classList.remove('hidden-overlay');

  setTimeout(() => {
    warningOverlay.classList.add('hidden-overlay');
  }, data.durationMs);
});

socket.on('disaster_lookout_early_warning', (data) => {
  lookoutBanner.innerText = data.message;
  lookoutBanner.classList.remove('hidden');

  setTimeout(() => {
    lookoutBanner.classList.add('hidden');
  }, 6000);
});

// Role Swap Prompting
socket.on('role_swap_prompt', (data) => {
  pendingSwapRequestId = data.requestId;
  swapModalText.innerText = `${data.requesterName} wants to swap roles with you!`;
  swapModal.classList.remove('hidden');
});

document.getElementById('swap-accept-btn').addEventListener('click', () => {
  socket.emit('respond_role_swap', { requestId: pendingSwapRequestId, accepted: true });
  swapModal.classList.add('hidden');
});

document.getElementById('swap-decline-btn').addEventListener('click', () => {
  socket.emit('respond_role_swap', { requestId: pendingSwapRequestId, accepted: false });
  swapModal.classList.add('hidden');
});

// Mobile Multi-Touch Control Setup
function bindTouchButton(id, stateKey) {
  const btn = document.getElementById(id);
  if (!btn) return;

  const start = (e) => {
    e.preventDefault();
    touchState[stateKey] = true;
  };
  const end = (e) => {
    e.preventDefault();
    touchState[stateKey] = false;
  };

  btn.addEventListener('touchstart', start, { passive: false });
  btn.addEventListener('touchend', end, { passive: false });
  btn.addEventListener('touchcancel', end, { passive: false });
}

bindTouchButton('btn-up', 'up');
bindTouchButton('btn-down', 'down');
bindTouchButton('btn-left', 'left');
bindTouchButton('btn-right', 'right');
bindTouchButton('btn-jump', 'jump');