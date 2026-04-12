// --- Transcript tab DOM refs ---
const btnToggle = document.getElementById('btn-toggle');
const btnCopyAll = document.getElementById('btn-copy-all');
const btnCopyLast = document.getElementById('btn-copy-last');
const btnClear = document.getElementById('btn-clear');
const tabNameEl = document.getElementById('tab-name');
const transcriptArea = document.getElementById('transcript-area');
const statusEl = document.getElementById('status');
const placeholder = document.getElementById('placeholder');

// --- Tab switching DOM refs ---
const tabBtns = document.querySelectorAll('.tab-btn');
const tabTranscript = document.getElementById('tab-transcript');
const tabAssistant = document.getElementById('tab-assistant');

// --- Assistant tab DOM refs ---
const chatArea = document.getElementById('chat-area');
const nativeStatusEl = document.getElementById('native-status');
const autoModeCheckbox = document.getElementById('auto-mode');
const assistantInput = document.getElementById('assistant-question');
const btnAsk = document.getElementById('btn-ask');
const btnClearChat = document.getElementById('btn-clear-chat');

// --- Constants ---
const MAX_TAB_NAME_LENGTH = 50;
const COPIED_FEEDBACK_MS = 1500;
const WARNING_DISPLAY_MS = 5000;
const PLACEHOLDER_TEXT = 'Click the extension icon on a tab with audio, then press "Start"';
const NATIVE_PING_TIMEOUT_MS = 3000;

// --- State ---
let isRecording = false;
let finalTranscripts = [];
let interimEl = null;
let currentTab = 'transcript';
let isAiProcessing = false;
let thinkingEl = null;
let autoModeEnabled = false;
let pingTimeoutId = null;

// --- Init ---
initStatus();

// ===== Tab switching =====

tabBtns.forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

function switchTab(tabName) {
  currentTab = tabName;
  tabBtns.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  });
  tabTranscript.style.display = tabName === 'transcript' ? 'flex' : 'none';
  tabAssistant.style.display = tabName === 'assistant' ? 'flex' : 'none';

  if (tabName === 'assistant') {
    pingNativeHost();
    chatArea.scrollTop = chatArea.scrollHeight;
  }
}

// ===== Transcript tab — existing controls =====

btnToggle.addEventListener('click', async () => {
  if (isRecording) {
    await stopRecording();
  } else {
    await startRecording();
  }
});

btnCopyAll.addEventListener('click', () => {
  const text = finalTranscripts.map(t => t.trim()).filter(Boolean).join(' ');
  copyToClipboard(text, btnCopyAll);
});

btnCopyLast.addEventListener('click', () => {
  if (finalTranscripts.length > 0) {
    copyToClipboard(finalTranscripts[finalTranscripts.length - 1].trim(), btnCopyLast);
  }
});

btnClear.addEventListener('click', () => {
  finalTranscripts = [];
  while (transcriptArea.firstChild) {
    transcriptArea.removeChild(transcriptArea.firstChild);
  }
  placeholder.textContent = PLACEHOLDER_TEXT;
  placeholder.style.display = 'block';
  transcriptArea.appendChild(placeholder);
  updateCopyButtons();
});

// ===== Assistant tab — controls =====

btnAsk.addEventListener('click', () => {
  const q = assistantInput.value.trim();
  if (q) askAI(q, 'user');
});

assistantInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    const q = assistantInput.value.trim();
    if (q) askAI(q, 'user');
  }
});

autoModeCheckbox.addEventListener('change', () => {
  autoModeEnabled = autoModeCheckbox.checked;
});

btnClearChat.addEventListener('click', clearChat);

// ===== Message listener =====

