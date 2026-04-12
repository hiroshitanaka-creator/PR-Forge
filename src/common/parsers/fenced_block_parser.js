```javascript
(function registerMAOEFencedBlockParser(globalScope) {
  'use strict';

  const root = globalScope.MAOE;

  if (!root || typeof root.registerValue !== 'function') {
    throw new Error('[MAOE] namespace.js must be loaded before fenced_block_parser.js.');
  }

  if (root.has('fenced_block_parser')) {
    return;
  }

  if (!root.has('constants')) {
    throw new Error('[MAOE] constants.js must be loaded before fenced_block_parser.js.');
  }

  const constants = root.require('constants');
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
        consoleObject[level]('[MAOE/fenced_block_parser] ' + message);
        return;
      }

      consoleObject[level]('[MAOE/fenced_block_parser] ' + message, context);
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
        return loggerModule.createScope('fenced_block_parser');
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

  const PARSER = constants.PARSER || Object.create(null);
  const PARSER_LIMITS = PARSER.LIMITS || Object.create(null);
  const MAX_BLOCKS_DEFAULT = Number.isFinite(Number(PARSER_LIMITS.MAX_FENCE_BLOCKS))
    ? Math.max(1, Math.trunc(Number(PARSER_LIMITS.MAX_FENCE_BLOCKS)))
    : 32;

  const SUPPORTED_FENCE_LANGUAGES = Array.isArray(PARSER.SUPPORTED_FENCE_LANGUAGES)
    ? PARSER.SUPPORTED_FENCE_LANGUAGES.slice()
    : ['xml', 'json', 'diff', 'patch', 'text', 'txt', 'markdown', 'md'];

  const OPENING_FENCE_PATTERN = /^[ \t]{0,3}(`{3,}|~{3,})([^\r\n]*)$/;

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

  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function normalizeFenceLanguage(value) {
    const raw = normalizeString(value).toLowerCase();

    if (!raw) {
      return '';
    }

    const cleaned = raw
      .replace(/^language-/, '')
      .replace(/^[\[{(]+/, '')
      .replace(/[\]})]+$/, '');

    if (cleaned === 'txt') {
      return 'text';
    }

    if (cleaned === 'md') {
      return 'markdown';
    }

    return cleaned;
  }

  function getLanguageFamily(value) {
    const normalized = normalizeFenceLanguage(value);

    if (!normalized) {
      return '';
    }

    if (normalized === 'patch' || normalized === 'diff') {
      return 'diff';
    }

    if (normalized === 'text') {
      return 'text';
    }

    if (normalized === 'markdown') {
      return 'markdown';
    }

    return normalized;
  }

  function languageMatches(leftLanguage, rightLanguage) {
    const leftNormalized = normalizeFenceLanguage(leftLanguage);
    const rightNormalized = normalizeFenceLanguage(rightLanguage);

    if (!leftNormalized || !rightNormalized) {
      return false;
    }

    if (leftNormalized === rightNormalized) {
      return true;
    }

    return getLanguageFamily(leftNormalized) === getLanguageFamily(rightNormalized);
  }

  function normalizeLanguageList(value) {
    let candidates = [];

    if (typeof value === 'string') {
      candidates = value.split(',');
    } else if (Array.isArray(value)) {
      candidates = value.slice();
    } else {
      return [];
    }

    const result = [];
    const seen = new Set();

    for (const candidate of candidates) {
      const normalized = normalizeFenceLanguage(candidate);

      if (!normalized) {
        continue;
      }

      const dedupeKey = getLanguageFamily(normalized) || normalized;

      if (seen.has(dedupeKey)) {
        continue;
      }

      seen.add(dedupeKey);
      result.push(normalized);
    }

    return result;
  }

  function supportedLanguageSet() {
    const result = new Set();

    for (const language of SUPPORTED_FENCE_LANGUAGES) {
      const normalized = normalizeFenceLanguage(language);

      if (!normalized) {
        continue;
      }

      result.add(normalized);
    }

    return result;
  }

  const SUPPORTED_LANGUAGE_SET = supportedLanguageSet();

  function isSupportedLanguage(language) {
    const normalized = normalizeFenceLanguage(language);

    if (!normalized) {
      return false;
    }

    return SUPPORTED_LANGUAGE_SET.has(normalized);
  }

  function parseInfoString(infoString) {
    const raw = typeof infoString === 'string' ? infoString : '';
    const trimmed = raw.trim();

    if (!trimmed) {
      return {
        raw: raw,
        text: '',
        language: '',
        normalizedLanguage: '',
        languageFamily: '',
        argumentsText: '',
        tokens: []
      };
    }

    const tokens = trimmed.split(/\s+/).filter(Boolean);
    const firstToken = tokens.length > 0 ? tokens[0] : '';
    const normalizedLanguage = normalizeFenceLanguage(firstToken);
    const argumentsText = firstToken
      ? trimmed.slice(firstToken.length).trim()
      : '';

    return {
      raw: raw,
      text: trimmed,
      language: firstToken,
      normalizedLanguage: normalizedLanguage,
      languageFamily: getLanguageFamily(normalizedLanguage),
      argumentsText: argumentsText,
      tokens: tokens
    };
  }

  function buildLineTable(text) {
    const source = coerceText(text);
    const lines = [];

    if (!source.length) {
      return lines;
    }

    let cursor = 0;
    let index = 0;

    while (cursor < source.length) {
      const start = cursor;

      while (cursor < source.length && source[cursor] !== '\n' && source[cursor] !== '\r') {
        cursor += 1;
      }

      const end = cursor;

      if (cursor < source.length) {
        if (source[cursor] === '\r' && source[cursor + 1] === '\n') {
          cursor += 2;
        } else {
          cursor += 1;
        }
      }

      const endWithTerminator = cursor;

      lines.push({
        index: index,
        number: index + 1,
        start: start,
        end: end,
        endWithTerminator: endWithTerminator,
        content: source.slice(start, end),
        raw: source.slice(start, endWithTerminator)
      });

      index += 1;
    }

    return lines;
  }

  function detectOpeningFence(lineText) {
    const content = typeof lineText === 'string' ? lineText : '';
    const match = OPENING_FENCE_PATTERN.exec(content);

    if (!match) {
      return null;
    }

    const marker = match[1];
    const infoString = match[2] || '';
    const info = parseInfoString(infoString);

    return {
      marker: marker,
      fenceChar: marker.charAt(0),
      fenceLength: marker.length,
      infoString: infoString,
      info: info
    };
  }

  function createClosingFencePattern(fenceChar, fenceLength) {
    const safeChar = escapeRegExp(fenceChar);
    return new RegExp('^[ \t]{0,3}' + safeChar + '{' + String(fenceLength) + ',}[ \t]*$');
  }

  function isClosingFenceLine(lineText, fenceChar, fenceLength) {
    if (typeof lineText !== 'string' || !lineText) {
      return false;
    }

    if (!fenceChar || !Number.isFinite(Number(fenceLength)) || Number(fenceLength) < 3) {
      return false;
    }

    return createClosingFencePattern(fenceChar, fenceLength).test(lineText);
  }

  function createWarning(code, message, details) {
    return deepFreeze({
      code: normalizeString(code) || 'UNKNOWN_WARNING',
      message: normalizeString(message) || 'Warning.',
      details: isPlainObject(details) ? cloneValue(details) : createNullObject()
    });
  }

  function blockMatchesLanguageFilter(block, languages) {
    if (!Array.isArray(languages) || languages.length === 0) {
      return true;
    }

    const normalizedBlockLanguage = normalizeFenceLanguage(block && block.normalizedLanguage);
    const rawBlockLanguage = normalizeFenceLanguage(block && block.language);

    for (const candidate of languages) {
      if (languageMatches(normalizedBlockLanguage, candidate)) {
        return true;
      }

      if (rawBlockLanguage && languageMatches(rawBlockLanguage, candidate)) {
        return true;
      }
    }

    return false;
  }

  function createBlockId(index) {
    return 'fenced_block_' + String(index + 1);
  }

  function buildBlockDescriptor(sourceText, lines, openLineIndex, closeLineIndex, openingFence, blockIndex) {
    const openingLine = lines[openLineIndex];
    const closingLine = closeLineIndex >= 0 ? lines[closeLineIndex] : null;
    const contentStartIndex = openingLine.endWithTerminator;
    const contentEndIndex = closingLine ? closingLine.start : sourceText.length;
    const startIndex = openingLine.start;
    const endIndex = closingLine ? closingLine.endWithTerminator : sourceText.length;
    const content = sourceText.slice(contentStartIndex, contentEndIndex);
    const raw = sourceText.slice(startIndex, endIndex);

    const firstContentLine = closingLine
      ? (closeLineIndex > openLineIndex + 1 ? openLineIndex + 2 : null)
      : (openLineIndex + 2 <= lines.length ? openLineIndex + 2 : null);

    const lastContentLine = closingLine
      ? (closeLineIndex > openLineIndex + 1 ? closeLineIndex : null)
      : (lines.length > openLineIndex ? lines.length : null);

    const contentLineCount = closingLine
      ? Math.max(0, closeLineIndex - openLineIndex - 1)
      : Math.max(0, lines.length - openLineIndex - 1);

    return deepFreeze({
      index: blockIndex,
      id: createBlockId(blockIndex),
      language: openingFence.info.language,
      normalizedLanguage: openingFence.info.normalizedLanguage,
      languageFamily: openingFence.info.languageFamily,
      infoString: openingFence.info.raw,
      infoText: openingFence.info.text,
      infoTokens: openingFence.info.tokens.slice(),
      argumentsText: openingFence.info.argumentsText,
      fenceChar: openingFence.fenceChar,
      fenceLength: openingFence.fenceLength,
      openingFence: openingFence.marker,
      closingFence: closingLine ? closingLine.content.trim() : '',
      openingLine: openingLine.content,
      closingLine: closingLine ? closingLine.content : '',
      hasClosingFence: !!closingLine,
      content: content,
      contentLength: content.length,
      raw: raw,
      rawLength: raw.length,
      ranges: {
        startIndex: startIndex,
        endIndex: endIndex,
        contentStartIndex: contentStartIndex,
        contentEndIndex: contentEndIndex
      },
      lines: {
        opening: openLineIndex + 1,
        closing: closingLine ? closeLineIndex + 1 : null,
        firstContent: firstContentLine,
        lastContent: lastContentLine,
        contentLineCount: contentLineCount
      }
    });
  }

  function normalizeScanOptions(options) {
    const source = isPlainObject(options) ? options : createNullObject();

    return {
      languages: normalizeLanguageList(source.languages),
      maxBlocks: clampPositiveInteger(source.maxBlocks, MAX_BLOCKS_DEFAULT),
      includeUnclosed: normalizeBoolean(source.includeUnclosed, true),
      requireSupportedLanguage: normalizeBoolean(source.requireSupportedLanguage, false),
      logWarnings: normalizeBoolean(source.logWarnings, false)
    };
  }

  function normalizeSelectionOptions(options) {
    const source = isPlainObject(options) ? options : createNullObject();

    return {
      languages: normalizeLanguageList(source.languages),
      requireClosed: normalizeBoolean(source.requireClosed, false),
      requireSupportedLanguage: normalizeBoolean(source.requireSupportedLanguage, false),
      strategy: oneOf(normalizeString(source.strategy).toLowerCase(), ['first', 'latest', 'largest'], 'first'),
      limit: Number.isFinite(Number(source.limit))
        ? Math.max(1, Math.trunc(Number(source.limit)))
        : null
    };
  }

  function filterBlocks(blocks, options) {
    const config = normalizeSelectionOptions(options);
    let result = Array.isArray(blocks) ? blocks.slice() : [];

    result = result.filter(function filterBlock(block) {
      if (!block || typeof block !== 'object') {
        return false;
      }

      if (config.requireClosed && block.hasClosingFence !== true) {
        return false;
      }

      if (config.requireSupportedLanguage && !isSupportedLanguage(block.normalizedLanguage)) {
        return false;
      }

      if (!blockMatchesLanguageFilter(block, config.languages)) {
        return false;
      }

      return true;
    });

    if (config.strategy === 'latest') {
      result.sort(function sortLatest(left, right) {
        return right.ranges.startIndex - left.ranges.startIndex;
      });
    } else if (config.strategy === 'largest') {
      result.sort(function sortLargest(left, right) {
        if (right.contentLength !== left.contentLength) {
          return right.contentLength - left.contentLength;
        }

        return right.ranges.startIndex - left.ranges.startIndex;
      });
    } else {
      result.sort(function sortFirst(left, right) {
        return left.ranges.startIndex - right.ranges.startIndex;
      });
    }

    if (config.limit !== null && result.length > config.limit) {
      result = result.slice(0, config.limit);
    }

    return result;
  }

  function scan(rawText, options) {
    const sourceText = coerceText(rawText);
    const config = normalizeScanOptions(options);
    const lines = buildLineTable(sourceText);
    const blocks = [];
    const warnings = [];
    let lineIndex = 0;
    let truncated = false;
    let unclosedBlockCount = 0;

    while (lineIndex < lines.length) {
      const openingFence = detectOpeningFence(lines[lineIndex].content);

      if (!openingFence) {
        lineIndex += 1;
        continue;
      }

      if (blocks.length >= config.maxBlocks) {
        truncated = true;
        warnings.push(createWarning(
          'MAX_BLOCKS_REACHED',
          'Maximum fenced block count reached.',
          {
            maxBlocks: config.maxBlocks,
            line: lines[lineIndex].number
          }
        ));
        break;
      }

      let closeLineIndex = -1;

      for (let candidateIndex = lineIndex + 1; candidateIndex < lines.length; candidateIndex += 1) {
        if (isClosingFenceLine(lines[candidateIndex].content, openingFence.fenceChar, openingFence.fenceLength)) {
          closeLineIndex = candidateIndex;
          break;
        }
      }

      if (closeLineIndex < 0 && config.includeUnclosed !== true) {
        unclosedBlockCount += 1;
        warnings.push(createWarning(
          'UNCLOSED_FENCE',
          'Unclosed fenced block detected and skipped.',
          {
            line: lines[lineIndex].number,
            language: openingFence.info.normalizedLanguage || '',
            fenceChar: openingFence.fenceChar,
            fenceLength: openingFence.fenceLength
          }
        ));
        break;
      }

      const block = buildBlockDescriptor(
        sourceText,
        lines,
        lineIndex,
        closeLineIndex,
        openingFence,
        blocks.length
      );

      blocks.push(block);

      if (closeLineIndex < 0) {
        unclosedBlockCount += 1;
        warnings.push(createWarning(
          'UNCLOSED_FENCE',
          'Unclosed fenced block detected.',
          {
            line: lines[lineIndex].number,
            language: openingFence.info.normalizedLanguage || '',
            fenceChar: openingFence.fenceChar,
            fenceLength: openingFence.fenceLength
          }
        ));
        break;
      }

      lineIndex = closeLineIndex + 1;
    }

    const filteredBlocks = filterBlocks(blocks, {
      languages: config.languages,
      requireClosed: false,
      requireSupportedLanguage: config.requireSupportedLanguage,
      strategy: 'first'
    });

    const supportedLanguageBlockCount = blocks.filter(function countSupportedLanguage(block) {
      return isSupportedLanguage(block.normalizedLanguage);
    }).length;

    const result = deepFreeze({
      sourceLength: sourceText.length,
      totalLines: lines.length,
      totalBlocksScanned: blocks.length,
      blockCount: filteredBlocks.length,
      truncated: truncated,
      filters: {
        languages: config.languages.slice(),
        includeUnclosed: config.includeUnclosed,
        requireSupportedLanguage: config.requireSupportedLanguage,
        maxBlocks: config.maxBlocks
      },
      blocks: filteredBlocks.slice(),
      warnings: warnings.slice(),
      stats: {
        supportedLanguageBlockCount: supportedLanguageBlockCount,
        unclosedBlockCount: unclosedBlockCount
      }
    });

    if (config.logWarnings && warnings.length > 0) {
      logger.warn('Fenced block scan completed with warnings.', {
        warningCount: warnings.length,
        blockCount: filteredBlocks.length,
        totalBlocksScanned: blocks.length,
        truncated: truncated
      });
    }

    return result;
  }

  function extractBlocks(rawText, options) {
    return scan(rawText, options).blocks;
  }

  function coerceBlocks(source, options) {
    if (Array.isArray(source)) {
      return source.slice();
    }

    if (isPlainObject(source) && Array.isArray(source.blocks)) {
      return source.blocks.slice();
    }

    return scan(source, options).blocks.slice();
  }

  function findBlocksByLanguage(source, languages, options) {
    const config = isPlainObject(options) ? cloneValue(options) : createNullObject();
    config.languages = normalizeLanguageList(languages);
    config.strategy = 'first';
    return filterBlocks(coerceBlocks(source, options), config);
  }

  function getFirstBlock(source, options) {
    const blocks = filterBlocks(coerceBlocks(source, options), Object.assign(createNullObject(), isPlainObject(options) ? options : createNullObject(), {
      strategy: 'first',
      limit: 1
    }));

    return blocks.length > 0 ? blocks[0] : null;
  }

  function getLatestBlock(source, options) {
    const blocks = filterBlocks(coerceBlocks(source, options), Object.assign(createNullObject(), isPlainObject(options) ? options : createNullObject(), {
      strategy: 'latest',
      limit: 1
    }));

    return blocks.length > 0 ? blocks[0] : null;
  }

  function getPreferredBlock(source, options) {
    const blocks = filterBlocks(coerceBlocks(source, options), Object.assign(createNullObject(), isPlainObject(options) ? options : createNullObject(), {
      limit: 1,
      strategy: normalizeString(options && options.strategy).toLowerCase() || 'latest'
    }));

    return blocks.length > 0 ? blocks[0] : null;
  }

  function hasFencedBlock(source, options) {
    return coerceBlocks(source, options).length > 0;
  }

  function hasLanguageBlock(source, languages, options) {
    return findBlocksByLanguage(source, languages, options).length > 0;
  }

  function stripOuterFence(rawText, options) {
    const sourceText = coerceText(rawText);
    const config = isPlainObject(options) ? options : createNullObject();
    const scanResult = scan(sourceText, {
      maxBlocks: 2,
      includeUnclosed: normalizeBoolean(config.includeUnclosed, true),
      logWarnings: false
    });

    if (scanResult.blocks.length !== 1) {
      return deepFreeze({
        ok: false,
        reason: 'BLOCK_COUNT_MISMATCH',
        content: sourceText,
        block: null
      });
    }

    const block = scanResult.blocks[0];
    const leadingText = sourceText.slice(0, block.ranges.startIndex);
    const trailingText = sourceText.slice(block.ranges.endIndex);

    if (leadingText.trim() || trailingText.trim()) {
      return deepFreeze({
        ok: false,
        reason: 'NON_WHITESPACE_OUTSIDE_BLOCK',
        content: sourceText,
        block: block
      });
    }

    if (normalizeBoolean(config.requireClosed, true) && block.hasClosingFence !== true) {
      return deepFreeze({
        ok: false,
        reason: 'UNCLOSED_BLOCK',
        content: sourceText,
        block: block
      });
    }

    return deepFreeze({
      ok: true,
      reason: '',
      content: block.content,
      block: block
    });
  }

  function splitSegments(rawText, sourceOrBlocks) {
    const sourceText = coerceText(rawText);
    const blocks = filterBlocks(coerceBlocks(typeof sourceOrBlocks === 'undefined' ? sourceText : sourceOrBlocks), {
      strategy: 'first'
    });
    const segments = [];
    let cursor = 0;

    for (const block of blocks) {
      if (block.ranges.startIndex > cursor) {
        segments.push(deepFreeze({
          type: 'text',
          text: sourceText.slice(cursor, block.ranges.startIndex),
          startIndex: cursor,
          endIndex: block.ranges.startIndex
        }));
      }

      segments.push(deepFreeze({
        type: 'block',
        text: block.raw,
        startIndex: block.ranges.startIndex,
        endIndex: block.ranges.endIndex,
        block: block
      }));

      cursor = block.ranges.endIndex;
    }

    if (cursor < sourceText.length) {
      segments.push(deepFreeze({
        type: 'text',
        text: sourceText.slice(cursor),
        startIndex: cursor,
        endIndex: sourceText.length
      }));
    }

    return deepFreeze(segments);
  }

  function summarizeBlocks(source, options) {
    const blocks = filterBlocks(coerceBlocks(source, options), Object.assign(createNullObject(), isPlainObject(options) ? options : createNullObject(), {
      strategy: 'first'
    }));

    return deepFreeze(blocks.map(function mapBlock(block) {
      return {
        id: block.id,
        index: block.index,
        language: block.language,
        normalizedLanguage: block.normalizedLanguage,
        languageFamily: block.languageFamily,
        hasClosingFence: block.hasClosingFence,
        contentLength: block.contentLength,
        rawLength: block.rawLength,
        lines: cloneValue(block.lines),
        ranges: cloneValue(block.ranges)
      };
    }));
  }

  const api = {
    scan: scan,
    extractBlocks: extractBlocks,
    findBlocksByLanguage: findBlocksByLanguage,
    getFirstBlock: getFirstBlock,
    getLatestBlock: getLatestBlock,
    getPreferredBlock: getPreferredBlock,
    hasFencedBlock: hasFencedBlock,
    hasLanguageBlock: hasLanguageBlock,
    stripOuterFence: stripOuterFence,
    splitSegments: splitSegments,
    summarizeBlocks: summarizeBlocks,
    helpers: deepFreeze({
      normalizeFenceLanguage: normalizeFenceLanguage,
      getLanguageFamily: getLanguageFamily,
      languageMatches: languageMatches,
      parseInfoString: parseInfoString,
      buildLineTable: buildLineTable,
      detectOpeningFence: detectOpeningFence,
      isClosingFenceLine: isClosingFenceLine,
      createWarning: createWarning,
      isSupportedLanguage: isSupportedLanguage,
      supportedLanguages: SUPPORTED_FENCE_LANGUAGES.slice()
    })
  };

  try {
    logger.debug('Fenced block parser module registered.', {
      supportedLanguages: SUPPORTED_FENCE_LANGUAGES.slice(),
      maxBlocksDefault: MAX_BLOCKS_DEFAULT
    });
  } catch (error) {
  }

  root.registerValue('fenced_block_parser', deepFreeze(api), {
    overwrite: false,
    freeze: false,
    clone: false
  });
}(typeof globalThis !== 'undefined'
  ? globalThis
  : (typeof self !== 'undefined'
    ? self
    : (typeof window !== 'undefined' ? window : this))));

```
