(function registerMAOEGitHubIssueService(globalScope) {
  'use strict';

  const root = globalScope.MAOE;

  if (!root || typeof root.registerValue !== 'function') {
    throw new Error('[MAOE] namespace.js must be loaded before github_issue_service.js.');
  }

  if (root.has('github_issue_service')) {
    return;
  }

  if (!root.has('constants')) {
    throw new Error('[MAOE] constants.js must be loaded before github_issue_service.js.');
  }

  if (!root.has('protocol')) {
    throw new Error('[MAOE] protocol.js must be loaded before github_issue_service.js.');
  }

  if (!root.has('github_api')) {
    throw new Error('[MAOE] github_api.js must be loaded before github_issue_service.js.');
  }

  const constants = root.require('constants');
  const protocol = root.require('protocol');
  const githubApi = root.require('github_api');
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
        consoleObject[level]('[MAOE/github_issue_service] ' + message);
        return;
      }

      consoleObject[level]('[MAOE/github_issue_service] ' + message, context);
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
        return loggerModule.createScope('github_issue_service');
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
  const GITHUB = constants.GITHUB || Object.create(null);
  const REPOSITORY = constants.REPOSITORY || Object.create(null);
  const ERROR_CODES = constants.ERROR_CODES || Object.create(null);
  const DEFAULTS = constants.DEFAULTS || Object.create(null);
  const CONSTANT_HELPERS = constants.helpers || Object.create(null);
  const githubApiHelpers = githubApi.helpers || Object.create(null);
  const protocolHelpers = protocol.helpers || Object.create(null);

  const DEFAULT_BASE_URL = normalizeString(GITHUB.API_BASE_URL || 'https://api.github.com').replace(/\/$/, '');
  const DEFAULT_STATE = normalizeString(REPOSITORY.DEFAULT_ISSUE_STATE || 'open').toLowerCase();
  const DEFAULT_SORT = normalizeString(REPOSITORY.DEFAULT_ISSUE_SORT || 'updated').toLowerCase();
  const DEFAULT_DIRECTION = normalizeString(REPOSITORY.DEFAULT_ISSUE_DIRECTION || 'desc').toLowerCase();
  const DEFAULT_PER_PAGE = Number.isFinite(Number(GITHUB.PAGINATION && GITHUB.PAGINATION.DEFAULT_PER_PAGE))
    ? Math.max(1, Math.min(100, Math.trunc(Number(GITHUB.PAGINATION.DEFAULT_PER_PAGE))))
    : 50;
  const MAX_PER_PAGE = Number.isFinite(Number(GITHUB.PAGINATION && GITHUB.PAGINATION.MAX_PER_PAGE))
    ? Math.max(1, Math.min(100, Math.trunc(Number(GITHUB.PAGINATION.MAX_PER_PAGE))))
    : 100;
  const DEFAULT_PAGE_LIMIT = 1;
  const DEFAULT_AUTO_PAGINATE_PAGE_LIMIT = 5;
  const DEFAULT_PREVIEW_LENGTH = 240;
  const DEFAULT_PROTOCOL_VERSION = normalizeString(APP.protocolVersion) || '1.0.0';
  const ALLOWED_STATE_VALUES = ['open', 'closed', 'all'];
  const ALLOWED_SORT_VALUES = ['created', 'updated', 'comments'];
  const ALLOWED_DIRECTION_VALUES = ['asc', 'desc'];
  const ALLOWED_LABEL_MODE_VALUES = ['all', 'any'];

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

  function normalizeNonNegativeInteger(value, fallbackValue) {
    const fallback = Number.isFinite(Number(fallbackValue))
      ? Math.max(0, Math.trunc(Number(fallbackValue)))
      : 0;

    if (!Number.isFinite(Number(value))) {
      return fallback;
    }

    return Math.max(0, Math.trunc(Number(value)));

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

  function nowIsoString() {
    return new Date().toISOString();
  }

  function createRequestId(prefix) {
    if (protocolHelpers && typeof protocolHelpers.generateRequestId === 'function') {
      try {
        return protocolHelpers.generateRequestId(prefix || 'issue');
      } catch (error) {
      }
    }

    const normalizedPrefix = normalizeLowerString(prefix) || 'issue';
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

  function uniqueStrings(values) {
    const source = Array.isArray(values) ? values : [];
    const output = [];
    const seen = new Set();

    for (const value of source) {
      const normalized = normalizeString(value);

      if (!normalized || seen.has(normalized)) {
        continue;
      }

      seen.add(normalized);
      output.push(normalized);
    }

    return output;

  }

  function normalizeIsoTimestamp(value) {
    const source = normalizeString(value);

    if (!source) {
      return '';
    }

    const date = new Date(source);

    if (Number.isNaN(date.getTime())) {
      return source;
    }

    return date.toISOString();

  }

  function collapseWhitespace(value) {
    return coerceText(value).replace(/\s+/g, ' ').trim();
  }

  function buildBodyPreview(text, maxLength) {
    const source = collapseWhitespace(text);
    const normalizedMaxLength = normalizePositiveInteger(maxLength, DEFAULT_PREVIEW_LENGTH);

    if (!source || source.length <= normalizedMaxLength) {
      return source;
    }

    if (normalizedMaxLength <= 1) {
      return source.slice(0, normalizedMaxLength);
    }

    return source.slice(0, normalizedMaxLength - 1).trimEnd() + '…';

  }

  function createIssueServiceError(code, message, details) {
    const error = new Error(normalizeString(message) || 'GitHub issue service error.');
    error.name = 'MAOEGitHubIssueServiceError';
    error.code = normalizeString(code) || (ERROR_CODES.UNKNOWN_ERROR || 'UNKNOWN_ERROR');
    error.details = isPlainObject(details) ? cloneValue(details) : createNullObject();
    error.isGitHubIssueServiceError = true;
    return error;
  }

  function isIssueServiceError(error) {
    return !!(error && typeof error === 'object' && error.isGitHubIssueServiceError === true);
  }

  function normalizeRepositoryRef() {
    if (githubApiHelpers && typeof githubApiHelpers.normalizeRepositoryRef === 'function') {
      try {
        return githubApiHelpers.normalizeRepositoryRef.apply(null, arguments);
      } catch (error) {
      }
    }

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
      output.baseBranch = output.defaultBranch || normalizeString(REPOSITORY.DEFAULT_BASE_BRANCH) || 'main';
    }

    return output;

  }

  function assertRepositoryRef(repository, options) {
    if (githubApiHelpers && typeof githubApiHelpers.assertRepositoryRef === 'function') {
      try {
        return githubApiHelpers.assertRepositoryRef(repository, options);
      } catch (error) {
        throw error;
      }
    }

    const normalized = normalizeRepositoryRef(repository);

    if (!normalized.owner || !normalized.repo) {
      throw createIssueServiceError(
        ERROR_CODES.INVALID_ARGUMENT || 'INVALID_ARGUMENT',
        'GitHub repository owner/repo is not fully configured.',
        {
          repository: normalized,
          source: normalizeString(options && options.source)
        }
      );
    }

    return normalized;

  }

  function buildRepositoryUrls(repository) {
    const normalized = normalizeRepositoryRef(repository);
    const owner = normalizeString(normalized.owner);
    const repo = normalizeString(normalized.repo);

    if (!owner || !repo) {
      return {
        fullName: '',
        htmlUrl: '',
        apiUrl: '',
        issuesHtmlUrl: '',
        issuesApiUrl: ''
      };
    }

    const encodedOwner = encodeURIComponent(owner);
    const encodedRepo = encodeURIComponent(repo);
    const fullName = owner + '/' + repo;
    const htmlUrl = 'https://github.com/' + encodedOwner + '/' + encodedRepo;
    const apiUrl = DEFAULT_BASE_URL + '/repos/' + encodedOwner + '/' + encodedRepo;

    return {
      fullName: fullName,
      htmlUrl: htmlUrl,
      apiUrl: apiUrl,
      issuesHtmlUrl: htmlUrl + '/issues',
      issuesApiUrl: apiUrl + '/issues'
    };

  }

  function buildRepositoryDescriptor(repository) {
    const normalized = normalizeRepositoryRef(repository);
    const urls = buildRepositoryUrls(normalized);

    return deepFreeze({
      owner: normalizeString(normalized.owner),
      repo: normalizeString(normalized.repo),
      fullName: urls.fullName,
      htmlUrl: urls.htmlUrl,
      apiUrl: urls.apiUrl,
      issuesHtmlUrl: urls.issuesHtmlUrl,
      issuesApiUrl: urls.issuesApiUrl,
      baseBranch: normalizeString(normalized.baseBranch) || normalizeString(normalized.defaultBranch) || normalizeString(REPOSITORY.DEFAULT_BASE_BRANCH) || 'main',
      defaultBranch: normalizeString(normalized.defaultBranch),
      workingBranchPrefix: normalizeString(normalized.workingBranchPrefix)
    });

  }

  function parseRepositoryFromApiUrl(url) {
    const source = normalizeString(url);

    if (!source) {
      return createNullObject();
    }

    try {
      const parsed = new URL(source);
      const match = /^\/repos\/([^/]+)\/([^/]+)\/?$/.exec(parsed.pathname);

      if (!match) {
        return createNullObject();
      }

      return {
        owner: decodeURIComponent(match[1]),
        repo: decodeURIComponent(match[2])
      };
    } catch (error) {
      return createNullObject();
    }

  }

  function parseRepositoryFromHtmlUrl(url) {
    const source = normalizeString(url);

    if (!source) {
      return createNullObject();
    }

    try {
      const parsed = new URL(source);
      const match = /^\/([^/]+)\/([^/]+)\/(?:issues|pull)\/\d+\/?$/.exec(parsed.pathname);

      if (!match) {
        const rootMatch = /^\/([^/]+)\/([^/]+)\/?$/.exec(parsed.pathname);

        if (!rootMatch) {
          return createNullObject();
        }

        return {
          owner: decodeURIComponent(rootMatch[1]),
          repo: decodeURIComponent(rootMatch[2])
        };
      }

      return {
        owner: decodeURIComponent(match[1]),
        repo: decodeURIComponent(match[2])
      };
    } catch (error) {
      return createNullObject();
    }

  }

  function inferRepositoryFromIssue(rawIssue, fallbackRepository) {
    const source = isPlainObject(rawIssue) ? rawIssue : createNullObject();
    const fromRepositoryUrl = parseRepositoryFromApiUrl(source.repository_url);
    const fromHtmlUrl = parseRepositoryFromHtmlUrl(source.html_url);

    return buildRepositoryDescriptor(
      normalizeRepositoryRef(
        stableObject(fallbackRepository),
        fromRepositoryUrl,
        fromHtmlUrl
      )
    );

  }

  function parseLabelInput(value) {
    if (typeof value === 'string') {
      return value.split(',').map(function mapLabel(label) {
        return normalizeString(label);
      }).filter(Boolean);
    }

    if (!Array.isArray(value)) {
      return [];
    }

    const output = [];

    for (const entry of value) {
      if (typeof entry === 'string') {
        output.push(normalizeString(entry));
        continue;
      }

      if (isPlainObject(entry) && normalizeString(entry.name)) {
        output.push(normalizeString(entry.name));
      }
    }

    return uniqueStrings(output);

  }

  function parseIssueNumberList(value) {
    let source = [];

    if (typeof value === 'string') {
      source = value.split(',');
    } else if (Array.isArray(value)) {
      source = value.slice();
    } else {
      return [];
    }

    const output = [];
    const seen = new Set();

    for (const entry of source) {
      const normalizedNumber = normalizeIntegerOrNull(entry);

      if (normalizedNumber === null || seen.has(normalizedNumber)) {
        continue;
      }

      seen.add(normalizedNumber);
      output.push(normalizedNumber);
    }

    return output;

  }

  function normalizeIssueState(value) {
    return oneOf(normalizeLowerString(value), ['open', 'closed'], normalizeLowerString(value));
  }

  function normalizeListState(value) {
    return oneOf(normalizeLowerString(value), ALLOWED_STATE_VALUES, DEFAULT_STATE);
  }

  function normalizeSort(value) {
    return oneOf(normalizeLowerString(value), ALLOWED_SORT_VALUES, DEFAULT_SORT);
  }

  function normalizeDirection(value) {
    return oneOf(normalizeLowerString(value), ALLOWED_DIRECTION_VALUES, DEFAULT_DIRECTION);
  }

  function normalizeLabelMode(value) {
    return oneOf(normalizeLowerString(value), ALLOWED_LABEL_MODE_VALUES, 'all');
  }

  function normalizeUser(user) {
    const source = isPlainObject(user) ? user : createNullObject();

    return deepFreeze({
      login: normalizeString(source.login),
      id: normalizeIntegerOrNull(source.id),
      nodeId: normalizeString(source.node_id),
      type: normalizeString(source.type),
      siteAdmin: normalizeBoolean(source.site_admin, false),
      avatarUrl: normalizeString(source.avatar_url),
      htmlUrl: normalizeString(source.html_url),
      apiUrl: normalizeString(source.url)
    });

  }

  function normalizeLabel(label) {
    if (typeof label === 'string') {
      return deepFreeze({
        id: null,
        nodeId: '',
        name: normalizeString(label),
        color: '',
        default: false,
        description: '',
        apiUrl: ''
      });
    }

    const source = isPlainObject(label) ? label : createNullObject();

    return deepFreeze({
      id: normalizeIntegerOrNull(source.id),
      nodeId: normalizeString(source.node_id),
      name: normalizeString(source.name),
      color: normalizeString(source.color),
      default: normalizeBoolean(source.default, false),
      description: normalizeString(source.description),
      apiUrl: normalizeString(source.url)
    });

  }

  function normalizeMilestone(milestone) {
    if (!isPlainObject(milestone)) {
      return null;
    }

    const source = milestone;

    return deepFreeze({
      id: normalizeIntegerOrNull(source.id),
      number: normalizeIntegerOrNull(source.number),
      nodeId: normalizeString(source.node_id),
      title: normalizeString(source.title),
      description: coerceText(source.description),
      state: normalizeLowerString(source.state),
      createdAt: normalizeIsoTimestamp(source.created_at),
      updatedAt: normalizeIsoTimestamp(source.updated_at),
      closedAt: normalizeIsoTimestamp(source.closed_at),
      dueOn: normalizeIsoTimestamp(source.due_on),
      openIssues: normalizeNonNegativeInteger(source.open_issues, 0),
      closedIssues: normalizeNonNegativeInteger(source.closed_issues, 0),
      htmlUrl: normalizeString(source.html_url),
      apiUrl: normalizeString(source.url)
    });

  }

  function normalizePullRequestRef(value) {
    if (!isPlainObject(value)) {
      return null;
    }

    const source = value;

    return deepFreeze({
      apiUrl: normalizeString(source.url),
      htmlUrl: normalizeString(source.html_url),
      diffUrl: normalizeString(source.diff_url),
      patchUrl: normalizeString(source.patch_url),
      mergedAt: normalizeIsoTimestamp(source.merged_at)
    });

  }

  function normalizeReactions(value) {
    const source = isPlainObject(value) ? value : createNullObject();

    return deepFreeze({
      totalCount: normalizeNonNegativeInteger(source.total_count, 0),
      plusOne: normalizeNonNegativeInteger(source['+1'], 0),
      minusOne: normalizeNonNegativeInteger(source['-1'], 0),
      laugh: normalizeNonNegativeInteger(source.laugh, 0),
      hooray: normalizeNonNegativeInteger(source.hooray, 0),
      confused: normalizeNonNegativeInteger(source.confused, 0),
      heart: normalizeNonNegativeInteger(source.heart, 0),
      rocket: normalizeNonNegativeInteger(source.rocket, 0),
      eyes: normalizeNonNegativeInteger(source.eyes, 0)
    });

  }

  function isPullRequestIssue(issue) {
    const source = isPlainObject(issue) ? issue : createNullObject();

    if (isPlainObject(source.pull_request)) {
      return true;
    }

    const htmlUrl = normalizeString(source.html_url);

    if (htmlUrl.indexOf('/pull/') >= 0) {
      return true;
    }

    return false;

  }

  function normalizeIssue(rawIssue, options) {
    const source = isPlainObject(rawIssue) ? rawIssue : createNullObject();
    const config = isPlainObject(options) ? options : createNullObject();
    const repository = inferRepositoryFromIssue(source, config.repository);
    const pullRequest = normalizePullRequestRef(source.pull_request);
    const labels = stableArray(source.labels).map(normalizeLabel).filter(function filterLabels(label) {
      return !!label.name;
    });
    const assignees = stableArray(source.assignees).map(normalizeUser).filter(function filterAssignees(user) {
      return !!user.login;
    });
    const previewLength = normalizePositiveInteger(config.previewLength, DEFAULT_PREVIEW_LENGTH);
    const body = coerceText(source.body);

    return deepFreeze({
      id: normalizeIntegerOrNull(source.id),
      nodeId: normalizeString(source.node_id),
      number: normalizeIntegerOrNull(source.number),
      key: normalizeIntegerOrNull(source.number) === null ? '' : '#' + String(normalizeIntegerOrNull(source.number)),
      title: normalizeString(source.title),
      body: body,
      bodyPreview: buildBodyPreview(body, previewLength),
      bodyLength: body.length,
      state: normalizeIssueState(source.state),
      stateReason: normalizeLowerString(source.state_reason),
      locked: normalizeBoolean(source.locked, false),
      activeLockReason: normalizeString(source.active_lock_reason),
      comments: normalizeNonNegativeInteger(source.comments, 0),
      authorAssociation: normalizeString(source.author_association),
      isPullRequest: pullRequest !== null || isPullRequestIssue(source),
      kind: pullRequest !== null || isPullRequestIssue(source) ? 'pull_request' : 'issue',
      repository: repository,
      user: normalizeUser(source.user),
      assignees: assignees,
      assigneeLogins: assignees.map(function mapAssignee(user) {
        return user.login;
      }),
      labels: labels,
      labelNames: labels.map(function mapLabel(label) {
        return label.name;
      }),
      milestone: normalizeMilestone(source.milestone),
      pullRequest: pullRequest,
      reactions: normalizeReactions(source.reactions),
      apiUrl: normalizeString(source.url),
      repositoryUrl: normalizeString(source.repository_url),
      labelsUrl: normalizeString(source.labels_url),
      commentsUrl: normalizeString(source.comments_url),
      eventsUrl: normalizeString(source.events_url),
      htmlUrl: normalizeString(source.html_url),
      timelineUrl: normalizeString(source.timeline_url),
      performedViaGithubApp: isPlainObject(source.performed_via_github_app)
        ? cloneValue(source.performed_via_github_app)
        : null,
      createdAt: normalizeIsoTimestamp(source.created_at),
      updatedAt: normalizeIsoTimestamp(source.updated_at),
      closedAt: normalizeIsoTimestamp(source.closed_at),
      summary: deepFreeze({
        key: normalizeIntegerOrNull(source.number) === null ? '' : '#' + String(normalizeIntegerOrNull(source.number)),
        title: normalizeString(source.title),
        state: normalizeIssueState(source.state),
        kind: pullRequest !== null || isPullRequestIssue(source) ? 'pull_request' : 'issue',
        bodyPreview: buildBodyPreview(body, previewLength),
        url: normalizeString(source.html_url) || normalizeString(source.url),
        updatedAt: normalizeIsoTimestamp(source.updated_at),
        labels: labels.map(function mapSummaryLabel(label) {
          return label.name;
        })
      })
    });

  }

  function summarizeIssue(issue, options) {
    const normalized = normalizeIssueInput(issue, options);

    return deepFreeze({
      key: normalized.key,
      number: normalized.number,
      title: normalized.title,
      state: normalized.state,
      kind: normalized.kind,
      url: normalized.htmlUrl || normalized.apiUrl,
      updatedAt: normalized.updatedAt,
      labelNames: normalized.labelNames.slice(),
      assigneeLogins: normalized.assigneeLogins.slice(),
      repositoryFullName: normalized.repository.fullName
    });

  }

  function normalizeIssueInput(issue, options) {
    const source = isPlainObject(issue) ? issue : createNullObject();

    if (hasOwn(source, 'summary')
      && hasOwn(source, 'repository')
      && Array.isArray(source.labelNames)
      && typeof source.kind === 'string') {
      return source;
    }

    return normalizeIssue(source, options);

  }

  function normalizeQuerySnapshot(listOptions) {
    const source = isPlainObject(listOptions) ? listOptions : createNullObject();

    return deepFreeze({
      state: normalizeListState(source.state),
      sort: normalizeSort(source.sort),
      direction: normalizeDirection(source.direction),
      page: normalizePositiveInteger(source.page, 1),
      perPage: Math.min(MAX_PER_PAGE, normalizePositiveInteger(source.perPage, DEFAULT_PER_PAGE)),
      labels: parseLabelInput(source.labels),
      labelMode: normalizeLabelMode(source.labelMode),
      textQuery: normalizeString(source.textQuery),
      issueNumbers: parseIssueNumberList(source.issueNumbers),
      includePullRequests: normalizeBoolean(source.includePullRequests, false),
      autoPaginate: normalizeBoolean(source.autoPaginate, false),
      pageLimit: normalizePositiveInteger(source.pageLimit, DEFAULT_PAGE_LIMIT),
      maxItems: normalizePositiveInteger(source.maxItems, DEFAULT_PER_PAGE)
    });

  }

  function normalizeListOptions(context, options) {
    const source = isPlainObject(options) ? cloneValue(options) : createNullObject();
    const repository = buildRepositoryDescriptor(
      assertRepositoryRef(
        mergePlainObjects(
          stableObject(source.repository),
          stableObject(context.repository)
        ),
        {
          source: 'listIssues'
        }
      )
    );
    const labels = parseLabelInput(source.labels || source.labelNames || source.label);
    const labelMode = normalizeLabelMode(source.labelMode);
    const state = normalizeListState(source.state || source.issueState || DEFAULT_STATE);
    const sort = normalizeSort(source.sort || DEFAULT_SORT);
    const direction = normalizeDirection(source.direction || DEFAULT_DIRECTION);
    const page = normalizePositiveInteger(
      source.page || (isPlainObject(source.query) ? source.query.page : null),
      1
    );
    const perPage = Math.min(
      MAX_PER_PAGE,
      normalizePositiveInteger(
        source.perPage || source.per_page || (isPlainObject(source.query) ? source.query.per_page : null),
        DEFAULT_PER_PAGE
      )
    );
    const includePullRequests = normalizeBoolean(source.includePullRequests, false);
    const includeRaw = normalizeBoolean(source.includeRaw, false);
    const textQuery = normalizeLowerString(source.textQuery || source.search || source.filterText || source.q);
    const issueNumbers = parseIssueNumberList(source.issueNumbers || source.numbers);
    const autoPaginate = normalizeBoolean(source.autoPaginate, false);
    const pageLimit = normalizePositiveInteger(
      source.pageLimit || source.maxPages,
      autoPaginate ? DEFAULT_AUTO_PAGINATE_PAGE_LIMIT : DEFAULT_PAGE_LIMIT
    );
    const maxItems = normalizePositiveInteger(
      source.maxItems || source.limit,
      perPage * pageLimit
    );
    const serverQuery = mergePlainObjects(stableObject(source.query));

    serverQuery.page = page;
    serverQuery.per_page = perPage;
    serverQuery.state = state;
    serverQuery.sort = sort;
    serverQuery.direction = direction;

    if (labelMode === 'all' && labels.length > 0) {
      serverQuery.labels = labels.join(',');
    }

    if (normalizeString(source.since)) {
      serverQuery.since = normalizeString(source.since);
    }

    if (normalizeString(source.creator)) {
      serverQuery.creator = normalizeString(source.creator);
    }

    if (normalizeString(source.assignee)) {
      serverQuery.assignee = normalizeString(source.assignee);
    }

    if (normalizeString(source.mentioned)) {
      serverQuery.mentioned = normalizeString(source.mentioned);
    }

    if (normalizeString(source.milestone)) {
      serverQuery.milestone = normalizeString(source.milestone);
    }

    return deepFreeze({
      repository: repository,
      state: state,
      sort: sort,
      direction: direction,
      page: page,
      perPage: perPage,
      labels: labels,
      labelMode: labelMode,
      textQuery: textQuery,
      issueNumbers: issueNumbers,
      includePullRequests: includePullRequests,
      includeRaw: includeRaw,
      autoPaginate: autoPaginate,
      pageLimit: pageLimit,
      maxItems: maxItems,
      previewLength: normalizePositiveInteger(source.previewLength, DEFAULT_PREVIEW_LENGTH),
      query: serverQuery
    });

  }

  function parsePageNumberFromUrl(url) {
    const source = normalizeString(url);

    if (!source) {
      return null;
    }

    try {
      const parsed = new URL(source);
      const page = normalizeIntegerOrNull(parsed.searchParams.get('page'));
      return page === null ? null : Math.max(1, page);
    } catch (error) {
      return null;
    }

  }

  function parsePerPageFromUrl(url) {
    const source = normalizeString(url);

    if (!source) {
      return null;
    }

    try {
      const parsed = new URL(source);
      const perPage = normalizeIntegerOrNull(parsed.searchParams.get('per_page'));
      return perPage === null ? null : Math.max(1, Math.min(MAX_PER_PAGE, perPage));
    } catch (error) {
      return null;
    }

  }

  function buildPaginationInfo(initialResponse, lastResponse, listOptions, pageCountFetched) {
    const initialLinks = isPlainObject(initialResponse && initialResponse.links)
      ? initialResponse.links
      : createNullObject();
    const lastLinks = isPlainObject(lastResponse && lastResponse.links)
      ? lastResponse.links
      : createNullObject();
    const nextUrl = normalizeString(lastLinks.next);
    const prevUrl = normalizeString(initialLinks.prev || lastLinks.prev);
    const firstUrl = normalizeString(initialLinks.first || lastLinks.first);
    const lastUrl = normalizeString(lastLinks.last || initialLinks.last);
    const firstPage = parsePageNumberFromUrl(firstUrl) || 1;
    const currentPage = listOptions.page;
    const nextPage = parsePageNumberFromUrl(nextUrl);
    const prevPage = parsePageNumberFromUrl(prevUrl);
    const lastPage = parsePageNumberFromUrl(lastUrl);
    const perPage = parsePerPageFromUrl(nextUrl)
      || parsePerPageFromUrl(prevUrl)
      || parsePerPageFromUrl(firstUrl)
      || parsePerPageFromUrl(lastUrl)
      || listOptions.perPage;

    return deepFreeze({
      page: currentPage,
      perPage: perPage,
      pageCountFetched: pageCountFetched,
      hasNext: !!nextUrl,
      hasPrev: !!prevUrl,
      nextUrl: nextUrl,
      prevUrl: prevUrl,
      firstUrl: firstUrl,
      lastUrl: lastUrl,
      nextPage: nextPage,
      prevPage: prevPage,
      firstPage: firstPage,
      lastPage: lastPage
    });

  }

  function dedupeIssues(items) {
    const source = Array.isArray(items) ? items : [];
    const output = [];
    const seen = new Set();

    for (const issue of source) {
      const normalized = normalizeIssueInput(issue);
      const signature = [
        normalizeString(normalized.repository.fullName),
        normalized.number === null ? '' : String(normalized.number),
        normalizeString(normalized.kind)
      ].join('\u0000');

      if (seen.has(signature)) {
        continue;
      }

      seen.add(signature);
      output.push(normalized);
    }

    return output;

  }

  function buildIssueNumbersSet(issueNumbers) {
    const source = Array.isArray(issueNumbers) ? issueNumbers : [];
    const set = new Set();

    for (const issueNumber of source) {
      const normalized = normalizeIntegerOrNull(issueNumber);

      if (normalized === null) {
        continue;
      }

      set.add(normalized);
    }

    return set;

  }

  function matchesTextQuery(issue, textQuery) {
    const normalizedQuery = normalizeLowerString(textQuery);

    if (!normalizedQuery) {
      return true;
    }

    const source = normalizeIssueInput(issue);
    const haystack = [
      normalizeLowerString(source.title),
      normalizeLowerString(source.body),
      normalizeLowerString(source.bodyPreview),
      normalizeLowerString(source.user && source.user.login),
      normalizeLowerString(source.repository && source.repository.fullName),
      source.labelNames.map(function mapLabel(label) {
        return normalizeLowerString(label);
      }).join(' ')
    ].join('\n');

    return haystack.indexOf(normalizedQuery) >= 0;

  }

  function matchesLabelFilter(issue, labels, labelMode) {
    const normalizedLabels = parseLabelInput(labels);

    if (normalizedLabels.length === 0) {
      return true;
    }

    const source = normalizeIssueInput(issue);
    const issueLabelNames = source.labelNames.map(function mapLabel(label) {
      return normalizeLowerString(label);
    });
    const normalizedMode = normalizeLabelMode(labelMode);

    if (normalizedMode === 'any') {
      return normalizedLabels.some(function hasAnyLabel(label) {
        return issueLabelNames.indexOf(normalizeLowerString(label)) >= 0;
      });
    }

    return normalizedLabels.every(function hasAllLabels(label) {
      return issueLabelNames.indexOf(normalizeLowerString(label)) >= 0;
    });

  }

  function matchesIssueNumberFilter(issue, issueNumbersSet) {
    if (!(issueNumbersSet instanceof Set) || issueNumbersSet.size === 0) {
      return true;
    }

    const source = normalizeIssueInput(issue);

    if (source.number === null) {
      return false;
    }

    return issueNumbersSet.has(source.number);

  }

  function filterIssues(items, listOptions) {
    const source = Array.isArray(items) ? items : [];
    const options = isPlainObject(listOptions) ? listOptions : createNullObject();
    const issueNumbersSet = buildIssueNumbersSet(options.issueNumbers);
    const filtered = [];
    const stats = {
      received: source.length,
      returned: 0,
      issuesReceived: 0,
      pullRequestsReceived: 0,
      issuesReturned: 0,
      pullRequestsReturned: 0,
      filteredOutPullRequests: 0,
      filteredOutText: 0,
      filteredOutLabels: 0,
      filteredOutIssueNumbers: 0
    };

    for (const issue of source) {
      const normalized = normalizeIssueInput(issue);

      if (normalized.isPullRequest) {
        stats.pullRequestsReceived += 1;
      } else {
        stats.issuesReceived += 1;
      }

      if (!options.includePullRequests && normalized.isPullRequest) {
        stats.filteredOutPullRequests += 1;
        continue;
      }

      if (!matchesIssueNumberFilter(normalized, issueNumbersSet)) {
        stats.filteredOutIssueNumbers += 1;
        continue;
      }

      if (!matchesLabelFilter(normalized, options.labels, options.labelMode)) {
        stats.filteredOutLabels += 1;
        continue;
      }

      if (!matchesTextQuery(normalized, options.textQuery)) {
        stats.filteredOutText += 1;
        continue;
      }

      filtered.push(normalized);

      if (normalized.isPullRequest) {
        stats.pullRequestsReturned += 1;
      } else {
        stats.issuesReturned += 1;
      }
    }

    stats.returned = filtered.length;

    return deepFreeze({
      items: filtered,
      stats: stats
    });

  }

  function createPageSummary(response, fallbackPage) {
    const page = parsePageNumberFromUrl(response && response.url) || normalizePositiveInteger(fallbackPage, 1);

    return deepFreeze({
      page: page,
      perPage: parsePerPageFromUrl(response && response.url) || normalizePositiveInteger(parsePerPageFromUrl(response && response.links && response.links.next), DEFAULT_PER_PAGE),
      count: Array.isArray(response && response.data) ? response.data.length : 0,
      githubRequestId: normalizeString(response && response.githubRequestId),
      rateLimitRemaining: normalizeIntegerOrNull(response && response.rateLimit && response.rateLimit.remaining)
    });

  }

  function buildListResultEnvelope(listOptions, initialResponse, lastResponse, normalizedItems, filterResult, githubRequestIds, pageSummaries, includeRaw, rawItems) {
    const initial = isPlainObject(initialResponse) ? initialResponse : createNullObject();
    const last = isPlainObject(lastResponse) ? lastResponse : createNullObject();
    const pageCountFetched = Array.isArray(pageSummaries) ? pageSummaries.length : 0;
    const pagination = buildPaginationInfo(initial, last, listOptions, pageCountFetched);
    const counts = {
      rawReceived: Array.isArray(rawItems) ? rawItems.length : 0,
      deduplicated: Array.isArray(normalizedItems) ? normalizedItems.length : 0,
      returned: filterResult && filterResult.stats ? filterResult.stats.returned : 0,
      issuesReceived: filterResult && filterResult.stats ? filterResult.stats.issuesReceived : 0,
      pullRequestsReceived: filterResult && filterResult.stats ? filterResult.stats.pullRequestsReceived : 0,
      issuesReturned: filterResult && filterResult.stats ? filterResult.stats.issuesReturned : 0,
      pullRequestsReturned: filterResult && filterResult.stats ? filterResult.stats.pullRequestsReturned : 0,
      filteredOutPullRequests: filterResult && filterResult.stats ? filterResult.stats.filteredOutPullRequests : 0,
      filteredOutText: filterResult && filterResult.stats ? filterResult.stats.filteredOutText : 0,
      filteredOutLabels: filterResult && filterResult.stats ? filterResult.stats.filteredOutLabels : 0,
      filteredOutIssueNumbers: filterResult && filterResult.stats ? filterResult.stats.filteredOutIssueNumbers : 0
    };

    return deepFreeze({
      ok: true,
      repository: cloneValue(listOptions.repository),
      query: cloneValue(normalizeQuerySnapshot(listOptions)),
      items: cloneValue(filterResult.items),
      counts: counts,
      pagination: pagination,
      pageSummaries: cloneValue(pageSummaries || []),
      githubRequestIds: uniqueStrings(githubRequestIds || []),
      rateLimit: isPlainObject(last.rateLimit) ? cloneValue(last.rateLimit) : createNullObject(),
      fetchedAt: nowIsoString(),
      partial: pagination.hasNext && listOptions.autoPaginate && pagination.pageCountFetched >= listOptions.pageLimit,
      rawItems: includeRaw ? cloneValue(rawItems || []) : undefined
    });

  }

  async function listIssues(options) {
    const client = await githubApi.createClient(options);
    const listOptions = normalizeListOptions(client.context, options);
    const requestId = createRequestId('issues');
    const githubRequestIds = [];
    const pageSummaries = [];
    const rawItems = [];
    let initialResponse = null;
    let currentResponse = null;
    let lastResponse = null;
    let nextUrl = '';
    let pageCursor = listOptions.page;

    logger.debug('Listing GitHub issues.', {
      requestId: requestId,
      repository: cloneValue(listOptions.repository),
      query: cloneValue(normalizeQuerySnapshot(listOptions))
    });

    try {
      currentResponse = await client.listRepositoryIssues({
        repository: listOptions.repository,
        state: listOptions.state,
        sort: listOptions.sort,
        direction: listOptions.direction,
        perPage: listOptions.perPage,
        page: listOptions.page,
        query: listOptions.query
      });
      initialResponse = currentResponse;
      lastResponse = currentResponse;

      while (currentResponse) {
        if (normalizeString(currentResponse.githubRequestId)) {
          githubRequestIds.push(normalizeString(currentResponse.githubRequestId));
        }

        pageSummaries.push(createPageSummary(currentResponse, pageCursor));

        if (Array.isArray(currentResponse.data) && currentResponse.data.length > 0) {
          rawItems.push.apply(rawItems, currentResponse.data);
        }

        if (rawItems.length >= listOptions.maxItems) {
          break;
        }

        nextUrl = normalizeString(currentResponse.links && currentResponse.links.next);

        if (!listOptions.autoPaginate || !nextUrl || pageSummaries.length >= listOptions.pageLimit) {
          break;
        }

        pageCursor = (parsePageNumberFromUrl(nextUrl) || pageCursor + 1);
        currentResponse = await client.get(nextUrl, {
          expect: 'json'
        });
        lastResponse = currentResponse;
      }

      const limitedRawItems = rawItems.slice(0, listOptions.maxItems);
      const normalizedItems = dedupeIssues(limitedRawItems.map(function mapIssue(rawIssue) {
        return normalizeIssue(rawIssue, {
          repository: listOptions.repository,
          previewLength: listOptions.previewLength
        });
      }));
      const filterResult = filterIssues(normalizedItems, listOptions);
      const envelope = buildListResultEnvelope(
        listOptions,
        initialResponse,
        lastResponse,
        normalizedItems,
        filterResult,
        githubRequestIds,
        pageSummaries,
        listOptions.includeRaw,
        limitedRawItems
      );

      logger.debug('GitHub issues listed successfully.', {
        requestId: requestId,
        repository: envelope.repository.fullName,
        returned: envelope.counts.returned,
        rawReceived: envelope.counts.rawReceived,
        pageCountFetched: envelope.pagination.pageCountFetched,
        partial: envelope.partial
      });

      return envelope;
    } catch (error) {
      const normalizedError = isIssueServiceError(error)
        ? error
        : createIssueServiceError(
          normalizeString(error && error.code) || (ERROR_CODES.UNKNOWN_ERROR || 'UNKNOWN_ERROR'),
          normalizeString(error && error.message) || 'Failed to list GitHub issues.',
          isPlainObject(error && error.details) ? error.details : createNullObject()
        );

      logger.warn('Failed to list GitHub issues.', {
        requestId: requestId,
        repository: cloneValue(listOptions.repository),
        code: normalizedError.code,
        message: normalizedError.message,
        details: cloneValue(normalizedError.details)
      });

      throw normalizedError;
    }

  }

  function normalizeGetIssueOptions(context, options) {
    const source = isPlainObject(options) ? cloneValue(options) : createNullObject();
    const repository = buildRepositoryDescriptor(
      assertRepositoryRef(
        mergePlainObjects(stableObject(source.repository), stableObject(context.repository)),
        {
          source: 'getIssue'
        }
      )
    );
    const issueNumber = normalizeIntegerOrNull(
      source.issueNumber
      || source.number
      || (isPlainObject(source.issue) ? source.issue.number : null)
    );

    if (issueNumber === null) {
      throw createIssueServiceError(
        ERROR_CODES.INVALID_ARGUMENT || 'INVALID_ARGUMENT',
        'issueNumber is required.',
        {
          repository: repository
        }
      );
    }

    return deepFreeze({
      repository: repository,
      issueNumber: issueNumber,
      includePullRequests: normalizeBoolean(source.includePullRequests, false),
      includeRaw: normalizeBoolean(source.includeRaw, false),
      previewLength: normalizePositiveInteger(source.previewLength, DEFAULT_PREVIEW_LENGTH),
      returnNullOnNotFound: normalizeBoolean(source.returnNullOnNotFound, false)
    });

  }

  async function getIssue(options) {
    const client = await githubApi.createClient(options);
    const requestOptions = normalizeGetIssueOptions(client.context, options);
    const requestId = createRequestId('issue');

    logger.debug('Fetching GitHub issue.', {
      requestId: requestId,
      repository: cloneValue(requestOptions.repository),
      issueNumber: requestOptions.issueNumber,
      includePullRequests: requestOptions.includePullRequests
    });

    try {
      const response = await client.getIssue({
        repository: requestOptions.repository,
        issueNumber: requestOptions.issueNumber
      });
      const item = normalizeIssue(response.data, {
        repository: requestOptions.repository,
        previewLength: requestOptions.previewLength
      });

      if (item.isPullRequest && !requestOptions.includePullRequests) {
        throw createIssueServiceError(
          ERROR_CODES.INVALID_STATE || 'INVALID_STATE',
          'Requested issue number resolves to a pull request, not an issue.',
          {
            issueNumber: requestOptions.issueNumber,
            repository: cloneValue(requestOptions.repository),
            htmlUrl: item.htmlUrl
          }
        );
      }

      const envelope = deepFreeze({
        ok: true,
        repository: cloneValue(requestOptions.repository),
        item: cloneValue(item),
        githubRequestId: normalizeString(response.githubRequestId),
        rateLimit: isPlainObject(response.rateLimit) ? cloneValue(response.rateLimit) : createNullObject(),
        fetchedAt: nowIsoString(),
        raw: requestOptions.includeRaw ? cloneValue(response.data) : undefined
      });

      logger.debug('GitHub issue fetched successfully.', {
        requestId: requestId,
        repository: envelope.repository.fullName,
        issueNumber: item.number,
        kind: item.kind
      });

      return envelope;
    } catch (error) {
      const normalizedCode = normalizeString(error && error.code);

      if (requestOptions.returnNullOnNotFound
        && normalizedCode === (ERROR_CODES.GITHUB_NOT_FOUND || 'GITHUB_NOT_FOUND')) {
        logger.info('GitHub issue not found; returning null.', {
          requestId: requestId,
          repository: cloneValue(requestOptions.repository),
          issueNumber: requestOptions.issueNumber
        });

        return deepFreeze({
          ok: true,
          repository: cloneValue(requestOptions.repository),
          item: null,
          githubRequestId: '',
          rateLimit: createNullObject(),
          fetchedAt: nowIsoString(),
          raw: requestOptions.includeRaw ? null : undefined
        });
      }

      const normalizedError = isIssueServiceError(error)
        ? error
        : createIssueServiceError(
          normalizedCode || (ERROR_CODES.UNKNOWN_ERROR || 'UNKNOWN_ERROR'),
          normalizeString(error && error.message) || 'Failed to fetch GitHub issue.',
          isPlainObject(error && error.details) ? error.details : createNullObject()
        );

      logger.warn('Failed to fetch GitHub issue.', {
        requestId: requestId,
        repository: cloneValue(requestOptions.repository),
        issueNumber: requestOptions.issueNumber,
        code: normalizedError.code,
        message: normalizedError.message,
        details: cloneValue(normalizedError.details)
      });

      throw normalizedError;
    }

  }

  async function getIssueOrNull(options) {
    const result = await getIssue(Object.assign(createNullObject(), stableObject(options), {
      returnNullOnNotFound: true
    }));

    return result.item;

  }

  async function getIssueByNumber(issueNumber, options) {
    return getIssue(Object.assign(createNullObject(), stableObject(options), {
      issueNumber: issueNumber
    }));
  }

  async function listOpenIssues(options) {
    return listIssues(Object.assign(createNullObject(), stableObject(options), {
      state: 'open'
    }));
  }

  function toProtocolIssue(issue, options) {
    const normalized = normalizeIssueInput(issue, options);

    return deepFreeze({
      number: normalized.number,
      title: normalized.title,
      body: normalized.body,
      url: normalized.htmlUrl || normalized.apiUrl,
      state: normalized.state,
      labels: normalized.labelNames.slice()
    });

  }

  function buildTaskContext(issue, options) {
    const normalizedIssue = normalizeIssueInput(issue, options);
    const source = isPlainObject(options) ? options : createNullObject();
    const repository = buildRepositoryDescriptor(
      normalizeRepositoryRef(
        stableObject(source.repository),
        stableObject(normalizedIssue.repository)
      )
    );

    return protocol.createTaskContext({
      repository: repository,
      issue: toProtocolIssue(normalizedIssue, source),
      targetFile: normalizeString(source.targetFile),
      workingBranchPrefix: normalizeString(source.workingBranchPrefix || repository.workingBranchPrefix),
      createdAt: normalizeString(source.createdAt) || nowIsoString()
    });

  }

  function findIssueInCollection(collection, issueNumber) {
    const source = Array.isArray(collection)
      ? collection
      : (isPlainObject(collection) && Array.isArray(collection.items) ? collection.items : []);
    const normalizedIssueNumber = normalizeIntegerOrNull(issueNumber);

    if (normalizedIssueNumber === null) {
      return null;
    }

    for (const issue of source) {
      const normalized = normalizeIssueInput(issue);

      if (normalized.number === normalizedIssueNumber) {
        return normalized;
      }
    }

    return null;

  }

  function buildIssueLookupMap(collection) {
    const source = Array.isArray(collection)
      ? collection
      : (isPlainObject(collection) && Array.isArray(collection.items) ? collection.items : []);
    const output = createNullObject();

    for (const issue of source) {
      const normalized = normalizeIssueInput(issue);

      if (normalized.number === null) {
        continue;
      }

      output[String(normalized.number)] = cloneValue(normalized);
    }

    return deepFreeze(output);

  }

  function sortIssues(items, options) {
    const source = Array.isArray(items) ? items.slice() : [];
    const config = isPlainObject(options) ? options : createNullObject();
    const sort = normalizeSort(config.sort || DEFAULT_SORT);
    const direction = normalizeDirection(config.direction || DEFAULT_DIRECTION);
    const multiplier = direction === 'asc' ? 1 : -1;

    function compareDates(leftValue, rightValue) {
      const leftTime = normalizeString(leftValue) ? Date.parse(leftValue) : 0;
      const rightTime = normalizeString(rightValue) ? Date.parse(rightValue) : 0;
      const safeLeft = Number.isFinite(leftTime) ? leftTime : 0;
      const safeRight = Number.isFinite(rightTime) ? rightTime : 0;

      if (safeLeft < safeRight) {
        return -1 * multiplier;
      }

      if (safeLeft > safeRight) {
        return 1 * multiplier;
      }

      return 0;
    }

    function compareNumbers(leftValue, rightValue) {
      const safeLeft = Number.isFinite(Number(leftValue)) ? Number(leftValue) : 0;
      const safeRight = Number.isFinite(Number(rightValue)) ? Number(rightValue) : 0;

      if (safeLeft < safeRight) {
        return -1 * multiplier;
      }

      if (safeLeft > safeRight) {
        return 1 * multiplier;
      }

      return 0;
    }

    source.sort(function sortComparator(left, right) {
      const leftIssue = normalizeIssueInput(left);
      const rightIssue = normalizeIssueInput(right);

      if (sort === 'created') {
        return compareDates(leftIssue.createdAt, rightIssue.createdAt)
          || compareNumbers(leftIssue.number, rightIssue.number);
      }

      if (sort === 'comments') {
        return compareNumbers(leftIssue.comments, rightIssue.comments)
          || compareDates(leftIssue.updatedAt, rightIssue.updatedAt)
          || compareNumbers(leftIssue.number, rightIssue.number);
      }

      return compareDates(leftIssue.updatedAt, rightIssue.updatedAt)
        || compareNumbers(leftIssue.number, rightIssue.number);
    });

    return source;

  }

  const api = {
    defaults: deepFreeze({
      state: DEFAULT_STATE,
      sort: DEFAULT_SORT,
      direction: DEFAULT_DIRECTION,
      perPage: DEFAULT_PER_PAGE,
      maxPerPage: MAX_PER_PAGE,
      previewLength: DEFAULT_PREVIEW_LENGTH,
      protocolVersion: DEFAULT_PROTOCOL_VERSION
    }),
    normalizeIssue: normalizeIssue,
    normalizeIssueInput: normalizeIssueInput,
    normalizeUser: normalizeUser,
    normalizeLabel: normalizeLabel,
    normalizeMilestone: normalizeMilestone,
    normalizePullRequestRef: normalizePullRequestRef,
    normalizeReactions: normalizeReactions,
    listIssues: listIssues,
    listOpenIssues: listOpenIssues,
    getIssue: getIssue,
    getIssueByNumber: getIssueByNumber,
    getIssueOrNull: getIssueOrNull,
    isPullRequestIssue: isPullRequestIssue,
    summarizeIssue: summarizeIssue,
    toProtocolIssue: toProtocolIssue,
    buildTaskContext: buildTaskContext,
    findIssueInCollection: findIssueInCollection,
    buildIssueLookupMap: buildIssueLookupMap,
    sortIssues: sortIssues,
    helpers: deepFreeze({
      normalizeRepositoryRef: normalizeRepositoryRef,
      assertRepositoryRef: assertRepositoryRef,
      buildRepositoryDescriptor: buildRepositoryDescriptor,
      inferRepositoryFromIssue: inferRepositoryFromIssue,
      parseRepositoryFromApiUrl: parseRepositoryFromApiUrl,
      parseRepositoryFromHtmlUrl: parseRepositoryFromHtmlUrl,
      parseLabelInput: parseLabelInput,
      parseIssueNumberList: parseIssueNumberList,
      normalizeIssueState: normalizeIssueState,
      normalizeListState: normalizeListState,
      normalizeSort: normalizeSort,
      normalizeDirection: normalizeDirection,
      normalizeLabelMode: normalizeLabelMode,
      buildBodyPreview: buildBodyPreview,
      normalizeIsoTimestamp: normalizeIsoTimestamp,
      createIssueServiceError: createIssueServiceError,
      isIssueServiceError: isIssueServiceError,
      normalizeListOptions: normalizeListOptions,
      normalizeQuerySnapshot: normalizeQuerySnapshot,
      filterIssues: filterIssues,
      dedupeIssues: dedupeIssues,
      parsePageNumberFromUrl: parsePageNumberFromUrl,
      parsePerPageFromUrl: parsePerPageFromUrl,
      buildPaginationInfo: buildPaginationInfo
    })
  };

  try {
    logger.debug('GitHub issue service module registered.', {
      defaultState: DEFAULT_STATE,
      defaultSort: DEFAULT_SORT,
      defaultDirection: DEFAULT_DIRECTION,
      defaultPerPage: DEFAULT_PER_PAGE
    });
  } catch (error) {
  }

  root.registerValue('github_issue_service', deepFreeze(api), {
    overwrite: false,
    freeze: false,
    clone: false
  });
}(typeof globalThis !== 'undefined'
  ? globalThis
  : (typeof self !== 'undefined'
    ? self
    : (typeof window !== 'undefined' ? window : this))));