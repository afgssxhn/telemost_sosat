const DEBUG = false;

const btnToggle = document.getElementById('btn-toggle');
const btnCopyAll = document.getElementById('btn-copy-all');
const btnCopyLast = document.getElementById('btn-copy-last');
const btnClear = document.getElementById('btn-clear');
const tabNameEl = document.getElementById('tab-name');
const transcriptArea = document.getElementById('transcript-area');
const statusEl = document.getElementById('status');
const placeholder = document.getElementById('placeholder');

let isRecording = false;
let finalTranscripts = [];
let interimEl = null;

initStatus();

btnToggle.addEventListener('click', async () => {
  if (isRecording) {
    await stopRecording();
  } else {
    await startRecording();
  }
});

btnCopyAll.addEventListener('click', () => {
  copyToClipboard(finalTranscripts.join(' '), btnCopyAll);
});

btnCopyLast.addEventListener('click', () => {
  if (finalTranscripts.length > 0) {
    copyToClipboard(finalTranscripts[finalTranscripts.length - 1], btnCopyLast);
  }
});

btnClear.addEventListener('click', () => {
  finalTranscripts = [];
  transcriptArea.innerHTML = '';
  placeholder.style.display = 'block';
  transcriptArea.appendChild(placeholder);
  updateCopyButtons();
});

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'transcript') {
    handleTranscript(message.text, message.isFinal);
  }

  if (message.type === 'capture-error') {
    setStatus('error', message.error);
    isRecording = false;
    updateToggleButton();
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
});

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
  const display = title.length > 50 ? title.substring(0, 50) + '...' : title;
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
  const response = await chrome.runtime.sendMessage({ type: 'stop-capture' });
  isRecording = false;

  if (response && response.hasStream && response.tabTitle) {
    // Tab still ready — user can just press Start again
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
    }, 1500);
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

async function getApiKey() {
  const result = await chrome.storage.local.get('deepgramApiKey');
  return result.deepgramApiKey || null;
}

updateCopyButtons();
