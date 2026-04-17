importScripts(
  '../common/namespace.js',
  '../common/constants.js',
  '../common/logger.js',
  '../common/storage.js',
  '../common/protocol.js',
  '../common/parsers/fenced_block_parser.js',
  '../common/parsers/ai_payload_parser.js',
  'github_api.js',
  'github_issue_service.js',
  'github_repo_service.js',
  'github_pr_service.js',
  'state_store.js',
  'orchestrator.js'
);

const root = self.MAOE;

if (!root || typeof root.require !== 'function') {
  throw new Error('[MAOE] namespace.js failed to initialize.');
}

const constants = root.has('constants') ? root.require('constants') : Object.create(null);
const protocol = root.has('protocol') ? root.require('protocol') : Object.create(null);
const stateStore = root.has('state_store') ? root.require('state_store') : Object.create(null);
const orchestrator = root.has('orchestrator') ? root.require('orchestrator') : Object.create(null);
const githubApi = root.has('github_api') ? root.require('github_api') : Object.create(null);
const loggerModule = root.has('logger') ? root.require('logger') : null;
const logger = (loggerModule && typeof loggerModule.createScope === 'function')
  ? loggerModule.createScope('service_worker')
  : (loggerModule || { debug() {}, info() {}, warn() {}, error() {} });

const DEFAULTS = constants.DEFAULTS || Object.create(null);
const ERROR_CODES = constants.ERROR_CODES || Object.create(null);
const CONSTANT_HELPERS = constants.helpers || Object.create(null);
const MESSAGING = constants.MESSAGING || Object.create(null);
const MESSAGE_TYPES = MESSAGING.TYPES || Object.create(null);
const RESPONSE_STATUS = MESSAGING.RESPONSE_STATUS || Object.create(null);
const DEFAULT_RESPONSE_STATUS_OK = RESPONSE_STATUS.OK || 'ok';
const DEFAULT_RESPONSE_STATUS_ERROR = RESPONSE_STATUS.ERROR || 'error';

const util = root.util || Object.create(null);

function createNullObject() {
  return Object.create(null);
}

function nowIsoString() {
  return new Date().toISOString();
}

const isPlainObject = typeof util.isPlainObject === 'function'
  ? util.isPlainObject
  : function isPlainObjectFallback(value) {
    if (value === null || typeof value !== 'object') {
      return false;
    }
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
  };

const hasOwn = typeof util.hasOwn === 'function'
  ? util.hasOwn
  : function hasOwnFallback(target, key) {
    return target !== null && typeof target === 'object' && Object.prototype.hasOwnProperty.call(target, key);
  };

const cloneValue = typeof util.cloneValue === 'function'
  ? util.cloneValue
  : function cloneValueFallback(value) {
    if (value === null || typeof value !== 'object') {
      return value;
    }
    try {
      return JSON.parse(JSON.stringify(value));
    } catch (error) {
      return value;
    }
  };

const deepFreeze = typeof util.deepFreeze === 'function'
  ? util.deepFreeze
  : function deepFreezeFallback(value) {
    return value;
  };

const freezeClone = typeof util.freezeClone === 'function'
  ? util.freezeClone
  : function freezeCloneFallback(value) {
    return deepFreeze(cloneValue(value));
  };

const mergePlainObjects = typeof util.mergePlainObjects === 'function'
  ? util.mergePlainObjects
  : function mergePlainObjectsFallback() {
    const output = Object.create(null);
    for (const source of arguments) {
      if (!isPlainObject(source)) {
        continue;
      }
      for (const key of Object.keys(source)) {
        output[key] = source[key];
      }
    }
    return output;
  };

const stableObject = typeof util.stableObject === 'function'
  ? util.stableObject
  : function stableObjectFallback(value) {
    return isPlainObject(value) ? cloneValue(value) : createNullObject();
  };

const coerceText = typeof util.coerceText === 'function'
  ? util.coerceText
  : function coerceTextFallback(value) {
    if (value === null || typeof value === 'undefined') {
      return '';
    }
    return typeof value === 'string' ? value : String(value);
  };

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeLowerString(value) {
  return normalizeString(value).toLowerCase();
}

function normalizeBoolean(value, fallbackValue) {
  if (value === true || value === false) {
    return value;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1') {
      return true;
    }
    if (normalized === 'false' || normalized === '0') {
      return false;
    }
  }
  return fallbackValue === true;
}

function normalizeIntegerOrNull(value) {
  if (value === null || typeof value === 'undefined' || value === '') {
    return null;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return Math.trunc(numeric);
}

function normalizePositiveInteger(value, fallbackValue) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 1) {
    return Math.max(1, Math.trunc(Number(fallbackValue) || 1));
  }
  return Math.max(1, Math.trunc(numeric));
}

