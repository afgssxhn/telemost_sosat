const MESSAGE_DISPLAY_MS = 2000;
const DEFAULT_CLAUDE_MODEL = 'claude-sonnet-4-20250514';

const apiKeyInput = document.getElementById('api-key');
const claudeModelSelect = document.getElementById('claude-model');
const btnSave = document.getElementById('btn-save');
const messageEl = document.getElementById('message');

chrome.storage.local.get(['deepgramApiKey', 'claudeModel'], (result) => {
  if (result.deepgramApiKey) {
    apiKeyInput.value = result.deepgramApiKey;
  }
  claudeModelSelect.value = result.claudeModel || DEFAULT_CLAUDE_MODEL;
});

btnSave.addEventListener('click', () => {
  const key = apiKeyInput.value.trim();

  if (!key) {
    showMessage('Enter an API key', 'error');
    return;
  }

  chrome.storage.local.set({
    deepgramApiKey: key,
    claudeModel: claudeModelSelect.value
  }, () => {
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
