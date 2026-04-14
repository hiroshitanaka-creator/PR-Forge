(function registerMAOEGitHubRepoService(globalScope) {
  'use strict';

  const root = globalScope.MAOE;

  if (!root || typeof root.registerValue !== 'function') {
    throw new Error('[MAOE] namespace.js must be loaded before github_repo_service.js.');
  }

  if (root.has('github_repo_service')) {
    return;
  }

  if (!root.has('constants')) {
    throw new Error('[MAOE] constants.js must be loaded before github_repo_service.js.');
  }

  if (!root.has('protocol')) {
    throw new Error('[MAOE] protocol.js must be loaded before github_repo_service.js.');
  }

  if (!root.has('github_api')) {
    throw new Error('[MAOE] github_api.js must be loaded before github_repo_service.js.');
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
        consoleObject[level]('[MAOE/github_repo_service] ' + message);
        return;
      }

      consoleObject[level]('[MAOE/github_repo_service] ' + message, context);
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
        return loggerModule.createScope('github_repo_service');
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
  const HOSTS = constants.HOSTS || Object.create(null);
  const githubApiHelpers = githubApi.helpers || Object.create(null);
  const protocolHelpers = protocol.helpers || Object.create(null);

  const DEFAULT_BASE_URL = normalizeString(GITHUB.API_BASE_URL || HOSTS.GITHUB_API_BASE_URL || 'https://api.github.com').replace(/\/$/, '');
  const DEFAULT_BASE_BRANCH = normalizeString(REPOSITORY.DEFAULT_BASE_BRANCH || 'main');
  const DEFAULT_MAX_ENTRIES = Number.isFinite(Number(REPOSITORY.MAX_REPO_TREE_ENTRIES))
    ? Math.max(1, Math.trunc(Number(REPOSITORY.MAX_REPO_TREE_ENTRIES)))
    : 5000;
  const DEFAULT_MAX_DEPTH = Number.isFinite(Number(REPOSITORY.MAX_TREE_DEPTH))
    ? Math.max(1, Math.trunc(Number(REPOSITORY.MAX_TREE_DEPTH)))
    : 32;
  const DEFAULT_PROTOCOL_VERSION = normalizeString(APP.protocolVersion) || '1.0.0';
  const DEFAULT_TEXT_EMPTY_LABEL = '(empty)';
  const TREE_ENTRY_TYPES = ['tree', 'blob', 'commit', 'unknown'];
  const TREE_SORT_VALUES = ['path', 'path_desc', 'type_path'];

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

  function nowIsoString() {
    return new Date().toISOString();
  }

  function createRequestId(prefix) {
    if (protocolHelpers && typeof protocolHelpers.generateRequestId === 'function') {
      try {
        return protocolHelpers.generateRequestId(prefix || 'repo');
      } catch (error) {
      }
    }

    const normalizedPrefix = normalizeLowerString(prefix) || 'repo';
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

  function compareStrings(leftValue, rightValue) {
    const left = coerceText(leftValue);
    const right = coerceText(rightValue);

    if (left === right) {
      return 0;
    }

    return left < right ? -1 : 1;
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

  function createRepoServiceError(code, message, details) {
    const error = new Error(normalizeString(message) || 'GitHub repository service error.');
    error.name = 'MAOEGitHubRepoServiceError';
    error.code = normalizeString(code) || (ERROR_CODES.UNKNOWN_ERROR || 'UNKNOWN_ERROR');
    error.details = isPlainObject(details) ? cloneValue(details) : createNullObject();
    error.isGitHubRepoServiceError = true;
    return error;
  }

  function isRepoServiceError(error) {
    return !!(error && typeof error === 'object' && error.isGitHubRepoServiceError === true);
  }

  function normalizeRepoServiceError(error, fallbackMessage, extraDetails) {
    if (isRepoServiceError(error)) {
      return error;
    }

    return createRepoServiceError(
      normalizeString(error && error.code) || (ERROR_CODES.UNKNOWN_ERROR || 'UNKNOWN_ERROR'),
      normalizeString(error && error.message) || normalizeString(fallbackMessage) || 'GitHub repository service error.',
      mergePlainObjects(
        stableObject(error && error.details),
        stableObject(extraDetails)
      )
    );
  }

  function encodePathSegments(path) {
    const source = normalizeString(path);

    if (!source) {
      return '';
    }

    return source.split('/').map(function mapSegment(segment) {
      return encodeURIComponent(segment);
    }).join('/');
  }

  function buildRepositoryUrls(repository) {
    const owner = normalizeString(repository && repository.owner);
    const repo = normalizeString(repository && repository.repo);

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
      output.baseBranch = output.defaultBranch || DEFAULT_BASE_BRANCH;
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
      throw createRepoServiceError(
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
      baseBranch: normalizeString(normalized.baseBranch) || normalizeString(normalized.defaultBranch) || DEFAULT_BASE_BRANCH,
      defaultBranch: normalizeString(normalized.defaultBranch),
      workingBranchPrefix: normalizeString(normalized.workingBranchPrefix),
      description: '',
      visibility: '',
      private: false,
      archived: false,
      disabled: false,
      fork: false,
      language: '',
      createdAt: '',
      updatedAt: '',
      pushedAt: '',
      openIssuesCount: null,
      id: null,
      nodeId: ''
    });
  }

  function normalizeRepositoryPayload(rawRepository, fallbackRepository) {
    const fallback = buildRepositoryDescriptor(fallbackRepository);
    const source = isPlainObject(rawRepository) ? rawRepository : createNullObject();
    const owner = normalizeString(source.owner && source.owner.login) || fallback.owner;
    const repo = normalizeString(source.name) || normalizeString(source.repo) || fallback.repo;
    const descriptor = buildRepositoryDescriptor({
      owner: owner,
      repo: repo,
      baseBranch: normalizeString(fallback.baseBranch) || normalizeString(source.default_branch) || DEFAULT_BASE_BRANCH,
      defaultBranch: normalizeString(source.default_branch) || normalizeString(fallback.defaultBranch),
      workingBranchPrefix: normalizeString(fallback.workingBranchPrefix)
    });

    return deepFreeze({
      owner: descriptor.owner,
      repo: descriptor.repo,
      fullName: normalizeString(source.full_name) || descriptor.fullName,
      htmlUrl: normalizeString(source.html_url) || descriptor.htmlUrl,
      apiUrl: normalizeString(source.url) || descriptor.apiUrl,
      issuesHtmlUrl: normalizeString(source.html_url) ? normalizeString(source.html_url) + '/issues' : descriptor.issuesHtmlUrl,
      issuesApiUrl: normalizeString(source.url) ? normalizeString(source.url) + '/issues' : descriptor.issuesApiUrl,
      baseBranch: normalizeString(fallback.baseBranch) || normalizeString(source.default_branch) || descriptor.baseBranch,
      defaultBranch: normalizeString(source.default_branch) || descriptor.defaultBranch || descriptor.baseBranch,
      workingBranchPrefix: descriptor.workingBranchPrefix,
      description: coerceText(source.description),
      visibility: normalizeString(source.visibility),
      private: normalizeBoolean(source.private, false),
      archived: normalizeBoolean(source.archived, false),
      disabled: normalizeBoolean(source.disabled, false),
      fork: normalizeBoolean(source.fork, false),
      language: normalizeString(source.language),
      createdAt: normalizeIsoTimestamp(source.created_at),
      updatedAt: normalizeIsoTimestamp(source.updated_at),
      pushedAt: normalizeIsoTimestamp(source.pushed_at),
      openIssuesCount: normalizeIntegerOrNull(source.open_issues_count),
      id: normalizeIntegerOrNull(source.id),
      nodeId: normalizeString(source.node_id)
    });
  }

  function buildBranchHtmlUrl(repository, branchName) {
    const repo = normalizeRepositoryPayload(null, repository);
    const normalizedBranchName = normalizeString(branchName);

    if (!repo.htmlUrl || !normalizedBranchName) {
      return '';
    }

    return repo.htmlUrl + '/tree/' + encodeURIComponent(normalizedBranchName);
  }

  function extractBranchCommitObject(rawBranch) {
    return isPlainObject(rawBranch && rawBranch.commit)
      ? rawBranch.commit
      : createNullObject();
  }

  function extractCommitSha(rawBranch) {
    const commitObject = extractBranchCommitObject(rawBranch);

    if (normalizeString(commitObject.sha)) {
      return normalizeString(commitObject.sha);
    }

    if (isPlainObject(commitObject.commit) && normalizeString(commitObject.commit.sha)) {
      return normalizeString(commitObject.commit.sha);
    }

    return '';
  }

  function extractTreeSha(rawBranch) {
    const source = isPlainObject(rawBranch) ? rawBranch : createNullObject();
    const commitObject = extractBranchCommitObject(source);

    if (isPlainObject(source.tree) && normalizeString(source.tree.sha)) {
      return normalizeString(source.tree.sha);
    }

    if (isPlainObject(commitObject.tree) && normalizeString(commitObject.tree.sha)) {
      return normalizeString(commitObject.tree.sha);
    }

    if (isPlainObject(commitObject.commit)
      && isPlainObject(commitObject.commit.tree)
      && normalizeString(commitObject.commit.tree.sha)) {
      return normalizeString(commitObject.commit.tree.sha);
    }

    return '';
  }

  function normalizeBranchPayload(rawBranch, repository, options) {
    const source = isPlainObject(rawBranch) ? rawBranch : createNullObject();
    const config = isPlainObject(options) ? options : createNullObject();
    const repo = normalizeRepositoryPayload(null, repository);
    const commitObject = extractBranchCommitObject(source);
    const name = normalizeString(source.name)
      || normalizeString(config.fallbackName)
      || normalizeString(repo.baseBranch)
      || normalizeString(repo.defaultBranch)
      || DEFAULT_BASE_BRANCH;
    const commitSha = extractCommitSha(source);
    const treeSha = normalizeString(config.treeSha)
      || extractTreeSha(source)
      || (normalizeBoolean(config.commitShaFallback, false) ? commitSha : '');

    return deepFreeze({
      name: name,
      isDefault: name === normalizeString(repo.defaultBranch) || name === normalizeString(repo.baseBranch),
      protected: normalizeBoolean(source.protected, false),
      protectionUrl: normalizeString(source.protection_url),
      apiUrl: normalizeString(source._links && source._links.self),
      htmlUrl: normalizeString(source._links && source._links.html) || buildBranchHtmlUrl(repo, name),
      commitSha: commitSha,
      treeSha: treeSha,
      commitUrl: normalizeString(commitObject.url),
      nodeId: normalizeString(source.node_id),
      repository: cloneValue(repo)
    });
  }

  function containsControlCharacters(text) {
    return /[\u0000-\u001F\u007F]/.test(coerceText(text));
  }

  function normalizeTreePath(path, options) {
    const config = isPlainObject(options) ? options : createNullObject();
    const allowEmpty = normalizeBoolean(config.allowEmpty, false);
    let source = coerceText(path).trim().replace(/\\/g, '/');

    while (source.indexOf('./') === 0) {
      source = source.slice(2);
    }

    source = source.replace(/^\/+/, '').replace(/\/+/g, '/').replace(/\/+$/, '');

    if (!source) {
      if (allowEmpty) {
        return '';
      }

      throw createRepoServiceError(
        ERROR_CODES.INVALID_ARGUMENT || 'INVALID_ARGUMENT',
        'Repository tree path is empty.',
        {
          value: path
        }
      );
    }

    if (containsControlCharacters(source)) {
      throw createRepoServiceError(
        ERROR_CODES.INVALID_ARGUMENT || 'INVALID_ARGUMENT',
        'Repository tree path contains control characters.',
        {
          value: path,
          normalizedPath: source
        }
      );
    }

    const segments = source.split('/');

    for (const segment of segments) {
      if (!segment || segment === '.' || segment === '..') {
        throw createRepoServiceError(
          ERROR_CODES.INVALID_ARGUMENT || 'INVALID_ARGUMENT',
          'Repository tree path contains an invalid segment.',
          {
            value: path,
            normalizedPath: source,
            segment: segment
          }
        );
      }
    }

    return segments.join('/');
  }

  function tryNormalizeTreePath(path, options) {
    try {
      return normalizeTreePath(path, options);
    } catch (error) {
      return '';
    }
  }

  function splitPathSegments(path) {
    const normalized = normalizeTreePath(path, {
      allowEmpty: true
    });

    if (!normalized) {
      return [];
    }

    return normalized.split('/');
  }

  function getPathDepth(path) {
    return splitPathSegments(path).length;
  }

  function getPathName(path) {
    const segments = splitPathSegments(path);

    return segments.length > 0 ? segments[segments.length - 1] : '';
  }

  function getParentPath(path) {
    const segments = splitPathSegments(path);

    if (segments.length <= 1) {
      return '';
    }

    return segments.slice(0, segments.length - 1).join('/');
  }

  function getFileExtension(path) {
    const name = getPathName(path);
    const index = name.lastIndexOf('.');

    if (index <= 0 || index >= name.length - 1) {
      return '';
    }

    return name.slice(index + 1).toLowerCase();
  }

  function normalizeEntryType(type, mode) {
    const normalizedType = normalizeLowerString(type);
    const normalizedMode = normalizeString(mode);

    if (normalizedMode === '160000') {
      return 'commit';
    }

    if (TREE_ENTRY_TYPES.indexOf(normalizedType) >= 0) {
      return normalizedType;
    }

    if (normalizedMode === '040000') {
      return 'tree';
    }

    if (normalizedMode === '100644'
      || normalizedMode === '100755'
      || normalizedMode === '120000') {
      return 'blob';
    }

    return 'unknown';
  }

  function buildEntryHtmlUrl(repository, branchName, entryType, path) {
    const repo = normalizeRepositoryPayload(null, repository);
    const normalizedBranchName = normalizeString(branchName);
    const normalizedPath = tryNormalizeTreePath(path, {
      allowEmpty: true
    });

    if (!repo.htmlUrl || !normalizedBranchName || !normalizedPath) {
      return '';
    }

    const refSegment = encodeURIComponent(normalizedBranchName);
    const pathSegment = encodePathSegments(normalizedPath);

    if (entryType === 'tree') {
      return repo.htmlUrl + '/tree/' + refSegment + '/' + pathSegment;
    }

    if (entryType === 'blob') {
      return repo.htmlUrl + '/blob/' + refSegment + '/' + pathSegment;
    }

    if (entryType === 'commit') {
      return repo.htmlUrl + '/tree/' + refSegment + '/' + pathSegment;
    }

    return repo.htmlUrl + '/tree/' + refSegment + '/' + pathSegment;
  }

  function normalizeTreeEntry(rawEntry, options) {
    const source = isPlainObject(rawEntry)
      ? rawEntry
      : (typeof rawEntry === 'string' ? { path: rawEntry, type: 'blob' } : createNullObject());
    const config = isPlainObject(options) ? options : createNullObject();
    const repository = normalizeRepositoryPayload(null, config.repository);
    const branchName = normalizeString(config.branchName || config.branch);
    const path = normalizeTreePath(source.path || source.name);
    const type = normalizeEntryType(
      source.type
      || (normalizeBoolean(source.isDirectory, false)
        ? 'tree'
        : (normalizeBoolean(source.isSubmodule, false) ? 'commit' : 'blob')),
      source.mode
    );
    const mode = normalizeString(source.mode);
    const size = normalizeIntegerOrNull(source.size);
    const name = getPathName(path);
    const parentPath = getParentPath(path);
    const depth = getPathDepth(path);
    const isDirectory = type === 'tree';
    const isFile = type === 'blob';
    const isSubmodule = type === 'commit';
    const implicit = normalizeBoolean(source.implicit, false);
    const htmlUrl = normalizeString(source.htmlUrl || source.html_url) || buildEntryHtmlUrl(repository, branchName, type, path);
    const apiUrl = normalizeString(source.url);

    return deepFreeze({
      path: path,
      displayPath: isDirectory ? path + '/' : path,
      name: name,
      parentPath: parentPath,
      depth: depth,
      type: type,
      mode: mode,
      sha: normalizeString(source.sha),
      size: size,
      apiUrl: apiUrl,
      htmlUrl: htmlUrl,
      isDirectory: isDirectory,
      isFile: isFile,
      isSubmodule: isSubmodule,
      isExecutable: mode === '100755',
      isSymlink: mode === '120000',
      implicit: implicit,
      basename: name,
      dirname: parentPath,
      extension: isFile ? getFileExtension(path) : '',
      repositoryFullName: repository.fullName,
      branchName: branchName
    });
  }

  function createImplicitDirectoryEntry(path, options) {
    return normalizeTreeEntry({
      path: path,
      type: 'tree',
      mode: '040000',
      implicit: true
    }, options);
  }

  function entryScore(entry) {
    const source = normalizeTreeEntry(entry, {
      repository: stableObject(entry && entry.repository),
      branchName: normalizeString(entry && entry.branchName)
    });
    let score = 0;

    if (source.implicit !== true) {
      score += 100;
    }

    if (source.sha) {
      score += 20;
    }

    if (source.type === 'tree') {
      score += 5;
    }

    if (source.size !== null) {
      score += 2;
    }

    if (source.htmlUrl) {
      score += 1;
    }

    return score;
  }

  function dedupeTreeEntries(entries) {
    const source = Array.isArray(entries) ? entries : [];
    const outputMap = createNullObject();

    for (const entry of source) {
      const normalized = normalizeTreeEntry(entry, {
        repository: stableObject(entry && entry.repository),
        branchName: normalizeString(entry && entry.branchName)
      });
      const key = normalized.path;

      if (!hasOwn(outputMap, key) || entryScore(normalized) > entryScore(outputMap[key])) {
        outputMap[key] = normalized;
      }
    }

    return Object.keys(outputMap).map(function mapKey(key) {
      return outputMap[key];
    });
  }

  function buildImplicitDirectories(entries, options) {
    const source = Array.isArray(entries) ? entries : [];
    const config = isPlainObject(options) ? options : createNullObject();
    const existing = new Set();
    const output = [];

    for (const entry of source) {
      const normalized = normalizeTreeEntry(entry, config);
      existing.add(normalized.path);
    }

    for (const entry of source) {
      const normalized = normalizeTreeEntry(entry, config);
      let cursor = normalized.parentPath;

      while (cursor) {
        if (!existing.has(cursor)) {
          existing.add(cursor);
          output.push(createImplicitDirectoryEntry(cursor, config));
        }

        cursor = getParentPath(cursor);
      }
    }

    return output;
  }

  function normalizeTreeSort(value) {
    return oneOf(normalizeLowerString(value), TREE_SORT_VALUES, 'path');
  }

  function entryTypeSortWeight(entry) {
    const source = isPlainObject(entry) ? entry : createNullObject();

    if (source.type === 'tree') {
      return 0;
    }

    if (source.type === 'blob') {
      return 1;
    }

    if (source.type === 'commit') {
      return 2;
    }

    return 3;
  }

  function compareTreeEntries(leftEntry, rightEntry, sort) {
    const left = isPlainObject(leftEntry) ? leftEntry : createNullObject();
    const right = isPlainObject(rightEntry) ? rightEntry : createNullObject();
    const normalizedSort = normalizeTreeSort(sort);

    if (normalizedSort === 'type_path') {
      const typeDelta = entryTypeSortWeight(left) - entryTypeSortWeight(right);

      if (typeDelta !== 0) {
        return typeDelta;
      }

      return compareStrings(left.path, right.path);
    }

    if (normalizedSort === 'path_desc') {
      const pathDeltaDesc = compareStrings(right.path, left.path);

      if (pathDeltaDesc !== 0) {
        return pathDeltaDesc;
      }

      return entryTypeSortWeight(left) - entryTypeSortWeight(right);
    }

    const pathDelta = compareStrings(left.path, right.path);

    if (pathDelta !== 0) {
      return pathDelta;
    }

    return entryTypeSortWeight(left) - entryTypeSortWeight(right);
  }

  function sortTreeEntries(entries, options) {
    const source = Array.isArray(entries) ? entries.slice() : [];
    const normalizedSort = normalizeTreeSort(options && options.sort);

    source.sort(function sortComparator(left, right) {
      return compareTreeEntries(left, right, normalizedSort);
    });

    return source;
  }

  function pathMatchesPrefix(path, prefix) {
    const normalizedPath = normalizeTreePath(path);
    const normalizedPrefix = normalizeTreePath(prefix, {
      allowEmpty: true
    });

    if (!normalizedPrefix) {
      return true;
    }

    return normalizedPath === normalizedPrefix
      || normalizedPath.indexOf(normalizedPrefix + '/') === 0;
  }

  function getRelativeDepth(path, prefix) {
    const normalizedPath = normalizeTreePath(path);
    const normalizedPrefix = normalizeTreePath(prefix, {
      allowEmpty: true
    });
    const pathDepth = getPathDepth(normalizedPath);

    if (!normalizedPrefix) {
      return pathDepth;
    }

    if (normalizedPath === normalizedPrefix) {
      return 0;
    }

    if (normalizedPath.indexOf(normalizedPrefix + '/') !== 0) {
      return pathDepth;
    }

    const prefixDepth = getPathDepth(normalizedPrefix);
    return Math.max(0, pathDepth - prefixDepth);
  }

  function flattenTreeEntriesDetailed(rawEntries, options) {
    const source = Array.isArray(rawEntries) ? rawEntries : [];
    const config = isPlainObject(options) ? options : createNullObject();
    const explicitEntries = [];
    const invalidEntries = [];

    for (let index = 0; index < source.length; index += 1) {
      try {
        explicitEntries.push(normalizeTreeEntry(source[index], config));
      } catch (error) {
        invalidEntries.push(deepFreeze({
          index: index,
          code: normalizeString(error && error.code) || (ERROR_CODES.INVALID_ARGUMENT || 'INVALID_ARGUMENT'),
          message: normalizeString(error && error.message) || 'Failed to normalize tree entry.'
        }));
      }
    }

    const implicitEntries = normalizeBoolean(config.includeImplicitDirectories, true)
      ? buildImplicitDirectories(explicitEntries, config)
      : [];
    const mergedEntries = explicitEntries.concat(implicitEntries);
    const dedupedEntries = dedupeTreeEntries(mergedEntries);
    const sortedEntries = sortTreeEntries(dedupedEntries, {
      sort: config.sort
    });

    return deepFreeze({
      items: sortedEntries,
      invalidEntries: invalidEntries,
      counts: {
        rawCount: source.length,
        explicitCount: explicitEntries.length,
        implicitCount: implicitEntries.length,
        dedupedCount: dedupedEntries.length,
        invalidCount: invalidEntries.length
      }
    });
  }

  function flattenTreeEntries(rawEntries, options) {
    return flattenTreeEntriesDetailed(rawEntries, options).items;
  }

  function filterTreeEntriesDetailed(entries, options) {
    const source = Array.isArray(entries) ? entries : [];
    const config = isPlainObject(options) ? options : createNullObject();
    const pathPrefix = normalizeTreePath(config.pathPrefix || config.prefix, {
      allowEmpty: true
    });
    const includeDirectories = normalizeBoolean(config.includeDirectories, true);
    const includeFiles = normalizeBoolean(config.includeFiles, true);
    const includeSubmodules = normalizeBoolean(config.includeSubmodules, true);
    const maxDepth = normalizeOptionalPositiveInteger(config.maxDepth, DEFAULT_MAX_DEPTH);
    const items = [];
    const stats = {
      totalReceived: source.length,
      directoriesReceived: 0,
      filesReceived: 0,
      submodulesReceived: 0,
      unknownReceived: 0,
      returned: 0,
      directoriesReturned: 0,
      filesReturned: 0,
      submodulesReturned: 0,
      unknownReturned: 0,
      implicitDirectoriesReturned: 0,
      filteredOutByType: 0,
      filteredOutByPrefix: 0,
      filteredOutByDepth: 0,
      maxDepthObserved: 0,
      maxRelativeDepthObserved: 0
    };

    for (const entry of source) {
      const normalized = normalizeTreeEntry(entry, {
        repository: stableObject(entry && entry.repository),
        branchName: normalizeString(entry && entry.branchName)
      });

      if (normalized.isDirectory) {
        stats.directoriesReceived += 1;
      } else if (normalized.isFile) {
        stats.filesReceived += 1;
      } else if (normalized.isSubmodule) {
        stats.submodulesReceived += 1;
      } else {
        stats.unknownReceived += 1;
      }

      stats.maxDepthObserved = Math.max(stats.maxDepthObserved, normalized.depth);

      const relativeDepth = getRelativeDepth(normalized.path, pathPrefix);
      stats.maxRelativeDepthObserved = Math.max(stats.maxRelativeDepthObserved, relativeDepth);

      let includeEntry = false;

      if (normalized.isDirectory) {
        includeEntry = includeDirectories;
      } else if (normalized.isFile) {
        includeEntry = includeFiles;
      } else if (normalized.isSubmodule) {
        includeEntry = includeSubmodules;
      } else {
        includeEntry = false;
      }

      if (!includeEntry) {
        stats.filteredOutByType += 1;
        continue;
      }

      if (!pathMatchesPrefix(normalized.path, pathPrefix)) {
        stats.filteredOutByPrefix += 1;
        continue;
      }

      if (maxDepth !== null && relativeDepth > maxDepth) {
        stats.filteredOutByDepth += 1;
        continue;
      }

      items.push(normalized);

      if (normalized.isDirectory) {
        stats.directoriesReturned += 1;
        if (normalized.implicit) {
          stats.implicitDirectoriesReturned += 1;
        }
      } else if (normalized.isFile) {
        stats.filesReturned += 1;
      } else if (normalized.isSubmodule) {
        stats.submodulesReturned += 1;
      } else {
        stats.unknownReturned += 1;
      }

      stats.returned += 1;
    }

    return deepFreeze({
      items: items,
      stats: stats
    });
  }

  function filterTreeEntries(entries, options) {
    return filterTreeEntriesDetailed(entries, options).items;
  }

  function buildTreeCounts(rawTreeEntries, flattenDetails, filterDetails, finalEntries, githubTruncated, serviceTruncated) {
    const rawCount = Array.isArray(rawTreeEntries) ? rawTreeEntries.length : 0;
    const flatten = isPlainObject(flattenDetails) ? flattenDetails : createNullObject();
    const flattenCounts = isPlainObject(flatten.counts) ? flatten.counts : createNullObject();
    const filter = isPlainObject(filterDetails) ? filterDetails : createNullObject();
    const filterStats = isPlainObject(filter.stats) ? filter.stats : createNullObject();
    const items = Array.isArray(finalEntries) ? finalEntries : [];
    const counts = {
      rawCount: rawCount,
      explicitCount: normalizePositiveInteger(flattenCounts.explicitCount, 1) - 1,
      implicitCount: normalizePositiveInteger(flattenCounts.implicitCount, 1) - 1,
      dedupedCount: normalizePositiveInteger(flattenCounts.dedupedCount, 1) - 1,
      invalidCount: normalizePositiveInteger(flattenCounts.invalidCount, 1) - 1,
      filteredCount: normalizePositiveInteger(filterStats.returned, 1) - 1,
      returnedCount: items.length,
      directoriesReturned: 0,
      filesReturned: 0,
      submodulesReturned: 0,
      unknownReturned: 0,
      implicitDirectoriesReturned: 0,
      filteredOutByType: normalizePositiveInteger(filterStats.filteredOutByType, 1) - 1,
      filteredOutByPrefix: normalizePositiveInteger(filterStats.filteredOutByPrefix, 1) - 1,
      filteredOutByDepth: normalizePositiveInteger(filterStats.filteredOutByDepth, 1) - 1,
      maxDepthObserved: normalizePositiveInteger(filterStats.maxDepthObserved, 1) - 1,
      maxRelativeDepthObserved: normalizePositiveInteger(filterStats.maxRelativeDepthObserved, 1) - 1,
      githubTruncated: githubTruncated === true,
      serviceTruncated: serviceTruncated === true,
      partial: githubTruncated === true || serviceTruncated === true
    };

    for (const entry of items) {
      const normalized = normalizeTreeEntry(entry, {
        repository: stableObject(entry && entry.repository),
        branchName: normalizeString(entry && entry.branchName)
      });

      if (normalized.isDirectory) {
        counts.directoriesReturned += 1;
        if (normalized.implicit) {
          counts.implicitDirectoriesReturned += 1;
        }
      } else if (normalized.isFile) {
        counts.filesReturned += 1;
      } else if (normalized.isSubmodule) {
        counts.submodulesReturned += 1;
      } else {
        counts.unknownReturned += 1;
      }
    }

    return deepFreeze(counts);
  }

  function normalizeTextOptions(options) {
    const source = isPlainObject(options) ? options : createNullObject();

    return deepFreeze({
      includeHeader: normalizeBoolean(source.includeHeader, true),
      includeTypes: normalizeBoolean(source.includeTypes, true),
      includeSizes: normalizeBoolean(source.includeSizes, false),
      includeSha: normalizeBoolean(source.includeSha, false),
      includeImplicitFlag: normalizeBoolean(source.includeImplicitFlag, true),
      emptyLabel: normalizeString(source.emptyLabel) || DEFAULT_TEXT_EMPTY_LABEL,
      sort: normalizeTreeSort(source.sort),
      pathPrefix: normalizeTreePath(source.pathPrefix || source.prefix, {
        allowEmpty: true
      })
    });
  }

  function coerceNormalizedTreeEntries(source, options) {
    let rawEntries = [];

    if (Array.isArray(source)) {
      rawEntries = source.slice();
    } else if (isPlainObject(source) && Array.isArray(source.entries)) {
      rawEntries = source.entries.slice();
    } else if (isPlainObject(source) && Array.isArray(source.items)) {
      rawEntries = source.items.slice();
    }

    const config = isPlainObject(options) ? options : createNullObject();
    const output = [];

    for (const entry of rawEntries) {
      try {
        if (isPlainObject(entry)
          && normalizeString(entry.path)
          && normalizeString(entry.displayPath)
          && typeof entry.isDirectory === 'boolean'
          && typeof entry.isFile === 'boolean'
          && typeof entry.isSubmodule === 'boolean') {
          output.push(entry);
        } else {
          output.push(normalizeTreeEntry(entry, config));
        }
      } catch (error) {
      }
    }

    return output;
  }

  function normalizeTreeSource(source, options) {
    const config = isPlainObject(options) ? options : createNullObject();
    const sourceObject = isPlainObject(source) ? source : createNullObject();
    const repository = normalizeRepositoryPayload(
      isPlainObject(sourceObject.repository) ? sourceObject.repository : null,
      stableObject(config.repository)
    );
    const branchName = normalizeString(
      sourceObject.branchName
      || (isPlainObject(sourceObject.branch) ? sourceObject.branch.name : '')
      || config.branchName
      || config.branch
    );
    const treeSha = normalizeString(
      sourceObject.treeSha
      || (isPlainObject(sourceObject.branch) ? sourceObject.branch.treeSha : '')
      || config.treeSha
      || config.sha
    );
    const recursive = normalizeBoolean(
      hasOwn(sourceObject, 'recursive') ? sourceObject.recursive : config.recursive,
      true
    );
    const truncatedSource = isPlainObject(sourceObject.truncated)
      ? normalizeBoolean(sourceObject.truncated.partial, false)
      : normalizeBoolean(sourceObject.truncated || sourceObject.partial, false);
    const truncated = normalizeBoolean(truncatedSource, false);
    const pathPrefix = normalizeTreePath(
      config.pathPrefix || config.prefix || sourceObject.pathPrefix || sourceObject.prefix,
      { allowEmpty: true }
    );
    const entries = sortTreeEntries(
      coerceNormalizedTreeEntries(source, {
        repository: repository,
        branchName: branchName
      }),
      {
        sort: normalizeTreeSort(config.sort)
      }
    );

    return deepFreeze({
      repository: repository,
      branchName: branchName,
      treeSha: treeSha,
      recursive: recursive,
      truncated: truncated,
      pathPrefix: pathPrefix,
      entries: entries
    });
  }

  function renderTreeEntryLine(entry, options) {
    const source = normalizeTreeEntry(entry, {
      repository: stableObject(entry && entry.repository),
      branchName: normalizeString(entry && entry.branchName)
    });
    const config = normalizeTextOptions(options);
    const details = [];
    let mark = '[?]';

    if (source.isDirectory) {
      mark = '[D]';
    } else if (source.isFile) {
      mark = '[F]';
    } else if (source.isSubmodule) {
      mark = '[S]';
    }

    if (config.includeImplicitFlag && source.implicit) {
      details.push('implicit');
    }

    if (config.includeSizes && source.size !== null && source.isFile) {
      details.push('size=' + String(source.size));
    }

    if (config.includeSha && source.sha) {
      details.push('sha=' + source.sha.slice(0, 12));
    }

    const prefix = config.includeTypes ? mark + ' ' : '';
    const suffix = details.length > 0 ? ' {' + details.join(', ') + '}' : '';

    return prefix + source.displayPath + suffix;
  }

  function buildTreeText(source, options) {
    const config = normalizeTextOptions(options);
    const normalizedSource = normalizeTreeSource(source, options);
    const entries = sortTreeEntries(normalizedSource.entries, {
      sort: config.sort
    });
    const lines = [];

    if (config.includeHeader) {
      lines.push('repo: ' + (normalizedSource.repository.fullName || '(repository unspecified)'));

      if (normalizedSource.branchName) {
        lines.push('branch: ' + normalizedSource.branchName);
      }

      if (normalizedSource.treeSha) {
        lines.push('tree_sha: ' + normalizedSource.treeSha);
      }

      lines.push('recursive: ' + (normalizedSource.recursive ? 'true' : 'false'));
      lines.push('truncated: ' + (normalizedSource.truncated ? 'true' : 'false'));

      if (normalizedSource.pathPrefix) {
        lines.push('path_prefix: ' + normalizedSource.pathPrefix);
      }

      lines.push('entries:');
    }

    if (entries.length === 0) {
      lines.push(config.emptyLabel);
      return lines.join('\n');
    }

    for (const entry of entries) {
      lines.push(renderTreeEntryLine(entry, config));
    }

    return lines.join('\n');
  }

  function buildPathList(source, options) {
    const config = isPlainObject(options) ? options : createNullObject();
    const entries = coerceNormalizedTreeEntries(source, config);
    const includeDirectories = normalizeBoolean(config.includeDirectories, true);
    const includeFiles = normalizeBoolean(config.includeFiles, true);
    const includeSubmodules = normalizeBoolean(config.includeSubmodules, true);
    const paths = [];

    for (const entry of entries) {
      if (entry.isDirectory && !includeDirectories) {
        continue;
      }

      if (entry.isFile && !includeFiles) {
        continue;
      }

      if (entry.isSubmodule && !includeSubmodules) {
        continue;
      }

      paths.push(entry.displayPath);
    }

    return uniqueStrings(paths);
  }

  function buildPathLookup(source, options) {
    const entries = coerceNormalizedTreeEntries(source, options);
    const output = createNullObject();

    for (const entry of entries) {
      output[entry.path] = cloneValue(entry);
    }

    return deepFreeze(output);
  }

  function findTreeEntryByPath(source, path, options) {
    const normalizedPath = normalizeTreePath(path, {
      allowEmpty: false
    });
    const lookup = buildPathLookup(source, options);

    return hasOwn(lookup, normalizedPath) ? lookup[normalizedPath] : null;
  }

  function summarizeTree(source, options) {
    const normalizedSource = normalizeTreeSource(source, options);
    const counts = {
      entryCount: normalizedSource.entries.length,
      directoryCount: 0,
      fileCount: 0,
      submoduleCount: 0,
      implicitDirectoryCount: 0,
      maxDepth: 0,
      maxRelativeDepth: 0
    };

    for (const entry of normalizedSource.entries) {
      counts.maxDepth = Math.max(counts.maxDepth, entry.depth);
      counts.maxRelativeDepth = Math.max(counts.maxRelativeDepth, getRelativeDepth(entry.path, normalizedSource.pathPrefix));

      if (entry.isDirectory) {
        counts.directoryCount += 1;
        if (entry.implicit) {
          counts.implicitDirectoryCount += 1;
        }
      } else if (entry.isFile) {
        counts.fileCount += 1;
      } else if (entry.isSubmodule) {
        counts.submoduleCount += 1;
      }
    }

    return deepFreeze({
      repositoryFullName: normalizedSource.repository.fullName,
      branchName: normalizedSource.branchName,
      treeSha: normalizedSource.treeSha,
      recursive: normalizedSource.recursive,
      truncated: normalizedSource.truncated,
      pathPrefix: normalizedSource.pathPrefix,
      counts: counts
    });
  }

  function buildTreeSnapshot(source, options) {
    const config = isPlainObject(options) ? options : createNullObject();
    const normalizedSource = normalizeTreeSource(source, config);
    const text = normalizeString(config.text)
      ? coerceText(config.text)
      : buildTreeText(normalizedSource, config.textOptions);
    const paths = buildPathList(normalizedSource.entries, {
      includeDirectories: true,
      includeFiles: true,
      includeSubmodules: true
    });
    const payload = {
      owner: normalizedSource.repository.owner,
      repo: normalizedSource.repository.repo,
      baseBranch: normalizedSource.branchName || normalizedSource.repository.baseBranch || normalizedSource.repository.defaultBranch || DEFAULT_BASE_BRANCH,
      treeSha: normalizedSource.treeSha,
      generatedAt: normalizeString(config.generatedAt) || nowIsoString(),
      paths: paths,
      rawTreeText: text
    };

    if (protocol && typeof protocol.createRepositoryTreeSnapshot === 'function') {
      try {
        return protocol.createRepositoryTreeSnapshot(payload);
      } catch (error) {
      }
    }

    return deepFreeze(cloneValue(payload));
  }

  function normalizeMetadataOptions(context, options) {
    const source = isPlainObject(options) ? cloneValue(options) : createNullObject();
    const repository = buildRepositoryDescriptor(
      assertRepositoryRef(
        mergePlainObjects(
          stableObject(source.repository),
          stableObject(context.repository)
        ),
        {
          source: 'getRepositoryMetadata'
        }
      )
    );

    return deepFreeze({
      repository: repository,
      includeRaw: normalizeBoolean(source.includeRaw, false)
    });
  }

  async function getRepositoryMetadata(options) {
    const client = await githubApi.createClient(options);
    const requestOptions = normalizeMetadataOptions(client.context, options);
    const requestId = createRequestId('repo_meta');

    logger.debug('Fetching GitHub repository metadata.', {
      requestId: requestId,
      repository: cloneValue(requestOptions.repository)
    });

    try {
      const response = await client.getRepository({
        repository: requestOptions.repository
      });
      const repository = normalizeRepositoryPayload(response.data, requestOptions.repository);
      const envelope = deepFreeze({
        ok: true,
        repository: cloneValue(repository),
        githubRequestId: normalizeString(response.githubRequestId),
        rateLimit: isPlainObject(response.rateLimit) ? cloneValue(response.rateLimit) : createNullObject(),
        fetchedAt: nowIsoString(),
        raw: requestOptions.includeRaw ? cloneValue(response.data) : undefined
      });

      logger.debug('GitHub repository metadata fetched successfully.', {
        requestId: requestId,
        repository: repository.fullName,
        defaultBranch: repository.defaultBranch
      });

      return envelope;
    } catch (error) {
      const normalizedError = normalizeRepoServiceError(
        error,
        'Failed to fetch GitHub repository metadata.',
        {
          repository: cloneValue(requestOptions.repository)
        }
      );

      logger.warn('Failed to fetch GitHub repository metadata.', {
        requestId: requestId,
        repository: cloneValue(requestOptions.repository),
        code: normalizedError.code,
        message: normalizedError.message
      });

      throw normalizedError;
    }
  }

  function normalizeBranchRequestOptions(context, options) {
    const source = isPlainObject(options) ? cloneValue(options) : createNullObject();
    const repository = buildRepositoryDescriptor(
      assertRepositoryRef(
        mergePlainObjects(
          stableObject(source.repository),
          stableObject(context.repository)
        ),
        {
          source: 'getBranchInfo'
        }
      )
    );

    return deepFreeze({
      repository: repository,
      branch: normalizeString(source.branch || source.baseBranch),
      fetchRepositoryMetadata: normalizeBoolean(source.fetchRepositoryMetadata, true),
      includeRaw: normalizeBoolean(source.includeRaw, false)
    });
  }

  async function resolveRepositoryAndBranch(client, options) {
    const source = isPlainObject(options) ? options : createNullObject();
    let repository = buildRepositoryDescriptor(
      assertRepositoryRef(
        mergePlainObjects(
          stableObject(source.repository),
          stableObject(client.context && client.context.repository)
        ),
        {
          source: 'resolveRepositoryAndBranch'
        }
      )
    );
    let repositoryResponse = null;

    if (normalizeBoolean(source.fetchRepositoryMetadata, true)) {
      repositoryResponse = await client.getRepository({
        repository: repository
      });
      repository = normalizeRepositoryPayload(repositoryResponse.data, repository);
    }

    const branchName = normalizeString(source.branch || source.baseBranch)
      || normalizeString(repository.baseBranch)
      || normalizeString(repository.defaultBranch)
      || DEFAULT_BASE_BRANCH;

    return deepFreeze({
      repository: repository,
      repositoryResponse: repositoryResponse,
      branchName: branchName
    });
  }

  async function getBranchInfo(options) {
    const client = await githubApi.createClient(options);
    const requestOptions = normalizeBranchRequestOptions(client.context, options);
    const requestId = createRequestId('repo_branch');

    logger.debug('Fetching GitHub branch metadata.', {
      requestId: requestId,
      repository: cloneValue(requestOptions.repository),
      branch: requestOptions.branch
    });

    try {
      const resolved = await resolveRepositoryAndBranch(client, requestOptions);
      const response = await client.getRepositoryBranch({
        repository: resolved.repository,
        branch: resolved.branchName
      });
      const branch = normalizeBranchPayload(response.data, resolved.repository, {
        fallbackName: resolved.branchName,
        commitShaFallback: false
      });
      const githubRequestIds = uniqueStrings([
        normalizeString(resolved.repositoryResponse && resolved.repositoryResponse.githubRequestId),
        normalizeString(response.githubRequestId)
      ]);

      const envelope = deepFreeze({
        ok: true,
        repository: cloneValue(resolved.repository),
        branch: cloneValue(branch),
        githubRequestIds: githubRequestIds,
        rateLimit: isPlainObject(response.rateLimit) ? cloneValue(response.rateLimit) : createNullObject(),
        fetchedAt: nowIsoString(),
        raw: requestOptions.includeRaw
          ? {
              repository: resolved.repositoryResponse ? cloneValue(resolved.repositoryResponse.data) : null,
              branch: cloneValue(response.data)
            }
          : undefined
      });

      logger.debug('GitHub branch metadata fetched successfully.', {
        requestId: requestId,
        repository: resolved.repository.fullName,
        branch: branch.name,
        treeSha: branch.treeSha
      });

      return envelope;
    } catch (error) {
      const normalizedError = normalizeRepoServiceError(
        error,
        'Failed to fetch GitHub branch metadata.',
        {
          repository: cloneValue(requestOptions.repository),
          branch: requestOptions.branch
        }
      );

      logger.warn('Failed to fetch GitHub branch metadata.', {
        requestId: requestId,
        repository: cloneValue(requestOptions.repository),
        branch: requestOptions.branch,
        code: normalizedError.code,
        message: normalizedError.message
      });

      throw normalizedError;
    }
  }

  function normalizeTreeOptions(context, options) {
    const source = isPlainObject(options) ? cloneValue(options) : createNullObject();
    const repository = buildRepositoryDescriptor(
      assertRepositoryRef(
        mergePlainObjects(
          stableObject(source.repository),
          stableObject(context.repository)
        ),
        {
          source: 'getRepositoryTree'
        }
      )
    );
    const pathPrefix = normalizeTreePath(
      source.pathPrefix || source.prefix || source.directory,
      {
        allowEmpty: true
      }
    );
    const textOptions = normalizeTextOptions(
      mergePlainObjects(
        stableObject(source.textOptions),
        {
          includeHeader: hasOwn(source, 'textIncludeHeader') ? source.textIncludeHeader : undefined,
          includeTypes: hasOwn(source, 'textIncludeTypes') ? source.textIncludeTypes : undefined,
          includeSizes: hasOwn(source, 'textIncludeSizes') ? source.textIncludeSizes : undefined,
          includeSha: hasOwn(source, 'textIncludeSha') ? source.textIncludeSha : undefined,
          includeImplicitFlag: hasOwn(source, 'textIncludeImplicitFlag') ? source.textIncludeImplicitFlag : undefined,
          emptyLabel: source.textEmptyLabel,
          sort: source.sort,
          pathPrefix: pathPrefix
        }
      )
    );

    return deepFreeze({
      repository: repository,
      branch: normalizeString(source.branch || source.baseBranch),
      treeSha: normalizeString(source.treeSha || source.sha),
      recursive: normalizeBoolean(source.recursive, true),
      includeDirectories: normalizeBoolean(source.includeDirectories, true),
      includeFiles: normalizeBoolean(source.includeFiles, true),
      includeSubmodules: normalizeBoolean(source.includeSubmodules, true),
      includeImplicitDirectories: normalizeBoolean(source.includeImplicitDirectories, true),
      includeRaw: normalizeBoolean(source.includeRaw, false),
      fetchRepositoryMetadata: normalizeBoolean(source.fetchRepositoryMetadata, true),
      maxEntries: normalizePositiveInteger(source.maxEntries, DEFAULT_MAX_ENTRIES),
      maxDepth: normalizeOptionalPositiveInteger(source.maxDepth, DEFAULT_MAX_DEPTH),
      pathPrefix: pathPrefix,
      sort: normalizeTreeSort(source.sort),
      buildText: normalizeBoolean(source.buildText, true),
      textOptions: textOptions
    });
  }

  function buildGithubRequestIds() {
    const output = [];

    for (let index = 0; index < arguments.length; index += 1) {
      const value = arguments[index];

      if (typeof value === 'string') {
        output.push(value);
        continue;
      }

      if (Array.isArray(value)) {
        output.push.apply(output, value);
      }
    }

    return uniqueStrings(output);
  }

  function normalizeTreeApiResponseData(rawData) {
    const source = isPlainObject(rawData) ? rawData : createNullObject();

    return deepFreeze({
      sha: normalizeString(source.sha),
      truncated: normalizeBoolean(source.truncated, false),
      url: normalizeString(source.url),
      tree: Array.isArray(source.tree) ? source.tree.slice() : []
    });
  }

  async function getRepositoryTree(options) {
    const client = await githubApi.createClient(options);
    const requestOptions = normalizeTreeOptions(client.context, options);
    const requestId = createRequestId('repo_tree');

    logger.debug('Fetching GitHub repository tree.', {
      requestId: requestId,
      repository: cloneValue(requestOptions.repository),
      branch: requestOptions.branch,
      treeSha: requestOptions.treeSha,
      recursive: requestOptions.recursive,
      pathPrefix: requestOptions.pathPrefix,
      maxEntries: requestOptions.maxEntries,
      maxDepth: requestOptions.maxDepth
    });

    try {
      const resolved = await resolveRepositoryAndBranch(client, requestOptions);
      const branchResponse = await client.getRepositoryBranch({
        repository: resolved.repository,
        branch: resolved.branchName
      });
      const branch = normalizeBranchPayload(branchResponse.data, resolved.repository, {
        fallbackName: resolved.branchName,
        commitShaFallback: true
      });
      const resolvedTreeSha = normalizeString(requestOptions.treeSha)
        || normalizeString(branch.treeSha)
        || normalizeString(branch.commitSha);

      if (!resolvedTreeSha) {
        throw createRepoServiceError(
          ERROR_CODES.INVALID_STATE || 'INVALID_STATE',
          'Could not resolve a tree SHA for the requested branch.',
          {
            repository: cloneValue(resolved.repository),
            branch: branch.name
          }
        );
      }

      const treeResponse = await client.getTree({
        repository: resolved.repository,
        treeSha: resolvedTreeSha,
        recursive: requestOptions.recursive
      });
      const treeData = normalizeTreeApiResponseData(treeResponse.data);

      if (!Array.isArray(treeData.tree)) {
        throw createRepoServiceError(
          ERROR_CODES.INVALID_STATE || 'INVALID_STATE',
          'GitHub tree response is missing the tree array.',
          {
            repository: cloneValue(resolved.repository),
            branch: branch.name,
            treeSha: resolvedTreeSha
          }
        );
      }

      const flattenDetails = flattenTreeEntriesDetailed(treeData.tree, {
        repository: resolved.repository,
        branchName: branch.name,
        includeImplicitDirectories: requestOptions.includeImplicitDirectories,
        sort: requestOptions.sort
      });
      const filterDetails = filterTreeEntriesDetailed(flattenDetails.items, {
        pathPrefix: requestOptions.pathPrefix,
        includeDirectories: requestOptions.includeDirectories,
        includeFiles: requestOptions.includeFiles,
        includeSubmodules: requestOptions.includeSubmodules,
        maxDepth: requestOptions.maxDepth
      });
      let entries = sortTreeEntries(filterDetails.items, {
        sort: requestOptions.sort
      });
      let serviceTruncated = false;

      if (entries.length > requestOptions.maxEntries) {
        entries = entries.slice(0, requestOptions.maxEntries);
        serviceTruncated = true;
      }

      const githubTruncated = treeData.truncated === true;
      const treeSha = normalizeString(treeData.sha) || resolvedTreeSha;
      const counts = buildTreeCounts(
        treeData.tree,
        flattenDetails,
        filterDetails,
        entries,
        githubTruncated,
        serviceTruncated
      );
      const treeSource = {
        repository: resolved.repository,
        branch: branch,
        branchName: branch.name,
        treeSha: treeSha,
        recursive: requestOptions.recursive,
        truncated: githubTruncated || serviceTruncated,
        pathPrefix: requestOptions.pathPrefix,
        entries: entries
      };
      const text = requestOptions.buildText
        ? buildTreeText(treeSource, requestOptions.textOptions)
        : '';
      const snapshot = buildTreeSnapshot(treeSource, {
        text: text,
        textOptions: requestOptions.textOptions,
        generatedAt: nowIsoString()
      });
      const githubRequestIds = buildGithubRequestIds(
        normalizeString(resolved.repositoryResponse && resolved.repositoryResponse.githubRequestId),
        normalizeString(branchResponse.githubRequestId),
        normalizeString(treeResponse.githubRequestId)
      );
      const envelope = deepFreeze({
        ok: true,
        repository: cloneValue(resolved.repository),
        branch: cloneValue(branch),
        treeSha: treeSha,
        recursive: requestOptions.recursive,
        pathPrefix: requestOptions.pathPrefix,
        sort: requestOptions.sort,
        entries: cloneValue(entries),
        paths: buildPathList(entries, {
          includeDirectories: true,
          includeFiles: true,
          includeSubmodules: true
        }),
        text: text,
        snapshot: cloneValue(snapshot),
        counts: counts,
        truncated: deepFreeze({
          github: githubTruncated,
          service: serviceTruncated,
          partial: githubTruncated || serviceTruncated
        }),
        githubRequestIds: githubRequestIds,
        rateLimit: isPlainObject(treeResponse.rateLimit) ? cloneValue(treeResponse.rateLimit) : createNullObject(),
        fetchedAt: nowIsoString(),
        raw: requestOptions.includeRaw
          ? {
              repository: resolved.repositoryResponse ? cloneValue(resolved.repositoryResponse.data) : null,
              branch: cloneValue(branchResponse.data),
              tree: cloneValue(treeResponse.data)
            }
          : undefined
      });

      logger.debug('GitHub repository tree fetched successfully.', {
        requestId: requestId,
        repository: envelope.repository.fullName,
        branch: envelope.branch.name,
        treeSha: envelope.treeSha,
        returnedCount: envelope.counts.returnedCount,
        partial: envelope.truncated.partial
      });

      return envelope;
    } catch (error) {
      const normalizedError = normalizeRepoServiceError(
        error,
        'Failed to fetch GitHub repository tree.',
        {
          repository: cloneValue(requestOptions.repository),
          branch: requestOptions.branch,
          pathPrefix: requestOptions.pathPrefix
        }
      );

      logger.warn('Failed to fetch GitHub repository tree.', {
        requestId: requestId,
        repository: cloneValue(requestOptions.repository),
        branch: requestOptions.branch,
        code: normalizedError.code,
        message: normalizedError.message
      });

      throw normalizedError;
    }
  }

  async function getRepositoryTreeSnapshot(options) {
    const envelope = await getRepositoryTree(options);
    return envelope.snapshot;
  }

  async function getRepositoryTreeText(options) {
    const envelope = await getRepositoryTree(Object.assign(createNullObject(), stableObject(options), {
      buildText: true
    }));
    return envelope.text;
  }

  async function getRepositoryTreePaths(options) {
    const envelope = await getRepositoryTree(Object.assign(createNullObject(), stableObject(options), {
      buildText: false
    }));
    return envelope.paths;
  }

  const api = {
    defaults: deepFreeze({
      baseUrl: DEFAULT_BASE_URL,
      baseBranch: DEFAULT_BASE_BRANCH,
      maxEntries: DEFAULT_MAX_ENTRIES,
      maxDepth: DEFAULT_MAX_DEPTH,
      protocolVersion: DEFAULT_PROTOCOL_VERSION,
      textEmptyLabel: DEFAULT_TEXT_EMPTY_LABEL
    }),
    normalizeRepositoryPayload: normalizeRepositoryPayload,
    normalizeBranchPayload: normalizeBranchPayload,
    normalizeTreeEntry: normalizeTreeEntry,
    flattenTreeEntries: flattenTreeEntries,
    filterTreeEntries: filterTreeEntries,
    sortTreeEntries: sortTreeEntries,
    buildTreeText: buildTreeText,
    buildTreeSnapshot: buildTreeSnapshot,
    buildPathList: buildPathList,
    buildPathLookup: buildPathLookup,
    findTreeEntryByPath: findTreeEntryByPath,
    summarizeTree: summarizeTree,
    getRepositoryMetadata: getRepositoryMetadata,
    getBranchInfo: getBranchInfo,
    getRepositoryTree: getRepositoryTree,
    getRepositoryTreeSnapshot: getRepositoryTreeSnapshot,
    getRepositoryTreeText: getRepositoryTreeText,
    getRepositoryTreePaths: getRepositoryTreePaths,
    helpers: deepFreeze({
      normalizeRepositoryRef: normalizeRepositoryRef,
      assertRepositoryRef: assertRepositoryRef,
      buildRepositoryDescriptor: buildRepositoryDescriptor,
      buildRepositoryUrls: buildRepositoryUrls,
      buildBranchHtmlUrl: buildBranchHtmlUrl,
      extractCommitSha: extractCommitSha,
      extractTreeSha: extractTreeSha,
      normalizeTreePath: normalizeTreePath,
      tryNormalizeTreePath: tryNormalizeTreePath,
      splitPathSegments: splitPathSegments,
      getPathDepth: getPathDepth,
      getPathName: getPathName,
      getParentPath: getParentPath,
      getFileExtension: getFileExtension,
      normalizeEntryType: normalizeEntryType,
      buildEntryHtmlUrl: buildEntryHtmlUrl,
      createImplicitDirectoryEntry: createImplicitDirectoryEntry,
      dedupeTreeEntries: dedupeTreeEntries,
      buildImplicitDirectories: buildImplicitDirectories,
      normalizeTreeSort: normalizeTreeSort,
      compareTreeEntries: compareTreeEntries,
      pathMatchesPrefix: pathMatchesPrefix,
      getRelativeDepth: getRelativeDepth,
      flattenTreeEntriesDetailed: flattenTreeEntriesDetailed,
      filterTreeEntriesDetailed: filterTreeEntriesDetailed,
      normalizeMetadataOptions: normalizeMetadataOptions,
      normalizeBranchRequestOptions: normalizeBranchRequestOptions,
      normalizeTreeOptions: normalizeTreeOptions,
      resolveRepositoryAndBranch: resolveRepositoryAndBranch,
      normalizeTreeApiResponseData: normalizeTreeApiResponseData,
      createRepoServiceError: createRepoServiceError,
      isRepoServiceError: isRepoServiceError
    })
  };

  try {
    logger.debug('GitHub repository service module registered.', {
      defaultBaseBranch: DEFAULT_BASE_BRANCH,
      maxEntries: DEFAULT_MAX_ENTRIES,
      maxDepth: DEFAULT_MAX_DEPTH,
      protocolVersion: DEFAULT_PROTOCOL_VERSION
    });
  } catch (error) {
  }

  root.registerValue('github_repo_service', deepFreeze(api), {
    overwrite: false,
    freeze: false,
    clone: false
  });
}(typeof globalThis !== 'undefined'
  ? globalThis
  : (typeof self !== 'undefined'
    ? self
    : (typeof window !== 'undefined' ? window : this))));