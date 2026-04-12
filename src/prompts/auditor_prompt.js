(function registerMAOEAuditorPrompt(globalScope) {
  'use strict';

const root = globalScope.MAOE;

if (!root || typeof root.registerValue !== 'function') {
throw new Error('[MAOE] namespace.js must be loaded before auditor_prompt.js.');
}

if (root.has('auditor_prompt')) {
return;
}

if (!root.has('constants')) {
throw new Error('[MAOE] constants.js must be loaded before auditor_prompt.js.');
}

if (!root.has('protocol')) {
throw new Error('[MAOE] protocol.js must be loaded before auditor_prompt.js.');
}

const constants = root.require('constants');
const protocol = root.require('protocol');
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
    consoleObject[level]('[MAOE/auditor_prompt] ' + message);
    return;
  }

  consoleObject[level]('[MAOE/auditor_prompt] ' + message, context);
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
    return loggerModule.createScope('auditor_prompt');
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
const PROMPT = constants.PROMPT || Object.create(null);
const PARSER = constants.PARSER || Object.create(null);
const PARSER_XML = PARSER.XML || Object.create(null);
const DEFAULTS = constants.DEFAULTS || Object.create(null);
const WORKFLOW = constants.WORKFLOW || Object.create(null);
const PROVIDERS = constants.PROVIDERS || Object.create(null);
const DEFAULT_PROVIDER_BY_ROLE = constants.DEFAULT_PROVIDER_BY_ROLE || Object.create(null);
const CONSTANT_HELPERS = constants.helpers || Object.create(null);
const protocolHelpers = protocol.helpers || Object.create(null);

const TEMPLATE_IDS = PROMPT.TEMPLATE_IDS || Object.create(null);
const TEMPLATE_ID = typeof TEMPLATE_IDS.AUDITOR === 'string' && TEMPLATE_IDS.AUDITOR
? TEMPLATE_IDS.AUDITOR
: 'auditor_prompt_v1';
const TEMPLATE_VERSION = typeof APP.protocolVersion === 'string' && APP.protocolVersion
? APP.protocolVersion
: '1.0.0';

const OUTPUT_CONTRACT_DEFAULTS = isPlainObject(PROMPT.OUTPUT_CONTRACTS)
&& isPlainObject(PROMPT.OUTPUT_CONTRACTS.AUDITOR)
? PROMPT.OUTPUT_CONTRACTS.AUDITOR
: Object.create(null);
const PLACEHOLDERS = isPlainObject(PROMPT.PLACEHOLDERS)
? PROMPT.PLACEHOLDERS
: Object.create(null);
const REQUIRED_SECTIONS = Array.isArray(PROMPT.REQUIRED_SECTIONS && PROMPT.REQUIRED_SECTIONS.AUDITOR)
? PROMPT.REQUIRED_SECTIONS.AUDITOR.slice()
: ['issue', 'diff', 'acceptance_criteria', 'verdict_contract'];

const REVIEW_ROOT_TAG = typeof PARSER_XML.REVIEW_ROOT_TAG === 'string' && PARSER_XML.REVIEW_ROOT_TAG
? PARSER_XML.REVIEW_ROOT_TAG
: 'Review';
const REVIEW_VERDICTS = Array.isArray(PARSER.REVIEW_VERDICTS)
? PARSER.REVIEW_VERDICTS.slice()
: ['APPROVE', 'REJECT'];
const CDATA_CLOSE = ']]' + '>';
const DEFAULT_PROVIDER_ID = typeof DEFAULT_PROVIDER_BY_ROLE.auditor === 'string'
? DEFAULT_PROVIDER_BY_ROLE.auditor
: '';
const DEFAULT_PROVIDER = DEFAULT_PROVIDER_ID && PROVIDERS[DEFAULT_PROVIDER_ID]
? PROVIDERS[DEFAULT_PROVIDER_ID]
: null;
const DEFAULT_PROVIDER_LABEL = DEFAULT_PROVIDER && DEFAULT_PROVIDER.displayName
? DEFAULT_PROVIDER.displayName
: 'Auditor AI';

const SECTION_IDS = deepFreeze({
ROLE: 'role',
ISSUE: 'issue',
DIFF: 'diff',
ACCEPTANCE_CRITERIA: 'acceptance_criteria',
VERDICT_CONTRACT: 'verdict_contract',
SELF_CHECK: 'self_check'
});

const LOCAL_PLACEHOLDERS = deepFreeze({
PROVIDER_NAME: '{{PROVIDER_NAME}}',
TEMPLATE_ID: '{{TEMPLATE_ID}}',
REPOSITORY_NAME: '{{REPOSITORY_NAME}}',
ISSUE_HEADER: '{{ISSUE_HEADER}}',
ROLE_DIRECTIVE: '{{ROLE_DIRECTIVE}}',
ISSUE_SECTION: '{{ISSUE_SECTION}}',
DIFF_SECTION: '{{DIFF_SECTION}}',
ACCEPTANCE_CRITERIA_SECTION: '{{ACCEPTANCE_CRITERIA_SECTION}}',
VERDICT_CONTRACT_SECTION: '{{VERDICT_CONTRACT_SECTION}}',
SELF_CHECK_SECTION: '{{SELF_CHECK_SECTION}}'
});

const DEFAULT_TEMPLATE = [
LOCAL_PLACEHOLDERS.ROLE_DIRECTIVE,
'',
'## issue',
LOCAL_PLACEHOLDERS.ISSUE_SECTION,
'',
'## diff',
LOCAL_PLACEHOLDERS.DIFF_SECTION,
'',
'## acceptance_criteria',
LOCAL_PLACEHOLDERS.ACCEPTANCE_CRITERIA_SECTION,
'',
'## verdict_contract',
LOCAL_PLACEHOLDERS.VERDICT_CONTRACT_SECTION,
'',
'## self_check',
LOCAL_PLACEHOLDERS.SELF_CHECK_SECTION
].join('\n');

const DEFAULT_LIMITS = deepFreeze({
diff: 60000,
issueBody: 16000,
criteria: 12000,
reviewFocus: 4000
});

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

function coerceBlockText(value) {
if (typeof value === 'string') {
return value;
}

if (value === null || typeof value === 'undefined') {
  return '';
}

if (Array.isArray(value)) {
  return value.map(function mapEntry(entry) {
    return typeof entry === 'string' ? entry : String(entry == null ? '' : entry);
  }).join('\n');
}

if (isPlainObject(value)) {
  if (typeof value.text === 'string') {
    return value.text;
  }

  if (typeof value.diff === 'string') {
    return value.diff;
  }

  if (typeof value.patch === 'string') {
    return value.patch;
  }
}

return String(value);

}

function normalizeMultilineText(value) {
const source = coerceBlockText(value)
.replace(/\r\n/g, '\n')
.replace(/\r/g, '\n');

return source.trim();

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

function normalizeOptionalMaxChars(value, fallbackValue) {
if (value === null || typeof value === 'undefined' || value === '') {
return Number.isFinite(Number(fallbackValue)) ? Math.max(1, Math.trunc(Number(fallbackValue))) : null;
}

const numberValue = Number(value);

if (!Number.isFinite(numberValue)) {
  return Number.isFinite(Number(fallbackValue)) ? Math.max(1, Math.trunc(Number(fallbackValue))) : null;
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

function normalizeStringArray(value) {
let source = [];

if (typeof value === 'string') {
  source = value.split(/\r?\n/);
} else if (Array.isArray(value)) {
  source = value.slice();
} else {
  return [];
}

const result = [];
const seen = new Set();

for (const entry of source) {
  const normalized = normalizeString(entry);

  if (!normalized || seen.has(normalized)) {
    continue;
  }

  seen.add(normalized);
  result.push(normalized);
}

return result;

}

function stripListPrefix(text) {
return normalizeString(text).replace(/^(?:[-*•]+\s+|\d+[.)]\s+)/, '').trim();
}

function normalizeCriteriaInput(value) {
let source = [];

if (typeof value === 'string') {
  source = value.split(/\r?\n+/);
} else if (Array.isArray(value)) {
  source = value.slice();
} else if (isPlainObject(value) && Array.isArray(value.criteria)) {
  source = value.criteria.slice();
} else if (isPlainObject(value) && typeof value.text === 'string') {
  source = value.text.split(/\r?\n+/);
}

const result = [];
const seen = new Set();

for (const entry of source) {
  let normalized = '';

  if (typeof entry === 'string') {
    normalized = stripListPrefix(entry);
  } else if (isPlainObject(entry)) {
    normalized = stripListPrefix(entry.text || entry.message || entry.criterion || '');
  } else if (entry !== null && typeof entry !== 'undefined') {
    normalized = stripListPrefix(String(entry));
  }

  if (!normalized || seen.has(normalized)) {
    continue;
  }

  seen.add(normalized);
  result.push(normalized);
}

return result;

}

function mergeCriteriaLists() {
const result = [];
const seen = new Set();

for (let argumentIndex = 0; argumentIndex < arguments.length; argumentIndex += 1) {
  const source = Array.isArray(arguments[argumentIndex]) ? arguments[argumentIndex] : [];

  for (const entry of source) {
    const normalized = stripListPrefix(entry);

    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    result.push(normalized);
  }
}

return result;

}

function truncateMiddle(text, maxChars, label) {
const source = coerceBlockText(text);
const normalizedMax = normalizeOptionalMaxChars(maxChars, null);

if (normalizedMax === null || source.length <= normalizedMax) {
  return {
    text: source,
    truncated: false,
    originalLength: source.length,
    displayLength: source.length,
    maxChars: normalizedMax,
    label: normalizeString(label)
  };
}

const descriptor = normalizeString(label) || 'section';
const marker = '\n[TRUNCATED ' + descriptor.toUpperCase() + ': kept head/tail of ' + String(normalizedMax) + ' / ' + String(source.length) + ' chars]\n';

if (normalizedMax <= marker.length + 16) {
  const shortText = source.slice(0, normalizedMax);

  return {
    text: shortText,
    truncated: true,
    originalLength: source.length,
    displayLength: shortText.length,
    maxChars: normalizedMax,
    label: descriptor
  };
}

const available = normalizedMax - marker.length;
const headLength = Math.max(8, Math.ceil(available * 0.65));
const tailLength = Math.max(8, available - headLength);
const truncatedText = source.slice(0, headLength) + marker + source.slice(source.length - tailLength);

return {
  text: truncatedText,
  truncated: true,
  originalLength: source.length,
  displayLength: truncatedText.length,
  maxChars: normalizedMax,
  label: descriptor
};

}

function chooseFenceMarker(text) {
const source = coerceBlockText(text);
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
const body = coerceBlockText(text);
const marker = chooseFenceMarker(body);
const normalizedLanguage = normalizeString(language);
const header = normalizedLanguage ? marker + normalizedLanguage : marker;
return header + '\n' + body + '\n' + marker;
}

function buildIndentedList(items) {
const source = Array.isArray(items) ? items : [];
const lines = [];

for (let index = 0; index < source.length; index += 1) {
  lines.push(String(index + 1) + '. ' + source[index]);
}

return lines.join('\n');

}

function findProviderById(providerId) {
const normalized = normalizeString(providerId).toLowerCase();

if (!normalized) {
  return null;
}

if (isPlainObject(CONSTANT_HELPERS) && typeof CONSTANT_HELPERS.getProviderById === 'function') {
  const provider = CONSTANT_HELPERS.getProviderById(normalized);
  return provider || null;
}

return hasOwn(PROVIDERS, normalized) ? PROVIDERS[normalized] : null;

}

function normalizeProviderId(value) {
const normalized = normalizeString(value).toLowerCase();

if (!normalized) {
  return DEFAULT_PROVIDER_ID;
}

return hasOwn(PROVIDERS, normalized) ? normalized : DEFAULT_PROVIDER_ID;

}

function normalizeProviderLabel(providerId) {
const provider = findProviderById(providerId);
return provider && normalizeString(provider.displayName)
? normalizeString(provider.displayName)
: DEFAULT_PROVIDER_LABEL;
}

function formatRepositoryName(repository) {
const source = isPlainObject(repository) ? repository : createNullObject();
const owner = normalizeString(source.owner);
const repo = normalizeString(source.repo);

if (owner && repo) {
  return owner + '/' + repo;
}

if (repo) {
  return repo;
}

return '(repository unspecified)';

}

function formatIssueHeader(issue) {
const source = isPlainObject(issue) ? issue : createNullObject();
const title = normalizeString(source.title) || '(untitled issue)';
const number = source.number === null || typeof source.number === 'undefined' || source.number === ''
? '#?'
: '#' + String(source.number);

return number + ' ' + title;

}

function nowIsoString() {
return new Date().toISOString();
}

function createDefaultCriteria(input) {
const source = isPlainObject(input) ? input : createNullObject();
const targetFile = normalizeString(source.targetFile);
const lines = [];

lines.push('diff が Issue の要求と意図を満たしている。');

if (targetFile) {
  lines.push('変更は主として `' + targetFile + '` 周辺の責務に沿っており、不必要な逸脱がない。');
} else {
  lines.push('変更範囲は必要十分であり、不要な副作用を導入していない。');
}

lines.push('既存の公開契約、メッセージ形式、状態遷移、ストレージキー、モジュール登録パターンを壊していない。');
lines.push('構文エラー、未実装プレースホルダー、TODO/FIXME、明白な未定義参照を残していない。');
lines.push('重要な欠陥が1つでもあれば REJECT、なければ APPROVE と判定する。');

return lines;

}

function createValidationIssue(field, code, message, details) {
return deepFreeze({
field: normalizeString(field),
code: normalizeString(code) || 'INVALID_ARGUMENT',
message: normalizeString(message) || 'Validation issue.',
details: isPlainObject(details) ? cloneValue(details) : createNullObject()
});
}

function normalizeOutputContract(outputContract) {
const source = isPlainObject(outputContract) ? outputContract : createNullObject();
const verdictValues = Array.isArray(source.verdictValues)
? normalizeStringArray(source.verdictValues).map(function mapVerdict(entry) {
return entry.toUpperCase();
})
: REVIEW_VERDICTS.slice();

return deepFreeze({
  kind: 'audit',
  format: normalizeString(source.format) || normalizeString(OUTPUT_CONTRACT_DEFAULTS.format) || 'xml_review',
  fenceLanguage: (normalizeString(source.fenceLanguage) || normalizeString(OUTPUT_CONTRACT_DEFAULTS.fenceLanguage) || 'xml').toLowerCase(),
  xmlRootTag: normalizeString(source.xmlRootTag) || normalizeString(OUTPUT_CONTRACT_DEFAULTS.xmlRootTag) || REVIEW_ROOT_TAG,
  verdictValues: verdictValues.length > 0 ? verdictValues : REVIEW_VERDICTS.slice(),
  summaryRequired: true,
  findingsAllowed: true
});

}

function normalizeContext(context, options) {
const source = isPlainObject(context) ? cloneValue(context) : createNullObject();
const config = isPlainObject(options) ? cloneValue(options) : createNullObject();

const providerId = normalizeProviderId(
  source.providerId || config.providerId || DEFAULT_PROVIDER_ID
);
const providerLabel = normalizeProviderLabel(providerId);
const repository = isPlainObject(source.repository) ? source.repository : createNullObject();
const issue = isPlainObject(source.issue) ? source.issue : createNullObject();
const targetFile = normalizeString(
  source.targetFile
  || source.filePath
  || source.path
  || source.currentTaskFilePath
  || config.targetFile
);
const diff = coerceBlockText(
  hasOwn(source, 'diff')
    ? source.diff
    : (hasOwn(source, 'patchDiff')
      ? source.patchDiff
      : (hasOwn(source, 'patch')
        ? source.patch
        : (hasOwn(source, 'unifiedDiff') ? source.unifiedDiff : '')))
);
const reviewFocus = normalizeMultilineText(
  source.reviewFocus
  || source.instructions
  || source.goal
  || source.extraReviewFocus
  || config.reviewFocus
);
const issueBody = normalizeMultilineText(
  hasOwn(issue, 'body') ? issue.body : ''
);
const criteriaInput = mergeCriteriaLists(
  normalizeCriteriaInput(source.criteria),
  normalizeCriteriaInput(source.acceptanceCriteria),
  normalizeCriteriaInput(source.auditCriteria),
  normalizeCriteriaInput(source.reviewCriteria),
  normalizeCriteriaInput(config.criteria)
);
const defaultCriteria = createDefaultCriteria({
  targetFile: targetFile,
  issue: issue,
  repository: repository,
  reviewFocus: reviewFocus
});
const mergedCriteria = mergeCriteriaLists(defaultCriteria, criteriaInput);
const outputContract = normalizeOutputContract(source.outputContract);
const instructionPayload = protocol.createAuditorInstruction({
  repository: repository,
  issue: issue,
  targetFile: targetFile,
  diff: diff,
  criteria: mergedCriteria,
  outputContract: outputContract
});
const workflowDefaults = isPlainObject(DEFAULTS.workflow) ? DEFAULTS.workflow : createNullObject();
const selectedProviderIds = isPlainObject(workflowDefaults.selectedProviderIds)
  ? workflowDefaults.selectedProviderIds
  : createNullObject();
const effectiveProviderId = providerId || normalizeProviderId(selectedProviderIds.auditor || DEFAULT_PROVIDER_ID);

return deepFreeze({
  templateId: TEMPLATE_ID,
  templateVersion: TEMPLATE_VERSION,
  protocolVersion: normalizeString(APP.protocolVersion) || TEMPLATE_VERSION,
  providerId: effectiveProviderId,
  providerLabel: providerLabel,
  repository: instructionPayload.repository,
  issue: instructionPayload.issue,
  targetFile: instructionPayload.targetFile,
  diff: instructionPayload.diff,
  criteria: instructionPayload.criteria,
  reviewFocus: reviewFocus,
  issueBody: issueBody,
  outputContract: instructionPayload.outputContract,
  locale: normalizeString(source.locale || config.locale) || 'ja',
  includeIssueBody: normalizeBoolean(config.includeIssueBody, true),
  includeReviewFocus: normalizeBoolean(config.includeReviewFocus, true),
  maxDiffChars: normalizeOptionalMaxChars(config.maxDiffChars, DEFAULT_LIMITS.diff),
  maxIssueBodyChars: normalizeOptionalMaxChars(config.maxIssueBodyChars, DEFAULT_LIMITS.issueBody),
  maxCriteriaChars: normalizeOptionalMaxChars(config.maxCriteriaChars, DEFAULT_LIMITS.criteria),
  maxReviewFocusChars: normalizeOptionalMaxChars(config.maxReviewFocusChars, DEFAULT_LIMITS.reviewFocus),
  metadata: isPlainObject(source.metadata) ? cloneValue(source.metadata) : createNullObject()
});

}

function validateContext(context, options) {
const normalized = normalizeContext(context, options);
const errors = [];
const warnings = [];

if (!coerceBlockText(normalized.diff)) {
  errors.push(createValidationIssue(
    'diff',
    'INVALID_ARGUMENT',
    'diff is required for the auditor prompt.',
    createNullObject()
  ));
}

if (!Array.isArray(normalized.criteria) || normalized.criteria.length === 0) {
  errors.push(createValidationIssue(
    'criteria',
    'INVALID_ARGUMENT',
    'at least one acceptance criterion is required for the auditor prompt.',
    createNullObject()
  ));
}

if (!normalizeString(normalized.issue.title)) {
  warnings.push(createValidationIssue(
    'issue.title',
    'MISSING_CONTEXT',
    'issue.title is empty. The audit will rely more heavily on the diff and criteria.',
    createNullObject()
  ));
}

if (normalized.issue.number === null || typeof normalized.issue.number === 'undefined') {
  warnings.push(createValidationIssue(
    'issue.number',
    'MISSING_CONTEXT',
    'issue.number is not set. The prompt will display #?.',
    createNullObject()
  ));
}

if (!normalizeString(normalized.repository.owner) || !normalizeString(normalized.repository.repo)) {
  warnings.push(createValidationIssue(
    'repository',
    'MISSING_CONTEXT',
    'repository owner/repo is incomplete. The prompt remains usable but less grounded.',
    {
      repository: cloneValue(normalized.repository)
    }
  ));
}

if (!normalizeString(normalized.targetFile)) {
  warnings.push(createValidationIssue(
    'targetFile',
    'MISSING_CONTEXT',
    'targetFile is empty. The audit will evaluate the diff as a broader patch.',
    createNullObject()
  ));
}

if (!normalizeString(normalized.issueBody)) {
  warnings.push(createValidationIssue(
    'issue.body',
    'MISSING_CONTEXT',
    'issue.body is empty. The audit will infer intent from the title and criteria.',
    createNullObject()
  ));
}

return deepFreeze({
  valid: errors.length === 0,
  normalized: normalized,
  errors: errors,
  warnings: warnings
});

}

function createSection(id, title, content, required, meta) {
return deepFreeze({
id: normalizeString(id),
title: normalizeString(title),
content: coerceBlockText(content),
required: required === true,
meta: isPlainObject(meta) ? cloneValue(meta) : createNullObject()
});
}

function buildRoleDirective(normalized) {
const lines = [];
lines.push('あなたは ' + normalized.providerLabel + ' 上で動く監査担当AIである。');
lines.push('入力として与えられる Issue と diff を照合し、修正が受け入れ可能なら APPROVE、重大または実質的な問題があれば REJECT を返せ。');
lines.push('安易に APPROVE するな。疑義が残る場合は REJECT を選び、具体的な根拠を示せ。');
lines.push('返答は Review XML を含む xml fenced block 1個だけに限定し、外側に説明文を書かない。');
return lines.join('\n');
}

function buildIssueSection(normalized) {
const issueBodyBlock = truncateMiddle(
normalized.issueBody,
normalized.maxIssueBodyChars,
'issue_body'
);
const reviewFocusBlock = truncateMiddle(
normalized.reviewFocus,
normalized.maxReviewFocusChars,
'review_focus'
);
const lines = [];

lines.push('repository: ' + formatRepositoryName(normalized.repository));
lines.push('issue: ' + formatIssueHeader(normalized.issue));
lines.push('target_file: ' + (normalizeString(normalized.targetFile) || '(unspecified)'));
lines.push('protocol_version: ' + normalized.protocolVersion);
lines.push('template_id: ' + normalized.templateId);

if (normalized.includeIssueBody && normalizeString(normalized.issueBody)) {
  lines.push('');
  lines.push('issue_body_reference:');
  lines.push(buildFencedBlock('text', issueBodyBlock.text));
}

if (normalized.includeReviewFocus && normalizeString(normalized.reviewFocus)) {
  lines.push('');
  lines.push('extra_review_focus:');
  lines.push(buildFencedBlock('text', reviewFocusBlock.text));
}

return createSection(
  SECTION_IDS.ISSUE,
  'issue',
  lines.join('\n'),
  true,
  {
    issueBodyLength: issueBodyBlock.originalLength,
    issueBodyTruncated: issueBodyBlock.truncated,
    reviewFocusLength: reviewFocusBlock.originalLength,
    reviewFocusTruncated: reviewFocusBlock.truncated
  }
);

}

function buildDiffSection(normalized) {
const diffBlock = truncateMiddle(
normalized.diff,
normalized.maxDiffChars,
'diff'
);
const lines = [];

if (!coerceBlockText(normalized.diff)) {
  lines.push('Diff was not provided. This prompt context is invalid until a unified diff is supplied.');
} else {
  lines.push('以下の unified diff を監査せよ。説明ではなく、差分と Issue の整合性を判定する。');
  lines.push(buildFencedBlock('diff', diffBlock.text));
}

return createSection(
  SECTION_IDS.DIFF,
  'diff',
  lines.join('\n'),
  true,
  {
    originalLength: diffBlock.originalLength,
    truncated: diffBlock.truncated
  }
);

}

function buildAcceptanceCriteriaItems(normalized) {
const items = [];

for (const entry of normalized.criteria) {
  items.push(entry);
}

if (normalizeString(normalized.reviewFocus)) {
  items.push('追加監査観点 `' + normalizeString(normalized.reviewFocus).replace(/\s+/g, ' ').slice(0, 180) + '` を考慮して判定する。');
}

return items;

}

function buildAcceptanceCriteriaSection(normalized) {
const criteriaBlock = truncateMiddle(
buildIndentedList(buildAcceptanceCriteriaItems(normalized)),
normalized.maxCriteriaChars,
'acceptance_criteria'
);

return createSection(
  SECTION_IDS.ACCEPTANCE_CRITERIA,
  'acceptance_criteria',
  criteriaBlock.text,
  true,
  {
    criteriaCount: buildAcceptanceCriteriaItems(normalized).length,
    originalLength: criteriaBlock.originalLength,
    truncated: criteriaBlock.truncated
  }
);

}

function buildVerdictApproveExample() {
return [
'<' + REVIEW_ROOT_TAG + ' verdict="APPROVE">',
'  <![CDATA[Issue requirements are satisfied and no material defects were found in the diff.' + CDATA_CLOSE + '',
'</' + REVIEW_ROOT_TAG + '>'
].join('\n');
}

function buildVerdictRejectExample(targetFile) {
const normalizedTargetFile = normalizeString(targetFile) || 'src/example.js';

return [
  '<' + REVIEW_ROOT_TAG + ' verdict="REJECT">',
  '  <Summary><![CDATA[The diff does not yet satisfy the issue safely.' + CDATA_CLOSE + '</Summary>',
  '  <Findings>',
  '    <Finding severity="high" target="' + normalizedTargetFile + '"><![CDATA[Concrete reason for rejection.' + CDATA_CLOSE + '</Finding>',
  '  </Findings>',
  '</' + REVIEW_ROOT_TAG + '>'
].join('\n');

}

function buildVerdictContractSection(normalized) {
const items = [
'返答は xml fenced block を1個だけ返す。外側に説明文を書かない。',
'XML ルート要素は <'+ REVIEW_ROOT_TAG + ' verdict="APPROVE|REJECT"> に固定する。verdict 値は大文字の APPROVE または REJECT だけ。',
'<Summary> は必須。簡潔だが具体的に、判定根拠を1〜3文で書く。',
'重大または実質的な問題がある場合は REJECT を返し、<Findings> 内に <Finding severity="high|medium|low" target="..."> を追加する。',
'問題がなければ APPROVE を返す。迷う場合は REJECT を優先する。',
'レビュー本文は Issue と diff に基づく事実だけを書く。挨拶、前置き、余談、複数フェンスを禁止する。'
];
const lines = [];

lines.push(buildIndentedList(items));
lines.push('');
lines.push('approve_example:');
lines.push(buildFencedBlock('xml', buildVerdictApproveExample()));
lines.push('');
lines.push('reject_example:');
lines.push(buildFencedBlock('xml', buildVerdictRejectExample(normalized.targetFile)));

return createSection(
  SECTION_IDS.VERDICT_CONTRACT,
  'verdict_contract',
  lines.join('\n'),
  true,
  {
    rootTag: REVIEW_ROOT_TAG,
    verdictValues: REVIEW_VERDICTS.slice()
  }
);

}

function buildSelfCheckSection(normalized) {
const items = [
'Issue と diff を照合したうえで判定している。',
'判定は APPROVE か REJECT のどちらか一方である。',
'<Summary> は具体的であり、曖昧な一般論で終わっていない。',
'REJECT の場合、各 Finding は具体的な問題と対象を示している。',
'返答は単一の xml fenced block だけである。'
];

if (normalizeString(normalized.targetFile)) {
  items.push('対象ファイル `' + normalized.targetFile + '` に関する問題は target 属性で明示している。');
}

return createSection(
  SECTION_IDS.SELF_CHECK,
  'self_check',
  buildIndentedList(items),
  false,
  {
    itemCount: items.length
  }
);

}

function buildSections(context, options) {
const normalized = normalizeContext(context, options);
const sections = [
createSection(SECTION_IDS.ROLE, 'role', buildRoleDirective(normalized), false, createNullObject()),
buildIssueSection(normalized),
buildDiffSection(normalized),
buildAcceptanceCriteriaSection(normalized),
buildVerdictContractSection(normalized),
buildSelfCheckSection(normalized)
];

return deepFreeze(sections);

}

function getSectionMap(sections) {
const source = Array.isArray(sections) ? sections : [];
const map = createNullObject();

for (const section of source) {
  map[section.id] = section;
}

return map;

}

function getPlaceholderMap(context, options) {
const normalized = normalizeContext(context, options);
const sections = buildSections(normalized, options);
const sectionMap = getSectionMap(sections);
const output = createNullObject();

output[LOCAL_PLACEHOLDERS.PROVIDER_NAME] = normalized.providerLabel;
output[LOCAL_PLACEHOLDERS.TEMPLATE_ID] = normalized.templateId;
output[LOCAL_PLACEHOLDERS.REPOSITORY_NAME] = formatRepositoryName(normalized.repository);
output[LOCAL_PLACEHOLDERS.ISSUE_HEADER] = formatIssueHeader(normalized.issue);
output[LOCAL_PLACEHOLDERS.ROLE_DIRECTIVE] = sectionMap[SECTION_IDS.ROLE].content;
output[LOCAL_PLACEHOLDERS.ISSUE_SECTION] = sectionMap[SECTION_IDS.ISSUE].content;
output[LOCAL_PLACEHOLDERS.DIFF_SECTION] = sectionMap[SECTION_IDS.DIFF].content;
output[LOCAL_PLACEHOLDERS.ACCEPTANCE_CRITERIA_SECTION] = sectionMap[SECTION_IDS.ACCEPTANCE_CRITERIA].content;
output[LOCAL_PLACEHOLDERS.VERDICT_CONTRACT_SECTION] = sectionMap[SECTION_IDS.VERDICT_CONTRACT].content;
output[LOCAL_PLACEHOLDERS.SELF_CHECK_SECTION] = sectionMap[SECTION_IDS.SELF_CHECK].content;

if (typeof PLACEHOLDERS.ISSUE_TITLE === 'string') {
  output[PLACEHOLDERS.ISSUE_TITLE] = normalizeString(normalized.issue.title);
}

if (typeof PLACEHOLDERS.ISSUE_BODY === 'string') {
  output[PLACEHOLDERS.ISSUE_BODY] = normalizeString(normalized.issue.body);
}

if (typeof PLACEHOLDERS.ISSUE_NUMBER === 'string') {
  output[PLACEHOLDERS.ISSUE_NUMBER] = normalized.issue.number === null || typeof normalized.issue.number === 'undefined'
    ? ''
    : String(normalized.issue.number);
}

if (typeof PLACEHOLDERS.TARGET_FILE === 'string') {
  output[PLACEHOLDERS.TARGET_FILE] = normalized.targetFile;
}

if (typeof PLACEHOLDERS.PATCH_DIFF === 'string') {
  output[PLACEHOLDERS.PATCH_DIFF] = coerceBlockText(normalized.diff);
}

if (typeof PLACEHOLDERS.AUDIT_CRITERIA === 'string') {
  output[PLACEHOLDERS.AUDIT_CRITERIA] = buildIndentedList(normalized.criteria);
}

if (typeof PLACEHOLDERS.OUTPUT_CONTRACT === 'string') {
  output[PLACEHOLDERS.OUTPUT_CONTRACT] = sectionMap[SECTION_IDS.VERDICT_CONTRACT].content;
}

return deepFreeze(output);

}

function fillTemplate(template, placeholders) {
let output = coerceBlockText(template || DEFAULT_TEMPLATE);
const values = isPlainObject(placeholders) ? placeholders : createNullObject();

for (const key of Object.keys(values)) {
  const replacement = coerceBlockText(values[key]);
  output = output.split(key).join(replacement);
}

return output;

}

function createDefaultSourceEndpoint() {
return {
type: 'extension',
id: normalizeString(APP.id) || 'maoe',
label: normalizeString(APP.name) || 'Multi-Agent Orchestrator Extension',
role: '',
providerId: '',
siteId: '',
tabId: null,
url: ''
};
}

function createDefaultTargetEndpoint(normalized) {
return {
type: 'ai',
id: normalized.providerId || 'auditor',
label: normalized.providerLabel || DEFAULT_PROVIDER_LABEL,
role: normalizeString(WORKFLOW.ROLES && WORKFLOW.ROLES.AUDITOR ? WORKFLOW.ROLES.AUDITOR : 'auditor'),
providerId: normalized.providerId || '',
siteId: '',
tabId: null,
url: ''
};
}

function buildManualHubPacket(context, options) {
const validation = validateContext(context, options);

if (!validation.valid) {
  throw new Error('Auditor prompt context is invalid.');
}

const normalized = validation.normalized;
const config = isPlainObject(options) ? options : createNullObject();
const packet = protocol.createAuditRequestPacket({
  repository: normalized.repository,
  issue: normalized.issue,
  diff: normalized.diff,
  criteria: normalized.criteria,
  targetFile: normalized.targetFile,
  metadata: Object.assign(createNullObject(), normalized.metadata, {
    templateId: normalized.templateId,
    templateVersion: normalized.templateVersion,
    providerId: normalized.providerId,
    providerLabel: normalized.providerLabel,
    promptKind: 'auditor'
  })
}, {
  requestId: normalizeString(config.requestId) || (protocolHelpers.generateRequestId
    ? protocolHelpers.generateRequestId('auditor')
    : ('auditor_' + Date.now().toString(36))),
  source: isPlainObject(config.source) ? config.source : createDefaultSourceEndpoint(),
  target: isPlainObject(config.target) ? config.target : createDefaultTargetEndpoint(normalized),
  meta: isPlainObject(config.meta) ? cloneValue(config.meta) : createNullObject()
});

return deepFreeze(packet);

}

function buildManualHubPacketText(context, options) {
const config = isPlainObject(options) ? cloneValue(options) : createNullObject();
const packet = isPlainObject(config.packet) ? config.packet : buildManualHubPacket(context, config);

return protocol.buildPacketEnvelopeText(packet, {
  beginDelimiter: normalizeString(config.beginDelimiter),
  endDelimiter: normalizeString(config.endDelimiter),
  fenceLanguage: normalizeString(config.fenceLanguage) || 'json',
  space: Number.isFinite(Number(config.space)) ? Math.max(0, Math.trunc(Number(config.space))) : 2
});

}

function buildAuditBrief(context, options) {
const normalized = normalizeContext(context, options);
const lines = [];

lines.push('provider: ' + normalized.providerLabel);
lines.push('repository: ' + formatRepositoryName(normalized.repository));
lines.push('issue: ' + formatIssueHeader(normalized.issue));
lines.push('target_file: ' + (normalizeString(normalized.targetFile) || '(unspecified)'));
lines.push('template_id: ' + normalized.templateId);

return lines.join('\n');

}

function buildPromptMetadata(normalized, validation, sections, promptText, packet) {
const sectionList = Array.isArray(sections) ? sections : [];

return deepFreeze({
  createdAt: nowIsoString(),
  templateId: normalized.templateId,
  templateVersion: normalized.templateVersion,
  protocolVersion: normalized.protocolVersion,
  providerId: normalized.providerId,
  providerLabel: normalized.providerLabel,
  repository: cloneValue(normalized.repository),
  issueNumber: normalized.issue.number,
  issueTitle: normalizeString(normalized.issue.title),
  targetFile: normalized.targetFile,
  requiredSections: REQUIRED_SECTIONS.slice(),
  sectionCount: sectionList.length,
  promptLength: coerceBlockText(promptText).length,
  errorCount: Array.isArray(validation.errors) ? validation.errors.length : 0,
  warningCount: Array.isArray(validation.warnings) ? validation.warnings.length : 0,
  hasIssueBody: normalizeString(normalized.issueBody) !== '',
  hasReviewFocus: normalizeString(normalized.reviewFocus) !== '',
  criteriaCount: Array.isArray(normalized.criteria) ? normalized.criteria.length : 0,
  packetRequestId: packet && normalizeString(packet.requestId) ? normalizeString(packet.requestId) : ''
});

}

function createPrompt(context, options) {
const config = isPlainObject(options) ? cloneValue(options) : createNullObject();
const validation = validateContext(context, config);
const normalized = validation.normalized;
const sections = buildSections(normalized, config);
const placeholderMap = getPlaceholderMap(normalized, config);
const template = normalizeString(config.template) ? coerceBlockText(config.template) : DEFAULT_TEMPLATE;
const text = validation.valid
? fillTemplate(template, placeholderMap).trim()
: '';
const includePacket = normalizeBoolean(config.includeManualHubPacket, false);
let packet = null;
let packetText = '';

if (includePacket && validation.valid) {
  try {
    packet = buildManualHubPacket(normalized, config);
    packetText = buildManualHubPacketText(normalized, Object.assign(createNullObject(), config, {
      packet: packet
    }));
  } catch (error) {
    logger.warn('Failed to build auditor manual hub packet.', {
      message: error && error.message ? error.message : String(error)
    });
  }
}

return deepFreeze({
  valid: validation.valid,
  templateId: normalized.templateId,
  templateVersion: normalized.templateVersion,
  normalized: normalized,
  sections: sections,
  placeholders: placeholderMap,
  text: text,
  packet: packet,
  packetText: packetText,
  errors: validation.errors,
  warnings: validation.warnings,
  metadata: buildPromptMetadata(normalized, validation, sections, text, packet)
});

}

function buildPrompt(context, options) {
const prompt = createPrompt(context, options);
const config = isPlainObject(options) ? options : createNullObject();

if (!prompt.valid && normalizeBoolean(config.throwOnInvalid, true)) {
  const firstError = prompt.errors.length > 0
    ? prompt.errors[0]
    : createValidationIssue('context', 'INVALID_ARGUMENT', 'Auditor prompt context is invalid.', createNullObject());
  const error = new Error(firstError.message);
  error.name = 'MAOEAuditorPromptError';
  error.code = firstError.code;
  error.details = cloneValue(firstError.details);
  throw error;
}

return prompt.text;

}

const api = {
templateId: TEMPLATE_ID,
templateVersion: TEMPLATE_VERSION,
requiredSections: deepFreeze(REQUIRED_SECTIONS.slice()),
defaultTemplate: DEFAULT_TEMPLATE,
defaults: deepFreeze({
providerId: DEFAULT_PROVIDER_ID,
providerLabel: DEFAULT_PROVIDER_LABEL,
verdictValues: REVIEW_VERDICTS.slice(),
limits: cloneValue(DEFAULT_LIMITS)
}),
normalizeContext: normalizeContext,
validateContext: validateContext,
buildSections: buildSections,
getPlaceholderMap: getPlaceholderMap,
fillTemplate: fillTemplate,
createPrompt: createPrompt,
buildPrompt: buildPrompt,
render: buildPrompt,
buildManualHubPacket: buildManualHubPacket,
buildManualHubPacketText: buildManualHubPacketText,
buildAuditBrief: buildAuditBrief,
helpers: deepFreeze({
truncateMiddle: truncateMiddle,
buildFencedBlock: buildFencedBlock,
formatRepositoryName: formatRepositoryName,
formatIssueHeader: formatIssueHeader,
normalizeProviderId: normalizeProviderId,
normalizeProviderLabel: normalizeProviderLabel,
normalizeOutputContract: normalizeOutputContract,
normalizeCriteriaInput: normalizeCriteriaInput,
createDefaultCriteria: createDefaultCriteria,
buildVerdictApproveExample: buildVerdictApproveExample,
buildVerdictRejectExample: buildVerdictRejectExample,
createValidationIssue: createValidationIssue,
localPlaceholders: cloneValue(LOCAL_PLACEHOLDERS)
})
};

try {
logger.debug('Auditor prompt module registered.', {
templateId: TEMPLATE_ID,
templateVersion: TEMPLATE_VERSION,
requiredSections: REQUIRED_SECTIONS.slice()
});
} catch (error) {
}

root.registerValue('auditor_prompt', deepFreeze(api), {
overwrite: false,
freeze: false,
clone: false
});
}(typeof globalThis !== 'undefined'
? globalThis
: (typeof self !== 'undefined'
? self
: (typeof window !== 'undefined' ? window : this))));