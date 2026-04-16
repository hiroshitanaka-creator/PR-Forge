(function registerMAOEChatGPTContent(globalScope) { 'use strict';
const root = globalScope.MAOE;

if (!root || typeof root.registerValue !== 'function') {
throw new Error('[MAOE] namespace.js must be loaded before chatgpt_content.js.');
}

if (root.has('chatgpt_content')) {
return;
}

if (!root.has('constants')) {
throw new Error('[MAOE] constants.js must be loaded before chatgpt_content.js.');
}

if (!root.has('content_site_adapter')) {
throw new Error('[MAOE] content_site_adapter.js must be loaded before chatgpt_content.js.');
}

const constants = root.require('constants');
const contentSiteAdapter = root.require('content_site_adapter');
const util = root.util || Object.create(null);

const cloneValue = typeof util.cloneValue === 'function'
? util.cloneValue
: function fallbackClone(value) {
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
: function passthrough(value) {
return value;
};

function createFallbackLogger() {
const consoleObject = typeof console !== 'undefined' ? console : null;

function emit(level, message, context) {
  if (!consoleObject || typeof consoleObject[level] !== 'function') {
    return;
  }

  if (typeof context === 'undefined') {
    consoleObject[level]('[MAOE/chatgpt_content] ' + message);
    return;
  }

  consoleObject[level]('[MAOE/chatgpt_content] ' + message, context);
}

return {
  debug: function debug(message, context) {
    emit('debug', message, context);
  },
  info: function info(message, context) {
    emit('info', message, context);
  },
  warn: function warn(message, context) {
    emit('warn', message, context);
  },
  error: function error(message, context) {
    emit('error', message, context);
  }
};
}

function createScopedLogger() {
if (!root.has('logger')) {
return createFallbackLogger();
}

const loggerModule = root.require('logger');

if (loggerModule && typeof loggerModule.createScope === 'function') {
  try {
    return loggerModule.createScope('chatgpt_content');
  } catch (error) {
  }
}

if (loggerModule
  && typeof loggerModule.debug === 'function'
  && typeof loggerModule.info === 'function'
  && typeof loggerModule.warn === 'function'
  && typeof loggerModule.error === 'function') {
  return loggerModule;
}

return createFallbackLogger();
}

const logger = createScopedLogger();

const APP = constants.APP || Object.create(null);
const PARSER = constants.PARSER || Object.create(null);
const SITES = Array.isArray(constants.SITES) ? constants.SITES.slice() : [];
const MAX_FENCE_BLOCKS = Number.isFinite(Number(PARSER.LIMITS && PARSER.LIMITS.MAX_FENCE_BLOCKS))
? Math.max(1, Math.trunc(Number(PARSER.LIMITS.MAX_FENCE_BLOCKS)))
: 32;

const LEGACY_HOSTS = ['chatgpt.com', 'chat.openai.com'];
const DEFAULT_SITE_ID = 'chatgpt';
const DEFAULT_PROVIDER_ID = 'chatgpt';
const DEFAULT_DISPLAY_NAME = 'ChatGPT';
const DEFAULT_PROTOCOL_VERSION = typeof APP.protocolVersion === 'string' && APP.protocolVersion
? APP.protocolVersion
: '1.0.0';

const runtimeState = root.ensureState('chatgpt_content_runtime', function createRuntimeState() {
return {
adapter: null,
installPromise: null,
installed: false,
historyInstalled: false,
visibilityInstalled: false,
locationChangeScheduled: false,
lastKnownUrl: '',
installAt: '',
lastProbeAt: '',
lastLocationChangeAt: '',
siteDetectedAt: '',
lastError: null
};
});

function createNullObject() {
return Object.create(null);
}

function isPlainObject(value) {
if (value === null || typeof value !== 'object') {
return false;
}

if (Object.prototype.toString.call(value) !== '[object Object]') {
  return false;
}

const prototype = Object.getPrototypeOf(value);
return prototype === Object.prototype || prototype === null;
}

function normalizeString(value) {
return typeof value === 'string' ? value.trim() : '';
}

function normalizeLowerString(value) {
return normalizeString(value).toLowerCase();
}

function coerceText(value) {
if (typeof value === 'string') {
return value;
}

if (value === null || typeof value === 'undefined') {
  return '';
}

return String(value);
}

function normalizeBoolean(value, fallbackValue) {
if (typeof value === 'boolean') {
return value;
}

if (typeof value === 'number') {
  return value !== 0;
}

if (typeof value === 'string') {
  const normalized = value.trim().toLowerCase();

  if (normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on') {
    return true;
  }

  if (normalized === 'false' || normalized === '0' || normalized === 'no' || normalized === 'off') {
    return false;
  }
}

return !!fallbackValue;
}

function nowIsoString() {
return new Date().toISOString();
}

function getCurrentUrl() {
return globalScope.location && globalScope.location.href
? String(globalScope.location.href)
: '';
}

function getCurrentHost() {
return globalScope.location && globalScope.location.hostname
? String(globalScope.location.hostname)
: '';
}

function isSupportedHost(hostname) {
const normalizedHost = normalizeLowerString(hostname);

if (!normalizedHost) {
  return false;
}

if (LEGACY_HOSTS.indexOf(normalizedHost) >= 0) {
  return true;
}

return normalizedHost === 'chatgpt.com'
  || normalizedHost.endsWith('.chatgpt.com')
  || normalizedHost === 'openai.com'
  || normalizedHost.endsWith('.openai.com')
  || normalizedHost === 'chat.openai.com';
}

function findSiteRecord() {
for (const site of SITES) {
if (!site) {
continue;
}

  const providerId = normalizeLowerString(site.providerId);

  if (providerId !== DEFAULT_PROVIDER_ID) {
    continue;
  }

  const hostnames = Array.isArray(site.hostnames) ? site.hostnames : [];

  for (const hostname of hostnames) {
    if (isSupportedHost(hostname)) {
      return site;
    }
  }
}

return null;
}

function resolveSiteId() {
const siteRecord = findSiteRecord();

if (siteRecord && normalizeString(siteRecord.id)) {
  return normalizeString(siteRecord.id);
}

return DEFAULT_SITE_ID;
}

function resolveDisplayName() {
const siteRecord = findSiteRecord();

if (siteRecord && normalizeString(siteRecord.displayName)) {
  return normalizeString(siteRecord.displayName);
}

return DEFAULT_DISPLAY_NAME;
}

function isElementNode(value) {
return !!(value && typeof value === 'object' && value.nodeType === 1);
}

function elementMatchesSelector(element, selector) {
if (!isElementNode(element)) {
return false;
}

const normalizedSelector = normalizeString(selector);

if (!normalizedSelector) {
  return false;
}

const matcher = element.matches || element.webkitMatchesSelector || element.msMatchesSelector;

if (typeof matcher !== 'function') {
  return false;
}

try {
  return matcher.call(element, normalizedSelector);
} catch (error) {
  return false;
}
}

function isElementVisible(element) {
if (!isElementNode(element)) {
return false;
}

if (element.hidden) {
  return false;
}

const style = globalScope.getComputedStyle ? globalScope.getComputedStyle(element) : null;

if (style) {
  if (style.display === 'none' || style.visibility === 'hidden') {
    return false;
  }

  if (style.pointerEvents === 'none' && normalizeString(style.position) === 'fixed') {
    return false;
  }
}

const rect = typeof element.getBoundingClientRect === 'function'
  ? element.getBoundingClientRect()
  : null;

if (!rect) {
  return true;
}

return rect.width > 0 || rect.height > 0;
}

function queryBySelectors(selectors, scope) {
const rootScope = scope && typeof scope.querySelectorAll === 'function'
? scope
: globalScope.document;
const output = [];
const seen = new Set();
const list = Array.isArray(selectors) ? selectors : [];

for (const selector of list) {
  const normalizedSelector = normalizeString(selector);

  if (!normalizedSelector) {
    continue;
  }

  let nodes = [];

  try {
    nodes = Array.prototype.slice.call(rootScope.querySelectorAll(normalizedSelector));
  } catch (error) {
    continue;
  }

  for (const node of nodes) {
    if (!node || seen.has(node)) {
      continue;
    }

    seen.add(node);
    output.push(node);
  }
}

return output;
}

function getPromptCandidates() {
const selectors = [
'textarea[data-testid="prompt-textarea"]',
'textarea#prompt-textarea',
'form textarea',
'[data-testid="composer"] textarea',
'[data-testid="composer"] [contenteditable="true"][role="textbox"]',
'main form [contenteditable="true"][role="textbox"]',
'main [contenteditable="true"][role="textbox"][data-lexical-editor="true"]',
'form [contenteditable="true"][role="textbox"]',
'[contenteditable="true"][role="textbox"]'
];

const nodes = queryBySelectors(selectors, globalScope.document);
return nodes.filter(function filterNode(node) {
  return isElementVisible(node);
});
}

function getPromptElement() {
const candidates = getPromptCandidates();

if (candidates.length === 0) {
  return null;
}

for (const candidate of candidates) {
  if (elementMatchesSelector(candidate, 'textarea[data-testid="prompt-textarea"]')
    || elementMatchesSelector(candidate, 'textarea#prompt-textarea')) {
    return candidate;
  }
}

return candidates[candidates.length - 1];
}

function getSubmitCandidates() {
const selectors = [
'button[data-testid="send-button"]',
'button[aria-label="Send message"]',
'button[aria-label="Send prompt"]',
'button[aria-label^="Send"]',
'form button[type="submit"]'
];

const nodes = queryBySelectors(selectors, globalScope.document);
return nodes.filter(function filterNode(node) {
  if (!isElementVisible(node)) {
    return false;
  }

  if ('disabled' in node && node.disabled) {
    return false;
  }

  if (node.getAttribute && node.getAttribute('aria-disabled') === 'true') {
    return false;
  }

  return true;
});
}

function getSubmitElement() {
const candidates = getSubmitCandidates();

if (candidates.length === 0) {
  return null;
}

for (const candidate of candidates) {
  if (elementMatchesSelector(candidate, 'button[data-testid="send-button"]')) {
    return candidate;
  }
}

return candidates[candidates.length - 1];
}

function getAssistantMessageCandidates() {
const selectors = [
'[data-message-author-role="assistant"]',
'article [data-message-author-role="assistant"]',
'main [data-message-author-role="assistant"]'
];
const nodes = queryBySelectors(selectors, globalScope.document);

return nodes.filter(function filterNode(node) {
  return isElementVisible(node);
});
}

function getResponseElements() {
const candidates = getAssistantMessageCandidates();

if (candidates.length > 0) {
  return candidates;
}

const fallbackSelectors = [
  'main article',
  'main [role="article"]',
  'main .markdown',
  'main .prose'
];
const fallbackNodes = queryBySelectors(fallbackSelectors, globalScope.document);

return fallbackNodes.filter(function filterNode(node) {
  return isElementVisible(node);
});
}

function inferModelName() {
const selectors = [
'button[data-testid="model-switcher-dropdown-button"]',
'[data-testid="conversation-model-selector"] button',
'header button[aria-haspopup="menu"]',
'main header button'
];
const candidates = queryBySelectors(selectors, globalScope.document);

for (const candidate of candidates) {
  const text = coerceText(candidate.innerText || candidate.textContent).trim();

  if (text && text.length <= 64) {
    return text;
  }
}

return '';
}

function stripKnownFooter(text) {
const source = coerceText(text)
.replace(/\r\n/g, '\n')
.replace(/\r/g, '\n')
.trim();
const footerPatterns = [
/\n+ChatGPT can make mistakes[\s\S]$/i,
/\n+Check important info[\s\S]$/i,
/\n+Message ChatGPT[\s\S]*$/i
];
let output = source;

for (const pattern of footerPatterns) {
  output = output.replace(pattern, '').trim();
}

return output;
}

function normalizePromptText(promptText) {
return coerceText(promptText)
.replace(/\r\n/g, '\n')
.replace(/\r/g, '\n');
}

function normalizeResponseText(rawText) {
return stripKnownFooter(rawText);
}

function buildSiteConfig() {
return {
siteId: resolveSiteId(),
providerId: DEFAULT_PROVIDER_ID,
displayName: resolveDisplayName(),
promptTargets: [
'textarea[data-testid="prompt-textarea"]',
'textarea#prompt-textarea',
'form textarea',
'[data-testid="composer"] textarea',
'[data-testid="composer"] [contenteditable="true"][role="textbox"]',
'main form [contenteditable="true"][role="textbox"]',
'main [contenteditable="true"][role="textbox"][data-lexical-editor="true"]',
'form [contenteditable="true"][role="textbox"]',
'[contenteditable="true"][role="textbox"]'
],
submitTargets: [
'button[data-testid="send-button"]',
'button[aria-label="Send message"]',
'button[aria-label="Send prompt"]',
'button[aria-label^="Send"]',
'form button[type="submit"]'
],
responseTargets: [
'[data-message-author-role="assistant"]',
'article [data-message-author-role="assistant"]',
'main [data-message-author-role="assistant"]'
],
readyTargets: [
'textarea[data-testid="prompt-textarea"]',
'textarea#prompt-textarea',
'[contenteditable="true"][role="textbox"]'
],
rootTargets: [
'main',
'#__next',
'body'
],
responseExclusionTargets: [
'[data-message-author-role="user"]'
],
autoNotifySiteDetected: true,
autoObserve: true,
mutationDebounceMs: DEFAULT_MUTATION_DEBOUNCE_MS,
maxFenceBlocks: MAX_FENCE_BLOCKS,
packetFenceLanguage: DEFAULT_PACKET_FENCE_LANGUAGE,
defaultAutoSubmit: false,
supportsFillPrompt: true,
supportsExtraction: true,
useEnterAsSubmitFallback: false,
getPromptElement: function customGetPromptElement() {
return getPromptElement();
},
getSubmitElement: function customGetSubmitElement() {
return getSubmitElement();
},
getResponseElements: function customGetResponseElements() {
return getResponseElements();
},
normalizePromptText: function customNormalizePromptText(text) {
return normalizePromptText(text);
},
normalizeResponseText: function customNormalizeResponseText(text) {
return normalizeResponseText(text);
},
deriveSiteInfo: function deriveSiteInfo(adapter) {
const promptElement = adapter && adapter.helpers && typeof adapter.helpers.locatePromptElement === 'function'
? adapter.helpers.locatePromptElement()
: getPromptElement();
const submitElement = adapter && adapter.helpers && typeof adapter.helpers.locateSubmitElement === 'function'
? adapter.helpers.locateSubmitElement(promptElement)
: getSubmitElement();
const responseElements = adapter && adapter.helpers && typeof adapter.helpers.locateResponseElements === 'function'
? adapter.helpers.locateResponseElements()
: getResponseElements();

    return {
      modelName: inferModelName(),
      promptElementTag: promptElement ? normalizeLowerString(promptElement.tagName) : '',
      promptElementContentEditable: !!(promptElement && promptElement.isContentEditable),
      submitElementFound: !!submitElement,
      responseElementCount: Array.isArray(responseElements) ? responseElements.length : 0,
      protocolVersion: DEFAULT_PROTOCOL_VERSION
    };
  }
};
}

function installHistoryHooks() {
if (runtimeState.historyInstalled === true || !globalScope.history) {
return;
}

runtimeState.historyInstalled = true;

function emitHistoryChange() {
  try {
    globalScope.dispatchEvent(new CustomEvent('maoe:locationchange', {
      detail: {
        url: getCurrentUrl()
      }
    }));
  } catch (error) {
  }
}

const originalPushState = typeof globalScope.history.pushState === 'function'
  ? globalScope.history.pushState
  : null;
const originalReplaceState = typeof globalScope.history.replaceState === 'function'
  ? globalScope.history.replaceState
  : null;

if (originalPushState) {
  globalScope.history.pushState = function patchedPushState() {
    const result = originalPushState.apply(globalScope.history, arguments);
    emitHistoryChange();
    return result;
  };
}

if (originalReplaceState) {
  globalScope.history.replaceState = function patchedReplaceState() {
    const result = originalReplaceState.apply(globalScope.history, arguments);
    emitHistoryChange();
    return result;
  };
}

globalScope.addEventListener('popstate', emitHistoryChange);
globalScope.addEventListener('hashchange', emitHistoryChange);
}

function installVisibilityHooks() {
if (runtimeState.visibilityInstalled === true || !globalScope.document) {
return;
}

runtimeState.visibilityInstalled = true;

globalScope.document.addEventListener('visibilitychange', function onVisibilityChange() {
  if (globalScope.document.visibilityState !== 'visible') {
    return;
  }

  scheduleLocationCheck({
    forceNotify: false
  });
});

globalScope.addEventListener('focus', function onFocus() {
  scheduleLocationCheck({
    forceNotify: false
  });
});
}

function scheduleLocationCheck(options) {
const config = isPlainObject(options) ? options : createNullObject();

if (runtimeState.locationChangeScheduled === true) {
  return;
}

runtimeState.locationChangeScheduled = true;

globalScope.setTimeout(function onLocationCheck() {
  runtimeState.locationChangeScheduled = false;
  void handleLocationChange({
    forceNotify: normalizeBoolean(config.forceNotify, false)
  });
}, 48);
}

async function handleLocationChange(options) {
const config = isPlainObject(options) ? options : createNullObject();
const currentUrl = getCurrentUrl();

if (!currentUrl) {
  return null;
}

const previousUrl = normalizeString(runtimeState.lastKnownUrl);
const changed = previousUrl !== currentUrl;
runtimeState.lastKnownUrl = currentUrl;

if (!runtimeState.adapter) {
  return null;
}

if (!changed && normalizeBoolean(config.forceNotify, false) !== true) {
  try {
    return runtimeState.adapter.probe();
  } catch (error) {
    return null;
  }
}

runtimeState.lastLocationChangeAt = nowIsoString();

try {
  const probeResult = runtimeState.adapter.probe();
  await runtimeState.adapter.notifySiteDetected({
    force: true
  });

  return probeResult;
} catch (error) {
  runtimeState.lastError = normalizeContentAdapterError(
    error,
    'Failed to handle ChatGPT SPA location change.',
    {
      url: currentUrl
    }
  );
  return null;
}
}

function installLocationListeners() {
installHistoryHooks();
installVisibilityHooks();

globalScope.addEventListener('maoe:locationchange', function onLocationChangeEvent() {
  scheduleLocationCheck({
    forceNotify: true
  });
});
}

function buildRuntimeSnapshot(adapterState) {
const adapterInfo = isPlainObject(adapterState) ? adapterState : createNullObject();

return deepFreeze({
  protocolVersion: DEFAULT_PROTOCOL_VERSION,
  installed: runtimeState.installed === true,
  installAt: runtimeState.installAt,
  siteDetectedAt: runtimeState.siteDetectedAt,
  lastProbeAt: runtimeState.lastProbeAt || normalizeString(adapterInfo.lastProbeAt),
  lastLocationChangeAt: runtimeState.lastLocationChangeAt,
  lastKnownUrl: runtimeState.lastKnownUrl,
  ready: normalizeBoolean(adapterInfo.ready, false),
  readyAt: normalizeString(adapterInfo.readyAt),
  lastOutputAt: normalizeString(adapterInfo.lastOutputAt),
  lastOutputKind: normalizeString(adapterInfo.lastOutputKind),
  lastOutputLength: normalizeIntegerOrNull(adapterInfo.lastOutputLength),
  siteDetectedSent: normalizeBoolean(adapterInfo.siteDetectedSent, false),
  lastError: runtimeState.lastError ? {
    code: runtimeState.lastError.code,
    message: runtimeState.lastError.message,
    details: cloneValue(runtimeState.lastError.details)
  } : null
});
}

async function install(options) {
const config = isPlainObject(options) ? options : createNullObject();

if (!isSupportedHost(getCurrentHost())) {
  throw createContentAdapterError(
    ERROR_CODES.INVALID_STATE || 'INVALID_STATE',
    'chatgpt_content.js was loaded on an unsupported host.',
    {
      host: getCurrentHost(),
      url: getCurrentUrl()
    }
  );
}

if (runtimeState.installed === true && runtimeState.adapter && normalizeBoolean(config.force, false) !== true) {
  const probeResult = runtimeState.adapter.probe();
  runtimeState.lastProbeAt = probeResult && probeResult.siteInfo ? normalizeString(probeResult.siteInfo.detectedAt) : runtimeState.lastProbeAt;
  return deepFreeze({
    ok: true,
    siteInfo: probeResult ? cloneValue(probeResult.siteInfo) : createNullObject(),
    probe: probeResult ? cloneValue(probeResult) : null,
    adapterState: buildRuntimeSnapshot(runtimeState.adapter.getState ? runtimeState.adapter.getState() : createNullObject())
  });
}

if (runtimeState.installPromise && normalizeBoolean(config.force, false) !== true) {
  return runtimeState.installPromise;
}

const promise = (async function installInternal() {
  const adapterConfig = buildSiteConfig();
  const installation = await contentSiteAdapter.installAdapter(adapterConfig, {
    force: normalizeBoolean(config.force, false)
  });

  runtimeState.adapter = installation.adapter;
  runtimeState.installed = true;
  runtimeState.installAt = nowIsoString();
  runtimeState.lastKnownUrl = getCurrentUrl();
  runtimeState.lastProbeAt = installation.probe && installation.probe.siteInfo
    ? normalizeString(installation.probe.siteInfo.detectedAt)
    : runtimeState.installAt;
  runtimeState.siteDetectedAt = runtimeState.installAt;
  runtimeState.lastError = null;

  installLocationListeners();

  logger.info('ChatGPT content adapter installed.', {
    siteId: adapterConfig.siteId,
    providerId: adapterConfig.providerId,
    host: getCurrentHost(),
    url: runtimeState.lastKnownUrl
  });

  return deepFreeze({
    ok: true,
    siteInfo: installation.probe ? cloneValue(installation.probe.siteInfo) : createNullObject(),
    probe: installation.probe ? cloneValue(installation.probe) : null,
    adapterState: buildRuntimeSnapshot(runtimeState.adapter.getState ? runtimeState.adapter.getState() : createNullObject())
  });
}());

runtimeState.installPromise = promise;

try {
  return await promise;
} catch (error) {
  runtimeState.lastError = normalizeContentAdapterError(
    error,
    'Failed to install ChatGPT content adapter.',
    {
      host: getCurrentHost(),
      url: getCurrentUrl()
    }
  );
  throw runtimeState.lastError;
} finally {
  runtimeState.installPromise = null;
}
}

async function probe(options) {
const config = isPlainObject(options) ? options : createNullObject();

await install({
  force: normalizeBoolean(config.forceInstall, false)
});

const result = runtimeState.adapter.probe();
runtimeState.lastProbeAt = result && result.siteInfo ? normalizeString(result.siteInfo.detectedAt) : nowIsoString();

return deepFreeze({
  ok: true,
  siteInfo: result ? cloneValue(result.siteInfo) : createNullObject(),
  probe: result ? cloneValue(result) : null,
  adapterState: buildRuntimeSnapshot(runtimeState.adapter.getState ? runtimeState.adapter.getState() : createNullObject())
});
}

async function fillPrompt(promptText, options) {
const config = isPlainObject(options) ? options : createNullObject();

await install({
  force: false
});

const result = await runtimeState.adapter.fillPrompt(promptText, {
  autoSubmit: normalizeBoolean(hasOwn(config, 'autoSubmit') ? config.autoSubmit : false, false),
  useEnterAsSubmitFallback: normalizeBoolean(hasOwn(config, 'useEnterAsSubmitFallback') ? config.useEnterAsSubmitFallback : false, false)
});

logger.info('ChatGPT prompt filled.', {
  promptLength: result.promptLength,
  autoSubmit: result.submission ? result.submission.submitted === true : false,
  submitMode: result.submission ? result.submission.submitMode : 'none'
});

return deepFreeze({
  ok: true,
  result: cloneValue(result),
  adapterState: buildRuntimeSnapshot(runtimeState.adapter.getState ? runtimeState.adapter.getState() : createNullObject())
});
}

async function extractLatestResponse(options) {
const config = isPlainObject(options) ? options : createNullObject();

await install({
  force: false
});

const result = await runtimeState.adapter.extractLatestResponse({
  broadcast: normalizeBoolean(hasOwn(config, 'broadcast') ? config.broadcast : true, true)
});

logger.info('ChatGPT latest response extracted.', {
  rawTextLength: result.rawTextLength,
  responseElementCount: result.responseElementCount,
  extractedBlockCount: Array.isArray(result.extractedBlocks) ? result.extractedBlocks.length : 0,
  outputKind: normalizeString(result.parsedPacket ? 'packet' : (result.parsedPayload && result.parsedPayload.kind ? result.parsedPayload.kind : 'text'))
});

return deepFreeze({
  ok: true,
  result: cloneValue(result),
  adapterState: buildRuntimeSnapshot(runtimeState.adapter.getState ? runtimeState.adapter.getState() : createNullObject())
});
}

function getState() {
const adapterState = runtimeState.adapter && typeof runtimeState.adapter.getState === 'function'
? runtimeState.adapter.getState()
: createNullObject();

return buildRuntimeSnapshot(adapterState);
}

function getSiteInfo() {
if (runtimeState.adapter && typeof runtimeState.adapter.buildSiteInfo === 'function') {
try {
return runtimeState.adapter.buildSiteInfo({
protocolVersion: DEFAULT_PROTOCOL_VERSION
});
} catch (error) {
}
}

return deepFreeze({
  protocolVersion: DEFAULT_PROTOCOL_VERSION,
  siteId: resolveSiteId(),
  providerId: DEFAULT_PROVIDER_ID,
  displayName: resolveDisplayName(),
  url: getCurrentUrl(),
  title: globalScope.document && globalScope.document.title
    ? String(globalScope.document.title)
    : '',
  ready: false,
  host: getCurrentHost(),
  detectedAt: nowIsoString()
});
}

function uninstall() {
if (runtimeState.adapter && typeof runtimeState.adapter.uninstall === 'function') {
try {
runtimeState.adapter.uninstall();
} catch (error) {
}
}

runtimeState.adapter = null;
runtimeState.installed = false;
runtimeState.lastError = null;
}

const api = {
install: install,
probe: probe,
fillPrompt: fillPrompt,
extractLatestResponse: extractLatestResponse,
getState: getState,
getSiteInfo: getSiteInfo,
uninstall: uninstall,
helpers: deepFreeze({
resolveSiteId: resolveSiteId,
resolveDisplayName: resolveDisplayName,
isSupportedHost: isSupportedHost,
getPromptElement: getPromptElement,
getSubmitElement: getSubmitElement,
getResponseElements: getResponseElements,
inferModelName: inferModelName,
normalizePromptText: normalizePromptText,
normalizeResponseText: normalizeResponseText,
stripKnownFooter: stripKnownFooter,
buildSiteConfig: buildSiteConfig,
handleLocationChange: handleLocationChange,
buildRuntimeSnapshot: buildRuntimeSnapshot
})
};

root.registerValue('chatgpt_content', deepFreeze(api), {
overwrite: false,
freeze: false,
clone: false
});

function autoInstallWhenReady() {
const start = function startInstallation() {
void install({
force: false
}).catch(function onInstallError(error) {
runtimeState.lastError = normalizeContentAdapterError(
error,
'Automatic ChatGPT content adapter installation failed.',
{
host: getCurrentHost(),
url: getCurrentUrl()
}
);

    logger.warn('Automatic ChatGPT content adapter installation failed.', {
      code: runtimeState.lastError.code,
      message: runtimeState.lastError.message,
      details: cloneValue(runtimeState.lastError.details)
    });
  });
};

if (!globalScope.document || globalScope.document.readyState === 'complete' || globalScope.document.readyState === 'interactive') {
  start();
  return;
}

globalScope.document.addEventListener('DOMContentLoaded', function onDOMContentLoaded() {
  start();
}, { once: true });
}

try {
logger.debug('ChatGPT content module registered.', {
protocolVersion: DEFAULT_PROTOCOL_VERSION,
siteId: resolveSiteId(),
providerId: DEFAULT_PROVIDER_ID,
host: getCurrentHost()
});
} catch (error) {
}

autoInstallWhenReady();
}(typeof globalThis !== 'undefined'
? globalThis
: (typeof self !== 'undefined'
? self
: (typeof window !== 'undefined' ? window : this))));
