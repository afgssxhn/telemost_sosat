const DEBUG = false;

let isCapturing = false;
let offscreenCreated = false;
let pendingStreamId = null;
let pendingTabId = null;
let pendingTabTitle = null;

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });

chrome.action.onClicked.addListener(async (tab) => {
  if (tab.url && (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://'))) {
    await chrome.sidePanel.open({ tabId: tab.id });
    broadcastToSidePanel({
      type: 'tab-ready',
      tabTitle: null,
      error: 'Cannot capture Chrome internal pages. Open a regular website.'
    });
    return;
  }

  try {
    pendingStreamId = await new Promise((resolve, reject) => {
      chrome.tabCapture.getMediaStreamId({}, (id) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(id);
        }
      });
    });
    pendingTabId = tab.id;
    pendingTabTitle = tab.title || tab.url || 'Tab ' + tab.id;
  } catch (e) {
    if (DEBUG) console.log('Failed to get streamId:', e);
    pendingStreamId = null;
    pendingTabId = null;
    pendingTabTitle = null;
  }

  await chrome.sidePanel.open({ tabId: tab.id });

  setTimeout(() => {
    broadcastToSidePanel({
      type: 'tab-ready',
      tabTitle: pendingTabTitle,
      error: pendingStreamId ? null : 'Failed to prepare tab capture. Try clicking the icon again.'
    });
  }, 200);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'start-capture') {
    handleStartCapture().then(sendResponse).catch((err) => {
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

  if (message.type === 'get-status') {
    sendResponse({
      isCapturing: isCapturing,
      tabTitle: pendingTabTitle,
      hasStream: !!pendingStreamId
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

async function handleStartCapture() {
  if (isCapturing) {
    return { success: false, error: 'Already capturing' };
  }

  if (!pendingStreamId) {
    return { success: false, error: 'No tab ready. Click the extension icon on the tab you want to capture.' };
  }

  const apiKey = await getApiKey();
  if (!apiKey) {
    return { success: false, error: 'no-api-key' };
  }

  await ensureOffscreenDocument();

  chrome.runtime.sendMessage({
    type: 'offscreen-start',
    streamId: pendingStreamId,
    apiKey: apiKey
  });

  isCapturing = true;
  return { success: true, tabTitle: pendingTabTitle };
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

  // Re-acquire streamId for the same tab so user can just press Start again
  if (pendingTabId) {
    try {
      pendingStreamId = await new Promise((resolve, reject) => {
        chrome.tabCapture.getMediaStreamId({}, (id) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(id);
          }
        });
      });
    } catch (e) {
      if (DEBUG) console.log('Failed to re-acquire streamId:', e);
      pendingStreamId = null;
    }
  }

  return { success: true, tabTitle: pendingTabTitle, hasStream: !!pendingStreamId };
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
    reasons: ['USER_MEDIA', 'AUDIO_PLAYBACK'],
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
  chrome.runtime.sendMessage(message).catch(() => {});
}

async function getApiKey() {
  const result = await chrome.storage.local.get('deepgramApiKey');
  return result.deepgramApiKey || null;
}
