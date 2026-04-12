(function registerMAOEProtocol(globalScope) {
  'use strict';

  const root = globalScope.MAOE;

  if (!root || typeof root.registerValue !== 'function') {
    throw new Error('[MAOE] namespace.js must be loaded before protocol.js.');
  }

  if (root.has('protocol')) {
    return;
  }

  if (!root.has('constants')) {
    throw new Error('[MAOE] constants.js must be loaded before protocol.js.');
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

  const safeJsonParse = typeof util.safeJsonParse === 'function'
    ? util.safeJsonParse
    : function fallbackSafeJsonParse(text, fallbackValue) {
        try {
          return JSON.parse(text);
        } catch (error) {
          return arguments.length >= 2 ? fallbackValue : null;
        }
      };

  const safeJsonStringify = typeof util.safeJsonStringify === 'function'
    ? util.safeJsonStringify
    : function fallbackSafeJsonStringify(value, space) {
        try {
          return JSON.stringify(value, null, typeof space === 'number' ? space : 2);
        } catch (error) {
          return '{}';
        }
      };

  function createFallbackLogger() {
    const consoleObject = typeof console !== 'undefined' ? console : null;

    function emit(level, message, context) {
      if (!consoleObject || typeof consoleObject[level] !== 'function') {
        return;
      }
      if (typeof context === 'undefined') {
        consoleObject[level]('[MAOE/protocol] ' + message);
        return;
      }
      consoleObject[level]('[MAOE/protocol] ' + message, context);
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
    const loggerModule = root.require('logger');
    if (loggerModule && typeof loggerModule.createScope === 'function') {
      try {
        return loggerModule.createScope('protocol');
      } catch (error) {}
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
  const MESSAGING = constants.MESSAGING || Object.create(null);
  const WORKFLOW = constants.WORKFLOW || Object.create(null);
  const MANUAL_HUB = constants.MANUAL_HUB || Object.create(null);
  const PARSER = constants.PARSER || Object.create(null);
  const PROMPT = constants.PROMPT || Object.create(null);
  const ERROR_CODES = constants.ERROR_CODES || Object.create(null);
  const DEFAULTS = constants.DEFAULTS || Object.create(null);
  const PROVIDERS = constants.PROVIDERS || Object.create(null);
  const helpers = constants.helpers || Object.create(null);

  const PROTOCOL_VERSION = typeof APP.protocolVersion === 'string' && APP.protocolVersion
    ? APP.protocolVersion
    : '1.0.0';

  const MESSAGE_TYPES = MESSAGING.TYPES || Object.create(null);
  const MESSAGE_RESPONSE_STATUS = MESSAGING.RESPONSE_STATUS || Object.create(null);
  const WORKFLOW_STAGES = WORKFLOW.STAGES || Object.create(null);
  const WORKFLOW_STATUSES = WORKFLOW.STATUSES || Object.create(null);
  const WORKFLOW_ROLES = WORKFLOW.ROLES || Object.create(null);
  const HUMAN_ACTIONS = WORKFLOW.HUMAN_ACTIONS || Object.create(null);
  const REVIEW_VERDICTS = WORKFLOW.REVIEW_VERDICTS || Object.create(null);

  const SUPPORTED_MESSAGE_TYPES = Object.keys(MESSAGE_TYPES).map(function mapKey(key) {
    return MESSAGE_TYPES[key];
  });

  const SUPPORTED_PACKET_TYPES = Object.keys(MANUAL_HUB.PACKET_TYPES || Object.create(null)).map(function mapPacketType(key) {
    return MANUAL_HUB.PACKET_TYPES[key];
  });

  const SUPPORTED_STAGE_VALUES = Array.isArray(WORKFLOW.STAGE_ORDER)
    ? WORKFLOW.STAGE_ORDER.slice()
    : Object.keys(WORKFLOW_STAGES).map(function mapStageKey(key) {
        return WORKFLOW_STAGES[key];
      });

  const SUPPORTED_STATUS_VALUES = Object.keys(WORKFLOW_STATUSES).map(function mapStatusKey(key) {
    return WORKFLOW_STATUSES[key];
  });

  const SUPPORTED_ROLE_VALUES = Object.keys(WORKFLOW_ROLES).map(function mapRoleKey(key) {
    return WORKFLOW_ROLES[key];
  });

  const SUPPORTED_REVIEW_VERDICTS = Object.keys(REVIEW_VERDICTS).map(function mapVerdictKey(key) {
    return REVIEW_VERDICTS[key];
  });

  const SUPPORTED_PROVIDER_IDS = Object.keys(PROVIDERS);

  const SUPPORTED_RESPONSE_STATUS_VALUES = Object.keys(MESSAGE_RESPONSE_STATUS).map(function mapStatusKey(key) {
    return MESSAGE_RESPONSE_STATUS[key];
  });

  const PACKET_REQUIRED_FIELDS = MANUAL_HUB.REQUIRED_FIELDS || Object.create(null);
  const MESSAGE_STATUS_OK = typeof MESSAGE_RESPONSE_STATUS.OK === 'string' ? MESSAGE_RESPONSE_STATUS.OK : 'ok';
  const MESSAGE_STATUS_ERROR = typeof MESSAGE_RESPONSE_STATUS.ERROR === 'string' ? MESSAGE_RESPONSE_STATUS.ERROR : 'error';

  const STAGE_TRANSITIONS = Object.freeze({
    idle: ['idle', 'design', 'execution', 'error'],
    design: ['design', 'execution', 'error', 'idle'],
    execution: ['execution', 'audit', 'error', 'design', 'idle'],
    audit: ['audit', 'execution', 'pr', 'error', 'idle'],
    pr: ['pr', 'completed', 'error', 'audit', 'idle'],
    completed: ['completed', 'idle'],
    error: ['error', 'idle', 'design', 'execution']
  });

  const STATUS_TRANSITIONS = Object.freeze({
    idle: ['idle', 'ready', 'in_progress', 'awaiting_human', 'blocked', 'failed', 'completed'],
    ready: ['ready', 'in_progress', 'awaiting_human', 'blocked', 'failed', 'completed', 'idle'],
    in_progress: ['in_progress', 'awaiting_human', 'approved', 'rejected', 'blocked', 'failed', 'completed', 'idle'],
    awaiting_human: ['awaiting_human', 'ready', 'in_progress', 'approved', 'rejected', 'blocked', 'failed', 'completed', 'idle'],
    approved: ['approved', 'completed', 'ready', 'idle'],
    rejected: ['rejected', 'ready', 'in_progress', 'awaiting_human', 'idle'],
    blocked: ['blocked', 'ready', 'in_progress', 'failed', 'idle'],
    failed: ['failed', 'ready', 'in_progress', 'idle'],
    completed: ['completed', 'idle']
  });

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

  function createNullObject() {
    return Object.create(null);
  }

  function normalizeString(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function normalizeOptionalString(value, fallbackValue) {
    const normalized = normalizeString(value);
    return normalized || (typeof fallbackValue === 'string' ? fallbackValue : '');
  }

  function normalizeLowerString(value, fallbackValue) {
    const normalized = normalizeString(value).toLowerCase();
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
    return !!fallbackValue;
  }

  function normalizeArray(value) {
    return Array.isArray(value) ? value.slice() : [];
  }

  function uniqueStrings(values) {
    const items = Array.isArray(values) ? values : [];
    const result = [];
    const seen = new Set();
    for (const item of items) {
      const normalized = normalizeString(item);
      if (!normalized || seen.has(normalized)) {
        continue;
      }
      seen.add(normalized);
      result.push(normalized);
    }
    return result;
  }

  function oneOf(value, allowedValues, fallbackValue) {
    const normalizedValue = typeof value === 'string' ? value.trim() : value;
    if (Array.isArray(allowedValues) && allowedValues.indexOf(normalizedValue) >= 0) {
      return normalizedValue;
    }
    return fallbackValue;
  }

  function nowIsoString() {
    return new Date().toISOString();
  }

  function generateRequestId(prefix) {
    const normalizedPrefix = normalizeLowerString(prefix, 'req').replace(/[^a-z0-9_-]/g, '') || 'req';
    const timePart = Date.now().toString(36);
    const randomPart = Math.random().toString(36).slice(2, 10);
    return normalizedPrefix + '_' + timePart + '_' + randomPart;
  }

  function createProtocolError(code, message, details) {
    const error = new Error(message || 'Protocol validation failed.');
    error.name = 'MAOEProtocolError';
    error.code = typeof code === 'string' && code ? code : (ERROR_CODES.UNKNOWN_ERROR || 'UNKNOWN_ERROR');
    error.details = isPlainObject(details) ? cloneValue(details) : createNullObject();
    return error;
  }

  function assert(condition, code, message, details) {
    if (!condition) {
      throw createProtocolError(code, message, details);
    }
  }

  function toSafeObject(value) {
    return isPlainObject(value) ? cloneValue(value) : createNullObject();
  }

  function cloneOrPrimitive(value) {
    return value === null || typeof value !== 'object' ? value : cloneValue(value);
  }

  function stringMapFromObject(value) {
    const source = isPlainObject(value) ? value : createNullObject();
    const output = createNullObject();
    for (const key of Object.keys(source)) {
      const normalizedKey = normalizeString(key);
      if (!normalizedKey) {
        continue;
      }
      output[normalizedKey] = normalizeString(source[key]);
    }
    return output;
  }

  function normalizeSourceTargetEndpoint(value, fallbackType) {
    const source = isPlainObject(value) ? value : createNullObject();
    return {
      type: normalizeOptionalString(source.type, fallbackType || 'unknown').toLowerCase(),
      id: normalizeOptionalString(source.id, ''),
      label: normalizeOptionalString(source.label, ''),
      role: oneOf(normalizeLowerString(source.role), SUPPORTED_ROLE_VALUES.concat(['']), ''),
      providerId: oneOf(normalizeLowerString(source.providerId), SUPPORTED_PROVIDER_IDS.concat(['']), ''),
      siteId: normalizeOptionalString(source.siteId, ''),
      tabId: normalizeIntegerOrNull(source.tabId),
      url: normalizeOptionalString(source.url, '')
    };
  }

  function normalizeErrorPayload(value) {
    if (value instanceof Error) {
      return {
        code: normalizeOptionalString(value.code, ERROR_CODES.UNKNOWN_ERROR || 'UNKNOWN_ERROR'),
        message: normalizeOptionalString(value.message, 'Unexpected error.'),
        details: isPlainObject(value.details) ? cloneValue(value.details) : createNullObject()
      };
    }
    const source = isPlainObject(value) ? value : createNullObject();
    return {
      code: normalizeOptionalString(source.code, ERROR_CODES.UNKNOWN_ERROR || 'UNKNOWN_ERROR'),
      message: normalizeOptionalString(source.message, 'Unexpected error.'),
      details: isPlainObject(source.details) ? cloneValue(source.details) : createNullObject()
    };
  }

  function normalizeGitHubRepositoryRef(value) {
    const source = isPlainObject(value) ? value : createNullObject();
    return {
      owner: normalizeOptionalString(source.owner, ''),
      repo: normalizeOptionalString(source.repo, ''),
      baseBranch: normalizeOptionalString(source.baseBranch, ''),
      defaultBranch: normalizeOptionalString(source.defaultBranch, '')
    };
  }

  function normalizeIssueRef(value) {
    const source = isPlainObject(value) ? value : createNullObject();
    return {
      number: normalizeIntegerOrNull(source.number),
      title: normalizeOptionalString(source.title, ''),
      body: normalizeOptionalString(source.body, ''),
      url: normalizeOptionalString(source.url, ''),
      state: normalizeOptionalString(source.state, ''),
      labels: uniqueStrings(source.labels)
    };
  }

  function normalizeOutputContract(value) {
    const source = isPlainObject(value) ? value : createNullObject();
    const defaults = PROMPT.OUTPUT_CONTRACTS || createNullObject();
    const executorDefaults = isPlainObject(defaults.EXECUTOR) ? defaults.EXECUTOR : createNullObject();
    const auditorDefaults = isPlainObject(defaults.AUDITOR) ? defaults.AUDITOR : createNullObject();

    const fallback = normalizeLowerString(source.kind) === 'audit' ? auditorDefaults : executorDefaults;

    return {
      kind: normalizeOptionalString(source.kind, 'file').toLowerCase(),
      format: normalizeOptionalString(source.format, fallback.format || 'xml_file'),
      fenceLanguage: normalizeOptionalString(source.fenceLanguage, fallback.fenceLanguage || 'xml').toLowerCase(),
      xmlRootTag: normalizeOptionalString(source.xmlRootTag, fallback.xmlRootTag || (PARSER.XML && PARSER.XML.FILE_ROOT_TAG ? PARSER.XML.FILE_ROOT_TAG : 'File')),
      pathAttribute: normalizeOptionalString(source.pathAttribute, fallback.pathAttribute || (PARSER.XML && PARSER.XML.FILE_PATH_ATTRIBUTE ? PARSER.XML.FILE_PATH_ATTRIBUTE : 'path')),
      singleFile: normalizeBoolean(source.singleFile, fallback.singleFile !== false),
      cdataRequired: normalizeBoolean(source.cdataRequired, fallback.cdataRequired !== false),
      verdictValues: uniqueStrings(source.verdictValues || fallback.verdictValues || [])
    };
  }

  function normalizeReviewFinding(value) {
    if (typeof value === 'string') {
      return { severity: '', target: '', message: normalizeString(value) };
    }
    const source = isPlainObject(value) ? value : createNullObject();
    return {
      severity: normalizeOptionalString(source.severity, ''),
      target: normalizeOptionalString(source.target, ''),
      message: normalizeOptionalString(source.message, '')
    };
  }

  function normalizeTaskDispatchPayload(value) {
    const source = isPlainObject(value) ? value : createNullObject();
    return {
      repository: normalizeGitHubRepositoryRef(source.repository),
      issue: normalizeIssueRef(source.issue),
      targetFile: normalizeOptionalString(source.targetFile, ''),
      instructions: normalizeOptionalString(source.instructions, ''),
      repositoryTree: normalizeOptionalString(source.repositoryTree, ''),
      currentCode: normalizeOptionalString(source.currentCode, ''),
      outputContract: normalizeOutputContract(source.outputContract),
      metadata: isPlainObject(source.metadata) ? cloneValue(source.metadata) : createNullObject()
    };
  }

  function normalizeExecutionResultPayload(value) {
    const source = isPlainObject(value) ? value : createNullObject();
    return {
      targetFile: normalizeOptionalString(source.targetFile, ''),
      rawResponse: normalizeOptionalString(source.rawResponse, ''),
      parsedOutput: cloneOrPrimitive(hasOwn(source, 'parsedOutput') ? source.parsedOutput : null),
      parserErrors: Array.isArray(source.parserErrors) ? source.parserErrors.map(function mapEntry(entry) { return normalizeOptionalString(entry, ''); }).filter(Boolean) : [],
      metadata: isPlainObject(source.metadata) ? cloneValue(source.metadata) : createNullObject()
    };
  }

  function normalizeAuditRequestPayload(value) {
    const source = isPlainObject(value) ? value : createNullObject();
    return {
      repository: normalizeGitHubRepositoryRef(source.repository),
      issue: normalizeIssueRef(source.issue),
      diff: normalizeOptionalString(source.diff, ''),
      criteria: normalizeArray(source.criteria).map(function mapCriterion(entry) { return normalizeOptionalString(entry, ''); }).filter(Boolean),
      targetFile: normalizeOptionalString(source.targetFile, ''),
      metadata: isPlainObject(source.metadata) ? cloneValue(source.metadata) : createNullObject()
    };
  }

  function normalizeAuditResultPayload(value) {
    const source = isPlainObject(value) ? value : createNullObject();
    return {
      verdict: oneOf(source.verdict, SUPPORTED_REVIEW_VERDICTS, ''),
      summary: normalizeOptionalString(source.summary, ''),
      findings: Array.isArray(source.findings) ? source.findings.map(normalizeReviewFinding).filter(function filterFinding(finding) { return !!finding.message; }) : [],
      targetFile: normalizeOptionalString(source.targetFile, ''),
      metadata: isPlainObject(source.metadata) ? cloneValue(source.metadata) : createNullObject()
    };
  }

  function normalizePacketPayloadByType(packetType, payload) {
    const normalizedType = normalizePacketType(packetType);
    if (normalizedType === MANUAL_HUB.PACKET_TYPES.TASK_DISPATCH) { return normalizeTaskDispatchPayload(payload); }
    if (normalizedType === MANUAL_HUB.PACKET_TYPES.EXECUTION_RESULT) { return normalizeExecutionResultPayload(payload); }
    if (normalizedType === MANUAL_HUB.PACKET_TYPES.AUDIT_REQUEST) { return normalizeAuditRequestPayload(payload); }
    if (normalizedType === MANUAL_HUB.PACKET_TYPES.AUDIT_RESULT) { return normalizeAuditResultPayload(payload); }
    return cloneOrPrimitive(payload);
  }

  function normalizePacketType(packetType) { return oneOf(normalizeOptionalString(packetType, ''), SUPPORTED_PACKET_TYPES, ''); }
  function normalizeMessageType(messageType) { return oneOf(normalizeOptionalString(messageType, ''), SUPPORTED_MESSAGE_TYPES, ''); }
  function normalizeResponseStatus(status) { return oneOf(normalizeLowerString(status, ''), SUPPORTED_RESPONSE_STATUS_VALUES, MESSAGE_STATUS_OK); }
  function normalizeWorkflowStage(stage) { return oneOf(normalizeLowerString(stage, ''), SUPPORTED_STAGE_VALUES, DEFAULTS.workflow && DEFAULTS.workflow.stage ? DEFAULTS.workflow.stage : WORKFLOW_STAGES.IDLE || 'idle'); }
  function normalizeWorkflowStatus(status) { return oneOf(normalizeLowerString(status, ''), SUPPORTED_STATUS_VALUES, DEFAULTS.workflow && DEFAULTS.workflow.status ? DEFAULTS.workflow.status : WORKFLOW_STATUSES.IDLE || 'idle'); }

  function normalizeWorkflowState(value) {
    const source = isPlainObject(value) ? value : createNullObject();
    const defaults = isPlainObject(DEFAULTS.workflow) ? DEFAULTS.workflow : createNullObject();
    const selectedProviderIds = isPlainObject(source.selectedProviderIds) ? source.selectedProviderIds : (isPlainObject(defaults.selectedProviderIds) ? defaults.selectedProviderIds : createNullObject());

    return {
      stage: normalizeWorkflowStage(hasOwn(source, 'stage') ? source.stage : defaults.stage),
      status: normalizeWorkflowStatus(hasOwn(source, 'status') ? source.status : defaults.status),
      currentIssueNumber: normalizeIntegerOrNull(hasOwn(source, 'currentIssueNumber') ? source.currentIssueNumber : defaults.currentIssueNumber),
      currentIssueTitle: normalizeOptionalString(hasOwn(source, 'currentIssueTitle') ? source.currentIssueTitle : defaults.currentIssueTitle, ''),
      currentIssueUrl: normalizeOptionalString(hasOwn(source, 'currentIssueUrl') ? source.currentIssueUrl : defaults.currentIssueUrl, ''),
      currentTaskFilePath: normalizeOptionalString(hasOwn(source, 'currentTaskFilePath') ? source.currentTaskFilePath : defaults.currentTaskFilePath, ''),
      activeProviderId: oneOf(normalizeLowerString(hasOwn(source, 'activeProviderId') ? source.activeProviderId : defaults.activeProviderId, ''), SUPPORTED_PROVIDER_IDS.concat(['']), ''),
      selectedProviderIds: {
        designer: oneOf(normalizeLowerString(selectedProviderIds.designer, ''), SUPPORTED_PROVIDER_IDS.concat(['']), defaults.selectedProviderIds && defaults.selectedProviderIds.designer ? defaults.selectedProviderIds.designer : ''),
        executor: oneOf(normalizeLowerString(selectedProviderIds.executor, ''), SUPPORTED_PROVIDER_IDS.concat(['']), defaults.selectedProviderIds && defaults.selectedProviderIds.executor ? defaults.selectedProviderIds.executor : ''),
        auditor: oneOf(normalizeLowerString(selectedProviderIds.auditor, ''), SUPPORTED_PROVIDER_IDS.concat(['']), defaults.selectedProviderIds && defaults.selectedProviderIds.auditor ? defaults.selectedProviderIds.auditor : '')
      },
      workingBranch: normalizeOptionalString(hasOwn(source, 'workingBranch') ? source.workingBranch : defaults.workingBranch, ''),
      pullRequestUrl: normalizeOptionalString(hasOwn(source, 'pullRequestUrl') ? source.pullRequestUrl : defaults.pullRequestUrl, ''),
      pullRequestNumber: normalizeIntegerOrNull(hasOwn(source, 'pullRequestNumber') ? source.pullRequestNumber : defaults.pullRequestNumber),
      latestExecutorResponse: normalizeOptionalString(hasOwn(source, 'latestExecutorResponse') ? source.latestExecutorResponse : defaults.latestExecutorResponse, ''),
      latestAuditVerdict: oneOf(normalizeOptionalString(hasOwn(source, 'latestAuditVerdict') ? source.latestAuditVerdict : defaults.latestAuditVerdict, ''), SUPPORTED_REVIEW_VERDICTS.concat(['']), ''),
      latestAuditSummary: normalizeOptionalString(hasOwn(source, 'latestAuditSummary') ? source.latestAuditSummary : defaults.latestAuditSummary, ''),
      lastTransitionAt: normalizeOptionalString(hasOwn(source, 'lastTransitionAt') ? source.lastTransitionAt : defaults.lastTransitionAt, ''),
      lastHumanActionAt: normalizeOptionalString(hasOwn(source, 'lastHumanActionAt') ? source.lastHumanActionAt : defaults.lastHumanActionAt, ''),
      lastErrorCode: normalizeOptionalString(hasOwn(source, 'lastErrorCode') ? source.lastErrorCode : defaults.lastErrorCode, ''),
      lastErrorMessage: normalizeOptionalString(hasOwn(source, 'lastErrorMessage') ? source.lastErrorMessage : defaults.lastErrorMessage, '')
    };
  }

  function validateRequiredString(value, fieldName, errors) {
    if (!normalizeString(value)) {
      errors.push({ field: fieldName, code: ERROR_CODES.INVALID_ARGUMENT || 'INVALID_ARGUMENT', message: fieldName + ' must be a non-empty string.' });
      return false;
    }
    return true;
  }

  function validateOneOf(value, allowedValues, fieldName, errors) {
    if (Array.isArray(allowedValues) && allowedValues.indexOf(value) >= 0) {
      return true;
    }
    errors.push({ field: fieldName, code: ERROR_CODES.INVALID_ARGUMENT || 'INVALID_ARGUMENT', message: fieldName + ' is not supported.', details: { value: value, allowedValues: cloneValue(allowedValues) } });
    return false;
  }

  function validateIssueRef(issue, fieldPrefix, errors) {
    const prefix = normalizeOptionalString(fieldPrefix, 'issue');
    if (!isPlainObject(issue)) {
      errors.push({ field: prefix, code: ERROR_CODES.INVALID_ARGUMENT || 'INVALID_ARGUMENT', message: prefix + ' must be an object.' });
      return false;
    }
    if (issue.number === null || !Number.isFinite(Number(issue.number))) {
      errors.push({ field: prefix + '.number', code: ERROR_CODES.INVALID_ARGUMENT || 'INVALID_ARGUMENT', message: prefix + '.number must be a finite integer.' });
    }
    validateRequiredString(issue.title, prefix + '.title', errors);
    return errors.length === 0;
  }

  function validateRepositoryRef(repository, fieldPrefix, errors) {
    const prefix = normalizeOptionalString(fieldPrefix, 'repository');
    if (!isPlainObject(repository)) {
      errors.push({ field: prefix, code: ERROR_CODES.INVALID_ARGUMENT || 'INVALID_ARGUMENT', message: prefix + ' must be an object.' });
      return false;
    }
    validateRequiredString(repository.owner, prefix + '.owner', errors);
    validateRequiredString(repository.repo, prefix + '.repo', errors);
    return errors.length === 0;
  }

  function validateOutputContract(outputContract, fieldPrefix, errors) {
    const prefix = normalizeOptionalString(fieldPrefix, 'outputContract');
    if (!isPlainObject(outputContract)) {
      errors.push({ field: prefix, code: ERROR_CODES.INVALID_ARGUMENT || 'INVALID_ARGUMENT', message: prefix + ' must be an object.' });
      return false;
    }
    validateRequiredString(outputContract.format, prefix + '.format', errors);
    validateRequiredString(outputContract.fenceLanguage, prefix + '.fenceLanguage', errors);
    validateRequiredString(outputContract.xmlRootTag, prefix + '.xmlRootTag', errors);
    validateRequiredString(outputContract.pathAttribute, prefix + '.pathAttribute', errors);
    if (outputContract.singleFile !== true) {
      errors.push({ field: prefix + '.singleFile', code: ERROR_CODES.INVALID_ARGUMENT || 'INVALID_ARGUMENT', message: prefix + '.singleFile must be true for this protocol version.' });
    }
    return errors.length === 0;
  }

  function validateTaskDispatchPayload(payload, errors) {
    const normalized = normalizeTaskDispatchPayload(payload);
    validateRepositoryRef(normalized.repository, 'payload.repository', errors);
    validateIssueRef(normalized.issue, 'payload.issue', errors);
    validateRequiredString(normalized.targetFile, 'payload.targetFile', errors);
    validateRequiredString(normalized.instructions, 'payload.instructions', errors);
    validateOutputContract(normalized.outputContract, 'payload.outputContract', errors);
    return { valid: errors.length === 0, normalized: normalized };
  }

  function validateExecutionResultPayload(payload, errors) {
    const normalized = normalizeExecutionResultPayload(payload);
    validateRequiredString(normalized.targetFile, 'payload.targetFile', errors);
    validateRequiredString(normalized.rawResponse, 'payload.rawResponse', errors);
    if (!hasOwn(normalized, 'parsedOutput')) {
      errors.push({ field: 'payload.parsedOutput', code: ERROR_CODES.INVALID_ARGUMENT || 'INVALID_ARGUMENT', message: 'payload.parsedOutput must exist.' });
    }
    return { valid: errors.length === 0, normalized: normalized };
  }

  function validateAuditRequestPayload(payload, errors) {
    const normalized = normalizeAuditRequestPayload(payload);
    validateRepositoryRef(normalized.repository, 'payload.repository', errors);
    validateIssueRef(normalized.issue, 'payload.issue', errors);
    validateRequiredString(normalized.diff, 'payload.diff', errors);
    if (!Array.isArray(normalized.criteria) || normalized.criteria.length === 0) {
      errors.push({ field: 'payload.criteria', code: ERROR_CODES.INVALID_ARGUMENT || 'INVALID_ARGUMENT', message: 'payload.criteria must contain at least one review criterion.' });
    }
    return { valid: errors.length === 0, normalized: normalized };
  }

  function validateAuditResultPayload(payload, errors) {
    const normalized = normalizeAuditResultPayload(payload);
    validateOneOf(normalized.verdict, SUPPORTED_REVIEW_VERDICTS, 'payload.verdict', errors);
    validateRequiredString(normalized.summary, 'payload.summary', errors);
    return { valid: errors.length === 0, normalized: normalized };
  }

  function validatePacketPayload(packetType, payload) {
    const errors = [];
    let result;
    if (packetType === MANUAL_HUB.PACKET_TYPES.TASK_DISPATCH) { result = validateTaskDispatchPayload(payload, errors); }
    else if (packetType === MANUAL_HUB.PACKET_TYPES.EXECUTION_RESULT) { result = validateExecutionResultPayload(payload, errors); }
    else if (packetType === MANUAL_HUB.PACKET_TYPES.AUDIT_REQUEST) { result = validateAuditRequestPayload(payload, errors); }
    else if (packetType === MANUAL_HUB.PACKET_TYPES.AUDIT_RESULT) { result = validateAuditResultPayload(payload, errors); }
    else {
      errors.push({ field: 'packetType', code: ERROR_CODES.INVALID_ARGUMENT || 'INVALID_ARGUMENT', message: 'Unsupported packet type: ' + String(packetType) });
      result = { valid: false, normalized: cloneOrPrimitive(payload) };
    }
    return { valid: errors.length === 0 && result.valid === true, normalized: result.normalized, errors: errors };
  }

  function createMessage(options) {
    const source = isPlainObject(options) ? options : createNullObject();
    const type = normalizeMessageType(source.type);
    assert(type, ERROR_CODES.MESSAGE_UNSUPPORTED || 'MESSAGE_UNSUPPORTED', 'Unsupported message type.', { type: source.type, supportedTypes: cloneValue(SUPPORTED_MESSAGE_TYPES) });
    const message = {
      protocolVersion: PROTOCOL_VERSION,
      requestId: normalizeOptionalString(source.requestId, generateRequestId('msg')),
      type: type,
      createdAt: normalizeOptionalString(source.createdAt, nowIsoString()),
      source: normalizeSourceTargetEndpoint(source.source, 'unknown'),
      target: normalizeSourceTargetEndpoint(source.target, 'unknown'),
      payload: hasOwn(source, 'payload') ? cloneOrPrimitive(source.payload) : createNullObject(),
      meta: isPlainObject(source.meta) ? cloneValue(source.meta) : createNullObject()
    };
    return deepFreeze(message);
  }

  function createRequest(messageType, payload, options) {
    const config = isPlainObject(options) ? options : createNullObject();
    return createMessage({ type: messageType, requestId: config.requestId, createdAt: config.createdAt, source: config.source, target: config.target, payload: payload, meta: config.meta });
  }

  function createResponse(requestMessage, status, payload, options) {
    const config = isPlainObject(options) ? options : createNullObject();
    const request = isPlainObject(requestMessage) ? requestMessage : createNullObject();
    const normalizedStatus = normalizeResponseStatus(status);
    const responsePayload = {
      status: normalizedStatus,
      data: normalizedStatus === MESSAGE_STATUS_OK ? cloneOrPrimitive(payload) : null,
      error: normalizedStatus === MESSAGE_STATUS_ERROR ? normalizeErrorPayload(payload) : null
    };
    return createMessage({
      type: normalizeMessageType(config.type || request.type),
      requestId: normalizeOptionalString(config.requestId, normalizeOptionalString(request.requestId, generateRequestId('msg'))),
      createdAt: config.createdAt,
      source: config.source || request.target,
      target: config.target || request.source,
      payload: responsePayload,
      meta: Object.assign(createNullObject(), toSafeObject(request.meta), toSafeObject(config.meta), { isResponse: true })
    });
  }

  function createOkResponse(requestMessage, data, options) { return createResponse(requestMessage, MESSAGE_STATUS_OK, data, options); }
  function createErrorResponse(requestMessage, error, options) { return createResponse(requestMessage, MESSAGE_STATUS_ERROR, normalizeErrorPayload(error), options); }

  function isResponseMessage(message) {
    return isPlainObject(message) && isPlainObject(message.payload) && hasOwn(message.payload, 'status') && normalizeResponseStatus(message.payload.status) === normalizeLowerString(message.payload.status, '');
  }

  function validateMessage(value, options) {
    const config = isPlainObject(options) ? options : createNullObject();
    const errors = [];
    const source = isPlainObject(value) ? value : null;

    if (!source) { return { valid: false, normalized: null, errors: [{ field: 'message', code: ERROR_CODES.INVALID_ARGUMENT || 'INVALID_ARGUMENT', message: 'Message must be a plain object.' }] }; }

    const normalized = {
      protocolVersion: normalizeOptionalString(source.protocolVersion, ''),
      requestId: normalizeOptionalString(source.requestId, ''),
      type: normalizeMessageType(source.type),
      createdAt: normalizeOptionalString(source.createdAt, ''),
      source: normalizeSourceTargetEndpoint(source.source, 'unknown'),
      target: normalizeSourceTargetEndpoint(source.target, 'unknown'),
      payload: hasOwn(source, 'payload') ? cloneOrPrimitive(source.payload) : createNullObject(),
      meta: isPlainObject(source.meta) ? cloneValue(source.meta) : createNullObject()
    };

    validateRequiredString(normalized.protocolVersion, 'protocolVersion', errors);
    validateRequiredString(normalized.requestId, 'requestId', errors);
    validateRequiredString(normalized.createdAt, 'createdAt', errors);
    validateOneOf(normalized.type, SUPPORTED_MESSAGE_TYPES, 'type', errors);

    if (config.expectedType) {
      const expectedType = normalizeMessageType(config.expectedType);
      if (expectedType && normalized.type !== expectedType) {
        errors.push({ field: 'type', code: ERROR_CODES.INVALID_ARGUMENT || 'INVALID_ARGUMENT', message: 'Message type mismatch.', details: { expectedType: expectedType, actualType: normalized.type } });
      }
    }
    if (!isPlainObject(normalized.source)) { errors.push({ field: 'source', code: ERROR_CODES.INVALID_ARGUMENT || 'INVALID_ARGUMENT', message: 'source must be an object.' }); }
    if (!isPlainObject(normalized.target)) { errors.push({ field: 'target', code: ERROR_CODES.INVALID_ARGUMENT || 'INVALID_ARGUMENT', message: 'target must be an object.' }); }

    return { valid: errors.length === 0, normalized: normalized, errors: errors };
  }

  function assertValidMessage(value, options) {
    const validation = validateMessage(value, options);
    if (!validation.valid) { throw createProtocolError(ERROR_CODES.INVALID_ARGUMENT || 'INVALID_ARGUMENT', 'Message validation failed.', { errors: validation.errors }); }
    return validation.normalized;
  }

  function createPacket(options) {
    const source = isPlainObject(options) ? options : createNullObject();
    const packetType = normalizePacketType(source.packetType);
    assert(packetType, ERROR_CODES.INVALID_ARGUMENT || 'INVALID_ARGUMENT', 'Unsupported packet type.', { packetType: source.packetType, supportedPacketTypes: cloneValue(SUPPORTED_PACKET_TYPES) });
    const packet = {
      protocolVersion: PROTOCOL_VERSION,
      packetType: packetType,
      requestId: normalizeOptionalString(source.requestId, generateRequestId('packet')),
      createdAt: normalizeOptionalString(source.createdAt, nowIsoString()),
      source: normalizeSourceTargetEndpoint(source.source, 'actor'),
      target: normalizeSourceTargetEndpoint(source.target, 'actor'),
      payload: normalizePacketPayloadByType(packetType, source.payload),
      meta: isPlainObject(source.meta) ? cloneValue(source.meta) : createNullObject()
    };
    return deepFreeze(packet);
  }

  function validatePacket(value, options) {
    const config = isPlainObject(options) ? options : createNullObject();
    const errors = [];
    const source = isPlainObject(value) ? value : null;

    if (!source) { return { valid: false, normalized: null, errors: [{ field: 'packet', code: ERROR_CODES.INVALID_ARGUMENT || 'INVALID_ARGUMENT', message: 'Packet must be a plain object.' }] }; }

    const normalized = {
      protocolVersion: normalizeOptionalString(source.protocolVersion, ''),
      packetType: normalizePacketType(source.packetType),
      requestId: normalizeOptionalString(source.requestId, ''),
      createdAt: normalizeOptionalString(source.createdAt, ''),
      source: normalizeSourceTargetEndpoint(source.source, 'actor'),
      target: normalizeSourceTargetEndpoint(source.target, 'actor'),
      payload: normalizePacketPayloadByType(source.packetType, source.payload),
      meta: isPlainObject(source.meta) ? cloneValue(source.meta) : createNullObject()
    };

    validateRequiredString(normalized.protocolVersion, 'protocolVersion', errors);
    validateRequiredString(normalized.requestId, 'requestId', errors);
    validateRequiredString(normalized.createdAt, 'createdAt', errors);
    validateOneOf(normalized.packetType, SUPPORTED_PACKET_TYPES, 'packetType', errors);

    if (config.expectedPacketType) {
      const expectedPacketType = normalizePacketType(config.expectedPacketType);
      if (expectedPacketType && normalized.packetType !== expectedPacketType) {
        errors.push({ field: 'packetType', code: ERROR_CODES.INVALID_ARGUMENT || 'INVALID_ARGUMENT', message: 'Packet type mismatch.', details: { expectedPacketType: expectedPacketType, actualPacketType: normalized.packetType } });
      }
    }

    if (normalized.packetType) {
      const payloadValidation = validatePacketPayload(normalized.packetType, normalized.payload);
      normalized.payload = payloadValidation.normalized;
      for (const error of payloadValidation.errors) { errors.push(error); }
    }

    return { valid: errors.length === 0, normalized: normalized, errors: errors };
  }

  function assertValidPacket(value, options) {
    const validation = validatePacket(value, options);
    if (!validation.valid) { throw createProtocolError(ERROR_CODES.INVALID_ARGUMENT || 'INVALID_ARGUMENT', 'Packet validation failed.', { errors: validation.errors }); }
    return validation.normalized;
  }

  function buildPacketEnvelopeText(packet, options) {
    const config = isPlainObject(options) ? options : createNullObject();
    const validatedPacket = assertValidPacket(packet);
    const beginDelimiter = normalizeOptionalString(config.beginDelimiter, MANUAL_HUB.DELIMITERS && MANUAL_HUB.DELIMITERS.BEGIN ? MANUAL_HUB.DELIMITERS.BEGIN : '[MAOE_PACKET_BEGIN]');
    const endDelimiter = normalizeOptionalString(config.endDelimiter, MANUAL_HUB.DELIMITERS && MANUAL_HUB.DELIMITERS.END ? MANUAL_HUB.DELIMITERS.END : '[MAOE_PACKET_END]');
    const fenceLanguage = normalizeOptionalString(config.fenceLanguage, MANUAL_HUB.CLIPBOARD && MANUAL_HUB.CLIPBOARD.PREFERRED_FENCE_LANGUAGE ? MANUAL_HUB.CLIPBOARD.PREFERRED_FENCE_LANGUAGE : 'json').toLowerCase();
    const spacing = Number.isFinite(Number(config.space)) ? Math.max(0, Math.trunc(Number(config.space))) : 2;
    const packetText = safeJsonStringify(validatedPacket, spacing);

    return beginDelimiter + '\n```' + fenceLanguage + '\n' + packetText + '\n```\n' + endDelimiter;
  }

  function extractDelimitedPacketText(rawText, options) {
    const config = isPlainObject(options) ? options : createNullObject();
    const text = typeof rawText === 'string' ? rawText : '';
    const beginDelimiter = normalizeOptionalString(config.beginDelimiter, MANUAL_HUB.DELIMITERS && MANUAL_HUB.DELIMITERS.BEGIN ? MANUAL_HUB.DELIMITERS.BEGIN : '[MAOE_PACKET_BEGIN]');
    const endDelimiter = normalizeOptionalString(config.endDelimiter, MANUAL_HUB.DELIMITERS && MANUAL_HUB.DELIMITERS.END ? MANUAL_HUB.DELIMITERS.END : '[MAOE_PACKET_END]');
    const startIndex = text.indexOf(beginDelimiter);
    const endIndex = text.indexOf(endDelimiter);

    if (startIndex < 0 || endIndex < 0 || endIndex <= startIndex) { return ''; }

    const innerText = text.slice(startIndex + beginDelimiter.length, endIndex).trim();
    if (!innerText) { return ''; }

    const fencedMatch = innerText.match(/
http://googleusercontent.com/immersive_entry_chip/0

これを送信してGPTが正気に戻ったら、`[EXECUTE: T007]` と指示を出してください。人間ハブのバケツリレー、まだまだ中盤戦です。頑張りましょう！
