const DEBUG = false;

let isCapturing = false;
let offscreenCreated = false;

chrome.action.onClicked.addListener(async (tab) => {
  await chrome.sidePanel.open({ tabId: tab.id });
});

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'start-capture') {
    handleStartCapture(message.tabId).then(sendResponse).catch((err) => {
      sendResponse({ success: false, error: err.message });
    });
    return true;
  }

  if (message.type === 'stop-capture') {
    handleStopCapture().then(sendResponse).catch((err) => {
      sendResponse({ success: false, error: err.message });
    });
    return true;
  }

  if (message.type === 'transcript') {
    broadcastToSidePanel(message);
  }

  if (message.type === 'capture-error') {
    broadcastToSidePanel(message);
    isCapturing = false;
  }
});

async function handleStartCapture(tabId) {
  if (isCapturing) {
    return { success: false, error: 'Already capturing' };
  }

  const apiKey = await getApiKey();
  if (!apiKey) {
    return { success: false, error: 'no-api-key' };
  }

  const streamId = await new Promise((resolve, reject) => {
    chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, (id) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(id);
      }
    });
  });

  if (DEBUG) console.log('Got streamId:', streamId);

  await ensureOffscreenDocument();

  chrome.runtime.sendMessage({
    type: 'offscreen-start',
    streamId: streamId,
    apiKey: apiKey
  });

  isCapturing = true;
  return { success: true };
}

async function handleStopCapture() {
  if (!isCapturing) {
    return { success: true };
  }

  try {
    chrome.runtime.sendMessage({ type: 'offscreen-stop' });
  } catch (e) {
    if (DEBUG) console.log('Error sending stop to offscreen:', e);
  }

  await closeOffscreenDocument();
  isCapturing = false;
  return { success: true };
}

async function ensureOffscreenDocument() {
  if (offscreenCreated) return;

  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT']
  });

  if (existingContexts.length > 0) {
    offscreenCreated = true;
    return;
  }

  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['USER_MEDIA'],
    justification: 'Capture tab audio and stream to Deepgram for transcription'
  });

  offscreenCreated = true;
}

async function closeOffscreenDocument() {
  if (!offscreenCreated) return;

  try {
    await chrome.offscreen.closeDocument();
  } catch (e) {
    if (DEBUG) console.log('Error closing offscreen:', e);
  }

  offscreenCreated = false;
}

function broadcastToSidePanel(message) {
  chrome.runtime.sendMessage(message).catch(() => {
    // Side panel might not be open
  });
}

async function getApiKey() {
  const result = await chrome.storage.local.get('deepgramApiKey');
  return result.deepgramApiKey || null;
}
