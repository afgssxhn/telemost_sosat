const DEBUG = false;

const btnToggle = document.getElementById('btn-toggle');
const btnCopyAll = document.getElementById('btn-copy-all');
const btnCopyLast = document.getElementById('btn-copy-last');
const btnClear = document.getElementById('btn-clear');
const transcriptArea = document.getElementById('transcript-area');
const statusEl = document.getElementById('status');
const placeholder = document.getElementById('placeholder');

let isRecording = false;
let finalTranscripts = [];
let interimEl = null;

btnToggle.addEventListener('click', async () => {
  if (isRecording) {
    await stopRecording();
  } else {
    await startRecording();
  }
});

btnCopyAll.addEventListener('click', () => {
  const text = finalTranscripts.join(' ');
  copyToClipboard(text, btnCopyAll);
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
  updateButtons();
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
});

async function startRecording() {
  const apiKey = await getApiKey();
  if (!apiKey) {
    showNoApiKey();
    return;
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) {
    setStatus('error', 'No active tab');
    return;
  }

  setStatus('recording', 'Connecting...');

  const response = await chrome.runtime.sendMessage({
    type: 'start-capture',
    tabId: tab.id
  });

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
  await chrome.runtime.sendMessage({ type: 'stop-capture' });
  isRecording = false;
  setStatus('idle', 'Not recording');
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
    updateButtons();
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
  } else {
    btnToggle.textContent = '\u25B6 Start';
    btnToggle.classList.remove('active');
  }
}

function updateButtons() {
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
  placeholder.innerHTML = '<div class="no-api-key">Enter the Deepgram API key in the <a id="open-options">extension settings</a></div>';
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

updateButtons();
