const DEBUG = false;

async function getApiKey() {
  const result = await chrome.storage.local.get('deepgramApiKey');
  return result.deepgramApiKey || null;
}
