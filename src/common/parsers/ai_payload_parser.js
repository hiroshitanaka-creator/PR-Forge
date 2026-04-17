(function registerMAOEAiPayloadParser(globalScope) {
  'use strict';

  const root = globalScope.MAOE;

  if (!root || typeof root.registerValue !== 'function') {
    throw new Error('[MAOE] namespace.js must be loaded before ai_payload_parser.js.');
  }

  if (root.has('ai_payload_parser')) {
    return;
  }

  if (!root.has('constants')) {
    throw new Error('[MAOE] constants.js must be loaded before ai_payload_parser.js.');
  }

  if (!root.has('protocol')) {
    throw new Error('[MAOE] protocol.js must be loaded before ai_payload_parser.js.');
  }

  if (!root.has('fenced_block_parser')) {
    throw new Error('[MAOE] fenced_block_parser.js must be loaded before ai_payload_parser.js.');
  }

  const constants = root.require('constants');
  const protocol = root.require('protocol');
  const fencedBlockParser = root.require('fenced_block_parser');
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
        consoleObject[level]('[MAOE/ai_payload_parser] ' + message);
        return;
      }

      consoleObject[level]('[MAOE/ai_payload_parser] ' + message, context);
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
        return loggerModule.createScope('ai_payload_parser');
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
  const PARSER = constants.PARSER || Object.create(null);
  const PARSER_XML = PARSER.XML || Object.create(null);
  const PARSER_LIMITS = PARSER.LIMITS || Object.create(null);
  const ERROR_CODES = constants.ERROR_CODES || Object.create(null);
  const REVIEW_VERDICTS = Array.isArray(PARSER.REVIEW_VERDICTS)
    ? PARSER.REVIEW_VERDICTS.slice()
    : ['APPROVE', 'REJECT'];
  const SUPPORTED_FENCE_LANGUAGES = Array.isArray(PARSER.SUPPORTED_FENCE_LANGUAGES)
    ? PARSER.SUPPORTED_FENCE_LANGUAGES.slice()
    : ['xml', 'json', 'diff', 'patch', 'text', 'txt', 'markdown', 'md'];

  const FILE_ROOT_TAG = typeof PARSER_XML.FILE_ROOT_TAG === 'string' && PARSER_XML.FILE_ROOT_TAG
    ? PARSER_XML.FILE_ROOT_TAG
    : 'File';
  const REVIEW_ROOT_TAG = typeof PARSER_XML.REVIEW_ROOT_TAG === 'string' && PARSER_XML.REVIEW_ROOT_TAG
    ? PARSER_XML.REVIEW_ROOT_TAG
    : 'Review';
  const FILE_PATH_ATTRIBUTE = typeof PARSER_XML.FILE_PATH_ATTRIBUTE === 'string' && PARSER_XML.FILE_PATH_ATTRIBUTE
    ? PARSER_XML.FILE_PATH_ATTRIBUTE
    : 'path';
  const FILE_CDATA_REQUIRED = PARSER_XML.CDATA_REQUIRED !== false;
  const XML_DECLARATION_ALLOWED = PARSER_XML.XML_DECLARATION_ALLOWED === true;

  const MAX_PAYLOAD_CHARS = Number.isFinite(Number(PARSER_LIMITS.MAX_PAYLOAD_CHARS))
    ? Math.max(1, Math.trunc(Number(PARSER_LIMITS.MAX_PAYLOAD_CHARS)))
    : 500000;
  const MAX_FENCE_BLOCKS = Number.isFinite(Number(PARSER_LIMITS.MAX_FENCE_BLOCKS))
    ? Math.max(1, Math.trunc(Number(PARSER_LIMITS.MAX_FENCE_BLOCKS)))
    : 32;
  const MAX_FILE_OUTPUTS = Number.isFinite(Number(PARSER_LIMITS.MAX_FILE_OUTPUTS))
    ? Math.max(1, Math.trunc(Number(PARSER_LIMITS.MAX_FILE_OUTPUTS)))
    : 1;
  const MAX_REVIEW_FINDINGS = Number.isFinite(Number(PARSER_LIMITS.MAX_REVIEW_FINDINGS))
    ? Math.max(1, Math.trunc(Number(PARSER_LIMITS.MAX_REVIEW_FINDINGS)))
    : 50;
  const MAX_XML_NODES = 4096;

  const KIND_VALUES = ['auto', 'file', 'review', 'packet', 'unknown'];
  const FORMAT_VALUES = ['xml_file', 'xml_review', 'json_packet', 'unknown'];

  const INTERNAL_CODES = deepFreeze({
    INVALID_REVIEW: 'PARSER_INVALID_REVIEW',
    MULTIPLE_REVIEWS: 'PARSER_MULTIPLE_REVIEWS',
    INVALID_PACKET: 'PARSER_INVALID_PACKET',
    MULTIPLE_PACKETS: 'PARSER_MULTIPLE_PACKETS',
    AMBIGUOUS_PAYLOAD: 'PARSER_AMBIGUOUS_PAYLOAD',
    UNEXPECTED_ROOT: 'PARSER_UNEXPECTED_ROOT',
    INVALID_XML_STRUCTURE: 'PARSER_INVALID_XML_STRUCTURE',
    INVALID_XML_ATTRIBUTE: 'PARSER_INVALID_XML_ATTRIBUTE',
    INVALID_FILE_PATH: 'PARSER_INVALID_FILE_PATH',
    XML_DECLARATION_NOT_ALLOWED: 'PARSER_XML_DECLARATION_NOT_ALLOWED',
    XML_PROCESSING_INSTRUCTION: 'PARSER_XML_PROCESSING_INSTRUCTION',
    XML_MULTIPLE_ROOTS: 'PARSER_XML_MULTIPLE_ROOTS',
    XML_TEXT_OUTSIDE_ROOT: 'PARSER_XML_TEXT_OUTSIDE_ROOT',
    XML_MISMATCHED_TAG: 'PARSER_XML_MISMATCHED_TAG',
    XML_UNCLOSED_TAG: 'PARSER_XML_UNCLOSED_TAG',
    XML_UNTERMINATED_CDATA: 'PARSER_XML_UNTERMINATED_CDATA',
    XML_UNTERMINATED_COMMENT: 'PARSER_XML_UNTERMINATED_COMMENT',
    XML_UNTERMINATED_TAG: 'PARSER_XML_UNTERMINATED_TAG',
    XML_DUPLICATE_ATTRIBUTE: 'PARSER_XML_DUPLICATE_ATTRIBUTE',
    XML_INVALID_ENTITY: 'PARSER_XML_INVALID_ENTITY',
    FILE_CONTENT_MIXED_NODES: 'PARSER_FILE_CONTENT_MIXED_NODES',
    REVIEW_MISSING_VERDICT: 'PARSER_REVIEW_MISSING_VERDICT',
    REVIEW_MISSING_SUMMARY: 'PARSER_REVIEW_MISSING_SUMMARY',
    REVIEW_CONFLICTING_VERDICT: 'PARSER_REVIEW_CONFLICTING_VERDICT',
    REVIEW_INVALID_FINDINGS: 'PARSER_REVIEW_INVALID_FINDINGS',
    PACKET_NOT_FOUND: 'PARSER_PACKET_NOT_FOUND',
    FILE_NOT_FOUND: 'PARSER_FILE_NOT_FOUND',
    REVIEW_NOT_FOUND: 'PARSER_REVIEW_NOT_FOUND',
    CONTENT_CONTAINS_CDATA_END: 'PARSER_CONTENT_CONTAINS_CDATA_END'
  });

  const CDATA_OPEN = '<![CDATA[';
  const CDATA_CLOSE = ']]' + '>';

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

  function coerceText(value) {
    if (typeof value === 'string') {
      return value;
    }

    if (value === null || typeof value === 'undefined') {
      return '';
    }

    return String(value);
  }

  function stripBom(text) {
    const source = coerceText(text);
    return source.charCodeAt(0) === 0xFEFF ? source.slice(1) : source;
  }

  function clampPositiveInteger(value, fallbackValue) {
    const fallback = Number.isFinite(Number(fallbackValue))
      ? Math.max(1, Math.trunc(Number(fallbackValue)))
      : 1;

    if (!Number.isFinite(Number(value))) {
      return fallback;
    }

    return Math.max(1, Math.trunc(Number(value)));
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

  function oneOf(value, allowedValues, fallbackValue) {
    const normalizedValue = typeof value === 'string' ? value.trim() : value;

    if (Array.isArray(allowedValues) && allowedValues.indexOf(normalizedValue) >= 0) {
      return normalizedValue;
    }

    return fallbackValue;
  }

  function nowIsoString() {
    return new Date().toISOString();
  }

  function normalizeKind(kind) {
    return oneOf(normalizeString(kind).toLowerCase(), KIND_VALUES, 'auto');
  }

  function normalizeFormat(format) {
    return oneOf(normalizeString(format).toLowerCase(), FORMAT_VALUES, 'unknown');
  }

  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function uniqueBy(items, signatureFactory) {
    const source = Array.isArray(items) ? items : [];
    const signatureFunction = typeof signatureFactory === 'function'
      ? signatureFactory
      : function defaultSignatureFactory(value) {
          return String(value);
        };
    const result = [];
    const seen = new Set();

    for (const item of source) {
      const signature = signatureFunction(item);

      if (seen.has(signature)) {
        continue;
      }

      seen.add(signature);
      result.push(item);
    }

    return result;
  }

  function mergeIssueArrays() {
    const allIssues = [];
    const seen = new Set();

    for (let argumentIndex = 0; argumentIndex < arguments.length; argumentIndex += 1) {
      const source = Array.isArray(arguments[argumentIndex]) ? arguments[argumentIndex] : [];

      for (const item of source) {
        if (!item || typeof item !== 'object') {
          continue;
        }

        const normalized = {
          code: normalizeString(item.code) || (ERROR_CODES.UNKNOWN_ERROR || 'UNKNOWN_ERROR'),
          message: normalizeString(item.message) || 'Unknown issue.',
          details: isPlainObject(item.details) ? cloneValue(item.details) : createNullObject()
        };
        const signature = normalized.code + '\u0000' + normalized.message + '\u0000' + JSON.stringify(normalized.details);

        if (seen.has(signature)) {
          continue;
        }

        seen.add(signature);
        allIssues.push(deepFreeze(normalized));
      }
    }

    return allIssues;
  }

  function createIssue(code, message, details) {
    return deepFreeze({
      code: normalizeString(code) || (ERROR_CODES.UNKNOWN_ERROR || 'UNKNOWN_ERROR'),
      message: normalizeString(message) || 'Unknown issue.',
      details: isPlainObject(details) ? cloneValue(details) : createNullObject()
    });
  }

  function createParseError(code, message, details) {
    return createIssue(code, message, details);
  }

  function createParseWarning(code, message, details) {
    return createIssue(code, message, details);
  }

  function createParserException(code, message, details) {
    const error = new Error(message || 'AI payload parser error.');
    error.name = 'MAOEAiPayloadParserError';
    error.code = normalizeString(code) || (ERROR_CODES.UNKNOWN_ERROR || 'UNKNOWN_ERROR');
    error.details = isPlainObject(details) ? cloneValue(details) : createNullObject();
    return error;
  }

  function throwParserException(code, message, details) {
    throw createParserException(code, message, details);
  }

  function normalizeFenceLanguage(language) {
    if (fencedBlockParser
      && fencedBlockParser.helpers
      && typeof fencedBlockParser.helpers.normalizeFenceLanguage === 'function') {
      return fencedBlockParser.helpers.normalizeFenceLanguage(language);
    }

    const normalized = normalizeString(language).toLowerCase();

    if (normalized === 'txt') {
      return 'text';
    }

    if (normalized === 'md') {
      return 'markdown';
    }

    return normalized.replace(/^language-/, '');
  }

  function getLanguageFamily(language) {
    if (fencedBlockParser
      && fencedBlockParser.helpers
      && typeof fencedBlockParser.helpers.getLanguageFamily === 'function') {
      return fencedBlockParser.helpers.getLanguageFamily(language);
    }

    const normalized = normalizeFenceLanguage(language);

    if (normalized === 'diff' || normalized === 'patch') {
      return 'diff';
    }

    return normalized;
  }

  function languageMatches(leftLanguage, rightLanguage) {
    if (fencedBlockParser
      && fencedBlockParser.helpers
      && typeof fencedBlockParser.helpers.languageMatches === 'function') {
      return fencedBlockParser.helpers.languageMatches(leftLanguage, rightLanguage);
    }

    const left = normalizeFenceLanguage(leftLanguage);
    const right = normalizeFenceLanguage(rightLanguage);

    if (!left || !right) {
      return false;
    }

    return left === right || getLanguageFamily(left) === getLanguageFamily(right);
  }

  function isSupportedFenceLanguage(language) {
    const normalized = normalizeFenceLanguage(language);

    if (!normalized) {
      return false;
    }

    for (const candidate of SUPPORTED_FENCE_LANGUAGES) {
      if (languageMatches(candidate, normalized)) {
        return true;
      }
    }

    return false;
  }

  function normalizeLanguageList(value) {
    let source = [];

    if (typeof value === 'string') {
      source = value.split(',');
    } else if (Array.isArray(value)) {
      source = value.slice();
    }

    const seen = new Set();
    const result = [];

    for (const entry of source) {
      const normalized = normalizeFenceLanguage(entry);
      const signature = getLanguageFamily(normalized) || normalized;

      if (!normalized || seen.has(signature)) {
        continue;
      }

      seen.add(signature);
      result.push(normalized);
    }

    return result;
  }

  function normalizeParseOptions(options) {
    const source = isPlainObject(options) ? options : createNullObject();

    return {
      expectedKind: normalizeKind(source.expectedKind),
      allowHtmlEscapedXml: normalizeBoolean(source.allowHtmlEscapedXml, true),
      cdataRequired: normalizeBoolean(source.cdataRequired, FILE_CDATA_REQUIRED),
      xmlDeclarationAllowed: normalizeBoolean(source.xmlDeclarationAllowed, XML_DECLARATION_ALLOWED),
      maxPayloadChars: clampPositiveInteger(source.maxPayloadChars, MAX_PAYLOAD_CHARS),
      maxBlocks: clampPositiveInteger(source.maxBlocks, MAX_FENCE_BLOCKS),
      maxNodes: clampPositiveInteger(source.maxNodes, MAX_XML_NODES),
      expectedPath: normalizeString(source.expectedPath),
      pathAttribute: normalizeString(source.pathAttribute) || FILE_PATH_ATTRIBUTE,
      requireSummary: normalizeBoolean(source.requireSummary, true),
      collection: isPlainObject(source.collection) ? source.collection : null,
      buildPrettyXml: normalizeBoolean(source.buildPrettyXml, true),
      wrapInFence: normalizeBoolean(source.wrapInFence, false)
    };
  }

  function maybeDecodeHtmlEscapedXml(text, options) {
    const config = normalizeParseOptions(options);
    const source = stripBom(coerceText(text)).trim();

    if (!config.allowHtmlEscapedXml) {
      return {
        text: source,
        wasHtmlEscaped: false
      };
    }

    if (!/^&lt;/.test(source)) {
      return {
        text: source,
        wasHtmlEscaped: false
      };
    }

    const decoded = decodeXmlEntities(source);

    if (/^</.test(decoded)) {
      return {
        text: decoded,
        wasHtmlEscaped: true
      };
    }

    return {
      text: source,
      wasHtmlEscaped: false
    };
  }

  function decodeXmlEntities(text) {
    const source = coerceText(text);

    return source.replace(/&(#x?[0-9A-Fa-f]+|lt|gt|amp|quot|apos);/g, function replaceEntity(match, token) {
      if (token === 'lt') {
        return '<';
      }

      if (token === 'gt') {
        return '>';
      }

      if (token === 'amp') {
        return '&';
      }

      if (token === 'quot') {
        return '"';
      }

      if (token === 'apos') {
        return '\'';
      }

      if (token.charAt(0) === '#') {
        const isHex = token.charAt(1).toLowerCase() === 'x';
        const numericText = isHex ? token.slice(2) : token.slice(1);
        const radix = isHex ? 16 : 10;
        const codePoint = parseInt(numericText, radix);

        if (!Number.isFinite(codePoint) || codePoint < 0 || codePoint > 0x10FFFF) {
          return match;
        }

        try {
          return String.fromCodePoint(codePoint);
        } catch (error) {
          return match;
        }
      }

      return match;
    });
  }

  function encodeXmlAttributeValue(text) {
    return coerceText(text)
      .replace(/&/g, '&')
      .replace(/"/g, '"')
      .replace(/</g, '<')
      .replace(/>/g, '>')
      .replace(/'/g, '\'');
  }

  function encodeXmlText(text) {
    return coerceText(text)
      .replace(/&/g, '&')
      .replace(/</g, '<')
      .replace(/>/g, '>');
  }

  function hasInvalidControlCharacters(text) {
    return /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(coerceText(text));
  }

  function looksLikeXml(text) {
    const source = stripBom(coerceText(text)).trim();

    if (!source) {
      return false;
    }

    return /^</.test(source) || /^&lt;/.test(source);
  }

  function looksLikeJsonObject(text) {
    const source = stripBom(coerceText(text)).trim();

    if (!source) {
      return false;
    }

    return source.charAt(0) === '{' || source.charAt(0) === '[';
  }

  function guessXmlRootTag(text) {
    let source = maybeDecodeHtmlEscapedXml(text, {
      allowHtmlEscapedXml: true
    }).text;

    source = stripBom(source).trim();

    if (!source) {
      return '';
    }

    let safety = 0;

    while (safety < 16) {
      safety += 1;

      if (/^<!--/.test(source)) {
        const commentEnd = source.indexOf('-->');

        if (commentEnd < 0) {
          return '';
        }

        source = source.slice(commentEnd + 3).trim();
        continue;
      }

      if (/^<\?/.test(source)) {
        const instructionEnd = source.indexOf('?>');

        if (instructionEnd < 0) {
          return '';
        }

        source = source.slice(instructionEnd + 2).trim();
        continue;
      }

      break;
    }

    const match = /^<([A-Za-z_][A-Za-z0-9_.:-]*)\b/.exec(source);
    return match ? match[1] : '';
  }

  function normalizeVerdict(value) {
    const candidate = normalizeString(value).toUpperCase();

    return REVIEW_VERDICTS.indexOf(candidate) >= 0 ? candidate : '';
  }

  function normalizeFilePath(path) {
    const source = coerceText(path);
    const normalizedWhitespace = source.trim();

    if (!normalizedWhitespace) {
      throwParserException(
        ERROR_CODES.PARSER_MISSING_FILE_PATH || INTERNAL_CODES.INVALID_FILE_PATH,
        'File path is empty.',
        {
          value: path
        }
      );
    }

    const replaced = normalizedWhitespace.replace(/\\/g, '/').replace(/\/{2,}/g, '/');
    let normalized = replaced;

    while (normalized.indexOf('./') === 0) {
      normalized = normalized.slice(2);
    }

    if (!normalized) {
      throwParserException(
        INTERNAL_CODES.INVALID_FILE_PATH,
        'File path is empty after normalization.',
        {
          value: path
        }
      );
    }

    if (normalized.charAt(0) === '/') {
      throwParserException(
        INTERNAL_CODES.INVALID_FILE_PATH,
        'Absolute file paths are not allowed.',
        {
          value: path,
          normalizedPath: normalized
        }
      );
    }

    if (/^[a-zA-Z]:\//.test(normalized)) {
      throwParserException(
        INTERNAL_CODES.INVALID_FILE_PATH,
        'Drive-qualified file paths are not allowed.',
        {
          value: path,
          normalizedPath: normalized
        }
      );
    }

    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(normalized)) {
      throwParserException(
        INTERNAL_CODES.INVALID_FILE_PATH,
        'URI-like file paths are not allowed.',
        {
          value: path,
          normalizedPath: normalized
        }
      );
    }

    if (hasInvalidControlCharacters(normalized) || /[\r\n\t]/.test(normalized)) {
      throwParserException(
        INTERNAL_CODES.INVALID_FILE_PATH,
        'File path contains control characters.',
        {
          value: path,
          normalizedPath: normalized
        }
      );
    }

    const segments = normalized.split('/');

    if (segments.some(function hasInvalidSegment(segment) {
      return !segment || segment === '.' || segment === '..';
    })) {
      throwParserException(
        INTERNAL_CODES.INVALID_FILE_PATH,
        'File path contains an invalid or traversal segment.',
        {
          value: path,
          normalizedPath: normalized,
          segments: segments
        }
      );
    }

    return normalized;
  }

  function summarizeBlock(block) {
    if (!block || typeof block !== 'object') {
      return null;
    }

    return deepFreeze({
      id: normalizeString(block.id),
      index: Number.isFinite(Number(block.index)) ? Math.trunc(Number(block.index)) : null,
      language: normalizeString(block.language),
      normalizedLanguage: normalizeFenceLanguage(block.normalizedLanguage || block.language),
      languageFamily: normalizeString(block.languageFamily),
      hasClosingFence: block.hasClosingFence === true,
      infoText: normalizeString(block.infoText || block.infoString),
      contentLength: Number.isFinite(Number(block.contentLength))
        ? Math.max(0, Math.trunc(Number(block.contentLength)))
        : coerceText(block.content).length,
      lines: isPlainObject(block.lines) ? cloneValue(block.lines) : createNullObject(),
      ranges: isPlainObject(block.ranges) ? cloneValue(block.ranges) : createNullObject()
    });
  }

  function createCandidate(sourceType, id, text, language, block) {
    const candidateText = coerceText(text);

    return deepFreeze({
      sourceType: normalizeString(sourceType) || 'raw_text',
      id: normalizeString(id) || 'raw',
      language: normalizeFenceLanguage(language),
      text: candidateText,
      block: summarizeBlock(block)
    });
  }

  function createCollectionScanSummary(scanResult) {
    const source = isPlainObject(scanResult) ? scanResult : createNullObject();

    return deepFreeze({
      totalBlocksScanned: Number.isFinite(Number(source.totalBlocksScanned))
        ? Math.max(0, Math.trunc(Number(source.totalBlocksScanned)))
        : 0,
      blockCount: Number.isFinite(Number(source.blockCount))
        ? Math.max(0, Math.trunc(Number(source.blockCount)))
        : 0,
      truncated: source.truncated === true,
      totalLines: Number.isFinite(Number(source.totalLines))
        ? Math.max(0, Math.trunc(Number(source.totalLines)))
        : 0,
      sourceLength: Number.isFinite(Number(source.sourceLength))
        ? Math.max(0, Math.trunc(Number(source.sourceLength)))
        : 0
    });
  }

  function normalizeCollectionWarnings(scanResult) {
    const warnings = Array.isArray(scanResult && scanResult.warnings) ? scanResult.warnings : [];

    return warnings.map(function mapWarning(warning) {
      return createParseWarning(
        normalizeString(warning.code) || 'SCAN_WARNING',
        normalizeString(warning.message) || 'Fenced block scan warning.',
        isPlainObject(warning.details) ? warning.details : createNullObject()
      );
    });
  }

  function buildCandidateCollection(rawText, options) {
    const config = normalizeParseOptions(options);
    const sourceText = stripBom(coerceText(rawText));

    if (sourceText.length > config.maxPayloadChars) {
      throwParserException(
        ERROR_CODES.INVALID_ARGUMENT || 'INVALID_ARGUMENT',
        'Payload exceeds maximum allowed size.',
        {
          length: sourceText.length,
          maxPayloadChars: config.maxPayloadChars
        }
      );
    }

    const scanResult = fencedBlockParser.scan(sourceText, {
      maxBlocks: config.maxBlocks,
      includeUnclosed: true,
      logWarnings: false
    });
    const candidates = [];
    const seen = new Set();

    function pushCandidate(sourceType, id, text, language, block) {
      const candidateText = coerceText(text);

      if (!candidateText.trim()) {
        return;
      }

      const signature = [
        normalizeString(sourceType) || 'raw_text',
        normalizeString(id) || 'raw',
        normalizeFenceLanguage(language),
        candidateText
      ].join('\u0000');

      if (seen.has(signature)) {
        return;
      }

      seen.add(signature);
      candidates.push(createCandidate(sourceType, id, candidateText, language, block));
    }

    if (Array.isArray(scanResult.blocks)) {
      for (const block of scanResult.blocks) {
        pushCandidate('fenced_block', block.id, block.content, block.normalizedLanguage || block.language, block);
      }
    }

    pushCandidate('raw_text', 'raw', sourceText.trim(), '', null);

    return deepFreeze({
      sourceText: sourceText,
      candidates: candidates.slice(),
      warnings: normalizeCollectionWarnings(scanResult),
      scan: createCollectionScanSummary(scanResult)
    });
  }

  function ensureCollection(rawText, options) {
    const config = normalizeParseOptions(options);

    if (config.collection
      && Array.isArray(config.collection.candidates)
      && typeof config.collection.sourceText === 'string') {
      return config.collection;
    }

    return buildCandidateCollection(rawText, options);
  }

  function safeEnsureCollection(rawText, options) {
    try {
      return {
        ok: true,
        collection: ensureCollection(rawText, options),
        error: null
      };
    } catch (error) {
      return {
        ok: false,
        collection: null,
        error: createParseError(
          normalizeString(error.code) || (ERROR_CODES.INVALID_ARGUMENT || 'INVALID_ARGUMENT'),
          normalizeString(error.message) || 'Failed to prepare payload candidates.',
          isPlainObject(error.details) ? error.details : createNullObject()
        )
      };
    }
  }

  function createAttemptSummary(candidate, ok, details, errors, warnings) {
    const errorList = Array.isArray(errors) ? errors : [];
    const warningList = Array.isArray(warnings) ? warnings : [];
    const firstError = errorList.length > 0 ? errorList[0] : null;

    return deepFreeze({
      candidateId: candidate ? candidate.id : '',
      sourceType: candidate ? candidate.sourceType : '',
      language: candidate ? candidate.language : '',
      block: candidate ? candidate.block : null,
      ok: ok === true,
      errorCode: firstError ? firstError.code : '',
      errorMessage: firstError ? firstError.message : '',
      details: isPlainObject(details) ? cloneValue(details) : createNullObject(),
      warnings: warningList.slice()
    });
  }

  function createSourceDescriptor(candidate) {
    if (!candidate) {
      return null;
    }

    return deepFreeze({
      type: candidate.sourceType,
      id: candidate.id,
      language: candidate.language,
      block: candidate.block
    });
  }

  function createParseResult(kind, format, ok, source, payload, errors, warnings, attempts, meta) {
    return deepFreeze({
      ok: ok === true,
      kind: normalizeKind(kind),
      format: normalizeFormat(format),
      source: source ? createSourceDescriptor(source) : null,
      payload: payload === null || typeof payload === 'undefined' ? null : cloneValue(payload),
      errors: mergeIssueArrays(errors),
      warnings: mergeIssueArrays(warnings),
      attempts: Array.isArray(attempts) ? attempts.slice() : [],
      meta: isPlainObject(meta) ? cloneValue(meta) : createNullObject()
    });
  }

  function isXmlNameStartChar(char) {
    return /^[A-Za-z_]$/.test(char);
  }

  function isXmlNameChar(char) {
    return /^[A-Za-z0-9_.:-]$/.test(char);
  }

  function parseXmlDocument(rawText, options) {
    const config = normalizeParseOptions(options);
    const decodedCandidate = maybeDecodeHtmlEscapedXml(rawText, config);
    const sourceText = decodedCandidate.text;
    const warnings = [];
    const errors = [];

    if (!sourceText.trim()) {
      return {
        ok: false,
        xmlText: '',
        tree: null,
        errors: [createParseError(
          ERROR_CODES.PARSER_INVALID_XML || INTERNAL_CODES.INVALID_XML_STRUCTURE,
          'XML payload is empty.',
          createNullObject()
        )],
        warnings: warnings
      };
    }

    let index = 0;
    let nodeCount = 0;
    let rootNode = null;
    const stack = [];

    function currentParent() {
      return stack.length > 0 ? stack[stack.length - 1] : null;
    }

    function registerNode(node) {
      nodeCount += 1;

      if (nodeCount > config.maxNodes) {
        throwParserException(
          ERROR_CODES.INVALID_ARGUMENT || 'INVALID_ARGUMENT',
          'XML node count exceeds the maximum allowed limit.',
          {
            maxNodes: config.maxNodes
          }
        );
      }

      return node;
    }

    function attachNode(node) {
      const parent = currentParent();

      if (parent) {
        parent.children.push(node);
        return;
      }

      if (rootNode) {
        throwParserException(
          INTERNAL_CODES.XML_MULTIPLE_ROOTS,
          'Multiple XML root nodes detected.',
          {
            existingRoot: rootNode.name,
            nextRoot: node.name
          }
        );
      }

      rootNode = node;
    }

    function parseStartTag() {
      const startIndex = index;
      index += 1;

      if (index >= sourceText.length || !isXmlNameStartChar(sourceText.charAt(index))) {
        throwParserException(
          ERROR_CODES.PARSER_INVALID_XML || INTERNAL_CODES.INVALID_XML_STRUCTURE,
          'Invalid XML element name.',
          {
            index: startIndex
          }
        );
      }

      const nameStart = index;

      while (index < sourceText.length && isXmlNameChar(sourceText.charAt(index))) {
        index += 1;
      }

      const name = sourceText.slice(nameStart, index);
      const attributes = createNullObject();
      let selfClosing = false;

      while (index < sourceText.length) {
        while (index < sourceText.length && /\s/.test(sourceText.charAt(index))) {
          index += 1;
        }

        if (index >= sourceText.length) {
          throwParserException(
            INTERNAL_CODES.XML_UNTERMINATED_TAG,
            'Unterminated XML start tag.',
            {
              tagName: name,
              index: startIndex
            }
          );
        }

        if (sourceText.charAt(index) === '>') {
          index += 1;
          break;
        }

        if (sourceText.charAt(index) === '/' && sourceText.charAt(index + 1) === '>') {
          selfClosing = true;
          index += 2;
          break;
        }

        if (!isXmlNameStartChar(sourceText.charAt(index))) {
          throwParserException(
            INTERNAL_CODES.INVALID_XML_ATTRIBUTE,
            'Invalid XML attribute name.',
            {
              tagName: name,
              index: index
            }
          );
        }

        const attributeNameStart = index;

        while (index < sourceText.length && isXmlNameChar(sourceText.charAt(index))) {
          index += 1;
        }

        const attributeName = sourceText.slice(attributeNameStart, index);

        while (index < sourceText.length && /\s/.test(sourceText.charAt(index))) {
          index += 1;
        }

        if (sourceText.charAt(index) !== '=') {
          throwParserException(
            INTERNAL_CODES.INVALID_XML_ATTRIBUTE,
            'XML attribute is missing an equals sign.',
            {
              tagName: name,
              attributeName: attributeName,
              index: index
            }
          );
        }

        index += 1;

        while (index < sourceText.length && /\s/.test(sourceText.charAt(index))) {
          index += 1;
        }

        const quote = sourceText.charAt(index);

        if (quote !== '"' && quote !== '\'') {
          throwParserException(
            INTERNAL_CODES.INVALID_XML_ATTRIBUTE,
            'XML attribute value must be quoted.',
            {
              tagName: name,
              attributeName: attributeName,
              index: index
            }
          );
        }

        index += 1;
        const attributeValueStart = index;

        while (index < sourceText.length && sourceText.charAt(index) !== quote) {
          index += 1;
        }

        if (index >= sourceText.length) {
          throwParserException(
            INTERNAL_CODES.XML_UNTERMINATED_TAG,
            'Unterminated XML attribute value.',
            {
              tagName: name,
              attributeName: attributeName
            }
          );
        }

        const rawAttributeValue = sourceText.slice(attributeValueStart, index);
        index += 1;

        if (hasOwn(attributes, attributeName)) {
          throwParserException(
            INTERNAL_CODES.XML_DUPLICATE_ATTRIBUTE,
            'Duplicate XML attribute detected.',
            {
              tagName: name,
              attributeName: attributeName
            }
          );
        }

        attributes[attributeName] = decodeXmlEntities(rawAttributeValue);
      }

      const node = registerNode({
        type: 'element',
        name: name,
        attributes: attributes,
        children: [],
        startIndex: startIndex,
        endIndex: null,
        selfClosing: selfClosing
      });

      attachNode(node);

      if (!selfClosing) {
        stack.push(node);
      } else {
        node.endIndex = index;
      }
    }

    function parseEndTag() {
      const startIndex = index;
      index += 2;

      while (index < sourceText.length && /\s/.test(sourceText.charAt(index))) {
        index += 1;
      }

      if (index >= sourceText.length || !isXmlNameStartChar(sourceText.charAt(index))) {
        throwParserException(
          ERROR_CODES.PARSER_INVALID_XML || INTERNAL_CODES.INVALID_XML_STRUCTURE,
          'Invalid XML closing tag.',
          {
            index: startIndex
          }
        );
      }

      const nameStart = index;

      while (index < sourceText.length && isXmlNameChar(sourceText.charAt(index))) {
        index += 1;
      }

      const name = sourceText.slice(nameStart, index);

      while (index < sourceText.length && /\s/.test(sourceText.charAt(index))) {
        index += 1;
      }

      if (sourceText.charAt(index) !== '>') {
        throwParserException(
          INTERNAL_CODES.XML_UNTERMINATED_TAG,
          'Unterminated XML closing tag.',
          {
            tagName: name,
            index: startIndex
          }
        );
      }

      index += 1;

      if (stack.length === 0) {
        throwParserException(
          INTERNAL_CODES.XML_MISMATCHED_TAG,
          'Unexpected XML closing tag without a matching start tag.',
          {
            tagName: name
          }
        );
      }

      const current = stack.pop();

      if (!current || current.name !== name) {
        throwParserException(
          INTERNAL_CODES.XML_MISMATCHED_TAG,
          'Mismatched XML closing tag detected.',
          {
            expectedTag: current ? current.name : '',
            actualTag: name
          }
        );
      }

      current.endIndex = index;
    }

    function parseTextNode() {
      const startIndex = index;
      let nextIndex = sourceText.indexOf('<', index);

      if (nextIndex < 0) {
        nextIndex = sourceText.length;
      }

      const rawContent = sourceText.slice(startIndex, nextIndex);
      const decodedContent = decodeXmlEntities(rawContent);
      index = nextIndex;

      if (stack.length === 0) {
        if (decodedContent.trim()) {
          throwParserException(
            INTERNAL_CODES.XML_TEXT_OUTSIDE_ROOT,
            'Unexpected text exists outside the XML root element.',
            {
              text: decodedContent.trim()
            }
          );
        }

        return;
      }

      if (!rawContent.length) {
        return;
      }

      const node = registerNode({
        type: 'text',
        content: decodedContent,
        raw: rawContent,
        startIndex: startIndex,
        endIndex: nextIndex
      });

      currentParent().children.push(node);
    }

    function parseComment() {
      const commentEnd = sourceText.indexOf('-->', index + 4);

      if (commentEnd < 0) {
        throwParserException(
          INTERNAL_CODES.XML_UNTERMINATED_COMMENT,
          'Unterminated XML comment.',
          {
            index: index
          }
        );
      }

      index = commentEnd + 3;
    }

    function parseCdata() {
      const cdataStart = index;
      const cdataEnd = sourceText.indexOf(CDATA_CLOSE, index + 9);

      if (cdataEnd < 0) {
        throwParserException(
          INTERNAL_CODES.XML_UNTERMINATED_CDATA,
          'Unterminated CDATA section.',
          {
            index: index
          }
        );
      }

      const content = sourceText.slice(index + 9, cdataEnd);
      index = cdataEnd + 3;

      if (stack.length === 0) {
        if (content.trim()) {
          throwParserException(
            INTERNAL_CODES.XML_TEXT_OUTSIDE_ROOT,
            'CDATA content exists outside the XML root element.',
            {
              index: cdataStart
            }
          );
        }

        return;
      }

      const node = registerNode({
        type: 'cdata',
        content: content,
        startIndex: cdataStart,
        endIndex: index
      });

      currentParent().children.push(node);
    }

    function parseProcessingInstruction() {
      const instructionEnd = sourceText.indexOf('?>', index + 2);

      if (instructionEnd < 0) {
        throwParserException(
          INTERNAL_CODES.XML_UNTERMINATED_TAG,
          'Unterminated XML processing instruction.',
          {
            index: index
          }
        );
      }

      const instructionText = sourceText.slice(index, instructionEnd + 2);

      if (!config.xmlDeclarationAllowed) {
        throwParserException(
          INTERNAL_CODES.XML_DECLARATION_NOT_ALLOWED,
          'XML declarations or processing instructions are not allowed.',
          {
            instruction: instructionText
          }
        );
      }

      warnings.push(createParseWarning(
        INTERNAL_CODES.XML_PROCESSING_INSTRUCTION,
        'XML processing instruction was ignored.',
        {
          instruction: instructionText
        }
      ));

      index = instructionEnd + 2;
    }

    try {
      while (index < sourceText.length) {
        if (sourceText.charAt(index) !== '<') {
          parseTextNode();
          continue;
        }

        if (sourceText.indexOf('<!--', index) === index) {
          parseComment();
          continue;
        }

        if (sourceText.indexOf(CDATA_OPEN, index) === index) {
          parseCdata();
          continue;
        }

        if (sourceText.indexOf('<?', index) === index) {
          parseProcessingInstruction();
          continue;
        }

        if (sourceText.indexOf('</', index) === index) {
          parseEndTag();
          continue;
        }

        parseStartTag();
      }

      if (stack.length > 0) {
        throwParserException(
          INTERNAL_CODES.XML_UNTERMINATED_TAG,
          'Unterminated XML element.',
          {
            tagName: stack[stack.length - 1].name
          }
        );
      }

      if (!rootNode) {
        throwParserException(
          ERROR_CODES.PARSER_INVALID_XML || INTERNAL_CODES.INVALID_XML_STRUCTURE,
          'XML payload has no root element.',
          createNullObject()
        );
      }

      return {
        ok: true,
        xmlText: sourceText,
        tree: rootNode,
        errors: errors,
        warnings: warnings
      };
    } catch (error) {
      errors.push(createParseError(
        normalizeString(error && error.code) || (ERROR_CODES.PARSER_INVALID_XML || INTERNAL_CODES.INVALID_XML_STRUCTURE),
        normalizeString(error && error.message) || 'Failed to parse XML payload.',
        isPlainObject(error && error.details) ? error.details : createNullObject()
      ));

      return {
        ok: false,
        xmlText: sourceText,
        tree: null,
        errors: errors,
        warnings: warnings
      };
    }
  }

  function getElementChildren(element, childName) {
    if (!element || !Array.isArray(element.children)) {
      return [];
    }

    const target = normalizeString(childName);
    const output = [];

    for (const child of element.children) {
      if (child && child.type === 'element' && child.name === target) {
        output.push(child);
      }
    }

    return output;
  }

  function getFirstElementChild(element, childName) {
    const matches = getElementChildren(element, childName);
    return matches.length > 0 ? matches[0] : null;
  }

  function collectElementText(element) {
    if (!element) {
      return '';
    }

    if (element.type === 'text') {
      return coerceText(element.content);
    }

    if (element.type === 'cdata') {
      return coerceText(element.content);
    }

    if (element.type !== 'element' || !Array.isArray(element.children)) {
      return '';
    }

    let output = '';

    for (const child of element.children) {
      output += collectElementText(child);
    }

    return output;
  }

  function elementHasElementChildren(element) {
    if (!element || !Array.isArray(element.children)) {
      return false;
    }

    for (const child of element.children) {
      if (child && child.type === 'element') {
        return true;
      }
    }

    return false;
  }

  function elementHasCdataChild(element) {
    if (!element || !Array.isArray(element.children)) {
      return false;
    }

    for (const child of element.children) {
      if (child && child.type === 'cdata') {
        return true;
      }
    }

    return false;
  }

  function normalizeMultilineString(value) {
    const source = coerceText(value);

    if (!source) {
      return '';
    }

    return source.replace(/\r\n?/g, '\n').replace(/^\s+|\s+$/g, '');
  }

  function parseExecutorOutput(rawText, options) {
    const config = normalizeParseOptions(options);
    const collectionResult = safeEnsureCollection(rawText, options);

    if (!collectionResult.ok) {
      return createParseResult(
        'file',
        'xml_file',
        false,
        null,
        null,
        [collectionResult.error],
        [],
        [],
        { parser: 'executor_output' }
      );
    }

    const collection = collectionResult.collection;
    const attempts = [];
    const sharedWarnings = collection.warnings.slice();
    let lastErrors = [];

    for (const candidate of collection.candidates) {
      if (candidate.sourceType === 'fenced_block'
        && candidate.language
        && !languageMatches(candidate.language, 'xml')) {
        continue;
      }

      if (!looksLikeXml(candidate.text)) {
        continue;
      }

      const xmlResult = parseXmlDocument(candidate.text, {
        allowHtmlEscapedXml: config.allowHtmlEscapedXml,
        xmlDeclarationAllowed: config.xmlDeclarationAllowed,
        maxPayloadChars: config.maxPayloadChars,
        maxNodes: config.maxNodes
      });

      if (!xmlResult.ok) {
        attempts.push(createAttemptSummary(candidate, false, { stage: 'xml_parse' }, xmlResult.errors, xmlResult.warnings));
        lastErrors = xmlResult.errors;
        continue;
      }

      const tree = xmlResult.tree;

      if (!tree || tree.type !== 'element' || tree.name !== FILE_ROOT_TAG) {
        const rootError = createParseError(
          INTERNAL_CODES.UNEXPECTED_ROOT,
          'Expected root element <' + FILE_ROOT_TAG + '>.',
          { actualRoot: tree ? tree.name : '' }
        );
        attempts.push(createAttemptSummary(candidate, false, { stage: 'root_check' }, [rootError], xmlResult.warnings));
        lastErrors = [rootError];
        continue;
      }

      const pathAttribute = config.pathAttribute || FILE_PATH_ATTRIBUTE;
      const rawPath = hasOwn(tree.attributes, pathAttribute) ? tree.attributes[pathAttribute] : '';

      if (!normalizeString(rawPath)) {
        const pathError = createParseError(
          INTERNAL_CODES.INVALID_FILE_PATH,
          'File element is missing the ' + pathAttribute + ' attribute.',
          { attribute: pathAttribute }
        );
        attempts.push(createAttemptSummary(candidate, false, { stage: 'path_attribute' }, [pathError], xmlResult.warnings));
        lastErrors = [pathError];
        continue;
      }

      let normalizedPath;

      try {
        normalizedPath = normalizeFilePath(rawPath);
      } catch (error) {
        const pathError = createParseError(
          normalizeString(error && error.code) || INTERNAL_CODES.INVALID_FILE_PATH,
          normalizeString(error && error.message) || 'Invalid file path.',
          isPlainObject(error && error.details) ? error.details : { value: rawPath }
        );
        attempts.push(createAttemptSummary(candidate, false, { stage: 'path_normalize' }, [pathError], xmlResult.warnings));
        lastErrors = [pathError];
        continue;
      }

      if (config.expectedPath) {
        let normalizedExpected = '';

        try {
          normalizedExpected = normalizeFilePath(config.expectedPath);
        } catch (error) {
          normalizedExpected = '';
        }

        if (normalizedExpected && normalizedExpected !== normalizedPath) {
          const mismatchError = createParseError(
            INTERNAL_CODES.INVALID_FILE_PATH,
            'File path does not match the expected target path.',
            { expectedPath: normalizedExpected, actualPath: normalizedPath }
          );
          attempts.push(createAttemptSummary(candidate, false, { stage: 'path_match' }, [mismatchError], xmlResult.warnings));
          lastErrors = [mismatchError];
          continue;
        }
      }

      if (elementHasElementChildren(tree)) {
        const structuralError = createParseError(
          INTERNAL_CODES.FILE_CONTENT_MIXED_NODES,
          'File element must not contain nested elements.',
          { rootTag: FILE_ROOT_TAG }
        );
        attempts.push(createAttemptSummary(candidate, false, { stage: 'structure' }, [structuralError], xmlResult.warnings));
        lastErrors = [structuralError];
        continue;
      }

      const hasCdata = elementHasCdataChild(tree);

      if (config.cdataRequired && !hasCdata) {
        const cdataError = createParseError(
          INTERNAL_CODES.FILE_CONTENT_MIXED_NODES,
          'File content must be wrapped in a CDATA section.',
          { rootTag: FILE_ROOT_TAG }
        );
        attempts.push(createAttemptSummary(candidate, false, { stage: 'cdata_required' }, [cdataError], xmlResult.warnings));
        lastErrors = [cdataError];
        continue;
      }

      const content = collectElementText(tree);

      if (content.indexOf(CDATA_CLOSE) >= 0) {
        const cdataEndError = createParseError(
          INTERNAL_CODES.CONTENT_CONTAINS_CDATA_END,
          'File content contains a CDATA end marker.',
          { rootTag: FILE_ROOT_TAG }
        );
        attempts.push(createAttemptSummary(candidate, false, { stage: 'cdata_end_check' }, [cdataEndError], xmlResult.warnings));
        lastErrors = [cdataEndError];
        continue;
      }

      const payload = deepFreeze({
        kind: 'file',
        format: 'xml_file',
        path: normalizedPath,
        content: content,
        contentLength: content.length,
        hasCdata: hasCdata,
        rootTag: FILE_ROOT_TAG,
        pathAttribute: pathAttribute
      });

      attempts.push(createAttemptSummary(candidate, true, { stage: 'success' }, [], xmlResult.warnings));

      return createParseResult(
        'file',
        'xml_file',
        true,
        candidate,
        payload,
        [],
        mergeIssueArrays(sharedWarnings, xmlResult.warnings),
        attempts,
        { parser: 'executor_output' }
      );
    }

    const fallbackError = lastErrors.length > 0
      ? lastErrors
      : [createParseError(
          INTERNAL_CODES.FILE_NOT_FOUND,
          'No <' + FILE_ROOT_TAG + '> element could be parsed from the payload.',
          createNullObject()
        )];

    return createParseResult(
      'file',
      'xml_file',
      false,
      null,
      null,
      fallbackError,
      sharedWarnings,
      attempts,
      { parser: 'executor_output' }
    );
  }

  function parseReviewOutput(rawText, options) {
    const config = normalizeParseOptions(options);
    const collectionResult = safeEnsureCollection(rawText, options);

    if (!collectionResult.ok) {
      return createParseResult(
        'review',
        'xml_review',
        false,
        null,
        null,
        [collectionResult.error],
        [],
        [],
        { parser: 'review_output' }
      );
    }

    const collection = collectionResult.collection;
    const attempts = [];
    const sharedWarnings = collection.warnings.slice();
    let lastErrors = [];

    for (const candidate of collection.candidates) {
      if (candidate.sourceType === 'fenced_block'
        && candidate.language
        && !languageMatches(candidate.language, 'xml')) {
        continue;
      }

      if (!looksLikeXml(candidate.text)) {
        continue;
      }

      const xmlResult = parseXmlDocument(candidate.text, {
        allowHtmlEscapedXml: config.allowHtmlEscapedXml,
        xmlDeclarationAllowed: config.xmlDeclarationAllowed,
        maxPayloadChars: config.maxPayloadChars,
        maxNodes: config.maxNodes
      });

      if (!xmlResult.ok) {
        attempts.push(createAttemptSummary(candidate, false, { stage: 'xml_parse' }, xmlResult.errors, xmlResult.warnings));
        lastErrors = xmlResult.errors;
        continue;
      }

      const tree = xmlResult.tree;

      if (!tree || tree.type !== 'element' || tree.name !== REVIEW_ROOT_TAG) {
        const rootError = createParseError(
          INTERNAL_CODES.UNEXPECTED_ROOT,
          'Expected root element <' + REVIEW_ROOT_TAG + '>.',
          { actualRoot: tree ? tree.name : '' }
        );
        attempts.push(createAttemptSummary(candidate, false, { stage: 'root_check' }, [rootError], xmlResult.warnings));
        lastErrors = [rootError];
        continue;
      }

      const verdictElement = getFirstElementChild(tree, 'verdict');
      const verdictFromAttribute = hasOwn(tree.attributes, 'verdict')
        ? normalizeVerdict(tree.attributes.verdict)
        : '';
      const verdictFromElement = verdictElement
        ? normalizeVerdict(collectElementText(verdictElement))
        : '';
      const verdict = verdictFromElement || verdictFromAttribute;

      if (!verdict) {
        const verdictError = createParseError(
          INTERNAL_CODES.REVIEW_MISSING_VERDICT,
          'Review element is missing a valid verdict.',
          { allowed: REVIEW_VERDICTS.slice() }
        );
        attempts.push(createAttemptSummary(candidate, false, { stage: 'verdict' }, [verdictError], xmlResult.warnings));
        lastErrors = [verdictError];
        continue;
      }

      if (verdictElement
        && verdictFromAttribute
        && verdictFromElement
        && verdictFromAttribute !== verdictFromElement) {
        const conflictError = createParseError(
          INTERNAL_CODES.REVIEW_CONFLICTING_VERDICT,
          'Review verdict attribute and element disagree.',
          { attribute: verdictFromAttribute, element: verdictFromElement }
        );
        attempts.push(createAttemptSummary(candidate, false, { stage: 'verdict_conflict' }, [conflictError], xmlResult.warnings));
        lastErrors = [conflictError];
        continue;
      }

      const summaryElement = getFirstElementChild(tree, 'summary');
      const summary = normalizeMultilineString(summaryElement ? collectElementText(summaryElement) : '');

      if (config.requireSummary && !summary) {
        const summaryError = createParseError(
          INTERNAL_CODES.REVIEW_MISSING_SUMMARY,
          'Review element is missing a non-empty summary.',
          createNullObject()
        );
        attempts.push(createAttemptSummary(candidate, false, { stage: 'summary' }, [summaryError], xmlResult.warnings));
        lastErrors = [summaryError];
        continue;
      }

      const findingsContainer = getFirstElementChild(tree, 'findings');
      const findingElements = findingsContainer
        ? getElementChildren(findingsContainer, 'finding')
        : getElementChildren(tree, 'finding');
      const findings = [];

      for (const findingElement of findingElements) {
        if (findings.length >= MAX_REVIEW_FINDINGS) {
          break;
        }

        const severity = normalizeString(
          hasOwn(findingElement.attributes, 'severity')
            ? findingElement.attributes.severity
            : ''
        );
        const target = normalizeString(
          hasOwn(findingElement.attributes, 'target')
            ? findingElement.attributes.target
            : (hasOwn(findingElement.attributes, 'path')
              ? findingElement.attributes.path
              : '')
        );
        const message = normalizeMultilineString(collectElementText(findingElement));

        if (!message) {
          continue;
        }

        findings.push(deepFreeze({
          severity: severity,
          target: target,
          message: message
        }));
      }

      const payload = deepFreeze({
        kind: 'review',
        format: 'xml_review',
        verdict: verdict,
        summary: summary,
        findings: findings,
        rootTag: REVIEW_ROOT_TAG
      });

      attempts.push(createAttemptSummary(candidate, true, { stage: 'success' }, [], xmlResult.warnings));

      return createParseResult(
        'review',
        'xml_review',
        true,
        candidate,
        payload,
        [],
        mergeIssueArrays(sharedWarnings, xmlResult.warnings),
        attempts,
        { parser: 'review_output' }
      );
    }

    const fallbackError = lastErrors.length > 0
      ? lastErrors
      : [createParseError(
          INTERNAL_CODES.REVIEW_NOT_FOUND,
          'No <' + REVIEW_ROOT_TAG + '> element could be parsed from the payload.',
          createNullObject()
        )];

    return createParseResult(
      'review',
      'xml_review',
      false,
      null,
      null,
      fallbackError,
      sharedWarnings,
      attempts,
      { parser: 'review_output' }
    );
  }

  function tryParseJsonObject(text) {
    const source = stripBom(coerceText(text)).trim();

    if (!source) {
      return null;
    }

    try {
      const parsed = JSON.parse(source);
      return isPlainObject(parsed) ? parsed : null;
    } catch (error) {
      return null;
    }
  }

  function normalizePacketCandidate(parsedValue) {
    if (!isPlainObject(parsedValue)) {
      return null;
    }

    if (protocol && typeof protocol.validatePacket === 'function') {
      try {
        const validation = protocol.validatePacket(parsedValue);

        if (validation && validation.valid) {
          return validation.normalized;
        }

        return null;
      } catch (error) {
        return null;
      }
    }

    const requiredFields = (constants.MANUAL_HUB
      && constants.MANUAL_HUB.REQUIRED_FIELDS
      && Array.isArray(constants.MANUAL_HUB.REQUIRED_FIELDS.ENVELOPE))
      ? constants.MANUAL_HUB.REQUIRED_FIELDS.ENVELOPE
      : ['protocolVersion', 'packetType', 'requestId', 'createdAt', 'source', 'target', 'payload'];

    for (const field of requiredFields) {
      if (!hasOwn(parsedValue, field)) {
        return null;
      }
    }

    return parsedValue;
  }

  function parsePacketPayload(rawText) {
    const collectionResult = safeEnsureCollection(rawText, { collection: null });

    if (!collectionResult.ok) {
      return createParseResult(
        'packet',
        'json_packet',
        false,
        null,
        null,
        [collectionResult.error],
        [],
        [],
        { parser: 'packet_payload' }
      );
    }

    const collection = collectionResult.collection;
    const attempts = [];
    const sharedWarnings = collection.warnings.slice();
    let lastErrors = [];

    if (protocol && typeof protocol.parsePacketText === 'function') {
      try {
        const delimited = protocol.parsePacketText(rawText);

        if (delimited && delimited.valid && isPlainObject(delimited.normalized)) {
          const payload = { packet: cloneValue(delimited.normalized) };

          return createParseResult(
            'packet',
            'json_packet',
            true,
            null,
            payload,
            [],
            sharedWarnings,
            attempts,
            { parser: 'packet_payload', mode: 'delimited_envelope' }
          );
        }

        if (delimited && Array.isArray(delimited.errors) && delimited.errors.length > 0) {
          lastErrors = delimited.errors.map(function mapError(entry) {
            return createParseError(
              normalizeString(entry && entry.code) || INTERNAL_CODES.INVALID_PACKET,
              normalizeString(entry && entry.message) || 'Invalid packet envelope.',
              isPlainObject(entry && entry.details) ? entry.details : createNullObject()
            );
          });
        }
      } catch (error) {
        lastErrors = [createParseError(
          normalizeString(error && error.code) || INTERNAL_CODES.INVALID_PACKET,
          normalizeString(error && error.message) || 'Failed to parse packet envelope.',
          createNullObject()
        )];
      }
    }

    for (const candidate of collection.candidates) {
      if (candidate.sourceType === 'fenced_block'
        && candidate.language
        && !languageMatches(candidate.language, 'json')) {
        continue;
      }

      if (!looksLikeJsonObject(candidate.text)) {
        continue;
      }

      const parsed = tryParseJsonObject(candidate.text);

      if (!parsed) {
        const jsonError = createParseError(
          INTERNAL_CODES.INVALID_PACKET,
          'Candidate is not a valid JSON object.',
          createNullObject()
        );
        attempts.push(createAttemptSummary(candidate, false, { stage: 'json_parse' }, [jsonError], []));
        lastErrors = [jsonError];
        continue;
      }

      const normalized = normalizePacketCandidate(parsed);

      if (!normalized) {
        const shapeError = createParseError(
          INTERNAL_CODES.INVALID_PACKET,
          'JSON object does not match the MAOE packet envelope shape.',
          createNullObject()
        );
        attempts.push(createAttemptSummary(candidate, false, { stage: 'envelope_shape' }, [shapeError], []));
        lastErrors = [shapeError];
        continue;
      }

      const payload = { packet: cloneValue(normalized) };

      attempts.push(createAttemptSummary(candidate, true, { stage: 'success' }, [], []));

      return createParseResult(
        'packet',
        'json_packet',
        true,
        candidate,
        payload,
        [],
        sharedWarnings,
        attempts,
        { parser: 'packet_payload', mode: 'json_candidate' }
      );
    }

    const fallbackError = lastErrors.length > 0
      ? lastErrors
      : [createParseError(
          INTERNAL_CODES.PACKET_NOT_FOUND,
          'No MAOE packet envelope could be parsed from the payload.',
          createNullObject()
        )];

    return createParseResult(
      'packet',
      'json_packet',
      false,
      null,
      null,
      fallbackError,
      sharedWarnings,
      attempts,
      { parser: 'packet_payload' }
    );
  }

  const publicApi = {
    parseXmlDocument: parseXmlDocument,
    parseExecutorOutput: parseExecutorOutput,
    parseReviewOutput: parseReviewOutput,
    parsePacketPayload: parsePacketPayload,
    buildCandidateCollection: buildCandidateCollection,
    ensureCollection: ensureCollection,
    safeEnsureCollection: safeEnsureCollection,
    helpers: {
      normalizeFenceLanguage: normalizeFenceLanguage,
      getLanguageFamily: getLanguageFamily,
      languageMatches: languageMatches,
      isSupportedFenceLanguage: isSupportedFenceLanguage,
      normalizeParseOptions: normalizeParseOptions,
      decodeXmlEntities: decodeXmlEntities,
      encodeXmlAttributeValue: encodeXmlAttributeValue,
      encodeXmlText: encodeXmlText,
      looksLikeXml: looksLikeXml,
      looksLikeJsonObject: looksLikeJsonObject,
      guessXmlRootTag: guessXmlRootTag,
      normalizeFilePath: normalizeFilePath,
      normalizeVerdict: normalizeVerdict
    }
  };

  root.registerValue('ai_payload_parser', publicApi, {
    overwrite: false,
    freeze: false,
    clone: false
  });
}(typeof globalThis !== 'undefined'
  ? globalThis
  : (typeof self !== 'undefined'
    ? self
    : (typeof window !== 'undefined' ? window : this))));