chrome.runtime.onMessage.addListener((message) => {
  if (message.target && message.target !== 'sidepanel') return;

  if (message.type === 'transcript') {
    handleTranscript(message.text, message.isFinal);
  }

  if (message.type === 'capture-error') {
    setStatus('error', message.error);
    isRecording = false;
    updateToggleButton();
  }

  if (message.type === 'capture-warning') {
    setStatus('recording', message.warning);
    setTimeout(() => {
      if (isRecording) setStatus('recording', 'Recording...');
    }, WARNING_DISPLAY_MS);
  }

  if (message.type === 'tab-ready') {
    if (message.error) {
      tabNameEl.textContent = message.error;
      tabNameEl.classList.add('error');
      btnToggle.disabled = true;
    } else if (message.tabTitle) {
      setTabReady(message.tabTitle);
    }
  }

  // Assistant messages
  if (message.type === 'ai-response') {
    hideThinking();
    addChatBubble('ai', message.text);
    isAiProcessing = false;
  }

  if (message.type === 'ai-error') {
    hideThinking();
    addChatBubble('error', message.error);
    isAiProcessing = false;
  }

  if (message.type === 'native-pong') {
    clearTimeout(pingTimeoutId);
    setNativeStatus('connected');
  }

  if (message.type === 'native-error') {
    clearTimeout(pingTimeoutId);
    setNativeStatus('error', message.error);
  }
});

// ===== Transcript functions =====

async function initStatus() {
  try {
    const status = await chrome.runtime.sendMessage({ type: 'get-status' });
    if (status && status.isCapturing) {
      isRecording = true;
      setStatus('recording', 'Recording...');
      updateToggleButton();
      if (status.tabTitle) {
        setTabReady(status.tabTitle);
      }
    } else if (status && status.hasStream && status.tabTitle) {
      setTabReady(status.tabTitle);
    }
  } catch (e) {
    if (DEBUG) console.log('Init status error:', e);
  }
}

function setTabReady(title) {
  const display = title.length > MAX_TAB_NAME_LENGTH ? title.substring(0, MAX_TAB_NAME_LENGTH) + '...' : title;
  tabNameEl.textContent = display;
  tabNameEl.classList.remove('error');
  tabNameEl.classList.add('ready');
  btnToggle.disabled = false;
}

async function startRecording() {
  const apiKey = await getApiKey();
  if (!apiKey) {
    showNoApiKey();
    return;
  }

  setStatus('recording', 'Connecting...');

  const response = await chrome.runtime.sendMessage({ type: 'start-capture' });

  if (response && response.success) {
    isRecording = true;
    setStatus('recording', 'Recording...');
    placeholder.style.display = 'none';
  } else {
    const err = response ? response.error : 'Unknown error';
    if (err === 'no-api-key') {
      showNoApiKey();
    } else {
      setStatus('error', err);
    }
  }

  updateToggleButton();
}

async function stopRecording() {
  if (interimEl) {
    interimEl.remove();
    interimEl = null;
  }

  const response = await chrome.runtime.sendMessage({ type: 'stop-capture' });
  isRecording = false;

  if (response && response.hasStream && response.tabTitle) {
    setTabReady(response.tabTitle);
    setStatus('idle', 'Paused');
  } else {
    tabNameEl.textContent = 'Click the extension icon on the desired tab';
    tabNameEl.classList.remove('ready');
    btnToggle.disabled = true;
    setStatus('idle', 'Not recording');
  }

  updateToggleButton();
}

function handleTranscript(text, isFinal) {
  if (placeholder.style.display !== 'none') {
    placeholder.style.display = 'none';
  }

  if (isFinal) {
    if (interimEl) {
      interimEl.remove();
      interimEl = null;
    }

    const el = document.createElement('div');
    el.className = 'transcript-final';
    el.textContent = text;
    transcriptArea.appendChild(el);

    finalTranscripts.push(text);
    updateCopyButtons();

    // Assistant auto-mode: send final transcripts to AI
    if (autoModeEnabled && currentTab === 'assistant') {
      addChatBubble('transcript', text);
      if (!isAiProcessing) {
        askAI(text, 'transcript');
      }
    }
  } else {
    if (!interimEl) {
      interimEl = document.createElement('div');
      interimEl.className = 'transcript-interim';
      transcriptArea.appendChild(interimEl);
    }
    interimEl.textContent = text;
  }

  transcriptArea.scrollTop = transcriptArea.scrollHeight;
}

function setStatus(state, text) {
  statusEl.className = 'status';
  if (state === 'recording') {
    statusEl.classList.add('recording');
    statusEl.textContent = text || 'Recording...';
  } else if (state === 'error') {
    statusEl.classList.add('error');
    statusEl.textContent = text || 'Error';
  } else {
    statusEl.textContent = text || 'Not recording';
  }
}

