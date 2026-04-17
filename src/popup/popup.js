(function registerMAOEPopup(globalScope) {
  'use strict';

  const root = globalScope.MAOE;

  if (!root || typeof root.registerValue !== 'function') {
    throw new Error('[MAOE] namespace.js must be loaded before popup.js.');
  }

  if (root.has('popup')) {
    return;
  }

  const constants = root.require('constants');
  const storage = root.require('storage');
  const util = root.util || Object.create(null);

  const baseLogger = root.has('logger') ? root.require('logger') : null;
  const logger = baseLogger && typeof baseLogger.createScope === 'function'
    ? baseLogger.createScope('popup')
    : (baseLogger || createFallbackLogger());

  const protocol = root.has('protocol') ? root.require('protocol') : null;
  const payloadParser = root.has('ai_payload_parser') ? root.require('ai_payload_parser') : null;

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
    : function passthrough(value) { return value; };

  const safeJsonStringify = typeof util.safeJsonStringify === 'function'
    ? util.safeJsonStringify
    : function fallbackStringify(value, space) {
        try {
          return JSON.stringify(value, null, typeof space === 'number' ? space : 2);
        } catch (error) {
          return '';
        }
      };

  const safeJsonParse = typeof util.safeJsonParse === 'function'
    ? util.safeJsonParse
    : function fallbackParse(text, fallbackValue) {
        try {
          return JSON.parse(text);
        } catch (error) {
          return typeof fallbackValue === 'undefined' ? null : fallbackValue;
        }
      };

  const MESSAGE_TYPES = (constants.MESSAGING && constants.MESSAGING.TYPES) || Object.create(null);
  const STAGES = (constants.WORKFLOW && constants.WORKFLOW.STAGES) || Object.create(null);
  const STATUSES = (constants.WORKFLOW && constants.WORKFLOW.STATUSES) || Object.create(null);
  const PROVIDERS = constants.PROVIDERS || Object.create(null);
  const UI_LABELS = (constants.UI && constants.UI.LABELS) || Object.create(null);
  const STORAGE_KEYS = constants.STORAGE_KEYS || Object.create(null);
  const STORAGE_AREAS = constants.STORAGE_AREAS || Object.create(null);
  const ERROR_CODES = constants.ERROR_CODES || Object.create(null);
  const MANUAL_HUB = constants.MANUAL_HUB || Object.create(null);

  const STAGE_IDLE = STAGES.IDLE || 'idle';
  const STAGE_DESIGN = STAGES.DESIGN || 'design';
  const STAGE_EXECUTION = STAGES.EXECUTION || 'execution';
  const STAGE_AUDIT = STAGES.AUDIT || 'audit';
  const STAGE_PR = STAGES.PR || 'pr';
  const STAGE_COMPLETED = STAGES.COMPLETED || 'completed';
  const STAGE_ERROR = STAGES.ERROR || 'error';

  const STATUS_IDLE = STATUSES.IDLE || 'idle';
  const STATUS_READY = STATUSES.READY || 'ready';
  const STATUS_IN_PROGRESS = STATUSES.IN_PROGRESS || 'in_progress';
  const STATUS_AWAITING_HUMAN = STATUSES.AWAITING_HUMAN || 'awaiting_human';
  const STATUS_APPROVED = STATUSES.APPROVED || 'approved';
  const STATUS_REJECTED = STATUSES.REJECTED || 'rejected';
  const STATUS_COMPLETED = STATUSES.COMPLETED || 'completed';

  const STORAGE_AREA_LOCAL = STORAGE_AREAS.LOCAL || 'local';

  function createFallbackLogger() {
    const noop = function noop() {};
    return { debug: noop, info: noop, warn: noop, error: noop };
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

  function coerceText(value) {
    if (typeof value === 'string') {
      return value;
    }
    if (value === null || typeof value === 'undefined') {
      return '';
    }
    return String(value);
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

  function normalizeBoolean(value, fallbackValue) {
    if (typeof value === 'boolean') {
      return value;
    }
    if (typeof value === 'number') {
      return value !== 0;
    }
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (normalized === 'true' || normalized === '1' || normalized === 'yes') return true;
      if (normalized === 'false' || normalized === '0' || normalized === 'no') return false;
    }
    return typeof fallbackValue === 'boolean' ? fallbackValue : false;
  }

  function nowIsoString() {
    return new Date().toISOString();
  }

  function generateRequestId(prefix) {
    const base = typeof prefix === 'string' && prefix ? prefix : 'popup';
    const time = Date.now().toString(36);
    const rand = Math.random().toString(36).slice(2, 10);
    return base + '_' + time + '_' + rand;
  }

  function normalizePopupError(error, fallbackMessage) {
    const fallback = typeof fallbackMessage === 'string' && fallbackMessage
      ? fallbackMessage
      : 'Unexpected popup error.';

    if (error && typeof error === 'object') {
      return {
        code: normalizeString(error.code) || (ERROR_CODES.UNKNOWN_ERROR || 'UNKNOWN_ERROR'),
        message: normalizeString(error.message) || fallback,
        details: isPlainObject(error.details) ? cloneValue(error.details) : Object.create(null)
      };
    }

    if (typeof error === 'string' && error) {
      return {
        code: ERROR_CODES.UNKNOWN_ERROR || 'UNKNOWN_ERROR',
        message: error,
        details: Object.create(null)
      };
    }

    return {
      code: ERROR_CODES.UNKNOWN_ERROR || 'UNKNOWN_ERROR',
      message: fallback,
      details: Object.create(null)
    };
  }

  const runtimeState = root.ensureState('popup', function initializePopupRuntimeState() {
    return {
      initialized: false,
      initializingPromise: null,
      bindingsInstalled: false,
      lastStatusText: '',
      lastError: null,
      bootstrap: null,
      workflow: null,
      stageArtifact: null,
      tabContexts: [],
      eventLog: [],
      issues: {
        items: [],
        filter: '',
        selectedNumber: null,
        includePulls: false,
        lastQuery: null,
        total: 0
      },
      repository: {
        tree: null,
        pathPrefix: ''
      },
      manualHub: {
        lastPacketType: '',
        lastPacketText: '',
        lastResponseText: '',
        clipboardFormat: 'json'
      },
      manualResponsePreview: null,
      transientPreferences: {
        showDebugLog: false,
        includeIssueBody: true,
        includeTree: true,
        activeTab: 'dashboard'
      },
      dirty: {
        treePathPrefix: false,
        targetFile: false,
        manualPacket: false,
        manualResponse: false
      },
      busy: Object.create(null),
      domCache: null
    };
  });

  function ensureRuntimeState() {
    return runtimeState;
  }

  const DOM_ID_MAP = {
    appShell: 'app-shell',
    appTitle: 'app-title',
    appSubtitle: 'app-subtitle',
    refreshBootstrapButton: 'refresh-bootstrap-button',
    globalStatusBanner: 'global-status-banner',
    globalStatusText: 'global-status-text',
    globalErrorBanner: 'global-error-banner',
    globalErrorCode: 'global-error-code',
    globalErrorText: 'global-error-text',
    dismissGlobalErrorButton: 'dismiss-global-error-button',
    tabDashboardButton: 'tab-dashboard-button',
    tabSettingsButton: 'tab-settings-button',
    tabManualHubButton: 'tab-manual-hub-button',
    panelDashboard: 'panel-dashboard',
    panelSettings: 'panel-settings',
    panelManualHub: 'panel-manual_hub',
    refreshWorkflowButton: 'refresh-workflow-button',
    workflowStageValue: 'workflow-stage-value',
    workflowStatusValue: 'workflow-status-value',
    workflowActiveProviderValue: 'workflow-active-provider-value',
    workflowTargetFileValue: 'workflow-target-file-value',
    workflowWorkingBranchValue: 'workflow-working-branch-value',
    workflowPullRequestValue: 'workflow-pull-request-value',
    workflowStagePipeline: 'workflow-stage-pipeline',
    workflowDesignerProviderValue: 'workflow-designer-provider-value',
    workflowExecutorProviderValue: 'workflow-executor-provider-value',
    workflowAuditorProviderValue: 'workflow-auditor-provider-value',
    workflowLastTransitionValue: 'workflow-last-transition-value',
    workflowLastHumanActionValue: 'workflow-last-human-action-value',
    workflowCurrentIssueValue: 'workflow-current-issue-value',
    workflowCurrentIssueLink: 'workflow-current-issue-link',
    workflowAuditVerdictValue: 'workflow-audit-verdict-value',
    workflowAuditSummaryValue: 'workflow-audit-summary-value',
    workflowErrorCodeValue: 'workflow-error-code-value',
    buildCurrentArtifactButton: 'build-current-artifact-button',
    advanceStageButton: 'advance-stage-button',
    createPullRequestButton: 'create-pull-request-button',
    resetWorkflowButton: 'reset-workflow-button',
    loadRepoTreeButton: 'load-repo-tree-button',
    repositoryOwnerValue: 'repository-owner-value',
    repositoryRepoValue: 'repository-repo-value',
    repositoryFullNameValue: 'repository-full-name-value',
    repositoryBaseBranchValue: 'repository-base-branch-value',
    repositoryDefaultBranchValue: 'repository-default-branch-value',
    repositoryLink: 'repository-link',
    repositoryTreeBranchValue: 'repository-tree-branch-value',
    repositoryTreeShaValue: 'repository-tree-sha-value',
    repositoryTreeEntryCountValue: 'repository-tree-entry-count-value',
    repositoryTreePartialValue: 'repository-tree-partial-value',
    repositoryTreeLoadedAtValue: 'repository-tree-loaded-at-value',
    treePathPrefixInput: 'tree-path-prefix-input',
    repositoryTreeTextarea: 'repository-tree-textarea',
    loadIssuesButton: 'load-issues-button',
    refreshIssuesButton: 'refresh-issues-button',
    issueStateSelect: 'issue-state-select',
    issueSortSelect: 'issue-sort-select',
    issueDirectionSelect: 'issue-direction-select',
    issueFilterInput: 'issue-filter-input',
    issuesCountLabel: 'issues-count-label',
    issuesIncludePullsCheckbox: 'issues-include-pulls-checkbox',
    issuesTable: 'issues-table',
    issuesTableBody: 'issues-table-body',
    issueRowTemplate: 'issue-row-template',
    selectedIssueHeaderValue: 'selected-issue-header-value',
    selectedIssueStateValue: 'selected-issue-state-value',
    selectedIssueLabelsValue: 'selected-issue-labels-value',
    selectedIssueLink: 'selected-issue-link',
    selectedTargetFileInput: 'selected-target-file-input',
    selectIssueButton: 'select-issue-button',
    buildDesignArtifactButton: 'build-design-artifact-button',
    selectedIssueBodyTextarea: 'selected-issue-body-textarea',
    probeActiveTabButton: 'probe-active-tab-button',
    sendPromptToActiveTabButton: 'send-prompt-to-active-tab-button',
    stageArtifactKindValue: 'stage-artifact-kind-value',
    stageArtifactStageValue: 'stage-artifact-stage-value',
    stageArtifactProviderValue: 'stage-artifact-provider-value',
    stageArtifactTargetFileValue: 'stage-artifact-target-file-value',
    stageArtifactValidValue: 'stage-artifact-valid-value',
    stageArtifactWarningCountValue: 'stage-artifact-warning-count-value',
    stageArtifactPromptLengthValue: 'stage-artifact-prompt-length-value',
    stageArtifactPacketLengthValue: 'stage-artifact-packet-length-value',
    stageArtifactIssueValue: 'stage-artifact-issue-value',
    stageArtifactRepositoryValue: 'stage-artifact-repository-value',
    stageArtifactPromptTextarea: 'stage-artifact-prompt-textarea',
    copyStageArtifactPromptButton: 'copy-stage-artifact-prompt-button',
    buildManualPacketFromArtifactButton: 'build-manual-packet-from-artifact-button',
    stageArtifactPacketTextarea: 'stage-artifact-packet-textarea',
    copyStageArtifactPacketButton: 'copy-stage-artifact-packet-button',
    copyStageArtifactBothButton: 'copy-stage-artifact-both-button',
    refreshTabContextsButton: 'refresh-tab-contexts-button',
    tabContextList: 'tab-context-list',
    tabContextItemTemplate: 'tab-context-item-template',
    refreshEventLogButton: 'refresh-event-log-button',
    showDebugLogCheckbox: 'show-debug-log-checkbox',
    eventLogList: 'event-log-list',
    eventLogItemTemplate: 'event-log-item-template',
    settingsForm: 'settings-form',
    githubPatInput: 'github-pat-input',
    githubTokenTypeInput: 'github-token-type-input',
    githubUsernameOutput: 'github-username-output',
    githubLastValidatedOutput: 'github-last-validated-output',
    validateGitHubButton: 'validate-github-button',
    saveGitHubSettingsButton: 'save-github-settings-button',
    clearGitHubTokenButton: 'clear-github-token-button',
    repositoryOwnerInput: 'repository-owner-input',
    repositoryRepoInput: 'repository-repo-input',
    repositoryBaseBranchInput: 'repository-base-branch-input',
    repositoryWorkingBranchPrefixInput: 'repository-working-branch-prefix-input',
    repositoryIssueStateSelect: 'repository-issue-state-select',
    repositoryIssueSortSelect: 'repository-issue-sort-select',
    repositoryIssueDirectionSelect: 'repository-issue-direction-select',
    githubApiBaseUrlInput: 'github-api-base-url-input',
    githubRequestTimeoutInput: 'github-request-timeout-input',
    settingsRepositoryFullNameValue: 'settings-repository-full-name-value',
    settingsRepositoryDefaultBranchValue: 'settings-repository-default-branch-value',
    settingsRepositoryVisibilityValue: 'settings-repository-visibility-value',
    settingsRepositoryLink: 'settings-repository-link',
    designerProviderSelect: 'designer-provider-select',
    executorProviderSelect: 'executor-provider-select',
    auditorProviderSelect: 'auditor-provider-select',
    settingsCurrentActiveProviderValue: 'settings-current-active-provider-value',
    settingsCurrentStageValue: 'settings-current-stage-value',
    settingsActiveTabSelect: 'settings-active-tab-select',
    settingsShowDebugLogCheckbox: 'settings-show-debug-log-checkbox',
    settingsIncludeIssueBodyCheckbox: 'settings-include-issue-body-checkbox',
    settingsIncludeTreeCheckbox: 'settings-include-tree-checkbox',
    saveAllSettingsButton: 'save-all-settings-button',
    reloadBootstrapButton: 'reload-bootstrap-button',
    buildManualPacketButton: 'build-manual-packet-button',
    copyManualPacketButton: 'copy-manual-packet-button',
    manualHubStageValue: 'manual-hub-stage-value',
    manualHubProviderValue: 'manual-hub-provider-value',
    manualHubTargetFileValue: 'manual-hub-target-file-value',
    manualHubPacketLengthValue: 'manual-hub-packet-length-value',
    manualHubPacketTypeSelect: 'manual-hub-packet-type-select',
    manualHubPacketTextarea: 'manual-hub-packet-textarea',
    validateManualPacketButton: 'validate-manual-packet-button',
    copyManualHubPacketButton: 'copy-manual-hub-packet-button',
    extractFromActiveTabButton: 'extract-from-active-tab-button',
    submitManualResponseButton: 'submit-manual-response-button',
    manualResponseKindSelect: 'manual-response-kind-select',
    manualResponseAutoSubmitCheckbox: 'manual-response-auto-submit-checkbox',
    manualResponseTextarea: 'manual-response-textarea',
    previewManualResponseButton: 'preview-manual-response-button',
    submitManualResponseConfirmButton: 'submit-manual-response-confirm-button',
    manualResponsePreviewTextarea: 'manual-response-preview-textarea',
    manualTargetStageSelect: 'manual-target-stage-select',
    manualTargetStatusSelect: 'manual-target-status-select',
    manualApplyStageStateButton: 'manual-apply-stage-state-button',
    manualMarkReadyButton: 'manual-mark-ready-button',
    manualMarkInProgressButton: 'manual-mark-in-progress-button',
    manualMarkAwaitHumanButton: 'manual-mark-await-human-button',
    manualMarkApprovedButton: 'manual-mark-approved-button',
    manualMarkRejectedButton: 'manual-mark-rejected-button',
    manualMarkCompletedButton: 'manual-mark-completed-button',
    manualClearErrorButton: 'manual-clear-error-button',
    footerVersionLabel: 'footer-version-label',
    footerRuntimeLabel: 'footer-runtime-label',
    liveRegion: 'live-region'
  };

  function getDom() {
    if (runtimeState.domCache) {
      return runtimeState.domCache;
    }

    const doc = globalScope.document;

    if (!doc || typeof doc.getElementById !== 'function') {
      throw new Error('[MAOE/popup] document.getElementById is not available.');
    }

    const cache = Object.create(null);

    for (const key of Object.keys(DOM_ID_MAP)) {
      cache[key] = doc.getElementById(DOM_ID_MAP[key]);
    }

    cache.stageChips = {
      idle: doc.getElementById('stage-chip-idle'),
      design: doc.getElementById('stage-chip-design'),
      execution: doc.getElementById('stage-chip-execution'),
      audit: doc.getElementById('stage-chip-audit'),
      pr: doc.getElementById('stage-chip-pr'),
      completed: doc.getElementById('stage-chip-completed'),
      error: doc.getElementById('stage-chip-error')
    };

    cache.tabButtons = [cache.tabDashboardButton, cache.tabSettingsButton, cache.tabManualHubButton];
    cache.tabPanels = [cache.panelDashboard, cache.panelSettings, cache.panelManualHub];

    runtimeState.domCache = cache;
    return cache;
  }

  function setTextContent(element, text) {
    if (element && 'textContent' in element) {
      element.textContent = coerceText(text);
    }
  }

  function setHiddenAttribute(element, hidden) {
    if (!element) {
      return;
    }
    if (hidden) {
      element.setAttribute('hidden', '');
    } else {
      element.removeAttribute('hidden');
    }
  }

  function showStatus(level, text) {
    const dom = getDom();
    const normalizedLevel = normalizeString(level) || 'info';
    const message = coerceText(text);
    runtimeState.lastStatusText = message;

    if (dom.globalStatusBanner) {
      dom.globalStatusBanner.dataset.level = normalizedLevel;
    }

    setTextContent(dom.globalStatusText, message);
  }

  function clearErrorBanner() {
    const dom = getDom();
    runtimeState.lastError = null;
    setHiddenAttribute(dom.globalErrorBanner, true);
    setTextContent(dom.globalErrorCode, 'ERROR');
    setTextContent(dom.globalErrorText, '');
  }

  function showErrorBanner(error) {
    const dom = getDom();
    const normalized = normalizePopupError(error, 'Unexpected popup error.');
    runtimeState.lastError = cloneValue(normalized);
    setTextContent(dom.globalErrorCode, normalized.code);
    setTextContent(dom.globalErrorText, normalized.message);
    setHiddenAttribute(dom.globalErrorBanner, false);
  }

  function announce(message) {
    const dom = getDom();
    setTextContent(dom.liveRegion, coerceText(message));
  }

  function resolveChromeRuntime() {
    if (typeof chrome === 'undefined' || !chrome) {
      return null;
    }
    return chrome.runtime || null;
  }

  function resolveChromeTabs() {
    if (typeof chrome === 'undefined' || !chrome) {
      return null;
    }
    return chrome.tabs || null;
  }

  function extractRuntimeLastError(runtime) {
    if (!runtime || !runtime.lastError) {
      return null;
    }
    const messageText = runtime.lastError.message
      ? String(runtime.lastError.message)
      : 'chrome.runtime.lastError';
    return {
      code: ERROR_CODES.MESSAGE_DELIVERY_FAILED || 'MESSAGE_DELIVERY_FAILED',
      message: messageText,
      details: Object.create(null)
    };
  }

  function normalizeResponseEnvelope(response, requestMeta) {
    if (!isPlainObject(response)) {
      return {
        status: 'error',
        requestId: requestMeta.requestId,
        type: requestMeta.type,
        error: {
          code: ERROR_CODES.MESSAGE_DELIVERY_FAILED || 'MESSAGE_DELIVERY_FAILED',
          message: 'Empty response received from service worker.',
          details: Object.create(null)
        },
        data: null,
        meta: Object.create(null)
      };
    }
    return {
      status: response.status === 'error' ? 'error' : 'ok',
      requestId: normalizeString(response.requestId) || requestMeta.requestId,
      type: normalizeString(response.type) || requestMeta.type,
      data: typeof response.data === 'undefined' ? null : cloneValue(response.data),
      error: isPlainObject(response.error) ? cloneValue(response.error) : null,
      meta: isPlainObject(response.meta) ? cloneValue(response.meta) : Object.create(null)
    };
  }

  function sendBackgroundMessage(type, payload, meta) {
    const runtime = resolveChromeRuntime();
    const requestMeta = {
      requestId: generateRequestId('popup'),
      type: normalizeString(type)
    };

    if (!requestMeta.type) {
      return Promise.reject(normalizePopupError({
        code: ERROR_CODES.MESSAGE_UNSUPPORTED || 'MESSAGE_UNSUPPORTED',
        message: 'Cannot send a message without a type.'
      }, 'Cannot send a message without a type.'));
    }

    if (!runtime || typeof runtime.sendMessage !== 'function') {
      return Promise.reject(normalizePopupError({
        code: ERROR_CODES.MESSAGE_DELIVERY_FAILED || 'MESSAGE_DELIVERY_FAILED',
        message: 'chrome.runtime.sendMessage is not available.'
      }, 'chrome.runtime.sendMessage is not available.'));
    }

    const envelope = {
      type: requestMeta.type,
      requestId: requestMeta.requestId,
      payload: typeof payload === 'undefined' ? null : cloneValue(payload),
      meta: isPlainObject(meta) ? cloneValue(meta) : Object.create(null)
    };

    return new Promise(function executor(resolve, reject) {
      let settled = false;

      function settle(fn, value) {
        if (settled) {
          return;
        }
        settled = true;
        fn(value);
      }

      try {
        runtime.sendMessage(envelope, function onResponse(response) {
          const lastError = extractRuntimeLastError(runtime);
          if (lastError) {
            settle(reject, normalizePopupError(lastError, lastError.message));
            return;
          }
          const normalized = normalizeResponseEnvelope(response, requestMeta);
          if (normalized.status === 'error') {
            settle(reject, normalizePopupError(normalized.error, 'Service worker returned an error.'));
            return;
          }
          settle(resolve, normalized.data);
        });
      } catch (error) {
        settle(reject, normalizePopupError(error, 'Failed to send background message.'));
      }
    });
  }

  function sendTabMessage(tabId, type, payload, meta) {
    const tabs = resolveChromeTabs();
    const runtime = resolveChromeRuntime();
    const numericTabId = normalizeIntegerOrNull(tabId);
    const requestMeta = {
      requestId: generateRequestId('popup_tab'),
      type: normalizeString(type)
    };

    if (numericTabId === null) {
      return Promise.reject(normalizePopupError({
        code: ERROR_CODES.TAB_NOT_FOUND || 'TAB_NOT_FOUND',
        message: 'Missing tab id for tab message.'
      }, 'Missing tab id for tab message.'));
    }
    if (!requestMeta.type) {
      return Promise.reject(normalizePopupError({
        code: ERROR_CODES.MESSAGE_UNSUPPORTED || 'MESSAGE_UNSUPPORTED',
        message: 'Cannot send a tab message without a type.'
      }, 'Cannot send a tab message without a type.'));
    }
    if (!tabs || typeof tabs.sendMessage !== 'function') {
      return Promise.reject(normalizePopupError({
        code: ERROR_CODES.MESSAGE_DELIVERY_FAILED || 'MESSAGE_DELIVERY_FAILED',
        message: 'chrome.tabs.sendMessage is not available.'
      }, 'chrome.tabs.sendMessage is not available.'));
    }

    const envelope = {
      type: requestMeta.type,
      requestId: requestMeta.requestId,
      payload: typeof payload === 'undefined' ? null : cloneValue(payload),
      meta: isPlainObject(meta) ? cloneValue(meta) : Object.create(null)
    };

    return new Promise(function executor(resolve, reject) {
      let settled = false;
      function settle(fn, value) {
        if (settled) { return; }
        settled = true;
        fn(value);
      }
      try {
        tabs.sendMessage(numericTabId, envelope, function onResponse(response) {
          const lastError = extractRuntimeLastError(runtime);
          if (lastError) {
            settle(reject, normalizePopupError(lastError, lastError.message));
            return;
          }
          const normalized = normalizeResponseEnvelope(response, requestMeta);
          if (normalized.status === 'error') {
            settle(reject, normalizePopupError(normalized.error, 'Tab returned an error.'));
            return;
          }
          settle(resolve, normalized.data);
        });
      } catch (error) {
        settle(reject, normalizePopupError(error, 'Failed to send tab message.'));
      }
    });
  }

  function markBusy(key, flag) {
    const normalizedKey = normalizeString(key);
    if (!normalizedKey) {
      return;
    }
    if (flag) {
      runtimeState.busy[normalizedKey] = true;
    } else {
      delete runtimeState.busy[normalizedKey];
    }
  }

  function isBusy(key) {
    const normalizedKey = normalizeString(key);
    if (!normalizedKey) {
      return false;
    }
    return runtimeState.busy[normalizedKey] === true;
  }

  async function runBusy(key, fn) {
    const normalizedKey = normalizeString(key) || 'default';
    if (isBusy(normalizedKey)) {
      logger.debug('runBusy skipped (already busy).', { key: normalizedKey });
      return null;
    }
    markBusy(normalizedKey, true);
    try {
      return await fn();
    } finally {
      markBusy(normalizedKey, false);
    }
  }

  function withErrorHandling(fn, options) {
    const opts = isPlainObject(options) ? options : Object.create(null);
    const busyKey = normalizeString(opts.busyKey);
    const suppressRender = opts.suppressRender === true;
    const fallbackMessage = normalizeString(opts.fallbackMessage) || 'Operation failed.';

    return async function wrapped() {
      try {
        const runner = function runner() {
          return Promise.resolve(fn.apply(null, arguments));
        };
        const invoker = busyKey
          ? function invokeWithBusy() { return runBusy(busyKey, runner); }
          : runner;
        clearErrorBanner();
        const result = await invoker();
        if (!suppressRender && typeof renderAll === 'function') {
          try {
            renderAll();
          } catch (renderError) {
            logger.warn('renderAll failed after operation.', normalizePopupError(renderError, 'renderAll failed.'));
          }
        }
        return result;
      } catch (error) {
        const normalized = normalizePopupError(error, fallbackMessage);
        logger.error('Popup action failed.', normalized);
        showErrorBanner(normalized);
        announce(normalized.message);
        if (!suppressRender && typeof renderAll === 'function') {
          try {
            renderAll();
          } catch (renderError) {
            logger.warn('renderAll failed after error.', normalizePopupError(renderError, 'renderAll failed.'));
          }
        }
        return null;
      }
    };
  }

  function isBroadcastMessage(message) {
    return isPlainObject(message) && message.__maoeBroadcast === true;
  }

  function handleBroadcastMessage(message) {
    if (!isBroadcastMessage(message)) {
      return;
    }
    const type = normalizeString(message.type);
    const payload = isPlainObject(message.payload) ? cloneValue(message.payload) : null;
    logger.debug('Broadcast received.', { type: type });

    if (type === (MESSAGE_TYPES.BACKGROUND_STATE_CHANGED || 'BACKGROUND/STATE_CHANGED')) {
      if (payload && isPlainObject(payload.workflow)) {
        runtimeState.workflow = cloneValue(payload.workflow);
      }
      if (payload && Array.isArray(payload.eventLog)) {
        runtimeState.eventLog = cloneValue(payload.eventLog);
      }
      try {
        renderAll();
      } catch (error) {
        logger.warn('renderAll after broadcast failed.', normalizePopupError(error, 'renderAll failed.'));
      }
      return;
    }

    if (type === (MESSAGE_TYPES.WORKFLOW_STATE_UPDATED || 'WORKFLOW/STATE_UPDATED')) {
      if (payload && isPlainObject(payload.workflow)) {
        runtimeState.workflow = cloneValue(payload.workflow);
      }
      try {
        renderAll();
      } catch (error) {
        logger.warn('renderAll after workflow update failed.', normalizePopupError(error, 'renderAll failed.'));
      }
      return;
    }

    if (type === (MESSAGE_TYPES.EVENT_LOG_APPENDED || 'EVENT_LOG/APPENDED')) {
      if (payload && Array.isArray(payload.entries)) {
        const existing = Array.isArray(runtimeState.eventLog) ? runtimeState.eventLog.slice() : [];
        runtimeState.eventLog = existing.concat(cloneValue(payload.entries));
      }
      try {
        renderAll();
      } catch (error) {
        logger.warn('renderAll after event log append failed.', normalizePopupError(error, 'renderAll failed.'));
      }
    }
  }

  function installRuntimeMessageListener() {
    const runtime = resolveChromeRuntime();
    if (!runtime || !runtime.onMessage || typeof runtime.onMessage.addListener !== 'function') {
      return false;
    }
    if (runtimeState.listenerInstalled) {
      return true;
    }
    runtime.onMessage.addListener(function onPopupRuntimeMessage(message) {
      try {
        handleBroadcastMessage(message);
      } catch (error) {
        logger.warn('Broadcast handler failed.', normalizePopupError(error, 'Broadcast handler failed.'));
      }
      return false;
    });
    runtimeState.listenerInstalled = true;
    return true;
  }

  // Render/action/binding implementations are appended in subsequent parts.
  function renderAll() {}
  async function refreshBootstrap() { return null; }
  async function refreshWorkflow() { return null; }
  async function refreshEventLog() { return null; }
  async function loadIssues() { return null; }
  async function loadRepositoryTree() { return null; }
  async function applyIssueSelection() { return null; }
  async function buildCurrentArtifact() { return null; }
  async function buildDesignArtifact() { return null; }
  async function advanceStage() { return null; }
  async function resetWorkflow() { return null; }
  async function clearWorkflowError() { return null; }
  async function createPullRequestNow() { return null; }
  function previewManualResponseResult() { return cloneValue(runtimeState.manualResponsePreview); }

  const popupApi = deepFreeze({
    initialize: async function initialize() { return runtimeState; },
    refreshBootstrap: refreshBootstrap,
    refreshWorkflow: refreshWorkflow,
    refreshEventLog: refreshEventLog,
    loadIssues: loadIssues,
    loadRepositoryTree: loadRepositoryTree,
    applyIssueSelection: applyIssueSelection,
    buildCurrentArtifact: buildCurrentArtifact,
    buildDesignArtifact: buildDesignArtifact,
    advanceStage: advanceStage,
    resetWorkflow: resetWorkflow,
    clearWorkflowError: clearWorkflowError,
    createPullRequestNow: createPullRequestNow,
    previewManualResponseResult: previewManualResponseResult,
    getRuntimeState: function getRuntimeState() { return cloneValue(runtimeState); }
  });

  root.registerValue('popup', popupApi, {
    overwrite: false,
    freeze: false,
    clone: false
  });
}(typeof globalThis !== 'undefined'
  ? globalThis
  : (typeof self !== 'undefined'
      ? self
      : (typeof window !== 'undefined' ? window : this))));