function normalizeNonNegativeInteger(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return 0;
  }
  return Math.trunc(numeric);
}

function createRequestId(prefix) {
  const safePrefix = normalizeString(prefix) || 'request';
  const time = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 10);
  return safePrefix + ':' + time + ':' + random;
}

function createOrchestratorError(code, message, details) {
  const error = new Error(normalizeString(message) || 'Service worker error.');
  error.name = 'MAOEServiceWorkerError';
  error.code = normalizeString(code) || (ERROR_CODES.UNKNOWN_ERROR || 'UNKNOWN_ERROR');
  error.details = isPlainObject(details) ? cloneValue(details) : createNullObject();
  return error;
}

function normalizeServiceWorkerError(error, fallbackMessage, context) {
  const fallback = normalizeString(fallbackMessage) || 'Service worker request failed.';
  const ctx = isPlainObject(context) ? context : createNullObject();

  if (error && typeof error === 'object') {
    return {
      code: normalizeString(error.code) || (ERROR_CODES.UNKNOWN_ERROR || 'UNKNOWN_ERROR'),
      message: normalizeString(error.message) || fallback,
      details: isPlainObject(error.details)
        ? mergePlainObjects(ctx, error.details)
        : ctx
    };
  }

  return {
    code: ERROR_CODES.UNKNOWN_ERROR || 'UNKNOWN_ERROR',
    message: normalizeString(error) || fallback,
    details: ctx
  };
}

function normalizeWorkflowStateFromAny(value) {
  if (orchestrator && orchestrator.helpers
    && typeof orchestrator.helpers.normalizeWorkflowStateFromAny === 'function') {
    return orchestrator.helpers.normalizeWorkflowStateFromAny(value);
  }
  return cloneValue(isPlainObject(value) ? value : (DEFAULTS.workflow || createNullObject()));
}

const runtimeState = {
  tabsById: Object.create(null),
  lastBroadcastAt: ''
};

function ensureRuntimeState() {
  if (!isPlainObject(runtimeState.tabsById)) {
    runtimeState.tabsById = Object.create(null);
  }
  return runtimeState;
}

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
  lastOutputLength: normalizeNonNegativeInteger(source.lastOutputLength),
  stageAtLastProbe: normalizeLowerString(source.stageAtLastProbe),
  ready: normalizeBoolean(source.ready, false)
});

}

