(function registerMAOEStateStore(globalScope) {
  'use strict';


const root = globalScope.MAOE;

if (!root || typeof root.registerValue !== 'function') {
throw new Error('[MAOE] namespace.js must be loaded before state_store.js.');
}

if (root.has('state_store')) {
return;
}

if (!root.has('constants')) {
throw new Error('[MAOE] constants.js must be loaded before state_store.js.');
}

if (!root.has('storage')) {
throw new Error('[MAOE] storage.js must be loaded before state_store.js.');
}

if (!root.has('protocol')) {
throw new Error('[MAOE] protocol.js must be loaded before state_store.js.');
}

const constants = root.require('constants');
const storage = root.require('storage');
const protocol = root.require('protocol');
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
    consoleObject[level]('[MAOE/state_store] ' + message);
    return;
  }

  consoleObject[level]('[MAOE/state_store] ' + message, context);
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
    return loggerModule.createScope('state_store');
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
const STORAGE_KEYS = constants.STORAGE_KEYS || Object.create(null);
const WORKFLOW = constants.WORKFLOW || Object.create(null);
const PROVIDERS = constants.PROVIDERS || Object.create(null);
const DEFAULT_PROVIDER_BY_ROLE = constants.DEFAULT_PROVIDER_BY_ROLE || Object.create(null);
const CONSTANT_HELPERS = constants.helpers || Object.create(null);
const protocolHelpers = protocol.helpers || Object.create(null);
const LOGGING = constants.LOGGING || Object.create(null);

const WORKFLOW_ROLES = WORKFLOW.ROLES || Object.create(null);
const WORKFLOW_STAGES = WORKFLOW.STAGES || Object.create(null);
const WORKFLOW_STATUSES = WORKFLOW.STATUSES || Object.create(null);
const HUMAN_ACTIONS = WORKFLOW.HUMAN_ACTIONS || Object.create(null);
const REVIEW_VERDICTS_MAP = WORKFLOW.REVIEW_VERDICTS || Object.create(null);

const KNOWN_ROLES = uniqueStrings([
WORKFLOW_ROLES.DESIGNER || 'designer',
WORKFLOW_ROLES.EXECUTOR || 'executor',
WORKFLOW_ROLES.AUDITOR || 'auditor'
]);
const STAGE_VALUES = uniqueStrings(
(Array.isArray(WORKFLOW.STAGE_ORDER) ? WORKFLOW.STAGE_ORDER.slice() : []).concat([
WORKFLOW_STAGES.IDLE || 'idle',
WORKFLOW_STAGES.DESIGN || 'design',
WORKFLOW_STAGES.EXECUTION || 'execution',
WORKFLOW_STAGES.AUDIT || 'audit',
WORKFLOW_STAGES.PR || 'pr',
WORKFLOW_STAGES.COMPLETED || 'completed',
WORKFLOW_STAGES.ERROR || 'error'
])
);
const STATUS_VALUES = uniqueStrings([
WORKFLOW_STATUSES.IDLE || 'idle',
WORKFLOW_STATUSES.READY || 'ready',
WORKFLOW_STATUSES.IN_PROGRESS || 'in_progress',
WORKFLOW_STATUSES.AWAITING_HUMAN || 'awaiting_human',
WORKFLOW_STATUSES.APPROVED || 'approved',
WORKFLOW_STATUSES.REJECTED || 'rejected',
WORKFLOW_STATUSES.BLOCKED || 'blocked',
WORKFLOW_STATUSES.FAILED || 'failed',
WORKFLOW_STATUSES.COMPLETED || 'completed'
]);
const HUMAN_ACTION_VALUES = uniqueStrings([
HUMAN_ACTIONS.COPY_PROMPT || 'copy_prompt',
HUMAN_ACTIONS.PASTE_RESPONSE || 'paste_response',
HUMAN_ACTIONS.CONFIRM_TRANSITION || 'confirm_transition',
HUMAN_ACTIONS.CREATE_COMMIT || 'create_commit',
HUMAN_ACTIONS.CREATE_PULL_REQUEST || 'create_pull_request'
]);
const REVIEW_VERDICTS = uniqueStrings([
REVIEW_VERDICTS_MAP.APPROVE || 'APPROVE',
REVIEW_VERDICTS_MAP.REJECT || 'REJECT'
]);
const PROVIDER_IDS = Object.keys(PROVIDERS);
const STORAGE_AREA_LOCAL = storage.areas && storage.areas.LOCAL ? storage.areas.LOCAL : 'local';
const STORAGE_AREA_SESSION = storage.areas && storage.areas.SESSION ? storage.areas.SESSION : 'session';
const LOG_LEVELS = uniqueStrings([
LOGGING.LEVELS && LOGGING.LEVELS.DEBUG ? LOGGING.LEVELS.DEBUG : 'debug',
LOGGING.LEVELS && LOGGING.LEVELS.INFO ? LOGGING.LEVELS.INFO : 'info',
LOGGING.LEVELS && LOGGING.LEVELS.WARN ? LOGGING.LEVELS.WARN : 'warn',
LOGGING.LEVELS && LOGGING.LEVELS.ERROR ? LOGGING.LEVELS.ERROR : 'error'
]);
const DEFAULT_LOG_LEVEL = normalizeString(LOGGING.DEFAULT_LEVEL) || 'info';
const DEFAULT_PROTOCOL_VERSION = normalizeString(APP.protocolVersion) || '1.0.0';
const DEFAULT_BASE_URL = normalizeString((constants.GITHUB && constants.GITHUB.API_BASE_URL) || (constants.HOSTS && constants.HOSTS.GITHUB_API_BASE_URL) || 'https://api.github.com').replace(/\/$/, '');

const EVENT_TYPES = deepFreeze({
INITIALIZED: 'initialized',
REFRESHED: 'refreshed',
WORKFLOW_CHANGED: 'workflow_changed',
ISSUE_SELECTED: 'issue_selected',
PROVIDERS_CHANGED: 'providers_changed',
ACTIVE_PROVIDER_CHANGED: 'active_provider_changed',
EXECUTOR_RESPONSE_RECORDED: 'executor_response_recorded',
AUDIT_RESULT_RECORDED: 'audit_result_recorded',
PULL_REQUEST_RECORDED: 'pull_request_recorded',
HUMAN_ACTION_RECORDED: 'human_action_recorded',
ERROR_SET: 'error_set',
ERROR_CLEARED: 'error_cleared',
RESET: 'reset',
EXTERNAL_STORAGE_SYNC: 'external_storage_sync',
EVENT_LOG_APPENDED: 'event_log_appended'
});

const NEXT_STAGE_MAP = deepFreeze((function buildNextStageMap() {
const output = Object.create(null);
output[WORKFLOW_STAGES.IDLE || 'idle'] = WORKFLOW_STAGES.DESIGN || 'design';
output[WORKFLOW_STAGES.DESIGN || 'design'] = WORKFLOW_STAGES.EXECUTION || 'execution';
output[WORKFLOW_STAGES.EXECUTION || 'execution'] = WORKFLOW_STAGES.AUDIT || 'audit';
output[WORKFLOW_STAGES.AUDIT || 'audit'] = WORKFLOW_STAGES.PR || 'pr';
output[WORKFLOW_STAGES.PR || 'pr'] = WORKFLOW_STAGES.COMPLETED || 'completed';
output[WORKFLOW_STAGES.COMPLETED || 'completed'] = WORKFLOW_STAGES.IDLE || 'idle';
output[WORKFLOW_STAGES.ERROR || 'error'] = WORKFLOW_STAGES.IDLE || 'idle';
return output;
}()));

const runtimeState = root.ensureState('state_store_runtime', function createRuntimeState() {
return {
initialized: false,
initializingPromise: null,
bootstrap: null,
workflow: null,
listeners: [],
listenerSequence: 0,
storageSyncInstalled: false,
storageSyncHandler: null,
lastEvent: null
};
});

if (!isPlainObject(runtimeState.bootstrap)) {
runtimeState.bootstrap = createDefaultBootstrapState();
}

if (!isPlainObject(runtimeState.workflow)) {
runtimeState.workflow = cloneValue(runtimeState.bootstrap.workflow);
}

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

if (prototype === null || prototype === Object.prototype) {
  return true;
}

return Object.getPrototypeOf(prototype) === null;

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

function collapseInlineWhitespace(value) {
return coerceText(value).replace(/\s+/g, ' ').trim();
}

function normalizeMultilineText(value) {
return coerceText(value)
.replace(/\r\n/g, '\n')
.replace(/\r/g, '\n')
.trim();
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

function nowIsoString() {
return new Date().toISOString();
}

function createStateStoreError(code, message, details) {
const error = new Error(normalizeString(message) || 'State store error.');
error.name = 'MAOEStateStoreError';
error.code = normalizeString(code) || (ERROR_CODES.UNKNOWN_ERROR || 'UNKNOWN_ERROR');
error.details = isPlainObject(details) ? cloneValue(details) : createNullObject();
error.isStateStoreError = true;
return error;
}

function isStateStoreError(error) {
return !!(error && typeof error === 'object' && error.isStateStoreError === true);
}

function normalizeStateStoreError(error, fallbackMessage, extraDetails) {
if (isStateStoreError(error)) {
return error;
}

return createStateStoreError(
  normalizeString(error && error.code) || (ERROR_CODES.UNKNOWN_ERROR || 'UNKNOWN_ERROR'),
  normalizeString(error && error.message) || normalizeString(fallbackMessage) || 'State store error.',
  mergePlainObjects(
    stableObject(error && error.details),
    stableObject(extraDetails)
  )
);

}

function createRequestId(prefix) {
if (protocolHelpers && typeof protocolHelpers.generateRequestId === 'function') {
try {
return protocolHelpers.generateRequestId(prefix || 'state');
} catch (error) {
}
}

const normalizedPrefix = normalizeLowerString(prefix) || 'state';
return normalizedPrefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);

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

function valuesEqual(left, right) {
return serializeComparable(left) === serializeComparable(right);
}

function normalizeLogLevel(value) {
return oneOf(normalizeLowerString(value), LOG_LEVELS, DEFAULT_LOG_LEVEL);
}

function freezeClone(value) {
return deepFreeze(cloneValue(value));
}

function defaultWorkflowState() {
if (protocol && typeof protocol.normalizeWorkflowState === 'function') {
return protocol.normalizeWorkflowState(isPlainObject(DEFAULTS.workflow) ? DEFAULTS.workflow : createNullObject());
}

return cloneValue(isPlainObject(DEFAULTS.workflow) ? DEFAULTS.workflow : createNullObject());

}

function createDefaultBootstrapState() {
return {
settings: cloneValue(isPlainObject(DEFAULTS.settings) ? DEFAULTS.settings : createNullObject()),
githubAuth: cloneValue(isPlainObject(DEFAULTS.githubAuth) ? DEFAULTS.githubAuth : createNullObject()),
repository: cloneValue(isPlainObject(DEFAULTS.repository) ? DEFAULTS.repository : createNullObject()),
workflow: defaultWorkflowState(),
ui: cloneValue(isPlainObject(DEFAULTS.ui) ? DEFAULTS.ui : createNullObject()),
manualHub: cloneValue(isPlainObject(DEFAULTS.manualHub) ? DEFAULTS.manualHub : createNullObject()),
lastParsedPayload: null,
lastAuditResult: null,
lastError: null,
eventLog: [],
loadedAt: nowIsoString()
};
}

function normalizeWorkflowStateFromAny(value) {
if (protocol && typeof protocol.normalizeWorkflowState === 'function') {
return protocol.normalizeWorkflowState(value);
}

return cloneValue(value || defaultWorkflowState());

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

function normalizeGitHubAuthSnapshot(value) {
return isPlainObject(value)
? cloneValue(value)
: cloneValue(isPlainObject(DEFAULTS.githubAuth) ? DEFAULTS.githubAuth : createNullObject());
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

function normalizeEventLogSnapshot(value) {
return Array.isArray(value) ? cloneValue(value) : [];
}

function normalizeBootstrap(value) {
const source = isPlainObject(value) ? value : createNullObject();
const bootstrap = createDefaultBootstrapState();

bootstrap.settings = normalizeSettingsSnapshot(source.settings);
bootstrap.githubAuth = normalizeGitHubAuthSnapshot(source.githubAuth);
bootstrap.repository = normalizeRepositorySnapshot(source.repository);
bootstrap.workflow = normalizeWorkflowStateFromAny(
  hasOwn(source, 'workflow')
    ? source.workflow
    : (hasOwn(source, 'workflowState')
      ? source.workflowState
      : bootstrap.workflow)
);
bootstrap.ui = normalizeUiSnapshot(source.ui);
bootstrap.manualHub = normalizeManualHubSnapshot(source.manualHub);
bootstrap.lastParsedPayload = hasOwn(source, 'lastParsedPayload')
  ? cloneValue(source.lastParsedPayload)
  : null;
bootstrap.lastAuditResult = hasOwn(source, 'lastAuditResult')
  ? cloneValue(source.lastAuditResult)
  : null;
bootstrap.lastError = hasOwn(source, 'lastError')
  ? cloneValue(source.lastError)
  : null;
bootstrap.eventLog = normalizeEventLogSnapshot(source.eventLog);
bootstrap.loadedAt = nowIsoString();

return bootstrap;

}

function ensureBootstrapCache() {
if (!isPlainObject(runtimeState.bootstrap)) {
runtimeState.bootstrap = createDefaultBootstrapState();
}

if (!isPlainObject(runtimeState.workflow)) {
  runtimeState.workflow = cloneValue(runtimeState.bootstrap.workflow);
}

return runtimeState.bootstrap;

}

function setBootstrapCache(bootstrap) {
const normalized = normalizeBootstrap(bootstrap);
runtimeState.bootstrap = cloneValue(normalized);
runtimeState.workflow = cloneValue(normalized.workflow);
runtimeState.initialized = true;
return freezeClone(normalized);
}

function updateBootstrapField(field, value) {
const bootstrap = ensureBootstrapCache();
bootstrap[field] = cloneValue(value);
bootstrap.loadedAt = nowIsoString();

if (field === 'workflow') {
  runtimeState.workflow = cloneValue(bootstrap.workflow);
}

return freezeClone(bootstrap[field]);

}

function updateBootstrapFields(patch) {
const bootstrap = ensureBootstrapCache();
const source = isPlainObject(patch) ? patch : createNullObject();

for (const key of Object.keys(source)) {
  bootstrap[key] = cloneValue(source[key]);
  if (key === 'workflow') {
    runtimeState.workflow = cloneValue(source[key]);
  }
}

bootstrap.loadedAt = nowIsoString();
return getCachedBootstrapState();

}

function getCachedBootstrapState() {
return freezeClone(normalizeBootstrap(ensureBootstrapCache()));
}

function getCachedWorkflowState() {
return freezeClone(normalizeWorkflowStateFromAny(ensureBootstrapCache().workflow));
}

function getLastEvent() {
return runtimeState.lastEvent ? freezeClone(runtimeState.lastEvent) : null;
}

function createEvent(type, payload) {
return deepFreeze({
id: createRequestId('stateevt'),
type: normalizeString(type),
at: nowIsoString(),
payload: cloneValue(payload)
});
}

function notifyListeners(type, payload) {
const event = createEvent(type, payload);
runtimeState.lastEvent = cloneValue(event);
const listeners = runtimeState.listeners.slice();

for (const listenerRecord of listeners) {
  if (!listenerRecord || typeof listenerRecord.callback !== 'function') {
    continue;
  }

  try {
    listenerRecord.callback(freezeClone(event));
  } catch (error) {
  }
}

return event;

}

function subscribe(listener, options) {
if (typeof listener !== 'function') {
throw createStateStoreError(
ERROR_CODES.INVALID_ARGUMENT || 'INVALID_ARGUMENT',
'State store subscriber must be a function.',
createNullObject()
);
}

runtimeState.listenerSequence += 1;

const record = {
  id: 'state_listener_' + String(runtimeState.listenerSequence),
  callback: listener
};

runtimeState.listeners.push(record);

const config = isPlainObject(options) ? options : createNullObject();

if (config.emitCurrent === true) {
  try {
    listener(createEvent(EVENT_TYPES.REFRESHED, {
      source: 'subscribe',
      bootstrap: getCachedBootstrapState()
    }));
  } catch (error) {
  }
}

return function unsubscribe() {
  const nextListeners = [];

  for (const listenerRecord of runtimeState.listeners) {
    if (!listenerRecord || listenerRecord.id === record.id) {
      continue;
    }

    nextListeners.push(listenerRecord);
  }

  runtimeState.listeners = nextListeners;
};

}

function unsubscribeAll() {
runtimeState.listeners = [];
}

function getDefaultRoleProviderMap() {
const workflowDefaults = isPlainObject(DEFAULTS.workflow) ? DEFAULTS.workflow : createNullObject();
const selectedDefaults = isPlainObject(workflowDefaults.selectedProviderIds)
? workflowDefaults.selectedProviderIds
: createNullObject();
const output = createNullObject();

for (const role of KNOWN_ROLES) {
  const workflowValue = normalizeLowerString(selectedDefaults[role]);
  const constantsValue = normalizeLowerString(DEFAULT_PROVIDER_BY_ROLE[role]);
  const candidate = workflowValue || constantsValue || (PROVIDER_IDS[0] || '');
  output[role] = PROVIDER_IDS.indexOf(candidate) >= 0
    ? candidate
    : (PROVIDER_IDS.indexOf(constantsValue) >= 0 ? constantsValue : (PROVIDER_IDS[0] || ''));
}

return output;

}

function coerceProviderId(providerId, fallbackProviderId) {
const normalized = normalizeLowerString(providerId);

if (PROVIDER_IDS.indexOf(normalized) >= 0) {
  return normalized;
}

const normalizedFallback = normalizeLowerString(fallbackProviderId);

if (PROVIDER_IDS.indexOf(normalizedFallback) >= 0) {
  return normalizedFallback;
}

return PROVIDER_IDS.length > 0 ? PROVIDER_IDS[0] : '';

}

function assertProviderId(providerId, options) {
const config = isPlainObject(options) ? options : createNullObject();
const normalized = normalizeLowerString(providerId);

if (!normalized) {
  if (normalizeBoolean(config.allowEmpty, false)) {
    return '';
  }

  throw createStateStoreError(
    ERROR_CODES.INVALID_ARGUMENT || 'INVALID_ARGUMENT',
    'Provider ID is required.',
    {
      providerId: providerId
    }
  );
}

if (PROVIDER_IDS.indexOf(normalized) >= 0) {
  return normalized;
}

throw createStateStoreError(
  ERROR_CODES.INVALID_ARGUMENT || 'INVALID_ARGUMENT',
  'Unsupported provider ID.',
  {
    providerId: normalized,
    supportedProviderIds: PROVIDER_IDS.slice()
  }
);

}

function assertRole(role, options) {
const config = isPlainObject(options) ? options : createNullObject();
const normalized = normalizeLowerString(role);

if (!normalized) {
  if (normalizeBoolean(config.allowEmpty, false)) {
    return '';
  }

  throw createStateStoreError(
    ERROR_CODES.INVALID_ARGUMENT || 'INVALID_ARGUMENT',
    'Role is required.',
    {
      role: role
    }
  );
}

if (KNOWN_ROLES.indexOf(normalized) >= 0) {
  return normalized;
}

throw createStateStoreError(
  ERROR_CODES.INVALID_ARGUMENT || 'INVALID_ARGUMENT',
  'Unsupported workflow role.',
  {
    role: normalized,
    supportedRoles: KNOWN_ROLES.slice()
  }
);

}

function assertStage(stage, options) {
const config = isPlainObject(options) ? options : createNullObject();
const normalized = normalizeLowerString(stage);

if (!normalized) {
  if (normalizeBoolean(config.allowEmpty, false)) {
    return '';
  }

  throw createStateStoreError(
    ERROR_CODES.INVALID_ARGUMENT || 'INVALID_ARGUMENT',
    'Workflow stage is required.',
    {
      stage: stage
    }
  );
}

if (STAGE_VALUES.indexOf(normalized) >= 0) {
  return normalized;
}

throw createStateStoreError(
  ERROR_CODES.INVALID_ARGUMENT || 'INVALID_ARGUMENT',
  'Unsupported workflow stage.',
  {
    stage: normalized,
    supportedStages: STAGE_VALUES.slice()
  }
);

}

function assertStatus(status, options) {
const config = isPlainObject(options) ? options : createNullObject();
const normalized = normalizeLowerString(status);

if (!normalized) {
  if (normalizeBoolean(config.allowEmpty, false)) {
    return '';
  }

  throw createStateStoreError(
    ERROR_CODES.INVALID_ARGUMENT || 'INVALID_ARGUMENT',
    'Workflow status is required.',
    {
      status: status
    }
  );
}

if (STATUS_VALUES.indexOf(normalized) >= 0) {
  return normalized;
}

throw createStateStoreError(
  ERROR_CODES.INVALID_ARGUMENT || 'INVALID_ARGUMENT',
  'Unsupported workflow status.',
  {
    status: normalized,
    supportedStatuses: STATUS_VALUES.slice()
  }
);

}

function assertHumanAction(action, options) {
const config = isPlainObject(options) ? options : createNullObject();
const normalized = normalizeLowerString(action);

if (!normalized) {
  if (normalizeBoolean(config.allowEmpty, false)) {
    return '';
  }

  throw createStateStoreError(
    ERROR_CODES.INVALID_ARGUMENT || 'INVALID_ARGUMENT',
    'Human action is required.',
    {
      action: action
    }
  );
}

if (HUMAN_ACTION_VALUES.indexOf(normalized) >= 0) {
  return normalized;
}

throw createStateStoreError(
  ERROR_CODES.INVALID_ARGUMENT || 'INVALID_ARGUMENT',
  'Unsupported human action.',
  {
    action: normalized,
    supportedActions: HUMAN_ACTION_VALUES.slice()
  }
);

}

function normalizeReviewVerdict(value, options) {
const config = isPlainObject(options) ? options : createNullObject();
const normalized = normalizeUpperString(value);

if (!normalized) {
  if (normalizeBoolean(config.allowEmpty, false)) {
    return '';
  }

  throw createStateStoreError(
    ERROR_CODES.INVALID_ARGUMENT || 'INVALID_ARGUMENT',
    'Review verdict is required.',
    {
      verdict: value
    }
  );
}

if (REVIEW_VERDICTS.indexOf(normalized) >= 0) {
  return normalized;
}

throw createStateStoreError(
  ERROR_CODES.INVALID_ARGUMENT || 'INVALID_ARGUMENT',
  'Unsupported review verdict.',
  {
    verdict: normalized,
    supportedVerdicts: REVIEW_VERDICTS.slice()
  }
);

}

function normalizeSelectedProviderIds(value) {
const defaults = getDefaultRoleProviderMap();
const source = isPlainObject(value) ? value : createNullObject();
const output = createNullObject();

for (const role of KNOWN_ROLES) {
  const directValue = hasOwn(source, role) ? source[role] : undefined;
  const aliasValue = hasOwn(source, role + 'ProviderId') ? source[role + 'ProviderId'] : undefined;
  output[role] = coerceProviderId(
    directValue || aliasValue,
    defaults[role]
  );
}

return output;

}

function sourceTouchesProviderSelection(patch) {
const source = isPlainObject(patch) ? patch : createNullObject();

if (hasOwn(source, 'selectedProviderIds') && isPlainObject(source.selectedProviderIds)) {
  return true;
}

for (const role of KNOWN_ROLES) {
  if (hasOwn(source, role) || hasOwn(source, role + 'ProviderId')) {
    return true;
  }
}

return false;

}

function mergeSelectedProviderIds(currentValue, patchValue, options) {
const config = isPlainObject(options) ? options : createNullObject();
const current = normalizeSelectedProviderIds(currentValue);
const patch = isPlainObject(patchValue) ? patchValue : createNullObject();
const nestedPatch = isPlainObject(patch.selectedProviderIds) ? patch.selectedProviderIds : createNullObject();
const output = cloneValue(current);

for (const role of KNOWN_ROLES) {
  let explicitValue;

  if (hasOwn(nestedPatch, role)) {
    explicitValue = nestedPatch[role];
  } else if (hasOwn(nestedPatch, role + 'ProviderId')) {
    explicitValue = nestedPatch[role + 'ProviderId'];
  } else if (hasOwn(patch, role)) {
    explicitValue = patch[role];
  } else if (hasOwn(patch, role + 'ProviderId')) {
    explicitValue = patch[role + 'ProviderId'];
  } else {
    continue;
  }

  output[role] = normalizeBoolean(config.throwOnInvalid, false)
    ? assertProviderId(explicitValue, {
        allowEmpty: false
      })
    : coerceProviderId(explicitValue, output[role]);
}

return output;

}

function selectedProviderIdsEqual(leftValue, rightValue) {
return valuesEqual(
normalizeSelectedProviderIds(leftValue),
normalizeSelectedProviderIds(rightValue)
);
}

function deriveProviderSelectionsFromSettings(settings) {
const source = isPlainObject(settings) ? settings : createNullObject();
const agents = isPlainObject(source.agents) ? source.agents : createNullObject();
const defaults = getDefaultRoleProviderMap();

return deepFreeze({
  designer: coerceProviderId(
    agents.designerProviderId || agents.designer,
    defaults.designer
  ),
  executor: coerceProviderId(
    agents.executorProviderId || agents.executor,
    defaults.executor
  ),
  auditor: coerceProviderId(
    agents.auditorProviderId || agents.auditor,
    defaults.auditor
  )
});

}

function getSelectedProviderIdsFromWorkflow(workflowState) {
const normalized = normalizeWorkflowStateFromAny(workflowState);
return freezeClone(normalizeSelectedProviderIds(normalized.selectedProviderIds));
}

function getDefaultProviderForRole(role) {
const normalizedRole = assertRole(role, {
allowEmpty: false
});
const defaults = getDefaultRoleProviderMap();
return defaults[normalizedRole] || '';
}

function resolveProviderForRole(role, selectedProviderIds) {
const normalizedRole = assertRole(role, {
allowEmpty: false
});
const normalizedSelections = normalizeSelectedProviderIds(selectedProviderIds);

return normalizedSelections[normalizedRole] || getDefaultProviderForRole(normalizedRole);

}

function inferRoleFromStage(stage) {
const normalizedStage = normalizeLowerString(stage);

if (normalizedStage === normalizeLowerString(WORKFLOW_STAGES.DESIGN || 'design')) {
  return normalizeLowerString(WORKFLOW_ROLES.DESIGNER || 'designer');
}

if (normalizedStage === normalizeLowerString(WORKFLOW_STAGES.EXECUTION || 'execution')) {
  return normalizeLowerString(WORKFLOW_ROLES.EXECUTOR || 'executor');
}

if (normalizedStage === normalizeLowerString(WORKFLOW_STAGES.AUDIT || 'audit')) {
  return normalizeLowerString(WORKFLOW_ROLES.AUDITOR || 'auditor');
}

return '';

}

function inferDefaultStatusForStage(stage, mode) {
const normalizedStage = normalizeLowerString(stage);
const normalizedMode = normalizeLowerString(mode);

if (normalizedMode === 'start') {
  return normalizeLowerString(WORKFLOW_STATUSES.IN_PROGRESS || 'in_progress');
}

if (normalizedMode === 'await_human') {
  return normalizeLowerString(WORKFLOW_STATUSES.AWAITING_HUMAN || 'awaiting_human');
}

if (normalizedMode === 'approved') {
  return normalizeLowerString(WORKFLOW_STATUSES.APPROVED || 'approved');
}

if (normalizedMode === 'rejected') {
  return normalizeLowerString(WORKFLOW_STATUSES.REJECTED || 'rejected');
}

if (normalizedMode === 'blocked') {
  return normalizeLowerString(WORKFLOW_STATUSES.BLOCKED || 'blocked');
}

if (normalizedMode === 'failed') {
  return normalizeLowerString(WORKFLOW_STATUSES.FAILED || 'failed');
}

if (normalizedMode === 'completed') {
  return normalizeLowerString(WORKFLOW_STATUSES.COMPLETED || 'completed');
}

if (normalizedStage === normalizeLowerString(WORKFLOW_STAGES.IDLE || 'idle')) {
  return normalizeLowerString(WORKFLOW_STATUSES.IDLE || 'idle');
}

if (normalizedStage === normalizeLowerString(WORKFLOW_STAGES.COMPLETED || 'completed')) {
  return normalizeLowerString(WORKFLOW_STATUSES.COMPLETED || 'completed');
}

if (normalizedStage === normalizeLowerString(WORKFLOW_STAGES.ERROR || 'error')) {
  return normalizeLowerString(WORKFLOW_STATUSES.FAILED || 'failed');
}

return normalizeLowerString(WORKFLOW_STATUSES.READY || 'ready');

}

function nextStageAfter(stage) {
const normalizedStage = normalizeLowerString(stage);
return hasOwn(NEXT_STAGE_MAP, normalizedStage) ? NEXT_STAGE_MAP[normalizedStage] : '';
}

function normalizeTaskFilePath(value) {
let source = coerceText(value).trim();

if (!source) {
  return '';
}

source = source.replace(/\\/g, '/').replace(/\/+/g, '/');

while (source.indexOf('./') === 0) {
  source = source.slice(2);
}

source = source.replace(/^\/+/, '');

if (/[\u0000-\u001F\u007F]/.test(source)) {
  throw createStateStoreError(
    ERROR_CODES.INVALID_ARGUMENT || 'INVALID_ARGUMENT',
    'Task file path contains control characters.',
    {
      path: value
    }
  );
}

return source;

}

function normalizeGitRefLike(value, fieldName, options) {
const config = isPlainObject(options) ? options : createNullObject();
const source = normalizeString(value);
const label = normalizeString(fieldName) || 'ref';

if (!source) {
  if (normalizeBoolean(config.allowEmpty, false)) {
    return '';
  }

  throw createStateStoreError(
    ERROR_CODES.INVALID_ARGUMENT || 'INVALID_ARGUMENT',
    label + ' is required.',
    {
      field: label
    }
  );
}

if (/[\u0000-\u0020\u007F]/.test(source)
  || source.indexOf('..') >= 0
  || source.indexOf('//') >= 0
  || source.indexOf('@{') >= 0
  || /[~^:?*\[\\]/.test(source)
  || source.charAt(0) === '/'
  || source.charAt(source.length - 1) === '/'
  || source.charAt(0) === '.'
  || source.charAt(source.length - 1) === '.'
  || source.slice(-5) === '.lock'
  || source.indexOf('/.') >= 0
  || source.indexOf('.lock/') >= 0) {
  throw createStateStoreError(
    ERROR_CODES.INVALID_ARGUMENT || 'INVALID_ARGUMENT',
    label + ' is not a valid Git reference.',
    {
      field: label,
      value: source
    }
  );
}

return source;

}

function normalizeLabelNames(value) {
let source = [];

if (typeof value === 'string') {
  source = value.split(',');
} else if (Array.isArray(value)) {
  source = value.slice();
}

const output = [];
const seen = new Set();

for (const entry of source) {
  let label = '';

  if (typeof entry === 'string') {
    label = normalizeString(entry);
  } else if (isPlainObject(entry)) {
    label = normalizeString(entry.name || entry.label);
  }

  if (!label || seen.has(label)) {
    continue;
  }

  seen.add(label);
  output.push(label);
}

return output;

}

function normalizeIssueRef(issue) {
const source = isPlainObject(issue) ? issue : createNullObject();

return deepFreeze({
  number: normalizeIntegerOrNull(source.number),
  title: normalizeString(source.title),
  body: coerceText(source.body),
  url: normalizeString(source.url || source.htmlUrl || source.html_url),
  state: normalizeLowerString(source.state),
  labels: normalizeLabelNames(source.labels || source.labelNames)
});

}

function normalizePullRequestRef(pullRequest) {
const source = isPlainObject(pullRequest) ? pullRequest : createNullObject();
const repository = isPlainObject(source.repository) ? source.repository : createNullObject();
const repositoryOwner = normalizeString(repository.owner);
const repositoryRepo = normalizeString(repository.repo);
const repositoryFullName = normalizeString(source.repositoryFullName || repository.fullName)
|| (repositoryOwner && repositoryRepo ? repositoryOwner + '/' + repositoryRepo : '');

return deepFreeze({
  number: normalizeIntegerOrNull(source.number),
  title: normalizeString(source.title),
  body: coerceText(source.body),
  url: normalizeString(source.url || source.htmlUrl || source.html_url),
  state: normalizeLowerString(source.state),
  draft: normalizeBoolean(source.draft, false),
  merged: normalizeBoolean(source.merged, false),
  headRef: normalizeString(
    source.headRef
    || source.headBranch
    || (isPlainObject(source.head) ? source.head.ref : '')
  ),
  baseRef: normalizeString(
    source.baseRef
    || source.baseBranch
    || (isPlainObject(source.base) ? source.base.ref : '')
  ),
  repositoryFullName: repositoryFullName
});

}

function normalizeEventLogEntry(entry, options) {
const config = isPlainObject(options) ? options : createNullObject();

if (typeof entry === 'string') {
  return {
    level: normalizeLogLevel(config.level || DEFAULT_LOG_LEVEL),
    message: collapseInlineWhitespace(entry),
    code: normalizeString(config.code),
    at: nowIsoString(),
    context: stableObject(config.context)
  };
}

const source = isPlainObject(entry) ? entry : createNullObject();

return {
  level: normalizeLogLevel(source.level || config.level || DEFAULT_LOG_LEVEL),
  message: collapseInlineWhitespace(source.message || config.message),
  code: normalizeString(source.code || config.code),
  at: normalizeString(source.at) || nowIsoString(),
  context: stableObject(source.context || config.context)
};

}

function normalizeErrorRecord(error, options) {
const config = isPlainObject(options) ? options : createNullObject();

if (error instanceof Error) {
  const details = stableObject(error.details);
  const output = {
    code: normalizeString(error.code) || (ERROR_CODES.UNKNOWN_ERROR || 'UNKNOWN_ERROR'),
    message: normalizeString(error.message) || 'Unexpected error.',
    at: normalizeString(config.at) || nowIsoString(),
    details: details
  };

  if (error.stack && !hasOwn(output.details, 'stack')) {
    output.details.stack = String(error.stack);
  }

  return deepFreeze(output);
}

if (isPlainObject(error)) {
  const details = stableObject(error.details);
  return deepFreeze({
    code: normalizeString(error.code) || (ERROR_CODES.UNKNOWN_ERROR || 'UNKNOWN_ERROR'),
    message: normalizeString(error.message) || 'Unexpected error.',
    at: normalizeString(error.at) || normalizeString(config.at) || nowIsoString(),
    details: details
  });
}

return deepFreeze({
  code: normalizeString(config.code) || (ERROR_CODES.UNKNOWN_ERROR || 'UNKNOWN_ERROR'),
  message: collapseInlineWhitespace(error || config.message || 'Unexpected error.'),
  at: normalizeString(config.at) || nowIsoString(),
  details: stableObject(config.details)
});

}

function normalizeFinding(entry) {
if (typeof entry === 'string') {
return deepFreeze({
severity: '',
target: '',
message: normalizeString(entry)
});
}

const source = isPlainObject(entry) ? entry : createNullObject();

return deepFreeze({
  severity: normalizeString(source.severity),
  target: normalizeString(source.target),
  message: normalizeString(source.message || source.text)
});

}

function normalizeReviewDecisionInput(review) {
const source = isPlainObject(review) ? review : createNullObject();
const candidate = isPlainObject(source.payload)
? source.payload
: (isPlainObject(source.review) ? source.review : source);
const verdict = normalizeUpperString(candidate.verdict || source.verdict);
const summary = normalizeMultilineText(candidate.summary || source.summary);
const findingsSource = Array.isArray(candidate.findings)
? candidate.findings
: (Array.isArray(source.findings) ? source.findings : []);

if (protocol && typeof protocol.createReviewDecision === 'function') {
  try {
    return protocol.createReviewDecision({
      verdict: verdict,
      summary: summary,
      findings: findingsSource.map(normalizeFinding),
      at: normalizeString(candidate.at || source.at) || nowIsoString()
    });
  } catch (error) {
  }
}

return deepFreeze({
  verdict: normalizeReviewVerdict(verdict, {
    allowEmpty: false
  }),
  summary: summary,
  findings: findingsSource.map(normalizeFinding).filter(function filterFinding(finding) {
    return !!finding.message;
  }),
  at: normalizeString(candidate.at || source.at) || nowIsoString()
});

}

function extractParsedPayloadKind(parsedPayload) {
const source = isPlainObject(parsedPayload) ? parsedPayload : createNullObject();
const nested = isPlainObject(source.payload) ? source.payload : createNullObject();

return normalizeString(
  source.kind
  || nested.kind
  || source.type
  || nested.type
);

}

function extractParsedFilePath(parsedPayload) {
const source = isPlainObject(parsedPayload) ? parsedPayload : createNullObject();
const nested = isPlainObject(source.payload) ? source.payload : createNullObject();

return normalizeTaskFilePath(
  source.path
  || source.targetFile
  || source.currentTaskFilePath
  || nested.path
  || nested.targetFile
  || nested.currentTaskFilePath,
  {
    allowEmpty: true
  }
);

}

function normalizeLastParsedPayloadRecord(rawResponse, parsedPayload, options) {
const config = isPlainObject(options) ? options : createNullObject();
const errors = [];
const configErrors = Array.isArray(config.errors) ? config.errors : [];
const payloadErrors = isPlainObject(parsedPayload) && Array.isArray(parsedPayload.errors)
? parsedPayload.errors
: [];

for (const entry of configErrors.concat(payloadErrors)) {
  if (typeof entry === 'string') {
    errors.push(normalizeString(entry));
    continue;
  }

  if (entry instanceof Error) {
    errors.push(normalizeString(entry.message));
    continue;
  }

  if (isPlainObject(entry)) {
    errors.push(normalizeString(entry.message || entry.code));
  }
}

return deepFreeze({
  parsedAt: normalizeString(config.parsedAt) || nowIsoString(),
  source: normalizeString(config.source),
  kind: extractParsedPayloadKind(parsedPayload) || 'unknown',
  rawText: coerceText(rawResponse),
  parsed: cloneValue(isPlainObject(parsedPayload) ? parsedPayload : null),
  errors: uniqueStrings(errors)
});

}

function slugify(value) {
const source = normalizeString(value);

if (!source) {
  return 'task';
}

let normalized = source;

if (typeof normalized.normalize === 'function') {
  normalized = normalized.normalize('NFKD');
}

normalized = normalized
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .replace(/-{2,}/g, '-');

return normalized || 'task';

}

function buildSuggestedWorkingBranch(issue, repository, options) {
const normalizedIssue = normalizeIssueRef(issue);
const normalizedRepository = buildRepositoryDescriptor(repository);
const config = isPlainObject(options) ? options : createNullObject();
const prefix = normalizeString(config.workingBranchPrefix || normalizedRepository.workingBranchPrefix) || DEFAULT_WORKING_BRANCH_PREFIX;

if (normalizeString(config.workingBranch)) {
  return normalizeGitRefLike(config.workingBranch, 'workingBranch', {
    allowEmpty: false
  });
}

if (CONSTANT_HELPERS && typeof CONSTANT_HELPERS.buildBranchName === 'function') {
  try {
    const candidate = CONSTANT_HELPERS.buildBranchName(
      normalizedIssue.number !== null ? normalizedIssue.number : 'task',
      normalizedIssue.title || 'task',
      prefix
    );

    if (normalizeString(candidate)) {
      return normalizeGitRefLike(candidate, 'workingBranch', {
        allowEmpty: false
      });
    }
  } catch (error) {
  }
}

const issueNumberSegment = normalizedIssue.number !== null ? String(normalizedIssue.number) : 'task';
const titleSegment = slugify(normalizedIssue.title || 'task');
const rawBranchName = prefix + issueNumberSegment + '-' + titleSegment;

return normalizeGitRefLike(rawBranchName.slice(0, 120).replace(/\/+$/, ''), 'workingBranch', {
  allowEmpty: false
});

}

function buildRepositoryUrls(repository) {
const normalized = buildRepositoryDescriptor(repository);

return deepFreeze({
  fullName: normalized.fullName,
  htmlUrl: normalized.htmlUrl,
  apiUrl: normalized.apiUrl,
  issuesHtmlUrl: normalizeString(normalized.htmlUrl) ? normalized.htmlUrl + '/issues' : '',
  issuesApiUrl: normalizeString(normalized.apiUrl) ? normalized.apiUrl + '/issues' : ''
});

}

function buildRepositoryDescriptor(repository) {
const normalized = normalizeRepositoryRef(repository);
const owner = normalizeString(normalized.owner);
const repo = normalizeString(normalized.repo);
const fullName = owner && repo ? owner + '/' + repo : '';
const htmlUrl = fullName ? 'https://github.com/' + encodeURIComponent(owner) + '/' + encodeURIComponent(repo) : '';
const apiUrl = fullName ? DEFAULT_BASE_URL + '/repos/' + encodeURIComponent(owner) + '/' + encodeURIComponent(repo) : '';

return deepFreeze({
  owner: owner,
  repo: repo,
  fullName: fullName,
  htmlUrl: htmlUrl,
  apiUrl: apiUrl,
  baseBranch: normalizeString(normalized.baseBranch) || normalizeString(normalized.defaultBranch) || DEFAULT_BASE_BRANCH,
  defaultBranch: normalizeString(normalized.defaultBranch),
  workingBranchPrefix: normalizeString(normalized.workingBranchPrefix)
});

}

function normalizeRepositoryRef() {
const output = {
owner: '',
repo: '',
baseBranch: '',
defaultBranch: '',
workingBranchPrefix: ''
};

for (let index = 0; index < arguments.length; index += 1) {
  const source = isPlainObject(arguments[index]) ? arguments[index] : createNullObject();

  if (!output.owner && normalizeString(source.owner)) {
    output.owner = normalizeString(source.owner);
  }

  if (!output.repo && normalizeString(source.repo)) {
    output.repo = normalizeString(source.repo);
  }

  if (!output.baseBranch && normalizeString(source.baseBranch)) {
    output.baseBranch = normalizeString(source.baseBranch);
  }

  if (!output.defaultBranch && normalizeString(source.defaultBranch)) {
    output.defaultBranch = normalizeString(source.defaultBranch);
  }

  if (!output.workingBranchPrefix && normalizeString(source.workingBranchPrefix)) {
    output.workingBranchPrefix = normalizeString(source.workingBranchPrefix);
  }
}

if (!output.baseBranch) {
  output.baseBranch = output.defaultBranch || DEFAULT_BASE_BRANCH;
}

return output;

}

function buildWorkflowChangeSummary(previousWorkflow, nextWorkflow) {
const previous = normalizeWorkflowStateFromAny(previousWorkflow);
const next = normalizeWorkflowStateFromAny(nextWorkflow);
const changedKeys = [];
const trackedKeys = [
'stage',
'status',
'currentIssueNumber',
'currentIssueTitle',
'currentIssueUrl',
'currentTaskFilePath',
'activeProviderId',
'workingBranch',
'pullRequestUrl',
'pullRequestNumber',
'latestExecutorResponse',
'latestAuditVerdict',
'latestAuditSummary',
'lastErrorCode',
'lastErrorMessage'
];

for (const key of trackedKeys) {
  if (!valuesEqual(previous[key], next[key])) {
    changedKeys.push(key);
  }
}

if (!selectedProviderIdsEqual(previous.selectedProviderIds, next.selectedProviderIds)) {
  changedKeys.push('selectedProviderIds');
}

const summaryTextParts = [];

if (previous.stage !== next.stage) {
  summaryTextParts.push('stage ' + (previous.stage || '(none)') + ' -> ' + (next.stage || '(none)'));
}

if (previous.status !== next.status) {
  summaryTextParts.push('status ' + (previous.status || '(none)') + ' -> ' + (next.status || '(none)'));
}

if (previous.currentIssueNumber !== next.currentIssueNumber) {
  summaryTextParts.push('issue #' + String(previous.currentIssueNumber === null ? '?' : previous.currentIssueNumber) + ' -> #' + String(next.currentIssueNumber === null ? '?' : next.currentIssueNumber));
}

if (previous.activeProviderId !== next.activeProviderId) {
  summaryTextParts.push('provider ' + (previous.activeProviderId || '(none)') + ' -> ' + (next.activeProviderId || '(none)'));
}

if (previous.latestAuditVerdict !== next.latestAuditVerdict && next.latestAuditVerdict) {
  summaryTextParts.push('audit ' + next.latestAuditVerdict);
}

if (previous.pullRequestNumber !== next.pullRequestNumber && next.pullRequestNumber !== null) {
  summaryTextParts.push('pr #' + String(next.pullRequestNumber));
}

if (previous.lastErrorCode !== next.lastErrorCode && next.lastErrorCode) {
  summaryTextParts.push('error ' + next.lastErrorCode);
}

return deepFreeze({
  changedKeys: changedKeys,
  hasChanges: changedKeys.length > 0,
  stageChanged: previous.stage !== next.stage,
  statusChanged: previous.status !== next.status,
  issueChanged: previous.currentIssueNumber !== next.currentIssueNumber || previous.currentIssueTitle !== next.currentIssueTitle,
  providerChanged: previous.activeProviderId !== next.activeProviderId || !selectedProviderIdsEqual(previous.selectedProviderIds, next.selectedProviderIds),
  summaryText: summaryTextParts.join('; ')
});

}

function workflowStatesEqual(leftWorkflow, rightWorkflow) {
return buildWorkflowChangeSummary(leftWorkflow, rightWorkflow).hasChanges === false;
}

function buildNextWorkflowState(currentWorkflow, patch, options) {
const current = normalizeWorkflowStateFromAny(currentWorkflow);
const sourcePatch = isPlainObject(patch) ? cloneValue(patch) : createNullObject();
const config = isPlainObject(options) ? options : createNullObject();
const normalizedPatch = createNullObject();
const touchesSelections = sourceTouchesProviderSelection(sourcePatch);
const selectedProviderIds = touchesSelections
? mergeSelectedProviderIds(current.selectedProviderIds, sourcePatch, {
throwOnInvalid: normalizeBoolean(config.throwOnInvalidProviders, false)
})
: normalizeSelectedProviderIds(current.selectedProviderIds);

if (touchesSelections) {
  normalizedPatch.selectedProviderIds = selectedProviderIds;
}

if (hasOwn(sourcePatch, 'stage')) {
  normalizedPatch.stage = assertStage(sourcePatch.stage, {
    allowEmpty: false
  });
}

if (hasOwn(sourcePatch, 'status')) {
  normalizedPatch.status = assertStatus(sourcePatch.status, {
    allowEmpty: false
  });
}

if (hasOwn(sourcePatch, 'currentIssueNumber')) {
  normalizedPatch.currentIssueNumber = normalizeIntegerOrNull(sourcePatch.currentIssueNumber);
}

if (hasOwn(sourcePatch, 'currentIssueTitle')) {
  normalizedPatch.currentIssueTitle = normalizeString(sourcePatch.currentIssueTitle);
}

if (hasOwn(sourcePatch, 'currentIssueUrl')) {
  normalizedPatch.currentIssueUrl = normalizeString(sourcePatch.currentIssueUrl);
}

if (hasOwn(sourcePatch, 'currentTaskFilePath')) {
  normalizedPatch.currentTaskFilePath = normalizeTaskFilePath(sourcePatch.currentTaskFilePath);
}

if (hasOwn(sourcePatch, 'activeProviderId')) {
  normalizedPatch.activeProviderId = assertProviderId(sourcePatch.activeProviderId, {
    allowEmpty: true
  });
}

if (hasOwn(sourcePatch, 'workingBranch')) {
  normalizedPatch.workingBranch = normalizeGitRefLike(sourcePatch.workingBranch, 'workingBranch', {
    allowEmpty: true
  });
}

if (hasOwn(sourcePatch, 'pullRequestUrl')) {
  normalizedPatch.pullRequestUrl = normalizeString(sourcePatch.pullRequestUrl);
}

if (hasOwn(sourcePatch, 'pullRequestNumber')) {
  normalizedPatch.pullRequestNumber = normalizeIntegerOrNull(sourcePatch.pullRequestNumber);
}

if (hasOwn(sourcePatch, 'latestExecutorResponse')) {
  normalizedPatch.latestExecutorResponse = coerceText(sourcePatch.latestExecutorResponse);
}

if (hasOwn(sourcePatch, 'latestAuditVerdict')) {
  normalizedPatch.latestAuditVerdict = normalizeString(sourcePatch.latestAuditVerdict)
    ? normalizeReviewVerdict(sourcePatch.latestAuditVerdict, {
        allowEmpty: false
      })
    : '';
}

if (hasOwn(sourcePatch, 'latestAuditSummary')) {
  normalizedPatch.latestAuditSummary = normalizeMultilineText(sourcePatch.latestAuditSummary);
}

if (hasOwn(sourcePatch, 'lastTransitionAt')) {
  normalizedPatch.lastTransitionAt = normalizeString(sourcePatch.lastTransitionAt);
}

if (hasOwn(sourcePatch, 'lastHumanActionAt')) {
  normalizedPatch.lastHumanActionAt = normalizeString(sourcePatch.lastHumanActionAt);
}

if (hasOwn(sourcePatch, 'lastErrorCode')) {
  normalizedPatch.lastErrorCode = normalizeString(sourcePatch.lastErrorCode);
}

if (hasOwn(sourcePatch, 'lastErrorMessage')) {
  normalizedPatch.lastErrorMessage = normalizeMultilineText(sourcePatch.lastErrorMessage);
}

const shouldAutoAssignActiveProvider = normalizeBoolean(
  hasOwn(config, 'autoAssignActiveProvider') ? config.autoAssignActiveProvider : true,
  true
);

if (shouldAutoAssignActiveProvider && !hasOwn(normalizedPatch, 'activeProviderId')) {
  const candidateStage = hasOwn(normalizedPatch, 'stage') ? normalizedPatch.stage : current.stage;
  const role = inferRoleFromStage(candidateStage);

  if (role) {
    normalizedPatch.activeProviderId = resolveProviderForRole(role, hasOwn(normalizedPatch, 'selectedProviderIds') ? normalizedPatch.selectedProviderIds : current.selectedProviderIds);
  } else if (normalizeBoolean(config.clearActiveProviderOnStageWithoutRole, false)) {
    normalizedPatch.activeProviderId = '';
  }
}

const shouldUseTransition = normalizeBoolean(
  hasOwn(config, 'useTransition')
    ? config.useTransition
    : (hasOwn(normalizedPatch, 'stage') || hasOwn(normalizedPatch, 'status') || normalizeString(config.humanAction) !== ''),
  false
);

if (shouldUseTransition && protocol && typeof protocol.transitionWorkflowState === 'function') {
  const humanAction = normalizeString(config.humanAction)
    ? assertHumanAction(config.humanAction, {
        allowEmpty: false
      })
    : '';

  return protocol.transitionWorkflowState(current, normalizedPatch, {
    skipTransitionCheck: normalizeBoolean(config.skipTransitionCheck, false),
    humanAction: humanAction
  });
}

const merged = mergePlainObjects(current, normalizedPatch);

if (hasOwn(normalizedPatch, 'selectedProviderIds')) {
  merged.selectedProviderIds = cloneValue(normalizedPatch.selectedProviderIds);
}

if (normalizeBoolean(config.touchTransitionTimestamp, false)) {
  merged.lastTransitionAt = nowIsoString();
}

return normalizeWorkflowStateFromAny(merged);

}

async function initializeStorageDefaults() {
if (typeof storage.initializeDefaults !== 'function') {
return;
}

await storage.initializeDefaults({
  area: STORAGE_AREA_LOCAL
});

try {
  await storage.initializeDefaults({
    area: STORAGE_AREA_SESSION
  });
} catch (error) {
  logger.debug('Session storage defaults initialization skipped.', {
    message: error && error.message ? error.message : String(error)
  });
}

}

function shouldHandleStorageArea(areaName) {
const normalizedArea = normalizeLowerString(areaName);
return normalizedArea === normalizeLowerString(STORAGE_AREA_LOCAL) || normalizedArea === normalizeLowerString(STORAGE_AREA_SESSION);
}

function buildExternalChangePayload(field, previousValue, nextValue) {
return deepFreeze({
field: field,
previous: cloneValue(previousValue),
current: cloneValue(nextValue)
});
}

function installStorageSyncListener() {
if (runtimeState.storageSyncInstalled === true) {
return;
}

if (typeof chrome === 'undefined'
  || !chrome.storage
  || !chrome.storage.onChanged
  || typeof chrome.storage.onChanged.addListener !== 'function') {
  return;
}

const handler = function onStorageChanged(changes, areaName) {
  if (!shouldHandleStorageArea(areaName)) {
    return;
  }

  const bootstrap = ensureBootstrapCache();
  const externalChanges = [];
  let workflowChanged = false;
  let previousWorkflow = null;
  let nextWorkflow = null;

  if (hasOwn(changes, STORAGE_KEYS.WORKFLOW_STATE || 'workflow_state')) {
    const change = changes[STORAGE_KEYS.WORKFLOW_STATE || 'workflow_state'];
    const incoming = normalizeWorkflowStateFromAny(change && hasOwn(change, 'newValue') ? change.newValue : defaultWorkflowState());
    previousWorkflow = cloneValue(runtimeState.workflow || bootstrap.workflow);

    if (!workflowStatesEqual(previousWorkflow, incoming)) {
      bootstrap.workflow = cloneValue(incoming);
      runtimeState.workflow = cloneValue(incoming);
      bootstrap.loadedAt = nowIsoString();
      workflowChanged = true;
      nextWorkflow = cloneValue(incoming);
    }
  }

  function syncNonWorkflowField(storageKey, fieldName, normalizer) {
    if (!hasOwn(changes, storageKey)) {
      return;
    }

    const change = changes[storageKey];
    const previousValue = cloneValue(bootstrap[fieldName]);
    const nextValue = normalizer(change && hasOwn(change, 'newValue') ? change.newValue : undefined);

    if (valuesEqual(previousValue, nextValue)) {
      return;
    }

    bootstrap[fieldName] = cloneValue(nextValue);
    bootstrap.loadedAt = nowIsoString();
    externalChanges.push(buildExternalChangePayload(fieldName, previousValue, nextValue));
  }

  syncNonWorkflowField(STORAGE_KEYS.SETTINGS || 'settings', 'settings', normalizeSettingsSnapshot);
  syncNonWorkflowField(STORAGE_KEYS.GITHUB_AUTH || 'github_auth', 'githubAuth', normalizeGitHubAuthSnapshot);
  syncNonWorkflowField(STORAGE_KEYS.REPOSITORY || 'repository', 'repository', normalizeRepositorySnapshot);
  syncNonWorkflowField(STORAGE_KEYS.UI_STATE || 'ui_state', 'ui', normalizeUiSnapshot);
  syncNonWorkflowField(STORAGE_KEYS.MANUAL_BRIDGE_DRAFT || 'manual_bridge_draft', 'manualHub', normalizeManualHubSnapshot);
  syncNonWorkflowField(STORAGE_KEYS.LAST_PARSED_PAYLOAD || 'last_parsed_payload', 'lastParsedPayload', function normalizeParsedSnapshot(value) {
    return value === null || typeof value === 'undefined' ? null : cloneValue(value);
  });
  syncNonWorkflowField(STORAGE_KEYS.LAST_AUDIT_RESULT || 'last_audit_result', 'lastAuditResult', function normalizeAuditSnapshot(value) {
    return value === null || typeof value === 'undefined' ? null : cloneValue(value);
  });
  syncNonWorkflowField(STORAGE_KEYS.LAST_ERROR || 'last_error', 'lastError', function normalizeErrorSnapshot(value) {
    return value === null || typeof value === 'undefined' ? null : cloneValue(value);
  });
  syncNonWorkflowField(STORAGE_KEYS.EVENT_LOG || 'event_log', 'eventLog', normalizeEventLogSnapshot);

  if (workflowChanged) {
    notifyListeners(EVENT_TYPES.WORKFLOW_CHANGED, {
      source: 'external_storage_sync',
      previous: previousWorkflow,
      current: nextWorkflow,
      summary: buildWorkflowChangeSummary(previousWorkflow, nextWorkflow)
    });
  }

  if (externalChanges.length > 0) {
    notifyListeners(EVENT_TYPES.EXTERNAL_STORAGE_SYNC, {
      source: 'external_storage_sync',
      area: normalizeLowerString(areaName),
      changes: externalChanges
    });
  }
};

chrome.storage.onChanged.addListener(handler);
runtimeState.storageSyncHandler = handler;
runtimeState.storageSyncInstalled = true;

}

async function refresh(options) {
const config = isPlainObject(options) ? options : createNullObject();
const rawBootstrap = typeof storage.getBootstrapState === 'function'
? await storage.getBootstrapState({
area: STORAGE_AREA_LOCAL
})
: createDefaultBootstrapState();
const snapshot = setBootstrapCache(rawBootstrap);

if (normalizeBoolean(config.syncSelectedProvidersFromSettings, false)) {
  const currentSelections = normalizeSelectedProviderIds(snapshot.workflow.selectedProviderIds);
  const settingsSelections = deriveProviderSelectionsFromSettings(snapshot.settings);

  if (!selectedProviderIdsEqual(currentSelections, settingsSelections)) {
    const nextWorkflow = normalizeWorkflowStateFromAny(mergePlainObjects(snapshot.workflow, {
      selectedProviderIds: settingsSelections
    }));
    await storage.saveWorkflowState(nextWorkflow);
    updateBootstrapField('workflow', nextWorkflow);
  }
}

installStorageSyncListener();

if (normalizeBoolean(config.silent, false) !== true) {
  notifyListeners(EVENT_TYPES.REFRESHED, {
    source: normalizeString(config.source) || 'refresh',
    bootstrap: getCachedBootstrapState()
  });
}

return getCachedBootstrapState();

}

async function initialize(options) {
const config = isPlainObject(options) ? options : createNullObject();

if (runtimeState.initialized === true && normalizeBoolean(config.forceRefresh, false) !== true) {
  return getCachedBootstrapState();
}

if (runtimeState.initializingPromise && normalizeBoolean(config.forceRefresh, false) !== true) {
  return runtimeState.initializingPromise;
}

const promise = (async function initializeInternal() {
  await initializeStorageDefaults();
  const snapshot = await refresh({
    silent: true,
    syncSelectedProvidersFromSettings: normalizeBoolean(config.syncSelectedProvidersFromSettings, false),
    source: 'initialize'
  });
  notifyListeners(EVENT_TYPES.INITIALIZED, {
    source: 'initialize',
    bootstrap: snapshot
  });
  return snapshot;
}());

runtimeState.initializingPromise = promise;

try {
  return await promise;
} finally {
  runtimeState.initializingPromise = null;
}

}

async function ensureInitialized(options) {
return initialize(options);
}

async function getBootstrapState(options) {
const config = isPlainObject(options) ? options : createNullObject();

if (normalizeBoolean(config.refresh, false) === true) {
  return refresh(config);
}

if (runtimeState.initialized === true) {
  return getCachedBootstrapState();
}

return initialize(config);

}

async function getWorkflowState(options) {
const bootstrap = await getBootstrapState(options);
return freezeClone(normalizeWorkflowStateFromAny(bootstrap.workflow));
}

function getSelectedProviderIds(options) {
const source = normalizeBoolean(options && options.fromCache, false)
? getCachedWorkflowState()
: normalizeWorkflowStateFromAny(runtimeState.workflow || ensureBootstrapCache().workflow);

return freezeClone(normalizeSelectedProviderIds(source.selectedProviderIds));

}

function getActiveProviderId(options) {
const source = normalizeBoolean(options && options.fromCache, false)
? getCachedWorkflowState()
: normalizeWorkflowStateFromAny(runtimeState.workflow || ensureBootstrapCache().workflow);

return source.activeProviderId || '';

}

function getCurrentRole(options) {
const source = normalizeBoolean(options && options.fromCache, false)
? getCachedWorkflowState()
: normalizeWorkflowStateFromAny(runtimeState.workflow || ensureBootstrapCache().workflow);

return inferRoleFromStage(source.stage);

}

async function appendEventLog(entry, options) {
await ensureInitialized();
const normalizedEntry = normalizeEventLogEntry(entry, options);

if (typeof storage.appendEventLog !== 'function') {
  const currentLog = ensureBootstrapCache().eventLog || [];
  const nextLog = currentLog.concat([normalizedEntry]);
  updateBootstrapField('eventLog', nextLog);
  notifyListeners(EVENT_TYPES.EVENT_LOG_APPENDED, {
    entry: normalizedEntry,
    eventLog: freezeClone(nextLog)
  });
  return freezeClone(nextLog);
}

const result = await storage.appendEventLog(normalizedEntry);
const normalizedLog = Array.isArray(result) ? result : [normalizedEntry];
updateBootstrapField('eventLog', normalizedLog);
notifyListeners(EVENT_TYPES.EVENT_LOG_APPENDED, {
  entry: normalizedEntry,
  eventLog: freezeClone(normalizedLog)
});
return freezeClone(normalizedLog);

}

async function safeAppendEventLog(entry, options) {
try {
return await appendEventLog(entry, options);
} catch (error) {
logger.warn('Failed to append state event log.', {
code: error && error.code ? error.code : '',
message: error && error.message ? error.message : String(error)
});
return freezeClone(ensureBootstrapCache().eventLog || []);
}
}

async function setLastParsedPayloadRecord(record) {
const normalizedRecord = record === null || typeof record === 'undefined' ? null : cloneValue(record);

if (typeof storage.setLastParsedPayload === 'function') {
  const saved = await storage.setLastParsedPayload(normalizedRecord);
  updateBootstrapField('lastParsedPayload', saved);
  return freezeClone(saved);
}

updateBootstrapField('lastParsedPayload', normalizedRecord);
return freezeClone(normalizedRecord);

}

async function clearLastParsedPayloadRecord() {
if (typeof storage.clearLastParsedPayload === 'function') {
await storage.clearLastParsedPayload();
} else if (typeof storage.remove === 'function') {
await storage.remove(STORAGE_KEYS.LAST_PARSED_PAYLOAD || 'last_parsed_payload');
}

updateBootstrapField('lastParsedPayload', null);
return null;

}

async function setLastAuditResultRecord(record) {
const normalizedRecord = record === null || typeof record === 'undefined' ? null : cloneValue(record);

if (typeof storage.setLastAuditResult === 'function') {
  const saved = await storage.setLastAuditResult(normalizedRecord);
  updateBootstrapField('lastAuditResult', saved);
  return freezeClone(saved);
}

updateBootstrapField('lastAuditResult', normalizedRecord);
return freezeClone(normalizedRecord);

}

async function clearLastAuditResultRecord() {
if (typeof storage.clearLastAuditResult === 'function') {
await storage.clearLastAuditResult();
} else if (typeof storage.remove === 'function') {
await storage.remove(STORAGE_KEYS.LAST_AUDIT_RESULT || 'last_audit_result');
}

updateBootstrapField('lastAuditResult', null);
return null;

}

async function setLastErrorRecord(record) {
const normalizedRecord = record === null || typeof record === 'undefined'
? null
: normalizeErrorRecord(record);

if (typeof storage.setLastError === 'function') {
  const saved = await storage.setLastError(normalizedRecord);
  updateBootstrapField('lastError', saved);
  return freezeClone(saved);
}

updateBootstrapField('lastError', normalizedRecord);
return freezeClone(normalizedRecord);

}

async function clearLastErrorRecord() {
if (typeof storage.clearLastError === 'function') {
await storage.clearLastError();
} else if (typeof storage.remove === 'function') {
await storage.remove(STORAGE_KEYS.LAST_ERROR || 'last_error');
}

updateBootstrapField('lastError', null);
return null;

}

async function patchSettingsAgents(selectedProviderIds) {
const normalized = normalizeSelectedProviderIds(selectedProviderIds);
const patch = {
agents: {
designerProviderId: normalized.designer,
executorProviderId: normalized.executor,
auditorProviderId: normalized.auditor
}
};

if (typeof storage.patchSettings === 'function') {
  const settings = await storage.patchSettings(patch);
  updateBootstrapField('settings', settings);
  return freezeClone(settings);
}

const currentSettings = normalizeSettingsSnapshot(ensureBootstrapCache().settings);
currentSettings.agents = mergePlainObjects(
  stableObject(currentSettings.agents),
  patch.agents
);
updateBootstrapField('settings', currentSettings);
return freezeClone(currentSettings);

}

function getCachedGitHubAuth() {
  const cache = ensureBootstrapCache();
  return freezeClone(normalizeGitHubAuthSnapshot(cache.githubAuth));
}

function getCachedRepository() {
  const cache = ensureBootstrapCache();
  return freezeClone(normalizeRepositorySnapshot(cache.repository));
}

function getCachedSettings() {
  const cache = ensureBootstrapCache();
  return freezeClone(normalizeSettingsSnapshot(cache.settings));
}

async function updateGitHubAuth(nextAuth) {
  const normalized = normalizeGitHubAuthSnapshot(nextAuth);
  let saved = normalized;
  if (typeof storage.saveGitHubAuth === 'function') {
    saved = normalizeGitHubAuthSnapshot(await storage.saveGitHubAuth(normalized));
  }
  updateBootstrapField('githubAuth', saved);
  return freezeClone(saved);
}

async function updateRepository(patch) {
  const source = isPlainObject(patch) ? patch : createNullObject();
  let saved;
  if (typeof storage.patchRepository === 'function') {
    saved = normalizeRepositorySnapshot(await storage.patchRepository(source));
  } else {
    const current = normalizeRepositorySnapshot(ensureBootstrapCache().repository);
    saved = normalizeRepositorySnapshot(mergePlainObjects(current, source));
  }
  updateBootstrapField('repository', saved);
  return freezeClone(saved);
}

async function updateSettings(patch) {
  const source = isPlainObject(patch) ? patch : createNullObject();
  let saved;
  if (typeof storage.patchSettings === 'function') {
    saved = normalizeSettingsSnapshot(await storage.patchSettings(source));
  } else {
    const current = normalizeSettingsSnapshot(ensureBootstrapCache().settings);
    saved = normalizeSettingsSnapshot(mergePlainObjects(current, source));
  }
  updateBootstrapField('settings', saved);
  return freezeClone(saved);
}

async function persistWorkflowState(nextWorkflow, options) {
const config = isPlainObject(options) ? options : createNullObject();
const previousState = normalizeWorkflowStateFromAny(
hasOwn(config, 'previousState')
? config.previousState
: (runtimeState.workflow || ensureBootstrapCache().workflow)
);
const normalizedNextWorkflow = normalizeWorkflowStateFromAny(nextWorkflow);

if (workflowStatesEqual(previousState, normalizedNextWorkflow)
  && normalizeBoolean(config.forcePersist, false) !== true) {
  return freezeClone(normalizedNextWorkflow);
}

const savedWorkflow = typeof storage.saveWorkflowState === 'function'
  ? await storage.saveWorkflowState(normalizedNextWorkflow)
  : normalizedNextWorkflow;
const normalizedSavedWorkflow = normalizeWorkflowStateFromAny(savedWorkflow);
updateBootstrapField('workflow', normalizedSavedWorkflow);

const summary = buildWorkflowChangeSummary(previousState, normalizedSavedWorkflow);
const payload = {
  previous: freezeClone(previousState),
  current: freezeClone(normalizedSavedWorkflow),
  summary: summary,
  meta: stableObject(config.meta)
};

if (normalizeBoolean(config.silentNotify, false) !== true && summary.hasChanges) {
  notifyListeners(EVENT_TYPES.WORKFLOW_CHANGED, payload);

  if (normalizeString(config.eventType)
    && normalizeString(config.eventType) !== EVENT_TYPES.WORKFLOW_CHANGED) {
    notifyListeners(normalizeString(config.eventType), payload);
  }
}

if (normalizeBoolean(config.appendLog, true) === true
  && (normalizeString(config.logMessage) || normalizeString(config.logCode))) {
  await safeAppendEventLog({
    level: normalizeLogLevel(config.logLevel || DEFAULT_LOG_LEVEL),
    code: normalizeString(config.logCode),
    message: normalizeString(config.logMessage) || (summary.summaryText || 'Workflow state updated.'),
    context: mergePlainObjects(
      stableObject(config.logContext),
      {
        stage: normalizedSavedWorkflow.stage,
        status: normalizedSavedWorkflow.status,
        currentIssueNumber: normalizedSavedWorkflow.currentIssueNumber,
        activeProviderId: normalizedSavedWorkflow.activeProviderId,
        changedKeys: summary.changedKeys.slice()
      }
    )
  });
}

return freezeClone(normalizedSavedWorkflow);

}

async function replaceWorkflowState(workflowState, options) {
await ensureInitialized();
const config = isPlainObject(options) ? options : createNullObject();
const nextWorkflow = normalizeWorkflowStateFromAny(workflowState);

return persistWorkflowState(nextWorkflow, {
  previousState: hasOwn(config, 'previousState')
    ? config.previousState
    : getCachedWorkflowState(),
  eventType: normalizeString(config.eventType),
  meta: stableObject(config.meta),
  logLevel: config.logLevel,
  logCode: config.logCode,
  logMessage: config.logMessage,
  logContext: stableObject(config.logContext),
  appendLog: normalizeBoolean(hasOwn(config, 'appendLog') ? config.appendLog : !!(config.logMessage || config.logCode), false),
  forcePersist: normalizeBoolean(config.forcePersist, false),
  silentNotify: normalizeBoolean(config.silentNotify, false)
});

}

async function patchWorkflowState(patch, options) {
await ensureInitialized();
const current = getCachedWorkflowState();
const config = isPlainObject(options) ? options : createNullObject();
const next = buildNextWorkflowState(current, patch, config);

return persistWorkflowState(next, {
  previousState: current,
  eventType: normalizeString(config.eventType),
  meta: stableObject(config.meta),
  logLevel: config.logLevel,
  logCode: config.logCode,
  logMessage: config.logMessage,
  logContext: stableObject(config.logContext),
  appendLog: normalizeBoolean(hasOwn(config, 'appendLog') ? config.appendLog : !!(config.logMessage || config.logCode), false),
  forcePersist: normalizeBoolean(config.forcePersist, false),
  silentNotify: normalizeBoolean(config.silentNotify, false)
});

}

async function transitionWorkflow(stage, options) {
const current = await getWorkflowState();
const config = isPlainObject(options) ? options : createNullObject();
const targetStage = assertStage(
normalizeString(stage) || normalizeString(config.stage) || current.stage,
{
allowEmpty: false
}
);
const status = hasOwn(config, 'status')
? assertStatus(config.status, {
allowEmpty: false
})
: inferDefaultStatusForStage(targetStage, config.mode);
const patch = mergePlainObjects(
stableObject(config.patch),
{
stage: targetStage,
status: status
}
);

if (hasOwn(config, 'activeProviderId')) {
  patch.activeProviderId = assertProviderId(config.activeProviderId, {
    allowEmpty: true
  });
}

if (hasOwn(config, 'currentTaskFilePath')) {
  patch.currentTaskFilePath = normalizeTaskFilePath(config.currentTaskFilePath);
}

if (hasOwn(config, 'workingBranch')) {
  patch.workingBranch = normalizeGitRefLike(config.workingBranch, 'workingBranch', {
    allowEmpty: true
  });
}

return patchWorkflowState(patch, {
  useTransition: true,
  skipTransitionCheck: normalizeBoolean(config.skipTransitionCheck, false),
  humanAction: normalizeString(config.humanAction),
  autoAssignActiveProvider: hasOwn(config, 'autoAssignActiveProvider') ? config.autoAssignActiveProvider : true,
  clearActiveProviderOnStageWithoutRole: normalizeBoolean(config.clearActiveProviderOnStageWithoutRole, false),
  eventType: normalizeString(config.eventType),
  meta: stableObject(config.meta),
  logLevel: config.logLevel,
  logCode: config.logCode,
  logMessage: config.logMessage,
  logContext: stableObject(config.logContext),
  appendLog: normalizeBoolean(hasOwn(config, 'appendLog') ? config.appendLog : !!(config.logMessage || config.logCode), false),
  silentNotify: normalizeBoolean(config.silentNotify, false)
});

}

async function startStage(stage, options) {
const config = isPlainObject(options) ? options : createNullObject();

return transitionWorkflow(stage, mergePlainObjects(config, {
  mode: 'start',
  eventType: normalizeString(config.eventType) || EVENT_TYPES.WORKFLOW_CHANGED
}));

}

async function markStageReady(stage, options) {
const config = isPlainObject(options) ? options : createNullObject();

return transitionWorkflow(stage, mergePlainObjects(config, {
  mode: 'ready',
  eventType: normalizeString(config.eventType) || EVENT_TYPES.WORKFLOW_CHANGED
}));

}

async function setStatus(status, options) {
const current = await getWorkflowState();
const config = isPlainObject(options) ? options : createNullObject();

return transitionWorkflow(current.stage, mergePlainObjects(config, {
  status: status,
  eventType: normalizeString(config.eventType) || EVENT_TYPES.WORKFLOW_CHANGED
}));

}

async function advanceStage(stage, options) {
return transitionWorkflow(stage, options);
}

async function advanceToNextStage(options) {
const current = await getWorkflowState();
const config = isPlainObject(options) ? options : createNullObject();
const nextStage = normalizeString(config.nextStage) || nextStageAfter(current.stage);

if (!nextStage) {
  throw createStateStoreError(
    ERROR_CODES.INVALID_STATE || 'INVALID_STATE',
    'No next workflow stage is available.',
    {
      currentStage: current.stage
    }
  );
}

return transitionWorkflow(nextStage, mergePlainObjects(config, {
  eventType: normalizeString(config.eventType) || EVENT_TYPES.WORKFLOW_CHANGED
}));

}

async function recordHumanAction(action, details, options) {
await ensureInitialized();
const current = getCachedWorkflowState();
const config = isPlainObject(options) ? options : createNullObject();
const humanAction = assertHumanAction(action, {
allowEmpty: false
});
let record = null;

if (protocol && typeof protocol.createHumanActionRecord === 'function') {
  try {
    record = protocol.createHumanActionRecord(humanAction, stableObject(details));
  } catch (error) {
  }
}

const patch = mergePlainObjects(
  stableObject(config.patch),
  {
    stage: normalizeString(config.stage) ? assertStage(config.stage, { allowEmpty: false }) : current.stage,
    status: normalizeString(config.status) ? assertStatus(config.status, { allowEmpty: false }) : current.status
  }
);

const saved = await patchWorkflowState(patch, {
  useTransition: true,
  humanAction: humanAction,
  skipTransitionCheck: normalizeBoolean(config.skipTransitionCheck, false),
  eventType: EVENT_TYPES.HUMAN_ACTION_RECORDED,
  meta: record ? { humanAction: cloneValue(record) } : stableObject(config.meta),
  logLevel: config.logLevel || 'info',
  logCode: normalizeString(config.logCode) || 'HUMAN_ACTION',
  logMessage: normalizeString(config.logMessage) || ('Human action recorded: ' + humanAction + '.'),
  logContext: mergePlainObjects(
    stableObject(config.logContext),
    {
      action: humanAction,
      details: stableObject(details)
    }
  ),
  appendLog: normalizeBoolean(hasOwn(config, 'appendLog') ? config.appendLog : true, true)
});

return freezeClone(saved);

}

async function setSelectedProviders(providerPatch, options) {
await ensureInitialized();
const current = getCachedWorkflowState();
const config = isPlainObject(options) ? options : createNullObject();
const nextSelectedProviderIds = mergeSelectedProviderIds(current.selectedProviderIds, providerPatch, {
throwOnInvalid: true
});

if (selectedProviderIdsEqual(current.selectedProviderIds, nextSelectedProviderIds)
  && normalizeBoolean(config.persistToSettings, false) !== true) {
  return getCachedWorkflowState();
}

if (normalizeBoolean(config.persistToSettings, false) === true) {
  await patchSettingsAgents(nextSelectedProviderIds);
}

const patch = {
  selectedProviderIds: nextSelectedProviderIds
};

if (normalizeBoolean(hasOwn(config, 'syncActiveProvider') ? config.syncActiveProvider : true, true)) {
  const role = inferRoleFromStage(current.stage);

  if (role) {
    patch.activeProviderId = resolveProviderForRole(role, nextSelectedProviderIds);
  }
}

return patchWorkflowState(patch, {
  eventType: EVENT_TYPES.PROVIDERS_CHANGED,
  logLevel: config.logLevel || 'info',
  logCode: normalizeString(config.logCode) || 'PROVIDERS_CHANGED',
  logMessage: normalizeString(config.logMessage) || 'Selected providers updated.',
  logContext: mergePlainObjects(
    stableObject(config.logContext),
    {
      selectedProviderIds: cloneValue(nextSelectedProviderIds)
    }
  ),
  appendLog: normalizeBoolean(hasOwn(config, 'appendLog') ? config.appendLog : true, true),
  autoAssignActiveProvider: hasOwn(config, 'autoAssignActiveProvider') ? config.autoAssignActiveProvider : true,
  clearActiveProviderOnStageWithoutRole: normalizeBoolean(config.clearActiveProviderOnStageWithoutRole, false)
});

}

async function syncSelectedProvidersFromSettings(options) {
await ensureInitialized();
const bootstrap = getCachedBootstrapState();
const selections = deriveProviderSelectionsFromSettings(bootstrap.settings);

return setSelectedProviders(selections, mergePlainObjects(
  {
    persistToSettings: false,
    syncActiveProvider: true
  },
  stableObject(options)
));

}

async function setProviderForRole(role, providerId, options) {
const normalizedRole = assertRole(role, {
allowEmpty: false
});

return setSelectedProviders(
  (function buildRolePatch() {
    const patch = createNullObject();
    patch[normalizedRole] = assertProviderId(providerId, {
      allowEmpty: false
    });
    return patch;
  }()),
  options
);

}

async function setActiveProvider(providerId, options) {
const config = isPlainObject(options) ? options : createNullObject();
const normalizedProviderId = assertProviderId(providerId, {
allowEmpty: normalizeBoolean(config.allowEmpty, false)
});

return patchWorkflowState({
  activeProviderId: normalizedProviderId
}, {
  eventType: EVENT_TYPES.ACTIVE_PROVIDER_CHANGED,
  logLevel: config.logLevel || 'info',
  logCode: normalizeString(config.logCode) || 'ACTIVE_PROVIDER_CHANGED',
  logMessage: normalizeString(config.logMessage) || 'Active provider changed.',
  logContext: mergePlainObjects(
    stableObject(config.logContext),
    {
      activeProviderId: normalizedProviderId
    }
  ),
  appendLog: normalizeBoolean(hasOwn(config, 'appendLog') ? config.appendLog : true, true),
  autoAssignActiveProvider: false,
  clearActiveProviderOnStageWithoutRole: false
});

}

async function activateRole(role, options) {
const normalizedRole = assertRole(role, {
allowEmpty: false
});
const current = await getWorkflowState();
const providerId = hasOwn(options || {}, 'providerId')
? assertProviderId(options.providerId, {
allowEmpty: false
})
: resolveProviderForRole(normalizedRole, current.selectedProviderIds);

return setActiveProvider(providerId, mergePlainObjects(
  stableObject(options),
  {
    logCode: normalizeString(options && options.logCode) || 'ACTIVE_ROLE_CHANGED',
    logMessage: normalizeString(options && options.logMessage) || ('Active role provider changed for ' + normalizedRole + '.'),
    logContext: mergePlainObjects(
      stableObject(options && options.logContext),
      {
        role: normalizedRole,
        providerId: providerId
      }
    )
  }
));

}

async function clearExecutionArtifacts(options) {
await ensureInitialized();
const current = getCachedWorkflowState();
const config = isPlainObject(options) ? options : createNullObject();

await Promise.all([
  normalizeBoolean(hasOwn(config, 'clearParsedPayload') ? config.clearParsedPayload : true, true)
    ? clearLastParsedPayloadRecord()
    : Promise.resolve(null),
  normalizeBoolean(hasOwn(config, 'clearAuditResult') ? config.clearAuditResult : true, true)
    ? clearLastAuditResultRecord()
    : Promise.resolve(null),
  normalizeBoolean(hasOwn(config, 'clearErrorRecord') ? config.clearErrorRecord : true, true)
    ? clearLastErrorRecord()
    : Promise.resolve(null)
]);

const patch = {
  latestExecutorResponse: '',
  latestAuditVerdict: '',
  latestAuditSummary: '',
  pullRequestUrl: '',
  pullRequestNumber: null,
  lastErrorCode: '',
  lastErrorMessage: ''
};

if (normalizeBoolean(config.clearWorkingBranch, false)) {
  patch.workingBranch = '';
}

if (normalizeBoolean(config.clearTargetFile, false)) {
  patch.currentTaskFilePath = '';
}

return patchWorkflowState(patch, {
  eventType: normalizeString(config.eventType),
  logLevel: config.logLevel || 'info',
  logCode: normalizeString(config.logCode) || 'EXECUTION_ARTIFACTS_CLEARED',
  logMessage: normalizeString(config.logMessage) || 'Execution artifacts cleared.',
  logContext: stableObject(config.logContext),
  appendLog: normalizeBoolean(hasOwn(config, 'appendLog') ? config.appendLog : true, true),
  autoAssignActiveProvider: false,
  clearActiveProviderOnStageWithoutRole: false
});

}

async function resetWorkflowState(options) {
await ensureInitialized();
const current = getCachedWorkflowState();
const config = isPlainObject(options) ? options : createNullObject();
const next = defaultWorkflowState();

if (normalizeBoolean(hasOwn(config, 'preserveSelectedProviders') ? config.preserveSelectedProviders : true, true)) {
  next.selectedProviderIds = normalizeSelectedProviderIds(current.selectedProviderIds);
}

if (normalizeBoolean(config.keepIssue, false)) {
  next.currentIssueNumber = current.currentIssueNumber;
  next.currentIssueTitle = current.currentIssueTitle;
  next.currentIssueUrl = current.currentIssueUrl;
  next.currentTaskFilePath = current.currentTaskFilePath;
  next.workingBranch = current.workingBranch;
}

next.stage = normalizeString(config.stage)
  ? assertStage(config.stage, { allowEmpty: false })
  : (WORKFLOW_STAGES.IDLE || 'idle');
next.status = normalizeString(config.status)
  ? assertStatus(config.status, { allowEmpty: false })
  : inferDefaultStatusForStage(next.stage, next.stage === (WORKFLOW_STAGES.IDLE || 'idle') ? 'idle' : 'ready');
next.activeProviderId = normalizeBoolean(config.keepActiveProvider, false)
  ? current.activeProviderId
  : '';
next.lastTransitionAt = nowIsoString();

await Promise.all([
  normalizeBoolean(hasOwn(config, 'clearParsedPayload') ? config.clearParsedPayload : true, true)
    ? clearLastParsedPayloadRecord()
    : Promise.resolve(null),
  normalizeBoolean(hasOwn(config, 'clearAuditResult') ? config.clearAuditResult : true, true)
    ? clearLastAuditResultRecord()
    : Promise.resolve(null),
  normalizeBoolean(hasOwn(config, 'clearErrorRecord') ? config.clearErrorRecord : true, true)
    ? clearLastErrorRecord()
    : Promise.resolve(null)
]);

return replaceWorkflowState(next, {
  previousState: current,
  eventType: EVENT_TYPES.RESET,
  logLevel: config.logLevel || 'info',
  logCode: normalizeString(config.logCode) || 'WORKFLOW_RESET',
  logMessage: normalizeString(config.logMessage) || 'Workflow state reset.',
  logContext: stableObject(config.logContext),
  appendLog: normalizeBoolean(hasOwn(config, 'appendLog') ? config.appendLog : true, true)
});

}

async function clearTaskContext(options) {
const config = isPlainObject(options) ? options : createNullObject();

return resetWorkflowState(mergePlainObjects(config, {
  preserveSelectedProviders: hasOwn(config, 'preserveSelectedProviders') ? config.preserveSelectedProviders : true,
  keepIssue: false
}));

}

async function selectIssue(issue, options) {
await ensureInitialized();
const current = getCachedWorkflowState();
const bootstrap = getCachedBootstrapState();
const config = isPlainObject(options) ? options : createNullObject();
const issueRef = normalizeIssueRef(issue);

if (issueRef.number === null && !issueRef.title) {
  throw createStateStoreError(
    ERROR_CODES.INVALID_ARGUMENT || 'INVALID_ARGUMENT',
    'Issue selection requires at least an issue number or title.',
    {
      issue: cloneValue(issueRef)
    }
  );
}

const repository = buildRepositoryDescriptor(
  normalizeRepositoryRef(
    stableObject(config.repository),
    stableObject(bootstrap.repository)
  )
);
const selectedProviderIds = normalizeSelectedProviderIds(current.selectedProviderIds);
const stage = normalizeString(config.stage)
  ? assertStage(config.stage, { allowEmpty: false })
  : (WORKFLOW_STAGES.DESIGN || 'design');
const status = normalizeString(config.status)
  ? assertStatus(config.status, { allowEmpty: false })
  : inferDefaultStatusForStage(stage, 'ready');
const targetFile = normalizeTaskFilePath(
  config.targetFile
  || config.currentTaskFilePath
  || '',
  {
    allowEmpty: true
  }
);
const workingBranch = buildSuggestedWorkingBranch(issueRef, repository, {
  workingBranchPrefix: config.workingBranchPrefix || repository.workingBranchPrefix,
  workingBranch: config.workingBranch
});
const activeProviderId = normalizeString(config.activeProviderId)
  ? assertProviderId(config.activeProviderId, {
      allowEmpty: true
    })
  : (inferRoleFromStage(stage)
    ? resolveProviderForRole(inferRoleFromStage(stage), selectedProviderIds)
    : '');

await Promise.all([
  normalizeBoolean(hasOwn(config, 'clearParsedPayload') ? config.clearParsedPayload : true, true)
    ? clearLastParsedPayloadRecord()
    : Promise.resolve(null),
  normalizeBoolean(hasOwn(config, 'clearAuditResult') ? config.clearAuditResult : true, true)
    ? clearLastAuditResultRecord()
    : Promise.resolve(null),
  normalizeBoolean(hasOwn(config, 'clearErrorRecord') ? config.clearErrorRecord : true, true)
    ? clearLastErrorRecord()
    : Promise.resolve(null)
]);

const next = normalizeWorkflowStateFromAny({
  stage: stage,
  status: status,
  currentIssueNumber: issueRef.number,
  currentIssueTitle: issueRef.title,
  currentIssueUrl: issueRef.url,
  currentTaskFilePath: targetFile,
  activeProviderId: activeProviderId,
  selectedProviderIds: selectedProviderIds,
  workingBranch: workingBranch,
  pullRequestUrl: '',
  pullRequestNumber: null,
  latestExecutorResponse: '',
  latestAuditVerdict: '',
  latestAuditSummary: '',
  lastTransitionAt: nowIsoString(),
  lastHumanActionAt: '',
  lastErrorCode: '',
  lastErrorMessage: ''
});

return replaceWorkflowState(next, {
  previousState: current,
  eventType: EVENT_TYPES.ISSUE_SELECTED,
  logLevel: config.logLevel || 'info',
  logCode: normalizeString(config.logCode) || 'ISSUE_SELECTED',
  logMessage: normalizeString(config.logMessage) || ('Issue selected: ' + (issueRef.number === null ? '(manual)' : '#' + String(issueRef.number)) + '.'),
  logContext: mergePlainObjects(
    stableObject(config.logContext),
    {
      issue: cloneValue(issueRef),
      repository: cloneValue(repository),
      targetFile: targetFile,
      workingBranch: workingBranch
    }
  ),
  appendLog: normalizeBoolean(hasOwn(config, 'appendLog') ? config.appendLog : true, true)
});

}

async function setCurrentTaskFilePath(path, options) {
const config = isPlainObject(options) ? options : createNullObject();
const normalizedPath = normalizeTaskFilePath(path);

return patchWorkflowState({
  currentTaskFilePath: normalizedPath
}, {
  eventType: normalizeString(config.eventType),
  logLevel: config.logLevel || 'info',
  logCode: normalizeString(config.logCode) || 'TARGET_FILE_SET',
  logMessage: normalizeString(config.logMessage) || 'Current task file path updated.',
  logContext: mergePlainObjects(
    stableObject(config.logContext),
    {
      currentTaskFilePath: normalizedPath
    }
  ),
  appendLog: normalizeBoolean(hasOwn(config, 'appendLog') ? config.appendLog : false, false),
  autoAssignActiveProvider: false
});

}

async function setWorkingBranch(branch, options) {
const config = isPlainObject(options) ? options : createNullObject();
const normalizedBranch = normalizeGitRefLike(branch, 'workingBranch', {
allowEmpty: true
});

return patchWorkflowState({
  workingBranch: normalizedBranch
}, {
  eventType: normalizeString(config.eventType),
  logLevel: config.logLevel || 'info',
  logCode: normalizeString(config.logCode) || 'WORKING_BRANCH_SET',
  logMessage: normalizeString(config.logMessage) || 'Working branch updated.',
  logContext: mergePlainObjects(
    stableObject(config.logContext),
    {
      workingBranch: normalizedBranch
    }
  ),
  appendLog: normalizeBoolean(hasOwn(config, 'appendLog') ? config.appendLog : false, false),
  autoAssignActiveProvider: false
});

}

async function recordExecutorResponse(rawResponse, options) {
await ensureInitialized();
const current = getCachedWorkflowState();
const config = isPlainObject(options) ? options : createNullObject();
const normalizedResponse = coerceText(rawResponse);

if (!normalizedResponse) {
  throw createStateStoreError(
    ERROR_CODES.INVALID_ARGUMENT || 'INVALID_ARGUMENT',
    'Executor response text is required.',
    createNullObject()
  );
}

const parsedPayloadRecord = normalizeLastParsedPayloadRecord(
  normalizedResponse,
  config.parsedPayload,
  {
    source: normalizeString(config.source || current.activeProviderId),
    errors: config.errors
  }
);

if (normalizeBoolean(hasOwn(config, 'persistParsedPayload') ? config.persistParsedPayload : true, true)) {
  await setLastParsedPayloadRecord(parsedPayloadRecord);
}

if (normalizeBoolean(hasOwn(config, 'clearAuditResult') ? config.clearAuditResult : true, true)) {
  await clearLastAuditResultRecord();
}

if (normalizeBoolean(config.clearErrorRecord, false)) {
  await clearLastErrorRecord();
}

const patch = {
  latestExecutorResponse: normalizedResponse,
  latestAuditVerdict: '',
  latestAuditSummary: ''
};
const parsedFilePath = extractParsedFilePath(config.parsedPayload);

if (parsedFilePath && (normalizeBoolean(hasOwn(config, 'updateTargetFile') ? config.updateTargetFile : true, true) || !current.currentTaskFilePath)) {
  patch.currentTaskFilePath = parsedFilePath;
}

if (normalizeBoolean(config.clearErrorRecord, false)) {
  patch.lastErrorCode = '';
  patch.lastErrorMessage = '';
}

if (normalizeBoolean(config.transitionToAudit, false)) {
  patch.stage = WORKFLOW_STAGES.AUDIT || 'audit';
  patch.status = hasOwn(config, 'status')
    ? assertStatus(config.status, { allowEmpty: false })
    : normalizeLowerString(WORKFLOW_STATUSES.READY || 'ready');
} else if (hasOwn(config, 'stage')) {
  patch.stage = assertStage(config.stage, {
    allowEmpty: false
  });
} else if (hasOwn(config, 'status')) {
  patch.status = assertStatus(config.status, {
    allowEmpty: false
  });
}

return patchWorkflowState(patch, {
  useTransition: hasOwn(patch, 'stage') || hasOwn(patch, 'status'),
  skipTransitionCheck: normalizeBoolean(config.skipTransitionCheck, false),
  eventType: EVENT_TYPES.EXECUTOR_RESPONSE_RECORDED,
  logLevel: config.logLevel || 'info',
  logCode: normalizeString(config.logCode) || 'EXECUTOR_RESPONSE_RECORDED',
  logMessage: normalizeString(config.logMessage) || 'Executor response recorded.',
  logContext: mergePlainObjects(
    stableObject(config.logContext),
    {
      parsedPath: parsedFilePath,
      responseLength: normalizedResponse.length,
      transitionToAudit: normalizeBoolean(config.transitionToAudit, false)
    }
  ),
  appendLog: normalizeBoolean(hasOwn(config, 'appendLog') ? config.appendLog : true, true)
});

}

async function recordAuditResult(review, options) {
await ensureInitialized();
const current = getCachedWorkflowState();
const config = isPlainObject(options) ? options : createNullObject();
const decision = normalizeReviewDecisionInput(review);

await setLastAuditResultRecord({
  verdict: decision.verdict,
  summary: decision.summary,
  findings: cloneValue(decision.findings),
  reviewedAt: normalizeString(decision.at) || nowIsoString()
});

if (normalizeBoolean(config.clearErrorRecord, false)) {
  await clearLastErrorRecord();
}

const patch = {
  latestAuditVerdict: decision.verdict,
  latestAuditSummary: decision.summary
};

if (normalizeBoolean(config.clearErrorRecord, false)) {
  patch.lastErrorCode = '';
  patch.lastErrorMessage = '';
}

if (normalizeBoolean(config.autoApplyVerdict, false)) {
  if (decision.verdict === (REVIEW_VERDICTS_MAP.APPROVE || 'APPROVE')) {
    patch.stage = normalizeString(config.approveStage) || normalizeLowerString(WORKFLOW_STAGES.PR || 'pr');
    patch.status = normalizeString(config.approveStatus)
      ? assertStatus(config.approveStatus, { allowEmpty: false })
      : normalizeLowerString(WORKFLOW_STATUSES.READY || 'ready');
  } else {
    patch.stage = normalizeString(config.rejectStage) || normalizeLowerString(WORKFLOW_STAGES.EXECUTION || 'execution');
    patch.status = normalizeString(config.rejectStatus)
      ? assertStatus(config.rejectStatus, { allowEmpty: false })
      : normalizeLowerString(WORKFLOW_STATUSES.READY || 'ready');
  }
} else {
  if (hasOwn(config, 'stage')) {
    patch.stage = assertStage(config.stage, {
      allowEmpty: false
    });
  } else if (current.stage !== normalizeLowerString(WORKFLOW_STAGES.AUDIT || 'audit')) {
    patch.stage = normalizeLowerString(WORKFLOW_STAGES.AUDIT || 'audit');
  }

  if (hasOwn(config, 'status')) {
    patch.status = assertStatus(config.status, {
      allowEmpty: false
    });
  } else {
    patch.status = decision.verdict === (REVIEW_VERDICTS_MAP.APPROVE || 'APPROVE')
      ? normalizeLowerString(WORKFLOW_STATUSES.APPROVED || 'approved')
      : normalizeLowerString(WORKFLOW_STATUSES.REJECTED || 'rejected');
  }
}

if (normalizeString(config.targetFile)) {
  patch.currentTaskFilePath = normalizeTaskFilePath(config.targetFile);
}

return patchWorkflowState(patch, {
  useTransition: true,
  skipTransitionCheck: normalizeBoolean(config.skipTransitionCheck, false),
  eventType: EVENT_TYPES.AUDIT_RESULT_RECORDED,
  logLevel: config.logLevel || 'info',
  logCode: normalizeString(config.logCode) || (decision.verdict === (REVIEW_VERDICTS_MAP.APPROVE || 'APPROVE') ? 'AUDIT_APPROVED' : 'AUDIT_REJECTED'),
  logMessage: normalizeString(config.logMessage) || ('Audit result recorded: ' + decision.verdict + '.'),
  logContext: mergePlainObjects(
    stableObject(config.logContext),
    {
      verdict: decision.verdict,
      summary: decision.summary,
      findingCount: Array.isArray(decision.findings) ? decision.findings.length : 0
    }
  ),
  appendLog: normalizeBoolean(hasOwn(config, 'appendLog') ? config.appendLog : true, true)
});

}

async function applyAuditApproved(review, options) {
const decision = normalizeReviewDecisionInput(review);

if (decision.verdict !== (REVIEW_VERDICTS_MAP.APPROVE || 'APPROVE')) {
  throw createStateStoreError(
    ERROR_CODES.INVALID_ARGUMENT || 'INVALID_ARGUMENT',
    'Audit approval wrapper requires an APPROVE verdict.',
    {
      verdict: decision.verdict
    }
  );
}

return recordAuditResult(decision, mergePlainObjects(
  {
    autoApplyVerdict: true
  },
  stableObject(options)
));

}

async function applyAuditRejected(review, options) {
const decision = normalizeReviewDecisionInput(review);

if (decision.verdict !== (REVIEW_VERDICTS_MAP.REJECT || 'REJECT')) {
  throw createStateStoreError(
    ERROR_CODES.INVALID_ARGUMENT || 'INVALID_ARGUMENT',
    'Audit rejection wrapper requires a REJECT verdict.',
    {
      verdict: decision.verdict
    }
  );
}

return recordAuditResult(decision, mergePlainObjects(
  {
    autoApplyVerdict: true
  },
  stableObject(options)
));

}

async function setPullRequest(pullRequest, options) {
const config = isPlainObject(options) ? options : createNullObject();
const normalizedPullRequest = normalizePullRequestRef(pullRequest);
const patch = {
pullRequestNumber: normalizedPullRequest.number,
pullRequestUrl: normalizedPullRequest.url
};

if (hasOwn(config, 'stage')) {
  patch.stage = assertStage(config.stage, {
    allowEmpty: false
  });
}

if (hasOwn(config, 'status')) {
  patch.status = assertStatus(config.status, {
    allowEmpty: false
  });
}

return patchWorkflowState(patch, {
  useTransition: hasOwn(patch, 'stage') || hasOwn(patch, 'status'),
  skipTransitionCheck: normalizeBoolean(config.skipTransitionCheck, false),
  clearActiveProviderOnStageWithoutRole: normalizeBoolean(config.clearActiveProviderOnStageWithoutRole, false),
  eventType: normalizeString(config.eventType) || EVENT_TYPES.PULL_REQUEST_RECORDED,
  logLevel: config.logLevel || 'info',
  logCode: normalizeString(config.logCode) || 'PULL_REQUEST_RECORDED',
  logMessage: normalizeString(config.logMessage) || 'Pull request reference updated.',
  logContext: mergePlainObjects(
    stableObject(config.logContext),
    {
      pullRequestNumber: normalizedPullRequest.number,
      pullRequestUrl: normalizedPullRequest.url,
      headRef: normalizedPullRequest.headRef,
      baseRef: normalizedPullRequest.baseRef
    }
  ),
  appendLog: normalizeBoolean(hasOwn(config, 'appendLog') ? config.appendLog : true, true)
});

}

async function recordPullRequestCreated(pullRequest, options) {
const config = isPlainObject(options) ? options : createNullObject();

return setPullRequest(pullRequest, mergePlainObjects(
  {
    stage: WORKFLOW_STAGES.COMPLETED || 'completed',
    status: WORKFLOW_STATUSES.COMPLETED || 'completed',
    skipTransitionCheck: true,
    clearActiveProviderOnStageWithoutRole: true,
    logCode: 'PULL_REQUEST_CREATED',
    logMessage: 'Pull request created.'
  },
  config
));

}

async function setError(error, options) {
const config = isPlainObject(options) ? options : createNullObject();
const normalizedError = normalizeErrorRecord(error, config);

await setLastErrorRecord(normalizedError);

const patch = {
  lastErrorCode: normalizedError.code,
  lastErrorMessage: normalizedError.message
};

if (normalizeBoolean(config.transitionToError, false)) {
  patch.stage = normalizeLowerString(WORKFLOW_STAGES.ERROR || 'error');
  patch.status = normalizeLowerString(WORKFLOW_STATUSES.FAILED || 'failed');
}

return patchWorkflowState(patch, {
  useTransition: normalizeBoolean(config.transitionToError, false),
  skipTransitionCheck: normalizeBoolean(config.skipTransitionCheck, normalizeBoolean(config.transitionToError, false)),
  clearActiveProviderOnStageWithoutRole: normalizeBoolean(config.clearActiveProviderOnStageWithoutRole, false),
  eventType: EVENT_TYPES.ERROR_SET,
  logLevel: config.logLevel || 'error',
  logCode: normalizeString(config.logCode) || normalizedError.code,
  logMessage: normalizeString(config.logMessage) || normalizedError.message,
  logContext: mergePlainObjects(
    stableObject(config.logContext),
    {
      details: cloneValue(normalizedError.details)
    }
  ),
  appendLog: normalizeBoolean(hasOwn(config, 'appendLog') ? config.appendLog : true, true)
});

}

async function failWorkflow(error, options) {
return setError(error, mergePlainObjects(
{
transitionToError: true,
skipTransitionCheck: true,
clearActiveProviderOnStageWithoutRole: false
},
stableObject(options)
));
}

async function clearError(options) {
const config = isPlainObject(options) ? options : createNullObject();

await clearLastErrorRecord();

const patch = {
  lastErrorCode: '',
  lastErrorMessage: ''
};

if (hasOwn(config, 'stage')) {
  patch.stage = assertStage(config.stage, {
    allowEmpty: false
  });
}

if (hasOwn(config, 'status')) {
  patch.status = assertStatus(config.status, {
    allowEmpty: false
  });
}

return patchWorkflowState(patch, {
  useTransition: hasOwn(patch, 'stage') || hasOwn(patch, 'status'),
  skipTransitionCheck: normalizeBoolean(config.skipTransitionCheck, false),
  eventType: EVENT_TYPES.ERROR_CLEARED,
  logLevel: config.logLevel || 'info',
  logCode: normalizeString(config.logCode) || 'ERROR_CLEARED',
  logMessage: normalizeString(config.logMessage) || 'Workflow error cleared.',
  logContext: stableObject(config.logContext),
  appendLog: normalizeBoolean(hasOwn(config, 'appendLog') ? config.appendLog : true, true),
  autoAssignActiveProvider: hasOwn(config, 'autoAssignActiveProvider') ? config.autoAssignActiveProvider : true,
  clearActiveProviderOnStageWithoutRole: normalizeBoolean(config.clearActiveProviderOnStageWithoutRole, false)
});

}

async function completeWorkflow(options) {
const config = isPlainObject(options) ? options : createNullObject();

return transitionWorkflow(WORKFLOW_STAGES.COMPLETED || 'completed', mergePlainObjects(
  {
    mode: 'completed',
    clearActiveProviderOnStageWithoutRole: true
  },
  config
));

}

function findCachedIssueSummary() {
const workflow = ensureBootstrapCache().workflow || defaultWorkflowState();

return deepFreeze({
  number: workflow.currentIssueNumber,
  title: workflow.currentIssueTitle,
  url: workflow.currentIssueUrl,
  targetFile: workflow.currentTaskFilePath,
  workingBranch: workflow.workingBranch
});

}

const api = {
eventTypes: EVENT_TYPES,
initialize: initialize,
ensureInitialized: ensureInitialized,
refresh: refresh,
getBootstrapState: getBootstrapState,
getCachedBootstrapState: getCachedBootstrapState,
getWorkflowState: getWorkflowState,
getCachedWorkflowState: getCachedWorkflowState,
getSelectedProviderIds: getSelectedProviderIds,
getActiveProviderId: getActiveProviderId,
getCurrentRole: getCurrentRole,
getLastEvent: getLastEvent,
subscribe: subscribe,
unsubscribeAll: unsubscribeAll,
appendEventLog: appendEventLog,
patchWorkflowState: patchWorkflowState,
getCachedGitHubAuth: getCachedGitHubAuth,
getCachedRepository: getCachedRepository,
getCachedSettings: getCachedSettings,
updateGitHubAuth: updateGitHubAuth,
updateRepository: updateRepository,
updateSettings: updateSettings,
replaceWorkflowState: replaceWorkflowState,
transitionWorkflow: transitionWorkflow,
advanceStage: advanceStage,
advanceToNextStage: advanceToNextStage,
startStage: startStage,
markStageReady: markStageReady,
setStatus: setStatus,
recordHumanAction: recordHumanAction,
setSelectedProviders: setSelectedProviders,
syncSelectedProvidersFromSettings: syncSelectedProvidersFromSettings,
setProviderForRole: setProviderForRole,
setActiveProvider: setActiveProvider,
activateRole: activateRole,
selectIssue: selectIssue,
clearTaskContext: clearTaskContext,
resetWorkflowState: resetWorkflowState,
clearExecutionArtifacts: clearExecutionArtifacts,
setCurrentTaskFilePath: setCurrentTaskFilePath,
setWorkingBranch: setWorkingBranch,
recordExecutorResponse: recordExecutorResponse,
recordAuditResult: recordAuditResult,
applyAuditApproved: applyAuditApproved,
applyAuditRejected: applyAuditRejected,
setPullRequest: setPullRequest,
recordPullRequestCreated: recordPullRequestCreated,
setError: setError,
clearError: clearError,
failWorkflow: failWorkflow,
completeWorkflow: completeWorkflow,
helpers: deepFreeze({
normalizeWorkflowStateFromAny: normalizeWorkflowStateFromAny,
normalizeSelectedProviderIds: normalizeSelectedProviderIds,
mergeSelectedProviderIds: mergeSelectedProviderIds,
selectedProviderIdsEqual: selectedProviderIdsEqual,
getDefaultRoleProviderMap: getDefaultRoleProviderMap,
getDefaultProviderForRole: getDefaultProviderForRole,
resolveProviderForRole: resolveProviderForRole,
inferRoleFromStage: inferRoleFromStage,
inferDefaultStatusForStage: inferDefaultStatusForStage,
nextStageAfter: nextStageAfter,
normalizeTaskFilePath: normalizeTaskFilePath,
normalizeGitRefLike: normalizeGitRefLike,
normalizeIssueRef: normalizeIssueRef,
normalizePullRequestRef: normalizePullRequestRef,
normalizeErrorRecord: normalizeErrorRecord,
normalizeReviewDecisionInput: normalizeReviewDecisionInput,
normalizeLastParsedPayloadRecord: normalizeLastParsedPayloadRecord,
extractParsedFilePath: extractParsedFilePath,
extractParsedPayloadKind: extractParsedPayloadKind,
buildSuggestedWorkingBranch: buildSuggestedWorkingBranch,
buildWorkflowChangeSummary: buildWorkflowChangeSummary,
workflowStatesEqual: workflowStatesEqual,
createStateStoreError: createStateStoreError,
isStateStoreError: isStateStoreError,
normalizeStateStoreError: normalizeStateStoreError,
buildRepositoryDescriptor: buildRepositoryDescriptor,
buildRepositoryUrls: buildRepositoryUrls,
deriveProviderSelectionsFromSettings: deriveProviderSelectionsFromSettings,
findCachedIssueSummary: findCachedIssueSummary
})
};

try {
logger.debug('State store module registered.', {
protocolVersion: DEFAULT_PROTOCOL_VERSION,
roles: KNOWN_ROLES.slice(),
stages: STAGE_VALUES.slice(),
statuses: STATUS_VALUES.slice()
});
} catch (error) {
}

root.registerValue('state_store', deepFreeze(api), {
overwrite: false,
freeze: false,
clone: false
});
}(typeof globalThis !== 'undefined'
? globalThis
: (typeof self !== 'undefined'
? self
: (typeof window !== 'undefined' ? window : this))));