importScripts('utils.js');

const TAB_READY_DELAY_MS = 200;
const OFFSCREEN_READY_TIMEOUT_MS = 5000;
const NATIVE_HOST_NAME = 'com.telemost.transcriber';

let creatingOffscreen = null;

async function getState() {
  const result = await chrome.storage.session.get({
    isCapturing: false,
    pendingStreamId: null,
    pendingTabId: null,
    pendingTabTitle: null
  });
  return result;
}

async function setState(patch) {
  await chrome.storage.session.set(patch);
}

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (changeInfo.status !== 'loading') return;

  const state = await getState();
  if (tabId !== state.pendingTabId) return;

  console.log('[TT] Tracked tab navigating, invalidating streamId');

  if (state.isCapturing) {
    await handleStopCapture();
    broadcastToSidePanel({
      type: 'capture-error',
      error: 'Recording stopped: tab navigated. Click icon again to re-capture.'
    });
  }

  await setState({ pendingStreamId: null });

  broadcastToSidePanel({
    type: 'tab-ready',
    tabTitle: null,
    error: 'Tab navigated. Click the extension icon again.'
  });
});

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

  let streamId = null;
  const tabTitle = tab.title || tab.url || 'Tab ' + tab.id;

  try {
    streamId = await new Promise((resolve, reject) => {
      chrome.tabCapture.getMediaStreamId({}, (id) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(id);
        }
      });
    });
  } catch (e) {
    console.log('[TT] Failed to get streamId:', e.message);
  }

  await setState({
    pendingStreamId: streamId,
    pendingTabId: tab.id,
    pendingTabTitle: tabTitle
  });

  await chrome.sidePanel.open({ tabId: tab.id });

  setTimeout(async () => {
    const state = await getState();
    broadcastToSidePanel({
      type: 'tab-ready',
      tabTitle: state.pendingTabTitle,
      error: state.pendingStreamId ? null : 'Failed to prepare tab capture. Try clicking the icon again.'
    });
  }, TAB_READY_DELAY_MS);
});

function handleAskAI(message) {
  const question = message.question;
  const model = message.model;
  console.log('[TT:AI] Sending question to native host, model:', model);
  chrome.runtime.sendNativeMessage(
    NATIVE_HOST_NAME,
    { type: 'ask', question: question, model: model },
    (response) => {
      if (chrome.runtime.lastError) {
        console.log('[TT:AI] Native host error:', chrome.runtime.lastError.message);
        broadcastToSidePanel({
          type: 'ai-error',
          error: chrome.runtime.lastError.message
        });
        return;
      }
      if (response && response.type === 'error') {
        console.log('[TT:AI] Claude error:', response.error);
        broadcastToSidePanel({ type: 'ai-error', error: response.error });
      } else if (response && response.type === 'answer') {
        console.log('[TT:AI] Got answer from Claude');
        broadcastToSidePanel({ type: 'ai-response', text: response.text });
      } else {
        broadcastToSidePanel({ type: 'ai-error', error: 'Unexpected response from native host' });
      }
    }
  );
}

// Message type → handler dispatch map
const MESSAGE_HANDLERS = {
  'start-capture': (message, sender, sendResponse) => {
    handleStartCapture().then(sendResponse).catch((err) => {
      sendResponse({ success: false, error: err.message });
    });
  },

  'stop-capture': (message, sender, sendResponse) => {
    handleStopCapture().then(sendResponse).catch((err) => {
      sendResponse({ success: false, error: err.message });
    });
  },

  'get-status': (message, sender, sendResponse) => {
    getState().then((state) => {
      sendResponse({
        isCapturing: state.isCapturing,
        tabTitle: state.pendingTabTitle,
        hasStream: !!state.pendingStreamId
      });
    });
  },

  'transcript': (message) => {
    broadcastToSidePanel(message);
  },

  'capture-error': (message) => {
    broadcastToSidePanel(message);
    setState({ isCapturing: false });
  },

  'capture-warning': (message) => {
    broadcastToSidePanel(message);
  },

  'ask-ai': (message, sender, sendResponse) => {
    handleAskAI(message);
    sendResponse({ success: true });
  }
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handler = MESSAGE_HANDLERS[message.type];
  if (handler) {
    handler(message, sender, sendResponse);
    return true;
  }
});

async function handleStartCapture() {
  const state = await getState();

  if (state.isCapturing) {
    return { success: false, error: 'Already capturing' };
  }

  if (!state.pendingStreamId) {
    return { success: false, error: 'No tab ready. Click the extension icon on the tab you want to capture.' };
  }

  const apiKey = await getApiKey();
  if (!apiKey) {
    return { success: false, error: 'no-api-key' };
  }

  await ensureOffscreenDocument();

  chrome.runtime.sendMessage({
    type: 'offscreen-start',
    target: 'offscreen',
    streamId: state.pendingStreamId,
    apiKey: apiKey
  });

  await setState({ isCapturing: true });
  console.log('[TT] Capture started');
  return { success: true, tabTitle: state.pendingTabTitle };
}

async function handleStopCapture() {
  const state = await getState();

  if (!state.isCapturing) {
    return { success: true };
  }

  try {
    chrome.runtime.sendMessage({ type: 'offscreen-stop', target: 'offscreen' });
  } catch (e) {
    console.log('[TT] Error sending stop to offscreen:', e.message);
  }

  await closeOffscreenDocument();
  await setState({ isCapturing: false });
  console.log('[TT] Capture stopped');

  // Re-acquire streamId for the same tab so user can just press Start again
  let newStreamId = null;
  if (state.pendingTabId) {
    try {
      newStreamId = await new Promise((resolve, reject) => {
        chrome.tabCapture.getMediaStreamId({}, (id) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(id);
          }
        });
      });
    } catch (e) {
      if (DEBUG) console.log('[TT] Failed to re-acquire streamId:', e.message);
    }
  }

  await setState({ pendingStreamId: newStreamId });
  return { success: true, tabTitle: state.pendingTabTitle, hasStream: !!newStreamId };
}

async function ensureOffscreenDocument() {
  if (creatingOffscreen) return creatingOffscreen;

  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT']
  });

  if (contexts.length > 0) {
    console.log('[TT] Offscreen document already exists');
    return;
  }

  creatingOffscreen = (async () => {
    const readyPromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        chrome.runtime.onMessage.removeListener(listener);
        reject(new Error('Offscreen document did not initialize within 5s'));
      }, OFFSCREEN_READY_TIMEOUT_MS);

      function listener(message) {
        if (message.type === 'offscreen-ready') {
          clearTimeout(timeout);
          chrome.runtime.onMessage.removeListener(listener);
          resolve();
        }
      }

      chrome.runtime.onMessage.addListener(listener);
    });

    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['USER_MEDIA', 'AUDIO_PLAYBACK'],
      justification: 'Capture tab audio and stream to Deepgram for transcription'
    });

    await readyPromise;
    console.log('[TT] Offscreen document created and ready');
  })();

  try {
    await creatingOffscreen;
  } finally {
    creatingOffscreen = null;
  }
}

async function closeOffscreenDocument() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT']
  });

  if (contexts.length === 0) return;

  try {
    await chrome.offscreen.closeDocument();
    console.log('[TT] Offscreen document closed');
  } catch (e) {
    console.log('[TT] Error closing offscreen:', e.message);
  }
}

function broadcastToSidePanel(message) {
  chrome.runtime.sendMessage({ ...message, target: 'sidepanel' }).catch(() => {});
}