function upsertTabContextFromSender(sender, payload, options) {
const sourcePayload = isPlainObject(payload) ? payload : createNullObject();
const sourceOptions = isPlainObject(options) ? options : createNullObject();
const tab = sender && sender.tab ? sender.tab : createNullObject();
const tabId = normalizeIntegerOrNull(sourcePayload.tabId ?? tab.id);
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
const restrictToProviderId = normalizeLowerString(config.providerId);
const restrictToTabId = normalizeIntegerOrNull(config.tabId);

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

  if (restrictToTabId !== null && context.tabId !== restrictToTabId) {
    continue;
  }

  if (restrictToProviderId && context.providerId !== restrictToProviderId) {
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

const MESSAGE_DISPATCH_TABLE = Object.freeze({
  [MESSAGE_TYPES.POPUP_GET_BOOTSTRAP]: function handleGetBootstrap() {
    return typeof orchestrator.getBootstrapState === 'function'
      ? orchestrator.getBootstrapState()
      : getCachedBootstrapStateSync();
  },
  [MESSAGE_TYPES.POPUP_GET_WORKFLOW_STATE]: function handleGetWorkflow() {
    return typeof orchestrator.getWorkflowState === 'function'
      ? orchestrator.getWorkflowState()
      : getCachedWorkflowStateSync();
  },
  [MESSAGE_TYPES.POPUP_GET_EVENT_LOG]: function handleGetEventLog(payload) {
    if (typeof orchestrator.getEventLog === 'function') {
      return orchestrator.getEventLog(payload);
    }
    return [];
  },
  [MESSAGE_TYPES.POPUP_LOAD_ISSUES]: function handleLoadIssues(payload) {
    return orchestrator.loadIssues ? orchestrator.loadIssues(payload) : null;
  },
  [MESSAGE_TYPES.POPUP_LOAD_REPO_TREE]: function handleLoadRepoTree(payload) {
    return orchestrator.loadRepositoryTree ? orchestrator.loadRepositoryTree(payload) : null;
  },
  [MESSAGE_TYPES.POPUP_SELECT_ISSUE]: function handleSelectIssue(payload) {
    if (typeof orchestrator.selectIssue !== 'function') {
      return null;
    }
    const source = isPlainObject(payload) ? payload : createNullObject();
    const issueOrNumber = typeof source.issueNumber !== 'undefined'
      ? source.issueNumber
      : (isPlainObject(source.issue) ? source.issue : source);
    return orchestrator.selectIssue(issueOrNumber, source);
  },
  [MESSAGE_TYPES.POPUP_SUBMIT_HUMAN_PAYLOAD]: function handleSubmitPayload(payload) {
    return orchestrator.submitHumanPayload ? orchestrator.submitHumanPayload(payload) : null;
  },
  [MESSAGE_TYPES.POPUP_ADVANCE_STAGE]: function handleAdvanceStage(payload) {
    return orchestrator.advanceStage ? orchestrator.advanceStage(payload) : null;
  },
  [MESSAGE_TYPES.POPUP_RESET_WORKFLOW]: function handleResetWorkflow(payload) {
    return orchestrator.resetWorkflow ? orchestrator.resetWorkflow(payload) : null;
  },
  [MESSAGE_TYPES.POPUP_BUILD_DESIGN_ARTIFACT]: function handleBuildDesignArtifact(payload) {
    return orchestrator.buildDesignArtifact ? orchestrator.buildDesignArtifact(payload) : null;
  },
  [MESSAGE_TYPES.POPUP_BUILD_CURRENT_ARTIFACT]: function handleBuildCurrentArtifact(payload) {
    return orchestrator.buildCurrentStageArtifact ? orchestrator.buildCurrentStageArtifact(payload) : null;
  },
  [MESSAGE_TYPES.POPUP_CREATE_PULL_REQUEST]: function handleCreatePullRequest(payload) {
    return orchestrator.createPullRequest ? orchestrator.createPullRequest(payload) : null;
  },
  [MESSAGE_TYPES.POPUP_CLEAR_WORKFLOW_ERROR]: function handleClearWorkflowError(payload) {
    return orchestrator.clearError ? orchestrator.clearError(payload) : null;
  },
  [MESSAGE_TYPES.POPUP_SAVE_GITHUB_SETTINGS]: function handleSaveGithubSettings(payload) {
    if (typeof stateStore.updateGitHubAuth === 'function') {
      const cached = typeof stateStore.getCachedGitHubAuth === 'function'
        ? stateStore.getCachedGitHubAuth()
        : null;
      const normalized = normalizeAuthUpdatePayload(payload, cached);
      if (!normalized.changed) {
        return cached;
      }
      return stateStore.updateGitHubAuth(normalized.next);
    }
    return null;
  },
  [MESSAGE_TYPES.POPUP_SAVE_REPOSITORY_SETTINGS]: function handleSaveRepositorySettings(payload) {
    if (typeof stateStore.updateRepository !== 'function') {
      return null;
    }
    const source = isPlainObject(payload) ? payload : createNullObject();
    const repositoryPatch = isPlainObject(source.repository) ? source.repository : source;
    return stateStore.updateRepository(repositoryPatch).then(function afterRepoSaved(savedRepo) {
      if (isPlainObject(source.agents) && typeof stateStore.updateSettings === 'function') {
        return stateStore.updateSettings({ agents: source.agents }).then(function afterAgentSaved(savedSettings) {
          return { repository: savedRepo, settings: savedSettings };
        });
      }
      return { repository: savedRepo };
    });
  },
  [MESSAGE_TYPES.POPUP_SAVE_AGENT_SETTINGS]: function handleSaveAgentSettings(payload) {
    if (typeof stateStore.updateSettings !== 'function') {
      return null;
    }
    const source = isPlainObject(payload) ? payload : createNullObject();
    const agents = isPlainObject(source.agents) ? source.agents : source;
    return stateStore.updateSettings({ agents: agents });
  },
  [MESSAGE_TYPES.POPUP_VALIDATE_GITHUB_TOKEN]: function handleValidateGithubToken(payload) {
    if (typeof stateStore.updateGitHubAuth !== 'function') {
      return null;
    }
    const cached = typeof stateStore.getCachedGitHubAuth === 'function'
      ? stateStore.getCachedGitHubAuth()
      : null;
    const normalized = normalizeAuthUpdatePayload(payload, cached);
    const savePromise = normalized.changed
      ? stateStore.updateGitHubAuth(normalized.next)
      : Promise.resolve(cached);
    return savePromise.then(function afterSave(saved) {
      if (!githubApi || typeof githubApi.getAuthenticatedUser !== 'function') {
        return saved;
      }
      return githubApi.getAuthenticatedUser({ personalAccessToken: saved && saved.personalAccessToken })
        .then(function onValidated(user) {
          const next = mergePlainObjects(saved || createNullObject(), {
            username: (user && (user.login || user.name)) || (saved && saved.username) || '',
            lastValidatedAt: new Date().toISOString()
          });
          return stateStore.updateGitHubAuth(next);
        })
        .catch(function onValidateFail(error) {
          logger.warn('GitHub token validation failed.', normalizeServiceWorkerError(error, 'validate token failed.', createNullObject()));
          throw error;
        });
    });
  },
  [MESSAGE_TYPES.CONTENT_SITE_DETECTED]: function handleContentSiteDetected(payload, sender) {
    return upsertTabContextFromSender(sender, payload, { probed: true });
  },
  [MESSAGE_TYPES.CONTENT_AI_OUTPUT_CAPTURED]: function handleContentOutputCaptured(payload, sender) {
    const tabId = normalizeIntegerOrNull(payload && payload.tabId) || (sender && sender.tab && sender.tab.id);
    const rawText = coerceText(payload && payload.rawText);
    const kind = normalizeString(payload && payload.kind) || 'ai_output';
    const captured = updateTabCapture(tabId, rawText, kind);
    if (captured && typeof orchestrator.ingestContentCapture === 'function') {
      try {
        orchestrator.ingestContentCapture({ tabId: tabId, rawText: rawText, kind: kind, sender: sender });
      } catch (error) {
        logger.warn('Orchestrator rejected captured AI output.', normalizeServiceWorkerError(error, 'ingestContentCapture failed.', { tabId: tabId }));
      }
    }
    return captured;
  }
});

function resolveHandler(type) {
  const normalizedType = normalizeString(type);
  if (!normalizedType) {
    return null;
  }
  return typeof MESSAGE_DISPATCH_TABLE[normalizedType] === 'function'
    ? MESSAGE_DISPATCH_TABLE[normalizedType]
    : null;
}

function handleRuntimeMessage(message, sender, sendResponse) {
  const requestMeta = {
    requestId: (message && normalizeString(message.requestId)) || createRequestId('req'),
    type: message && normalizeString(message.type)
  };

  const handler = resolveHandler(requestMeta.type);

  if (!handler) {
    sendResponse(createErrorResponse(requestMeta, createOrchestratorError(
      ERROR_CODES.MESSAGE_UNSUPPORTED || 'MESSAGE_UNSUPPORTED',
      'Unsupported message type.',
      { type: requestMeta.type }
    )));
    return false;
  }

  let result;
  try {
    result = handler(message && message.payload, sender);
  } catch (error) {
    sendResponse(createErrorResponse(requestMeta, error));
    return false;
  }

  if (result && typeof result.then === 'function') {
    result.then(
      function onResolve(value) {
        try {
          sendResponse(createOkResponse(requestMeta, value));
        } catch (error) {
          logger.warn('Failed to deliver async response.', normalizeServiceWorkerError(error, 'sendResponse failed.', { type: requestMeta.type }));
        }
      },
      function onReject(error) {
        try {
          sendResponse(createErrorResponse(requestMeta, error));
        } catch (sendError) {
          logger.warn('Failed to deliver async error.', normalizeServiceWorkerError(sendError, 'sendResponse failed.', { type: requestMeta.type }));
        }
      }
    );
    return true;
  }

  sendResponse(createOkResponse(requestMeta, result));
  return false;
}

if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener(function onRuntimeMessage(message, sender, sendResponse) {
    if (!isPlainObject(message)) {
      return false;
    }
    if (sender && sender.tab && sender.tab.id) {
      try {
        upsertTabContextFromSender(sender, {}, {});
      } catch (error) {
      }
    }
    return handleRuntimeMessage(message, sender, sendResponse);
  });
}

if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.onRemoved) {
  chrome.tabs.onRemoved.addListener(function onTabRemoved(tabId) {
    removeTabContext(tabId);
  });
}

if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.onUpdated) {
  chrome.tabs.onUpdated.addListener(function onTabUpdated(tabId, changeInfo, tab) {
    if (!tab || !tab.url) {
      return;
    }
    try {
      upsertTabContextFromSender({ tab: tab }, {}, {});
    } catch (error) {
    }
  });
}

if (typeof stateStore.subscribe === 'function') {
  try {
    stateStore.subscribe(function onStateChanged(eventPayload) {
      broadcastMessage(createBroadcastMessage(
        MESSAGE_TYPES.BACKGROUND_STATE_CHANGED || 'BACKGROUND/STATE_CHANGED',
        eventPayload,
        { source: 'state_store' }
      ));
    });
  } catch (error) {
    logger.warn('Failed to subscribe to state store changes.', normalizeServiceWorkerError(error, 'stateStore.subscribe failed.', createNullObject()));
  }
}

if (typeof orchestrator.ensureInitialized === 'function') {
  Promise.resolve().then(function initializeOrchestrator() {
    return orchestrator.ensureInitialized();
  }).catch(function onInitializeFailure(error) {
    logger.error('Failed to initialize orchestrator.', normalizeServiceWorkerError(error, 'orchestrator.ensureInitialized failed.', createNullObject()));
  });
}

