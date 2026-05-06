/**
 * WorkTrack Card Creator — API communication layer.
 *
 * All HTTP calls to the Netlify Functions go through here.
 * Uses Script Properties for configuration:
 *   API_KEY      — GMAIL_ADDON_API_KEY value
 *   API_BASE_URL — e.g. https://your-app.netlify.app
 */

/**
 * Returns the API key from Script Properties.
 */
function getApiKey() {
  return PropertiesService.getScriptProperties().getProperty('API_KEY') || '';
}

/**
 * Returns the base URL from Script Properties (no trailing slash).
 */
function getBaseUrl() {
  var url = PropertiesService.getScriptProperties().getProperty('API_BASE_URL') || '';
  return url.replace(/\/+$/, '');
}

/**
 * Fetches the list of boards + columns from the Netlify endpoint.
 * Returns an array of { id, name, columns: [{ id, name }] }.
 * On failure, returns an empty array.
 */
function fetchBoards() {
  var apiKey = getApiKey();
  var baseUrl = getBaseUrl();

  if (!apiKey || !baseUrl) {
    Logger.log('fetchBoards: API_KEY or API_BASE_URL not set in Script Properties.');
    return [];
  }

  try {
    var response = UrlFetchApp.fetch(baseUrl + '/.netlify/functions/boards-for-addon', {
      method: 'get',
      headers: {
        'Authorization': 'Bearer ' + apiKey
      },
      muteHttpExceptions: true
    });

    var code = response.getResponseCode();
    if (code !== 200) {
      Logger.log('fetchBoards: HTTP ' + code + ' — ' + response.getContentText());
      return [];
    }

    var data = JSON.parse(response.getContentText());
    return data.boards || [];
  } catch (e) {
    Logger.log('fetchBoards error: ' + e.message);
    return [];
  }
}

/**
 * Creates a board card via the Netlify endpoint.
 * @param {Object} payload — { boardId, columnId, title, description, emailMetadata, attachments }
 * @returns {Object} — { ok: boolean, cardId?, attachmentCount?, error? }
 */
function createCardViaApi(payload) {
  var apiKey = getApiKey();
  var baseUrl = getBaseUrl();

  if (!apiKey || !baseUrl) {
    return { ok: false, error: 'API_KEY or API_BASE_URL not configured.' };
  }

  try {
    var response = UrlFetchApp.fetch(baseUrl + '/.netlify/functions/create-card-from-email', {
      method: 'post',
      contentType: 'application/json',
      headers: {
        'Authorization': 'Bearer ' + apiKey
      },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });

    var code = response.getResponseCode();
    var body = response.getContentText();

    if (code === 200) {
      var data = JSON.parse(body);
      return {
        ok: true,
        cardId: data.cardId || null,
        attachmentCount: data.attachmentCount || 0
      };
    } else {
      var errorData = {};
      try { errorData = JSON.parse(body); } catch (_) {}
      return {
        ok: false,
        error: errorData.error || ('HTTP ' + code)
      };
    }
  } catch (e) {
    Logger.log('createCardViaApi error: ' + e.message);
    return { ok: false, error: e.message };
  }
}
