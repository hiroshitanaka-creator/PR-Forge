(function registerMAOEConstants(globalScope) {
  'use strict';

  const root = globalScope.MAOE;

  if (!root || typeof root.registerValue !== 'function') {
    throw new Error('[MAOE] namespace.js must be loaded before constants.js.');
  }

  if (root.has('constants')) {
    return;
  }

  const deepFreeze = root.util && typeof root.util.deepFreeze === 'function'
    ? root.util.deepFreeze
    : function passthrough(value) {
      return value;
    };

  function normalizeString(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function uniqueStrings(values) {
    if (!Array.isArray(values)) {
      return [];
    }

    const result = [];
    const seen = new Set();

    for (const rawValue of values) {
      const value = normalizeString(rawValue);

      if (!value || seen.has(value)) {
        continue;
      }

      seen.add(value);
      result.push(value);
    }

    return result;
  }

  function normalizeHostname(input) {
    const value = normalizeString(input).toLowerCase();

    if (!value) {
      return '';
    }

    try {
      const candidate = value.indexOf('://') >= 0 ? value : 'https://' + value;
      return new URL(candidate).hostname.toLowerCase().replace(/\.+$/, '');
    } catch (error) {
      return value
        .replace(/^https?:\/\//, '')
        .split('/')[0]
        .split(':')[0]
        .toLowerCase()
        .replace(/\.+$/, '');
    }
  }

  function slugify(value) {
    const normalized = normalizeString(value)
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();

    const slug = normalized
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .replace(/-{2,}/g, '-');

    return slug || 'task';
  }

  function replacePathParams(template, params) {
    const source = normalizeString(template);
    const values = params && typeof params === 'object' ? params : Object.create(null);

    return source.replace(/\{([a-zA-Z0-9_]+)\}/g, function replaceToken(match, key) {
      if (!Object.prototype.hasOwnProperty.call(values, key)) {
        return match;
      }

      const value = values[key];

      if (value === null || typeof value === 'undefined') {
        return '';
      }

      return encodeURIComponent(String(value));
    });
  }

  const APP = {
    id: 'maoe',
    name: 'Multi-Agent Orchestrator Extension',
    shortName: 'MAOE',
    version: typeof root.VERSION === 'string' && root.VERSION ? root.VERSION : '0.1.0',
    manifestVersion: 3,
    protocolVersion: '1.0.0',
    schemaVersion: '1.0.0'
  };

  const STORAGE_AREAS = {
    LOCAL: 'local',
    SESSION: 'session'
  };

  const STORAGE_KEYS = {
    SETTINGS: 'settings',
    GITHUB_AUTH: 'github_auth',
    REPOSITORY: 'repository',
    WORKFLOW_STATE: 'workflow_state',
    UI_STATE: 'ui_state',
    MANUAL_BRIDGE_DRAFT: 'manual_bridge_draft',
    LAST_PARSED_PAYLOAD: 'last_parsed_payload',
    LAST_AUDIT_RESULT: 'last_audit_result',
    LAST_ERROR: 'last_error',
    EVENT_LOG: 'event_log'
  };

  const HOSTS = {
    GITHUB_API_BASE_URL: 'https://api.github.com',
    PROVIDER_MATCH_PATTERNS: {
      chatgpt: [
        'https://chatgpt.com/',
        'https://chat.openai.com/'
      ],
      claude: [
        'https://claude.ai/'
      ],
      gemini: [
        'https://gemini.google.com/'
      ],
      grok: [
        'https://grok.com/*'
      ]
    }
  };

  const REPOSITORY = {
    DEFAULT_BASE_BRANCH: 'main',
    DEFAULT_ISSUE_STATE: 'open',
    DEFAULT_ISSUE_SORT: 'updated',
    DEFAULT_ISSUE_DIRECTION: 'desc',
    DEFAULT_PULL_REQUEST_DRAFT: false,
    WORKING_BRANCH_PREFIX: 'maoe/issue-',
    BRANCH_NAME_MAX_LENGTH: 120,
    MAX_REPO_TREE_ENTRIES: 5000,
    MAX_TREE_DEPTH: 32,
    DEFAULT_PULL_REQUEST_TITLE_TEMPLATE: '[Issue #{issueNumber}] {issueTitle}'
  };

  const REVIEW_VERDICTS = {
    APPROVE: 'APPROVE',
    REJECT: 'REJECT'
  };

  const WORKFLOW = {
    ROLES: {
      DESIGNER: 'designer',
      EXECUTOR: 'executor',
      AUDITOR: 'auditor'
    },
    STAGES: {
      IDLE: 'idle',
      DESIGN: 'design',
      EXECUTION: 'execution',
      AUDIT: 'audit',
      PR: 'pr',
      COMPLETED: 'completed',
      ERROR: 'error'
    },
    STAGE_ORDER: [
      'idle',
      'design',
      'execution',
      'audit',
      'pr',
      'completed',
      'error'
    ],
    STATUSES: {
      IDLE: 'idle',
      READY: 'ready',
      IN_PROGRESS: 'in_progress',
      AWAITING_HUMAN: 'awaiting_human',
      APPROVED: 'approved',
      REJECTED: 'rejected',
      BLOCKED: 'blocked',
      FAILED: 'failed',
      COMPLETED: 'completed'
    },
    HUMAN_ACTIONS: {
      COPY_PROMPT: 'copy_prompt',
      PASTE_RESPONSE: 'paste_response',
      CONFIRM_TRANSITION: 'confirm_transition',
      CREATE_COMMIT: 'create_commit',
      CREATE_PULL_REQUEST: 'create_pull_request'
    },
    REVIEW_VERDICTS: REVIEW_VERDICTS
  };

  const PROVIDERS = {
    chatgpt: {
      id: 'chatgpt',
      displayName: 'ChatGPT',
      vendor: 'OpenAI',
      defaultRole: WORKFLOW.ROLES.DESIGNER,
      supportedRoles: [
        WORKFLOW.ROLES.DESIGNER,
        WORKFLOW.ROLES.EXECUTOR,
        WORKFLOW.ROLES.AUDITOR
      ],
      siteIds: [
        'chatgpt-web'
      ],
      manualHubEnabled: true,
      domAutomationMode: 'scaffold_only'
    },
    claude: {
      id: 'claude',
      displayName: 'Claude',
      vendor: 'Anthropic',
      defaultRole: WORKFLOW.ROLES.AUDITOR,
      supportedRoles: [
        WORKFLOW.ROLES.DESIGNER,
        WORKFLOW.ROLES.EXECUTOR,
        WORKFLOW.ROLES.AUDITOR
      ],
      siteIds: [
        'claude-web'
      ],
      manualHubEnabled: true,
      domAutomationMode: 'scaffold_only'
    },
    gemini: {
      id: 'gemini',
      displayName: 'Gemini',
      vendor: 'Google',
      defaultRole: WORKFLOW.ROLES.EXECUTOR,
      supportedRoles: [
        WORKFLOW.ROLES.DESIGNER,
        WORKFLOW.ROLES.EXECUTOR,
        WORKFLOW.ROLES.AUDITOR
      ],
      siteIds: [
        'gemini-web'
      ],
      manualHubEnabled: true,
      domAutomationMode: 'scaffold_only'
    },
    grok: {
      id: 'grok',
      displayName: 'Grok',
      vendor: 'xAI',
      defaultRole: WORKFLOW.ROLES.EXECUTOR,
      supportedRoles: [
        WORKFLOW.ROLES.DESIGNER,
        WORKFLOW.ROLES.EXECUTOR,
        WORKFLOW.ROLES.AUDITOR
      ],
      siteIds: [
        'grok-web'
      ],
      manualHubEnabled: true,
      domAutomationMode: 'scaffold_only'
    }
  };

  const DEFAULT_PROVIDER_BY_ROLE = {
    [WORKFLOW.ROLES.DESIGNER]: PROVIDERS.chatgpt.id,
    [WORKFLOW.ROLES.EXECUTOR]: PROVIDERS.gemini.id,
    [WORKFLOW.ROLES.AUDITOR]: PROVIDERS.claude.id
  };

  const SITES = [
    {
      id: 'chatgpt-web',
      providerId: PROVIDERS.chatgpt.id,
      displayName: 'ChatGPT Web',
      hostnames: [
        'chatgpt.com',
        'chat.openai.com'
      ],
      matchPatterns: HOSTS.PROVIDER_MATCH_PATTERNS.chatgpt,
      rootSelectors: [
        'main',
        '#__next',
        'body'
      ],
      inputSelectors: [
        'textarea',
        'div[contenteditable="true"][role="textbox"]',
        'form textarea'
      ],
      outputSelectors: [
        'article',
        'div[data-message-author-role]',
        'main div.markdown',
        'main'
      ],
      submitButtonSelectors: [
        'button[data-testid="send-button"]',
        'button[aria-label*="Send"]',
        'form button[type="submit"]'
      ],
      readinessSelectors: [
        'main',
        'form'
      ],
      extractionStrategy: 'fenced_blocks',
      manualHubRecommended: true,
      domAutomationMode: 'scaffold_only'
    },
    {
      id: 'claude-web',
      providerId: PROVIDERS.claude.id,
      displayName: 'Claude Web',
      hostnames: [
        'claude.ai'
      ],
      matchPatterns: HOSTS.PROVIDER_MATCH_PATTERNS.claude,
      rootSelectors: [
        'main',
        'body'
      ],
      inputSelectors: [
        'div[contenteditable="true"]',
        'textarea',
        'form textarea'
      ],
      outputSelectors: [
        'article',
        'div.prose',
        'main',
        'div[data-testid*="message"]'
      ],
      submitButtonSelectors: [
        'button[aria-label*="Send"]',
        'button[type="submit"]'
      ],
      readinessSelectors: [
        'main',
        'form'
      ],
      extractionStrategy: 'fenced_blocks',
      manualHubRecommended: true,
      domAutomationMode: 'scaffold_only'
    },
    {
      id: 'gemini-web',
      providerId: PROVIDERS.gemini.id,
      displayName: 'Gemini Web',
      hostnames: [
        'gemini.google.com'
      ],
      matchPatterns: HOSTS.PROVIDER_MATCH_PATTERNS.gemini,
      rootSelectors: [
        'main',
        'body'
      ],
      inputSelectors: [
        'textarea',
        'div[contenteditable="true"]',
        'rich-textarea textarea'
      ],
      outputSelectors: [
        'main',
        'message-content',
        'model-response',
        'div.response-container'
      ],
      submitButtonSelectors: [
        'button[aria-label*="Send"]',
        'button[type="submit"]'
      ],
      readinessSelectors: [
        'main',
        'body'
      ],
      extractionStrategy: 'fenced_blocks',
      manualHubRecommended: true,
      domAutomationMode: 'scaffold_only'
    },
    {
      id: 'grok-web',
      providerId: PROVIDERS.grok.id,
      displayName: 'Grok Web',
      hostnames: [
        'grok.com'
      ],
      matchPatterns: HOSTS.PROVIDER_MATCH_PATTERNS.grok,
      rootSelectors: [
        'main',
        'body'
      ],
      inputSelectors: [
        'textarea',
        'div[contenteditable="true"]',
        'form textarea'
      ],
      outputSelectors: [
        'main',
        'article',
        'div.markdown',
        'div[data-testid*="message"]'
      ],
      submitButtonSelectors: [
        'button[aria-label*="Send"]',
        'button[type="submit"]'
      ],
      readinessSelectors: [
        'main',
        'form'
      ],
      extractionStrategy: 'fenced_blocks',
      manualHubRecommended: true,
      domAutomationMode: 'scaffold_only'
    }
  ];

  const GITHUB = {
    API_BASE_URL: HOSTS.GITHUB_API_BASE_URL,
    API_VERSION: '2022-11-28',
    ACCEPT_HEADER: 'application/vnd.github+json',
    REQUEST_TIMEOUT_MS: 20000,
    PAGINATION: {
      DEFAULT_PER_PAGE: 50,
      MAX_PER_PAGE: 100
    },
    HEADERS: {
      AUTHORIZATION: 'Authorization',
      ACCEPT: 'Accept',
      API_VERSION: 'X-GitHub-Api-Version',
      CONTENT_TYPE: 'Content-Type'
    },
    RATE_LIMIT_HEADERS: {
      LIMIT: 'x-ratelimit-limit',
      REMAINING: 'x-ratelimit-remaining',
      RESET: 'x-ratelimit-reset',
      RESOURCE: 'x-ratelimit-resource'
    },
    ENDPOINTS: {
      LIST_REPOSITORY_ISSUES: '/repos/{owner}/{repo}/issues',
      GET_REPOSITORY: '/repos/{owner}/{repo}',
      GET_REPOSITORY_BRANCH: '/repos/{owner}/{repo}/branches/{branch}',
      GET_ISSUE: '/repos/{owner}/{repo}/issues/{issue_number}',
      GET_TREE: '/repos/{owner}/{repo}/git/trees/{tree_sha}',
      CREATE_PULL_REQUEST: '/repos/{owner}/{repo}/pulls'
    },
    QUERY_DEFAULTS: {
      LIST_ISSUES: {
        state: REPOSITORY.DEFAULT_ISSUE_STATE,
        sort: REPOSITORY.DEFAULT_ISSUE_SORT,
        direction: REPOSITORY.DEFAULT_ISSUE_DIRECTION,
        per_page: 50
      },
      GET_TREE: {
        recursive: '1'
      }
    }
  };

  const MESSAGING = {
    RESPONSE_STATUS: {
      OK: 'ok',
      ERROR: 'error'
    },
    TYPES: {
      POPUP_GET_BOOTSTRAP: 'POPUP/GET_BOOTSTRAP',
      POPUP_SAVE_GITHUB_SETTINGS: 'POPUP/SAVE_GITHUB_SETTINGS',
      POPUP_LOAD_ISSUES: 'POPUP/LOAD_ISSUES',
      POPUP_LOAD_REPO_TREE: 'POPUP/LOAD_REPO_TREE',
      POPUP_SELECT_ISSUE: 'POPUP/SELECT_ISSUE',
      POPUP_SUBMIT_HUMAN_PAYLOAD: 'POPUP/SUBMIT_HUMAN_PAYLOAD',
      POPUP_ADVANCE_STAGE: 'POPUP/ADVANCE_STAGE',
      POPUP_RESET_WORKFLOW: 'POPUP/RESET_WORKFLOW',
      POPUP_BUILD_DESIGN_ARTIFACT: 'POPUP/BUILD_DESIGN_ARTIFACT',
      POPUP_BUILD_CURRENT_ARTIFACT: 'POPUP/BUILD_CURRENT_ARTIFACT',
      POPUP_CREATE_PULL_REQUEST: 'POPUP/CREATE_PULL_REQUEST',
      POPUP_CLEAR_WORKFLOW_ERROR: 'POPUP/CLEAR_WORKFLOW_ERROR',
      POPUP_GET_WORKFLOW_STATE: 'POPUP/GET_WORKFLOW_STATE',
      POPUP_GET_EVENT_LOG: 'POPUP/GET_EVENT_LOG',
      BACKGROUND_STATE_CHANGED: 'BACKGROUND/STATE_CHANGED',
      BACKGROUND_ERROR: 'BACKGROUND/ERROR',
      BACKGROUND_LOG_APPENDED: 'BACKGROUND/LOG_APPENDED',
      CONTENT_PROBE: 'CONTENT/PROBE',
      CONTENT_FILL_PROMPT: 'CONTENT/FILL_PROMPT',
      CONTENT_EXTRACT_LATEST_RESPONSE: 'CONTENT/EXTRACT_LATEST_RESPONSE',
      CONTENT_BUILD_MANUAL_PACKET: 'CONTENT/BUILD_MANUAL_PACKET',
      CONTENT_SITE_DETECTED: 'CONTENT/SITE_DETECTED',
      CONTENT_AI_OUTPUT_CAPTURED: 'CONTENT/AI_OUTPUT_CAPTURED'
    }
  };

  const PARSER = {
    SUPPORTED_FENCE_LANGUAGES: [
      'xml',
      'json',
      'diff',
      'patch',
      'text',
      'txt',
      'markdown',
      'md'
    ],
    XML: {
      FILE_ROOT_TAG: 'File',
      REVIEW_ROOT_TAG: 'Review',
      ENVELOPE_ROOT_TAG: 'MAOEPacket',
      FILE_PATH_ATTRIBUTE: 'path',
      CDATA_REQUIRED: true,
      XML_DECLARATION_ALLOWED: false
    },
    JSON: {
      STRICT_OBJECT_ONLY: true,
      REQUIRED_PACKET_KEYS: [
        'protocolVersion',
        'packetType',
        'requestId',
        'createdAt',
        'source',
        'target',
        'payload'
      ]
    },
    LIMITS: {
      MAX_PAYLOAD_CHARS: 500000,
      MAX_FENCE_BLOCKS: 32,
      MAX_FILE_OUTPUTS: 1,
      MAX_REVIEW_FINDINGS: 50
    },
    REVIEW_VERDICTS: [
      REVIEW_VERDICTS.APPROVE,
      REVIEW_VERDICTS.REJECT
    ],
    DELIMITERS: {
      FENCE: '```',
      NEWLINE: '\n'
    }
  };

  const PROMPT = {
    TEMPLATE_IDS: {
      EXECUTOR: 'executor_prompt_v1',
      AUDITOR: 'auditor_prompt_v1'
    },
    PLACEHOLDERS: {
      ISSUE_TITLE: '{{ISSUE_TITLE}}',
      ISSUE_BODY: '{{ISSUE_BODY}}',
      ISSUE_NUMBER: '{{ISSUE_NUMBER}}',
      TARGET_FILE: '{{TARGET_FILE}}',
      REPOSITORY_TREE: '{{REPOSITORY_TREE}}',
      CURRENT_CODE: '{{CURRENT_CODE}}',
      PATCH_DIFF: '{{PATCH_DIFF}}',
      OUTPUT_CONTRACT: '{{OUTPUT_CONTRACT}}',
      AUDIT_CRITERIA: '{{AUDIT_CRITERIA}}'
    },
    OUTPUT_CONTRACTS: {
      EXECUTOR: {
        format: 'xml_file',
        fenceLanguage: 'xml',
        xmlRootTag: PARSER.XML.FILE_ROOT_TAG,
        pathAttribute: PARSER.XML.FILE_PATH_ATTRIBUTE,
        singleFile: true,
        cdataRequired: true
      },
      AUDITOR: {
        format: 'xml_review',
        fenceLanguage: 'xml',
        xmlRootTag: PARSER.XML.REVIEW_ROOT_TAG,
        verdictValues: PARSER.REVIEW_VERDICTS
      }
    },
    REQUIRED_SECTIONS: {
      EXECUTOR: [
        'task',
        'constraints',
        'repository_context',
        'output_contract'
      ],
      AUDITOR: [
        'issue',
        'diff',
        'acceptance_criteria',
        'verdict_contract'
      ]
    }
  };

  const MANUAL_HUB = {
    ENABLED: true,
    PACKET_VERSION: APP.protocolVersion,
    DELIMITERS: {
      BEGIN: '[MAOE_PACKET_BEGIN]',
      END: '[MAOE_PACKET_END]'
    },
    PACKET_TYPES: {
      TASK_DISPATCH: 'TASK_DISPATCH',
      EXECUTION_RESULT: 'EXECUTION_RESULT',
      AUDIT_REQUEST: 'AUDIT_REQUEST',
      AUDIT_RESULT: 'AUDIT_RESULT'
    },
    REQUIRED_FIELDS: {
      ENVELOPE: [
        'protocolVersion',
        'packetType',
        'requestId',
        'createdAt',
        'source',
        'target',
        'payload'
      ],
      TASK_DISPATCH: [
        'issue',
        'targetFile',
        'instructions',
        'outputContract'
      ],
      EXECUTION_RESULT: [
        'targetFile',
        'rawResponse',
        'parsedOutput'
      ],
      AUDIT_REQUEST: [
        'issue',
        'diff',
        'criteria'
      ],
      AUDIT_RESULT: [
        'verdict',
        'summary'
      ]
    },
    XML: {
      ROOT_TAG: PARSER.XML.ENVELOPE_ROOT_TAG
    },
    CLIPBOARD: {
      MAX_CHARACTERS: 100000,
      PREFERRED_FENCE_LANGUAGE: 'json',
      NEWLINE: '\n'
    }
  };

  const UI = {
    POPUP: {
      DEFAULT_TAB: 'dashboard',
      TABS: [
        'dashboard',
        'settings',
        'manual_hub'
      ],
      REFRESH_INTERVAL_MS: 3000,
      LOG_POLL_INTERVAL_MS: 3000,
      MAX_RENDERED_LOG_ENTRIES: 100
    },
    LABELS: {
      STAGES: {
        idle: 'Idle',
        design: 'Design',
        execution: 'Execution',
        audit: 'Audit',
        pr: 'PR',
        completed: 'Completed',
        error: 'Error'
      },
      STATUSES: {
        idle: 'Idle',
        ready: 'Ready',
        in_progress: 'In Progress',
        awaiting_human: 'Awaiting Human',
        approved: 'Approved',
        rejected: 'Rejected',
        blocked: 'Blocked',
        failed: 'Failed',
        completed: 'Completed'
      },
      VERDICTS: {
        APPROVE: 'Approve',
        REJECT: 'Reject'
      }
    }
  };

  const LOGGING = {
    LEVELS: {
      DEBUG: 'debug',
      INFO: 'info',
      WARN: 'warn',
      ERROR: 'error'
    },
    DEFAULT_LEVEL: 'info',
    MAX_ENTRIES: 250,
    MAX_STRING_LENGTH: 4000,
    REDACTION_TEXT: '[REDACTED]',
    SENSITIVE_KEYS: [
      'authorization',
      'proxy-authorization',
      'token',
      'access_token',
      'github_token',
      'pat',
      'personal_access_token',
      'personalaccesstoken',
      'secret',
      'api_key',
      'apikey'
    ],
    SENSITIVE_VALUE_PATTERNS: [
      /gh[pousr]_[A-Za-z0-9]+/g,
      /github_pat_[A-Za-z0-9_]+/g,
      /Bearer\s+[A-Za-z0-9._+/=-]+/gi
    ]
  };

  const ERROR_CODES = {
    UNKNOWN_ERROR: 'UNKNOWN_ERROR',
    INVALID_ARGUMENT: 'INVALID_ARGUMENT',
    INVALID_STATE: 'INVALID_STATE',
    STORAGE_UNAVAILABLE: 'STORAGE_UNAVAILABLE',
    STORAGE_WRITE_FAILED: 'STORAGE_WRITE_FAILED',
    GITHUB_UNAUTHORIZED: 'GITHUB_UNAUTHORIZED',
    GITHUB_FORBIDDEN: 'GITHUB_FORBIDDEN',
    GITHUB_NOT_FOUND: 'GITHUB_NOT_FOUND',
    GITHUB_RATE_LIMITED: 'GITHUB_RATE_LIMITED',
    GITHUB_VALIDATION_FAILED: 'GITHUB_VALIDATION_FAILED',
    GITHUB_NETWORK_ERROR: 'GITHUB_NETWORK_ERROR',
    PARSER_NO_FENCED_BLOCK: 'PARSER_NO_FENCED_BLOCK',
    PARSER_INVALID_XML: 'PARSER_INVALID_XML',
    PARSER_INVALID_JSON: 'PARSER_INVALID_JSON',
    PARSER_MULTIPLE_FILES: 'PARSER_MULTIPLE_FILES',
    PARSER_MISSING_FILE_PATH: 'PARSER_MISSING_FILE_PATH',
    PROVIDER_UNSUPPORTED: 'PROVIDER_UNSUPPORTED',
    HOST_UNSUPPORTED: 'HOST_UNSUPPORTED',
    HUMAN_ACTION_REQUIRED: 'HUMAN_ACTION_REQUIRED',
    MESSAGE_UNSUPPORTED: 'MESSAGE_UNSUPPORTED'
  };

  const DEFAULTS = {
    githubAuth: {
      personalAccessToken: '',
      tokenType: 'PAT',
      lastValidatedAt: '',
      username: ''
    },
    settings: {
      github: {
        apiBaseUrl: GITHUB.API_BASE_URL,
        requestTimeoutMs: GITHUB.REQUEST_TIMEOUT_MS
      },
      repository: {
        owner: '',
        repo: '',
        baseBranch: REPOSITORY.DEFAULT_BASE_BRANCH,
        issueState: REPOSITORY.DEFAULT_ISSUE_STATE,
        issueSort: REPOSITORY.DEFAULT_ISSUE_SORT,
        issueDirection: REPOSITORY.DEFAULT_ISSUE_DIRECTION,
        workingBranchPrefix: REPOSITORY.WORKING_BRANCH_PREFIX
      },
      agents: {
        designerProviderId: DEFAULT_PROVIDER_BY_ROLE[WORKFLOW.ROLES.DESIGNER],
        executorProviderId: DEFAULT_PROVIDER_BY_ROLE[WORKFLOW.ROLES.EXECUTOR],
        auditorProviderId: DEFAULT_PROVIDER_BY_ROLE[WORKFLOW.ROLES.AUDITOR]
      }
    },
    repository: {
      owner: '',
      repo: '',
      defaultBranch: '',
      baseBranch: REPOSITORY.DEFAULT_BASE_BRANCH,
      workingBranchPrefix: REPOSITORY.WORKING_BRANCH_PREFIX
    },
    workflow: {
      stage: WORKFLOW.STAGES.IDLE,
      status: WORKFLOW.STATUSES.IDLE,
      currentIssueNumber: null,
      currentIssueTitle: '',
      currentIssueUrl: '',
      currentTaskFilePath: '',
      activeProviderId: '',
      selectedProviderIds: {
        designer: DEFAULT_PROVIDER_BY_ROLE[WORKFLOW.ROLES.DESIGNER],
        executor: DEFAULT_PROVIDER_BY_ROLE[WORKFLOW.ROLES.EXECUTOR],
        auditor: DEFAULT_PROVIDER_BY_ROLE[WORKFLOW.ROLES.AUDITOR]
      },
      workingBranch: '',
      pullRequestUrl: '',
      pullRequestNumber: null,
      latestExecutorResponse: '',
      latestAuditVerdict: '',
      latestAuditSummary: '',
      lastTransitionAt: '',
      lastHumanActionAt: '',
      lastErrorCode: '',
      lastErrorMessage: ''
    },
    ui: {
      activeTab: UI.POPUP.DEFAULT_TAB,
      issueFilter: '',
      expandedSections: [
        'repository',
        'workflow',
        'issue',
        'settings'
      ],
      showDebugLog: false
    },
    manualHub: {
      lastPacketType: '',
      lastPacketText: '',
      lastResponseText: '',
      clipboardFormat: MANUAL_HUB.CLIPBOARD.PREFERRED_FENCE_LANGUAGE
    }
  };

  const providerIds = Object.keys(PROVIDERS);

  const siteIds = SITES.map(function mapSiteId(site) {
    return site.id;
  });

  const siteById = Object.create(null);
  const siteByHost = Object.create(null);
  const providerByHost = Object.create(null);

  for (const site of SITES) {
    siteById[site.id] = site;

    for (const hostname of site.hostnames) {
      const normalizedHost = normalizeHostname(hostname);

      if (!normalizedHost) {
        continue;
      }

      siteByHost[normalizedHost] = site;
      providerByHost[normalizedHost] = PROVIDERS[site.providerId] || null;
    }
  }

  function buildBranchName(issueNumber, issueTitle, prefix) {
    const configuredPrefix = normalizeString(prefix) || REPOSITORY.WORKING_BRANCH_PREFIX;
    const numericIssue = Number.isFinite(Number(issueNumber))
      ? String(Math.trunc(Number(issueNumber)))
      : 'manual';
    const titleSegment = slugify(issueTitle);
    const rawBranchName = configuredPrefix + numericIssue + '-' + titleSegment;

    return rawBranchName.slice(0, REPOSITORY.BRANCH_NAME_MAX_LENGTH).replace(/\/+$/, '');
  }

  function getSiteById(siteId) {
    const id = normalizeString(siteId);
    return Object.prototype.hasOwnProperty.call(siteById, id) ? siteById[id] : null;
  }

  function getSiteByHost(input) {
    const hostname = normalizeHostname(input);
    return Object.prototype.hasOwnProperty.call(siteByHost, hostname) ? siteByHost[hostname] : null;
  }

  function getSiteByUrl(url) {
    return getSiteByHost(url);
  }

  function getProviderById(providerId) {
    const id = normalizeString(providerId).toLowerCase();
    return Object.prototype.hasOwnProperty.call(PROVIDERS, id) ? PROVIDERS[id] : null;
  }

  function getProviderByHost(input) {
    const hostname = normalizeHostname(input);
    return Object.prototype.hasOwnProperty.call(providerByHost, hostname) ? providerByHost[hostname] : null;
  }

  function getDefaultProviderForRole(role) {
    const normalizedRole = normalizeString(role).toLowerCase();

    if (!Object.prototype.hasOwnProperty.call(DEFAULT_PROVIDER_BY_ROLE, normalizedRole)) {
      return null;
    }

    return getProviderById(DEFAULT_PROVIDER_BY_ROLE[normalizedRole]);
  }

  function isSupportedHost(input) {
    return getSiteByHost(input) !== null;
  }

  function listProviderIds() {
    return providerIds.slice();
  }

  function listSiteIds() {
    return siteIds.slice();
  }

  const constants = {
    APP: APP,
    STORAGE_AREAS: STORAGE_AREAS,
    STORAGE_KEYS: STORAGE_KEYS,
    HOSTS: HOSTS,
    REPOSITORY: REPOSITORY,
    WORKFLOW: WORKFLOW,
    PROVIDERS: PROVIDERS,
    DEFAULT_PROVIDER_BY_ROLE: DEFAULT_PROVIDER_BY_ROLE,
    SITES: SITES,
    GITHUB: GITHUB,
    MESSAGING: MESSAGING,
    PARSER: PARSER,
    PROMPT: PROMPT,
    MANUAL_HUB: MANUAL_HUB,
    UI: UI,
    LOGGING: LOGGING,
    ERROR_CODES: ERROR_CODES,
    DEFAULTS: DEFAULTS,
    LOOKUPS: {
      siteById: siteById,
      siteByHost: siteByHost,
      providerByHost: providerByHost
    },
    helpers: {
      normalizeHostname: normalizeHostname,
      slugify: slugify,
      replacePathParams: replacePathParams,
      buildBranchName: buildBranchName,
      getSiteById: getSiteById,
      getSiteByHost: getSiteByHost,
      getSiteByUrl: getSiteByUrl,
      getProviderById: getProviderById,
      getProviderByHost: getProviderByHost,
      getDefaultProviderForRole: getDefaultProviderForRole,
      isSupportedHost: isSupportedHost,
      listProviderIds: listProviderIds,
      listSiteIds: listSiteIds,
      uniqueStrings: uniqueStrings
    }
  };

  root.registerValue('constants', deepFreeze(constants), {
    overwrite: false,
    freeze: false,
    clone: false
  });
}(typeof globalThis !== 'undefined'
  ? globalThis
  : (typeof self !== 'undefined'
    ? self
    : (typeof window !== 'undefined' ? window : this))));