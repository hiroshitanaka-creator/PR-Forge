function createOkResponse(requestMeta, data, meta) {
return deepFreeze({
status: DEFAULT_RESPONSE_STATUS_OK,
requestId: requestMeta && requestMeta.requestId ? requestMeta.requestId : '',
type: requestMeta && requestMeta.type ? requestMeta.type : '',
data: cloneValue(data),
meta: isPlainObject(meta) ? cloneValue(meta) : createNullObject()
});
}

function createErrorResponse(requestMeta, error, meta) {
const normalizedError = normalizeServiceWorkerError(
error,
'Service worker request failed.',
{
requestType: requestMeta && requestMeta.type ? requestMeta.type : '',
requestId: requestMeta && requestMeta.requestId ? requestMeta.requestId : ''
}
);

return deepFreeze({
  status: DEFAULT_RESPONSE_STATUS_ERROR,
  requestId: requestMeta && requestMeta.requestId ? requestMeta.requestId : '',
  type: requestMeta && requestMeta.type ? requestMeta.type : '',
  error: deepFreeze({
    code: normalizedError.code,
    message: normalizedError.message,
    details: cloneValue(normalizedError.details)
  }),
  meta: isPlainObject(meta) ? cloneValue(meta) : createNullObject()
});

}

function createBroadcastMessage(type, payload, meta) {
return deepFreeze({
__maoeBroadcast: true,
type: normalizeString(type),
requestId: createRequestId('broadcast'),
payload: cloneValue(payload),
meta: mergePlainObjects(
{
source: 'service_worker',
at: nowIsoString()
},
stableObject(meta)
)
});
}

function getCachedWorkflowStateSync() {
if (typeof stateStore.getCachedWorkflowState === 'function') {
try {
return stateStore.getCachedWorkflowState();
} catch (error) {
}
}

return normalizeWorkflowStateFromAny(DEFAULTS.workflow);

}

function getCachedBootstrapStateSync() {
if (typeof stateStore.getCachedBootstrapState === 'function') {
try {
return stateStore.getCachedBootstrapState();
} catch (error) {
}
}

return {
  workflow: cloneValue(DEFAULTS.workflow || createNullObject())
};

}

function summarizeStageArtifact(artifact) {
const source = isPlainObject(artifact) ? artifact : createNullObject();

return deepFreeze({
  ok: normalizeBoolean(source.ok, false),
  kind: normalizeString(source.kind),
  stage: normalizeLowerString(source.stage),
  providerId: normalizeLowerString(source.providerId),
  providerLabel: normalizeString(source.providerLabel),
  targetFile: normalizeString(source.targetFile),
  promptLength: coerceText(source.promptText).length,
  packetLength: coerceText(source.packetText).length,
  errorCount: Array.isArray(source.errors) ? source.errors.length : 0,
  warningCount: Array.isArray(source.warnings) ? source.warnings.length : 0,
  metadata: stableObject(source.metadata)
});

}

function ensureTabRegistry() {
ensureRuntimeState();

if (!isPlainObject(runtimeState.tabsById)) {
  runtimeState.tabsById = Object.create(null);
}

return runtimeState.tabsById;

}

function normalizeUrl(value) {
return normalizeString(value);
}

