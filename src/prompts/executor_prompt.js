(function registerMAOEExecutorPrompt(globalScope) {
  'use strict';

  const root = globalScope.MAOE;

  if (!root || typeof root.registerValue !== 'function') {
    throw new Error('[MAOE] namespace.js must be loaded before executor_prompt.js.');
  }

  if (root.has('executor_prompt')) {
    return;
  }

  if (!root.has('constants')) {
    throw new Error('[MAOE] constants.js must be loaded before executor_prompt.js.');
  }

  if (!root.has('protocol')) {
    throw new Error('[MAOE] protocol.js must be loaded before executor_prompt.js.');
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

  function createFallbackLogger() {
    const consoleObject = typeof console !== 'undefined' ? console : null;

    function emit(level, message, context) {
      if (!consoleObject || typeof consoleObject[level] !== 'function') {
        return;
      }

      if (typeof context === 'undefined') {
        consoleObject[level]('[MAOE/executor_prompt] ' + message);
        return;
      }

      consoleObject[level]('[MAOE/executor_prompt] ' + message, context);
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
        return loggerModule.createScope('executor_prompt');
      } catch (error) {
        // Fallback to basic check
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
  const TEMPLATE_ID = typeof TEMPLATE_IDS.EXECUTOR === 'string' && TEMPLATE_IDS.EXECUTOR
    ? TEMPLATE_IDS.EXECUTOR
    : 'executor_prompt_v1';
  const TEMPLATE_VERSION = typeof APP.protocolVersion === 'string' && APP.protocolVersion
    ? APP.protocolVersion
    : '1.0.0';

  const OUTPUT_CONTRACT_DEFAULTS = isPlainObject(PROMPT.OUTPUT_CONTRACTS)
    && isPlainObject(PROMPT.OUTPUT_CONTRACTS.EXECUTOR)
    ? PROMPT.OUTPUT_CONTRACTS.EXECUTOR
    : Object.create(null);
  const PLACEHOLDERS = isPlainObject(PROMPT.PLACEHOLDERS)
    ? PROMPT.PLACEHOLDERS
    : Object.create(null);
  const REQUIRED_SECTIONS = Array.isArray(PROMPT.REQUIRED_SECTIONS && PROMPT.REQUIRED_SECTIONS.EXECUTOR)
    ? PROMPT.REQUIRED_SECTIONS.EXECUTOR.slice()
    : ['task', 'constraints', 'repository_context', 'output_contract'];

  const FILE_ROOT_TAG = typeof PARSER_XML.FILE_ROOT_TAG === 'string' && PARSER_XML.FILE_ROOT_TAG
    ? PARSER_XML.FILE_ROOT_TAG
    : 'File';
  const FILE_PATH_ATTRIBUTE = typeof PARSER_XML.FILE_PATH_ATTRIBUTE === 'string' && PARSER_XML.FILE_PATH_ATTRIBUTE
    ? PARSER_XML.FILE_PATH_ATTRIBUTE
    : 'path';
  const FILE_CDATA_REQUIRED = PARSER_XML.CDATA_REQUIRED !== false;

  const DEFAULT_PROVIDER_ID = typeof DEFAULT_PROVIDER_BY_ROLE.executor === 'string'
    ? DEFAULT_PROVIDER_BY_ROLE.executor
    : '';
  const DEFAULT_PROVIDER = DEFAULT_PROVIDER_ID && PROVIDERS[DEFAULT_PROVIDER_ID]
    ? PROVIDERS[DEFAULT_PROVIDER_ID]
    : null;
  const DEFAULT_PROVIDER_LABEL = DEFAULT_PROVIDER && DEFAULT_PROVIDER.displayName
    ? DEFAULT_PROVIDER.displayName
    : 'Executor AI';

  const SECTION_IDS = deepFreeze({
    ROLE: 'role',
    TASK: 'task',
    CONSTRAINTS: 'constraints',
    REPOSITORY_CONTEXT: 'repository_context',
    CURRENT_CODE: 'current_code',
    OUTPUT_CONTRACT: 'output_contract',
    SELF_CHECK: 'self_check'
  });

  const LOCAL_PLACEHOLDERS = deepFreeze({
    PROVIDER_NAME: '{{PROVIDER_NAME}}',
    TEMPLATE_ID: '{{TEMPLATE_ID}}',
    REPOSITORY_NAME: '{{REPOSITORY_NAME}}',
    ISSUE_HEADER: '{{ISSUE_HEADER}}',
    ROLE_DIRECTIVE: '{{ROLE_DIRECTIVE}}',
    TASK_SECTION: '{{TASK_SECTION}}',
    CONSTRAINTS_SECTION: '{{CONSTRAINTS_SECTION}}',
    REPOSITORY_CONTEXT_SECTION: '{{REPOSITORY_CONTEXT_SECTION}}',
    CURRENT_CODE_SECTION: '{{CURRENT_CODE_SECTION}}',
    OUTPUT_CONTRACT_SECTION: '{{OUTPUT_CONTRACT_SECTION}}',
    SELF_CHECK_SECTION: '{{SELF_CHECK_SECTION}}'
  });

  const DEFAULT_TEMPLATE = [
    LOCAL_PLACEHOLDERS.ROLE_DIRECTIVE,
    '',
    '## task',
    LOCAL_PLACEHOLDERS.TASK_SECTION,
    '',
    '## constraints',
    LOCAL_PLACEHOLDERS.CONSTRAINTS_SECTION,
    '',
    '## repository_context',
    LOCAL_PLACEHOLDERS.REPOSITORY_CONTEXT_SECTION,
    '',
    '## current_code',
    LOCAL_PLACEHOLDERS.CURRENT_CODE_SECTION,
    '',
    '## output_contract',
    LOCAL_PLACEHOLDERS.OUTPUT_CONTRACT_SECTION,
    '',
    '## self_check',
    LOCAL_PLACEHOLDERS.SELF_CHECK_SECTION
  ].join('\n');

  const DEFAULT_LIMITS = deepFreeze({
    instructions: 16000,
    issueBody: 16000,
    repositoryTree: 16000,
    currentCode: 50000
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

  function normalizeMultilineText(value) {
    const source = coerceBlockText(value)
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n');

    return source.trim();
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

      if (typeof value.rawTreeText === 'string') {
        return value.rawTreeText;
      }

      if (Array.isArray(value.paths)) {
        return value.paths.map(function mapPath(entry) {
          return typeof entry === 'string' ? entry : String(entry == null ? '' : entry);
        }).join('\n');
      }
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
  function guessLanguageFromPath(path) {
    const normalizedPath = normalizeString(path).toLowerCase();

    if (!normalizedPath) {
      return 'text';
    }

    const extensionMatch = normalizedPath.match(/\.([a-z0-9]+)$/i);
    const extension = extensionMatch ? extensionMatch[1].toLowerCase() : '';

    switch (extension) {
      case 'js':
      case 'cjs':
      case 'mjs':
        return 'javascript';
      case 'ts':
        return 'typescript';
      case 'jsx':
        return 'jsx';
      case 'tsx':
        return 'tsx';
      case 'json':
        return 'json';
      case 'css':
        return 'css';
      case 'html':
      case 'htm':
        return 'html';
      case 'xml':
        return 'xml';
      case 'md':
        return 'markdown';
      case 'yaml':
      case 'yml':
        return 'yaml';
      case 'py':
        return 'python';
      case 'sh':
        return 'bash';
      case 'rb':
        return 'ruby';
      case 'go':
        return 'go';
      case 'java':
        return 'java';
      case 'kt':
        return 'kotlin';
      case 'swift':
        return 'swift';
      case 'php':
        return 'php';
      case 'rs':
        return 'rust';
      case 'sql':
        return 'sql';
      default:
        return 'text';
    }
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

  function createDefaultInstruction(issue, targetFile) {
    const issueSource = isPlainObject(issue) ? issue : createNullObject();
    const lines = [];

    if (normalizeString(targetFile)) {
      lines.push('対象ファイル `' + normalizeString(targetFile) + '` を編集し、Issue要件を満たす完成版を返せ。');
    } else {
      lines.push('Issue要件を満たす完成版を1ファイルで返せ。');
    }

    if (normalizeString(issueSource.title)) {
      lines.push('Issueタイトル: ' + normalizeString(issueSource.title));
    }

    if (normalizeString(issueSource.body)) {
      lines.push('Issue本文に含まれる要件と制約を実装に反映せよ。');
    }

    return lines.join('\n');
  }

  function normalizeOutputContract(outputContract, targetFile) {
    const source = isPlainObject(outputContract) ? outputContract : createNullObject();
    const normalizedPath = normalizeString(targetFile);

    return deepFreeze({
      kind: 'file',
      format: 'xml_file',
      fenceLanguage: 'xml',
      xmlRootTag: normalizeString(source.xmlRootTag) || normalizeString(OUTPUT_CONTRACT_DEFAULTS.xmlRootTag) || FILE_ROOT_TAG,
      pathAttribute: normalizeString(source.pathAttribute) || normalizeString(OUTPUT_CONTRACT_DEFAULTS.pathAttribute) || FILE_PATH_ATTRIBUTE,
      singleFile: true,
      cdataRequired: true,
      expectedPath: normalizedPath
    });
  }

  function createValidationIssue(field, code, message, details) {
    return deepFreeze({
      field: normalizeString(field),
      code: normalizeString(code) || 'INVALID_ARGUMENT',
      message: normalizeString(message) || 'Validation issue.',
      details: isPlainObject(details) ? cloneValue(details) : createNullObject()
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
    const instructions = normalizeMultilineText(
      source.instructions
      || source.taskInstructions
      || source.goal
      || source.issueInstruction
      || createDefaultInstruction(issue, targetFile)
    );
    const repositoryTree = normalizeMultilineText(
      hasOwn(source, 'repositoryTree')
        ? source.repositoryTree
        : (hasOwn(source, 'repositoryTreeText')
          ? source.repositoryTreeText
          : (hasOwn(source, 'repoTreeText') ? source.repoTreeText : ''))
    );
    const currentCode = coerceBlockText(
      hasOwn(source, 'currentCode')
        ? source.currentCode
        : (hasOwn(source, 'code')
          ? source.code
          : (hasOwn(source, 'fileContent') ? source.fileContent : ''))
    );
    const issueBody = normalizeMultilineText(
      hasOwn(issue, 'body') ? issue.body : ''
    );
    const outputContract = normalizeOutputContract(source.outputContract, targetFile);
    const instructionPayload = protocol.createExecutorInstruction({
      repository: repository,
      issue: issue,
      targetFile: targetFile,
      instructions: instructions,
      repositoryTree: repositoryTree,
      currentCode: currentCode,
      outputContract: outputContract
    });
    const workflowDefaults = isPlainObject(DEFAULTS.workflow) ? DEFAULTS.workflow : createNullObject();
    const selectedProviderIds = isPlainObject(workflowDefaults.selectedProviderIds)
      ? workflowDefaults.selectedProviderIds
      : createNullObject();
    const effectiveProviderId = providerId || normalizeProviderId(selectedProviderIds.executor || DEFAULT_PROVIDER_ID);
    const normalized = {
      templateId: TEMPLATE_ID,
      templateVersion: TEMPLATE_VERSION,
      protocolVersion: normalizeString(APP.protocolVersion) || TEMPLATE_VERSION,
      providerId: effectiveProviderId,
      providerLabel: providerLabel,
      repository: instructionPayload.repository,
      issue: instructionPayload.issue,
      targetFile: instructionPayload.targetFile,
      instructions: instructionPayload.instructions,
      issueBody: issueBody,
      repositoryTree: repositoryTree,
      currentCode: currentCode,
      outputContract: instructionPayload.outputContract,
      customConstraints: normalizeStringArray(source.customConstraints || config.customConstraints),
      locale: normalizeString(source.locale || config.locale) || 'ja',
      includeIssueBody: normalizeBoolean(config.includeIssueBody, true),
      includeRepositoryTree: normalizeBoolean(config.includeRepositoryTree, true),
      includeCurrentCode: normalizeBoolean(config.includeCurrentCode, true),
      maxInstructionChars: normalizeOptionalMaxChars(config.maxInstructionChars, DEFAULT_LIMITS.instructions),
      maxIssueBodyChars: normalizeOptionalMaxChars(config.maxIssueBodyChars, DEFAULT_LIMITS.issueBody),
      maxRepositoryTreeChars: normalizeOptionalMaxChars(config.maxRepositoryTreeChars, DEFAULT_LIMITS.repositoryTree),
      maxCurrentCodeChars: normalizeOptionalMaxChars(config.maxCurrentCodeChars, DEFAULT_LIMITS.currentCode),
      metadata: isPlainObject(source.metadata) ? cloneValue(source.metadata) : createNullObject()
    };

    return deepFreeze(normalized);
  }

  function validateContext(context, options) {
    const normalized = normalizeContext(context, options);
    const errors = [];
    const warnings = [];

    if (!normalizeString(normalized.targetFile)) {
      errors.push(createValidationIssue(
        'targetFile',
        'INVALID_ARGUMENT',
        'targetFile is required for the executor prompt.',
        createNullObject()
      ));
    }

    if (!normalizeString(normalized.instructions)) {
      errors.push(createValidationIssue(
        'instructions',
        'INVALID_ARGUMENT',
        'instructions are required for the executor prompt.',
        createNullObject()
      ));
    }

    if (!normalizeString(normalized.issue.title)) {
      warnings.push(createValidationIssue(
        'issue.title',
        'MISSING_CONTEXT',
        'issue.title is empty. The prompt will rely on the free-form instruction body.',
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

    if (!normalizeString(normalized.repositoryTree)) {
      warnings.push(createValidationIssue(
        'repositoryTree',
        'MISSING_CONTEXT',
        'repositoryTree is empty. The executor will infer surrounding structure conservatively.',
        createNullObject()
      ));
    }

    if (!coerceBlockText(normalized.currentCode)) {
      warnings.push(createValidationIssue(
        'currentCode',
        'MISSING_CONTEXT',
        'currentCode is empty. The executor will treat the target file as new or unknown.',
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
    lines.push('あなたは ' + normalized.providerLabel + ' 上で動く実装担当AIである。');
    lines.push('目的は ' + normalized.targetFile + ' の最終完成版を 1ファイルのみ で返すこと。');
    lines.push('返答は説明や差分ではなく、そのまま保存可能な完成ファイル全文に限定せよ。');
    return lines.join('\n');
  }

  function buildTaskSection(normalized) {
    const instructionBlock = truncateMiddle(
      normalized.instructions,
      normalized.maxInstructionChars,
      'instructions'
    );
    const issueBodyBlock = truncateMiddle(
      normalized.issueBody,
      normalized.maxIssueBodyChars,
      'issue_body'
    );
    const lines = [];

    lines.push('repository: ' + formatRepositoryName(normalized.repository));
    lines.push('issue: ' + formatIssueHeader(normalized.issue));
    lines.push('target_file: ' + normalized.targetFile);
    lines.push('protocol_version: ' + normalized.protocolVersion);
    lines.push('template_id: ' + normalized.templateId);
    lines.push('');
    lines.push('instruction:');
    lines.push(buildFencedBlock('text', instructionBlock.text || 'No instruction.'));

    if (normalized.includeIssueBody
      && normalizeString(normalized.issueBody)
      && normalizeString(normalized.issueBody) !== normalizeString(normalized.instructions)) {
      lines.push('');
      lines.push('issue_body_reference:');
      lines.push(buildFencedBlock('text', issueBodyBlock.text));
    }

    return createSection(SECTION_IDS.TASK, 'task', lines.join('\n'), true, {
      instructionLength: instructionBlock.originalLength,
      instructionTruncated: instructionBlock.truncated,
      issueBodyLength: issueBodyBlock.originalLength,
      issueBodyTruncated: issueBodyBlock.truncated
    });
  }

  function buildConstraintItems(normalized) {
    const items = [
      '編集対象は ' + normalized.targetFile + ' の1ファイルのみ。ほかのファイルへの変更は返すな。',
      '返答は xml fenced block を 1個だけ 返せ。ブロックの前後に説明文・挨拶・補足を書くな。',
      'XMLルート要素は <' + FILE_ROOT_TAG + ' ' + normalized.outputContract.pathAttribute + '="' + normalized.targetFile + '"> に固定。',
      'path 属性は ' + normalized.targetFile + ' と完全一致させる。',
      'コード本文は <![CDATA[ ... ]]' + '> の内部に置け。CDATA を省略するな。',
      '差分形式、複数の <File> 要素、複数フェンス、JSON、プレーンテキスト出力を禁止する。',
      'TODO、FIXME、placeholder、擬似コード、未実装分岐、説明コメントだけの穴埋めを残すな。',
      '既存の依存関係・公開API・命名規約・モジュール登録パターンを壊すな。',
      '変更が不要な部分まで無意味に書き換えるな。ただし返答は最終ファイル全文で返せ。',
      '生成コードに ]]' + '> を含めるな。必要なら文字列構築や分割で回避せよ。'
    ];

    if (!normalizeString(normalized.repositoryTree)) {
      items.push('リポジトリツリー情報が不足しているため、推測は保守的に行い、周辺契約を壊さない実装を優先せよ。');
    }

    if (!coerceBlockText(normalized.currentCode)) {
      items.push('現行コードが未提供のため、対象ファイルは新規作成または未知の既存ファイルとして扱い、一貫した完全実装を返せ。');
    }

    for (const entry of normalized.customConstraints) {
      items.push(entry);
    }

    return items;
  }

  function buildConstraintsSection(normalized) {
    return createSection(
      SECTION_IDS.CONSTRAINTS,
      'constraints',
      buildIndentedList(buildConstraintItems(normalized)),
      true,
      {
        itemCount: buildConstraintItems(normalized).length
      }
    );
  }

  function buildRepositoryContextSection(normalized) {
    if (!normalized.includeRepositoryTree) {
      return createSection(
        SECTION_IDS.REPOSITORY_CONTEXT,
        'repository_context',
        'Repository context was intentionally omitted by configuration.',
        true,
        {
          omitted: true
        }
      );
    }

    if (!normalizeString(normalized.repositoryTree)) {
      return createSection(
        SECTION_IDS.REPOSITORY_CONTEXT,
        'repository_context',
        'Repository tree was not provided. Infer nearby structure only from the target file path, naming conventions, and the current file content.',
        true,
        {
          omitted: false,
          provided: false
        }
      );
    }

    const treeBlock = truncateMiddle(
      normalized.repositoryTree,
      normalized.maxRepositoryTreeChars,
      'repository_tree'
    );
    const lines = [];

    lines.push('このツリーを参照し、対象ファイルの周辺責務と命名規約を推定せよ。');
    lines.push(buildFencedBlock('text', treeBlock.text));

    return createSection(
      SECTION_IDS.REPOSITORY_CONTEXT,
      'repository_context',
      lines.join('\n'),
      true,
      {
        provided: true,
        originalLength: treeBlock.originalLength,
        truncated: treeBlock.truncated
      }
    );
  }

  function buildCurrentCodeSection(normalized) {
    if (!normalized.includeCurrentCode) {
      return createSection(
        SECTION_IDS.CURRENT_CODE,
        'current_code',
        'Current code was intentionally omitted by configuration.',
        false,
        {
          omitted: true
        }
      );
    }

    if (!coerceBlockText(normalized.currentCode)) {
      return createSection(
        SECTION_IDS.CURRENT_CODE,
        'current_code',
        'Current file content is unavailable. Treat `' + normalized.targetFile + '` as a new or unknown file and still return the final complete file content.',
        false,
        {
          provided: false,
          omitted: false
        }
      );
    }

    const language = guessLanguageFromPath(normalized.targetFile);
    const currentCodeBlock = truncateMiddle(
      normalized.currentCode,
      normalized.maxCurrentCodeChars,
      'current_code'
    );
    const lines = [];

    lines.push('以下は既知の現行コードである。差分ではなく、このファイルの完成後全文を返せ。');
    lines.push(buildFencedBlock(language, currentCodeBlock.text));

    return createSection(
      SECTION_IDS.CURRENT_CODE,
      'current_code',
      lines.join('\n'),
      false,
      {
        provided: true,
        originalLength: currentCodeBlock.originalLength,
        truncated: currentCodeBlock.truncated,
        language: language
      }
    );
  }

  function buildOutputContractExample(normalized) {
    const examplePath = normalizeString(normalized.targetFile) || 'src/example.js';
    const exampleXml = [
      '<' + FILE_ROOT_TAG + ' ' + normalized.outputContract.pathAttribute + '="' + examplePath + '">',
      '<![CDATA[',
      'COMPLETE_FILE_CONTENT',
      ']]' + '>',
      '</' + FILE_ROOT_TAG + '>'
    ].join('\n');

    return buildFencedBlock('xml', exampleXml);
  }

  function buildOutputContractSection(normalized) {
    const items = [
      '返答は xml fenced block を1個だけ返す。',
      'フェンスの内側は <' + FILE_ROOT_TAG + '> 1要素だけにする。',
      "'" + normalized.outputContract.pathAttribute + "' 属性の値は " + normalized.targetFile + " に固定する。",
      'CDATA の中には対象ファイルの 完成後全文のみ を置く。',
      'XML の外側には一切何も出力しない。',
      '差分記法、説明文、複数ファイル、補助ブロック、レビュー文を出力しない。'
    ];

    const lines = [];
    lines.push(buildIndentedList(items));
    lines.push('');
    lines.push('shape_example:');
    lines.push(buildOutputContractExample(normalized));

    return createSection(
      SECTION_IDS.OUTPUT_CONTRACT,
      'output_contract',
      lines.join('\n'),
      true,
      {
        expectedPath: normalized.targetFile,
        rootTag: FILE_ROOT_TAG,
        pathAttribute: normalized.outputContract.pathAttribute
      }
    );
  }

  function buildSelfCheckSection(normalized) {
    const items = [
      'Issue要件と instructions を満たしている。',
      '対象ファイルは ' + normalized.targetFile + ' のみ。',
      '出力は単一の xml fenced block である。',
      '<' + FILE_ROOT_TAG + ' ' + normalized.outputContract.pathAttribute + '="' + normalized.targetFile + '"> になっている。',
      'CDATA を含み、ファイル全文を返している。',
      '構文エラー、未定義参照、未実装プレースホルダー、TODO が残っていない。'
    ];

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
      buildTaskSection(normalized),
      buildConstraintsSection(normalized),
      buildRepositoryContextSection(normalized),
      buildCurrentCodeSection(normalized),
      buildOutputContractSection(normalized),
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
    output[LOCAL_PLACEHOLDERS.TASK_SECTION] = sectionMap[SECTION_IDS.TASK].content;
    output[LOCAL_PLACEHOLDERS.CONSTRAINTS_SECTION] = sectionMap[SECTION_IDS.CONSTRAINTS].content;
    output[LOCAL_PLACEHOLDERS.REPOSITORY_CONTEXT_SECTION] = sectionMap[SECTION_IDS.REPOSITORY_CONTEXT].content;
    output[LOCAL_PLACEHOLDERS.CURRENT_CODE_SECTION] = sectionMap[SECTION_IDS.CURRENT_CODE].content;
    output[LOCAL_PLACEHOLDERS.OUTPUT_CONTRACT_SECTION] = sectionMap[SECTION_IDS.OUTPUT_CONTRACT].content;
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

    if (typeof PLACEHOLDERS.REPOSITORY_TREE === 'string') {
      output[PLACEHOLDERS.REPOSITORY_TREE] = normalizeString(normalized.repositoryTree)
        ? normalizeString(normalized.repositoryTree)
        : sectionMap[SECTION_IDS.REPOSITORY_CONTEXT].content;
    }

    if (typeof PLACEHOLDERS.CURRENT_CODE === 'string') {
      output[PLACEHOLDERS.CURRENT_CODE] = coerceBlockText(normalized.currentCode);
    }

    if (typeof PLACEHOLDERS.OUTPUT_CONTRACT === 'string') {
      output[PLACEHOLDERS.OUTPUT_CONTRACT] = sectionMap[SECTION_IDS.OUTPUT_CONTRACT].content;
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
      id: normalized.providerId || 'executor',
      label: normalized.providerLabel || DEFAULT_PROVIDER_LABEL,
      role: normalizeString(WORKFLOW.ROLES && WORKFLOW.ROLES.EXECUTOR ? WORKFLOW.ROLES.EXECUTOR : 'executor'),
      providerId: normalized.providerId || '',
      siteId: '',
      tabId: null,
      url: ''
    };
  }

  function buildManualHubPacket(context, options) {
    const validation = validateContext(context, options);

    if (!validation.valid) {
      throw new Error('Executor prompt context is invalid.');
    }

    const normalized = validation.normalized;
    const config = isPlainObject(options) ? options : createNullObject();
    const packet = protocol.createTaskDispatchPacket({
      repository: normalized.repository,
      issue: normalized.issue,
      targetFile: normalized.targetFile,
      instructions: normalized.instructions,
      repositoryTree: normalized.repositoryTree,
      currentCode: normalized.currentCode,
      outputContract: normalized.outputContract,
      metadata: Object.assign(createNullObject(), normalized.metadata, {
        templateId: normalized.templateId,
        templateVersion: normalized.templateVersion,
        providerId: normalized.providerId,
        providerLabel: normalized.providerLabel,
        promptKind: 'executor'
      })
    }, {
      requestId: normalizeString(config.requestId) || (protocolHelpers.generateRequestId
        ? protocolHelpers.generateRequestId('executor')
        : ('executor_' + Date.now().toString(36))),
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

  function buildExecutionBrief(context, options) {
    const normalized = normalizeContext(context, options);
    const lines = [];

    lines.push('provider: ' + normalized.providerLabel);
    lines.push('repository: ' + formatRepositoryName(normalized.repository));
    lines.push('issue: ' + formatIssueHeader(normalized.issue));
    lines.push('target_file: ' + normalized.targetFile);
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
      hasRepositoryTree: normalizeString(normalized.repositoryTree) !== '',
      hasCurrentCode: coerceBlockText(normalized.currentCode) !== '',
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
        logger.warn('Failed to build executor manual hub packet.', {
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
        : createValidationIssue('context', 'INVALID_ARGUMENT', 'Executor prompt context is invalid.', createNullObject());
      const error = new Error(firstError.message);
      error.name = 'MAOEExecutorPromptError';
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
    buildExecutionBrief: buildExecutionBrief,
    helpers: deepFreeze({
      guessLanguageFromPath: guessLanguageFromPath,
      truncateMiddle: truncateMiddle,
      buildFencedBlock: buildFencedBlock,
      formatRepositoryName: formatRepositoryName,
      formatIssueHeader: formatIssueHeader,
      normalizeProviderId: normalizeProviderId,
      normalizeProviderLabel: normalizeProviderLabel,
      normalizeOutputContract: normalizeOutputContract,
      buildRoleDirective: buildRoleDirective,
      buildOutputContractExample: buildOutputContractExample,
      createValidationIssue: createValidationIssue,
      localPlaceholders: cloneValue(LOCAL_PLACEHOLDERS)
    })
  };

  try {
    logger.debug('Executor prompt module registered.', {
      templateId: TEMPLATE_ID,
      templateVersion: TEMPLATE_VERSION,
      requiredSections: REQUIRED_SECTIONS.slice()
    });
  } catch (error) {
  }

  root.registerValue('executor_prompt', deepFreeze(api), {
    overwrite: false,
    freeze: false,
    clone: false
  });

  function hasOwn(target, key) {
    return Object.prototype.hasOwnProperty.call(target, key);
  }
}(typeof globalThis !== 'undefined'
  ? globalThis
  : (typeof self !== 'undefined'
    ? self
    : (typeof window !== 'undefined' ? window : this))));
