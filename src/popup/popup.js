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

  // --- Part D: Renderers ---

  function formatDisplayText(value, fallback) {
    const text = coerceText(value).trim();
    if (text) {
      return text;
    }
    return typeof fallback === 'string' ? fallback : '—';
  }

  function formatTimestamp(isoText) {
    const trimmed = normalizeString(isoText);
    if (!trimmed) {
      return '—';
    }
    const parsed = new Date(trimmed);
    if (Number.isNaN(parsed.getTime())) {
      return trimmed;
    }
    try {
      return parsed.toLocaleString();
    } catch (error) {
      return trimmed;
    }
  }

  function setSelectValue(element, value) {
    if (!element || typeof element.value !== 'string') {
      return;
    }
    const target = coerceText(value);
    if (element.value !== target) {
      element.value = target;
    }
  }

  function setCheckboxValue(element, checked) {
    if (!element) {
      return;
    }
    const next = checked === true;
    if (element.checked !== next) {
      element.checked = next;
    }
  }

  function setInputValueIfClean(element, value, dirtyFlag) {
    if (!element) {
      return;
    }
    if (dirtyFlag) {
      return;
    }
    const next = coerceText(value);
    if (element.value !== next) {
      element.value = next;
    }
  }

  function setAnchorHref(element, href) {
    if (!element) {
      return;
    }
    const target = normalizeString(href);
    if (target) {
      element.setAttribute('href', target);
      element.removeAttribute('aria-disabled');
      if (element.tagName === 'A') {
        element.style.pointerEvents = '';
      }
    } else {
      element.setAttribute('href', '#');
      element.setAttribute('aria-disabled', 'true');
      if (element.tagName === 'A') {
        element.style.pointerEvents = 'none';
      }
    }
  }

  function clearChildren(element) {
    if (!element) {
      return;
    }
    while (element.firstChild) {
      element.removeChild(element.firstChild);
    }
  }

  function cloneTemplateContent(template) {
    if (!template || !template.content) {
      return null;
    }
    const clone = template.content.cloneNode(true);
    return clone.firstElementChild ? clone : null;
  }

  function renderWorkflow() {
    const dom = getDom();
    const workflow = isPlainObject(runtimeState.workflow) ? runtimeState.workflow : null;
    const stage = workflow ? normalizeString(workflow.stage) : STAGE_IDLE;
    const status = workflow ? normalizeString(workflow.status) : STATUS_IDLE;

    setTextContent(dom.workflowStageValue, formatDisplayText(stage, STAGE_IDLE));
    setTextContent(dom.workflowStatusValue, formatDisplayText(status, STATUS_IDLE));
    setTextContent(dom.workflowActiveProviderValue, formatDisplayText(workflow && workflow.activeProviderId, '—'));
    setTextContent(dom.workflowTargetFileValue, formatDisplayText(workflow && workflow.currentTaskFilePath, '—'));
    setTextContent(dom.workflowWorkingBranchValue, formatDisplayText(workflow && workflow.workingBranch, '—'));

    const prText = workflow && workflow.pullRequestNumber !== null && typeof workflow.pullRequestNumber !== 'undefined'
      ? '#' + String(workflow.pullRequestNumber)
      : formatDisplayText(workflow && workflow.pullRequestUrl, '—');
    setTextContent(dom.workflowPullRequestValue, prText);

    if (dom.stageChips) {
      const chipStages = [STAGE_IDLE, STAGE_DESIGN, STAGE_EXECUTION, STAGE_AUDIT, STAGE_PR, STAGE_COMPLETED, STAGE_ERROR];
      for (let index = 0; index < chipStages.length; index += 1) {
        const chipStage = chipStages[index];
        const chipEl = dom.stageChips[chipStage];
        if (!chipEl) {
          continue;
        }
        if (chipStage === stage) {
          chipEl.setAttribute('data-active', 'true');
          chipEl.setAttribute('aria-current', 'step');
        } else {
          chipEl.removeAttribute('data-active');
          chipEl.removeAttribute('aria-current');
        }
      }
    }

    const providers = workflow && isPlainObject(workflow.selectedProviderIds) ? workflow.selectedProviderIds : null;
    setTextContent(dom.workflowDesignerProviderValue, formatDisplayText(providers && providers.designer, '—'));
    setTextContent(dom.workflowExecutorProviderValue, formatDisplayText(providers && providers.executor, '—'));
    setTextContent(dom.workflowAuditorProviderValue, formatDisplayText(providers && providers.auditor, '—'));

    setTextContent(dom.workflowLastTransitionValue, formatTimestamp(workflow && workflow.lastTransitionAt));
    setTextContent(dom.workflowLastHumanActionValue, formatTimestamp(workflow && workflow.lastHumanActionAt));

    const currentIssueNumber = workflow && typeof workflow.currentIssueNumber !== 'undefined' ? workflow.currentIssueNumber : null;
    const currentIssueText = currentIssueNumber === null
      ? '—'
      : '#' + String(currentIssueNumber) + ' ' + formatDisplayText(workflow && workflow.currentIssueTitle, '(untitled)');
    setTextContent(dom.workflowCurrentIssueValue, currentIssueText);
    setAnchorHref(dom.workflowCurrentIssueLink, workflow && workflow.currentIssueUrl);

    setTextContent(dom.workflowAuditVerdictValue, formatDisplayText(workflow && workflow.latestAuditVerdict, '—'));
    setTextContent(dom.workflowAuditSummaryValue, formatDisplayText(workflow && workflow.latestAuditSummary, '—'));
    setTextContent(dom.workflowErrorCodeValue, formatDisplayText(workflow && workflow.lastErrorCode, '—'));
  }

  function renderRepository() {
    const dom = getDom();
    const bootstrap = isPlainObject(runtimeState.bootstrap) ? runtimeState.bootstrap : null;
    const repository = bootstrap && isPlainObject(bootstrap.repository) ? bootstrap.repository : null;
    const tree = isPlainObject(runtimeState.repository) && isPlainObject(runtimeState.repository.tree)
      ? runtimeState.repository.tree
      : null;

    setTextContent(dom.repositoryOwnerValue, formatDisplayText(repository && repository.owner, '—'));
    setTextContent(dom.repositoryRepoValue, formatDisplayText(repository && repository.repo, '—'));
    const fullName = repository && repository.owner && repository.repo
      ? repository.owner + '/' + repository.repo
      : '—';
    setTextContent(dom.repositoryFullNameValue, fullName);
    setTextContent(dom.repositoryBaseBranchValue, formatDisplayText(repository && repository.baseBranch, '—'));
    setTextContent(dom.repositoryDefaultBranchValue, formatDisplayText(repository && repository.defaultBranch, '—'));

    const repoUrl = repository && repository.owner && repository.repo
      ? 'https://github.com/' + repository.owner + '/' + repository.repo
      : '';
    setAnchorHref(dom.repositoryLink, repoUrl);

    setTextContent(dom.repositoryTreeBranchValue, formatDisplayText(tree && tree.branch, '—'));
    setTextContent(dom.repositoryTreeShaValue, formatDisplayText(tree && tree.sha, '—'));
    setTextContent(dom.repositoryTreeEntryCountValue, tree && Array.isArray(tree.entries)
      ? String(tree.entries.length)
      : (tree && typeof tree.entryCount !== 'undefined' ? String(tree.entryCount) : '—'));
    setTextContent(dom.repositoryTreePartialValue, tree && tree.truncated ? 'yes' : (tree ? 'no' : '—'));
    setTextContent(dom.repositoryTreeLoadedAtValue, formatTimestamp(tree && tree.loadedAt));

    setInputValueIfClean(
      dom.treePathPrefixInput,
      runtimeState.repository && runtimeState.repository.pathPrefix,
      runtimeState.dirty && runtimeState.dirty.treePathPrefix
    );

    if (dom.repositoryTreeTextarea) {
      const entries = tree && Array.isArray(tree.entries) ? tree.entries : [];
      const prefix = normalizeString(runtimeState.repository && runtimeState.repository.pathPrefix);
      const lines = [];
      for (let index = 0; index < entries.length; index += 1) {
        const entry = entries[index];
        if (!isPlainObject(entry)) {
          continue;
        }
        const entryPath = normalizeString(entry.path);
        if (!entryPath) {
          continue;
        }
        if (prefix && entryPath.indexOf(prefix) !== 0) {
          continue;
        }
        const tag = entry.type === 'tree' ? 'dir ' : 'file';
        lines.push(tag + ' ' + entryPath);
      }
      dom.repositoryTreeTextarea.value = lines.join('\n');
    }
  }

  function renderIssues() {
    const dom = getDom();
    const issuesState = isPlainObject(runtimeState.issues) ? runtimeState.issues : null;
    const items = issuesState && Array.isArray(issuesState.items) ? issuesState.items : [];
    const filter = issuesState ? normalizeString(issuesState.filter).toLowerCase() : '';
    const includePulls = issuesState ? issuesState.includePulls === true : false;
    const selectedNumber = issuesState ? normalizeIntegerOrNull(issuesState.selectedNumber) : null;

    const tbody = dom.issuesTableBody;
    const template = dom.issueRowTemplate;
    if (tbody) {
      clearChildren(tbody);
      let visibleCount = 0;
      for (let index = 0; index < items.length; index += 1) {
        const issue = items[index];
        if (!isPlainObject(issue)) {
          continue;
        }
        if (!includePulls && issue.isPullRequest === true) {
          continue;
        }
        if (filter) {
          const haystack = (coerceText(issue.title) + ' #' + coerceText(issue.number)).toLowerCase();
          if (haystack.indexOf(filter) === -1) {
            continue;
          }
        }
        const row = template ? cloneTemplateContent(template) : null;
        const rowElement = row && row.firstElementChild;
        if (!rowElement) {
          continue;
        }
        const numberCell = rowElement.querySelector('[data-field="number"]');
        const titleCell = rowElement.querySelector('[data-field="title"]');
        const stateCell = rowElement.querySelector('[data-field="state"]');
        const labelsCell = rowElement.querySelector('[data-field="labels"]');
        setTextContent(numberCell, '#' + coerceText(issue.number));
        setTextContent(titleCell, formatDisplayText(issue.title, '(untitled)'));
        setTextContent(stateCell, formatDisplayText(issue.state, '—'));
        if (labelsCell) {
          const labels = Array.isArray(issue.labels) ? issue.labels : [];
          const labelText = labels.map(function mapLabel(label) {
            if (typeof label === 'string') return label;
            if (isPlainObject(label)) return normalizeString(label.name);
            return '';
          }).filter(Boolean).join(', ');
          setTextContent(labelsCell, labelText || '—');
        }
        rowElement.setAttribute('data-issue-number', String(issue.number));
        if (selectedNumber !== null && Number(issue.number) === selectedNumber) {
          rowElement.setAttribute('data-selected', 'true');
        }
        tbody.appendChild(row);
        visibleCount += 1;
      }
      setTextContent(dom.issuesCountLabel, String(visibleCount) + ' / ' + String(items.length));
    }

    setCheckboxValue(dom.issuesIncludePullsCheckbox, includePulls);
    setInputValueIfClean(dom.issueFilterInput, issuesState && issuesState.filter, false);

    const selectedIssue = selectedNumber !== null
      ? items.find(function findIssue(candidate) {
        return isPlainObject(candidate) && Number(candidate.number) === selectedNumber;
      })
      : null;

    if (selectedIssue) {
      setTextContent(dom.selectedIssueHeaderValue, '#' + String(selectedIssue.number) + ' ' + formatDisplayText(selectedIssue.title, '(untitled)'));
      setTextContent(dom.selectedIssueStateValue, formatDisplayText(selectedIssue.state, '—'));
      const labels = Array.isArray(selectedIssue.labels) ? selectedIssue.labels : [];
      const labelText = labels.map(function mapLabel(label) {
        if (typeof label === 'string') return label;
        if (isPlainObject(label)) return normalizeString(label.name);
        return '';
      }).filter(Boolean).join(', ');
      setTextContent(dom.selectedIssueLabelsValue, labelText || '—');
      setAnchorHref(dom.selectedIssueLink, selectedIssue.htmlUrl || selectedIssue.url);
      if (dom.selectedIssueBodyTextarea && !runtimeState.dirty.issueBody) {
        dom.selectedIssueBodyTextarea.value = coerceText(selectedIssue.body);
      }
    } else {
      setTextContent(dom.selectedIssueHeaderValue, '—');
      setTextContent(dom.selectedIssueStateValue, '—');
      setTextContent(dom.selectedIssueLabelsValue, '—');
      setAnchorHref(dom.selectedIssueLink, '');
      if (dom.selectedIssueBodyTextarea && !runtimeState.dirty.issueBody) {
        dom.selectedIssueBodyTextarea.value = '';
      }
    }

    setInputValueIfClean(
      dom.selectedTargetFileInput,
      runtimeState.workflow && runtimeState.workflow.currentTaskFilePath,
      runtimeState.dirty && runtimeState.dirty.targetFile
    );
  }

  function renderStageArtifact() {
    const dom = getDom();
    const artifact = isPlainObject(runtimeState.stageArtifact) ? runtimeState.stageArtifact : null;

    setTextContent(dom.stageArtifactKindValue, formatDisplayText(artifact && artifact.kind, '—'));
    setTextContent(dom.stageArtifactStageValue, formatDisplayText(artifact && artifact.stage, '—'));
    setTextContent(dom.stageArtifactProviderValue, formatDisplayText(artifact && artifact.providerId, '—'));
    setTextContent(dom.stageArtifactTargetFileValue, formatDisplayText(artifact && artifact.targetFile, '—'));

    const valid = artifact ? artifact.valid === true : false;
    setTextContent(dom.stageArtifactValidValue, artifact ? (valid ? 'valid' : 'invalid') : '—');

    const warnings = artifact && Array.isArray(artifact.warnings) ? artifact.warnings : [];
    setTextContent(dom.stageArtifactWarningCountValue, String(warnings.length));

    const promptText = artifact && typeof artifact.prompt === 'string' ? artifact.prompt : '';
    const packetText = artifact && typeof artifact.packet === 'string' ? artifact.packet : '';
    setTextContent(dom.stageArtifactPromptLengthValue, String(promptText.length));
    setTextContent(dom.stageArtifactPacketLengthValue, String(packetText.length));

    const issueSummary = artifact && isPlainObject(artifact.issue)
      ? ('#' + coerceText(artifact.issue.number) + ' ' + formatDisplayText(artifact.issue.title, '(untitled)'))
      : '—';
    setTextContent(dom.stageArtifactIssueValue, issueSummary);

    const repoSummary = artifact && isPlainObject(artifact.repository) && artifact.repository.owner && artifact.repository.repo
      ? artifact.repository.owner + '/' + artifact.repository.repo
      : '—';
    setTextContent(dom.stageArtifactRepositoryValue, repoSummary);

    if (dom.stageArtifactPromptTextarea) {
      dom.stageArtifactPromptTextarea.value = promptText;
    }
    if (dom.stageArtifactPacketTextarea) {
      dom.stageArtifactPacketTextarea.value = packetText;
    }
  }

  function renderTabContexts() {
    const dom = getDom();
    const listElement = dom.tabContextList;
    const template = dom.tabContextItemTemplate;
    if (!listElement) {
      return;
    }
    clearChildren(listElement);
    const contexts = Array.isArray(runtimeState.tabContexts) ? runtimeState.tabContexts : [];
    for (let index = 0; index < contexts.length; index += 1) {
      const tab = contexts[index];
      if (!isPlainObject(tab)) {
        continue;
      }
      const node = template ? cloneTemplateContent(template) : null;
      const item = node && node.firstElementChild;
      if (!item) {
        continue;
      }
      setTextContent(item.querySelector('[data-field="provider"]'), formatDisplayText(tab.providerId || tab.provider, '—'));
      setTextContent(item.querySelector('[data-field="tab-id"]'), '#' + coerceText(tab.tabId));
      setTextContent(item.querySelector('[data-field="url"]'), formatDisplayText(tab.url, '—'));
      setTextContent(item.querySelector('[data-field="last-seen"]'), formatTimestamp(tab.lastSeenAt || tab.updatedAt));
      item.setAttribute('data-tab-id', coerceText(tab.tabId));
      listElement.appendChild(node);
    }
  }

  function renderEventLog() {
    const dom = getDom();
    const listElement = dom.eventLogList;
    const template = dom.eventLogItemTemplate;
    if (!listElement) {
      return;
    }
    clearChildren(listElement);
    const entries = Array.isArray(runtimeState.eventLog) ? runtimeState.eventLog : [];
    const showDebug = runtimeState.transientPreferences && runtimeState.transientPreferences.showDebugLog === true;
    setCheckboxValue(dom.showDebugLogCheckbox, showDebug);

    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const entry = entries[index];
      if (!isPlainObject(entry)) {
        continue;
      }
      const level = normalizeString(entry.level).toLowerCase();
      if (!showDebug && level === 'debug') {
        continue;
      }
      const node = template ? cloneTemplateContent(template) : null;
      const item = node && node.firstElementChild;
      if (!item) {
        continue;
      }
      setTextContent(item.querySelector('[data-field="timestamp"]'), formatTimestamp(entry.at || entry.timestamp));
      setTextContent(item.querySelector('[data-field="level"]'), formatDisplayText(level, 'info'));
      setTextContent(item.querySelector('[data-field="type"]'), formatDisplayText(entry.type, '—'));
      setTextContent(item.querySelector('[data-field="message"]'), formatDisplayText(entry.message, ''));
      const detailsTarget = item.querySelector('[data-field="details"]');
      if (detailsTarget) {
        const detailsText = isPlainObject(entry.details) ? safeJsonStringify(entry.details, 2) : '';
        detailsTarget.textContent = detailsText;
      }
      item.setAttribute('data-level', level || 'info');
      listElement.appendChild(node);
    }
  }

  function renderSettings() {
    const dom = getDom();
    const bootstrap = isPlainObject(runtimeState.bootstrap) ? runtimeState.bootstrap : null;
    const settings = bootstrap && isPlainObject(bootstrap.settings) ? bootstrap.settings : null;
    const repository = settings && isPlainObject(settings.repository) ? settings.repository : null;
    const agents = settings && isPlainObject(settings.agents) ? settings.agents : null;
    const auth = bootstrap && isPlainObject(bootstrap.githubAuth) ? bootstrap.githubAuth : null;

    setTextContent(dom.githubUsernameOutput, formatDisplayText(auth && auth.username, '—'));
    setTextContent(dom.githubLastValidatedOutput, formatTimestamp(auth && auth.lastValidatedAt));
    if (dom.githubTokenTypeInput && !runtimeState.dirty.githubTokenType) {
      dom.githubTokenTypeInput.value = coerceText(auth && auth.tokenType);
    }

    setInputValueIfClean(dom.repositoryOwnerInput, repository && repository.owner, runtimeState.dirty.repositoryOwner);
    setInputValueIfClean(dom.repositoryRepoInput, repository && repository.repo, runtimeState.dirty.repositoryRepo);
    setInputValueIfClean(dom.repositoryBaseBranchInput, repository && repository.baseBranch, runtimeState.dirty.repositoryBaseBranch);
    setInputValueIfClean(dom.repositoryWorkingBranchPrefixInput, repository && repository.workingBranchPrefix, runtimeState.dirty.repositoryWorkingBranchPrefix);

    setSelectValue(dom.repositoryIssueStateSelect, repository && repository.issueState);
    setSelectValue(dom.repositoryIssueSortSelect, repository && repository.issueSort);
    setSelectValue(dom.repositoryIssueDirectionSelect, repository && repository.issueDirection);

    setSelectValue(dom.designerProviderSelect, agents && agents.designerProviderId);
    setSelectValue(dom.executorProviderSelect, agents && agents.executorProviderId);
    setSelectValue(dom.auditorProviderSelect, agents && agents.auditorProviderId);
  }

  function renderManualHub() {
    const dom = getDom();
    const manual = isPlainObject(runtimeState.manualHub) ? runtimeState.manualHub : null;
    const workflow = isPlainObject(runtimeState.workflow) ? runtimeState.workflow : null;

    setTextContent(dom.manualHubStageValue, formatDisplayText(workflow && workflow.stage, '—'));
    setTextContent(dom.manualHubProviderValue, formatDisplayText(workflow && workflow.activeProviderId, '—'));
    setTextContent(dom.manualHubTargetFileValue, formatDisplayText(workflow && workflow.currentTaskFilePath, '—'));
    setTextContent(dom.manualHubPacketLengthValue, String((manual && typeof manual.lastPacketText === 'string' ? manual.lastPacketText.length : 0)));

    setSelectValue(dom.manualHubPacketTypeSelect, manual && manual.lastPacketType);
    setSelectValue(dom.manualResponseKindSelect, manual && manual.responseKind);
    setSelectValue(dom.manualTargetStageSelect, workflow && workflow.stage);
    setSelectValue(dom.manualTargetStatusSelect, workflow && workflow.status);

    if (dom.manualHubPacketTextarea && !runtimeState.dirty.manualPacket) {
      dom.manualHubPacketTextarea.value = coerceText(manual && manual.lastPacketText);
    }
    if (dom.manualResponseTextarea && !runtimeState.dirty.manualResponse) {
      dom.manualResponseTextarea.value = coerceText(manual && manual.lastResponseText);
    }

    const preview = isPlainObject(runtimeState.manualResponsePreview) ? runtimeState.manualResponsePreview : null;
    if (dom.manualResponsePreviewTextarea) {
      dom.manualResponsePreviewTextarea.value = preview ? safeJsonStringify(preview, 2) : '';
    }
  }

  function renderActiveTab() {
    const dom = getDom();
    const active = runtimeState.transientPreferences && normalizeString(runtimeState.transientPreferences.activeTab) || 'dashboard';
    const buttons = Array.isArray(dom.tabButtons) ? dom.tabButtons : [];
    for (let index = 0; index < buttons.length; index += 1) {
      const button = buttons[index];
      if (!button) { continue; }
      const tabName = normalizeString(button.getAttribute('data-tab'));
      if (tabName === active) {
        button.setAttribute('aria-selected', 'true');
        button.setAttribute('data-active', 'true');
      } else {
        button.setAttribute('aria-selected', 'false');
        button.removeAttribute('data-active');
      }
    }
    const panels = Array.isArray(dom.tabPanels) ? dom.tabPanels : [];
    for (let index = 0; index < panels.length; index += 1) {
      const panel = panels[index];
      if (!panel) { continue; }
      const panelName = normalizeString(panel.getAttribute('data-tab'));
      setHiddenAttribute(panel, panelName !== active);
    }
  }

  function renderAll() {
    try {
      renderWorkflow();
      renderRepository();
      renderIssues();
      renderStageArtifact();
      renderTabContexts();
      renderEventLog();
      renderSettings();
      renderManualHub();
      renderActiveTab();
    } catch (error) {
      logger.warn('renderAll encountered an error.', normalizePopupError(error, 'renderAll failed.'));
    }
  }
  // --- Part E: Core actions ---

  async function refreshBootstrap(options) {
    const opts = isPlainObject(options) ? options : Object.create(null);
    const result = await sendBackgroundMessage(
      MESSAGE_TYPES.POPUP_GET_BOOTSTRAP || 'POPUP/GET_BOOTSTRAP',
      opts
    );
    if (isPlainObject(result)) {
      runtimeState.bootstrap = cloneValue(result);
      if (isPlainObject(result.workflow)) {
        runtimeState.workflow = cloneValue(result.workflow);
      }
      if (Array.isArray(result.eventLog)) {
        runtimeState.eventLog = cloneValue(result.eventLog);
      }
      if (isPlainObject(result.manualHub)) {
        runtimeState.manualHub = cloneValue(result.manualHub);
      }
      if (isPlainObject(result.ui) && typeof result.ui.activeTab === 'string') {
        runtimeState.transientPreferences.activeTab = result.ui.activeTab;
        runtimeState.transientPreferences.showDebugLog = result.ui.showDebugLog === true;
      }
    }
    return result;
  }

  async function refreshWorkflow() {
    const result = await sendBackgroundMessage(
      MESSAGE_TYPES.POPUP_GET_WORKFLOW_STATE || 'POPUP/GET_WORKFLOW_STATE',
      null
    );
    if (isPlainObject(result)) {
      runtimeState.workflow = cloneValue(result);
    }
    return result;
  }

  async function refreshEventLog(options) {
    const opts = isPlainObject(options) ? options : Object.create(null);
    const result = await sendBackgroundMessage(
      MESSAGE_TYPES.POPUP_GET_EVENT_LOG || 'POPUP/GET_EVENT_LOG',
      opts
    );
    if (Array.isArray(result)) {
      runtimeState.eventLog = cloneValue(result);
    } else if (isPlainObject(result) && Array.isArray(result.entries)) {
      runtimeState.eventLog = cloneValue(result.entries);
    }
    return result;
  }

  function buildIssueQueryFromDom() {
    const dom = getDom();
    const bootstrap = isPlainObject(runtimeState.bootstrap) ? runtimeState.bootstrap : null;
    const settingsRepo = bootstrap && isPlainObject(bootstrap.settings) && isPlainObject(bootstrap.settings.repository)
      ? bootstrap.settings.repository
      : null;
    const query = Object.create(null);
    if (dom.issueStateSelect && dom.issueStateSelect.value) {
      query.state = dom.issueStateSelect.value;
    } else if (settingsRepo && settingsRepo.issueState) {
      query.state = settingsRepo.issueState;
    }
    if (dom.issueSortSelect && dom.issueSortSelect.value) {
      query.sort = dom.issueSortSelect.value;
    } else if (settingsRepo && settingsRepo.issueSort) {
      query.sort = settingsRepo.issueSort;
    }
    if (dom.issueDirectionSelect && dom.issueDirectionSelect.value) {
      query.direction = dom.issueDirectionSelect.value;
    } else if (settingsRepo && settingsRepo.issueDirection) {
      query.direction = settingsRepo.issueDirection;
    }
    return query;
  }

  async function loadIssues(options) {
    const opts = isPlainObject(options) ? options : Object.create(null);
    const payload = Object.assign(Object.create(null), buildIssueQueryFromDom(), opts);
    const result = await sendBackgroundMessage(
      MESSAGE_TYPES.POPUP_LOAD_ISSUES || 'POPUP/LOAD_ISSUES',
      payload
    );

    const items = isPlainObject(result) && Array.isArray(result.items)
      ? result.items
      : (Array.isArray(result) ? result : []);
    const total = isPlainObject(result) && typeof result.total === 'number'
      ? result.total
      : items.length;

    runtimeState.issues.items = cloneValue(items);
    runtimeState.issues.total = total;
    runtimeState.issues.lastQuery = cloneValue(payload);

    return result;
  }

  async function loadRepositoryTree(options) {
    const dom = getDom();
    const opts = isPlainObject(options) ? options : Object.create(null);
    const prefix = runtimeState.repository && normalizeString(runtimeState.repository.pathPrefix);
    const inputPrefix = dom.treePathPrefixInput ? normalizeString(dom.treePathPrefixInput.value) : '';
    const payload = Object.assign(Object.create(null), opts, {
      pathPrefix: prefix || inputPrefix || ''
    });
    const result = await sendBackgroundMessage(
      MESSAGE_TYPES.POPUP_LOAD_REPO_TREE || 'POPUP/LOAD_REPO_TREE',
      payload
    );
    if (isPlainObject(result)) {
      runtimeState.repository.tree = cloneValue(result);
      if (typeof payload.pathPrefix === 'string') {
        runtimeState.repository.pathPrefix = payload.pathPrefix;
      }
      runtimeState.dirty.treePathPrefix = false;
    }
    return result;
  }

  async function applyIssueSelection(issueNumber, extraPayload) {
    const numeric = normalizeIntegerOrNull(issueNumber);
    if (numeric === null) {
      throw normalizePopupError({
        code: ERROR_CODES.INVALID_ARGUMENT || 'INVALID_ARGUMENT',
        message: 'Issue number is required to apply selection.'
      }, 'Issue number is required.');
    }
    const dom = getDom();
    const targetFileInput = dom.selectedTargetFileInput;
    const issueBodyInput = dom.selectedIssueBodyTextarea;
    const payload = Object.assign(Object.create(null),
      isPlainObject(extraPayload) ? extraPayload : Object.create(null),
      {
        issueNumber: numeric,
        targetFile: targetFileInput ? normalizeString(targetFileInput.value) : '',
        issueBody: issueBodyInput && !runtimeState.dirty.issueBody ? undefined : (issueBodyInput ? coerceText(issueBodyInput.value) : '')
      }
    );

    const result = await sendBackgroundMessage(
      MESSAGE_TYPES.POPUP_SELECT_ISSUE || 'POPUP/SELECT_ISSUE',
      payload
    );
    runtimeState.issues.selectedNumber = numeric;
    if (isPlainObject(result) && isPlainObject(result.workflow)) {
      runtimeState.workflow = cloneValue(result.workflow);
    } else if (isPlainObject(result)) {
      runtimeState.workflow = cloneValue(result);
    }
    runtimeState.dirty.targetFile = false;
    runtimeState.dirty.issueBody = false;
    return result;
  }

  function applyStageArtifactResult(result) {
    if (!isPlainObject(result)) {
      return;
    }
    if (isPlainObject(result.artifact)) {
      runtimeState.stageArtifact = cloneValue(result.artifact);
    } else if (typeof result.prompt === 'string' || typeof result.packet === 'string') {
      runtimeState.stageArtifact = cloneValue(result);
    }
    if (isPlainObject(result.workflow)) {
      runtimeState.workflow = cloneValue(result.workflow);
    }
  }

  async function advanceStage(options) {
    const opts = isPlainObject(options) ? options : Object.create(null);
    const payload = Object.assign(Object.create(null), opts);
    const result = await sendBackgroundMessage(
      MESSAGE_TYPES.POPUP_ADVANCE_STAGE || 'POPUP/ADVANCE_STAGE',
      payload
    );
    applyStageArtifactResult(result);
    if (isPlainObject(result) && !result.artifact && (result.stage || result.status)) {
      runtimeState.workflow = cloneValue(result);
    }
    return result;
  }

  async function buildDesignArtifact(options) {
    const opts = isPlainObject(options) ? options : Object.create(null);
    const result = await sendBackgroundMessage(
      MESSAGE_TYPES.POPUP_BUILD_DESIGN_ARTIFACT || 'POPUP/BUILD_DESIGN_ARTIFACT',
      opts
    );
    applyStageArtifactResult(result);
    return result;
  }

  async function buildCurrentArtifact(options) {
    const opts = isPlainObject(options) ? options : Object.create(null);
    const result = await sendBackgroundMessage(
      MESSAGE_TYPES.POPUP_BUILD_CURRENT_ARTIFACT || 'POPUP/BUILD_CURRENT_ARTIFACT',
      opts
    );
    applyStageArtifactResult(result);
    return result;
  }

  async function resetWorkflow(options) {
    const opts = isPlainObject(options) ? options : Object.create(null);
    const result = await sendBackgroundMessage(
      MESSAGE_TYPES.POPUP_RESET_WORKFLOW || 'POPUP/RESET_WORKFLOW',
      opts
    );
    if (isPlainObject(result)) {
      if (isPlainObject(result.workflow)) {
        runtimeState.workflow = cloneValue(result.workflow);
      } else {
        runtimeState.workflow = cloneValue(result);
      }
    }
    runtimeState.stageArtifact = null;
    runtimeState.manualResponsePreview = null;
    return result;
  }

  async function clearWorkflowError() {
    const result = await sendBackgroundMessage(
      MESSAGE_TYPES.POPUP_CLEAR_WORKFLOW_ERROR || 'POPUP/CLEAR_WORKFLOW_ERROR',
      null
    );
    if (isPlainObject(result)) {
      if (isPlainObject(result.workflow)) {
        runtimeState.workflow = cloneValue(result.workflow);
      } else {
        runtimeState.workflow = cloneValue(result);
      }
    }
    runtimeState.lastError = null;
    return result;
  }

  async function createPullRequestNow(options) {
    const opts = isPlainObject(options) ? options : Object.create(null);
    const result = await sendBackgroundMessage(
      MESSAGE_TYPES.POPUP_CREATE_PULL_REQUEST || 'POPUP/CREATE_PULL_REQUEST',
      opts
    );
    if (isPlainObject(result)) {
      if (isPlainObject(result.workflow)) {
        runtimeState.workflow = cloneValue(result.workflow);
      } else if (result.stage || result.status || typeof result.pullRequestNumber !== 'undefined') {
        runtimeState.workflow = cloneValue(result);
      }
    }
    return result;
  }

  async function submitHumanPayload(payload) {
    const result = await sendBackgroundMessage(
      MESSAGE_TYPES.POPUP_SUBMIT_HUMAN_PAYLOAD || 'POPUP/SUBMIT_HUMAN_PAYLOAD',
      isPlainObject(payload) ? payload : Object.create(null)
    );
    if (isPlainObject(result)) {
      if (isPlainObject(result.workflow)) {
        runtimeState.workflow = cloneValue(result.workflow);
      }
      if (isPlainObject(result.preview)) {
        runtimeState.manualResponsePreview = cloneValue(result.preview);
      }
    }
    return result;
  }

  function collectGitHubSettingsFromDom() {
    const dom = getDom();
    const pat = dom.githubPatInput ? normalizeString(dom.githubPatInput.value) : '';
    const tokenType = dom.githubTokenTypeInput ? normalizeString(dom.githubTokenTypeInput.value) : '';
    return {
      personalAccessToken: pat,
      tokenType: tokenType || 'classic'
    };
  }

  function collectRepositorySettingsFromDom() {
    const dom = getDom();
    return {
      owner: dom.repositoryOwnerInput ? normalizeString(dom.repositoryOwnerInput.value) : '',
      repo: dom.repositoryRepoInput ? normalizeString(dom.repositoryRepoInput.value) : '',
      baseBranch: dom.repositoryBaseBranchInput ? normalizeString(dom.repositoryBaseBranchInput.value) : '',
      workingBranchPrefix: dom.repositoryWorkingBranchPrefixInput ? normalizeString(dom.repositoryWorkingBranchPrefixInput.value) : '',
      issueState: dom.repositoryIssueStateSelect ? normalizeString(dom.repositoryIssueStateSelect.value) : '',
      issueSort: dom.repositoryIssueSortSelect ? normalizeString(dom.repositoryIssueSortSelect.value) : '',
      issueDirection: dom.repositoryIssueDirectionSelect ? normalizeString(dom.repositoryIssueDirectionSelect.value) : ''
    };
  }

  function collectAgentSettingsFromDom() {
    const dom = getDom();
    return {
      designerProviderId: dom.designerProviderSelect ? normalizeString(dom.designerProviderSelect.value) : '',
      executorProviderId: dom.executorProviderSelect ? normalizeString(dom.executorProviderSelect.value) : '',
      auditorProviderId: dom.auditorProviderSelect ? normalizeString(dom.auditorProviderSelect.value) : ''
    };
  }

  async function saveGithubSettings() {
    const payload = collectGitHubSettingsFromDom();
    const result = await sendBackgroundMessage(
      MESSAGE_TYPES.POPUP_SAVE_GITHUB_SETTINGS || 'POPUP/SAVE_GITHUB_SETTINGS',
      payload
    );
    if (isPlainObject(result) && runtimeState.bootstrap) {
      runtimeState.bootstrap.githubAuth = cloneValue(result);
    }
    runtimeState.dirty.githubTokenType = false;
    const dom = getDom();
    if (dom.githubPatInput) {
      dom.githubPatInput.value = '';
    }
    return result;
  }

  async function validateGithubToken() {
    const payload = collectGitHubSettingsFromDom();
    payload.validate = true;
    const result = await sendBackgroundMessage(
      MESSAGE_TYPES.POPUP_SAVE_GITHUB_SETTINGS || 'POPUP/SAVE_GITHUB_SETTINGS',
      payload
    );
    if (isPlainObject(result) && runtimeState.bootstrap) {
      runtimeState.bootstrap.githubAuth = cloneValue(result);
    }
    return result;
  }

  async function clearGithubToken() {
    const result = await sendBackgroundMessage(
      MESSAGE_TYPES.POPUP_SAVE_GITHUB_SETTINGS || 'POPUP/SAVE_GITHUB_SETTINGS',
      { personalAccessToken: '', clear: true }
    );
    if (isPlainObject(result) && runtimeState.bootstrap) {
      runtimeState.bootstrap.githubAuth = cloneValue(result);
    }
    const dom = getDom();
    if (dom.githubPatInput) {
      dom.githubPatInput.value = '';
    }
    return result;
  }

  async function saveRepositorySettings() {
    const payload = {
      kind: 'save_repository_settings',
      repository: collectRepositorySettingsFromDom(),
      agents: collectAgentSettingsFromDom()
    };
    const result = await advanceStage(payload);
    runtimeState.dirty.repositoryOwner = false;
    runtimeState.dirty.repositoryRepo = false;
    runtimeState.dirty.repositoryBaseBranch = false;
    runtimeState.dirty.repositoryWorkingBranchPrefix = false;
    return result;
  }

  function updateIssueFilter(text) {
    runtimeState.issues.filter = normalizeString(text);
    renderIssues();
  }

  function setSelectedIssueNumber(issueNumber) {
    runtimeState.issues.selectedNumber = normalizeIntegerOrNull(issueNumber);
    renderIssues();
  }

  function setTreePathPrefix(text) {
    runtimeState.repository.pathPrefix = normalizeString(text);
    runtimeState.dirty.treePathPrefix = true;
  }

  function setActiveTab(name) {
    const normalized = normalizeString(name) || 'dashboard';
    runtimeState.transientPreferences.activeTab = normalized;
    renderActiveTab();
  }

  function setShowDebugLog(flag) {
    runtimeState.transientPreferences.showDebugLog = flag === true;
    renderEventLog();
  }

  function previewManualResponseResult() { return cloneValue(runtimeState.manualResponsePreview); }

  // --- Part F: Manual hub / tab / clipboard actions ---

  function getManualHubState() {
    if (!isPlainObject(runtimeState.manualHub)) {
      runtimeState.manualHub = {
        lastPacketType: '',
        lastPacketText: '',
        lastResponseText: '',
        clipboardFormat: 'json'
      };
    }
    return runtimeState.manualHub;
  }

  function updateManualPacketText(text) {
    const manual = getManualHubState();
    manual.lastPacketText = coerceText(text);
    runtimeState.dirty.manualPacket = true;
  }

  function updateManualResponseText(text) {
    const manual = getManualHubState();
    manual.lastResponseText = coerceText(text);
    runtimeState.dirty.manualResponse = true;
  }

  function updateManualPacketType(packetType) {
    const manual = getManualHubState();
    manual.lastPacketType = normalizeString(packetType);
  }

  function updateManualClipboardFormat(format) {
    const manual = getManualHubState();
    manual.clipboardFormat = normalizeString(format).toLowerCase() || 'json';
  }

  async function persistManualHubState() {
    const manual = getManualHubState();
    if (typeof storage.merge !== 'function') {
      return null;
    }
    try {
      return await storage.merge(STORAGE_KEYS.MANUAL_BRIDGE_DRAFT || 'manualBridgeDraft', cloneValue(manual), {
        area: STORAGE_AREA_LOCAL
      });
    } catch (error) {
      logger.warn('Failed to persist manual hub state.', normalizePopupError(error, 'persistManualHubState failed.'));
      return null;
    }
  }

  function buildCurrentManualPacket() {
    const artifact = isPlainObject(runtimeState.stageArtifact) ? runtimeState.stageArtifact : null;
    if (!artifact || typeof artifact.packet !== 'string' || !artifact.packet) {
      throw normalizePopupError({
        code: ERROR_CODES.INVALID_STATE || 'INVALID_STATE',
        message: 'No stage artifact packet is available to transfer.'
      }, 'No packet available.');
    }
    const manual = getManualHubState();
    manual.lastPacketText = artifact.packet;
    manual.lastPacketType = normalizeString(artifact.packetType) || manual.lastPacketType;
    runtimeState.dirty.manualPacket = false;
    return cloneValue(manual);
  }

  async function writeToClipboard(text) {
    const value = coerceText(text);
    if (!value) {
      return false;
    }
    if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      try {
        await navigator.clipboard.writeText(value);
        return true;
      } catch (error) {
        logger.warn('navigator.clipboard.writeText failed.', normalizePopupError(error, 'clipboard write failed.'));
      }
    }
    try {
      if (typeof document !== 'undefined' && document.body) {
        const textarea = document.createElement('textarea');
        textarea.value = value;
        textarea.setAttribute('readonly', 'readonly');
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        const copied = document.execCommand && document.execCommand('copy');
        document.body.removeChild(textarea);
        return copied === true;
      }
    } catch (error) {
      logger.warn('Fallback clipboard copy failed.', normalizePopupError(error, 'clipboard write failed.'));
    }
    return false;
  }

  async function copyManualPacket() {
    const manual = getManualHubState();
    const ok = await writeToClipboard(manual.lastPacketText);
    if (ok) {
      announce('Packet copied to clipboard.');
    }
    return ok;
  }

  async function copyStageArtifactPrompt() {
    const artifact = isPlainObject(runtimeState.stageArtifact) ? runtimeState.stageArtifact : null;
    const text = artifact && typeof artifact.prompt === 'string' ? artifact.prompt : '';
    const ok = await writeToClipboard(text);
    if (ok) {
      announce('Prompt copied to clipboard.');
    }
    return ok;
  }

  async function copyStageArtifactPacket() {
    const artifact = isPlainObject(runtimeState.stageArtifact) ? runtimeState.stageArtifact : null;
    const text = artifact && typeof artifact.packet === 'string' ? artifact.packet : '';
    const ok = await writeToClipboard(text);
    if (ok) {
      announce('Packet copied to clipboard.');
    }
    return ok;
  }

  async function copyStageArtifactBoth() {
    const artifact = isPlainObject(runtimeState.stageArtifact) ? runtimeState.stageArtifact : null;
    const prompt = artifact && typeof artifact.prompt === 'string' ? artifact.prompt : '';
    const packet = artifact && typeof artifact.packet === 'string' ? artifact.packet : '';
    const combined = [prompt, packet].filter(Boolean).join('\n\n');
    const ok = await writeToClipboard(combined);
    if (ok) {
      announce('Prompt and packet copied to clipboard.');
    }
    return ok;
  }

  function validateManualPacket() {
    const manual = getManualHubState();
    const text = coerceText(manual.lastPacketText);
    if (!text) {
      runtimeState.manualResponsePreview = {
        kind: 'packet',
        valid: false,
        errors: ['Packet text is empty.']
      };
      return runtimeState.manualResponsePreview;
    }
    if (!payloadParser || typeof payloadParser.parsePacketPayload !== 'function') {
      runtimeState.manualResponsePreview = {
        kind: 'packet',
        valid: false,
        errors: ['ai_payload_parser.parsePacketPayload is not available.']
      };
      return runtimeState.manualResponsePreview;
    }
    try {
      const parsed = payloadParser.parsePacketPayload(text);
      runtimeState.manualResponsePreview = {
        kind: 'packet',
        valid: parsed && parsed.ok === true,
        errors: parsed && Array.isArray(parsed.errors) ? parsed.errors : [],
        warnings: parsed && Array.isArray(parsed.warnings) ? parsed.warnings : [],
        parsed: parsed && isPlainObject(parsed.payload) ? cloneValue(parsed.payload) : null
      };
    } catch (error) {
      runtimeState.manualResponsePreview = {
        kind: 'packet',
        valid: false,
        errors: [normalizePopupError(error, 'Packet validation failed.').message]
      };
    }
    return cloneValue(runtimeState.manualResponsePreview);
  }

  function previewManualResponse() {
    const manual = getManualHubState();
    const text = coerceText(manual.lastResponseText);
    if (!text) {
      runtimeState.manualResponsePreview = {
        kind: 'response',
        valid: false,
        errors: ['Response text is empty.']
      };
      return runtimeState.manualResponsePreview;
    }
    if (!payloadParser) {
      runtimeState.manualResponsePreview = {
        kind: 'response',
        valid: false,
        errors: ['ai_payload_parser is not available.']
      };
      return runtimeState.manualResponsePreview;
    }
    try {
      const packetAttempt = typeof payloadParser.parsePacketPayload === 'function'
        ? payloadParser.parsePacketPayload(text)
        : null;
      if (packetAttempt && packetAttempt.ok) {
        runtimeState.manualResponsePreview = {
          kind: 'packet',
          valid: true,
          errors: [],
          parsed: cloneValue(packetAttempt.payload)
        };
        return cloneValue(runtimeState.manualResponsePreview);
      }
      const executorAttempt = typeof payloadParser.parseExecutorOutput === 'function'
        ? payloadParser.parseExecutorOutput(text)
        : null;
      if (executorAttempt && executorAttempt.ok) {
        runtimeState.manualResponsePreview = {
          kind: 'executor_output',
          valid: true,
          errors: [],
          parsed: cloneValue(executorAttempt.payload)
        };
        return cloneValue(runtimeState.manualResponsePreview);
      }
      const reviewAttempt = typeof payloadParser.parseReviewOutput === 'function'
        ? payloadParser.parseReviewOutput(text)
        : null;
      if (reviewAttempt && reviewAttempt.ok) {
        runtimeState.manualResponsePreview = {
          kind: 'review_output',
          valid: true,
          errors: [],
          parsed: cloneValue(reviewAttempt.payload)
        };
        return cloneValue(runtimeState.manualResponsePreview);
      }
      const errors = [];
      if (packetAttempt && Array.isArray(packetAttempt.errors)) errors.push.apply(errors, packetAttempt.errors);
      if (executorAttempt && Array.isArray(executorAttempt.errors)) errors.push.apply(errors, executorAttempt.errors);
      if (reviewAttempt && Array.isArray(reviewAttempt.errors)) errors.push.apply(errors, reviewAttempt.errors);
      runtimeState.manualResponsePreview = {
        kind: 'unknown',
        valid: false,
        errors: errors.length ? errors : ['Unable to classify response text.']
      };
    } catch (error) {
      runtimeState.manualResponsePreview = {
        kind: 'unknown',
        valid: false,
        errors: [normalizePopupError(error, 'Response preview failed.').message]
      };
    }
    return cloneValue(runtimeState.manualResponsePreview);
  }

  async function submitManualResponse(options) {
    const opts = isPlainObject(options) ? options : Object.create(null);
    const manual = getManualHubState();
    const preview = previewManualResponse();
    if (!preview || preview.valid !== true) {
      throw normalizePopupError({
        code: ERROR_CODES.VALIDATION_FAILED || 'VALIDATION_FAILED',
        message: 'Manual response is invalid. Preview before submitting.',
        details: { errors: preview && preview.errors }
      }, 'Invalid manual response.');
    }
    const payload = Object.assign(Object.create(null), opts, {
      rawText: manual.lastResponseText,
      kind: preview.kind,
      parsed: preview.parsed || null
    });
    const result = await submitHumanPayload(payload);
    runtimeState.dirty.manualResponse = false;
    return result;
  }

  function applyManualStageState(nextState) {
    if (!isPlainObject(nextState)) {
      return;
    }
    const manual = getManualHubState();
    if (typeof nextState.lastPacketText === 'string') {
      manual.lastPacketText = nextState.lastPacketText;
    }
    if (typeof nextState.lastResponseText === 'string') {
      manual.lastResponseText = nextState.lastResponseText;
    }
    if (typeof nextState.lastPacketType === 'string') {
      manual.lastPacketType = nextState.lastPacketType;
    }
    if (typeof nextState.clipboardFormat === 'string') {
      manual.clipboardFormat = nextState.clipboardFormat;
    }
  }

  function markCurrentStageStatus(status) {
    const workflow = isPlainObject(runtimeState.workflow) ? runtimeState.workflow : null;
    if (!workflow) {
      return;
    }
    workflow.status = normalizeString(status);
  }

  function refreshTabContexts() {
    const bootstrap = isPlainObject(runtimeState.bootstrap) ? runtimeState.bootstrap : null;
    const contexts = bootstrap && Array.isArray(bootstrap.tabContexts) ? bootstrap.tabContexts : [];
    runtimeState.tabContexts = cloneValue(contexts);
    return runtimeState.tabContexts;
  }

  async function queryActiveTab() {
    const tabs = resolveChromeTabs();
    if (!tabs || typeof tabs.query !== 'function') {
      return null;
    }
    return new Promise(function executor(resolve) {
      try {
        tabs.query({ active: true, lastFocusedWindow: true }, function onTabs(list) {
          if (Array.isArray(list) && list.length > 0) {
            resolve(list[0]);
          } else {
            resolve(null);
          }
        });
      } catch (error) {
        logger.warn('chrome.tabs.query failed.', normalizePopupError(error, 'tabs.query failed.'));
        resolve(null);
      }
    });
  }

  async function probeActiveTab() {
    const tab = await queryActiveTab();
    if (!tab || typeof tab.id !== 'number') {
      throw normalizePopupError({
        code: ERROR_CODES.TAB_NOT_FOUND || 'TAB_NOT_FOUND',
        message: 'No active tab detected.'
      }, 'No active tab.');
    }
    return sendTabMessage(
      tab.id,
      MESSAGE_TYPES.CONTENT_PROBE || 'CONTENT/PROBE',
      { url: tab.url || '' }
    );
  }

  async function sendPromptToActiveTab(promptText) {
    const tab = await queryActiveTab();
    if (!tab || typeof tab.id !== 'number') {
      throw normalizePopupError({
        code: ERROR_CODES.TAB_NOT_FOUND || 'TAB_NOT_FOUND',
        message: 'No active tab detected.'
      }, 'No active tab.');
    }
    const artifact = isPlainObject(runtimeState.stageArtifact) ? runtimeState.stageArtifact : null;
    const text = coerceText(promptText)
      || (artifact && typeof artifact.prompt === 'string' ? artifact.prompt : '')
      || '';
    if (!text) {
      throw normalizePopupError({
        code: ERROR_CODES.INVALID_STATE || 'INVALID_STATE',
        message: 'No prompt text is available to send.'
      }, 'No prompt available.');
    }
    return sendTabMessage(
      tab.id,
      MESSAGE_TYPES.CONTENT_FILL_PROMPT || 'CONTENT/FILL_PROMPT',
      { prompt: text }
    );
  }

  async function extractLatestResponse() {
    const tab = await queryActiveTab();
    if (!tab || typeof tab.id !== 'number') {
      throw normalizePopupError({
        code: ERROR_CODES.TAB_NOT_FOUND || 'TAB_NOT_FOUND',
        message: 'No active tab detected.'
      }, 'No active tab.');
    }
    const result = await sendTabMessage(
      tab.id,
      MESSAGE_TYPES.CONTENT_EXTRACT_LATEST_RESPONSE || 'CONTENT/EXTRACT_LATEST_RESPONSE',
      null
    );
    if (isPlainObject(result) && typeof result.rawText === 'string') {
      const manual = getManualHubState();
      manual.lastResponseText = result.rawText;
      runtimeState.dirty.manualResponse = false;
    }
    return result;
  }

  // --- Part G: Bindings and initialization ---

  function addListener(element, eventType, handler) {
    if (!element || typeof element.addEventListener !== 'function') {
      return;
    }
    element.addEventListener(eventType, handler);
  }

  function findIssueRowNumber(target) {
    let current = target;
    while (current && current !== document.body) {
      if (current.getAttribute && current.getAttribute('data-issue-number')) {
        return normalizeIntegerOrNull(current.getAttribute('data-issue-number'));
      }
      current = current.parentNode;
    }
    return null;
  }

  function bindGlobalControls() {
    const dom = getDom();
    addListener(dom.refreshBootstrapButton, 'click', withErrorHandling(async function onRefreshBootstrap() {
      await refreshBootstrap();
    }, { busyKey: 'refreshBootstrap', fallbackMessage: 'Failed to refresh bootstrap state.' }));
    addListener(dom.dismissGlobalErrorButton, 'click', function onDismissError() {
      clearErrorBanner();
    });
  }

  function bindTabButtons() {
    const dom = getDom();
    const buttons = Array.isArray(dom.tabButtons) ? dom.tabButtons : [];
    for (let index = 0; index < buttons.length; index += 1) {
      const button = buttons[index];
      if (!button) { continue; }
      addListener(button, 'click', function onTabClick(event) {
        const target = event.currentTarget;
        const tabName = target && target.getAttribute ? target.getAttribute('data-tab') : '';
        setActiveTab(tabName);
      });
    }
  }

  function bindWorkflowControls() {
    const dom = getDom();
    addListener(dom.refreshWorkflowButton, 'click', withErrorHandling(async function onRefreshWorkflow() {
      await refreshWorkflow();
    }, { busyKey: 'refreshWorkflow', fallbackMessage: 'Failed to refresh workflow.' }));
    addListener(dom.buildCurrentArtifactButton, 'click', withErrorHandling(async function onBuildCurrent() {
      await buildCurrentArtifact();
    }, { busyKey: 'buildCurrentArtifact', fallbackMessage: 'Failed to build current artifact.' }));
    addListener(dom.advanceStageButton, 'click', withErrorHandling(async function onAdvanceStage() {
      await advanceStage();
    }, { busyKey: 'advanceStage', fallbackMessage: 'Failed to advance stage.' }));
    addListener(dom.createPullRequestButton, 'click', withErrorHandling(async function onCreatePr() {
      await createPullRequestNow();
    }, { busyKey: 'createPullRequest', fallbackMessage: 'Failed to create pull request.' }));
    addListener(dom.resetWorkflowButton, 'click', withErrorHandling(async function onResetWorkflow() {
      await resetWorkflow();
    }, { busyKey: 'resetWorkflow', fallbackMessage: 'Failed to reset workflow.' }));
  }

  function bindRepositoryControls() {
    const dom = getDom();
    addListener(dom.loadRepoTreeButton, 'click', withErrorHandling(async function onLoadTree() {
      await loadRepositoryTree();
    }, { busyKey: 'loadRepoTree', fallbackMessage: 'Failed to load repository tree.' }));
    addListener(dom.treePathPrefixInput, 'input', function onPathPrefixInput(event) {
      setTreePathPrefix(event.target ? event.target.value : '');
    });
  }

  function bindIssueControls() {
    const dom = getDom();
    addListener(dom.loadIssuesButton, 'click', withErrorHandling(async function onLoadIssues() {
      await loadIssues();
    }, { busyKey: 'loadIssues', fallbackMessage: 'Failed to load issues.' }));
    addListener(dom.refreshIssuesButton, 'click', withErrorHandling(async function onRefreshIssues() {
      await loadIssues();
    }, { busyKey: 'loadIssues', fallbackMessage: 'Failed to refresh issues.' }));
    addListener(dom.issueFilterInput, 'input', function onFilterInput(event) {
      updateIssueFilter(event.target ? event.target.value : '');
    });
    addListener(dom.issuesIncludePullsCheckbox, 'change', function onIncludePulls(event) {
      runtimeState.issues.includePulls = event.target ? event.target.checked === true : false;
      renderIssues();
    });
    addListener(dom.issuesTableBody, 'click', function onIssueRowClick(event) {
      const issueNumber = findIssueRowNumber(event.target);
      if (issueNumber !== null) {
        setSelectedIssueNumber(issueNumber);
      }
    });
    addListener(dom.selectIssueButton, 'click', withErrorHandling(async function onSelectIssue() {
      const number = runtimeState.issues.selectedNumber;
      if (number === null) {
        throw normalizePopupError({
          code: ERROR_CODES.INVALID_STATE || 'INVALID_STATE',
          message: 'Select an issue row first.'
        }, 'No issue selected.');
      }
      await applyIssueSelection(number);
    }, { busyKey: 'selectIssue', fallbackMessage: 'Failed to select issue.' }));
    addListener(dom.buildDesignArtifactButton, 'click', withErrorHandling(async function onBuildDesign() {
      await buildDesignArtifact();
    }, { busyKey: 'buildDesignArtifact', fallbackMessage: 'Failed to build design artifact.' }));
    addListener(dom.selectedTargetFileInput, 'input', function onTargetFileInput() {
      runtimeState.dirty.targetFile = true;
    });
    addListener(dom.selectedIssueBodyTextarea, 'input', function onIssueBodyInput() {
      runtimeState.dirty.issueBody = true;
    });
    addListener(dom.probeActiveTabButton, 'click', withErrorHandling(async function onProbeTab() {
      await probeActiveTab();
    }, { busyKey: 'probeTab', fallbackMessage: 'Failed to probe active tab.' }));
    addListener(dom.sendPromptToActiveTabButton, 'click', withErrorHandling(async function onSendPrompt() {
      await sendPromptToActiveTab();
    }, { busyKey: 'sendPrompt', fallbackMessage: 'Failed to send prompt.' }));
  }

  function bindStageArtifactControls() {
    const dom = getDom();
    addListener(dom.copyStageArtifactPromptButton, 'click', withErrorHandling(async function onCopyPrompt() {
      await copyStageArtifactPrompt();
    }, { busyKey: 'copyPrompt', suppressRender: true, fallbackMessage: 'Failed to copy prompt.' }));
    addListener(dom.copyStageArtifactPacketButton, 'click', withErrorHandling(async function onCopyPacket() {
      await copyStageArtifactPacket();
    }, { busyKey: 'copyPacket', suppressRender: true, fallbackMessage: 'Failed to copy packet.' }));
    addListener(dom.copyStageArtifactBothButton, 'click', withErrorHandling(async function onCopyBoth() {
      await copyStageArtifactBoth();
    }, { busyKey: 'copyBoth', suppressRender: true, fallbackMessage: 'Failed to copy artifact.' }));
    addListener(dom.buildManualPacketFromArtifactButton, 'click', withErrorHandling(async function onBuildManualPacket() {
      buildCurrentManualPacket();
      await persistManualHubState();
    }, { busyKey: 'buildManualPacket', fallbackMessage: 'Failed to build manual packet.' }));
  }

  function bindTabContextControls() {
    const dom = getDom();
    addListener(dom.refreshTabContextsButton, 'click', withErrorHandling(async function onRefreshTabContexts() {
      await refreshBootstrap();
      refreshTabContexts();
    }, { busyKey: 'refreshTabContexts', fallbackMessage: 'Failed to refresh tab contexts.' }));
  }

  function bindEventLogControls() {
    const dom = getDom();
    addListener(dom.refreshEventLogButton, 'click', withErrorHandling(async function onRefreshEventLog() {
      await refreshEventLog();
    }, { busyKey: 'refreshEventLog', fallbackMessage: 'Failed to refresh event log.' }));
    addListener(dom.showDebugLogCheckbox, 'change', function onShowDebugLog(event) {
      setShowDebugLog(event.target ? event.target.checked === true : false);
    });
  }

  function bindSettingsControls() {
    const dom = getDom();
    addListener(dom.settingsForm, 'submit', function onSettingsSubmit(event) {
      event.preventDefault();
    });
    addListener(dom.saveGitHubSettingsButton, 'click', withErrorHandling(async function onSaveGithub() {
      await saveGithubSettings();
    }, { busyKey: 'saveGithub', fallbackMessage: 'Failed to save GitHub settings.' }));
    addListener(dom.validateGitHubButton, 'click', withErrorHandling(async function onValidateGithub() {
      await validateGithubToken();
    }, { busyKey: 'validateGithub', fallbackMessage: 'Failed to validate GitHub token.' }));
    addListener(dom.clearGitHubTokenButton, 'click', withErrorHandling(async function onClearGithub() {
      await clearGithubToken();
    }, { busyKey: 'clearGithub', fallbackMessage: 'Failed to clear GitHub token.' }));
    addListener(dom.githubPatInput, 'input', function onPatInput() {
      runtimeState.dirty.githubPat = true;
    });
    addListener(dom.githubTokenTypeInput, 'input', function onTokenTypeInput() {
      runtimeState.dirty.githubTokenType = true;
    });
    const repoInputs = [
      { el: dom.repositoryOwnerInput, key: 'repositoryOwner' },
      { el: dom.repositoryRepoInput, key: 'repositoryRepo' },
      { el: dom.repositoryBaseBranchInput, key: 'repositoryBaseBranch' },
      { el: dom.repositoryWorkingBranchPrefixInput, key: 'repositoryWorkingBranchPrefix' }
    ];
    for (let index = 0; index < repoInputs.length; index += 1) {
      const entry = repoInputs[index];
      addListener(entry.el, 'input', (function makeHandler(key) {
        return function onRepoInput() {
          runtimeState.dirty[key] = true;
        };
      }(entry.key)));
    }
    const selectPairs = [
      dom.repositoryIssueStateSelect,
      dom.repositoryIssueSortSelect,
      dom.repositoryIssueDirectionSelect,
      dom.designerProviderSelect,
      dom.executorProviderSelect,
      dom.auditorProviderSelect
    ];
    for (let index = 0; index < selectPairs.length; index += 1) {
      addListener(selectPairs[index], 'change', withErrorHandling(async function onSelectChange() {
        await saveRepositorySettings();
      }, { busyKey: 'saveRepositorySettings', fallbackMessage: 'Failed to save repository settings.' }));
    }
  }

  function bindManualHubControls() {
    const dom = getDom();
    addListener(dom.manualHubPacketTypeSelect, 'change', function onPacketTypeChange(event) {
      updateManualPacketType(event.target ? event.target.value : '');
      persistManualHubState();
    });
    addListener(dom.manualResponseKindSelect, 'change', function onResponseKindChange(event) {
      const manual = getManualHubState();
      manual.responseKind = normalizeString(event.target ? event.target.value : '');
    });
    addListener(dom.manualHubPacketTextarea, 'input', function onPacketTextInput(event) {
      updateManualPacketText(event.target ? event.target.value : '');
    });
    addListener(dom.manualResponseTextarea, 'input', function onResponseTextInput(event) {
      updateManualResponseText(event.target ? event.target.value : '');
    });
    addListener(dom.copyManualHubPacketButton, 'click', withErrorHandling(async function onCopyManualPacket() {
      await copyManualPacket();
    }, { busyKey: 'copyManualPacket', suppressRender: true, fallbackMessage: 'Failed to copy manual packet.' }));
    addListener(dom.copyManualPacketButton, 'click', withErrorHandling(async function onCopyManualPacketAlt() {
      await copyManualPacket();
    }, { busyKey: 'copyManualPacket', suppressRender: true, fallbackMessage: 'Failed to copy manual packet.' }));
    addListener(dom.validateManualPacketButton, 'click', withErrorHandling(async function onValidateManualPacket() {
      validateManualPacket();
    }, { busyKey: 'validateManualPacket', fallbackMessage: 'Failed to validate manual packet.' }));
    addListener(dom.extractFromActiveTabButton, 'click', withErrorHandling(async function onExtractResponse() {
      await extractLatestResponse();
    }, { busyKey: 'extractResponse', fallbackMessage: 'Failed to extract latest response.' }));
    addListener(dom.previewManualResponseButton, 'click', withErrorHandling(async function onPreviewResponse() {
      previewManualResponse();
    }, { busyKey: 'previewResponse', fallbackMessage: 'Failed to preview response.' }));
    addListener(dom.submitManualResponseButton, 'click', withErrorHandling(async function onSubmitResponse() {
      await submitManualResponse();
      await persistManualHubState();
    }, { busyKey: 'submitManualResponse', fallbackMessage: 'Failed to submit manual response.' }));
    addListener(dom.submitManualResponseConfirmButton, 'click', withErrorHandling(async function onSubmitResponseConfirm() {
      await submitManualResponse();
      await persistManualHubState();
    }, { busyKey: 'submitManualResponse', fallbackMessage: 'Failed to submit manual response.' }));
    addListener(dom.buildManualPacketButton, 'click', withErrorHandling(async function onBuildFromArtifact() {
      buildCurrentManualPacket();
      await persistManualHubState();
    }, { busyKey: 'buildFromArtifact', fallbackMessage: 'Failed to build manual packet from artifact.' }));
    addListener(dom.manualApplyStageStateButton, 'click', withErrorHandling(async function onApplyStageState() {
      const targetStage = dom.manualTargetStageSelect ? normalizeString(dom.manualTargetStageSelect.value) : '';
      const targetStatus = dom.manualTargetStatusSelect ? normalizeString(dom.manualTargetStatusSelect.value) : '';
      await advanceStage({ kind: 'apply_stage_state', stage: targetStage, status: targetStatus });
    }, { busyKey: 'applyStageState', fallbackMessage: 'Failed to apply stage state.' }));
    const markButtons = [
      { el: dom.manualMarkReadyButton, status: STATUS_READY },
      { el: dom.manualMarkInProgressButton, status: STATUS_IN_PROGRESS },
      { el: dom.manualMarkAwaitHumanButton, status: STATUS_AWAITING_HUMAN },
      { el: dom.manualMarkApprovedButton, status: STATUS_APPROVED },
      { el: dom.manualMarkRejectedButton, status: STATUS_REJECTED },
      { el: dom.manualMarkCompletedButton, status: STATUS_COMPLETED }
    ];
    for (let index = 0; index < markButtons.length; index += 1) {
      const entry = markButtons[index];
      if (!entry.el) { continue; }
      addListener(entry.el, 'click', withErrorHandling((function makeMarkHandler(status) {
        return async function onMarkStatus() {
          await advanceStage({ kind: 'mark_status', status: status });
        };
      }(entry.status)), { busyKey: 'markStatus', fallbackMessage: 'Failed to update status.' }));
    }
    addListener(dom.manualClearErrorButton, 'click', withErrorHandling(async function onClearError() {
      await clearWorkflowError();
    }, { busyKey: 'clearWorkflowError', fallbackMessage: 'Failed to clear workflow error.' }));
  }

  function installAllBindings() {
    if (runtimeState.bindingsInstalled) {
      return;
    }
    bindGlobalControls();
    bindTabButtons();
    bindWorkflowControls();
    bindRepositoryControls();
    bindIssueControls();
    bindStageArtifactControls();
    bindTabContextControls();
    bindEventLogControls();
    bindSettingsControls();
    bindManualHubControls();
    runtimeState.bindingsInstalled = true;
  }

  async function initializePopup() {
    if (runtimeState.initialized) {
      return runtimeState;
    }
    if (runtimeState.initializingPromise) {
      return runtimeState.initializingPromise;
    }
    runtimeState.initializingPromise = (async function initialize() {
      try {
        installRuntimeMessageListener();
        installAllBindings();
        try {
          await refreshBootstrap();
        } catch (error) {
          logger.warn('Initial bootstrap refresh failed.', normalizePopupError(error, 'refreshBootstrap failed.'));
          showErrorBanner(normalizePopupError(error, 'Failed to load initial state.'));
        }
        refreshTabContexts();
        renderAll();
        runtimeState.initialized = true;
        return runtimeState;
      } finally {
        runtimeState.initializingPromise = null;
      }
    }());
    return runtimeState.initializingPromise;
  }

  function scheduleAutoInit() {
    if (typeof document === 'undefined') {
      return;
    }
    const start = function start() {
      initializePopup().catch(function onInitFail(error) {
        logger.error('Popup initialization failed.', normalizePopupError(error, 'initializePopup failed.'));
      });
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', start, { once: true });
    } else {
      start();
    }
  }

  const popupApi = deepFreeze({
    initialize: initializePopup,
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
    submitHumanPayload: submitHumanPayload,
    saveGithubSettings: saveGithubSettings,
    validateGithubToken: validateGithubToken,
    clearGithubToken: clearGithubToken,
    saveRepositorySettings: saveRepositorySettings,
    buildCurrentManualPacket: buildCurrentManualPacket,
    copyManualPacket: copyManualPacket,
    validateManualPacket: validateManualPacket,
    previewManualResponse: previewManualResponse,
    submitManualResponse: submitManualResponse,
    extractLatestResponse: extractLatestResponse,
    probeActiveTab: probeActiveTab,
    sendPromptToActiveTab: sendPromptToActiveTab,
    refreshTabContexts: refreshTabContexts,
    copyStageArtifactPrompt: copyStageArtifactPrompt,
    copyStageArtifactPacket: copyStageArtifactPacket,
    copyStageArtifactBoth: copyStageArtifactBoth,
    updateIssueFilter: updateIssueFilter,
    setSelectedIssueNumber: setSelectedIssueNumber,
    setTreePathPrefix: setTreePathPrefix,
    setActiveTab: setActiveTab,
    setShowDebugLog: setShowDebugLog,
    previewManualResponseResult: previewManualResponseResult,
    renderAll: renderAll,
    getRuntimeState: function getRuntimeState() { return cloneValue(runtimeState); }
  });

  root.registerValue('popup', popupApi, {
    overwrite: false,
    freeze: false,
    clone: false
  });

  scheduleAutoInit();
}(typeof globalThis !== 'undefined'
  ? globalThis
  : (typeof self !== 'undefined'
      ? self
      : (typeof window !== 'undefined' ? window : this))));