function detectSiteFromUrl(url) {
const normalizedUrl = normalizeUrl(url);
const fallback = {
url: normalizedUrl,
host: '',
siteId: '',
providerId: '',
displayName: ''
};

if (!normalizedUrl) {
  return fallback;
}

try {
  const parsed = new URL(normalizedUrl);
  fallback.host = normalizeLowerString(parsed.hostname);
} catch (error) {
}

if (CONSTANT_HELPERS && typeof CONSTANT_HELPERS.getSiteByUrl === 'function') {
  try {
    const site = CONSTANT_HELPERS.getSiteByUrl(normalizedUrl);

    if (site) {
      fallback.siteId = normalizeString(site.id);
      fallback.providerId = normalizeLowerString(site.providerId);
      fallback.displayName = normalizeString(site.displayName);
      return fallback;
    }
  } catch (error) {
  }
}

if (Array.isArray(constants.SITES)) {
  for (const site of constants.SITES) {
    if (!site || !Array.isArray(site.hostnames)) {
      continue;
    }

    const hostnames = site.hostnames.map(function mapHostname(hostname) {
      return normalizeLowerString(hostname);
    });

    if (hostnames.indexOf(fallback.host) >= 0) {
      fallback.siteId = normalizeString(site.id);
      fallback.providerId = normalizeLowerString(site.providerId);
      fallback.displayName = normalizeString(site.displayName);
      break;
    }
  }
}

return fallback;

}

function normalizeTabContext(context) {
const source = isPlainObject(context) ? context : createNullObject();
const tabId = normalizeIntegerOrNull(source.tabId);
const url = normalizeUrl(source.url);
const detected = detectSiteFromUrl(url);

return deepFreeze({
  tabId: tabId,
  windowId: normalizeIntegerOrNull(source.windowId),
  title: normalizeString(source.title),
  url: url,
  host: detected.host,
  siteId: normalizeString(source.siteId) || detected.siteId,
  providerId: normalizeLowerString(source.providerId) || detected.providerId,
  displayName: normalizeString(source.displayName) || detected.displayName,
  status: normalizeString(source.status),
  detectedAt: normalizeString(source.detectedAt) || nowIsoString(),
  lastSeenAt: normalizeString(source.lastSeenAt) || nowIsoString(),
  lastProbeAt: normalizeString(source.lastProbeAt),
  lastOutputAt: normalizeString(source.lastOutputAt),
  lastOutputKind: normalizeString(source.lastOutputKind),
  lastOutputLength: normalizePositiveInteger(source.lastOutputLength || 0, 1) - 1,
  stageAtLastProbe: normalizeLowerString(source.stageAtLastProbe),
  ready: normalizeBoolean(source.ready, false)
});

}

function upsertTabContextFromSender(sender, payload, options) {
const sourcePayload = isPlainObject(payload) ? payload : createNullObject();
const sourceOptions = isPlainObject(options) ? options : createNullObject();
const tab = sender && sender.tab ? sender.tab : createNullObject();
const tabId = normalizeIntegerOrNull(sourcePayload.tabId || tab.id);
const existing = tabId === null
? createNullObject()
: (hasOwn(ensureTabRegistry(), String(tabId)) ? ensureTabRegistry()[String(tabId)] : createNullObject());
const url = normalizeUrl(sourcePayload.url || tab.url || existing.url);
const detected = detectSiteFromUrl(url);
const context = normalizeTabContext({
tabId: tabId,
windowId: normalizeIntegerOrNull(tab.windowId || sourcePayload.windowId || existing.windowId),
title: normalizeString(tab.title || sourcePayload.title || existing.title),
url: url,
siteId: normalizeString(sourcePayload.siteId || existing.siteId || detected.siteId),
providerId: normalizeLowerString(sourcePayload.providerId || existing.providerId || detected.providerId),
displayName: normalizeString(sourcePayload.displayName || existing.displayName || detected.displayName),
status: normalizeString(tab.status || sourcePayload.status || existing.status),
detectedAt: normalizeString(existing.detectedAt) || nowIsoString(),
lastSeenAt: nowIsoString(),
lastProbeAt: sourceOptions.probed === true ? nowIsoString() : normalizeString(existing.lastProbeAt),
lastOutputAt: normalizeString(existing.lastOutputAt),
lastOutputKind: normalizeString(existing.lastOutputKind),
lastOutputLength: normalizeIntegerOrNull(existing.lastOutputLength),
stageAtLastProbe: normalizeString(sourceOptions.stage || existing.stageAtLastProbe),
ready: normalizeBoolean(sourcePayload.ready, existing.ready)
});

if (tabId === null) {
  return context;
}

ensureTabRegistry()[String(tabId)] = cloneValue(context);
return context;

}

