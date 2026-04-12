const DEBUG = false;

let audioContext = null;
let mediaStream = null;
let workletNode = null;
let audioPlayback = null;
let websocket = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 3;
const SAMPLE_RATE = 16000;
const RECONNECT_BACKOFF_BASE_MS = 1000;
let currentApiKey = null;
let isRunning = false;

chrome.runtime.onMessage.addListener((message) => {
  if (message.target && message.target !== 'offscreen') return;

  if (message.type === 'offscreen-start') {
    startCapture(message.streamId, message.apiKey);
  }

  if (message.type === 'offscreen-stop') {
    stopCapture();
  }
});

// Signal to background that the offscreen document is loaded and ready
chrome.runtime.sendMessage({ type: 'offscreen-ready', target: 'background' }).catch(() => {});
console.log('[TT] Offscreen document ready');

async function startCapture(streamId, apiKey) {
  if (isRunning) return;
  isRunning = true;
  currentApiKey = apiKey;
  reconnectAttempts = 0;

  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: streamId
        }
      }
    });

    // Play captured audio back so the user still hears the tab
    audioPlayback = new Audio();
    audioPlayback.srcObject = mediaStream;
    try {
      await audioPlayback.play();
      console.log('[TT] Audio playback started');
    } catch (e) {
      console.log('[TT] Audio playback failed:', e.message);
      chrome.runtime.sendMessage({
        type: 'capture-warning',
        target: 'background',
        warning: 'Tab audio playback failed. Transcription continues without audio.'
      }).catch(() => {});
    }

    audioContext = new AudioContext({ sampleRate: SAMPLE_RATE });
    const source = audioContext.createMediaStreamSource(mediaStream);

    await audioContext.audioWorklet.addModule('audio-processor.js');
    workletNode = new AudioWorkletNode(audioContext, 'pcm-processor');

    workletNode.port.onmessage = (event) => {
      if (websocket && websocket.readyState === WebSocket.OPEN) {
        websocket.send(event.data);
      }
    };

    source.connect(workletNode);

    connectWebSocket();
  } catch (err) {
    if (DEBUG) console.log('Capture error:', err);
    chrome.runtime.sendMessage({
      type: 'capture-error',
      target: 'background',
      error: err.message
    });
    stopCapture();
  }
}

function connectWebSocket() {
  if (!currentApiKey || !isRunning) return;

  const url = 'wss://api.deepgram.com/v1/listen'
    + '?language=ru'
    + '&model=nova-3'
    + '&punctuate=true'
    + '&interim_results=true'
    + '&encoding=linear16'
    + '&sample_rate=' + SAMPLE_RATE
    + '&channels=1';

  websocket = new WebSocket(url, ['token', currentApiKey]);

  websocket.onopen = () => {
    if (DEBUG) console.log('Deepgram WebSocket connected');
    reconnectAttempts = 0;
  };

  websocket.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      const transcript = data?.channel?.alternatives?.[0]?.transcript;

      if (transcript) {
        chrome.runtime.sendMessage({
          type: 'transcript',
          target: 'background',
          text: transcript,
          isFinal: data.is_final === true
        });
      }
    } catch (err) {
      if (DEBUG) console.log('Parse error:', err);
    }
  };

  websocket.onerror = (err) => {
    if (DEBUG) console.log('WebSocket error:', err);
  };

  websocket.onclose = (event) => {
    if (DEBUG) console.log('WebSocket closed:', event.code, event.reason);

    if (isRunning && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
      reconnectAttempts++;
      const delay = Math.pow(2, reconnectAttempts) * RECONNECT_BACKOFF_BASE_MS;
      if (DEBUG) console.log('Reconnecting in', delay, 'ms, attempt', reconnectAttempts);
      setTimeout(() => connectWebSocket(), delay);
    } else if (isRunning && reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      chrome.runtime.sendMessage({
        type: 'capture-error',
        target: 'background',
        error: 'WebSocket connection lost after ' + MAX_RECONNECT_ATTEMPTS + ' reconnect attempts'
      });
    }
  };
}

function stopCapture() {
  isRunning = false;

  if (websocket) {
    try {
      if (websocket.readyState === WebSocket.OPEN) {
        websocket.send(JSON.stringify({ type: 'CloseStream' }));
      }
      websocket.close();
    } catch (e) {
      if (DEBUG) console.log('Error closing websocket:', e);
    }
    websocket = null;
  }

  if (workletNode) {
    workletNode.disconnect();
    workletNode = null;
  }

  if (audioPlayback) {
    audioPlayback.pause();
    audioPlayback.srcObject = null;
    audioPlayback = null;
  }

  if (audioContext) {
    audioContext.close().catch(() => {});
    audioContext = null;
  }

  if (mediaStream) {
    mediaStream.getTracks().forEach((track) => track.stop());
    mediaStream = null;
  }

  currentApiKey = null;
}
