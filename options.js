const MESSAGE_DISPLAY_MS = 2000;

const apiKeyInput = document.getElementById('api-key');
const btnSave = document.getElementById('btn-save');
const messageEl = document.getElementById('message');

chrome.storage.local.get('deepgramApiKey', (result) => {
  if (result.deepgramApiKey) {
    apiKeyInput.value = result.deepgramApiKey;
  }
});

btnSave.addEventListener('click', () => {
  const key = apiKeyInput.value.trim();

  if (!key) {
    showMessage('Enter an API key', 'error');
    return;
  }

  chrome.storage.local.set({ deepgramApiKey: key }, () => {
    showMessage('Saved!', 'success');
  });
});

function showMessage(text, type) {
  messageEl.textContent = text;
  messageEl.className = 'message ' + type;

  setTimeout(() => {
    messageEl.textContent = '';
    messageEl.className = 'message';
  }, MESSAGE_DISPLAY_MS);
}