function updateTabCapture(tabId, rawText, kind) {
const normalizedTabId = normalizeIntegerOrNull(tabId);

if (normalizedTabId === null) {
  return null;
}

const registry = ensureTabRegistry();

if (!hasOwn(registry, String(normalizedTabId))) {
  return null;
}

const current = normalizeTabContext(registry[String(normalizedTabId)]);
const next = normalizeTabContext(mergePlainObjects(current, {
  lastOutputAt: nowIsoString(),
  lastOutputKind: normalizeString(kind),
  lastOutputLength: coerceText(rawText).length
}));

registry[String(normalizedTabId)] = cloneValue(next);
return next;

}

function removeTabContext(tabId) {
const normalizedTabId = normalizeIntegerOrNull(tabId);

if (normalizedTabId === null) {
  return false;
}

const registry = ensureTabRegistry();

if (!hasOwn(registry, String(normalizedTabId))) {
  return false;
}

delete registry[String(normalizedTabId)];
return true;

}

function getTabContext(tabId) {
const normalizedTabId = normalizeIntegerOrNull(tabId);

if (normalizedTabId === null) {
  return null;
}

const registry = ensureTabRegistry();

if (!hasOwn(registry, String(normalizedTabId))) {
  return null;
}

return freezeClone(registry[String(normalizedTabId)]);

}

function getTabContexts() {
const registry = ensureTabRegistry();
const contexts = [];

for (const key of Object.keys(registry)) {
  contexts.push(normalizeTabContext(registry[key]));
}

contexts.sort(function sortContexts(left, right) {
  const leftSeen = Date.parse(left.lastSeenAt || left.detectedAt || '');
  const rightSeen = Date.parse(right.lastSeenAt || right.detectedAt || '');
  const safeLeftSeen = Number.isFinite(leftSeen) ? leftSeen : 0;
  const safeRightSeen = Number.isFinite(rightSeen) ? rightSeen : 0;

  if (safeLeftSeen !== safeRightSeen) {
    return safeRightSeen - safeLeftSeen;
  }

  return (left.tabId || 0) - (right.tabId || 0);
});

return freezeClone(contexts);

}

function clearCaches() {
runtimeState.tabsById = Object.create(null);
return true;
}

function queryTabs(queryInfo) {
return new Promise(function executor(resolve, reject) {
try {
if (typeof chrome === 'undefined' || !chrome.tabs || typeof chrome.tabs.query !== 'function') {
resolve([]);
return;
}

    chrome.tabs.query(queryInfo, function onQuery(tabs) {
      const runtimeError = chrome.runtime && chrome.runtime.lastError ? chrome.runtime.lastError : null;

      if (runtimeError) {
        reject(createOrchestratorError(
          ERROR_CODES.UNKNOWN_ERROR || 'UNKNOWN_ERROR',
          runtimeError.message || 'Failed to query tabs.',
          {
            queryInfo: stableObject(queryInfo)
          }
        ));
        return;
      }

      resolve(Array.isArray(tabs) ? tabs : []);
    });
  } catch (error) {
    reject(normalizeServiceWorkerError(
      error,
      'Failed to query tabs.',
      {
        queryInfo: stableObject(queryInfo)
      }
    ));
  }
});

}

function getTab(tabId) {
return new Promise(function executor(resolve, reject) {
try {
if (typeof chrome === 'undefined' || !chrome.tabs || typeof chrome.tabs.get !== 'function') {
resolve(null);
return;
}

    chrome.tabs.get(tabId, function onGet(tab) {
      const runtimeError = chrome.runtime && chrome.runtime.lastError ? chrome.runtime.lastError : null;

      if (runtimeError) {
        reject(createOrchestratorError(
          ERROR_CODES.UNKNOWN_ERROR || 'UNKNOWN_ERROR',
          runtimeError.message || 'Failed to get tab.',
          {
            tabId: tabId
          }
        ));
        return;
      }

      resolve(tab || null);
    });
  } catch (error) {
    reject(normalizeServiceWorkerError(
      error,
      'Failed to get tab.',
      {
        tabId: tabId
      }
    ));
  }
});

}

