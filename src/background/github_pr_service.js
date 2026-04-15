(function registerMAOEGitHubPrService(globalScope) {
  'use strict';


const root = globalScope.MAOE;

if (!root || typeof root.registerValue !== 'function') {
throw new Error('[MAOE] namespace.js must be loaded before github_pr_service.js.');
}

if (root.has('github_pr_service')) {
return;
}

if (!root.has('constants')) {
throw new Error('[MAOE] constants.js must be loaded before github_pr_service.js.');
}

if (!root.has('protocol')) {
throw new Error('[MAOE] protocol.js must be loaded before github_pr_service.js.');
}

if (!root.has('github_api')) {
throw new Error('[MAOE] github_api.js must be loaded before github_pr_service.js.');
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
    consoleObject[level]('[MAOE/github_pr_service] ' + message);
    return;
  }

  consoleObject[level]('[MAOE/github_pr_service] ' + message, context);
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
    return loggerModule.createScope('github_pr_service');
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
const DEFAULT_BASE_BRANCH = normalizeString(REPOSITORY.DEFAULT_BASE_BRANCH || 'main');
const DEFAULT_TITLE_TEMPLATE = normalizeString(REPOSITORY.DEFAULT_PULL_REQUEST_TITLE_TEMPLATE || '[Issue #{issueNumber}] {issueTitle}');
const DEFAULT_DRAFT = normalizeBoolean(REPOSITORY.DEFAULT_PULL_REQUEST_DRAFT, false);
const DEFAULT_WORKING_BRANCH_PREFIX = normalizeString(REPOSITORY.WORKING_BRANCH_PREFIX || 'maoe/issue-');
const BRANCH_NAME_MAX_LENGTH = Number.isFinite(Number(REPOSITORY.BRANCH_NAME_MAX_LENGTH))
? Math.max(8, Math.trunc(Number(REPOSITORY.BRANCH_NAME_MAX_LENGTH)))
: 120;
const DEFAULT_PROTOCOL_VERSION = normalizeString(APP.protocolVersion) || '1.0.0';
const DEFAULT_BODY_PREVIEW_LENGTH = 240;
const DEFAULT_MAINTAINER_CAN_MODIFY = true;
const REVIEW_STATE_VALUES = ['open', 'closed'];
const MERGEABLE_STATE_VALUES = [
'clean',
'dirty',
'behind',
'blocked',
'unstable',
'unknown',
'draft',
'has_hooks'
];

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

function normalizeNullableBoolean(value) {
if (value === null || typeof value === 'undefined') {
return null;
}

return normalizeBoolean(value, false);

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

function nowIsoString() {
return new Date().toISOString();
}

function createRequestId(prefix) {
if (protocolHelpers && typeof protocolHelpers.generateRequestId === 'function') {
try {
return protocolHelpers.generateRequestId(prefix || 'pr');
} catch (error) {
}
}

const normalizedPrefix = normalizeLowerString(prefix) || 'pr';
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

function collapseInlineWhitespace(value) {
return coerceText(value).replace(/\s+/g, ' ').trim();
}

function normalizeMultilineText(value) {
return coerceText(value)
.replace(/\r\n/g, '\n')
.replace(/\r/g, '\n')
.trim();
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

function buildBodyPreview(text, maxLength) {
const source = collapseInlineWhitespace(text);
const normalizedMax = normalizePositiveInteger(maxLength, DEFAULT_BODY_PREVIEW_LENGTH);

if (!source || source.length <= normalizedMax) {
  return source;
}

if (normalizedMax <= 1) {
  return source.slice(0, normalizedMax);
}

return source.slice(0, normalizedMax - 1).trimEnd() + '…';

}

function createPrServiceError(code, message, details) {
const error = new Error(normalizeString(message) || 'GitHub pull request service error.');
error.name = 'MAOEGitHubPrServiceError';
error.code = normalizeString(code) || (ERROR_CODES.UNKNOWN_ERROR || 'UNKNOWN_ERROR');
error.details = isPlainObject(details) ? cloneValue(details) : createNullObject();
error.isGitHubPrServiceError = true;
return error;
}

function isPrServiceError(error) {
return !!(error && typeof error === 'object' && error.isGitHubPrServiceError === true);
}

function normalizePrServiceError(error, fallbackMessage, extraDetails) {
if (isPrServiceError(error)) {
return error;
}

return createPrServiceError(
  normalizeString(error && error.code) || (ERROR_CODES.UNKNOWN_ERROR || 'UNKNOWN_ERROR'),
  normalizeString(error && error.message) || normalizeString(fallbackMessage) || 'GitHub pull request service error.',
  mergePlainObjects(
    stableObject(error && error.details),
    stableObject(extraDetails)
  )
);

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
  throw createPrServiceError(
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
const owner = normalizeString(repository && repository.owner);
const repo = normalizeString(repository && repository.repo);

if (!owner || !repo) {
  return {
    fullName: '',
    htmlUrl: '',
    apiUrl: '',
    pullsHtmlUrl: '',
    pullsApiUrl: ''
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
  pullsHtmlUrl: htmlUrl + '/pulls',
  pullsApiUrl: apiUrl + '/pulls'
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
  pullsHtmlUrl: urls.pullsHtmlUrl,
  pullsApiUrl: urls.pullsApiUrl,
  baseBranch: normalizeString(normalized.baseBranch) || normalizeString(normalized.defaultBranch) || DEFAULT_BASE_BRANCH,
  defaultBranch: normalizeString(normalized.defaultBranch),
  workingBranchPrefix: normalizeString(normalized.workingBranchPrefix)
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
  pullsHtmlUrl: normalizeString(source.html_url) ? normalizeString(source.html_url) + '/pulls' : descriptor.pullsHtmlUrl,
  pullsApiUrl: normalizeString(source.url) ? normalizeString(source.url) + '/pulls' : descriptor.pullsApiUrl,
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
  openIssues: normalizeIntegerOrNull(source.open_issues),
  closedIssues: normalizeIntegerOrNull(source.closed_issues),
  htmlUrl: normalizeString(source.html_url),
  apiUrl: normalizeString(source.url)
});

}

function normalizeRequestedTeam(team) {
const source = isPlainObject(team) ? team : createNullObject();

return deepFreeze({
  id: normalizeIntegerOrNull(source.id),
  nodeId: normalizeString(source.node_id),
  name: normalizeString(source.name),
  slug: normalizeString(source.slug),
  description: coerceText(source.description),
  privacy: normalizeString(source.privacy),
  permission: normalizeString(source.permission),
  htmlUrl: normalizeString(source.html_url),
  apiUrl: normalizeString(source.url)
});

}

function normalizeIssueLabels(value) {
if (!Array.isArray(value)) {
return [];
}

const output = [];
const seen = new Set();

for (const entry of value) {
  let labelName = '';

  if (typeof entry === 'string') {
    labelName = normalizeString(entry);
  } else if (isPlainObject(entry)) {
    labelName = normalizeString(entry.name);
  }

  if (!labelName || seen.has(labelName)) {
    continue;
  }

  seen.add(labelName);
  output.push(labelName);
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
  labels: normalizeIssueLabels(source.labels || source.labelNames)
});

}

function formatIssueHeader(issue) {
const source = normalizeIssueRef(issue);
const title = source.title || '(untitled issue)';
const number = source.number === null ? '#?' : '#' + String(source.number);
return number + ' ' + title;
}

function buildBranchHtmlUrl(repository, branchName) {
const repo = normalizeRepositoryPayload(null, repository);
const normalizedBranchName = normalizeString(branchName);

if (!repo.htmlUrl || !normalizedBranchName) {
  return '';
}

return repo.htmlUrl + '/tree/' + encodeURIComponent(normalizedBranchName);

}

function normalizePrBranchPayload(rawBranch, fallbackRepository, role) {
const source = isPlainObject(rawBranch) ? rawBranch : createNullObject();
const fallbackRepo = normalizeRepositoryPayload(null, fallbackRepository);
const branchRepo = normalizeRepositoryPayload(source.repo, fallbackRepo);
const branchUser = normalizeUser(source.user || (isPlainObject(source.repo) ? source.repo.owner : null));
const ref = normalizeString(source.ref);
const label = normalizeString(source.label) || (branchUser.login && ref ? branchUser.login + ':' + ref : ref);
const apiUrl = normalizeString(source.repo && source.repo.url) && ref
? normalizeString(source.repo.url) + '/branches/' + encodeURIComponent(ref)
: '';

return deepFreeze({
  role: normalizeString(role),
  label: label,
  ref: ref,
  sha: normalizeString(source.sha),
  user: branchUser,
  repo: branchRepo,
  htmlUrl: buildBranchHtmlUrl(branchRepo, ref),
  apiUrl: apiUrl,
  isCrossRepository: !!(branchRepo.fullName
    && fallbackRepo.fullName
    && normalizeLowerString(branchRepo.fullName) !== normalizeLowerString(fallbackRepo.fullName))
});

}

function normalizePullRequestResponse(rawPullRequest, fallbackRepository) {
const source = isPlainObject(rawPullRequest) ? rawPullRequest : createNullObject();
const baseRepository = normalizeRepositoryPayload(
isPlainObject(source.base) ? source.base.repo : null,
fallbackRepository
);
const repository = baseRepository.fullName
? baseRepository
: normalizeRepositoryPayload(
isPlainObject(source.head) ? source.head.repo : null,
fallbackRepository
);
const head = normalizePrBranchPayload(source.head, repository, 'head');
const base = normalizePrBranchPayload(source.base, repository, 'base');
const user = normalizeUser(source.user);
const assignees = stableArray(source.assignees).map(normalizeUser).filter(function filterAssignees(entry) {
return !!entry.login;
});
const labels = stableArray(source.labels).map(normalizeLabel).filter(function filterLabels(entry) {
return !!entry.name;
});
const requestedReviewers = stableArray(source.requested_reviewers).map(normalizeUser).filter(function filterReviewers(entry) {
return !!entry.login;
});
const requestedTeams = stableArray(source.requested_teams).map(normalizeRequestedTeam).filter(function filterTeams(entry) {
return !!entry.slug || !!entry.name;
});
const body = coerceText(source.body);

return deepFreeze({
  id: normalizeIntegerOrNull(source.id),
  nodeId: normalizeString(source.node_id),
  number: normalizeIntegerOrNull(source.number),
  title: normalizeString(source.title),
  body: body,
  bodyPreview: buildBodyPreview(body, DEFAULT_BODY_PREVIEW_LENGTH),
  bodyLength: body.length,
  state: oneOf(normalizeLowerString(source.state), REVIEW_STATE_VALUES, normalizeLowerString(source.state)),
  locked: normalizeBoolean(source.locked, false),
  draft: normalizeBoolean(source.draft, false),
  merged: normalizeBoolean(source.merged, false),
  mergeable: normalizeNullableBoolean(source.mergeable),
  rebaseable: normalizeNullableBoolean(source.rebaseable),
  mergeableState: oneOf(normalizeLowerString(source.mergeable_state), MERGEABLE_STATE_VALUES, normalizeLowerString(source.mergeable_state)),
  maintainerCanModify: normalizeBoolean(source.maintainer_can_modify, DEFAULT_MAINTAINER_CAN_MODIFY),
  comments: normalizeIntegerOrNull(source.comments),
  reviewComments: normalizeIntegerOrNull(source.review_comments),
  commits: normalizeIntegerOrNull(source.commits),
  additions: normalizeIntegerOrNull(source.additions),
  deletions: normalizeIntegerOrNull(source.deletions),
  changedFiles: normalizeIntegerOrNull(source.changed_files),
  authorAssociation: normalizeString(source.author_association),
  mergeCommitSha: normalizeString(source.merge_commit_sha),
  user: user,
  assignees: assignees,
  assigneeLogins: assignees.map(function mapAssignee(entry) {
    return entry.login;
  }),
  labels: labels,
  labelNames: labels.map(function mapLabel(entry) {
    return entry.name;
  }),
  milestone: normalizeMilestone(source.milestone),
  requestedReviewers: requestedReviewers,
  requestedReviewerLogins: requestedReviewers.map(function mapReviewer(entry) {
    return entry.login;
  }),
  requestedTeams: requestedTeams,
  head: head,
  base: base,
  repository: repository,
  apiUrl: normalizeString(source.url),
  htmlUrl: normalizeString(source.html_url),
  diffUrl: normalizeString(source.diff_url),
  patchUrl: normalizeString(source.patch_url),
  issueUrl: normalizeString(source.issue_url),
  commentsUrl: normalizeString(source.comments_url),
  reviewCommentsUrl: normalizeString(source.review_comments_url),
  reviewCommentUrl: normalizeString(source.review_comment_url),
  commitsUrl: normalizeString(source.commits_url),
  statusesUrl: normalizeString(source.statuses_url),
  createdAt: normalizeIsoTimestamp(source.created_at),
  updatedAt: normalizeIsoTimestamp(source.updated_at),
  closedAt: normalizeIsoTimestamp(source.closed_at),
  mergedAt: normalizeIsoTimestamp(source.merged_at),
  summary: deepFreeze({
    number: normalizeIntegerOrNull(source.number),
    title: normalizeString(source.title),
    state: oneOf(normalizeLowerString(source.state), REVIEW_STATE_VALUES, normalizeLowerString(source.state)),
    draft: normalizeBoolean(source.draft, false),
    merged: normalizeBoolean(source.merged, false),
    headRef: head.ref,
    baseRef: base.ref,
    repositoryFullName: repository.fullName,
    url: normalizeString(source.html_url) || normalizeString(source.url)
  })
});

}

function summarizePullRequest(pullRequest) {
const normalized = normalizePullRequestResponse(pullRequest, createNullObject());

return deepFreeze({
  number: normalized.number,
  title: normalized.title,
  state: normalized.state,
  draft: normalized.draft,
  merged: normalized.merged,
  repositoryFullName: normalized.repository.fullName,
  headRef: normalized.head.ref,
  baseRef: normalized.base.ref,
  url: normalized.htmlUrl || normalized.apiUrl,
  updatedAt: normalized.updatedAt
});

}

function normalizeMixedTextArray(value) {
let source = [];

if (typeof value === 'string') {
  source = value.split(/\r?\n+/);
} else if (Array.isArray(value)) {
  source = value.slice();
} else {
  return [];
}

const output = [];
const seen = new Set();

for (const entry of source) {
  let text = '';

  if (typeof entry === 'string') {
    text = collapseInlineWhitespace(entry);
  } else if (isPlainObject(entry)) {
    text = collapseInlineWhitespace(entry.text || entry.message || entry.body || entry.note || '');
  } else if (entry !== null && typeof entry !== 'undefined') {
    text = collapseInlineWhitespace(String(entry));
  }

  if (!text || seen.has(text)) {
    continue;
  }

  seen.add(text);
  output.push(text);
}

return output;

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

function buildSuggestedHeadBranch(issue, workingBranchPrefix) {
const normalizedIssue = normalizeIssueRef(issue);
const prefix = normalizeString(workingBranchPrefix) || DEFAULT_WORKING_BRANCH_PREFIX;

if (CONSTANT_HELPERS && typeof CONSTANT_HELPERS.buildBranchName === 'function') {
  try {
    const built = CONSTANT_HELPERS.buildBranchName(
      normalizedIssue.number !== null ? normalizedIssue.number : 'task',
      normalizedIssue.title || 'task',
      prefix
    );

    if (normalizeString(built)) {
      return normalizeString(built);
    }
  } catch (error) {
  }
}

const issueNumberSegment = normalizedIssue.number !== null ? String(normalizedIssue.number) : 'task';
const titleSegment = slugify(normalizedIssue.title || 'task');
const rawBranchName = prefix + issueNumberSegment + '-' + titleSegment;
return rawBranchName.slice(0, BRANCH_NAME_MAX_LENGTH).replace(/\/+$/, '');

}

function normalizeHeadInput(source) {
const input = isPlainObject(source) ? source : createNullObject();
const directHeadBranch = normalizeString(
input.headBranch
|| input.workingBranch
|| input.branch
|| input.sourceBranch
|| input.branchName
|| input.headBranchName
);
let headOwner = normalizeString(
input.headOwner
|| input.headRepositoryOwner
|| input.headRepoOwner
|| (isPlainObject(input.headRepository) ? input.headRepository.owner : '')
);
const rawHead = normalizeString(input.head || input.headRef);
let headBranch = directHeadBranch;

if (!headBranch && rawHead) {
  const colonIndex = rawHead.indexOf(':');

  if (colonIndex > 0 && rawHead.indexOf(':', colonIndex + 1) < 0) {
    headOwner = headOwner || rawHead.slice(0, colonIndex).trim();
    headBranch = rawHead.slice(colonIndex + 1).trim();
  } else {
    headBranch = rawHead;
  }
}

return {
  headOwner: headOwner,
  headBranch: headBranch,
  rawHead: rawHead
};

}

function containsInvalidRefWhitespaceOrControl(text) {
return /[\u0000-\u0020\u007F]/.test(coerceText(text));
}

function normalizeOwnerName(value, options) {
const source = normalizeString(value);
const config = isPlainObject(options) ? options : createNullObject();
const allowEmpty = normalizeBoolean(config.allowEmpty, false);

if (!source) {
  if (allowEmpty) {
    return '';
  }

  throw createPrServiceError(
    ERROR_CODES.INVALID_ARGUMENT || 'INVALID_ARGUMENT',
    'Head owner is empty.',
    createNullObject()
  );
}

if (containsInvalidRefWhitespaceOrControl(source) || /[:/\\]/.test(source)) {
  throw createPrServiceError(
    ERROR_CODES.INVALID_ARGUMENT || 'INVALID_ARGUMENT',
    'Head owner contains invalid characters.',
    {
      owner: source
    }
  );
}

return source;

}

function normalizeGitRefName(value, fieldName) {
const source = normalizeString(value);

if (!source) {
  throw createPrServiceError(
    ERROR_CODES.INVALID_ARGUMENT || 'INVALID_ARGUMENT',
    fieldName + ' is empty.',
    {
      field: fieldName
    }
  );
}

if (containsInvalidRefWhitespaceOrControl(source)) {
  throw createPrServiceError(
    ERROR_CODES.INVALID_ARGUMENT || 'INVALID_ARGUMENT',
    fieldName + ' contains whitespace or control characters.',
    {
      field: fieldName,
      value: source
    }
  );
}

if (source.indexOf('..') >= 0
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
  throw createPrServiceError(
    ERROR_CODES.INVALID_ARGUMENT || 'INVALID_ARGUMENT',
    fieldName + ' is not a valid Git reference name.',
    {
      field: fieldName,
      value: source
    }
  );
}

return source;

}

function buildHeadRef(branchName, headOwner, repositoryOwner, options) {
const normalizedBranchName = normalizeGitRefName(branchName, 'headBranch');
const normalizedOwner = normalizeOwnerName(headOwner, {
allowEmpty: true
});
const repoOwner = normalizeString(repositoryOwner);
const config = isPlainObject(options) ? options : createNullObject();
const forceHeadOwner = normalizeBoolean(config.forceHeadOwner, false);

if (!normalizedOwner) {
  return normalizedBranchName;
}

if (!forceHeadOwner
  && repoOwner
  && normalizeLowerString(normalizedOwner) === normalizeLowerString(repoOwner)) {
  return normalizedBranchName;
}

return normalizedOwner + ':' + normalizedBranchName;

}

function formatRepositoryName(repository) {
const repo = buildRepositoryDescriptor(repository);
return repo.fullName || '(repository unspecified)';
}

function applyTemplate(template, data) {
const source = normalizeString(template);
const values = isPlainObject(data) ? data : createNullObject();

return source.replace(/\{([a-zA-Z0-9_]+)\}/g, function replacePlaceholder(match, key) {
  if (!hasOwn(values, key)) {
    return '';
  }

  return coerceText(values[key]);
});

}

function buildTitleTemplateData(normalized) {
const issue = normalizeIssueRef(normalized.issue);
const repository = buildRepositoryDescriptor(normalized.repository);

return {
  issueNumber: issue.number !== null ? String(issue.number) : '?',
  issueTitle: issue.title || 'Untitled task',
  repository: repository.fullName || '',
  base: normalizeString(normalized.baseBranch),
  head: normalizeString(normalized.headBranch),
  targetFile: normalizeString(normalized.targetFile)
};

}

function buildDefaultPullRequestTitle(normalized, options) {
const source = isPlainObject(normalized) ? normalized : createNullObject();
const config = isPlainObject(options) ? options : createNullObject();
const template = normalizeString(config.titleTemplate || source.titleTemplate) || DEFAULT_TITLE_TEMPLATE;
const title = collapseInlineWhitespace(applyTemplate(template, buildTitleTemplateData(source)));

if (title) {
  return title;
}

if (source.issue && source.issue.number !== null) {
  return 'Issue #' + String(source.issue.number);
}

if (normalizeString(source.headBranch) && normalizeString(source.baseBranch)) {
  return 'Automated PR: ' + normalizeString(source.headBranch) + ' -> ' + normalizeString(source.baseBranch);
}

return 'Automated pull request';

}

function buildMarkdownBulletList(items) {
const source = Array.isArray(items) ? items : [];

if (source.length === 0) {
  return '';
}

return source.map(function mapItem(item) {
  return '- ' + coerceText(item);
}).join('\n');

}

function buildDefaultPullRequestBody(normalized, options) {
const source = isPlainObject(normalized) ? normalized : createNullObject();
const config = isPlainObject(options) ? options : createNullObject();
const issue = normalizeIssueRef(source.issue);
const repository = buildRepositoryDescriptor(source.repository);
const sections = [];
const leadLines = [];
const notes = normalizeMixedTextArray(source.notes || config.notes);
const additionalBody = normalizeMultilineText(source.additionalBody || config.additionalBody);
const bodyFooter = normalizeMultilineText(source.bodyFooter || config.bodyFooter);
const includeClosesKeyword = normalizeBoolean(
hasOwn(source, 'includeClosesKeyword') ? source.includeClosesKeyword : config.includeClosesKeyword,
true
);
const includeGeneratedFooter = normalizeBoolean(
hasOwn(source, 'includeGeneratedFooter') ? source.includeGeneratedFooter : config.includeGeneratedFooter,
false
);
const summaryText = normalizeMultilineText(source.summaryText || source.summary || config.summary);

if (summaryText) {
  leadLines.push(summaryText);
} else {
  leadLines.push('1 task = 1 PR.');

  if (issue.number !== null && issue.title) {
    leadLines.push('Implements issue #' + String(issue.number) + ': ' + issue.title);
  } else if (issue.title) {
    leadLines.push('Implements: ' + issue.title);
  } else {
    leadLines.push('Automated pull request generated by ' + (normalizeString(APP.name) || 'MAOE') + '.');
  }
}

sections.push(leadLines.join('\n'));

const contextLines = [];

if (issue.number !== null && includeClosesKeyword) {
  contextLines.push('- Closes #' + String(issue.number));
} else if (issue.number !== null) {
  contextLines.push('- Source issue: #' + String(issue.number));
}

if (issue.title) {
  contextLines.push('- Issue title: ' + issue.title);
}

if (issue.url) {
  contextLines.push('- Issue URL: ' + issue.url);
}

if (repository.fullName) {
  contextLines.push('- Repository: `' + repository.fullName + '`');
}

if (normalizeString(source.headRef)) {
  contextLines.push('- Head: `' + normalizeString(source.headRef) + '`');
} else if (normalizeString(source.headBranch)) {
  contextLines.push('- Head: `' + normalizeString(source.headBranch) + '`');
}

if (normalizeString(source.baseBranch)) {
  contextLines.push('- Base: `' + normalizeString(source.baseBranch) + '`');
}

if (normalizeString(source.targetFile)) {
  contextLines.push('- Target file: `' + normalizeString(source.targetFile) + '`');
}

if (contextLines.length > 0) {
  sections.push('## Context\n' + contextLines.join('\n'));
}

if (notes.length > 0) {
  sections.push('## Notes\n' + buildMarkdownBulletList(notes));
}

if (additionalBody) {
  sections.push(additionalBody);
}

if (includeGeneratedFooter) {
  sections.push('Generated by ' + (normalizeString(APP.name) || 'MAOE') + ' (`' + DEFAULT_PROTOCOL_VERSION + '`).');
} else if (bodyFooter) {
  sections.push(bodyFooter);
}

return sections.filter(function filterSection(section) {
  return normalizeString(section) !== '';
}).join('\n\n').trim();

}

function normalizeCreateOptions(context, options) {
const clientContext = isPlainObject(context) ? context : createNullObject();
const source = isPlainObject(options) ? cloneValue(options) : createNullObject();
const headInput = normalizeHeadInput(source);
const repository = buildRepositoryDescriptor(
assertRepositoryRef(
mergePlainObjects(
stableObject(source.repository),
stableObject(clientContext.repository)
),
{
source: 'createPullRequest'
}
)
);
const issue = normalizeIssueRef(source.issue);
const targetFile = normalizeString(
source.targetFile
|| source.filePath
|| source.path
|| source.currentTaskFilePath
);
const titleProvided = hasOwn(source, 'title');
const bodyProvided = hasOwn(source, 'body');

return deepFreeze({
  repository: repository,
  issue: issue,
  explicitHeadBranch: normalizeString(headInput.headBranch),
  headOwner: normalizeString(headInput.headOwner),
  explicitBaseBranch: normalizeString(source.base || source.baseBranch || source.targetBase),
  titleProvided: titleProvided,
  bodyProvided: bodyProvided,
  explicitTitle: titleProvided ? collapseInlineWhitespace(source.title) : '',
  explicitBody: bodyProvided ? normalizeMultilineText(source.body) : '',
  summaryText: normalizeMultilineText(source.summary || source.description),
  notes: normalizeMixedTextArray(source.notes || source.bodyNotes || source.checklist),
  additionalBody: normalizeMultilineText(source.additionalBody || source.bodyAppend),
  bodyFooter: normalizeMultilineText(source.bodyFooter),
  titleTemplate: normalizeString(source.titleTemplate || source.prTitleTemplate) || DEFAULT_TITLE_TEMPLATE,
  targetFile: targetFile,
  workingBranchPrefix: normalizeString(source.workingBranchPrefix || repository.workingBranchPrefix) || DEFAULT_WORKING_BRANCH_PREFIX,
  draft: normalizeBoolean(source.draft, DEFAULT_DRAFT),
  maintainerCanModify: normalizeBoolean(source.maintainerCanModify, DEFAULT_MAINTAINER_CAN_MODIFY),
  includeClosesKeyword: normalizeBoolean(source.includeClosesKeyword, true),
  includeGeneratedFooter: normalizeBoolean(source.includeGeneratedFooter, false),
  forceHeadOwner: normalizeBoolean(source.forceHeadOwner, false),
  resolveBaseBranch: normalizeBoolean(source.resolveBaseBranch, normalizeString(source.base || source.baseBranch || source.targetBase) === ''),
  fetchRepositoryMetadata: normalizeBoolean(source.fetchRepositoryMetadata, false),
  includeRaw: normalizeBoolean(source.includeRaw, false),
  metadata: isPlainObject(source.metadata) ? cloneValue(source.metadata) : createNullObject()
});

}

function validateCreateOptions(normalized) {
const source = isPlainObject(normalized) ? normalized : createNullObject();
const errors = [];
const warnings = [];

if (!normalizeString(source.repository && source.repository.owner) || !normalizeString(source.repository && source.repository.repo)) {
  errors.push(deepFreeze({
    field: 'repository',
    code: ERROR_CODES.INVALID_ARGUMENT || 'INVALID_ARGUMENT',
    message: 'Repository owner/repo is required.'
  }));
}

if (!normalizeString(source.explicitHeadBranch)
  && !(source.issue && source.issue.number !== null && normalizeString(source.issue.title))) {
  warnings.push(deepFreeze({
    field: 'headBranch',
    code: 'AUTOGENERATION_LIMITATION',
    message: 'A head branch was not provided and may not be auto-generatable without issue metadata.'
  }));
}

if (!source.titleProvided && !(source.issue && (source.issue.number !== null || normalizeString(source.issue.title)))) {
  warnings.push(deepFreeze({
    field: 'title',
    code: 'AUTOGENERATED_TITLE',
    message: 'Title will fall back to a generic automated PR title.'
  }));
}

return deepFreeze({
  valid: errors.length === 0,
  errors: errors,
  warnings: warnings
});

}

async function resolveRepositoryMetadata(client, normalized) {
const needsMetadata = normalized.fetchRepositoryMetadata === true
|| (normalized.resolveBaseBranch === true && !normalizeString(normalized.explicitBaseBranch));

if (!needsMetadata) {
  return {
    repository: normalized.repository,
    repositoryResponse: null
  };
}

const response = await client.getRepository({
  repository: normalized.repository
});

return {
  repository: normalizeRepositoryPayload(response.data, normalized.repository),
  repositoryResponse: response
};

}

function resolveHeadBranch(normalized, repository) {
const explicit = normalizeString(normalized.explicitHeadBranch);

if (explicit) {
  return explicit;
}

if (normalized.issue && (normalized.issue.number !== null || normalizeString(normalized.issue.title))) {
  return buildSuggestedHeadBranch(normalized.issue, normalized.workingBranchPrefix || repository.workingBranchPrefix);
}

return '';

}

function resolveBaseBranch(normalized, repository) {
return normalizeString(normalized.explicitBaseBranch)
|| normalizeString(repository.baseBranch)
|| normalizeString(repository.defaultBranch)
|| DEFAULT_BASE_BRANCH;
}

function buildRequestPayload(prepared) {
const payload = {
title: prepared.title,
head: prepared.headRef,
base: prepared.baseBranch,
draft: prepared.draft,
maintainer_can_modify: prepared.maintainerCanModify
};

if (prepared.bodyProvided || normalizeString(prepared.body)) {
  payload.body = prepared.body;
}

return payload;

}

function buildRequestPreview(prepared) {
return deepFreeze({
title: prepared.title,
bodyLength: coerceText(prepared.body).length,
bodyPreview: buildBodyPreview(prepared.body, DEFAULT_BODY_PREVIEW_LENGTH),
head: prepared.headRef,
headBranch: prepared.headBranch,
headOwner: prepared.headOwner,
base: prepared.baseBranch,
draft: prepared.draft,
maintainerCanModify: prepared.maintainerCanModify,
targetFile: prepared.targetFile,
issueNumber: prepared.issue.number,
repositoryFullName: prepared.repository.fullName,
autoGenerated: deepFreeze({
title: prepared.autoGeneratedTitle,
body: prepared.autoGeneratedBody,
headBranch: prepared.autoGeneratedHeadBranch,
baseBranch: prepared.autoResolvedBaseBranch
})
});
}

async function prepareCreateOptionsWithClient(client, options) {
const normalized = normalizeCreateOptions(client && client.context, options);
const validation = validateCreateOptions(normalized);

if (!validation.valid) {
  const firstError = validation.errors[0];
  throw createPrServiceError(
    firstError.code,
    firstError.message,
    {
      field: firstError.field
    }
  );
}

const resolvedRepositoryMetadata = await resolveRepositoryMetadata(client, normalized);
const repository = resolvedRepositoryMetadata.repository;
const headBranch = resolveHeadBranch(normalized, repository);

if (!headBranch) {
  throw createPrServiceError(
    ERROR_CODES.INVALID_ARGUMENT || 'INVALID_ARGUMENT',
    'A head branch is required to create a pull request.',
    {
      repository: cloneValue(repository),
      issue: cloneValue(normalized.issue)
    }
  );
}

const normalizedHeadBranch = normalizeGitRefName(headBranch, 'headBranch');
const baseBranch = normalizeGitRefName(resolveBaseBranch(normalized, repository), 'baseBranch');
const headOwner = normalizeOwnerName(normalized.headOwner, {
  allowEmpty: true
});
const headRef = buildHeadRef(
  normalizedHeadBranch,
  headOwner,
  repository.owner,
  {
    forceHeadOwner: normalized.forceHeadOwner
  }
);

if ((!headOwner || normalizeLowerString(headOwner) === normalizeLowerString(repository.owner))
  && normalizeLowerString(normalizedHeadBranch) === normalizeLowerString(baseBranch)) {
  throw createPrServiceError(
    ERROR_CODES.INVALID_ARGUMENT || 'INVALID_ARGUMENT',
    'Head and base branches cannot be the same within the same repository.',
    {
      repository: cloneValue(repository),
      headBranch: normalizedHeadBranch,
      baseBranch: baseBranch
    }
  );
}

const title = normalized.titleProvided
  ? collapseInlineWhitespace(normalized.explicitTitle)
  : buildDefaultPullRequestTitle({
      repository: repository,
      issue: normalized.issue,
      headBranch: normalizedHeadBranch,
      baseBranch: baseBranch,
      targetFile: normalized.targetFile,
      titleTemplate: normalized.titleTemplate
    }, {
      titleTemplate: normalized.titleTemplate
    });

if (!title) {
  throw createPrServiceError(
    ERROR_CODES.INVALID_ARGUMENT || 'INVALID_ARGUMENT',
    'Pull request title is empty.',
    {
      repository: cloneValue(repository),
      issue: cloneValue(normalized.issue),
      headBranch: normalizedHeadBranch,
      baseBranch: baseBranch
    }
  );
}

const body = normalized.bodyProvided
  ? normalized.explicitBody
  : buildDefaultPullRequestBody({
      repository: repository,
      issue: normalized.issue,
      headRef: headRef,
      headBranch: normalizedHeadBranch,
      headOwner: headOwner,
      baseBranch: baseBranch,
      targetFile: normalized.targetFile,
      notes: normalized.notes,
      summaryText: normalized.summaryText,
      additionalBody: normalized.additionalBody,
      bodyFooter: normalized.bodyFooter,
      includeClosesKeyword: normalized.includeClosesKeyword,
      includeGeneratedFooter: normalized.includeGeneratedFooter
    });

const prepared = deepFreeze({
  repository: cloneValue(repository),
  issue: cloneValue(normalized.issue),
  targetFile: normalized.targetFile,
  headOwner: headOwner,
  headBranch: normalizedHeadBranch,
  headRef: headRef,
  baseBranch: baseBranch,
  title: title,
  body: body,
  bodyProvided: normalized.bodyProvided,
  draft: normalized.draft,
  maintainerCanModify: normalized.maintainerCanModify,
  includeRaw: normalized.includeRaw,
  metadata: cloneValue(normalized.metadata),
  autoGeneratedTitle: normalized.titleProvided !== true,
  autoGeneratedBody: normalized.bodyProvided !== true,
  autoGeneratedHeadBranch: normalized.explicitHeadBranch === '',
  autoResolvedBaseBranch: normalized.explicitBaseBranch === '',
  repositoryResponse: resolvedRepositoryMetadata.repositoryResponse,
  requestPayload: buildRequestPayload({
    title: title,
    body: body,
    bodyProvided: normalized.bodyProvided,
    headRef: headRef,
    headBranch: normalizedHeadBranch,
    headOwner: headOwner,
    baseBranch: baseBranch,
    draft: normalized.draft,
    maintainerCanModify: normalized.maintainerCanModify,
    targetFile: normalized.targetFile,
    issue: normalized.issue,
    repository: repository,
    autoGeneratedTitle: normalized.titleProvided !== true,
    autoGeneratedBody: normalized.bodyProvided !== true,
    autoGeneratedHeadBranch: normalized.explicitHeadBranch === '',
    autoResolvedBaseBranch: normalized.explicitBaseBranch === ''
  }),
  requestPreview: buildRequestPreview({
    title: title,
    body: body,
    headRef: headRef,
    headBranch: normalizedHeadBranch,
    headOwner: headOwner,
    baseBranch: baseBranch,
    draft: normalized.draft,
    maintainerCanModify: normalized.maintainerCanModify,
    targetFile: normalized.targetFile,
    issue: normalized.issue,
    repository: repository,
    autoGeneratedTitle: normalized.titleProvided !== true,
    autoGeneratedBody: normalized.bodyProvided !== true,
    autoGeneratedHeadBranch: normalized.explicitHeadBranch === '',
    autoResolvedBaseBranch: normalized.explicitBaseBranch === ''
  })
});

return prepared;

}

async function prepareCreateOptions(options) {
const client = await githubApi.createClient(options);
return prepareCreateOptionsWithClient(client, options);
}

async function createPullRequest(options) {
const client = await githubApi.createClient(options);
const requestId = createRequestId('pr_create');
let prepared = null;

try {
  prepared = await prepareCreateOptionsWithClient(client, options);

  logger.debug('Creating GitHub pull request.', {
    requestId: requestId,
    repository: cloneValue(prepared.repository),
    request: cloneValue(prepared.requestPreview)
  });

  const response = await client.postEndpoint('CREATE_PULL_REQUEST', {
    repository: prepared.repository,
    json: prepared.requestPayload,
    expect: 'json'
  });
  const pullRequest = normalizePullRequestResponse(response.data, prepared.repository);
  const githubRequestIds = uniqueStrings([
    normalizeString(prepared.repositoryResponse && prepared.repositoryResponse.githubRequestId),
    normalizeString(response.githubRequestId)
  ]);
  const envelope = deepFreeze({
    ok: true,
    repository: cloneValue(prepared.repository),
    issue: cloneValue(prepared.issue),
    request: cloneValue(prepared.requestPreview),
    pullRequest: cloneValue(pullRequest),
    githubRequestIds: githubRequestIds,
    rateLimit: isPlainObject(response.rateLimit) ? cloneValue(response.rateLimit) : createNullObject(),
    createdAt: nowIsoString(),
    raw: prepared.includeRaw
      ? {
          repository: prepared.repositoryResponse ? cloneValue(prepared.repositoryResponse.data) : null,
          pullRequest: cloneValue(response.data)
        }
      : undefined
  });

  logger.debug('GitHub pull request created successfully.', {
    requestId: requestId,
    repository: envelope.repository.fullName,
    number: envelope.pullRequest.number,
    url: envelope.pullRequest.htmlUrl
  });

  return envelope;
} catch (error) {
  const normalizedError = normalizePrServiceError(
    error,
    'Failed to create GitHub pull request.',
    {
      requestId: requestId,
      repository: prepared ? cloneValue(prepared.repository) : null,
      request: prepared ? cloneValue(prepared.requestPreview) : null
    }
  );

  logger.warn('Failed to create GitHub pull request.', {
    requestId: requestId,
    repository: prepared ? cloneValue(prepared.repository) : null,
    code: normalizedError.code,
    message: normalizedError.message,
    details: cloneValue(normalizedError.details)
  });

  throw normalizedError;
}

}

async function createPullRequestData(options) {
const envelope = await createPullRequest(options);
return envelope.pullRequest;
}

async function createPullRequestFromIssue(options) {
return createPullRequest(options);
}

const api = {
defaults: deepFreeze({
baseUrl: DEFAULT_BASE_URL,
baseBranch: DEFAULT_BASE_BRANCH,
titleTemplate: DEFAULT_TITLE_TEMPLATE,
draft: DEFAULT_DRAFT,
workingBranchPrefix: DEFAULT_WORKING_BRANCH_PREFIX,
branchNameMaxLength: BRANCH_NAME_MAX_LENGTH,
protocolVersion: DEFAULT_PROTOCOL_VERSION,
maintainerCanModify: DEFAULT_MAINTAINER_CAN_MODIFY
}),
normalizeRepositoryRef: normalizeRepositoryRef,
assertRepositoryRef: assertRepositoryRef,
buildRepositoryDescriptor: buildRepositoryDescriptor,
normalizeRepositoryPayload: normalizeRepositoryPayload,
normalizeIssueRef: normalizeIssueRef,
normalizePullRequestResponse: normalizePullRequestResponse,
summarizePullRequest: summarizePullRequest,
normalizeCreateOptions: normalizeCreateOptions,
validateCreateOptions: validateCreateOptions,
prepareCreateOptions: prepareCreateOptions,
buildDefaultPullRequestTitle: buildDefaultPullRequestTitle,
buildDefaultPullRequestBody: buildDefaultPullRequestBody,
createPullRequest: createPullRequest,
createPullRequestData: createPullRequestData,
createPullRequestFromIssue: createPullRequestFromIssue,
helpers: deepFreeze({
buildRepositoryUrls: buildRepositoryUrls,
normalizeUser: normalizeUser,
normalizeLabel: normalizeLabel,
normalizeMilestone: normalizeMilestone,
normalizeRequestedTeam: normalizeRequestedTeam,
normalizePrBranchPayload: normalizePrBranchPayload,
normalizeMixedTextArray: normalizeMixedTextArray,
slugify: slugify,
buildSuggestedHeadBranch: buildSuggestedHeadBranch,
normalizeHeadInput: normalizeHeadInput,
normalizeOwnerName: normalizeOwnerName,
normalizeGitRefName: normalizeGitRefName,
buildHeadRef: buildHeadRef,
formatIssueHeader: formatIssueHeader,
formatRepositoryName: formatRepositoryName,
applyTemplate: applyTemplate,
buildTitleTemplateData: buildTitleTemplateData,
buildRequestPayload: buildRequestPayload,
buildRequestPreview: buildRequestPreview,
prepareCreateOptionsWithClient: prepareCreateOptionsWithClient,
buildBodyPreview: buildBodyPreview,
createPrServiceError: createPrServiceError,
isPrServiceError: isPrServiceError,
normalizePrServiceError: normalizePrServiceError
})
};

try {
logger.debug('GitHub pull request service module registered.', {
baseBranch: DEFAULT_BASE_BRANCH,
titleTemplate: DEFAULT_TITLE_TEMPLATE,
draft: DEFAULT_DRAFT,
protocolVersion: DEFAULT_PROTOCOL_VERSION
});
} catch (error) {
}

root.registerValue('github_pr_service', deepFreeze(api), {
overwrite: false,
freeze: false,
clone: false
});
}(typeof globalThis !== 'undefined'
? globalThis
: (typeof self !== 'undefined'
? self
: (typeof window !== 'undefined' ? window : this))));