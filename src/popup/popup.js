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
