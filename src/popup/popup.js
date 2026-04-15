(function registerMAOEPopup(globalScope) {
  'use strict';


const root = globalScope.MAOE;

if (!root || typeof root.registerValue !== 'function') {
throw new Error('[MAOE] namespace.js must be loaded before popup.js.');
}

if (root.has('popup')) {
return;
}

if (!root.has('constants')) {
throw new Error('[MAOE] constants.js must be loaded before popup.js.');
}

if (!root.has('storage')) {
throw new Error('[MAOE] storage.js must be loaded before popup.js.');
}

if (!root.has('protocol')) {
throw new Error('[MAOE] protocol.js must be loaded before popup.js.');
}

if (!root.has('ai_payload_parser')) {
throw new Error('[MAOE] ai_payload_parser.js must be loaded before popup.js.');
}

const constants = root.require('constants');
const storage = root.require('storage');
const protocol = root.require('protocol');
const aiPayloadParser = root.require('ai_payload_parser');
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

const hasOwn = typeof util.hasOwn === 'function'
? util.hasOwn
: function fallbackHasOwn(target, key) {
return Object.prototype.hasOwnProperty.call(target, key);
};

function createFallbackLogger() {
const consoleObject = typeof console !== 'undefined' ? console : null;

function emit(level, message, context) {
  if (!consoleObject || typeof consoleObject[level] !== 'function') {
    return;
  }

  if (typeof context === 'undefined') {
    consoleObject[level]('[MAOE/popup] ' + message);
    return;
  }

  consoleObject[level]('[MAOE/popup] ' + message, context);
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
    return loggerModule.createScope('popup');
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
const DEFAULTS = constants.DEFAULTS || Object.create(null);
const ERROR_CODES = constants.ERROR_CODES || Object.create(null);
const GITHUB = constants.GITHUB || Object.create(null);
const HOSTS = constants.HOSTS || Object.create(null);
const LOGGING = constants.LOGGING || Object.create(null);
const MANUAL_HUB = constants.MANUAL_HUB || Object.create(null);
const MESSAGING = constants.MESSAGING || Object.create(null);
const PARSER = constants.PARSER || Object.create(null);
const PROVIDERS = constants.PROVIDERS || Object.create(null);
const REPOSITORY = constants.REPOSITORY || Object.create(null);
const WORKFLOW = constants.WORKFLOW || Object.create(null);
const CONSTANT_HELPERS = constants.helpers || Object.create(null);
const protocolHelpers = protocol.helpers || Object.create(null);

const MESSAGE_TYPES = MESSAGING.TYPES || Object.create(null);
const RESPONSE_STATUS = MESSAGING.RESPONSE_STATUS || Object.create(null);
const WORKFLOW_ROLES = WORKFLOW.ROLES || Object.create(null);
const WORKFLOW_STAGES = WORKFLOW.STAGES || Object.create(null);
const WORKFLOW_STATUSES = WORKFLOW.STATUSES || Object.create(null);
const REVIEW_VERDICTS = WORKFLOW.REVIEW_VERDICTS || Object.create(null);

const ROLE_DESIGNER = normalizeLowerString(WORKFLOW_ROLES.DESIGNER || 'designer');
const ROLE_EXECUTOR = normalizeLowerString(WORKFLOW_ROLES.EXECUTOR || 'executor');
const ROLE_AUDITOR = normalizeLowerString(WORKFLOW_ROLES.AUDITOR || 'auditor');

const STAGE_IDLE = normalizeLowerString(WORKFLOW_STAGES.IDLE || 'idle');
const STAGE_DESIGN = normalizeLowerString(WORKFLOW_STAGES.DESIGN || 'design');
const STAGE_EXECUTION = normalizeLowerString(WORKFLOW_STAGES.EXECUTION || 'execution');
const STAGE_AUDIT = normalizeLowerString(WORKFLOW_STAGES.AUDIT || 'audit');
const STAGE_PR = normalizeLowerString(WORKFLOW_STAGES.PR || 'pr');
const STAGE_COMPLETED = normalizeLowerString(WORKFLOW_STAGES.COMPLETED || 'completed');
const STAGE_ERROR = normalizeLowerString(WORKFLOW_STAGES.ERROR || 'error');

const STATUS_IDLE = normalizeLowerString(WORKFLOW_STATUSES.IDLE || 'idle');
const STATUS_READY = normalizeLowerString(WORKFLOW_STATUSES.READY || 'ready');
const STATUS_IN_PROGRESS = normalizeLowerString(WORKFLOW_STATUSES.IN_PROGRESS || 'in_progress');
const STATUS_AWAITING_HUMAN = normalizeLowerString(WORKFLOW_STATUSES.AWAITING_HUMAN || 'awaiting_human');
const STATUS_APPROVED = normalizeLowerString(WORKFLOW_STATUSES.APPROVED || 'approved');
const STATUS_REJECTED = normalizeLowerString(WORKFLOW_STATUSES.REJECTED || 'rejected');
const STATUS_BLOCKED = normalizeLowerString(WORKFLOW_STATUSES.BLOCKED || 'blocked');
const STATUS_FAILED = normalizeLowerString(WORKFLOW_STATUSES.FAILED || 'failed');
const STATUS_COMPLETED = normalizeLowerString(WORKFLOW_STATUSES.COMPLETED || 'completed');

const REVIEW_APPROVE = normalizeUpperString(REVIEW_VERDICTS.APPROVE || 'APPROVE');
const REVIEW_REJECT = normalizeUpperString(REVIEW_VERDICTS.REJECT || 'REJECT');

const DEFAULT_PROTOCOL_VERSION = normalizeString(APP.protocolVersion) || '1.0.0';
const DEFAULT_RESPONSE_STATUS_OK = normalizeString(RESPONSE_STATUS.OK || 'ok') || 'ok';
const DEFAULT_RESPONSE_STATUS_ERROR = normalizeString(RESPONSE_STATUS.ERROR || 'error') || 'error';
const DEFAULT_BASE_URL = normalizeString(GITHUB.API_BASE_URL || HOSTS.GITHUB_API_BASE_URL || 'https://api.github.com').replace(/\/$/, '');
const DEFAULT_BASE_BRANCH = normalizeString(REPOSITORY.DEFAULT_BASE_BRANCH || 'main');
const DEFAULT_WORKING_BRANCH_PREFIX = normalizeString(REPOSITORY.WORKING_BRANCH_PREFIX || 'maoe/issue-');
const DEFAULT_EVENT_LOG_LEVEL = normalizeString(LOGGING.DEFAULT_LEVEL || 'info') || 'info';
const DEFAULT_BODY_PREVIEW_LENGTH = 240;
const STORAGE_AREA_LOCAL = storage.areas && storage.areas.LOCAL ? storage.areas.LOCAL : 'local';
const POPUP_TRANSIENT_STORAGE_KEY = 'popup_transient_preferences';

const DEFAULT_PROVIDER_IDS = deepFreeze((function buildDefaultProviderIds() {
const output = Object.create(null);

output[ROLE_DESIGNER] = normalizeLowerString(
  constants.DEFAULT_PROVIDER_BY_ROLE && constants.DEFAULT_PROVIDER_BY_ROLE[ROLE_DESIGNER]
  || DEFAULTS.settings && DEFAULTS.settings.agents && DEFAULTS.settings.agents.designerProviderId
  || ''
);
output[ROLE_EXECUTOR] = normalizeLowerString(
  constants.DEFAULT_PROVIDER_BY_ROLE && constants.DEFAULT_PROVIDER_BY_ROLE[ROLE_EXECUTOR]
  || DEFAULTS.settings && DEFAULTS.settings.agents && DEFAULTS.settings.agents.executorProviderId
  || ''
);
output[ROLE_AUDITOR] = normalizeLowerString(
  constants.DEFAULT_PROVIDER_BY_ROLE && constants.DEFAULT_PROVIDER_BY_ROLE[ROLE_AUDITOR]
  || DEFAULTS.settings && DEFAULTS.settings.agents && DEFAULTS.settings.agents.auditorProviderId
  || ''
);

return output;

}()));

const runtimeState = root.ensureState('popup_runtime', function createRuntimeState() {
return {
initialized: false,
initializingPromise: null,
bootstrappedAt: '',
bootstrap: null,
dashboard: null,
workflow: null,
stageArtifact: null,
issuesEnvelope: null,
repositoryTreeEnvelope: null,
tabContexts: [],
eventLog: [],
lastSubmission: null,
lastError: null,
selectedIssueNumber: null,
dom: null,
busy: Object.create(null),
dirty: {
activeTab: false,
issueFilter: false,
showDebugLog: false,
manualPacket: false,
manualResponse: false,
targetFile: false,
treePathPrefix: false
},
ui: {
activeTab: 'dashboard',
issueFilter: '',
showDebugLog: false
},
manualHub: {
lastPacketType: '',
lastPacketText: '',
lastResponseText: '',
clipboardFormat: normalizeString(MANUAL_HUB.CLIPBOARD && MANUAL_HUB.CLIPBOARD.PREFERRED_FENCE_LANGUAGE) || 'json'
},
transientPreferences: {
includeIssueBody: true,
includeTree: true
},
refreshTimer: null,
liveRegionTimer: null,
runtimeMessageListenerInstalled: false,
lastStatusText: '',
lastCopiedTextKind: ''
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

function normalizeUpperString(value) {
return normalizeString(value).toUpperCase();
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

function normalizeIntegerOrNull(value) {
if (value === null || typeof value === 'undefined' || value === '') {
return null;
}

const numberValue = Number(value);

if (!Number.isFinite(numberValue)) {
  return null;
}

return Math.trunc(numberValue);

}

function normalizePositiveInteger(value, fallbackValue) {
const fallback = Number.isFinite(Number(fallbackValue))
? Math.max(1, Math.trunc(Number(fallbackValue)))
: 1;

if (!Number.isFinite(Number(value))) {
  return fallback;
}

return Math.max(1, Math.trunc(Number(value)));

}

function normalizeOptionalPositiveInteger(value, fallbackValue) {
if (value === null || typeof value === 'undefined' || value === '') {
if (fallbackValue === null || typeof fallbackValue === 'undefined') {
return null;
}

  return normalizePositiveInteger(fallbackValue, 1);
}

const numberValue = Number(value);

if (!Number.isFinite(numberValue)) {
  if (fallbackValue === null || typeof fallbackValue === 'undefined') {
    return null;
  }

  return normalizePositiveInteger(fallbackValue, 1);
}

if (numberValue <= 0) {
  return null;
}

return Math.max(1, Math.trunc(numberValue));

}

function oneOf(value, allowedValues, fallbackValue) {
const normalizedValue = typeof value === 'string' ? value.trim() : value;

if (Array.isArray(allowedValues) && allowedValues.indexOf(normalizedValue) >= 0) {
  return normalizedValue;
}

return fallbackValue;

}

function stableObject(value) {
return isPlainObject(value) ? cloneValue(value) : createNullObject();
}

function stableArray(value) {
return Array.isArray(value) ? value.slice() : [];
}

function uniqueStrings(values) {
const source = Array.isArray(values) ? values : [];
const output = [];
const seen = new Set();

for (const entry of source) {
  const normalized = normalizeString(entry);

  if (!normalized || seen.has(normalized)) {
    continue;
  }

  seen.add(normalized);
  output.push(normalized);
}

return output;

}

function mergePlainObjects() {
const output = createNullObject();

for (let index = 0; index < arguments.length; index += 1) {
  const source = arguments[index];

  if (!isPlainObject(source)) {
    continue;
  }

  for (const key of Object.keys(source)) {
    output[key] = cloneValue(source[key]);
  }
}

return output;

}

function serializeComparable(value) {
try {
return JSON.stringify(value);
} catch (error) {
return '';
}
}

function valuesEqual(leftValue, rightValue) {
return serializeComparable(leftValue) === serializeComparable(rightValue);
}

function nowIsoString() {
return new Date().toISOString();
}

function collapseInlineWhitespace(value) {
return coerceText(value).replace(/\s+/g, ' ').trim();
}

function normalizeMultilineText(value) {
return coerceText(value)
.replace(/\r\n/g, '\n')
.replace(/\r/g, '\n')
.trim();
}

function safeJsonStringify(value, spacing) {
const indentation = Number.isFinite(Number(spacing))
? Math.max(0, Math.trunc(Number(spacing)))
: 2;

try {
  return JSON.stringify(value, null, indentation);
} catch (error) {
  return JSON.stringify({
    error: 'JSON_SERIALIZATION_FAILED',
    message: error && error.message ? error.message : String(error)
  }, null, indentation);
}

}

function createPopupError(code, message, details) {
const error = new Error(normalizeString(message) || 'Popup error.');
error.name = 'MAOEPopupError';
error.code = normalizeString(code) || (ERROR_CODES.UNKNOWN_ERROR || 'UNKNOWN_ERROR');
error.details = isPlainObject(details) ? cloneValue(details) : createNullObject();
error.isPopupError = true;
return error;
}

function isPopupError(error) {
return !!(error && typeof error === 'object' && error.isPopupError === true);
}

function normalizePopupError(error, fallbackMessage, extraDetails) {
if (isPopupError(error)) {
return error;
}

return createPopupError(
  normalizeString(error && error.code) || (ERROR_CODES.UNKNOWN_ERROR || 'UNKNOWN_ERROR'),
  normalizeString(error && error.message) || normalizeString(fallbackMessage) || 'Popup error.',
  mergePlainObjects(
    stableObject(error && error.details),
    stableObject(extraDetails)
  )
);

}

function createRequestId(prefix) {
if (protocolHelpers && typeof protocolHelpers.generateRequestId === 'function') {
try {
return protocolHelpers.generateRequestId(prefix || 'popup');
} catch (error) {
}
}

const normalizedPrefix = normalizeLowerString(prefix) || 'popup';
return normalizedPrefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);

}
