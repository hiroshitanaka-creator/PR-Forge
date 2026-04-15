(function registerMAOEOrchestrator(globalScope) {
  'use strict';

  const root = globalScope.MAOE;

  if (!root || typeof root.registerValue !== 'function') {
    throw new Error('[MAOE] namespace.js must be loaded before orchestrator.js.');
  }

  if (root.has('orchestrator')) {
    return;
  }

  if (!root.has('constants')) {
    throw new Error('[MAOE] constants.js must be loaded before orchestrator.js.');
  }

  if (!root.has('protocol')) {
    throw new Error('[MAOE] protocol.js must be loaded before orchestrator.js.');
  }

  if (!root.has('ai_payload_parser')) {
    throw new Error('[MAOE] ai_payload_parser.js must be loaded before orchestrator.js.');
  }

  if (!root.has('executor_prompt')) {
    throw new Error('[MAOE] executor_prompt.js must be loaded before orchestrator.js.');
  }

  if (!root.has('auditor_prompt')) {
    throw new Error('[MAOE] auditor_prompt.js must be loaded before orchestrator.js.');
  }

  if (!root.has('github_issue_service')) {
    throw new Error('[MAOE] github_issue_service.js must be loaded before orchestrator.js.');
  }

  if (!root.has('github_repo_service')) {
    throw new Error('[MAOE] github_repo_service.js must be loaded before orchestrator.js.');
  }

  if (!root.has('github_pr_service')) {
    throw new Error('[MAOE] github_pr_service.js must be loaded before orchestrator.js.');
  }

  if (!root.has('state_store')) {
    throw new Error('[MAOE] state_store.js must be loaded before orchestrator.js.');
  }

  const constants = root.require('constants');
  const protocol = root.require('protocol');
  const aiPayloadParser = root.require('ai_payload_parser');
  const executorPrompt = root.require('executor_prompt');
  const auditorPrompt = root.require('auditor_prompt');
  const githubIssueService = root.require('github_issue_service');
  const githubRepoService = root.require('github_repo_service');
  const githubPrService = root.require('github_pr_service');
  const stateStore = root.require('state_store');
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
        consoleObject[level]('[MAOE/orchestrator] ' + message);
        return;
      }

      consoleObject[level]('[MAOE/orchestrator] ' + message, context);
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
        return loggerModule.createScope('orchestrator');
      } catch (error) {
      }
    }

    if (
      loggerModule &&
      typeof loggerModule.debug === 'function' &&
      typeof loggerModule.info === 'function' &&
      typeof loggerModule.warn === 'function' &&
      typeof loggerModule.error === 'function'
    ) {
      return loggerModule;
    }

    return createFallbackLogger();
  }

  const logger = createScopedLogger();

  const APP = constants.APP || Object.create(null);
  const MESSAGING = constants.MESSAGING || Object.create(null);
  const WORKFLOW = constants.WORKFLOW || Object.create(null);
  const ERROR_CODES = constants.ERROR_CODES || Object.create(null);
  const DEFAULTS = constants.DEFAULTS || Object.create(null);
  const PROVIDERS = constants.PROVIDERS || Object.create(null);
  const DEFAULT_PROVIDER_BY_ROLE = constants.DEFAULT_PROVIDER_BY_ROLE || Object.create(null);
  const MANUAL_HUB = constants.MANUAL_HUB || Object.create(null);
  const PARSER = constants.PARSER || Object.create(null);
  const CONSTANT_HELPERS = constants.helpers || Object.create(null);
  const protocolHelpers = protocol.helpers || Object.create(null);

  const MESSAGE_TYPES = MESSAGING.TYPES || Object.create(null);
  const PACKET_TYPES = MANUAL_HUB.PACKET_TYPES || protocol.packetTypes || Object.create(null);

  const WORKFLOW_ROLES = WORKFLOW.ROLES || Object.create(null);
  const WORKFLOW_STAGES = WORKFLOW.STAGES || Object.create(null);
  const WORKFLOW_STATUSES = WORKFLOW.STATUSES || Object.create(null);
  const HUMAN_ACTIONS = WORKFLOW.HUMAN_ACTIONS || Object.create(null);
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

  const HUMAN_ACTION_COPY_PROMPT = normalizeLowerString(HUMAN_ACTIONS.COPY_PROMPT || 'copy_prompt');
  const HUMAN_ACTION_PASTE_RESPONSE = normalizeLowerString(HUMAN_ACTIONS.PASTE_RESPONSE || 'paste_response');
  const HUMAN_ACTION_CONFIRM_TRANSITION = normalizeLowerString(HUMAN_ACTIONS.CONFIRM_TRANSITION || 'confirm_transition');
  const HUMAN_ACTION_CREATE_COMMIT = normalizeLowerString(HUMAN_ACTIONS.CREATE_COMMIT || 'create_commit');
  const HUMAN_ACTION_CREATE_PULL_REQUEST = normalizeLowerString(HUMAN_ACTIONS.CREATE_PULL_REQUEST || 'create_pull_request');

  const REVIEW_APPROVE = normalizeUpperString(REVIEW_VERDICTS.APPROVE || 'APPROVE');
  const REVIEW_REJECT = normalizeUpperString(REVIEW_VERDICTS.REJECT || 'REJECT');

  const DEFAULT_PROTOCOL_VERSION = normalizeString(APP.protocolVersion) || '1.0.0';
  const DEFAULT_BASE_BRANCH =
    normalizeString(constants.REPOSITORY && constants.REPOSITORY.DEFAULT_BASE_BRANCH) || 'main';
  const DEFAULT_WORKING_BRANCH_PREFIX =
    normalizeString(constants.REPOSITORY && constants.REPOSITORY.WORKING_BRANCH_PREFIX) || 'maoe/issue-';
  const DEFAULT_TREE_SORT = 'path';
  const DEFAULT_EVENT_LOG_LEVEL = 'info';
  const DEFAULT_BODY_PREVIEW_LENGTH = 240;
  const FILE_ROOT_TAG = normalizeString(PARSER.XML && PARSER.XML.FILE_ROOT_TAG) || 'File';
  const REVIEW_ROOT_TAG = normalizeString(PARSER.XML && PARSER.XML.REVIEW_ROOT_TAG) || 'Review';

  const DEFAULT_PROVIDER_IDS = deepFreeze((function buildDefaultProviderIds() {
    const output = Object.create(null);

    output[ROLE_DESIGNER] = normalizeLowerString(
      DEFAULT_PROVIDER_BY_ROLE[ROLE_DESIGNER] ||
      (DEFAULTS.settings && DEFAULTS.settings.agents && DEFAULTS.settings.agents.designerProviderId) ||
      ''
    );

    output[ROLE_EXECUTOR] = normalizeLowerString(
      DEFAULT_PROVIDER_BY_ROLE[ROLE_EXECUTOR] ||
      (DEFAULTS.settings && DEFAULTS.settings.agents && DEFAULTS.settings.agents.executorProviderId) ||
      ''
    );

    output[ROLE_AUDITOR] = normalizeLowerString(
      DEFAULT_PROVIDER_BY_ROLE[ROLE_AUDITOR] ||
      (DEFAULTS.settings && DEFAULTS.settings.agents && DEFAULTS.settings.agents.auditorProviderId) ||
      ''
    );

    return output;
  }()));

  const ORCHESTRATOR_EVENT_TYPES = deepFreeze({
    ISSUES_LOADED: 'issues_loaded',
    TREE_LOADED: 'tree_loaded',
    ARTIFACT_BUILT: 'artifact_built',
    PAYLOAD_PARSED: 'payload_parsed',
    PAYLOAD_REJECTED: 'payload_rejected',
    PULL_REQUEST_PREPARED: 'pull_request_prepared',
    PULL_REQUEST_CREATED: 'pull_request_created'
  });

  const runtimeState = root.ensureState('orchestrator_runtime', function createRuntimeState() {
    return {
      issueCache: Object.create(null),
      treeCache: Object.create(null),
      stageArtifact: null,
      lastSubmission: null,
      initializedAt: ''
    };
  });

  const PROVIDER_IDS = Object.keys(PROVIDERS);

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

  function createOrchestratorError(code, message, details) {
    const error = new Error(normalizeString(message) || 'Orchestrator error.');
    error.name = 'MAOEOrchestratorError';
    error.code = normalizeString(code) || (ERROR_CODES.UNKNOWN_ERROR || 'UNKNOWN_ERROR');
    error.details = isPlainObject(details) ? cloneValue(details) : createNullObject();
    error.isOrchestratorError = true;
    return error;
  }

  function isOrchestratorError(error) {
    return !!(error && typeof error === 'object' && error.isOrchestratorError === true);
  }

  function normalizeOrchestratorError(error, fallbackMessage, extraDetails) {
    if (isOrchestratorError(error)) {
      return error;
    }

    return createOrchestratorError(
      normalizeString(error && error.code) || (ERROR_CODES.UNKNOWN_ERROR || 'UNKNOWN_ERROR'),
      normalizeString(error && error.message) || normalizeString(fallbackMessage) || 'Orchestrator error.',
      mergePlainObjects(
        stableObject(error && error.details),
        stableObject(extraDetails)
      )
    );
  }

  function createRequestId(prefix) {
    if (protocolHelpers && typeof protocolHelpers.generateRequestId === 'function') {
      try {
        return protocolHelpers.generateRequestId(prefix || 'orch');
      } catch (error) {
      }
    }

    const normalizedPrefix = normalizeLowerString(prefix) || 'orch';
    return normalizedPrefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
  }

  function chooseFenceMarker(text) {
    const source = coerceText(text);
    const matches = source.match(/`{3,}/g) || [];
    let length = 3;

    for (const match of matches) {
      if (match.length >= length) {
        length = match.length + 1;
      }
    }

    return '`'.repeat(length);
  }

  function buildFencedBlock(language, text) {
    const body = coerceText(text);
    const marker = chooseFenceMarker(body);
    const normalizedLanguage = normalizeString(language);
    const header = normalizedLanguage ? marker + normalizedLanguage : marker;
    return header + '\n' + body + '\n' + marker;
  }

  function buildIndentedList(items) {
    const source = Array.isArray(items) ? items : [];

    if (source.length === 0) {
      return '';
    }

    return source.map(function mapItem(item, index) {
      return String(index + 1) + '. ' + coerceText(item);
    }).join('\n');
  }

  function freezeClone(value) {
    return deepFreeze(cloneValue(value));
  }

  function ensureRuntimeCollections() {
    if (!isPlainObject(runtimeState.issueCache)) {
      runtimeState.issueCache = Object.create(null);
    }

    if (!isPlainObject(runtimeState.treeCache)) {
      runtimeState.treeCache = Object.create(null);
    }

    if (!normalizeString(runtimeState.initializedAt)) {
      runtimeState.initializedAt = nowIsoString();
    }

    return runtimeState;
  }

  function setStageArtifact(artifact) {
    runtimeState.stageArtifact = cloneValue(artifact);
    return freezeClone(artifact);
  }

  function getCachedStageArtifact() {
    return runtimeState.stageArtifact ? freezeClone(runtimeState.stageArtifact) : null;
  }

  function setLastSubmission(submission) {
    runtimeState.lastSubmission = cloneValue(submission);
    return freezeClone(submission);
  }

  function getLastSubmission() {
    return runtimeState.lastSubmission ? freezeClone(runtimeState.lastSubmission) : null;
  }

  function getProviderById(providerId) {
    const normalized = normalizeLowerString(providerId);

    if (!normalized) {
      return null;
    }

    if (CONSTANT_HELPERS && typeof CONSTANT_HELPERS.getProviderById === 'function') {
      try {
        const provider = CONSTANT_HELPERS.getProviderById(normalized);

        if (provider) {
          return provider;
        }
      } catch (error) {
      }
    }

    return hasOwn(PROVIDERS, normalized) ? PROVIDERS[normalized] : null;
  }

  function getProviderLabel(providerId, fallbackLabel) {
    const provider = getProviderById(providerId);

    if (provider && normalizeString(provider.displayName)) {
      return normalizeString(provider.displayName);
    }

    return normalizeString(fallbackLabel) || normalizeString(providerId) || 'AI';
  }

  function getDefaultProviderIdForRole(role) {
    const normalizedRole = normalizeLowerString(role);

    if (hasOwn(DEFAULT_PROVIDER_IDS, normalizedRole) && normalizeString(DEFAULT_PROVIDER_IDS[normalizedRole])) {
      return normalizeString(DEFAULT_PROVIDER_IDS[normalizedRole]);
    }

    return PROVIDER_IDS.length > 0 ? PROVIDER_IDS[0] : '';
  }

  function buildRepositoryDescriptor(repositoryLike) {
    if (stateStore.helpers && typeof stateStore.helpers.buildRepositoryDescriptor === 'function') {
      try {
        return stateStore.helpers.buildRepositoryDescriptor(repositoryLike);
      } catch (error) {
      }
    }

    if (githubRepoService.helpers && typeof githubRepoService.helpers.buildRepositoryDescriptor === 'function') {
      try {
        return githubRepoService.helpers.buildRepositoryDescriptor(repositoryLike);
      } catch (error) {
      }
    }

    return buildFallbackRepositoryDescriptor(repositoryLike);
  }

  function buildFallbackRepositoryDescriptor(repositoryLike) {
    const source = isPlainObject(repositoryLike) ? repositoryLike : createNullObject();
    const owner = normalizeString(source.owner);
    const repo = normalizeString(source.repo);
    const fullName = owner && repo ? owner + '/' + repo : '';
    const htmlUrl = fullName ? 'https://github.com/' + encodeURIComponent(owner) + '/' + encodeURIComponent(repo) : '';
    const apiUrl = fullName ? 'https://api.github.com/repos/' + encodeURIComponent(owner) + '/' + encodeURIComponent(repo) : '';

    return deepFreeze({
      owner: owner,
      repo: repo,
      fullName: fullName,
      htmlUrl: htmlUrl,
      apiUrl: apiUrl,
      baseBranch: normalizeString(source.baseBranch) || normalizeString(source.defaultBranch) || DEFAULT_BASE_BRANCH,
      defaultBranch: normalizeString(source.defaultBranch),
      workingBranchPrefix: normalizeString(source.workingBranchPrefix) || DEFAULT_WORKING_BRANCH_PREFIX
    });
  }

  function normalizeIssueInput(issue, options) {
    if (githubIssueService && typeof githubIssueService.normalizeIssueInput === 'function') {
      try {
        return githubIssueService.normalizeIssueInput(issue, options);
      } catch (error) {
      }
    }

    const source = isPlainObject(issue) ? issue : createNullObject();
    const repository = buildRepositoryDescriptor(options && options.repository);
    const body = coerceText(source.body);

    return deepFreeze({
      number: normalizeIntegerOrNull(source.number),
      key: normalizeIntegerOrNull(source.number) === null ? '' : '#' + String(normalizeIntegerOrNull(source.number)),
      title: normalizeString(source.title),
      body: body,
      bodyPreview: body.slice(0, DEFAULT_BODY_PREVIEW_LENGTH),
      state: normalizeLowerString(source.state),
      kind: 'issue',
      isPullRequest: false,
      labelNames: uniqueStrings(source.labelNames || source.labels),
      assigneeLogins: uniqueStrings(source.assigneeLogins),
      htmlUrl: normalizeString(source.url || source.htmlUrl || source.html_url),
      apiUrl: normalizeString(source.apiUrl || source.url),
      updatedAt: normalizeString(source.updatedAt),
      repository: repository,
      summary: {
        key: normalizeIntegerOrNull(source.number) === null ? '' : '#' + String(normalizeIntegerOrNull(source.number)),
        title: normalizeString(source.title),
        state: normalizeLowerString(source.state),
        kind: 'issue',
        bodyPreview: body.slice(0, DEFAULT_BODY_PREVIEW_LENGTH),
        url: normalizeString(source.url || source.htmlUrl || source.html_url),
        updatedAt: normalizeString(source.updatedAt),
        labels: uniqueStrings(source.labelNames || source.labels)
      }
    });
  }

  function normalizeWorkflowStateFromAny(value) {
    if (stateStore.helpers && typeof stateStore.helpers.normalizeWorkflowStateFromAny === 'function') {
      try {
        return stateStore.helpers.normalizeWorkflowStateFromAny(value);
      } catch (error) {
      }
    }

    if (protocol && typeof protocol.normalizeWorkflowState === 'function') {
      try {
        return protocol.normalizeWorkflowState(value);
      } catch (error) {
      }
    }

    return cloneValue(value || DEFAULTS.workflow || createNullObject());
  }

  function normalizeSelectedProviderIds(value) {
    if (stateStore.helpers && typeof stateStore.helpers.normalizeSelectedProviderIds === 'function') {
      try {
        return stateStore.helpers.normalizeSelectedProviderIds(value);
      } catch (error) {
      }
    }

    const output = createNullObject();
    output[ROLE_DESIGNER] = normalizeLowerString(value && value[ROLE_DESIGNER]) || getDefaultProviderIdForRole(ROLE_DESIGNER);
    output[ROLE_EXECUTOR] = normalizeLowerString(value && value[ROLE_EXECUTOR]) || getDefaultProviderIdForRole(ROLE_EXECUTOR);
    output[ROLE_AUDITOR] = normalizeLowerString(value && value[ROLE_AUDITOR]) || getDefaultProviderIdForRole(ROLE_AUDITOR);
    return output;
  }

  function resolveProviderForRole(role, selectedProviderIds) {
    if (stateStore.helpers && typeof stateStore.helpers.resolveProviderForRole === 'function') {
      try {
        return stateStore.helpers.resolveProviderForRole(role, selectedProviderIds);
      } catch (error) {
      }
    }

    const normalizedRole = normalizeLowerString(role);
    const normalizedSelections = normalizeSelectedProviderIds(selectedProviderIds);
    return normalizedSelections[normalizedRole] || getDefaultProviderIdForRole(normalizedRole);
  }

  function inferRoleFromStage(stage) {
    if (stateStore.helpers && typeof stateStore.helpers.inferRoleFromStage === 'function') {
      try {
        return stateStore.helpers.inferRoleFromStage(stage);
      } catch (error) {
      }
    }

    const normalizedStage = normalizeLowerString(stage);

    if (normalizedStage === STAGE_DESIGN) {
      return ROLE_DESIGNER;
    }

    if (normalizedStage === STAGE_EXECUTION) {
      return ROLE_EXECUTOR;
    }

    if (normalizedStage === STAGE_AUDIT) {
      return ROLE_AUDITOR;
    }

    return '';
  }

  function nextStageAfter(stage) {
    if (stateStore.helpers && typeof stateStore.helpers.nextStageAfter === 'function') {
      try {
        return stateStore.helpers.nextStageAfter(stage);
      } catch (error) {
      }
    }

    if (normalizeLowerString(stage) === STAGE_IDLE) {
      return STAGE_DESIGN;
    }

    if (normalizeLowerString(stage) === STAGE_DESIGN) {
      return STAGE_EXECUTION;
    }

    if (normalizeLowerString(stage) === STAGE_EXECUTION) {
      return STAGE_AUDIT;
    }

    if (normalizeLowerString(stage) === STAGE_AUDIT) {
      return STAGE_PR;
    }

    if (normalizeLowerString(stage) === STAGE_PR) {
      return STAGE_COMPLETED;
    }

    if (normalizeLowerString(stage) === STAGE_COMPLETED) {
      return STAGE_IDLE;
    }

    if (normalizeLowerString(stage) === STAGE_ERROR) {
      return STAGE_IDLE;
    }

    return '';
  }

  function normalizeTaskFilePath(value, options) {
    const config = isPlainObject(options) ? options : createNullObject();

    if (stateStore.helpers && typeof stateStore.helpers.normalizeTaskFilePath === 'function') {
      try {
        const normalized = stateStore.helpers.normalizeTaskFilePath(value);

        if (!normalized && normalizeBoolean(config.allowEmpty, false)) {
          return '';
        }

        return normalized;
      } catch (error) {
        if (normalizeBoolean(config.allowEmpty, false) && !normalizeString(value)) {
          return '';
        }

        throw error;
      }
    }

    let source = coerceText(value).trim();

    if (!source) {
      if (normalizeBoolean(config.allowEmpty, false)) {
        return '';
      }

      throw createOrchestratorError(
        ERROR_CODES.INVALID_ARGUMENT || 'INVALID_ARGUMENT',
        'Task file path is required.',
        {
          path: value
        }
      );
    }

    source = source.replace(/\\/g, '/').replace(/\/+/g, '/');

    while (source.indexOf('./') === 0) {
      source = source.slice(2);
    }

    source = source.replace(/^\/+/, '');

    if (!source || /[\u0000-\u001F\u007F]/.test(source)) {
      throw createOrchestratorError(
        ERROR_CODES.INVALID_ARGUMENT || 'INVALID_ARGUMENT',
        'Task file path is invalid.',
        {
          path: value,
          normalizedPath: source
        }
      );
    }

    return source;
  }

  function normalizeGitRef(value, fieldName, options) {
    const config = isPlainObject(options) ? options : createNullObject();

    if (stateStore.helpers && typeof stateStore.helpers.normalizeGitRefLike === 'function') {
      try {
        return stateStore.helpers.normalizeGitRefLike(value, fieldName, options);
      } catch (error) {
        if (normalizeBoolean(config.allowEmpty, false) && !normalizeString(value)) {
          return '';
        }

        throw error;
      }
    }

    const source = normalizeString(value);
    const label = normalizeString(fieldName) || 'gitRef';

    if (!source) {
      if (normalizeBoolean(config.allowEmpty, false)) {
        return '';
      }

      throw createOrchestratorError(
        ERROR_CODES.INVALID_ARGUMENT || 'INVALID_ARGUMENT',
        label + ' is required.',
        {
          field: label
        }
      );
    }

    if (
      /[\u0000-\u0020\u007F]/.test(source) ||
      source.indexOf('..') >= 0 ||
      source.indexOf('//') >= 0 ||
      source.indexOf('@{') >= 0 ||
      /[~^:?*\[\]\\]/.test(source) ||
      source.charAt(0) === '/' ||
      source.charAt(source.length - 1) === '/' ||
      source.charAt(0) === '.' ||
      source.charAt(source.length - 1) === '.' ||
      source.slice(-5) === '.lock' ||
      source.indexOf('/.') >= 0 ||
      source.indexOf('.lock/') >= 0
    ) {
      throw createOrchestratorError(
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

  function normalizeReviewDecision(review) {
    if (stateStore.helpers && typeof stateStore.helpers.normalizeReviewDecisionInput === 'function') {
      try {
        return stateStore.helpers.normalizeReviewDecisionInput(review);
      } catch (error) {
      }
    }

    if (protocol && typeof protocol.createReviewDecision === 'function') {
      try {
        return protocol.createReviewDecision(review);
      } catch (error) {
      }
    }

    const source = isPlainObject(review) ? review : createNullObject();

    return deepFreeze({
      verdict: oneOf(normalizeUpperString(source.verdict), [REVIEW_APPROVE, REVIEW_REJECT], ''),
      summary: normalizeMultilineText(source.summary),
      findings: stableArray(source.findings),
      at: normalizeString(source.at) || nowIsoString()
    });
  }

  function normalizeLastParsedPayloadRecord(rawResponse, parsedPayload, options) {
    if (stateStore.helpers && typeof stateStore.helpers.normalizeLastParsedPayloadRecord === 'function') {
      try {
        return stateStore.helpers.normalizeLastParsedPayloadRecord(rawResponse, parsedPayload, options);
      } catch (error) {
      }
    }

    const sourceOptions = isPlainObject(options) ? options : createNullObject();

    return deepFreeze({
      parsedAt: nowIsoString(),
      source: normalizeString(sourceOptions.source),
      kind: normalizeString(parsedPayload && parsedPayload.kind) || 'unknown',
      rawText: coerceText(rawResponse),
      parsed: cloneValue(isPlainObject(parsedPayload) ? parsedPayload : null),
      errors: []
    });
  }

  function buildSuggestedWorkingBranch(issue, repository, options) {
    if (stateStore.helpers && typeof stateStore.helpers.buildSuggestedWorkingBranch === 'function') {
      try {
        return stateStore.helpers.buildSuggestedWorkingBranch(issue, repository, options);
      } catch (error) {
      }
    }

    if (githubPrService.helpers && typeof githubPrService.helpers.buildSuggestedHeadBranch === 'function') {
      try {
        return githubPrService.helpers.buildSuggestedHeadBranch(
          issue,
          (options && options.workingBranchPrefix) ||
            (repository && repository.workingBranchPrefix) ||
            DEFAULT_WORKING_BRANCH_PREFIX
        );
      } catch (error) {
      }
    }

    const normalizedIssue = normalizeIssueRef(issue);
    const prefix =
      normalizeString((options && options.workingBranchPrefix) || (repository && repository.workingBranchPrefix)) ||
      DEFAULT_WORKING_BRANCH_PREFIX;
    const titleSegment = slugify(normalizedIssue.title || 'task');
    const issueSegment = normalizedIssue.number === null ? 'task' : String(normalizedIssue.number);
    return normalizeGitRef(prefix + issueSegment + '-' + titleSegment, 'workingBranch');
  }

  function normalizeIssueRef(value) {
    if (stateStore.helpers && typeof stateStore.helpers.normalizeIssueRef === 'function') {
      try {
        return stateStore.helpers.normalizeIssueRef(value);
      } catch (error) {
      }
    }

    const source = isPlainObject(value) ? value : createNullObject();

    return deepFreeze({
      number: normalizeIntegerOrNull(source.number),
      title: normalizeString(source.title),
      body: coerceText(source.body),
      url: normalizeString(source.url || source.htmlUrl || source.html_url),
      state: normalizeLowerString(source.state),
      labels: uniqueStrings(source.labels || source.labelNames)
    });
  }

  function normalizePullRequestRef(value) {
    if (stateStore.helpers && typeof stateStore.helpers.normalizePullRequestRef === 'function') {
      try {
        return stateStore.helpers.normalizePullRequestRef(value);
      } catch (error) {
      }
    }

    const source = isPlainObject(value) ? value : createNullObject();

    return deepFreeze({
      number: normalizeIntegerOrNull(source.number),
      title: normalizeString(source.title),
      body: coerceText(source.body),
      url: normalizeString(source.url || source.htmlUrl || source.html_url),
      state: normalizeLowerString(source.state),
      draft: normalizeBoolean(source.draft, false),
      merged: normalizeBoolean(source.merged, false),
      headRef: normalizeString(source.headRef || source.headBranch),
      baseRef: normalizeString(source.baseRef || source.baseBranch),
      repositoryFullName: normalizeString(source.repositoryFullName)
    });
  }

  function buildIssueCacheBucket(repository) {
    const normalizedRepository = buildRepositoryDescriptor(repository);
    const key = normalizeString(normalizedRepository.fullName);

    if (!key) {
      return null;
    }

    ensureRuntimeCollections();

    if (!isPlainObject(runtimeState.issueCache[key])) {
      runtimeState.issueCache[key] = {
        listsByQuery: Object.create(null),
        itemsByNumber: Object.create(null),
        lastListKey: '',
        lastList: null,
        loadedAt: ''
      };
    }

    return runtimeState.issueCache[key];
  }

  function buildIssueListCacheKey(repository, querySnapshot) {
    return normalizeString(buildRepositoryDescriptor(repository).fullName) + '|' + serializeComparable(querySnapshot || createNullObject());
  }

  function buildTreeCacheKey(repository, options) {
    const normalizedRepository = buildRepositoryDescriptor(repository);
    const source = isPlainObject(options) ? options : createNullObject();

    return [
      normalizedRepository.fullName,
      normalizeString(source.branch || source.branchName || normalizedRepository.baseBranch || normalizedRepository.defaultBranch),
      normalizeTaskFilePath(source.pathPrefix || source.prefix || '', { allowEmpty: true }),
      normalizeBoolean(source.recursive, true) ? 'recursive' : 'non_recursive',
      normalizeBoolean(source.includeDirectories, true) ? 'dir1' : 'dir0',
      normalizeBoolean(source.includeFiles, true) ? 'file1' : 'file0',
      normalizeBoolean(source.includeSubmodules, true) ? 'sub1' : 'sub0',
      normalizeString(source.sort || DEFAULT_TREE_SORT),
      String(normalizePositiveInteger(source.maxEntries, 5000)),
      String(normalizePositiveInteger(source.maxDepth, 32))
    ].join('|');
  }

  function cacheIssueItem(issue, repository) {
    const normalizedIssue = normalizeIssueInput(issue, {
      repository: repository
    });

    const bucket = buildIssueCacheBucket(normalizedIssue.repository);

    if (!bucket || normalizedIssue.number === null) {
      return normalizedIssue;
    }

    bucket.itemsByNumber[String(normalizedIssue.number)] = cloneValue(normalizedIssue);
    bucket.loadedAt = nowIsoString();
    return normalizedIssue;
  }

  function cacheIssueList(envelope) {
    const source = isPlainObject(envelope) ? envelope : createNullObject();
    const repository = buildRepositoryDescriptor(source.repository);
    const bucket = buildIssueCacheBucket(repository);

    if (!bucket) {
      return;
    }

    const queryKey = buildIssueListCacheKey(repository, source.query);
    bucket.lastListKey = queryKey;
    bucket.lastList = cloneValue(source);
    bucket.loadedAt = nowIsoString();
    bucket.listsByQuery[queryKey] = {
      loadedAt: bucket.loadedAt,
      envelope: cloneValue(source)
    };

    const items = Array.isArray(source.items) ? source.items : [];

    for (const item of items) {
      cacheIssueItem(item, repository);
    }
  }

  function findCachedIssue(repository, issueNumber) {
    const normalizedIssueNumber = normalizeIntegerOrNull(issueNumber);

    if (normalizedIssueNumber === null) {
      return null;
    }

    const bucket = buildIssueCacheBucket(repository);

    if (!bucket) {
      return null;
    }

    const key = String(normalizedIssueNumber);
    return hasOwn(bucket.itemsByNumber, key) ? freezeClone(bucket.itemsByNumber[key]) : null;
  }

  function findCachedIssueList(repository, querySnapshot) {
    const bucket = buildIssueCacheBucket(repository);

    if (!bucket) {
      return null;
    }

    const queryKey = buildIssueListCacheKey(repository, querySnapshot);

    if (hasOwn(bucket.listsByQuery, queryKey)) {
      return freezeClone(bucket.listsByQuery[queryKey].envelope);
    }

    return bucket.lastList ? freezeClone(bucket.lastList) : null;
  }

  function cacheTree(envelope, requestOptions) {
    const source = isPlainObject(envelope) ? envelope : createNullObject();
    const repository = buildRepositoryDescriptor(source.repository);
    const key = buildTreeCacheKey(
      repository,
      isPlainObject(requestOptions)
        ? requestOptions
        : {
            branch: source.branch && source.branch.name,
            pathPrefix: source.pathPrefix,
            recursive: source.recursive,
            includeDirectories: true,
            includeFiles: true,
            includeSubmodules: true,
            sort: source.sort,
            maxEntries: (constants.REPOSITORY && constants.REPOSITORY.MAX_REPO_TREE_ENTRIES) || 5000,
            maxDepth: (constants.REPOSITORY && constants.REPOSITORY.MAX_TREE_DEPTH) || 32
          }
    );

    ensureRuntimeCollections();
    runtimeState.treeCache[key] = {
      loadedAt: nowIsoString(),
      envelope: cloneValue(source)
    };
  }

  function findCachedTree(repository, options) {
    const key = buildTreeCacheKey(repository, options);
    ensureRuntimeCollections();

    if (!hasOwn(runtimeState.treeCache, key)) {
      return null;
    }

    return freezeClone(runtimeState.treeCache[key].envelope);
  }

  async function appendEventLog(message, code, context, level) {
    try {
      await stateStore.appendEventLog({
        level: normalizeString(level) || DEFAULT_EVENT_LOG_LEVEL,
        code: normalizeString(code),
        message: collapseInlineWhitespace(message),
        context: stableObject(context)
      });
    } catch (error) {
      logger.debug('Failed to append orchestrator event log entry.', {
        message: error && error.message ? error.message : String(error),
        code: normalizeString(code)
      });
    }
  }

  async function ensureInitialized(options) {
    ensureRuntimeCollections();

    if (typeof stateStore.ensureInitialized === 'function') {
      return stateStore.ensureInitialized(options);
    }

    if (typeof stateStore.initialize === 'function') {
      return stateStore.initialize(options);
    }

    return typeof stateStore.getBootstrapState === 'function'
      ? stateStore.getBootstrapState(options)
      : createNullObject();
  }

  async function getBootstrapState(options) {
    await ensureInitialized(options);

    if (typeof stateStore.getBootstrapState === 'function') {
      return stateStore.getBootstrapState(options);
    }

    return createNullObject();
  }

  async function getWorkflowState(options) {
    const bootstrap = await getBootstrapState(options);
    return freezeClone(normalizeWorkflowStateFromAny(bootstrap.workflow));
  }

  async function getEventLog(options) {
    const bootstrap = await getBootstrapState(options);
    return Array.isArray(bootstrap.eventLog) ? freezeClone(bootstrap.eventLog) : [];
  }

  function getSelectedProvidersFromWorkflow(workflow) {
    const normalizedWorkflow = normalizeWorkflowStateFromAny(workflow);
    return freezeClone(normalizeSelectedProviderIds(normalizedWorkflow.selectedProviderIds));
  }

  function resolveActiveProviderForStage(stage, workflow, options) {
    const source = isPlainObject(options) ? options : createNullObject();

    if (normalizeString(source.providerId)) {
      return normalizeLowerString(source.providerId);
    }

    const normalizedWorkflow = normalizeWorkflowStateFromAny(workflow);

    if (normalizeString(source.activeProviderId)) {
      return normalizeLowerString(source.activeProviderId);
    }

    if (
      normalizedWorkflow.activeProviderId &&
      (!normalizeString(source.role) || inferRoleFromStage(stage) === normalizeLowerString(source.role))
    ) {
      return normalizedWorkflow.activeProviderId;
    }

    const role = normalizeLowerString(source.role) || inferRoleFromStage(stage);
    return resolveProviderForRole(role, normalizedWorkflow.selectedProviderIds);
  }

  function resolveRepositoryFromBootstrap(bootstrap, options) {
    const source = isPlainObject(options) ? options : createNullObject();
    const repository = buildRepositoryDescriptor(
      mergePlainObjects(
        stableObject(source.repository),
        stableObject(bootstrap.repository),
        isPlainObject(bootstrap.settings) && isPlainObject(bootstrap.settings.repository)
          ? bootstrap.settings.repository
          : createNullObject()
      )
    );

    if (!repository.owner || !repository.repo) {
      throw createOrchestratorError(
        ERROR_CODES.INVALID_ARGUMENT || 'INVALID_ARGUMENT',
        'Repository owner/repo is not configured.',
        {
          repository: cloneValue(repository)
        }
      );
    }

    return repository;
  }

  async function resolveIssueForContext(bootstrap, repository, options) {
    const source = isPlainObject(options) ? options : createNullObject();
    const workflow = normalizeWorkflowStateFromAny(bootstrap.workflow);
    const directIssue = isPlainObject(source.issue) ? source.issue : createNullObject();

    if (Object.keys(directIssue).length > 0) {
      return normalizeIssueInput(directIssue, {
        repository: repository
      });
    }

    const issueNumber = normalizeIntegerOrNull(
      source.issueNumber ||
        source.number ||
        source.currentIssueNumber ||
        workflow.currentIssueNumber
    );

    if (issueNumber !== null) {
      const cached = findCachedIssue(repository, issueNumber);

      if (cached) {
        return cached;
      }

      const fetchIfMissing = normalizeBoolean(
        hasOwn(source, 'fetchIssueIfMissing') ? source.fetchIssueIfMissing : true,
        true
      );

      if (fetchIfMissing && typeof githubIssueService.getIssueOrNull === 'function') {
        const fetched = await githubIssueService.getIssueOrNull({
          repository: repository,
          issueNumber: issueNumber,
          includePullRequests: normalizeBoolean(source.includePullRequests, false)
        });

        if (fetched) {
          return cacheIssueItem(fetched, repository);
        }
      }
    }

    const fallbackIssue = normalizeIssueInput(
      {
        number: workflow.currentIssueNumber,
        title: workflow.currentIssueTitle,
        body: '',
        url: workflow.currentIssueUrl,
        state: 'open',
        labels: []
      },
      {
        repository: repository
      }
    );

    if (fallbackIssue.number !== null || fallbackIssue.title || fallbackIssue.htmlUrl) {
      return fallbackIssue;
    }

    if (normalizeBoolean(source.allowEmptyIssue, false)) {
      return null;
    }

    throw createOrchestratorError(
      ERROR_CODES.INVALID_STATE || 'INVALID_STATE',
      'No issue is selected.',
      {
        repository: cloneValue(repository)
      }
    );
  }

  function resolveTargetFile(workflow, options) {
    const source = isPlainObject(options) ? options : createNullObject();
    const normalizedWorkflow = normalizeWorkflowStateFromAny(workflow);
    const candidate =
      source.targetFile ||
      source.filePath ||
      source.path ||
      source.currentTaskFilePath ||
      normalizedWorkflow.currentTaskFilePath ||
      '';

    return normalizeTaskFilePath(candidate, {
      allowEmpty: normalizeBoolean(source.allowEmptyTargetFile, false)
    });
  }

  function resolveWorkingBranch(workflow, issue, repository, options) {
    const source = isPlainObject(options) ? options : createNullObject();
    const normalizedWorkflow = normalizeWorkflowStateFromAny(workflow);
    const explicit = normalizeString(
      source.workingBranch ||
        source.headBranch ||
        source.branch ||
        source.headRef ||
        normalizedWorkflow.workingBranch
    );

    if (explicit) {
      return normalizeGitRef(explicit, 'workingBranch', {
        allowEmpty: false
      });
    }

    return buildSuggestedWorkingBranch(issue, repository, {
      workingBranchPrefix: source.workingBranchPrefix || repository.workingBranchPrefix || DEFAULT_WORKING_BRANCH_PREFIX
    });
  }

  function buildDashboardResponse(bootstrap, artifact) {
    return deepFreeze({
      bootstrap: cloneValue(bootstrap),
      workflow: cloneValue(bootstrap.workflow || createNullObject()),
      stageArtifact: artifact ? cloneValue(artifact) : null,
      lastEvent: typeof stateStore.getLastEvent === 'function'
        ? cloneValue(stateStore.getLastEvent())
        : null,
      cachedStageArtifact: getCachedStageArtifact(),
      lastSubmission: getLastSubmission()
    });
  }

  async function getDashboardState(options) {
    const bootstrap = await getBootstrapState(options);
    const source = isPlainObject(options) ? options : createNullObject();
    const artifact = normalizeBoolean(hasOwn(source, 'includeStageArtifact') ? source.includeStageArtifact : true, true)
      ? await buildCurrentStageArtifact(source)
      : null;

    return buildDashboardResponse(bootstrap, artifact);
  }

  function normalizeIssueListQuerySnapshot(query) {
    const source = isPlainObject(query) ? query : createNullObject();

    if (githubIssueService.helpers && typeof githubIssueService.helpers.normalizeQuerySnapshot === 'function') {
      try {
        return githubIssueService.helpers.normalizeQuerySnapshot(source);
      } catch (error) {
      }
    }

    return deepFreeze({
      state: normalizeLowerString(source.state || (constants.REPOSITORY && constants.REPOSITORY.DEFAULT_ISSUE_STATE) || 'open'),
      sort: normalizeLowerString(source.sort || (constants.REPOSITORY && constants.REPOSITORY.DEFAULT_ISSUE_SORT) || 'updated'),
      direction: normalizeLowerString(source.direction || (constants.REPOSITORY && constants.REPOSITORY.DEFAULT_ISSUE_DIRECTION) || 'desc'),
      page: normalizePositiveInteger(source.page, 1),
      perPage: normalizePositiveInteger(
        source.perPage || source.per_page,
        (constants.GITHUB && constants.GITHUB.PAGINATION && constants.GITHUB.PAGINATION.DEFAULT_PER_PAGE) || 50
      ),
      labels: Array.isArray(source.labels)
        ? cloneValue(source.labels)
        : (typeof source.labels === 'string'
            ? source.labels.split(',').map(function mapLabel(value) {
                return normalizeString(value);
              }).filter(Boolean)
            : []),
      labelMode: normalizeLowerString(source.labelMode || 'all'),
      textQuery: normalizeString(source.textQuery),
      issueNumbers: Array.isArray(source.issueNumbers) ? cloneValue(source.issueNumbers) : [],
      includePullRequests: normalizeBoolean(source.includePullRequests, false),
      autoPaginate: normalizeBoolean(source.autoPaginate, false),
      pageLimit: normalizePositiveInteger(source.pageLimit, 1),
      maxItems: normalizePositiveInteger(
        source.maxItems,
        (constants.GITHUB && constants.GITHUB.PAGINATION && constants.GITHUB.PAGINATION.DEFAULT_PER_PAGE) || 50
      )
    });
  }

  async function loadIssues(options) {
    await ensureInitialized();

    const bootstrap = await getBootstrapState();
    const source = isPlainObject(options) ? options : createNullObject();
    const repository = resolveRepositoryFromBootstrap(bootstrap, source);
    const querySnapshot = normalizeIssueListQuerySnapshot({
      state: source.state || source.issueState,
      sort: source.sort,
      direction: source.direction,
      page: source.page,
      perPage: source.perPage || source.per_page,
      labels: source.labels,
      labelMode: source.labelMode,
      textQuery: source.textQuery || source.search || source.q,
      issueNumbers: source.issueNumbers || source.numbers,
      includePullRequests: source.includePullRequests,
      autoPaginate: source.autoPaginate,
      pageLimit: source.pageLimit,
      maxItems: source.maxItems
    });

    if (!normalizeBoolean(source.refreshIssues, false)) {
      const cached = findCachedIssueList(repository, querySnapshot);

      if (cached && normalizeBoolean(source.useCache, true)) {
        return cached;
      }
    }

    const envelope = await githubIssueService.listIssues(
      mergePlainObjects(source, {
        repository: repository
      })
    );

    cacheIssueList(envelope);

    await appendEventLog('Issues loaded.', 'ISSUES_LOADED', {
      repository: repository.fullName,
      returned: envelope.counts && envelope.counts.returned,
      query: cloneValue(querySnapshot)
    });

    return envelope;
  }

  async function loadRepositoryTree(options) {
    await ensureInitialized();

    const bootstrap = await getBootstrapState();
    const workflow = normalizeWorkflowStateFromAny(bootstrap.workflow);
    const source = isPlainObject(options) ? options : createNullObject();
    const repository = resolveRepositoryFromBootstrap(bootstrap, source);
    const envelope = await resolveRepositoryTreeEnvelope(
      repository,
      workflow,
      mergePlainObjects(source, {
        fetchRepositoryTree: true
      })
    );

    if (envelope) {
      await appendEventLog('Repository tree loaded.', 'TREE_LOADED', {
        repository: repository.fullName,
        branch: envelope.branch && envelope.branch.name,
        pathPrefix: envelope.pathPrefix,
        returnedCount: envelope.counts && envelope.counts.returnedCount
      });
    }

    return envelope;
  }

  async function selectIssue(issueOrNumber, options) {
    await ensureInitialized();

    const bootstrap = await getBootstrapState();
    const source = isPlainObject(options) ? cloneValue(options) : createNullObject();
    const repository = resolveRepositoryFromBootstrap(bootstrap, source);
    let issue = null;

    if (typeof issueOrNumber === 'number' || typeof issueOrNumber === 'string') {
      const issueNumber = normalizeIntegerOrNull(issueOrNumber);

      if (issueNumber === null) {
        throw createOrchestratorError(
          ERROR_CODES.INVALID_ARGUMENT || 'INVALID_ARGUMENT',
          'Issue number is invalid.',
          {
            issueNumber: issueOrNumber
          }
        );
      }

      issue = await resolveIssueForContext(
        bootstrap,
        repository,
        mergePlainObjects(source, {
          issueNumber: issueNumber,
          fetchIssueIfMissing: true
        })
      );
    } else {
      issue = normalizeIssueInput(issueOrNumber || source.issue, {
        repository: repository
      });

      if (issue.number === null && !issue.title && !issue.htmlUrl) {
        throw createOrchestratorError(
          ERROR_CODES.INVALID_ARGUMENT || 'INVALID_ARGUMENT',
          'Issue selection requires an issue object or issue number.',
          createNullObject()
        );
      }

      if (issue.number !== null) {
        cacheIssueItem(issue, repository);
      }
    }

    const workflowState = await stateStore.selectIssue(
      githubIssueService && typeof githubIssueService.toProtocolIssue === 'function'
        ? githubIssueService.toProtocolIssue(issue)
        : normalizeIssueRef(issue),
      {
        repository: repository,
        targetFile: normalizeString(source.targetFile) ? normalizeTaskFilePath(source.targetFile) : '',
        workingBranch: normalizeString(source.workingBranch)
          ? normalizeGitRef(source.workingBranch, 'workingBranch')
          : '',
        stage: source.stage || STAGE_DESIGN,
        status: source.status || STATUS_READY,
        logMessage: source.logMessage,
        logCode: source.logCode,
        appendLog: hasOwn(source, 'appendLog') ? source.appendLog : true
      }
    );

    let artifact = null;

    if (normalizeBoolean(hasOwn(source, 'buildStageArtifact') ? source.buildStageArtifact : true, true)) {
      artifact = await buildCurrentStageArtifact(
        mergePlainObjects(source, {
          stage: normalizeWorkflowStateFromAny(workflowState).stage,
          issue: issue,
          repository: repository
        })
      );
    }

    return deepFreeze({
      workflow: freezeClone(workflowState),
      issue: freezeClone(issue),
      repository: freezeClone(repository),
      stageArtifact: artifact ? freezeClone(artifact) : null
    });
  }

  function normalizePacketTypes() {
    const output = createNullObject();

    output.taskDispatch = normalizeString(PACKET_TYPES.TASK_DISPATCH || 'TASK_DISPATCH');
    output.executionResult = normalizeString(PACKET_TYPES.EXECUTION_RESULT || 'EXECUTION_RESULT');
    output.auditRequest = normalizeString(PACKET_TYPES.AUDIT_REQUEST || 'AUDIT_REQUEST');
    output.auditResult = normalizeString(PACKET_TYPES.AUDIT_RESULT || 'AUDIT_RESULT');

    return output;
  }

  async function buildCurrentStageArtifact(options) {
    const bootstrap = await getBootstrapState();
    const workflow = normalizeWorkflowStateFromAny(bootstrap.workflow);
    const stage = normalizeLowerString(
      (options && options.stage) ||
      workflow.stage ||
      STAGE_IDLE
    );

    if (stage === STAGE_IDLE) {
      return buildIdleArtifact(options);
    }

    if (stage === STAGE_DESIGN) {
      return buildDesignArtifact(options);
    }

    if (stage === STAGE_EXECUTION) {
      return buildExecutionArtifact(options);
    }

    if (stage === STAGE_AUDIT) {
      return buildAuditArtifact(options);
    }

    if (stage === STAGE_PR) {
      return preparePullRequest(options);
    }

    if (stage === STAGE_COMPLETED) {
      return buildCompletedArtifact(options);
    }

    if (stage === STAGE_ERROR) {
      return buildErrorArtifact(options);
    }

    throw createOrchestratorError(
      ERROR_CODES.INVALID_ARGUMENT || 'INVALID_ARGUMENT',
      'Unsupported workflow stage for artifact building.',
      {
        stage: stage
      }
    );
  }

  function normalizeParsedFilePayloadCandidate(candidate, expectedPath) {
    const source = isPlainObject(candidate) ? candidate : createNullObject();

    if (!hasOwn(source, 'content') && !hasOwn(source, 'fileContent') && !hasOwn(source, 'body')) {
      return null;
    }

    const rawPath = normalizeString(
      source.path ||
        source.targetFile ||
        source.currentTaskFilePath ||
        source.filePath
    );

    if (!rawPath) {
      return null;
    }

    let normalizedPath;

    try {
      normalizedPath = normalizeTaskFilePath(rawPath);
    } catch (error) {
      return null;
    }

    if (normalizeString(expectedPath)) {
      try {
        if (normalizeTaskFilePath(expectedPath) !== normalizedPath) {
          return null;
        }
      } catch (error) {
      }
    }

    const content = hasOwn(source, 'content')
      ? coerceText(source.content)
      : (hasOwn(source, 'fileContent')
          ? coerceText(source.fileContent)
          : coerceText(source.body));

    return deepFreeze({
      kind: 'file',
      format: 'xml_file',
      path: normalizedPath,
      content: content,
      contentLength: content.length,
      hasCdata: normalizeBoolean(source.hasCdata, true),
      rootTag: 'File',
      pathAttribute: normalizeString(source.pathAttribute) || 'path'
    });
  }

  function normalizeParsedReviewPayloadCandidate(candidate) {
    const source = isPlainObject(candidate) ? candidate : createNullObject();
    const verdict = normalizeUpperString(source.verdict);

    if (verdict !== REVIEW_APPROVE && verdict !== REVIEW_REJECT) {
      return null;
    }

    const summary = normalizeMultilineText(source.summary);

    if (!summary) {
      return null;
    }

    const findings = Array.isArray(source.findings)
      ? source.findings.map(function mapFinding(entry) {
          if (typeof entry === 'string') {
            return {
              severity: '',
              target: '',
              message: normalizeString(entry)
            };
          }

          if (isPlainObject(entry)) {
            return {
              severity: normalizeString(entry.severity),
              target: normalizeString(entry.target),
              message: normalizeString(entry.message || entry.text)
            };
          }

          return {
            severity: '',
            target: '',
            message: normalizeString(String(entry))
          };
        }).filter(function filterFinding(entry) {
          return !!entry.message;
        })
      : [];

    return deepFreeze({
      kind: 'review',
      format: 'xml_review',
      verdict: verdict,
      summary: summary,
      findings: findings,
      rootTag: 'Review'
    });
  }

  function mergeParserIssues() {
    const output = [];
    const seen = new Set();

    for (let argumentIndex = 0; argumentIndex < arguments.length; argumentIndex += 1) {
      const source = Array.isArray(arguments[argumentIndex]) ? arguments[argumentIndex] : [];

      for (const entry of source) {
        let code = '';
        let message = '';
        let details = createNullObject();

        if (typeof entry === 'string') {
          message = normalizeString(entry);
        } else if (entry instanceof Error) {
          code = normalizeString(entry.code);
          message = normalizeString(entry.message);
          details = stableObject(entry.details);
        } else if (isPlainObject(entry)) {
          code = normalizeString(entry.code);
          message = normalizeString(entry.message || entry.text);
          details = stableObject(entry.details);
        }

        if (!message && !code) {
          continue;
        }

        const signature = code + '\u0000' + message + '\u0000' + serializeComparable(details);

        if (seen.has(signature)) {
          continue;
        }

        seen.add(signature);
        output.push(
          deepFreeze({
            code: code || (ERROR_CODES.UNKNOWN_ERROR || 'UNKNOWN_ERROR'),
            message: message || 'Parsing issue.',
            details: details
          })
        );
      }
    }

    return output;
  }

  function buildParseEnvelope(ok, submissionType, payload, errors, warnings, metadata) {
    return deepFreeze({
      ok: ok === true,
      submissionType: normalizeString(submissionType),
      payload: payload === null || typeof payload === 'undefined' ? null : cloneValue(payload),
      errors: mergeParserIssues(errors),
      warnings: mergeParserIssues(warnings),
      metadata: isPlainObject(metadata) ? cloneValue(metadata) : createNullObject()
    });
  }

  function parsePacketPayload(rawText) {
    if (!aiPayloadParser || typeof aiPayloadParser.parsePacketPayload !== 'function') {
      return buildParseEnvelope(
        false,
        'packet',
        null,
        [{
          code: ERROR_CODES.INVALID_STATE || 'INVALID_STATE',
          message: 'Packet parser is unavailable.'
        }],
        [],
        createNullObject()
      );
    }

    const result = aiPayloadParser.parsePacketPayload(rawText);

    if (result && result.ok === true) {
      return buildParseEnvelope(true, 'packet', result.payload, [], result.warnings, {
        source: result.source,
        format: result.format
      });
    }

    return buildParseEnvelope(false, 'packet', null, result && result.errors, result && result.warnings, {
      source: result && result.source,
      format: result && result.format
    });
  }

  function parseExecutionSubmission(rawText, options) {
    const source = isPlainObject(options) ? options : createNullObject();
    const expectedPath = normalizeTaskFilePath(source.expectedPath || source.targetFile || '', {
      allowEmpty: true
    });

    const direct = aiPayloadParser.parseExecutorOutput(rawText, {
      expectedPath: expectedPath || '',
      allowHtmlEscapedXml: true,
      cdataRequired: true
    });

    if (direct && direct.ok === true) {
      return buildParseEnvelope(
        true,
        'executor',
        {
          rawResponse: coerceText(rawText),
          parsedOutput: cloneValue(direct.payload),
          mode: 'direct_file'
        },
        [],
        direct.warnings,
        {
          parser: 'executor_output',
          expectedPath: expectedPath
        }
      );
    }

    const packet = parsePacketPayload(rawText);
    const packetTypes = normalizePacketTypes();

    if (
      packet.ok === true &&
      packet.payload &&
      packet.payload.packet &&
      normalizeString(packet.payload.packet.packetType) === packetTypes.executionResult
    ) {
      const packetPayload = isPlainObject(packet.payload.packet.payload)
        ? packet.payload.packet.payload
        : createNullObject();
      const candidateRawResponse = coerceText(packetPayload.rawResponse || rawText);
      const candidateParsed = normalizeParsedFilePayloadCandidate(packetPayload.parsedOutput, expectedPath);

      if (candidateParsed) {
        return buildParseEnvelope(
          true,
          'executor',
          {
            rawResponse: candidateRawResponse,
            parsedOutput: candidateParsed,
            mode: 'packet_parsed_output',
            packet: cloneValue(packet.payload.packet)
          },
          [],
          packet.warnings,
          {
            parser: 'packet_execution_result',
            expectedPath: expectedPath
          }
        );
      }

      const reparsed = aiPayloadParser.parseExecutorOutput(candidateRawResponse, {
        expectedPath: expectedPath || '',
        allowHtmlEscapedXml: true,
        cdataRequired: true
      });

      if (reparsed && reparsed.ok === true) {
        return buildParseEnvelope(
          true,
          'executor',
          {
            rawResponse: candidateRawResponse,
            parsedOutput: cloneValue(reparsed.payload),
            mode: 'packet_raw_response',
            packet: cloneValue(packet.payload.packet)
          },
          [],
          mergeParserIssues(packet.warnings, reparsed.warnings),
          {
            parser: 'packet_execution_result_raw_response',
            expectedPath: expectedPath
          }
        );
      }

      return buildParseEnvelope(
        false,
        'executor',
        null,
        mergeParserIssues(
          direct && direct.errors,
          packet.errors,
          reparsed && reparsed.errors
        ),
        mergeParserIssues(
          direct && direct.warnings,
          packet.warnings,
          reparsed && reparsed.warnings
        ),
        {
          parser: 'packet_execution_result',
          expectedPath: expectedPath
        }
      );
    }

    return buildParseEnvelope(
      false,
      'executor',
      null,
      mergeParserIssues(
        direct && direct.errors,
        packet.errors
      ),
      mergeParserIssues(
        direct && direct.warnings,
        packet.warnings
      ),
      {
        parser: 'executor_output',
        expectedPath: expectedPath
      }
    );
  }

  function parseAuditSubmission(rawText, options) {
    const reviewResult = aiPayloadParser.parseReviewOutput(rawText, {
      allowHtmlEscapedXml: true
    });

    if (reviewResult && reviewResult.ok === true) {
      return buildParseEnvelope(
        true,
        'audit',
        {
          decision: normalizeReviewDecision(reviewResult.payload),
          mode: 'direct_review'
        },
        [],
        reviewResult.warnings,
        {
          parser: 'review_output'
        }
      );
    }

    const packet = parsePacketPayload(rawText);
    const packetTypes = normalizePacketTypes();

    if (
      packet.ok === true &&
      packet.payload &&
      packet.payload.packet &&
      normalizeString(packet.payload.packet.packetType) === packetTypes.auditResult
    ) {
      const packetPayload = isPlainObject(packet.payload.packet.payload)
        ? packet.payload.packet.payload
        : createNullObject();
      const candidateDecision = normalizeParsedReviewPayloadCandidate(packetPayload);

      if (candidateDecision) {
        return buildParseEnvelope(
          true,
          'audit',
          {
            decision: normalizeReviewDecision(candidateDecision),
            mode: 'packet_audit_result',
            packet: cloneValue(packet.payload.packet)
          },
          [],
          packet.warnings,
          {
            parser: 'packet_audit_result'
          }
        );
      }

      const summary = isPlainObject(packetPayload) ? normalizeMultilineText(packetPayload.summary) : '';
      const verdict = isPlainObject(packetPayload) ? normalizeUpperString(packetPayload.verdict) : '';

      if ((verdict === REVIEW_APPROVE || verdict === REVIEW_REJECT) && summary) {
        return buildParseEnvelope(
          true,
          'audit',
          {
            decision: normalizeReviewDecision({
              verdict: verdict,
              summary: summary,
              findings: stableArray(packetPayload.findings)
            }),
            mode: 'packet_audit_result_simple',
            packet: cloneValue(packet.payload.packet)
          },
          [],
          packet.warnings,
          {
            parser: 'packet_audit_result'
          }
        );
      }
    }

    return buildParseEnvelope(
      false,
      'audit',
      null,
      mergeParserIssues(
        reviewResult && reviewResult.errors,
        packet.errors
      ),
      mergeParserIssues(
        reviewResult && reviewResult.warnings,
        packet.warnings
      ),
      {
        parser: 'review_output'
      }
    );
  }

  function extractTargetFileFromDesignText(text, options) {
    const source = isPlainObject(options) ? options : createNullObject();

    if (normalizeString(source.targetFile)) {
      return normalizeTaskFilePath(source.targetFile);
    }

    const rawText = coerceText(text);

    if (!rawText) {
      return '';
    }

    const patterns = [
      /(?:^|\n)\s*(?:target[_\s-]*file|file[_\s-]*path|path)\s*[:=]\s*`?([A-Za-z0-9._\-\/]+\.[A-Za-z0-9._\-]+)`?/i,
      /(?:^|\n)\s*[-*]\s*(?:target[_\s-]*file|file[_\s-]*path|path)\s*[:=]?\s*`?([A-Za-z0-9._\-\/]+\.[A-Za-z0-9._\-]+)`?/i
    ];

    for (const pattern of patterns) {
      const match = pattern.exec(rawText);

      if (match && normalizeString(match[1])) {
        try {
          return normalizeTaskFilePath(match[1]);
        } catch (error) {
        }
      }
    }

    return '';
  }

  function parsePullRequestReference(input, options) {
    const sourceOptions = isPlainObject(options) ? options : createNullObject();
    const repository = buildRepositoryDescriptor(sourceOptions.repository);

    if (isPlainObject(input)) {
      const direct = normalizePullRequestRef(input);

      if (direct.number !== null || direct.url) {
        return direct;
      }
    }

    const rawText = coerceText(input);
    const trimmed = rawText.trim();

    if (!trimmed) {
      return null;
    }

    const urlMatch = /https?:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/pull\/(\d+)/i.exec(trimmed);

    if (urlMatch) {
      return normalizePullRequestRef({
        number: parseInt(urlMatch[3], 10),
        url: urlMatch[0],
        state: 'open',
        draft: false,
        merged: false,
        repositoryFullName: decodeURIComponent(urlMatch[1]) + '/' + decodeURIComponent(urlMatch[2])
      });
    }

    const numberMatch = /(?:^|[^\d])#?(\d+)(?:$|[^\d])/.exec(trimmed);

    if (numberMatch) {
      const number = parseInt(numberMatch[1], 10);
      const url = repository.htmlUrl ? repository.htmlUrl + '/pull/' + String(number) : '';
      return normalizePullRequestRef({
        number: number,
        url: url,
        state: 'open',
        draft: false,
        merged: false,
        repositoryFullName: repository.fullName
      });
    }

    return null;
  }

  function buildStageArtifactEnvelope(kind, stage, payload) {
    const source = isPlainObject(payload) ? payload : createNullObject();

    return deepFreeze({
      ok: normalizeBoolean(source.ok, true),
      kind: normalizeString(kind),
      stage: normalizeLowerString(stage),
      providerId: normalizeString(source.providerId),
      providerLabel: normalizeString(source.providerLabel),
      repository: cloneValue(source.repository || createNullObject()),
      issue: cloneValue(source.issue || createNullObject()),
      targetFile: normalizeString(source.targetFile),
      promptText: coerceText(source.promptText || source.text),
      packet: cloneValue(source.packet || null),
      packetText: coerceText(source.packetText),
      errors: Array.isArray(source.errors) ? cloneValue(source.errors) : [],
      warnings: Array.isArray(source.warnings) ? cloneValue(source.warnings) : [],
      metadata: isPlainObject(source.metadata) ? cloneValue(source.metadata) : createNullObject(),
      extra: isPlainObject(source.extra) ? cloneValue(source.extra) : createNullObject()
    });
  }

  function buildIssueListResponseText(envelope) {
    const source = isPlainObject(envelope) ? envelope : createNullObject();
    const items = Array.isArray(source.items) ? source.items : [];
    const lines = [];

    lines.push('Repository: ' + normalizeString(source.repository && source.repository.fullName));
    lines.push('Returned: ' + String((source.counts && source.counts.returned) || items.length));
    lines.push('State: ' + normalizeString(source.query && source.query.state));
    lines.push('');

    for (const item of items.slice(0, 100)) {
      const issue = normalizeIssueInput(item, {
        repository: source.repository
      });

      lines.push((issue.number === null ? '#?' : '#' + String(issue.number)) + ' ' + (issue.title || '(untitled issue)'));
    }

    return lines.join('\n').trim();
  }

  function buildTreeResponseText(envelope) {
    const source = isPlainObject(envelope) ? envelope : createNullObject();
    return coerceText(source.text || '');
  }

  async function buildDesignArtifact(options) {
    const bootstrap = await getBootstrapState();
    const workflow = normalizeWorkflowStateFromAny(bootstrap.workflow);
    const source = isPlainObject(options) ? options : createNullObject();
    const repository = resolveRepositoryFromBootstrap(bootstrap, source);
    const issue = await resolveIssueForContext(bootstrap, repository, source);
    const providerId = resolveActiveProviderForStage(STAGE_DESIGN, workflow, {
      providerId: source.providerId,
      role: ROLE_DESIGNER
    });
    const providerLabel = getProviderLabel(providerId, 'Designer AI');
    const targetFile = normalizeTaskFilePath(
      source.targetFile || workflow.currentTaskFilePath || '',
      {
        allowEmpty: true
      }
    );
    const treeEnvelope = normalizeBoolean(hasOwn(source, 'includeRepositoryTree') ? source.includeRepositoryTree : true, true)
      ? await resolveRepositoryTreeEnvelope(
          repository,
          workflow,
          mergePlainObjects(source, {
            fetchRepositoryTree: true
          })
        )
      : null;
    const treeText = treeEnvelope ? buildTreeResponseText(treeEnvelope) : '';
    const lines = [];

    lines.push('You are the design-stage AI for PR-Forge.');
    lines.push('Select exactly one target file for the current issue.');
    lines.push('Do not write code. Return a concise design response that includes a target_file field.');
    lines.push('');
    lines.push('Issue: ' + formatIssueHeader(issue));
    lines.push('Repository: ' + repository.fullName);
    lines.push('Current target file: ' + (targetFile || '(none)'));

    if (normalizeBoolean(source.includeIssueBody, true) && issue.body) {
      lines.push('');
      lines.push('Issue body:');
      lines.push(buildFencedBlock('text', issue.body));
    }

    if (treeText) {
      lines.push('');
      lines.push('Repository tree:');
      lines.push(buildFencedBlock('text', treeText));
    }

    lines.push('');
    lines.push('Required response format:');
    lines.push(buildIndentedList([
      'target_file: relative/path/to/file.ext',
      'rationale: one short paragraph',
      'implementation_notes: bullet-like plain text',
      'risks: bullet-like plain text'
    ]));

    const artifact = buildStageArtifactEnvelope('design_guidance', STAGE_DESIGN, {
      ok: true,
      providerId: providerId,
      providerLabel: providerLabel,
      repository: repository,
      issue: issue,
      targetFile: targetFile,
      text: lines.join('\n'),
      errors: [],
      warnings: [],
      metadata: {
        stage: STAGE_DESIGN,
        repositoryFullName: repository.fullName,
        issueNumber: issue && issue.number,
        treeIncluded: !!treeText
      }
    });

    setStageArtifact(artifact);
    return artifact;
  }

  async function buildExecutionArtifact(options) {
    const bootstrap = await getBootstrapState();
    const workflow = normalizeWorkflowStateFromAny(bootstrap.workflow);
    const source = isPlainObject(options) ? options : createNullObject();
    const repository = resolveRepositoryFromBootstrap(bootstrap, source);
    const issue = await resolveIssueForContext(bootstrap, repository, source);
    const targetFile = resolveTargetFile(
      workflow,
      mergePlainObjects(source, {
        allowEmptyTargetFile: false
      })
    );
    const providerId = resolveActiveProviderForStage(STAGE_EXECUTION, workflow, {
      providerId: source.providerId,
      role: ROLE_EXECUTOR
    });
    const providerLabel = getProviderLabel(providerId, 'Executor AI');
    const treeEnvelope = normalizeBoolean(hasOwn(source, 'includeRepositoryTree') ? source.includeRepositoryTree : true, true)
      ? await resolveRepositoryTreeEnvelope(
          repository,
          workflow,
          mergePlainObjects(source, {
            fetchRepositoryTree: true
          })
        )
      : null;
    const repositoryTree = treeEnvelope ? buildTreeResponseText(treeEnvelope) : '';
    const currentCode = coerceText(
      source.currentCode ||
        source.fileContent ||
        source.existingCode ||
        source.code ||
        ''
    );

    const prompt = executorPrompt.createPrompt(
      {
        providerId: providerId,
        repository: repository,
        issue: normalizeIssueRef(issue),
        targetFile: targetFile,
        instructions: normalizeMultilineText(source.instructions || source.taskInstructions || source.goal || ''),
        repositoryTree: repositoryTree,
        currentCode: currentCode,
        outputContract: source.outputContract,
        customConstraints: source.customConstraints,
        metadata: stableObject(source.metadata)
      },
      {
        includeManualHubPacket: normalizeBoolean(hasOwn(source, 'includeManualHubPacket') ? source.includeManualHubPacket : true, true),
        throwOnInvalid: false,
        includeIssueBody: hasOwn(source, 'includeIssueBody') ? source.includeIssueBody : true,
        includeRepositoryTree: hasOwn(source, 'includeRepositoryTree') ? source.includeRepositoryTree : true,
        includeCurrentCode: hasOwn(source, 'includeCurrentCode') ? source.includeCurrentCode : true,
        maxInstructionChars: source.maxInstructionChars,
        maxIssueBodyChars: source.maxIssueBodyChars,
        maxRepositoryTreeChars: source.maxRepositoryTreeChars,
        maxCurrentCodeChars: source.maxCurrentCodeChars,
        source: stableObject(source.packetSource),
        target: stableObject(source.packetTarget),
        meta: stableObject(source.packetMeta)
      }
    );

    const artifact = buildStageArtifactEnvelope('execution_prompt', STAGE_EXECUTION, {
      ok: prompt.valid,
      providerId: providerId,
      providerLabel: providerLabel,
      repository: repository,
      issue: issue,
      targetFile: targetFile,
      promptText: prompt.text,
      packet: prompt.packet,
      packetText: prompt.packetText,
      errors: prompt.errors,
      warnings: prompt.warnings,
      metadata: mergePlainObjects(prompt.metadata, {
        stage: STAGE_EXECUTION,
        repositoryFullName: repository.fullName,
        issueNumber: issue && issue.number,
        targetFile: targetFile
      }),
      extra: {
        prompt: cloneValue(prompt)
      }
    });

    setStageArtifact(artifact);
    return artifact;
  }

  async function buildAuditArtifact(options) {
    const bootstrap = await getBootstrapState();
    const workflow = normalizeWorkflowStateFromAny(bootstrap.workflow);
    const source = isPlainObject(options) ? options : createNullObject();
    const repository = resolveRepositoryFromBootstrap(bootstrap, source);
    const issue = await resolveIssueForContext(bootstrap, repository, source);
    const targetFile = normalizeTaskFilePath(
      source.targetFile || workflow.currentTaskFilePath || '',
      {
        allowEmpty: true
      }
    );
    const providerId = resolveActiveProviderForStage(STAGE_AUDIT, workflow, {
      providerId: source.providerId,
      role: ROLE_AUDITOR
    });
    const providerLabel = getProviderLabel(providerId, 'Auditor AI');
    const diff = coerceText(
      source.diff ||
        source.patchDiff ||
        source.patch ||
        source.unifiedDiff ||
        source.reviewDiff ||
        ''
    ) || coerceText(workflow.latestExecutorResponse || '');

    const prompt = auditorPrompt.createPrompt(
      {
        providerId: providerId,
        repository: repository,
        issue: normalizeIssueRef(issue),
        targetFile: targetFile,
        diff: diff,
        criteria: source.criteria || source.acceptanceCriteria || source.auditCriteria,
        reviewFocus: source.reviewFocus || source.instructions || '',
        outputContract: source.outputContract,
        metadata: stableObject(source.metadata)
      },
      {
        includeManualHubPacket: normalizeBoolean(hasOwn(source, 'includeManualHubPacket') ? source.includeManualHubPacket : true, true),
        throwOnInvalid: false,
        includeIssueBody: hasOwn(source, 'includeIssueBody') ? source.includeIssueBody : true,
        includeReviewFocus: hasOwn(source, 'includeReviewFocus') ? source.includeReviewFocus : true,
        maxDiffChars: source.maxDiffChars,
        maxIssueBodyChars: source.maxIssueBodyChars,
        maxCriteriaChars: source.maxCriteriaChars,
        maxReviewFocusChars: source.maxReviewFocusChars,
        source: stableObject(source.packetSource),
        target: stableObject(source.packetTarget),
        meta: stableObject(source.packetMeta)
      }
    );

    const artifact = buildStageArtifactEnvelope('audit_prompt', STAGE_AUDIT, {
      ok: prompt.valid,
      providerId: providerId,
      providerLabel: providerLabel,
      repository: repository,
      issue: issue,
      targetFile: targetFile,
      promptText: prompt.text,
      packet: prompt.packet,
      packetText: prompt.packetText,
      errors: prompt.errors,
      warnings: prompt.warnings,
      metadata: mergePlainObjects(prompt.metadata, {
        stage: STAGE_AUDIT,
        repositoryFullName: repository.fullName,
        issueNumber: issue && issue.number,
        targetFile: targetFile
      }),
      extra: {
        prompt: cloneValue(prompt),
        diff: diff
      }
    });

    setStageArtifact(artifact);
    return artifact;
  }

  async function preparePullRequest(options) {
    const bootstrap = await getBootstrapState();
    const workflow = normalizeWorkflowStateFromAny(bootstrap.workflow);
    const source = isPlainObject(options) ? options : createNullObject();
    const repository = resolveRepositoryFromBootstrap(bootstrap, source);
    const issue = await resolveIssueForContext(bootstrap, repository, source);
    const targetFile = normalizeTaskFilePath(
      source.targetFile || workflow.currentTaskFilePath || '',
      {
        allowEmpty: true
      }
    );
    const workingBranch = resolveWorkingBranch(workflow, issue, repository, source);

    const prepared = await githubPrService.prepareCreateOptions({
      repository: repository,
      issue: normalizeIssueRef(issue),
      targetFile: targetFile,
      workingBranch: workingBranch,
      headBranch: workingBranch,
      baseBranch: normalizeString(source.baseBranch || source.base || repository.baseBranch || repository.defaultBranch || DEFAULT_BASE_BRANCH),
      title: source.title,
      body: source.body,
      summary: source.summary,
      notes: source.notes,
      additionalBody: source.additionalBody,
      bodyFooter: source.bodyFooter,
      draft: hasOwn(source, 'draft') ? source.draft : undefined,
      maintainerCanModify: hasOwn(source, 'maintainerCanModify') ? source.maintainerCanModify : undefined,
      includeClosesKeyword: hasOwn(source, 'includeClosesKeyword') ? source.includeClosesKeyword : true,
      includeGeneratedFooter: hasOwn(source, 'includeGeneratedFooter') ? source.includeGeneratedFooter : false,
      fetchRepositoryMetadata: hasOwn(source, 'fetchRepositoryMetadata') ? source.fetchRepositoryMetadata : true,
      metadata: stableObject(source.metadata)
    });

    const lines = [];

    lines.push('Repository: ' + repository.fullName);
    lines.push('Issue: ' + formatIssueHeader(issue));
    lines.push('Head: ' + prepared.headBranch);
    lines.push('Base: ' + prepared.baseBranch);
    lines.push('Draft: ' + (prepared.draft ? 'true' : 'false'));
    lines.push('Title: ' + (prepared.title || '(missing)'));

    if (targetFile) {
      lines.push('Target file: ' + targetFile);
    }

    lines.push('');
    lines.push('Body preview:');
    lines.push(buildFencedBlock('markdown', prepared.body || ''));

    const artifact = buildStageArtifactEnvelope('pull_request_preview', STAGE_PR, {
      ok: true,
      providerId: '',
      providerLabel: '',
      repository: repository,
      issue: issue,
      targetFile: targetFile,
      text: lines.join('\n'),
      errors: [],
      warnings: [],
      metadata: {
        stage: STAGE_PR,
        repositoryFullName: repository.fullName,
        issueNumber: issue && issue.number,
        headBranch: prepared.headBranch,
        baseBranch: prepared.baseBranch,
        title: prepared.title,
        draft: prepared.draft
      },
      extra: {
        prepared: cloneValue(prepared)
      }
    });

    setStageArtifact(artifact);
    return artifact;
  }

  async function buildIdleArtifact(options) {
    const bootstrap = await getBootstrapState();
    const repository = buildRepositoryDescriptor(bootstrap.repository);
    const lines = [];

    lines.push('Workflow is idle.');
    lines.push('Repository: ' + (repository.fullName || '(repository unspecified)'));
    lines.push('Next step: load issues and select one issue.');

    const artifact = buildStageArtifactEnvelope('idle_summary', STAGE_IDLE, {
      ok: true,
      providerId: '',
      providerLabel: '',
      repository: repository,
      issue: createNullObject(),
      targetFile: '',
      text: lines.join('\n'),
      errors: [],
      warnings: [],
      metadata: {
        stage: STAGE_IDLE
      }
    });

    setStageArtifact(artifact);
    return artifact;
  }

  async function buildCompletedArtifact(options) {
    const bootstrap = await getBootstrapState();
    const workflow = normalizeWorkflowStateFromAny(bootstrap.workflow);
    const lines = [];

    lines.push('Workflow completed.');
    lines.push(
      'Issue: ' +
      (workflow.currentIssueNumber === null ? '#?' : '#' + String(workflow.currentIssueNumber)) +
      ' ' +
      (workflow.currentIssueTitle || '(untitled)')
    );
    lines.push('Pull request: ' + (workflow.pullRequestUrl || '(not recorded)'));

    const artifact = buildStageArtifactEnvelope('completed_summary', STAGE_COMPLETED, {
      ok: true,
      providerId: '',
      providerLabel: '',
      repository: buildRepositoryDescriptor(bootstrap.repository),
      issue: normalizeIssueInput(
        {
          number: workflow.currentIssueNumber,
          title: workflow.currentIssueTitle,
          url: workflow.currentIssueUrl
        },
        {
          repository: bootstrap.repository
        }
      ),
      targetFile: workflow.currentTaskFilePath,
      text: lines.join('\n'),
      errors: [],
      warnings: [],
      metadata: {
        stage: STAGE_COMPLETED,
        pullRequestNumber: workflow.pullRequestNumber,
        pullRequestUrl: workflow.pullRequestUrl
      }
    });

    setStageArtifact(artifact);
    return artifact;
  }

  async function buildErrorArtifact(options) {
    const bootstrap = await getBootstrapState();
    const workflow = normalizeWorkflowStateFromAny(bootstrap.workflow);
    const lastError = isPlainObject(bootstrap.lastError) ? bootstrap.lastError : createNullObject();
    const lines = [];

    lines.push('Workflow is in error state.');
    lines.push('Error code: ' + (workflow.lastErrorCode || normalizeString(lastError.code) || '(unknown)'));
    lines.push('Message: ' + (workflow.lastErrorMessage || normalizeString(lastError.message) || '(none)'));
    lines.push('Recommended action: clear the error or reset the workflow after fixing the cause.');

    const artifact = buildStageArtifactEnvelope('error_summary', STAGE_ERROR, {
      ok: true,
      providerId: '',
      providerLabel: '',
      repository: buildRepositoryDescriptor(bootstrap.repository),
      issue: createNullObject(),
      targetFile: normalizeString(workflow.currentTaskFilePath),
      text: lines.join('\n'),
      errors: [],
      warnings: [],
      metadata: {
        stage: STAGE_ERROR,
        lastError: cloneValue(lastError)
      }
    });

    setStageArtifact(artifact);
    return artifact;
  }

  async function buildSubmissionPacket(submissionKind, payload, options) {
    const source = isPlainObject(options) ? options : createNullObject();
    const workflow = await getWorkflowState();
    const bootstrap = await getBootstrapState();
    const repository = resolveRepositoryFromBootstrap(bootstrap, source);
    const issue = await resolveIssueForContext(
      bootstrap,
      repository,
      mergePlainObjects(source, {
        allowEmptyIssue: true
      })
    );

    const sourceEndpoint = isPlainObject(source.packetSource)
      ? source.packetSource
      : {
          type: 'extension',
          id: normalizeString(APP.id) || 'maoe',
          label: normalizeString(APP.name) || 'MAOE',
          role: '',
          providerId: '',
          siteId: '',
          tabId: null,
          url: ''
        };

    const targetEndpoint = isPlainObject(source.packetTarget)
      ? source.packetTarget
      : {
          type: 'human_hub',
          id: 'human',
          label: 'Human Hub',
          role: '',
          providerId: '',
          siteId: '',
          tabId: null,
          url: ''
        };

    if (submissionKind === 'executor') {
      return protocol.createExecutionResultPacket(
        {
          targetFile: payload.parsedOutput.path,
          rawResponse: payload.rawResponse,
          parsedOutput: payload.parsedOutput,
          metadata: {
            mode: payload.mode,
            repository: repository.fullName,
            issueNumber: issue && issue.number
          }
        },
        {
          requestId: createRequestId('exec_packet'),
          source: sourceEndpoint,
          target: targetEndpoint,
          meta: stableObject(source.packetMeta)
        }
      );
    }

    if (submissionKind === 'audit') {
      return protocol.createAuditResultPacket(
        {
          verdict: payload.decision.verdict,
          summary: payload.decision.summary,
          findings: cloneValue(payload.decision.findings),
          targetFile: normalizeString(workflow.currentTaskFilePath || source.targetFile),
          metadata: {
            mode: payload.mode,
            repository: repository.fullName,
            issueNumber: issue && issue.number
          }
        },
        {
          requestId: createRequestId('audit_packet'),
          source: sourceEndpoint,
          target: targetEndpoint,
          meta: stableObject(source.packetMeta)
        }
      );
    }

    return null;
  }

  async function handleExecutionSubmission(rawText, options) {
    const bootstrap = await getBootstrapState();
    const workflow = normalizeWorkflowStateFromAny(bootstrap.workflow);
    const source = isPlainObject(options) ? options : createNullObject();
    const parse = parseExecutionSubmission(rawText, {
      expectedPath: source.expectedPath || workflow.currentTaskFilePath || source.targetFile
    });

    if (!parse.ok) {
      return parse;
    }

    const savedWorkflow = await stateStore.recordExecutorResponse(parse.payload.rawResponse, {
      parsedPayload: parse.payload.parsedOutput,
      source: normalizeString(
        source.source ||
          workflow.activeProviderId ||
          resolveActiveProviderForStage(STAGE_EXECUTION, workflow, {
            role: ROLE_EXECUTOR
          })
      ),
      errors: parse.errors,
      updateTargetFile: hasOwn(source, 'updateTargetFile') ? source.updateTargetFile : true,
      transitionToAudit: hasOwn(source, 'transitionToAudit') ? source.transitionToAudit : true,
      skipTransitionCheck: normalizeBoolean(source.skipTransitionCheck, false),
      appendLog: hasOwn(source, 'appendLog') ? source.appendLog : true,
      logLevel: source.logLevel || 'info',
      logCode: normalizeString(source.logCode) || 'EXECUTOR_RESPONSE_RECORDED',
      logMessage: normalizeString(source.logMessage) || 'Executor response submitted via orchestrator.',
      logContext: mergePlainObjects(
        stableObject(source.logContext),
        {
          mode: parse.payload.mode,
          path: parse.payload.parsedOutput.path,
          responseLength: parse.payload.rawResponse.length
        }
      )
    });

    const packet = normalizeBoolean(hasOwn(source, 'buildPacket') ? source.buildPacket : true, true)
      ? await buildSubmissionPacket('executor', parse.payload, source)
      : null;

    const packetText = packet
      ? protocol.buildPacketEnvelopeText(packet, {
          fenceLanguage: normalizeString(source.packetFenceLanguage) || 'json',
          space: normalizePositiveInteger(source.packetSpace, 2)
        })
      : '';

    const artifact = normalizeBoolean(hasOwn(source, 'buildNextStageArtifact') ? source.buildNextStageArtifact : true, true)
      ? await buildCurrentStageArtifact(
          mergePlainObjects(source, {
            stage: normalizeWorkflowStateFromAny(savedWorkflow).stage,
            fetchRepositoryTree: false
          })
        )
      : null;

    const submission = deepFreeze({
      ok: true,
      kind: 'executor',
      rawText: coerceText(rawText),
      parse: cloneValue(parse),
      packet: packet ? cloneValue(packet) : null,
      packetText: packetText,
      workflow: cloneValue(savedWorkflow),
      stageArtifact: artifact ? cloneValue(artifact) : null
    });

    setLastSubmission(submission);
    return submission;
  }

  async function handleAuditSubmission(rawText, options) {
    const source = isPlainObject(options) ? options : createNullObject();
    const parse = parseAuditSubmission(rawText, source);

    if (!parse.ok) {
      return parse;
    }

    const savedWorkflow = await stateStore.recordAuditResult(parse.payload.decision, {
      autoApplyVerdict: hasOwn(source, 'autoApplyVerdict') ? source.autoApplyVerdict : true,
      skipTransitionCheck: normalizeBoolean(source.skipTransitionCheck, false),
      appendLog: hasOwn(source, 'appendLog') ? source.appendLog : true,
      logLevel: source.logLevel || 'info',
      logCode: normalizeString(source.logCode) || ('AUDIT_' + parse.payload.decision.verdict),
      logMessage: normalizeString(source.logMessage) || ('Audit result submitted via orchestrator: ' + parse.payload.decision.verdict + '.'),
      logContext: mergePlainObjects(
        stableObject(source.logContext),
        {
          mode: parse.payload.mode,
          verdict: parse.payload.decision.verdict,
          findingCount: Array.isArray(parse.payload.decision.findings) ? parse.payload.decision.findings.length : 0
        }
      )
    });

    const packet = normalizeBoolean(hasOwn(source, 'buildPacket') ? source.buildPacket : true, true)
      ? await buildSubmissionPacket('audit', parse.payload, source)
      : null;

    const packetText = packet
      ? protocol.buildPacketEnvelopeText(packet, {
          fenceLanguage: normalizeString(source.packetFenceLanguage) || 'json',
          space: normalizePositiveInteger(source.packetSpace, 2)
        })
      : '';

    const artifact = normalizeBoolean(hasOwn(source, 'buildNextStageArtifact') ? source.buildNextStageArtifact : true, true)
      ? await buildCurrentStageArtifact(
          mergePlainObjects(source, {
            stage: normalizeWorkflowStateFromAny(savedWorkflow).stage,
            fetchRepositoryTree: false
          })
        )
      : null;

    const submission = deepFreeze({
      ok: true,
      kind: 'audit',
      rawText: coerceText(rawText),
      parse: cloneValue(parse),
      packet: packet ? cloneValue(packet) : null,
      packetText: packetText,
      workflow: cloneValue(savedWorkflow),
      stageArtifact: artifact ? cloneValue(artifact) : null
    });

    setLastSubmission(submission);
    return submission;
  }

  async function handleDesignSubmission(rawText, options) {
    const source = isPlainObject(options) ? options : createNullObject();
    const targetFile = extractTargetFileFromDesignText(rawText, source);

    if (!targetFile) {
      return buildParseEnvelope(
        false,
        'design',
        null,
        [{
          code: ERROR_CODES.INVALID_ARGUMENT || 'INVALID_ARGUMENT',
          message: 'Design submission does not contain a target file path.'
        }],
        [],
        {
          parser: 'design_target_file'
        }
      );
    }

    let savedWorkflow = await stateStore.setCurrentTaskFilePath(targetFile, {
      appendLog: false
    });

    if (normalizeBoolean(hasOwn(source, 'autoAdvanceToExecution') ? source.autoAdvanceToExecution : false, false)) {
      savedWorkflow = await stateStore.transitionWorkflow(STAGE_EXECUTION, {
        mode: 'ready',
        skipTransitionCheck: normalizeBoolean(source.skipTransitionCheck, false),
        appendLog: false
      });
    }

    const artifact = normalizeBoolean(hasOwn(source, 'buildNextStageArtifact') ? source.buildNextStageArtifact : true, true)
      ? await buildCurrentStageArtifact(
          mergePlainObjects(source, {
            stage: normalizeWorkflowStateFromAny(savedWorkflow).stage,
            fetchRepositoryTree: false
          })
        )
      : null;

    const submission = deepFreeze({
      ok: true,
      kind: 'design',
      rawText: coerceText(rawText),
      parse: {
        ok: true,
        payload: {
          targetFile: targetFile
        },
        errors: [],
        warnings: []
      },
      packet: null,
      packetText: '',
      workflow: cloneValue(savedWorkflow),
      stageArtifact: artifact ? cloneValue(artifact) : null
    });

    setLastSubmission(submission);
    return submission;
  }

  async function handlePullRequestSubmission(rawText, options) {
    const bootstrap = await getBootstrapState();
    const source = isPlainObject(options) ? options : createNullObject();
    const repository = resolveRepositoryFromBootstrap(bootstrap, source);
    const pullRequestRef = parsePullRequestReference(rawText, {
      repository: repository
    });

    if (!pullRequestRef) {
      return buildParseEnvelope(
        false,
        'pull_request',
        null,
        [{
          code: ERROR_CODES.INVALID_ARGUMENT || 'INVALID_ARGUMENT',
          message: 'Pull request reference could not be parsed.'
        }],
        [],
        {
          parser: 'pull_request_reference'
        }
      );
    }

    const savedWorkflow = await stateStore.recordPullRequestCreated(pullRequestRef, {
      appendLog: hasOwn(source, 'appendLog') ? source.appendLog : true,
      logMessage: normalizeString(source.logMessage) || 'Pull request recorded from manual submission.',
      logCode: normalizeString(source.logCode) || 'PULL_REQUEST_MANUAL_RECORDED'
    });

    const artifact = normalizeBoolean(hasOwn(source, 'buildNextStageArtifact') ? source.buildNextStageArtifact : true, true)
      ? await buildCurrentStageArtifact(
          mergePlainObjects(source, {
            stage: normalizeWorkflowStateFromAny(savedWorkflow).stage
          })
        )
      : null;

    const submission = deepFreeze({
      ok: true,
      kind: 'pull_request',
      rawText: coerceText(rawText),
      parse: {
        ok: true,
        payload: cloneValue(pullRequestRef),
        errors: [],
        warnings: []
      },
      packet: null,
      packetText: '',
      workflow: cloneValue(savedWorkflow),
      stageArtifact: artifact ? cloneValue(artifact) : null
    });

    setLastSubmission(submission);
    return submission;
  }

  async function submitHumanPayload(rawPayload, options) {
    await ensureInitialized();

    const bootstrap = await getBootstrapState();
    const workflow = normalizeWorkflowStateFromAny(bootstrap.workflow);
    const source = isPlainObject(options) ? options : createNullObject();
    const stage = normalizeLowerString(source.stage || workflow.stage || STAGE_IDLE);
    const rawText = coerceText(
      isPlainObject(rawPayload)
        ? (rawPayload.rawText || rawPayload.text || rawPayload.response || rawPayload.payload || '')
        : rawPayload
    );
    const forcedKind = normalizeLowerString(source.kind);

    if (!rawText && forcedKind !== 'design') {
      throw createOrchestratorError(
        ERROR_CODES.INVALID_ARGUMENT || 'INVALID_ARGUMENT',
        'Human payload text is required.',
        {
          stage: stage
        }
      );
    }

    try {
      if (forcedKind === 'executor' || stage === STAGE_EXECUTION) {
        const result = await handleExecutionSubmission(rawText, source);

        if (!result.ok) {
          setLastSubmission(result);
        }

        return result;
      }

      if (forcedKind === 'audit' || stage === STAGE_AUDIT) {
        const result = await handleAuditSubmission(rawText, source);

        if (!result.ok) {
          setLastSubmission(result);
        }

        return result;
      }

      if (forcedKind === 'design' || stage === STAGE_DESIGN) {
        const result = await handleDesignSubmission(rawText, source);

        if (!result.ok) {
          setLastSubmission(result);
        }

        return result;
      }

      if (forcedKind === 'pull_request' || stage === STAGE_PR) {
        const result = await handlePullRequestSubmission(rawText, source);

        if (!result.ok) {
          setLastSubmission(result);
        }

        return result;
      }

      const executorAttempt = parseExecutionSubmission(rawText, source);

      if (executorAttempt.ok) {
        return handleExecutionSubmission(rawText, source);
      }

      const auditAttempt = parseAuditSubmission(rawText, source);

      if (auditAttempt.ok) {
        return handleAuditSubmission(rawText, source);
      }

      const prAttempt = parsePullRequestReference(rawText, {
        repository: resolveRepositoryFromBootstrap(bootstrap, source)
      });

      if (prAttempt) {
        return handlePullRequestSubmission(rawText, source);
      }

      const designAttempt = await handleDesignSubmission(
        rawText,
        mergePlainObjects(source, {
          autoAdvanceToExecution: false
        })
      );

      if (designAttempt.ok) {
        return designAttempt;
      }

      const rejected = buildParseEnvelope(
        false,
        'unknown',
        null,
        mergeParserIssues(
          executorAttempt.errors,
          auditAttempt.errors,
          designAttempt.parse && designAttempt.parse.errors
        ),
        mergeParserIssues(
          executorAttempt.warnings,
          auditAttempt.warnings,
          designAttempt.parse && designAttempt.parse.warnings
        ),
        {
          stage: stage
        }
      );

      setLastSubmission(rejected);
      return rejected;
    } catch (error) {
      const normalizedError = normalizeOrchestratorError(
        error,
        'Failed to submit human payload.',
        {
          stage: stage
        }
      );

      await stateStore.setError(normalizedError, {
        transitionToError: normalizeBoolean(source.transitionToErrorOnFailure, false),
        appendLog: hasOwn(source, 'appendLog') ? source.appendLog : true
      });

      throw normalizedError;
    }
  }

  async function createPullRequest(options) {
    await ensureInitialized();

    const bootstrap = await getBootstrapState();
    const workflow = normalizeWorkflowStateFromAny(bootstrap.workflow);
    const source = isPlainObject(options) ? options : createNullObject();
    const repository = resolveRepositoryFromBootstrap(bootstrap, source);
    const issue = await resolveIssueForContext(bootstrap, repository, source);
    const targetFile = normalizeTaskFilePath(
      source.targetFile || workflow.currentTaskFilePath || '',
      {
        allowEmpty: true
      }
    );
    const workingBranch = resolveWorkingBranch(workflow, issue, repository, source);

    const response = await githubPrService.createPullRequest({
      repository: repository,
      issue: normalizeIssueRef(issue),
      targetFile: targetFile,
      workingBranch: workingBranch,
      headBranch: workingBranch,
      baseBranch: normalizeString(source.baseBranch || source.base || repository.baseBranch || repository.defaultBranch || DEFAULT_BASE_BRANCH),
      title: source.title,
      body: source.body,
      summary: source.summary,
      notes: source.notes,
      additionalBody: source.additionalBody,
      bodyFooter: source.bodyFooter,
      draft: hasOwn(source, 'draft') ? source.draft : undefined,
      maintainerCanModify: hasOwn(source, 'maintainerCanModify') ? source.maintainerCanModify : undefined,
      includeClosesKeyword: hasOwn(source, 'includeClosesKeyword') ? source.includeClosesKeyword : true,
      includeGeneratedFooter: hasOwn(source, 'includeGeneratedFooter') ? source.includeGeneratedFooter : false,
      fetchRepositoryMetadata: hasOwn(source, 'fetchRepositoryMetadata') ? source.fetchRepositoryMetadata : true,
      metadata: stableObject(source.metadata)
    });

    const savedWorkflow = await stateStore.recordPullRequestCreated(response.pullRequest, {
      appendLog: false
    });

    const artifact = normalizeBoolean(hasOwn(source, 'buildNextStageArtifact') ? source.buildNextStageArtifact : true, true)
      ? await buildCurrentStageArtifact({
          stage: normalizeWorkflowStateFromAny(savedWorkflow).stage
        })
      : null;

    return deepFreeze({
      ok: true,
      response: cloneValue(response),
      workflow: cloneValue(savedWorkflow),
      stageArtifact: artifact ? cloneValue(artifact) : null
    });
  }

  async function advanceStage(options) {
    await ensureInitialized();

    const bootstrap = await getBootstrapState();
    const workflow = normalizeWorkflowStateFromAny(bootstrap.workflow);
    const source = isPlainObject(options) ? options : createNullObject();
    const targetStage = normalizeLowerString(source.stage || source.to || source.nextStage || nextStageAfter(workflow.stage));

    if (!targetStage) {
      throw createOrchestratorError(
        ERROR_CODES.INVALID_STATE || 'INVALID_STATE',
        'No next workflow stage is available.',
        {
          currentStage: workflow.stage
        }
      );
    }

    if (
      workflow.stage === STAGE_DESIGN &&
      targetStage === STAGE_EXECUTION &&
      !normalizeString(workflow.currentTaskFilePath) &&
      !normalizeBoolean(source.allowMissingTargetFile, false)
    ) {
      throw createOrchestratorError(
        ERROR_CODES.INVALID_STATE || 'INVALID_STATE',
        'Cannot advance to execution without a target file.',
        {
          currentStage: workflow.stage
        }
      );
    }

    if (
      workflow.stage === STAGE_EXECUTION &&
      targetStage === STAGE_AUDIT &&
      !coerceText(workflow.latestExecutorResponse) &&
      !normalizeBoolean(source.allowMissingExecutorResponse, false)
    ) {
      throw createOrchestratorError(
        ERROR_CODES.INVALID_STATE || 'INVALID_STATE',
        'Cannot advance to audit without an executor response.',
        {
          currentStage: workflow.stage
        }
      );
    }

    if (
      workflow.stage === STAGE_AUDIT &&
      targetStage === STAGE_PR &&
      normalizeUpperString(workflow.latestAuditVerdict) !== REVIEW_APPROVE &&
      !normalizeBoolean(source.allowRejectedAuditAdvance, false)
    ) {
      throw createOrchestratorError(
        ERROR_CODES.INVALID_STATE || 'INVALID_STATE',
        'Cannot advance to PR unless the audit verdict is APPROVE.',
        {
          currentStage: workflow.stage,
          latestAuditVerdict: workflow.latestAuditVerdict
        }
      );
    }

    if (
      workflow.stage === STAGE_PR &&
      targetStage === STAGE_COMPLETED &&
      workflow.pullRequestNumber === null &&
      !workflow.pullRequestUrl &&
      !normalizeBoolean(source.allowMissingPullRequest, false)
    ) {
      throw createOrchestratorError(
        ERROR_CODES.INVALID_STATE || 'INVALID_STATE',
        'Cannot complete the workflow without a pull request reference.',
        {
          currentStage: workflow.stage
        }
      );
    }

    let savedWorkflow;

    if (targetStage === STAGE_COMPLETED) {
      savedWorkflow = await stateStore.completeWorkflow({
        appendLog: hasOwn(source, 'appendLog') ? source.appendLog : true,
        logMessage: source.logMessage,
        logCode: source.logCode
      });
    } else {
      savedWorkflow = await stateStore.transitionWorkflow(targetStage, {
        mode: source.mode || 'ready',
        status: source.status,
        skipTransitionCheck: normalizeBoolean(source.skipTransitionCheck, false),
        appendLog: hasOwn(source, 'appendLog') ? source.appendLog : true,
        logMessage: source.logMessage,
        logCode: source.logCode,
        clearActiveProviderOnStageWithoutRole: normalizeBoolean(source.clearActiveProviderOnStageWithoutRole, false)
      });
    }

    const artifact = normalizeBoolean(hasOwn(source, 'buildArtifact') ? source.buildArtifact : true, true)
      ? await buildCurrentStageArtifact({
          stage: normalizeWorkflowStateFromAny(savedWorkflow).stage
        })
      : null;

    return deepFreeze({
      workflow: cloneValue(savedWorkflow),
      stageArtifact: artifact ? cloneValue(artifact) : null
    });
  }

  async function resetWorkflow(options) {
    await ensureInitialized();

    const source = isPlainObject(options) ? options : createNullObject();
    const workflow = await stateStore.resetWorkflowState({
      preserveSelectedProviders: hasOwn(source, 'preserveSelectedProviders') ? source.preserveSelectedProviders : true,
      keepIssue: hasOwn(source, 'keepIssue') ? source.keepIssue : false,
      appendLog: hasOwn(source, 'appendLog') ? source.appendLog : true,
      logMessage: source.logMessage,
      logCode: source.logCode
    });

    let artifact = null;

    if (normalizeBoolean(hasOwn(source, 'buildArtifact') ? source.buildArtifact : true, true)) {
      artifact = await buildCurrentStageArtifact({
        stage: normalizeWorkflowStateFromAny(workflow).stage
      });
    } else {
      runtimeState.stageArtifact = null;
    }

    runtimeState.lastSubmission = null;

    return deepFreeze({
      workflow: cloneValue(workflow),
      stageArtifact: artifact ? cloneValue(artifact) : null
    });
  }

  async function clearError(options) {
    await ensureInitialized();

    const source = isPlainObject(options) ? options : createNullObject();
    const workflow = await stateStore.clearError({
      stage: source.stage,
      status: source.status,
      appendLog: hasOwn(source, 'appendLog') ? source.appendLog : true,
      logMessage: source.logMessage,
      logCode: source.logCode,
      skipTransitionCheck: normalizeBoolean(source.skipTransitionCheck, false)
    });

    const artifact = normalizeBoolean(hasOwn(source, 'buildArtifact') ? source.buildArtifact : true, true)
      ? await buildCurrentStageArtifact({
          stage: normalizeWorkflowStateFromAny(workflow).stage
        })
      : null;

    return deepFreeze({
      workflow: cloneValue(workflow),
      stageArtifact: artifact ? cloneValue(artifact) : null
    });
  }

  function subscribe(listener, options) {
    if (typeof stateStore.subscribe === 'function') {
      return stateStore.subscribe(listener, options);
    }

    throw createOrchestratorError(
      ERROR_CODES.INVALID_STATE || 'INVALID_STATE',
      'State store subscriptions are unavailable.',
      createNullObject()
    );
  }

  const api = {
    eventTypes: ORCHESTRATOR_EVENT_TYPES,
    initialize: ensureInitialized,
    ensureInitialized: ensureInitialized,
    getBootstrapState: getBootstrapState,
    getDashboardState: getDashboardState,
    getWorkflowState: getWorkflowState,
    getEventLog: getEventLog,
    loadIssues: loadIssues,
    loadRepositoryTree: loadRepositoryTree,
    selectIssue: selectIssue,
    buildDesignArtifact: buildDesignArtifact,
    buildExecutionArtifact: buildExecutionArtifact,
    buildAuditArtifact: buildAuditArtifact,
    preparePullRequest: preparePullRequest,
    createPullRequest: createPullRequest,
    buildCurrentStageArtifact: buildCurrentStageArtifact,
    submitHumanPayload: submitHumanPayload,
    advanceStage: advanceStage,
    resetWorkflow: resetWorkflow,
    clearError: clearError,
    subscribe: subscribe,
    getCachedStageArtifact: getCachedStageArtifact,
    getLastSubmission: getLastSubmission,
    helpers: deepFreeze({
      buildRepositoryDescriptor: buildRepositoryDescriptor,
      normalizeIssueInput: normalizeIssueInput,
      normalizeWorkflowStateFromAny: normalizeWorkflowStateFromAny,
      normalizeSelectedProviderIds: normalizeSelectedProviderIds,
      resolveProviderForRole: resolveProviderForRole,
      inferRoleFromStage: inferRoleFromStage,
      nextStageAfter: nextStageAfter,
      normalizeTaskFilePath: normalizeTaskFilePath,
      normalizeGitRef: normalizeGitRef,
      normalizeReviewDecision: normalizeReviewDecision,
      normalizeLastParsedPayloadRecord: normalizeLastParsedPayloadRecord,
      buildSuggestedWorkingBranch: buildSuggestedWorkingBranch,
      resolveRepositoryFromBootstrap: resolveRepositoryFromBootstrap,
      resolveIssueForContext: resolveIssueForContext,
      resolveTargetFile: resolveTargetFile,
      resolveWorkingBranch: resolveWorkingBranch,
      parseExecutionSubmission: parseExecutionSubmission,
      parseAuditSubmission: parseAuditSubmission,
      parsePullRequestReference: parsePullRequestReference,
      extractTargetFileFromDesignText: extractTargetFileFromDesignText,
      buildIssueListCacheKey: buildIssueListCacheKey,
      buildTreeCacheKey: buildTreeCacheKey,
      cacheIssueList: cacheIssueList,
      cacheIssueItem: cacheIssueItem,
      findCachedIssue: findCachedIssue,
      findCachedIssueList: findCachedIssueList,
      cacheTree: cacheTree,
      findCachedTree: findCachedTree,
      createOrchestratorError: createOrchestratorError,
      isOrchestratorError: isOrchestratorError,
      normalizeOrchestratorError: normalizeOrchestratorError
    })
  };

  try {
    logger.debug('Orchestrator module registered.', {
      protocolVersion: DEFAULT_PROTOCOL_VERSION,
      stages: [STAGE_IDLE, STAGE_DESIGN, STAGE_EXECUTION, STAGE_AUDIT, STAGE_PR, STAGE_COMPLETED, STAGE_ERROR],
      providerIds: PROVIDER_IDS.slice()
    });
  } catch (error) {
  }

  root.registerValue('orchestrator', deepFreeze(api), {
    overwrite: false,
    freeze: false,
    clone: false
  });
}(typeof globalThis !== 'undefined'
  ? globalThis
  : (typeof self !== 'undefined'
      ? self
      : (typeof window !== 'undefined' ? window : this))));