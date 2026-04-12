const DEBUG = false;

let audioContext = null;
let mediaStream = null;
let workletNode = null;
let audioPlayback = null;
let websocket = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 3;
let currentApiKey = null;
let isRunning = false;

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'offscreen-start') {
    startCapture(message.streamId, message.apiKey);
  }

  if (message.type === 'offscreen-stop') {
    stopCapture();
  }
});

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
    audioPlayback.play();

    audioContext = new AudioContext({ sampleRate: 16000 });
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
    + '&sample_rate=16000'
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
      const delay = Math.pow(2, reconnectAttempts) * 1000;
      if (DEBUG) console.log('Reconnecting in', delay, 'ms, attempt', reconnectAttempts);
      setTimeout(() => connectWebSocket(), delay);
    } else if (isRunning && reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      chrome.runtime.sendMessage({
        type: 'capture-error',
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