function updateToggleButton() {
  if (isRecording) {
    btnToggle.textContent = '\u23F9 Stop';
    btnToggle.classList.add('active');
    btnToggle.disabled = false;
  } else {
    btnToggle.textContent = '\u25B6 Start';
    btnToggle.classList.remove('active');
  }
}

function updateCopyButtons() {
  const hasText = finalTranscripts.length > 0;
  btnCopyAll.disabled = !hasText;
  btnCopyLast.disabled = !hasText;
  btnClear.disabled = !hasText;
}

function copyToClipboard(text, btn) {
  navigator.clipboard.writeText(text).then(() => {
    const original = btn.textContent;
    btn.textContent = '\u2713 Copied!';
    btn.classList.add('copied');
    setTimeout(() => {
      btn.textContent = original;
      btn.classList.remove('copied');
    }, COPIED_FEEDBACK_MS);
  });
}

function showNoApiKey() {
  placeholder.innerHTML = '<div class="no-api-key">Enter Deepgram API key in <a id="open-options">extension settings</a></div>';
  placeholder.style.display = 'block';

  document.getElementById('open-options').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  setStatus('error', 'No API key');
}

updateCopyButtons();

// ===== Assistant functions =====

function askAI(question, source) {
  if (isAiProcessing || !question) return;
  isAiProcessing = true;

  if (source === 'user') {
    addChatBubble('user', question);
    assistantInput.value = '';
  }

  showThinking();
  chrome.runtime.sendMessage({ type: 'ask-ai', question: question });
}

function addChatBubble(type, text) {
  const bubble = document.createElement('div');
  bubble.className = 'chat-bubble chat-' + type;
  bubble.textContent = text;

  // Action buttons
  if (type === 'user' || type === 'transcript') {
    const actions = document.createElement('div');
    actions.className = 'chat-bubble-actions';
    const replyBtn = document.createElement('button');
    replyBtn.className = 'chat-bubble-btn';
    replyBtn.textContent = 'Ответить';
    replyBtn.addEventListener('click', () => {
      askAI(text, 'user');
    });
    actions.appendChild(replyBtn);
    bubble.appendChild(actions);
  }

  if (type === 'ai') {
    const actions = document.createElement('div');
    actions.className = 'chat-bubble-actions';
    const copyBtn = document.createElement('button');
    copyBtn.className = 'chat-bubble-btn';
    copyBtn.textContent = 'Копировать';
    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(text).then(() => {
        copyBtn.textContent = '\u2713 Скопировано';
        copyBtn.classList.add('copied');
        setTimeout(() => {
          copyBtn.textContent = 'Копировать';
          copyBtn.classList.remove('copied');
        }, COPIED_FEEDBACK_MS);
      });
    });
    actions.appendChild(copyBtn);
    bubble.appendChild(actions);
  }

  chatArea.appendChild(bubble);
  chatArea.scrollTop = chatArea.scrollHeight;
}

function showThinking() {
  thinkingEl = document.createElement('div');
  thinkingEl.className = 'chat-bubble chat-thinking';
  thinkingEl.innerHTML = '<span class="thinking-dots">Думаю<span>.</span><span>.</span><span>.</span></span>';
  chatArea.appendChild(thinkingEl);
  chatArea.scrollTop = chatArea.scrollHeight;
}

function hideThinking() {
  if (thinkingEl) {
    thinkingEl.remove();
    thinkingEl = null;
  }
}

function setNativeStatus(state, detail) {
  nativeStatusEl.className = 'native-status ' + state;
  if (state === 'connected') {
    nativeStatusEl.textContent = 'Native Host connected';
  } else if (state === 'error') {
    nativeStatusEl.textContent = detail || 'Native Host not connected. Run install script and restart Chrome.';
  } else {
    nativeStatusEl.textContent = 'Checking...';
  }
}

function pingNativeHost() {
  setNativeStatus('checking');
  chrome.runtime.sendMessage({ type: 'ping-native' });
  pingTimeoutId = setTimeout(() => {
    setNativeStatus('error', 'Native Host not responding. Run install script and restart Chrome.');
  }, NATIVE_PING_TIMEOUT_MS);
}

function clearChat() {
  while (chatArea.firstChild) {
    chatArea.removeChild(chatArea.firstChild);
  }
}
