const btnToggle = document.getElementById('btn-toggle');
const btnCopyAll = document.getElementById('btn-copy-all');
const btnCopyLast = document.getElementById('btn-copy-last');
const btnClear = document.getElementById('btn-clear');
const btnAI = document.getElementById('btn-ai');
const tabNameEl = document.getElementById('tab-name');
const transcriptArea = document.getElementById('transcript-area');
const statusEl = document.getElementById('status');
const placeholder = document.getElementById('placeholder');
const aiAnswerEl = document.getElementById('ai-answer');
const aiAnswerTextEl = document.getElementById('ai-answer-text');
const btnCopyAI = document.getElementById('btn-copy-ai');

const MAX_TAB_NAME_LENGTH = 50;
const COPIED_FEEDBACK_MS = 1500;
const WARNING_DISPLAY_MS = 5000;
const PLACEHOLDER_TEXT = 'Click the extension icon on a tab with audio, then press "Start"';
const AI_BUTTON_TEXT = 'AI';
const AI_BUTTON_PROCESSING_TEXT = 'Thinking...';
const DEFAULT_CLAUDE_MODEL = 'claude-sonnet-4-20250514';
const SPEAKER_COLORS = ['#4fc3f7', '#81c784', '#ffb74d', '#e57373'];

let isRecording = false;
let finalTranscripts = [];
let interimEl = null;
let isAiProcessing = false;
let lastDisplayedSpeaker = null;

initStatus();

// ===== Controls =====

btnToggle.addEventListener('click', async () => {
  if (isRecording) {
    await stopRecording();
  } else {
    await startRecording();
  }
});

btnCopyAll.addEventListener('click', () => {
  let result = '';
  let copySpeaker = null;
  for (const entry of finalTranscripts) {
    const text = entry.text.trim();
    if (!text) continue;
    if (entry.speaker != null && entry.speaker !== copySpeaker) {
      copySpeaker = entry.speaker;
      if (result) result += '\n\n';
      result += 'Спикер ' + (entry.speaker + 1) + ':\n';
    } else if (result && !result.endsWith('\n')) {
      result += ' ';
    }
    result += text;
  }
  copyToClipboard(result, btnCopyAll);
});

btnCopyLast.addEventListener('click', () => {
  if (finalTranscripts.length > 0) {
    copyToClipboard(finalTranscripts[finalTranscripts.length - 1].text.trim(), btnCopyLast);
  }
});

btnClear.addEventListener('click', () => {
  finalTranscripts = [];
  lastDisplayedSpeaker = null;
  while (transcriptArea.firstChild) {
    transcriptArea.removeChild(transcriptArea.firstChild);
  }
  placeholder.textContent = PLACEHOLDER_TEXT;
  placeholder.style.display = 'block';
  transcriptArea.appendChild(placeholder);
  clearAIAnswer();
  updateCopyButtons();
});

btnAI.addEventListener('click', async () => {
  if (isAiProcessing) return;

  const text = finalTranscripts.map(t => t.text.trim()).filter(Boolean).join(' ');
  if (!text) return;

  isAiProcessing = true;
  btnAI.textContent = AI_BUTTON_PROCESSING_TEXT;
  btnAI.classList.add('processing');
  btnAI.disabled = true;

  // Clear previous answer and show loading state
  aiAnswerTextEl.textContent = 'Thinking...';
  aiAnswerTextEl.classList.remove('error');
  aiAnswerEl.style.display = 'block';

  const stored = await chrome.storage.local.get('claudeModel');
  const model = stored.claudeModel || DEFAULT_CLAUDE_MODEL;
  chrome.runtime.sendMessage({ type: 'ask-ai', question: text, model: model });
});

btnCopyAI.addEventListener('click', () => {
  const text = aiAnswerTextEl.textContent;
  if (!text) return;
  navigator.clipboard.writeText(text).then(() => {
    btnCopyAI.textContent = '\u2713 Copied';
    btnCopyAI.classList.add('copied');
    setTimeout(() => {
      btnCopyAI.textContent = 'Copy';
      btnCopyAI.classList.remove('copied');
    }, COPIED_FEEDBACK_MS);
  });
});

// ===== Message listener =====

chrome.runtime.onMessage.addListener((message) => {
  if (message.target && message.target !== 'sidepanel') return;

  if (message.type === 'transcript') {
    handleTranscript(message.text, message.isFinal, message.speaker);
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

  if (message.type === 'ai-response') {
    aiAnswerTextEl.textContent = message.text;
    aiAnswerTextEl.classList.remove('error');
    resetAIButton();
  }

  if (message.type === 'ai-error') {
    aiAnswerTextEl.textContent = message.error;
    aiAnswerTextEl.classList.add('error');
    resetAIButton();
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

function handleTranscript(text, isFinal, speaker) {
  if (placeholder.style.display !== 'none') {
    placeholder.style.display = 'none';
  }

  if (isFinal) {
    if (interimEl) {
      interimEl.remove();
      interimEl = null;
    }

    // Show speaker label on speaker change
    if (speaker != null && speaker !== lastDisplayedSpeaker) {
      const labelEl = document.createElement('div');
      labelEl.className = 'speaker-label';
      labelEl.style.color = SPEAKER_COLORS[speaker % SPEAKER_COLORS.length];
      labelEl.textContent = 'Спикер ' + (speaker + 1);
      transcriptArea.appendChild(labelEl);
      lastDisplayedSpeaker = speaker;
    }

    const el = document.createElement('div');
    el.className = 'transcript-final';
    el.textContent = text;
    transcriptArea.appendChild(el);

    finalTranscripts.push({ text: text, speaker: speaker != null ? speaker : null });
    updateCopyButtons();
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
  btnAI.disabled = !hasText;
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

// ===== AI functions =====

function resetAIButton() {
  isAiProcessing = false;
  btnAI.textContent = AI_BUTTON_TEXT;
  btnAI.classList.remove('processing');
  btnAI.disabled = finalTranscripts.length === 0;
}

function clearAIAnswer() {
  aiAnswerEl.style.display = 'none';
  aiAnswerTextEl.textContent = '';
  aiAnswerTextEl.classList.remove('error');
}

updateCopyButtons();
