(function registerMAOEStorage(globalScope) {
  'use strict';
  const root = globalScope.MAOE;

  if (!root || typeof root.registerValue !== 'function') {
    throw new Error('[MAOE] namespace.js must be loaded before storage.js.');
  }

  if (root.has('storage')) {
    return;
  }

  const constants = root.require('constants');
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

  function createFallbackLogger() {
    const consoleObject = typeof console !== 'undefined' ? console : null;
    function emit(level, message, context) {
      if (!consoleObject || typeof consoleObject[level] !== 'function') {
        return;
      }
      if (typeof context === 'undefined') {
        consoleObject[level]('[MAOE/storage] ' + message);
        return;
      }
      consoleObject[level]('[MAOE/storage] ' + message, context);
    }
    return {
      debug: function debug(message, context) { emit('debug', message, context); },
      info: function info(message, context) { emit('info', message, context); },
      warn: function warn(message, context) { emit('warn', message, context); },
      error: function error(message, context) { emit('error', message, context); }
    };
  }

  function createScopedLogger() {
    if (!root.has('logger')) {
      return createFallbackLogger();
    }
    const baseLogger = root.require('logger');
    if (baseLogger && typeof baseLogger.createScope === 'function') {
      try {
        return baseLogger.createScope('storage');
      } catch (error) {}
    }
    if (baseLogger && typeof baseLogger.getScopedLogger === 'function') {
      try {
        return baseLogger.getScopedLogger('storage');
      } catch (error) {}
    }
    if (baseLogger && typeof baseLogger.child === 'function') {
      try {
        return baseLogger.child('storage');
      } catch (error) {}
    }
    if (baseLogger
      && typeof baseLogger.debug === 'function'
      && typeof baseLogger.info === 'function'
      && typeof baseLogger.warn === 'function'
      && typeof baseLogger.error === 'function') {
      return baseLogger;
    }
    return createFallbackLogger();
  }

  const logger = createScopedLogger();
  const STORAGE_AREAS = constants.STORAGE_AREAS;
  const STORAGE_KEYS = constants.STORAGE_KEYS;
  const DEFAULTS = constants.DEFAULTS;
  const ERROR_CODES = constants.ERROR_CODES;
  const LOGGING = constants.LOGGING;
  const UI = constants.UI;
  const WORKFLOW = constants.WORKFLOW;
  const PARSER = constants.PARSER;
  const MANUAL_HUB = constants.MANUAL_HUB;
  const PROVIDERS = constants.PROVIDERS;

  const providerIds = Object.keys(PROVIDERS);
  const workflowStages = Array.isArray(WORKFLOW.STAGE_ORDER) ? WORKFLOW.STAGE_ORDER.slice() : [];
  const workflowStatuses = Object.keys(WORKFLOW.STATUSES).map(function mapStatus(key) { return WORKFLOW.STATUSES[key]; });
  const reviewVerdicts = Array.isArray(PARSER.REVIEW_VERDICTS) ? PARSER.REVIEW_VERDICTS.slice() : [];
  const popupTabs = Array.isArray(UI.POPUP.TABS) ? UI.POPUP.TABS.slice() : [];
  const logLevels = Object.keys(LOGGING.LEVELS).map(function mapLevel(key) { return LOGGING.LEVELS[key]; });
  const manualHubPacketTypes = Object.keys(MANUAL_HUB.PACKET_TYPES).map(function mapPacketType(key) { return MANUAL_HUB.PACKET_TYPES[key]; });
  const supportedClipboardFormats = Array.isArray(PARSER.SUPPORTED_FENCE_LANGUAGES) ? PARSER.SUPPORTED_FENCE_LANGUAGES.slice() : [MANUAL_HUB.CLIPBOARD.PREFERRED_FENCE_LANGUAGE];

  const KNOWN_DEFAULTS_BY_KEY = Object.create(null);
  KNOWN_DEFAULTS_BY_KEY[STORAGE_KEYS.SETTINGS] = DEFAULTS.settings;
  KNOWN_DEFAULTS_BY_KEY[STORAGE_KEYS.GITHUB_AUTH] = DEFAULTS.githubAuth;
  KNOWN_DEFAULTS_BY_KEY[STORAGE_KEYS.REPOSITORY] = DEFAULTS.repository;
  KNOWN_DEFAULTS_BY_KEY[STORAGE_KEYS.WORKFLOW_STATE] = DEFAULTS.workflow;
  KNOWN_DEFAULTS_BY_KEY[STORAGE_KEYS.UI_STATE] = DEFAULTS.ui;
  KNOWN_DEFAULTS_BY_KEY[STORAGE_KEYS.MANUAL_BRIDGE_DRAFT] = DEFAULTS.manualHub;
  KNOWN_DEFAULTS_BY_KEY[STORAGE_KEYS.LAST_PARSED_PAYLOAD] = null;
  KNOWN_DEFAULTS_BY_KEY[STORAGE_KEYS.LAST_AUDIT_RESULT] = null;
  KNOWN_DEFAULTS_BY_KEY[STORAGE_KEYS.LAST_ERROR] = null;
  KNOWN_DEFAULTS_BY_KEY[STORAGE_KEYS.EVENT_LOG] = [];

  const KNOWN_DEFAULTS_BY_AREA = Object.create(null);
  KNOWN_DEFAULTS_BY_AREA[STORAGE_AREAS.LOCAL] = Object.freeze(Object.keys(KNOWN_DEFAULTS_BY_KEY).reduce(function reduceKnownDefaults(accumulator, key) {
    accumulator[key] = cloneValue(KNOWN_DEFAULTS_BY_KEY[key]);
    return accumulator;
  }, Object.create(null)));

  KNOWN_DEFAULTS_BY_AREA[STORAGE_AREAS.SESSION] = Object.freeze({
    ui_state: cloneValue(DEFAULTS.ui),
    manual_bridge_draft: cloneValue(DEFAULTS.manualHub)
  });

  const memoryBuckets = Object.create(null);
  memoryBuckets[STORAGE_AREAS.LOCAL] = Object.create(null);
  memoryBuckets[STORAGE_AREAS.SESSION] = Object.create(null);

  const operationQueues = Object.create(null);
  operationQueues[STORAGE_AREAS.LOCAL] = Promise.resolve();
  operationQueues[STORAGE_AREAS.SESSION] = Promise.resolve();

  function normalizeString(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function normalizeOptionalString(value, fallbackValue) {
    const normalized = normalizeString(value);
    return normalized || (typeof fallbackValue === 'string' ? fallbackValue : '');
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
    return typeof fallbackValue === 'boolean' ? fallbackValue : false;
  }

  function normalizeStringArray(value) {
    if (!Array.isArray(value)) {
      return [];
    }
    const result = [];
    const seen = new Set();
    for (const entry of value) {
      const normalizedEntry = normalizeString(entry);
      if (!normalizedEntry || seen.has(normalizedEntry)) {
        continue;
      }
      seen.add(normalizedEntry);
      result.push(normalizedEntry);
    }
    return result;
  }

  function clampString(value, maxLength) {
    const normalized = typeof value === 'string' ? value : String(value == null ? '' : value);
    if (!Number.isFinite(maxLength) || maxLength <= 0 || normalized.length <= maxLength) {
      return normalized;
    }
    return normalized.slice(0, maxLength);
  }

  function oneOf(value, allowedValues, fallbackValue) {
    const normalizedValue = typeof value === 'string' ? value.trim() : value;
    return Array.isArray(allowedValues) && allowedValues.indexOf(normalizedValue) >= 0
      ? normalizedValue
      : fallbackValue;
  }

  function ensureObject(value) {
    return isPlainObject(value) ? value : Object.create(null);
  }

  function deepMerge(baseValue, patchValue) {
    if (!isPlainObject(baseValue)) {
      return cloneValue(typeof patchValue === 'undefined' ? baseValue : patchValue);
    }
    if (!isPlainObject(patchValue)) {
      return cloneValue(typeof patchValue === 'undefined' ? baseValue : patchValue);
    }
    const result = cloneValue(baseValue);
    for (const key of Object.keys(patchValue)) {
      const baseEntry = hasOwn(result, key) ? result[key] : undefined;
      const patchEntry = patchValue[key];
      if (isPlainObject(baseEntry) && isPlainObject(patchEntry)) {
        result[key] = deepMerge(baseEntry, patchEntry);
        continue;
      }
      result[key] = cloneValue(patchEntry);
    }
    return result;
  }

  function createStorageError(code, message, details) {
    const error = new Error(message || 'Storage operation failed.');
    error.name = 'MAOEStorageError';
    error.code = code || ERROR_CODES.UNKNOWN_ERROR;
    error.details = isPlainObject(details) ? cloneValue(details) : Object.create(null);
    return error;
  }

  function normalizeArea(areaName) {
    const normalized = normalizeString(areaName).toLowerCase() || STORAGE_AREAS.LOCAL;
    if (normalized !== STORAGE_AREAS.LOCAL && normalized !== STORAGE_AREAS.SESSION) {
      throw createStorageError(
        ERROR_CODES.INVALID_ARGUMENT,
        'Unsupported storage area: ' + String(areaName),
        {
          area: areaName,
          supportedAreas: [STORAGE_AREAS.LOCAL, STORAGE_AREAS.SESSION]
        }
      );
    }
    return normalized;
  }

  function normalizeKey(key) {
    const normalized = normalizeString(key);
    if (!normalized) {
      throw createStorageError(
        ERROR_CODES.INVALID_ARGUMENT,
        'Storage key must be a non-empty string.',
        { key: key }
      );
    }
    return normalized;
  }

  function listKnownKeys(areaName) {
    const area = normalizeArea(areaName);
    const defaults = KNOWN_DEFAULTS_BY_AREA[area] || Object.create(null);
    return Object.keys(defaults);
  }

  function getSchemaDefault(key) {
    const normalizedKey = normalizeKey(key);
    if (!hasOwn(KNOWN_DEFAULTS_BY_KEY, normalizedKey)) {
      return undefined;
    }
    return cloneValue(KNOWN_DEFAULTS_BY_KEY[normalizedKey]);
  }

  function buildDefaultRequest(keys, areaName) {
    const defaults = KNOWN_DEFAULTS_BY_AREA[normalizeArea(areaName)] || Object.create(null);
    const request = Object.create(null);
    for (const key of keys) {
      request[key] = hasOwn(defaults, key) ? cloneValue(defaults[key]) : undefined;
    }
    return request;
  }

  function hasNativeStorageArea(areaName) {
    const area = normalizeArea(areaName);
    return typeof chrome !== 'undefined'
      && !!chrome.storage
      && !!chrome.storage[area]
      && typeof chrome.storage[area].get === 'function'
      && typeof chrome.storage[area].set === 'function'
      && typeof chrome.storage[area].remove === 'function'
      && typeof chrome.storage[area].clear === 'function';
  }

  function hasAnyStorageRuntime() {
    return hasNativeStorageArea(STORAGE_AREAS.LOCAL) || hasNativeStorageArea(STORAGE_AREAS.SESSION);
  }

  function getBucket(areaName) {
    return memoryBuckets[normalizeArea(areaName)];
  }

  function memoryGet(areaName, request) {
    const bucket = getBucket(areaName);
    const result = Object.create(null);
    if (request === null) {
      for (const key of Object.keys(bucket)) {
        result[key] = cloneValue(bucket[key]);
      }
      return result;
    }
    if (typeof request === 'string') {
      if (hasOwn(bucket, request)) {
        result[request] = cloneValue(bucket[request]);
      }
      return result;
    }
    if (Array.isArray(request)) {
      for (const key of request) {
        if (typeof key === 'string' && hasOwn(bucket, key)) {
          result[key] = cloneValue(bucket[key]);
        }
      }
      return result;
    }
    if (isPlainObject(request)) {
      for (const key of Object.keys(request)) {
        result[key] = hasOwn(bucket, key) ? cloneValue(bucket[key]) : cloneValue(request[key]);
      }
      return result;
    }
    return result;
  }

  function memorySet(areaName, items) {
    const bucket = getBucket(areaName);
    for (const key of Object.keys(items)) {
      bucket[key] = cloneValue(items[key]);
    }
  }

  function memoryRemove(areaName, keys) {
    const bucket = getBucket(areaName);
    const normalizedKeys = Array.isArray(keys) ? keys : [keys];
    for (const key of normalizedKeys) {
      if (typeof key === 'string') {
        delete bucket[key];
      }
    }
  }

  function memoryClear(areaName) {
    const bucket = getBucket(areaName);
    for (const key of Object.keys(bucket)) {
      delete bucket[key];
    }
  }

  function invokeChromeStorage(areaName, method, payload) {
    return new Promise(function executor(resolve, reject) {
      try {
        const area = chrome.storage[areaName];
        if (!area || typeof area[method] !== 'function') {
          reject(createStorageError(
            ERROR_CODES.STORAGE_UNAVAILABLE,
            'Storage area is not available: ' + areaName,
            { area: areaName, method: method }
          ));
          return;
        }
        const callback = function callback(result) {
          const runtimeError = typeof chrome !== 'undefined'
            && chrome.runtime
            && chrome.runtime.lastError
            ? chrome.runtime.lastError
            : null;
          if (runtimeError) {
            reject(createStorageError(
              method === 'set' ? ERROR_CODES.STORAGE_WRITE_FAILED : ERROR_CODES.STORAGE_UNAVAILABLE,
              runtimeError.message || 'Chrome storage runtime error.',
              {
                area: areaName,
                method: method,
                runtimeError: runtimeError.message || String(runtimeError)
              }
            ));
            return;
          }
          resolve(result);
        };
        if (typeof payload === 'undefined') {
          area[method](callback);
          return;
        }
        area[method](payload, callback);
      } catch (error) {
        reject(createStorageError(
          method === 'set' ? ERROR_CODES.STORAGE_WRITE_FAILED : ERROR_CODES.STORAGE_UNAVAILABLE,
          error && error.message ? error.message : 'Chrome storage invocation failed.',
          {
            area: areaName,
            method: method,
            cause: error && error.message ? error.message : String(error)
          }
        ));
      }
    });
  }

  function enqueue(areaName, operation) {
    const area = normalizeArea(areaName);
    const previous = operationQueues[area] || Promise.resolve();
    const current = previous.catch(function ignorePreviousError() {
      return undefined;
    }).then(operation);
    operationQueues[area] = current.catch(function swallowQueueError() {
      return undefined;
    });
    return current;
  }

  async function performGet(areaName, request) {
    const area = normalizeArea(areaName);
    if (hasNativeStorageArea(area)) {
      const result = await invokeChromeStorage(area, 'get', request);
      return isPlainObject(result) ? cloneValue(result) : Object.create(null);
    }
    return memoryGet(area, request);
  }

  async function performSet(areaName, items) {
    const area = normalizeArea(areaName);
    if (hasNativeStorageArea(area)) {
      await invokeChromeStorage(area, 'set', items);
      return;
    }
    memorySet(area, items);
  }

  async function performRemove(areaName, keys) {
    const area = normalizeArea(areaName);
    if (hasNativeStorageArea(area)) {
      await invokeChromeStorage(area, 'remove', keys);
      return;
    }
    memoryRemove(area, keys);
  }

  async function performClear(areaName) {
    const area = normalizeArea(areaName);
    if (hasNativeStorageArea(area)) {
      await invokeChromeStorage(area, 'clear');
      return;
    }
    memoryClear(area);
  }

  async function rawGet(areaName, request) {
    const area = normalizeArea(areaName);
    return enqueue(area, async function executeGet() {
      return performGet(area, request);
    });
  }

  async function rawSet(areaName, items) {
    const area = normalizeArea(areaName);
    return enqueue(area, async function executeSet() {
      await performSet(area, items);
    });
  }

  async function rawRemove(areaName, keys) {
    const area = normalizeArea(areaName);
    return enqueue(area, async function executeRemove() {
      await performRemove(area, keys);
    });
  }

  async function rawClear(areaName) {
    const area = normalizeArea(areaName);
    return enqueue(area, async function executeClear() {
      await performClear(area);
    });
  }

  function sanitizeContextObject(value) {
    if (!isPlainObject(value)) {
      return Object.create(null);
    }
    const result = Object.create(null);
    for (const key of Object.keys(value)) {
      const entry = value[key];
      if (entry === null || typeof entry === 'number' || typeof entry === 'boolean') {
        result[key] = entry;
        continue;
      }
      if (typeof entry === 'string') {
        result[key] = clampString(entry, LOGGING.MAX_STRING_LENGTH);
        continue;
      }
      if (Array.isArray(entry)) {
        result[key] = entry.slice(0, 50).map(function mapEntry(item) {
          if (item === null || typeof item === 'number' || typeof item === 'boolean') {
            return item;
          }
          return clampString(String(item), 512);
        });
        continue;
      }
      if (isPlainObject(entry)) {
        result[key] = sanitizeContextObject(entry);
      }
    }
    return result;
  }

  function normalizeGitHubAuth(value) {
    const source = deepMerge(DEFAULTS.githubAuth, ensureObject(value));
    return {
      personalAccessToken: normalizeString(source.personalAccessToken),
      tokenType: normalizeOptionalString(source.tokenType, DEFAULTS.githubAuth.tokenType || 'PAT'),
      lastValidatedAt: normalizeString(source.lastValidatedAt),
      username: normalizeString(source.username)
    };
  }

  function normalizeRepository(value) {
    const source = deepMerge(DEFAULTS.repository, ensureObject(value));
    const defaultBranch = normalizeString(source.defaultBranch);
    const baseBranch = normalizeString(source.baseBranch) || defaultBranch || constants.REPOSITORY.DEFAULT_BASE_BRANCH;
    const workingBranchPrefix = normalizeString(source.workingBranchPrefix) || constants.REPOSITORY.WORKING_BRANCH_PREFIX;
    return {
      owner: normalizeString(source.owner),
      repo: normalizeString(source.repo),
      defaultBranch: defaultBranch,
      baseBranch: baseBranch,
      workingBranchPrefix: workingBranchPrefix
    };
  }

  function normalizeAgentProviderId(value, fallbackValue) {
    const candidate = normalizeString(value).toLowerCase();
    if (providerIds.indexOf(candidate) >= 0) {
      return candidate;
    }
    return normalizeString(fallbackValue).toLowerCase();
  }

  function normalizeSettings(value) {
    const source = deepMerge(DEFAULTS.settings, ensureObject(value));
    const repositoryDefaults = DEFAULTS.settings.repository || Object.create(null);
    const agentsDefaults = DEFAULTS.settings.agents || Object.create(null);
    const githubDefaults = DEFAULTS.settings.github || Object.create(null);
    const repository = ensureObject(source.repository);
    const agents = ensureObject(source.agents);
    const github = ensureObject(source.github);
    return {
      github: {
        apiBaseUrl: normalizeOptionalString(github.apiBaseUrl, githubDefaults.apiBaseUrl || constants.GITHUB.API_BASE_URL),
        requestTimeoutMs: Math.max(1000, Number.isFinite(Number(github.requestTimeoutMs))
          ? Math.trunc(Number(github.requestTimeoutMs))
          : Number(githubDefaults.requestTimeoutMs || constants.GITHUB.REQUEST_TIMEOUT_MS))
      },
      repository: {
        owner: normalizeString(repository.owner),
        repo: normalizeString(repository.repo),
        baseBranch: normalizeOptionalString(repository.baseBranch, repositoryDefaults.baseBranch || constants.REPOSITORY.DEFAULT_BASE_BRANCH),
        issueState: normalizeOptionalString(repository.issueState, repositoryDefaults.issueState || constants.REPOSITORY.DEFAULT_ISSUE_STATE),
        issueSort: normalizeOptionalString(repository.issueSort, repositoryDefaults.issueSort || constants.REPOSITORY.DEFAULT_ISSUE_SORT),
        issueDirection: normalizeOptionalString(repository.issueDirection, repositoryDefaults.issueDirection || constants.REPOSITORY.DEFAULT_ISSUE_DIRECTION),
        workingBranchPrefix: normalizeOptionalString(repository.workingBranchPrefix, repositoryDefaults.workingBranchPrefix || constants.REPOSITORY.WORKING_BRANCH_PREFIX)
      },
      agents: {
        designerProviderId: normalizeAgentProviderId(
          agents.designerProviderId,
          agentsDefaults.designerProviderId || constants.DEFAULT_PROVIDER_BY_ROLE[WORKFLOW.ROLES.DESIGNER]
        ),
        executorProviderId: normalizeAgentProviderId(
          agents.executorProviderId,
          agentsDefaults.executorProviderId || constants.DEFAULT_PROVIDER_BY_ROLE[WORKFLOW.ROLES.EXECUTOR]
        ),
        auditorProviderId: normalizeAgentProviderId(
          agents.auditorProviderId,
          agentsDefaults.auditorProviderId || constants.DEFAULT_PROVIDER_BY_ROLE[WORKFLOW.ROLES.AUDITOR]
        )
      }
    };
  }

  function normalizeWorkflowState(value) {
    const source = deepMerge(DEFAULTS.workflow, ensureObject(value));
    const selectedProviderIds = ensureObject(source.selectedProviderIds);
    return {
      stage: oneOf(source.stage, workflowStages, DEFAULTS.workflow.stage),
      status: oneOf(source.status, workflowStatuses, DEFAULTS.workflow.status),
      currentIssueNumber: normalizeIntegerOrNull(source.currentIssueNumber),
      currentIssueTitle: clampString(normalizeString(source.currentIssueTitle), 512),
      currentIssueUrl: clampString(normalizeString(source.currentIssueUrl), 2048),
      currentTaskFilePath: clampString(normalizeString(source.currentTaskFilePath), 2048),
      activeProviderId: oneOf(normalizeString(source.activeProviderId).toLowerCase(), providerIds.concat(['']), ''),
      selectedProviderIds: {
        designer: normalizeAgentProviderId(
          selectedProviderIds.designer,
          DEFAULTS.workflow.selectedProviderIds.designer
        ),
        executor: normalizeAgentProviderId(
          selectedProviderIds.executor,
          DEFAULTS.workflow.selectedProviderIds.executor
        ),
        auditor: normalizeAgentProviderId(
          selectedProviderIds.auditor,
          DEFAULTS.workflow.selectedProviderIds.auditor
        )
      },
      workingBranch: clampString(normalizeString(source.workingBranch), 256),
      pullRequestUrl: clampString(normalizeString(source.pullRequestUrl), 2048),
      pullRequestNumber: normalizeIntegerOrNull(source.pullRequestNumber),
      latestExecutorResponse: clampString(
        typeof source.latestExecutorResponse === 'string' ? source.latestExecutorResponse : '',
        PARSER.LIMITS.MAX_PAYLOAD_CHARS
      ),
      latestAuditVerdict: oneOf(source.latestAuditVerdict, reviewVerdicts.concat(['']), ''),
      latestAuditSummary: clampString(
        typeof source.latestAuditSummary === 'string' ? source.latestAuditSummary : '',
        12000
      ),
      lastTransitionAt: normalizeString(source.lastTransitionAt),
      lastHumanActionAt: normalizeString(source.lastHumanActionAt),
      lastErrorCode: clampString(normalizeString(source.lastErrorCode), 128),
      lastErrorMessage: clampString(normalizeString(source.lastErrorMessage), 4000)
    };
  }

  function normalizeUiState(value) {
    const source = deepMerge(DEFAULTS.ui, ensureObject(value));
    return {
      activeTab: oneOf(source.activeTab, popupTabs, DEFAULTS.ui.activeTab),
      issueFilter: clampString(normalizeString(source.issueFilter), 512),
      expandedSections: normalizeStringArray(source.expandedSections),
      showDebugLog: normalizeBoolean(source.showDebugLog, DEFAULTS.ui.showDebugLog)
    };
  }

  function normalizeManualHubState(value) {
    const source = deepMerge(DEFAULTS.manualHub, ensureObject(value));
    return {
      lastPacketType: oneOf(source.lastPacketType, manualHubPacketTypes.concat(['']), ''),
      lastPacketText: clampString(
        typeof source.lastPacketText === 'string' ? source.lastPacketText : '',
        MANUAL_HUB.CLIPBOARD.MAX_CHARACTERS
      ),
      lastResponseText: clampString(
        typeof source.lastResponseText === 'string' ? source.lastResponseText : '',
        PARSER.LIMITS.MAX_PAYLOAD_CHARS
      ),
      clipboardFormat: oneOf(
        normalizeString(source.clipboardFormat).toLowerCase(),
        supportedClipboardFormats,
        MANUAL_HUB.CLIPBOARD.PREFERRED_FENCE_LANGUAGE
      )
    };
  }

  function normalizeLastParsedPayload(value) {
    if (value === null || typeof value === 'undefined') {
      return null;
    }
    if (!isPlainObject(value)) {
      return {
        parsedAt: new Date().toISOString(),
        source: '',
        kind: 'unknown',
        rawText: clampString(String(value), PARSER.LIMITS.MAX_PAYLOAD_CHARS)
      };
    }
    return {
      parsedAt: normalizeString(value.parsedAt) || new Date().toISOString(),
      source: clampString(normalizeString(value.source), 128),
      kind: clampString(normalizeString(value.kind), 128),
      rawText: clampString(typeof value.rawText === 'string' ? value.rawText : '', PARSER.LIMITS.MAX_PAYLOAD_CHARS),
      parsed: cloneValue(hasOwn(value, 'parsed') ? value.parsed : null),
      errors: Array.isArray(value.errors)
        ? value.errors.slice(0, 25).map(function mapError(entry) { return clampString(String(entry), 1024); })
        : []
    };
  }

  function normalizeLastAuditResult(value) {
    if (value === null || typeof value === 'undefined') {
      return null;
    }
    if (!isPlainObject(value)) {
      return {
        verdict: '',
        summary: clampString(String(value), 4000),
        findings: [],
        reviewedAt: new Date().toISOString()
      };
    }
    return {
      verdict: oneOf(value.verdict, reviewVerdicts.concat(['']), ''),
      summary: clampString(typeof value.summary === 'string' ? value.summary : '', 4000),
      findings: Array.isArray(value.findings)
        ? value.findings.slice(0, PARSER.LIMITS.MAX_REVIEW_FINDINGS).map(function mapFinding(entry) {
            if (typeof entry === 'string') {
              return clampString(entry, 1024);
            }
            if (isPlainObject(entry)) {
              return {
                severity: clampString(normalizeString(entry.severity), 64),
                message: clampString(typeof entry.message === 'string' ? entry.message : '', 1024),
                target: clampString(typeof entry.target === 'string' ? entry.target : '', 512)
              };
            }
            return clampString(String(entry), 1024);
          })
        : [],
      reviewedAt: normalizeString(value.reviewedAt) || new Date().toISOString()
    };
  }

  function normalizeLastError(value) {
    if (value === null || typeof value === 'undefined') {
      return null;
    }
    if (!isPlainObject(value)) {
      return {
        code: ERROR_CODES.UNKNOWN_ERROR,
        message: clampString(String(value), 4000),
        at: new Date().toISOString(),
        details: Object.create(null)
      };
    }
    return {
      code: clampString(normalizeString(value.code) || ERROR_CODES.UNKNOWN_ERROR, 128),
      message: clampString(typeof value.message === 'string' ? value.message : '', 4000),
      at: normalizeString(value.at) || new Date().toISOString(),
      details: sanitizeContextObject(value.details)
    };
  }

  function generateLogEntryId() {
    const randomPart = Math.random().toString(36).slice(2, 10);
    return 'log_' + Date.now().toString(36) + '_' + randomPart;
  }

  function normalizeEventLogEntry(value) {
    if (typeof value === 'string') {
      return {
        id: generateLogEntryId(),
        at: new Date().toISOString(),
        level: LOGGING.DEFAULT_LEVEL,
        message: clampString(value, LOGGING.MAX_STRING_LENGTH),
        code: '',
        context: Object.create(null)
      };
    }
    const source = ensureObject(value);
    return {
      id: normalizeString(source.id) || generateLogEntryId(),
      at: normalizeString(source.at) || new Date().toISOString(),
      level: oneOf(source.level, logLevels, LOGGING.DEFAULT_LEVEL),
      message: clampString(typeof source.message === 'string' ? source.message : '', LOGGING.MAX_STRING_LENGTH),
      code: clampString(normalizeString(source.code), 128),
      context: sanitizeContextObject(source.context)
    };
  }

  function normalizeEventLog(value) {
    if (!Array.isArray(value)) {
      return [];
    }
    const normalized = value.map(normalizeEventLogEntry);
    if (normalized.length <= LOGGING.MAX_ENTRIES) {
      return normalized;
    }
    return normalized.slice(normalized.length - LOGGING.MAX_ENTRIES);
  }

  function normalizeStoredValue(key, value) {
    const normalizedKey = normalizeKey(key);
    switch (normalizedKey) {
      case STORAGE_KEYS.SETTINGS:
        return normalizeSettings(value);
      case STORAGE_KEYS.GITHUB_AUTH:
        return normalizeGitHubAuth(value);
      case STORAGE_KEYS.REPOSITORY:
        return normalizeRepository(value);
      case STORAGE_KEYS.WORKFLOW_STATE:
        return normalizeWorkflowState(value);
      case STORAGE_KEYS.UI_STATE:
        return normalizeUiState(value);
      case STORAGE_KEYS.MANUAL_BRIDGE_DRAFT:
        return normalizeManualHubState(value);
      case STORAGE_KEYS.LAST_PARSED_PAYLOAD:
        return normalizeLastParsedPayload(value);
      case STORAGE_KEYS.LAST_AUDIT_RESULT:
        return normalizeLastAuditResult(value);
      case STORAGE_KEYS.LAST_ERROR:
        return normalizeLastError(value);
      case STORAGE_KEYS.EVENT_LOG:
        return normalizeEventLog(value);
      default:
        return cloneValue(value);
    }
  }

  function normalizeKeyList(keys) {
    if (typeof keys === 'string') {
      return [normalizeKey(keys)];
    }
    if (!Array.isArray(keys)) {
      throw createStorageError(ERROR_CODES.INVALID_ARGUMENT, 'Storage keys must be a string or an array of strings.', { keys: keys });
    }
    const result = [];
    const seen = new Set();
    for (const key of keys) {
      const normalizedKey = normalizeKey(key);
      if (seen.has(normalizedKey)) { continue; }
      seen.add(normalizedKey);
      result.push(normalizedKey);
    }
    return result;
  }

  async function initializeDefaults(options) {
    const config = ensureObject(options);
    const area = normalizeArea(config.area || STORAGE_AREAS.LOCAL);
    const knownKeys = listKnownKeys(area);
    if (knownKeys.length === 0) {
      return Object.create(null);
    }
    const existing = await rawGet(area, knownKeys);
    const toWrite = Object.create(null);
    for (const key of knownKeys) {
      if (!hasOwn(existing, key) || config.force === true) {
        toWrite[key] = normalizeStoredValue(key, getSchemaDefault(key));
      }
    }
    if (Object.keys(toWrite).length > 0) {
      await rawSet(area, toWrite);
      logger.info('Initialized storage defaults.', { area: area, keys: Object.keys(toWrite) });
    }
    return readMany(knownKeys, { area: area, useSchemaDefault: true });
  }

  async function read(key, options) {
    const normalizedKey = normalizeKey(key);
    const config = ensureObject(options);
    const area = normalizeArea(config.area || STORAGE_AREAS.LOCAL);
    const useSchemaDefault = config.useSchemaDefault !== false;
    let request = normalizedKey;
    if (useSchemaDefault && typeof getSchemaDefault(normalizedKey) !== 'undefined') {
      request = Object.create(null);
      request[normalizedKey] = getSchemaDefault(normalizedKey);
    }
    const result = await rawGet(area, request);
    if (hasOwn(result, normalizedKey)) {
      return normalizeStoredValue(normalizedKey, result[normalizedKey]);
    }
    if (useSchemaDefault && typeof getSchemaDefault(normalizedKey) !== 'undefined') {
      return normalizeStoredValue(normalizedKey, getSchemaDefault(normalizedKey));
    }
    if (hasOwn(config, 'defaultValue')) {
      return cloneValue(config.defaultValue);
    }
    return undefined;
  }

  async function readMany(keys, options) {
    const normalizedKeys = normalizeKeyList(keys);
    const config = ensureObject(options);
    const area = normalizeArea(config.area || STORAGE_AREAS.LOCAL);
    const useSchemaDefault = config.useSchemaDefault !== false;
    const request = useSchemaDefault ? buildDefaultRequest(normalizedKeys, area) : normalizedKeys;
    const result = await rawGet(area, Object.keys(request).length > 0 ? request : normalizedKeys);
    const output = Object.create(null);
    for (const key of normalizedKeys) {
      if (hasOwn(result, key)) {
        output[key] = normalizeStoredValue(key, result[key]);
        continue;
      }
      if (useSchemaDefault && typeof getSchemaDefault(key) !== 'undefined') {
        output[key] = normalizeStoredValue(key, getSchemaDefault(key));
      }
    }
    return output;
  }

  async function readAll(options) {
    const config = ensureObject(options);
    const area = normalizeArea(config.area || STORAGE_AREAS.LOCAL);
    const rawItems = await rawGet(area, null);
    const output = Object.create(null);
    for (const key of Object.keys(rawItems)) {
      output[key] = normalizeStoredValue(key, rawItems[key]);
    }
    if (config.includeSchemaDefaults === true) {
      const defaults = KNOWN_DEFAULTS_BY_AREA[area] || Object.create(null);
      for (const key of Object.keys(defaults)) {
        if (!hasOwn(output, key)) {
          output[key] = normalizeStoredValue(key, defaults[key]);
        }
      }
    }
    return output;
  }

  async function write(values, options) {
    if (!isPlainObject(values)) {
      throw createStorageError(ERROR_CODES.INVALID_ARGUMENT, 'write() requires a plain object map.', { valuesType: Object.prototype.toString.call(values) });
    }
    const config = ensureObject(options);
    const area = normalizeArea(config.area || STORAGE_AREAS.LOCAL);
    const normalizedItems = Object.create(null);
    for (const key of Object.keys(values)) {
      normalizedItems[normalizeKey(key)] = normalizeStoredValue(key, values[key]);
    }
    await rawSet(area, normalizedItems);
    return cloneValue(normalizedItems);
  }

  async function remove(keys, options) {
    const normalizedKeys = normalizeKeyList(keys);
    const config = ensureObject(options);
    const area = normalizeArea(config.area || STORAGE_AREAS.LOCAL);
    await rawRemove(area, normalizedKeys);
    return true;
  }

  async function clear(options) {
    const config = ensureObject(options);
    const area = normalizeArea(config.area || STORAGE_AREAS.LOCAL);
    await rawClear(area);
    if (config.reinitializeDefaults === true) {
      await initializeDefaults({ area: area });
    }
    return true;
  }

  async function merge(key, patch, options) {
    const normalizedKey = normalizeKey(key);
    if (!isPlainObject(patch)) {
      throw createStorageError(ERROR_CODES.INVALID_ARGUMENT, 'merge() requires a plain object patch.', { key: normalizedKey, patchType: Object.prototype.toString.call(patch) });
    }
    const config = ensureObject(options);
    const area = normalizeArea(config.area || STORAGE_AREAS.LOCAL);
    return enqueue(area, async function executeMerge() {
      const request = config.useSchemaDefault !== false ? buildDefaultRequest([normalizedKey], area) : [normalizedKey];
      const currentResult = await performGet(area, request);
      const currentValue = hasOwn(currentResult, normalizedKey) ? currentResult[normalizedKey] : getSchemaDefault(normalizedKey);
      const mergedValue = normalizeStoredValue(normalizedKey, deepMerge(ensureObject(currentValue), patch));
      await performSet(area, Object.create(null, {
        [normalizedKey]: { value: mergedValue, enumerable: true, configurable: true, writable: true }
      }));
      return cloneValue(mergedValue);
    });
  }

  async function getSettings(options) { return read(STORAGE_KEYS.SETTINGS, options); }
  async function saveSettings(value, options) { return write(Object.create(null, { [STORAGE_KEYS.SETTINGS]: { value: value, enumerable: true, configurable: true, writable: true } }), options).then(function mapResult(result) { return result[STORAGE_KEYS.SETTINGS]; }); }
  async function patchSettings(patch, options) { return merge(STORAGE_KEYS.SETTINGS, patch, options); }

  async function getGitHubAuth(options) { return read(STORAGE_KEYS.GITHUB_AUTH, options); }
  async function saveGitHubAuth(value, options) { return write(Object.create(null, { [STORAGE_KEYS.GITHUB_AUTH]: { value: value, enumerable: true, configurable: true, writable: true } }), options).then(function mapResult(result) { return result[STORAGE_KEYS.GITHUB_AUTH]; }); }
  async function clearGitHubAuth(options) { const auth = normalizeGitHubAuth(Object.create(null)); await write(Object.create(null, { [STORAGE_KEYS.GITHUB_AUTH]: { value: auth, enumerable: true, configurable: true, writable: true } }), options); return auth; }

  async function getRepository(options) { return read(STORAGE_KEYS.REPOSITORY, options); }
  async function saveRepository(value, options) { return write(Object.create(null, { [STORAGE_KEYS.REPOSITORY]: { value: value, enumerable: true, configurable: true, writable: true } }), options).then(function mapResult(result) { return result[STORAGE_KEYS.REPOSITORY]; }); }
  async function patchRepository(patch, options) { return merge(STORAGE_KEYS.REPOSITORY, patch, options); }

  async function getWorkflowState(options) { return read(STORAGE_KEYS.WORKFLOW_STATE, options); }
  async function saveWorkflowState(value, options) { return write(Object.create(null, { [STORAGE_KEYS.WORKFLOW_STATE]: { value: value, enumerable: true, configurable: true, writable: true } }), options).then(function mapResult(result) { return result[STORAGE_KEYS.WORKFLOW_STATE]; }); }
  async function patchWorkflowState(patch, options) { return merge(STORAGE_KEYS.WORKFLOW_STATE, patch, options); }
  async function resetWorkflowState(options) { const nextState = normalizeWorkflowState(DEFAULTS.workflow); await write(Object.create(null, { [STORAGE_KEYS.WORKFLOW_STATE]: { value: nextState, enumerable: true, configurable: true, writable: true } }), options); return nextState; }

  async function getUiState(options) { return read(STORAGE_KEYS.UI_STATE, options); }
  async function saveUiState(value, options) { return write(Object.create(null, { [STORAGE_KEYS.UI_STATE]: { value: value, enumerable: true, configurable: true, writable: true } }), options).then(function mapResult(result) { return result[STORAGE_KEYS.UI_STATE]; }); }
  async function patchUiState(patch, options) { return merge(STORAGE_KEYS.UI_STATE, patch, options); }

  async function getManualHubState(options) { return read(STORAGE_KEYS.MANUAL_BRIDGE_DRAFT, options); }
  async function saveManualHubState(value, options) { return write(Object.create(null, { [STORAGE_KEYS.MANUAL_BRIDGE_DRAFT]: { value: value, enumerable: true, configurable: true, writable: true } }), options).then(function mapResult(result) { return result[STORAGE_KEYS.MANUAL_BRIDGE_DRAFT]; }); }
  async function patchManualHubState(patch, options) { return merge(STORAGE_KEYS.MANUAL_BRIDGE_DRAFT, patch, options); }

  async function getLastParsedPayload(options) { return read(STORAGE_KEYS.LAST_PARSED_PAYLOAD, options); }
  async function setLastParsedPayload(value, options) { return write(Object.create(null, { [STORAGE_KEYS.LAST_PARSED_PAYLOAD]: { value: value, enumerable: true, configurable: true, writable: true } }), options).then(function mapResult(result) { return result[STORAGE_KEYS.LAST_PARSED_PAYLOAD]; }); }
  async function clearLastParsedPayload(options) { await remove(STORAGE_KEYS.LAST_PARSED_PAYLOAD, options); return null; }

  async function getLastAuditResult(options) { return read(STORAGE_KEYS.LAST_AUDIT_RESULT, options); }
  async function setLastAuditResult(value, options) { return write(Object.create(null, { [STORAGE_KEYS.LAST_AUDIT_RESULT]: { value: value, enumerable: true, configurable: true, writable: true } }), options).then(function mapResult(result) { return result[STORAGE_KEYS.LAST_AUDIT_RESULT]; }); }
  async function clearLastAuditResult(options) { await remove(STORAGE_KEYS.LAST_AUDIT_RESULT, options); return null; }

  async function getLastError(options) { return read(STORAGE_KEYS.LAST_ERROR, options); }
  async function setLastError(value, options) { return write(Object.create(null, { [STORAGE_KEYS.LAST_ERROR]: { value: value, enumerable: true, configurable: true, writable: true } }), options).then(function mapResult(result) { return result[STORAGE_KEYS.LAST_ERROR]; }); }
  async function clearLastError(options) { await remove(STORAGE_KEYS.LAST_ERROR, options); return null; }

  async function getEventLog(options) { return read(STORAGE_KEYS.EVENT_LOG, options); }
  async function replaceEventLog(entries, options) { return write(Object.create(null, { [STORAGE_KEYS.EVENT_LOG]: { value: entries, enumerable: true, configurable: true, writable: true } }), options).then(function mapResult(result) { return result[STORAGE_KEYS.EVENT_LOG]; }); }
  async function appendEventLog(entry, options) {
    const config = ensureObject(options);
    const area = normalizeArea(config.area || STORAGE_AREAS.LOCAL);
    return enqueue(area, async function executeAppendEventLog() {
      const request = buildDefaultRequest([STORAGE_KEYS.EVENT_LOG], area);
      const currentResult = await performGet(area, request);
      const currentEntries = hasOwn(currentResult, STORAGE_KEYS.EVENT_LOG) ? normalizeEventLog(currentResult[STORAGE_KEYS.EVENT_LOG]) : [];
      const nextEntries = currentEntries.concat([normalizeEventLogEntry(entry)]);
      const normalizedEntries = normalizeEventLog(nextEntries);
      await performSet(area, Object.create(null, {
        [STORAGE_KEYS.EVENT_LOG]: { value: normalizedEntries, enumerable: true, configurable: true, writable: true }
      }));
      return cloneValue(normalizedEntries);
    });
  }
  async function clearEventLog(options) { await write(Object.create(null, { [STORAGE_KEYS.EVENT_LOG]: { value: [], enumerable: true, configurable: true, writable: true } }), options); return []; }

  async function getBootstrapState(options) {
    const config = ensureObject(options);
    const area = normalizeArea(config.area || STORAGE_AREAS.LOCAL);
    const localValues = await readMany([
      STORAGE_KEYS.SETTINGS, STORAGE_KEYS.GITHUB_AUTH, STORAGE_KEYS.REPOSITORY,
      STORAGE_KEYS.WORKFLOW_STATE, STORAGE_KEYS.UI_STATE, STORAGE_KEYS.MANUAL_BRIDGE_DRAFT,
      STORAGE_KEYS.LAST_PARSED_PAYLOAD, STORAGE_KEYS.LAST_AUDIT_RESULT, STORAGE_KEYS.LAST_ERROR,
      STORAGE_KEYS.EVENT_LOG
    ], { area: area, useSchemaDefault: true });
    return {
      area: area, settings: localValues[STORAGE_KEYS.SETTINGS], githubAuth: localValues[STORAGE_KEYS.GITHUB_AUTH],
      repository: localValues[STORAGE_KEYS.REPOSITORY], workflow: localValues[STORAGE_KEYS.WORKFLOW_STATE],
      ui: localValues[STORAGE_KEYS.UI_STATE], manualHub: localValues[STORAGE_KEYS.MANUAL_BRIDGE_DRAFT],
      lastParsedPayload: localValues[STORAGE_KEYS.LAST_PARSED_PAYLOAD], lastAuditResult: localValues[STORAGE_KEYS.LAST_AUDIT_RESULT],
      lastError: localValues[STORAGE_KEYS.LAST_ERROR], eventLog: localValues[STORAGE_KEYS.EVENT_LOG]
    };
  }

  async function exportKnownState(options) {
    const config = ensureObject(options);
    const area = normalizeArea(config.area || STORAGE_AREAS.LOCAL);
    const keys = listKnownKeys(area);
    return readMany(keys, { area: area, useSchemaDefault: true });
  }

  async function importKnownState(snapshot, options) {
    if (!isPlainObject(snapshot)) {
      throw createStorageError(ERROR_CODES.INVALID_ARGUMENT, 'importKnownState() requires a plain object.', { snapshotType: Object.prototype.toString.call(snapshot) });
    }
    const config = ensureObject(options);
    const area = normalizeArea(config.area || STORAGE_AREAS.LOCAL);
    const knownKeys = listKnownKeys(area);
    const toWrite = Object.create(null);
    for (const key of knownKeys) {
      if (hasOwn(snapshot, key)) {
        toWrite[key] = normalizeStoredValue(key, snapshot[key]);
      }
    }
    await rawSet(area, toWrite);
    return cloneValue(toWrite);
  }

  const api = {
    areas: deepFreeze({ LOCAL: STORAGE_AREAS.LOCAL, SESSION: STORAGE_AREAS.SESSION }),
    keys: deepFreeze(cloneValue(STORAGE_KEYS)),
    isRuntimeAvailable: hasAnyStorageRuntime,
    hasNativeArea: hasNativeStorageArea,
    normalizeArea: normalizeArea, normalizeKey: normalizeKey, getSchemaDefault: getSchemaDefault,
    initializeDefaults: initializeDefaults, read: read, readMany: readMany, readAll: readAll,
    write: write, remove: remove, clear: clear, merge: merge,
    getSettings: getSettings, saveSettings: saveSettings, patchSettings: patchSettings,
    getGitHubAuth: getGitHubAuth, saveGitHubAuth: saveGitHubAuth, clearGitHubAuth: clearGitHubAuth,
    getRepository: getRepository, saveRepository: saveRepository, patchRepository: patchRepository,
    getWorkflowState: getWorkflowState, saveWorkflowState: saveWorkflowState, patchWorkflowState: patchWorkflowState, resetWorkflowState: resetWorkflowState,
    getUiState: getUiState, saveUiState: saveUiState, patchUiState: patchUiState,
    getManualHubState: getManualHubState, saveManualHubState: saveManualHubState, patchManualHubState: patchManualHubState,
    getLastParsedPayload: getLastParsedPayload, setLastParsedPayload: setLastParsedPayload, clearLastParsedPayload: clearLastParsedPayload,
    getLastAuditResult: getLastAuditResult, setLastAuditResult: setLastAuditResult, clearLastAuditResult: clearLastAuditResult,
    getLastError: getLastError, setLastError: setLastError, clearLastError: clearLastError,
    getEventLog: getEventLog, replaceEventLog: replaceEventLog, appendEventLog: appendEventLog, clearEventLog: clearEventLog,
    getBootstrapState: getBootstrapState, exportKnownState: exportKnownState, importKnownState: importKnownState,
    helpers: deepFreeze({
      isPlainObject: isPlainObject, deepMerge: deepMerge, createStorageError: createStorageError,
      normalizeStoredValue: normalizeStoredValue, normalizeEventLogEntry: normalizeEventLogEntry,
      normalizeEventLog: normalizeEventLog, sanitizeContextObject: sanitizeContextObject, listKnownKeys: listKnownKeys
    })
  };

  root.registerValue('storage', deepFreeze(api), { overwrite: false, freeze: false, clone: false });
}(typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : this))));