async function getActiveTab() {
const tabs = await queryTabs({
active: true,
lastFocusedWindow: true
});

return tabs.length > 0 ? tabs[0] : null;

}

function sendMessageToTab(tabId, message, options) {
const config = isPlainObject(options) ? options : createNullObject();

return new Promise(function executor(resolve, reject) {
  try {
    if (typeof chrome === 'undefined' || !chrome.tabs || typeof chrome.tabs.sendMessage !== 'function') {
      reject(createOrchestratorError(
        ERROR_CODES.MESSAGE_UNSUPPORTED || 'MESSAGE_UNSUPPORTED',
        'chrome.tabs.sendMessage is unavailable.',
        {
          tabId: tabId,
          messageType: normalizeString(message && message.type)
        }
      ));
      return;
    }

    chrome.tabs.sendMessage(tabId, message, function onSend(response) {
      const runtimeError = chrome.runtime && chrome.runtime.lastError ? chrome.runtime.lastError : null;

      if (runtimeError) {
        const normalizedError = createOrchestratorError(
          ERROR_CODES.MESSAGE_UNSUPPORTED || 'MESSAGE_UNSUPPORTED',
          runtimeError.message || 'Failed to send a message to the tab.',
          {
            tabId: tabId,
            messageType: normalizeString(message && message.type)
          }
        );

        if (normalizeBoolean(config.ignoreMissingReceiver, false)
          && /Receiving end does not exist/i.test(normalizedError.message)) {
          resolve(null);
          return;
        }

        reject(normalizedError);
        return;
      }

      resolve(response);
    });
  } catch (error) {
    reject(normalizeServiceWorkerError(
      error,
      'Failed to send a message to the tab.',
      {
        tabId: tabId,
        messageType: normalizeString(message && message.type)
      }
    ));
  }
});

}

function fireAndForgetSendMessageToTab(tabId, message) {
try {
if (typeof chrome === 'undefined' || !chrome.tabs || typeof chrome.tabs.sendMessage !== 'function') {
return;
}

  chrome.tabs.sendMessage(tabId, message, function onSend() {
    void (chrome.runtime && chrome.runtime.lastError);
  });
} catch (error) {
}

}

function fireAndForgetRuntimeMessage(message) {
try {
if (typeof chrome === 'undefined' || !chrome.runtime || typeof chrome.runtime.sendMessage !== 'function') {
return;
}

  chrome.runtime.sendMessage(message, function onSend() {
    void (chrome.runtime && chrome.runtime.lastError);
  });
} catch (error) {
}

}

function broadcastMessage(message, options) {
const config = isPlainObject(options) ? options : createNullObject();
const normalizedMessage = deepFreeze(cloneValue(message));

runtimeState.lastBroadcastAt = nowIsoString();

fireAndForgetRuntimeMessage(normalizedMessage);

if (normalizeBoolean(hasOwn(config, 'toTabs') ? config.toTabs : true, true) !== true) {
  return;
}

const contexts = getTabContexts();

for (const context of contexts) {
  if (context.tabId === null) {
    continue;
  }

  fireAndForgetSendMessageToTab(context.tabId, normalizedMessage);
}

}

