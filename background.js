const DEBUG = false;

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
    getState().then((state) => {
      sendResponse({
        isCapturing: state.isCapturing,
        tabTitle: state.pendingTabTitle,
        hasStream: !!state.pendingStreamId
      });
    });
    return true;
  }

  if (message.type === 'transcript') {
    broadcastToSidePanel(message);
  }

  if (message.type === 'capture-error') {
    broadcastToSidePanel(message);
    setState({ isCapturing: false });
  }

  if (message.type === 'capture-warning') {
    broadcastToSidePanel(message);
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
      }, 5000);

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

async function getApiKey() {
  const result = await chrome.storage.local.get('deepgramApiKey');
  return result.deepgramApiKey || null;
}