async function resolveTargetTab(payload, preferences) {
const source = isPlainObject(payload) ? payload : createNullObject();
const prefs = isPlainObject(preferences) ? preferences : createNullObject();
const preferredProviderId = normalizeLowerString(
source.providerId
|| prefs.providerId
|| prefs.preferredProviderId
|| ''
);
const explicitTabId = normalizeIntegerOrNull(source.tabId || source.targetTabId);

if (explicitTabId !== null) {
  return getTab(explicitTabId);
}

const activeTab = await getActiveTab();

if (activeTab) {
  const activeDetected = detectSiteFromUrl(activeTab.url);

  if (!preferredProviderId
    || !activeDetected.providerId
    || activeDetected.providerId === preferredProviderId) {
    return activeTab;
  }
}

const contexts = getTabContexts();

for (const context of contexts) {
  if (context.tabId === null) {
    continue;
  }

  if (!preferredProviderId || context.providerId === preferredProviderId) {
    try {
      const tab = await getTab(context.tabId);
      if (tab) {
        return tab;
      }
    } catch (error) {
    }
  }
}

if (activeTab) {
  return activeTab;
}

const allTabs = await queryTabs({});

for (const tab of allTabs) {
  const detected = detectSiteFromUrl(tab && tab.url);

  if (!preferredProviderId || detected.providerId === preferredProviderId) {
    return tab;
  }
}

if (allTabs.length > 0) {
  return allTabs[0];
}

throw createOrchestratorError(
  ERROR_CODES.MESSAGE_UNSUPPORTED || 'MESSAGE_UNSUPPORTED',
  'No suitable tab is available.',
  {
    preferredProviderId: preferredProviderId
  }
);

}

function normalizeGitHubAuthSnapshot(value) {
return isPlainObject(value)
? cloneValue(value)
: cloneValue(isPlainObject(DEFAULTS.githubAuth) ? DEFAULTS.githubAuth : createNullObject());
}

function normalizeSettingsSnapshot(value) {
return isPlainObject(value)
? cloneValue(value)
: cloneValue(isPlainObject(DEFAULTS.settings) ? DEFAULTS.settings : createNullObject());
}

function normalizeRepositorySnapshot(value) {
return isPlainObject(value)
? cloneValue(value)
: cloneValue(isPlainObject(DEFAULTS.repository) ? DEFAULTS.repository : createNullObject());
}

function normalizeUiSnapshot(value) {
return isPlainObject(value)
? cloneValue(value)
: cloneValue(isPlainObject(DEFAULTS.ui) ? DEFAULTS.ui : createNullObject());
}

function normalizeManualHubSnapshot(value) {
return isPlainObject(value)
? cloneValue(value)
: cloneValue(isPlainObject(DEFAULTS.manualHub) ? DEFAULTS.manualHub : createNullObject());
}

function normalizeAuthUpdatePayload(payload, currentAuth) {
const source = isPlainObject(payload) ? payload : createNullObject();
const current = normalizeGitHubAuthSnapshot(currentAuth);
const authSource = mergePlainObjects(
isPlainObject(source.githubAuth) ? source.githubAuth : createNullObject()
);
const next = cloneValue(current);
let changed = false;

if (hasOwn(source, 'personalAccessToken')) {
  authSource.personalAccessToken = source.personalAccessToken;
}

if (hasOwn(source, 'token')) {
  authSource.personalAccessToken = source.token;
}

if (hasOwn(source, 'tokenType')) {
  authSource.tokenType = source.tokenType;
}

if (hasOwn(source, 'clearToken') && normalizeBoolean(source.clearToken, false)) {
  authSource.personalAccessToken = '';
}

if (hasOwn(authSource, 'personalAccessToken')) {
  next.personalAccessToken = normalizeString(authSource.personalAccessToken);
  changed = true;
}

if (hasOwn(authSource, 'tokenType')) {
  next.tokenType = normalizeString(authSource.tokenType) || next.tokenType || 'PAT';
  changed = true;
}

if (hasOwn(authSource, 'username')) {
  next.username = normalizeString(authSource.username);
  changed = true;
}

if (hasOwn(authSource, 'lastValidatedAt')) {
  next.lastValidatedAt = normalizeString(authSource.lastValidatedAt);
  changed = true;
}

return {
  changed: changed,
  next: next
};

}
