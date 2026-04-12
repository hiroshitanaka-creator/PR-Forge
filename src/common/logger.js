(function registerMAOELogger(globalScope) {
  'use strict';

  const root = globalScope.MAOE;

  if (!root || typeof root.registerValue !== 'function') {
    throw new Error('[MAOE] namespace.js must be loaded before logger.js.');
  }

  if (root.has('logger')) {
    return;
  }

  if (!root.has('constants')) {
    throw new Error('[MAOE] constants.js must be loaded before logger.js.');
  }

  const constants = root.require('constants');
  const util = root.util || Object.create(null);

  const hasOwn = typeof util.hasOwn === 'function'
    ? util.hasOwn
    : function fallbackHasOwn(target, key) {
        return Object.prototype.hasOwnProperty.call(target, key);
      };

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

  const LOGGING = constants.LOGGING || Object.create(null);
  const ERROR_CODES = constants.ERROR_CODES || Object.create(null);

  const LEVELS = {
    DEBUG: LOGGING.LEVELS && LOGGING.LEVELS.DEBUG ? LOGGING.LEVELS.DEBUG : 'debug',
    INFO: LOGGING.LEVELS && LOGGING.LEVELS.INFO ? LOGGING.LEVELS.INFO : 'info',
    WARN: LOGGING.LEVELS && LOGGING.LEVELS.WARN ? LOGGING.LEVELS.WARN : 'warn',
    ERROR: LOGGING.LEVELS && LOGGING.LEVELS.ERROR ? LOGGING.LEVELS.ERROR : 'error'
  };

  const LEVEL_PRIORITY = Object.create(null);
  LEVEL_PRIORITY[LEVELS.DEBUG] = 10;
  LEVEL_PRIORITY[LEVELS.INFO] = 20;
  LEVEL_PRIORITY[LEVELS.WARN] = 30;
  LEVEL_PRIORITY[LEVELS.ERROR] = 40;

  const MAX_ENTRIES = Number.isFinite(Number(LOGGING.MAX_ENTRIES))
    ? Math.max(1, Math.trunc(Number(LOGGING.MAX_ENTRIES)))
    : 250;

  const MAX_STRING_LENGTH = Number.isFinite(Number(LOGGING.MAX_STRING_LENGTH))
    ? Math.max(16, Math.trunc(Number(LOGGING.MAX_STRING_LENGTH)))
    : 4000;

  const DEFAULT_LEVEL = typeof LOGGING.DEFAULT_LEVEL === 'string' && LOGGING.DEFAULT_LEVEL
    ? LOGGING.DEFAULT_LEVEL
    : LEVELS.INFO;

  const REDACTION_TEXT = typeof LOGGING.REDACTION_TEXT === 'string' && LOGGING.REDACTION_TEXT
    ? LOGGING.REDACTION_TEXT
    : '[REDACTED]';

  const SENSITIVE_KEYS = Array.isArray(LOGGING.SENSITIVE_KEYS)
    ? LOGGING.SENSITIVE_KEYS.map(function mapKey(key) {
        return typeof key === 'string' ? key.toLowerCase() : '';
      }).filter(Boolean)
    : [];

  const SENSITIVE_VALUE_PATTERNS = Array.isArray(LOGGING.SENSITIVE_VALUE_PATTERNS)
    ? LOGGING.SENSITIVE_VALUE_PATTERNS.filter(function filterPattern(pattern) {
        return pattern instanceof RegExp;
      })
    : [];

  const stateBucket = root.ensureState('logger', function initializeLoggerState() {
    return {
      entries: [],
      listeners: [],
      sequence: 0,
      minimumLevel: DEFAULT_LEVEL,
      mirrorToConsole: true,
      createdAt: new Date().toISOString()
    };
  });

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

  function clampString(value, maxLength) {
    const normalized = typeof value === 'string' ? value : String(value == null ? '' : value);

    if (!Number.isFinite(maxLength) || maxLength <= 0 || normalized.length <= maxLength) {
      return normalized;
    }

    return normalized.slice(0, maxLength) + '…';
  }

  function levelPriority(level) {
    const normalized = normalizeLevel(level);
    return hasOwn(LEVEL_PRIORITY, normalized) ? LEVEL_PRIORITY[normalized] : LEVEL_PRIORITY[DEFAULT_LEVEL];
  }

  function normalizeLevel(level) {
    const value = normalizeString(level).toLowerCase();

    if (value === LEVELS.DEBUG || value === LEVELS.INFO || value === LEVELS.WARN || value === LEVELS.ERROR) {
      return value;
    }

    return DEFAULT_LEVEL;
  }

  function normalizeScope(scope) {
    const normalized = normalizeString(scope);

    if (!normalized) {
      return 'root';
    }

    return normalized
      .replace(/\s+/g, '.')
      .replace(/\.+/g, '.')
      .replace(/^\.+|\.+$/g, '') || 'root';
  }

  function joinScopes(parentScope, childScope) {
    const parent = normalizeScope(parentScope);
    const child = normalizeScope(childScope);

    if (parent === 'root') {
      return child;
    }

    if (child === 'root') {
      return parent;
    }

    return parent + '.' + child;
  }

  function createSequenceId() {
    stateBucket.sequence += 1;
    return stateBucket.sequence;
  }

  function createEntryId() {
    return 'log_' + Date.now().toString(36) + '_' + createSequenceId().toString(36);
  }

  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function isSensitiveKeyName(key) {
    const normalizedKey = normalizeString(key).toLowerCase();

    if (!normalizedKey) {
      return false;
    }

    if (SENSITIVE_KEYS.indexOf(normalizedKey) >= 0) {
      return true;
    }

    for (const sensitiveKey of SENSITIVE_KEYS) {
      if (normalizedKey === sensitiveKey) {
        return true;
      }

      if (normalizedKey.indexOf(sensitiveKey) >= 0) {
        return true;
      }
    }

    return false;
  }

  function redactStringValue(value) {
    let result = typeof value === 'string' ? value : String(value);

    for (const pattern of SENSITIVE_VALUE_PATTERNS) {
      try {
        result = result.replace(pattern, REDACTION_TEXT);
      } catch (error) {}
    }

    return clampString(result, MAX_STRING_LENGTH);
  }

  function redactSensitivePair(key, value) {
    if (isSensitiveKeyName(key)) {
      return REDACTION_TEXT;
    }

    if (typeof value === 'string') {
      return redactStringValue(value);
    }

    return value;
  }

  function sanitizeError(error, seen) {
    const activeSeen = seen || new WeakSet();
    const details = Object.create(null);

    if (error && typeof error === 'object') {
      if (activeSeen.has(error)) {
        return {
          name: 'CircularError',
          message: '[Circular]'
        };
      }

      activeSeen.add(error);
    }

    details.name = error && typeof error.name === 'string' ? error.name : 'Error';
    details.message = error && typeof error.message === 'string'
      ? redactStringValue(error.message)
      : '';
    details.stack = error && typeof error.stack === 'string'
      ? redactStringValue(error.stack)
      : '';
    details.code = error && typeof error.code === 'string'
      ? clampString(error.code, 128)
      : '';

    if (error && isPlainObject(error.details)) {
      details.details = sanitizeValue(error.details, activeSeen, 0, '');
    }

    return details;
  }

  function sanitizeFunction(value) {
    return '[Function ' + (value.name || 'anonymous') + ']';
  }

  function sanitizePrimitive(value) {
    if (typeof value === 'string') {
      return redactStringValue(value);
    }

    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : String(value);
    }

    if (typeof value === 'bigint') {
      return String(value) + 'n';
    }

    if (typeof value === 'symbol') {
      return String(value);
    }

    return value;
  }

  function sanitizeArray(value, seen, depth, parentKey) {
    const result = [];
    const limit = Math.min(value.length, 100);

    for (let index = 0; index < limit; index += 1) {
      const item = value[index];
      result.push(sanitizeValue(item, seen, depth + 1, parentKey));
    }

    if (value.length > limit) {
      result.push('[Truncated ' + String(value.length - limit) + ' items]');
    }

    return result;
  }

  function sanitizeMap(value, seen, depth, parentKey) {
    const result = [];
    let count = 0;

    for (const entry of value.entries()) {
      count += 1;

      if (count > 100) {
        result.push('[Truncated ' + String(value.size - 100) + ' entries]');
        break;
      }

      result.push([
        sanitizeValue(entry[0], seen, depth + 1, parentKey),
        sanitizeValue(entry[1], seen, depth + 1, parentKey)
      ]);
    }

    return {
      type: 'Map',
      size: value.size,
      entries: result
    };
  }

  function sanitizeSet(value, seen, depth, parentKey) {
    const result = [];
    let count = 0;

    for (const item of value.values()) {
      count += 1;

      if (count > 100) {
        result.push('[Truncated ' + String(value.size - 100) + ' items]');
        break;
      }

      result.push(sanitizeValue(item, seen, depth + 1, parentKey));
    }

    return {
      type: 'Set',
      size: value.size,
      values: result
    };
  }

  function sanitizeObject(value, seen, depth) {
    const result = Object.create(null);
    const keys = Object.keys(value);
    const limit = Math.min(keys.length, 100);

    for (let index = 0; index < limit; index += 1) {
      const key = keys[index];
      const entryValue = value[key];

      if (isSensitiveKeyName(key)) {
        result[key] = REDACTION_TEXT;
        continue;
      }

      result[key] = sanitizeValue(entryValue, seen, depth + 1, key);
    }

    if (keys.length > limit) {
      result.__truncated__ = '[Truncated ' + String(keys.length - limit) + ' keys]';
    }

    return result;
  }

  function sanitizeValue(value, seen, depth, parentKey) {
    const activeSeen = seen || new WeakSet();
    const currentDepth = Number.isFinite(Number(depth)) ? Number(depth) : 0;
    const keyHint = normalizeString(parentKey);

    if (isSensitiveKeyName(keyHint)) {
      return REDACTION_TEXT;
    }

    if (value === null || typeof value === 'undefined') {
      return value;
    }

    if (typeof value === 'string'
      || typeof value === 'number'
      || typeof value === 'boolean'
      || typeof value === 'bigint'
      || typeof value === 'symbol') {
      return sanitizePrimitive(value);
    }

    if (typeof value === 'function') {
      return sanitizeFunction(value);
    }

    if (value instanceof Error) {
      return sanitizeError(value, activeSeen);
    }

    if (value instanceof Date) {
      return isNaN(value.getTime()) ? 'Invalid Date' : value.toISOString();
    }

    if (value instanceof RegExp) {
      return String(value);
    }

    if (currentDepth >= 8) {
      return '[MaxDepthExceeded]';
    }

    if (typeof value === 'object') {
      if (activeSeen.has(value)) {
        return '[Circular]';
      }

      activeSeen.add(value);
    }

    if (Array.isArray(value)) {
      return sanitizeArray(value, activeSeen, currentDepth, keyHint);
    }

    if (value instanceof Map) {
      return sanitizeMap(value, activeSeen, currentDepth, keyHint);
    }

    if (value instanceof Set) {
      return sanitizeSet(value, activeSeen, currentDepth, keyHint);
    }

    if (isPlainObject(value)) {
      return sanitizeObject(value, activeSeen, currentDepth);
    }

    try {
      return redactStringValue(String(value));
    } catch (error) {
      return '[Unserializable]';
    }
  }

  function normalizeContext(context) {
    if (typeof context === 'undefined') {
      return Object.create(null);
    }

    if (context instanceof Error) {
      return Object.freeze({
        error: sanitizeError(context)
      });
    }

    if (isPlainObject(context)) {
      return deepFreeze(sanitizeObject(context, new WeakSet(), 0));
    }

    return deepFreeze({
      value: sanitizeValue(context, new WeakSet(), 0, '')
    });
  }

  function createMeta(meta) {
    const source = isPlainObject(meta) ? meta : Object.create(null);
    const output = Object.create(null);

    for (const key of Object.keys(source)) {
      const value = source[key];

      if (typeof value === 'undefined') {
        continue;
      }

      if (isSensitiveKeyName(key)) {
        output[key] = REDACTION_TEXT;
        continue;
      }

      if (typeof value === 'string') {
        output[key] = redactStringValue(value);
        continue;
      }

      output[key] = sanitizeValue(value, new WeakSet(), 0, key);
    }

    return deepFreeze(output);
  }

  function shouldEmit(level) {
    return levelPriority(level) >= levelPriority(stateBucket.minimumLevel);
  }

  function getConsoleMethod(level) {
    if (level === LEVELS.DEBUG) {
      return 'debug';
    }

    if (level === LEVELS.INFO) {
      return 'info';
    }

    if (level === LEVELS.WARN) {
      return 'warn';
    }

    return 'error';
  }

  function buildConsolePrefix(entry) {
    return '[MAOE][' + entry.level.toUpperCase() + '][' + entry.scope + '] ' + entry.message;
  }

  function emitToConsole(entry) {
    if (stateBucket.mirrorToConsole !== true) {
      return;
    }

    if (typeof console === 'undefined') {
      return;
    }

    const method = getConsoleMethod(entry.level);

    if (typeof console[method] !== 'function') {
      return;
    }

    const prefix = buildConsolePrefix(entry);
    const contextKeys = Object.keys(entry.context || Object.create(null));

    try {
      if (contextKeys.length === 0) {
        console[method](prefix);
        return;
      }

      console[method](prefix, cloneValue(entry.context));
    } catch (error) {
      try {
        console.log(prefix);
      } catch (consoleError) {}
    }
  }

  function cloneEntry(entry) {
    return {
      id: entry.id,
      seq: entry.seq,
      at: entry.at,
      level: entry.level,
      scope: entry.scope,
      message: entry.message,
      context: cloneValue(entry.context),
      meta: cloneValue(entry.meta)
    };
  }

  function notifyListeners(entry) {
    const listeners = stateBucket.listeners.slice();

    for (const listenerRecord of listeners) {
      if (!listenerRecord || typeof listenerRecord.callback !== 'function') {
        continue;
      }

      try {
        listenerRecord.callback(cloneEntry(entry));
      } catch (error) {}
    }
  }

  function appendEntry(entry) {
    stateBucket.entries.push(entry);

    if (stateBucket.entries.length > MAX_ENTRIES) {
      stateBucket.entries.splice(0, stateBucket.entries.length - MAX_ENTRIES);
    }

    emitToConsole(entry);
    notifyListeners(entry);

    return cloneEntry(entry);
  }

  function createLogEntry(level, scope, message, context, meta) {
    const normalizedLevel = normalizeLevel(level);
    const normalizedScope = normalizeScope(scope);
    const normalizedMessage = clampString(
      redactStringValue(normalizeString(message) || '[No message]'),
      MAX_STRING_LENGTH
    );

    return deepFreeze({
      id: createEntryId(),
      seq: stateBucket.sequence,
      at: new Date().toISOString(),
      level: normalizedLevel,
      scope: normalizedScope,
      message: normalizedMessage,
      context: normalizeContext(context),
      meta: createMeta(meta)
    });
  }

  function log(level, scope, message, context, meta) {
    const normalizedLevel = normalizeLevel(level);

    if (!shouldEmit(normalizedLevel)) {
      return null;
    }

    const entry = createLogEntry(normalizedLevel, scope, message, context, meta);
    return appendEntry(entry);
  }

  function parseLogArguments(scope, argsLike, defaultMeta) {
    const args = Array.prototype.slice.call(argsLike || []);
    let message = '[No message]';
    let context = undefined;
    let meta = undefined;

    if (args.length === 1) {
      if (typeof args[0] === 'string') {
        message = args[0];
      } else if (args[0] instanceof Error) {
        message = args[0].message || '[Error]';
        context = args[0];
      } else {
        message = '[Structured log]';
        context = args[0];
      }
    } else if (args.length >= 2) {
      message = typeof args[0] === 'string' ? args[0] : '[Structured log]';
      context = args[1];

      if (args.length >= 3 && isPlainObject(args[2])) {
        meta = args[2];
      }
    }

    if (isPlainObject(defaultMeta)) {
      meta = isPlainObject(meta)
        ? Object.assign(Object.create(null), defaultMeta, meta)
        : Object.assign(Object.create(null), defaultMeta);
    }

    return {
      scope: normalizeScope(scope),
      message: message,
      context: context,
      meta: meta
    };
  }

  function findScopeEntries(scope, options) {
    const normalizedScope = normalizeScope(scope);
    const config = isPlainObject(options) ? options : Object.create(null);
    const exact = config.exact === true;

    return getEntries({
      level: config.level,
      limit: config.limit,
      reverse: config.reverse
    }).filter(function filterEntry(entry) {
      if (exact) {
        return entry.scope === normalizedScope;
      }

      return entry.scope === normalizedScope || entry.scope.indexOf(normalizedScope + '.') === 0;
    });
  }

  function getEntries(options) {
    const config = isPlainObject(options) ? options : Object.create(null);
    const minimumLevel = normalizeLevel(config.level || DEFAULT_LEVEL);
    const reverse = config.reverse !== false;
    const limit = Number.isFinite(Number(config.limit))
      ? Math.max(1, Math.trunc(Number(config.limit)))
      : stateBucket.entries.length;

    let entries = stateBucket.entries.filter(function filterByLevel(entry) {
      return levelPriority(entry.level) >= levelPriority(minimumLevel);
    });

    entries = entries.map(cloneEntry);

    if (reverse) {
      entries.reverse();
    }

    if (entries.length > limit) {
      entries = entries.slice(0, limit);
    }

    return entries;
  }

  function getLastEntry(options) {
    const entries = getEntries(Object.assign(Object.create(null), isPlainObject(options) ? options : Object.create(null), {
      limit: 1
    }));

    return entries.length > 0 ? entries[0] : null;
  }

  function clearEntries() {
    stateBucket.entries.splice(0, stateBucket.entries.length);
  }

  function setMinimumLevel(level) {
    stateBucket.minimumLevel = normalizeLevel(level);
    return stateBucket.minimumLevel;
  }

  function getMinimumLevel() {
    return stateBucket.minimumLevel;
  }

  function setConsoleMirrorEnabled(enabled) {
    stateBucket.mirrorToConsole = enabled === true;
    return stateBucket.mirrorToConsole;
  }

  function isConsoleMirrorEnabled() {
    return stateBucket.mirrorToConsole === true;
  }

  function subscribe(callback) {
    if (typeof callback !== 'function') {
      throw new Error('[MAOE] Logger subscriber must be a function.');
    }

    const record = {
      id: 'listener_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8),
      callback: callback
    };

    stateBucket.listeners.push(record);

    return function unsubscribe() {
      const index = stateBucket.listeners.findIndex(function findListener(candidate) {
        return candidate && candidate.id === record.id;
      });

      if (index >= 0) {
        stateBucket.listeners.splice(index, 1);
      }
    };
  }

  function flushToStorage() {
    if (!root.has('storage')) {
      return Promise.resolve(null);
    }

    const storage = root.require('storage');

    if (!storage || typeof storage.replaceEventLog !== 'function') {
      return Promise.resolve(null);
    }

    const entries = getEntries({
      level: LEVELS.DEBUG,
      reverse: false
    });

    return storage.replaceEventLog(entries).catch(function ignoreStorageError() {
      return null;
    });
  }

  function logError(scope, error, context, meta) {
    const scoped = normalizeScope(scope);
    const baseContext = isPlainObject(context) ? cloneValue(context) : Object.create(null);
    baseContext.error = sanitizeError(error);
    return log(LEVELS.ERROR, scoped, error && error.message ? error.message : '[Error]', baseContext, meta);
  }

  function createScopedLogger(scope, bindings) {
    const normalizedScope = normalizeScope(scope);
    const defaultBindings = isPlainObject(bindings) ? cloneValue(bindings) : Object.create(null);

    function scopedLog(level, argsLike) {
      const parsed = parseLogArguments(normalizedScope, argsLike, defaultBindings);
      return log(level, parsed.scope, parsed.message, parsed.context, parsed.meta);
    }

    return deepFreeze({
      scope: normalizedScope,
      bindings: deepFreeze(cloneValue(defaultBindings)),
      log: function scopedBaseLog(level, message, context, meta) {
        const mergedMeta = isPlainObject(meta)
          ? Object.assign(Object.create(null), cloneValue(defaultBindings), cloneValue(meta))
          : cloneValue(defaultBindings);
        return log(level, normalizedScope, message, context, mergedMeta);
      },
      debug: function scopedDebug() {
        return scopedLog(LEVELS.DEBUG, arguments);
      },
      info: function scopedInfo() {
        return scopedLog(LEVELS.INFO, arguments);
      },
      warn: function scopedWarn() {
        return scopedLog(LEVELS.WARN, arguments);
      },
      error: function scopedError() {
        if (arguments.length > 0 && arguments[0] instanceof Error) {
          return logError(normalizedScope, arguments[0], arguments[1], defaultBindings);
        }

        return scopedLog(LEVELS.ERROR, arguments);
      },
      child: function scopedChild(childScope, childBindings) {
        const mergedBindings = Object.assign(
          Object.create(null),
          cloneValue(defaultBindings),
          isPlainObject(childBindings) ? cloneValue(childBindings) : Object.create(null)
        );

        return createScopedLogger(joinScopes(normalizedScope, childScope), mergedBindings);
      },
      createScope: function scopedCreateScope(childScope, childBindings) {
        return this.child(childScope, childBindings);
      },
      getEntries: function scopedGetEntries(options) {
        return findScopeEntries(normalizedScope, options);
      },
      getLastEntry: function scopedGetLastEntry(options) {
        const entries = findScopeEntries(normalizedScope, Object.assign(Object.create(null), isPlainObject(options) ? options : Object.create(null), {
          limit: 1
        }));
        return entries.length > 0 ? entries[0] : null;
      },
      flushToStorage: flushToStorage
    });
  }

  function normalizeRootLogCall(level, argsLike) {
    const parsed = parseLogArguments('root', argsLike);
    return log(level, parsed.scope, parsed.message, parsed.context, parsed.meta);
  }

  const api = {
    LEVELS: deepFreeze(cloneValue(LEVELS)),
    DEFAULT_LEVEL: DEFAULT_LEVEL,
    REDACTION_TEXT: REDACTION_TEXT,
    log: function apiLog(level, message, context, meta) {
      return log(level, 'root', message, context, meta);
    },
    debug: function apiDebug() {
      return normalizeRootLogCall(LEVELS.DEBUG, arguments);
    },
    info: function apiInfo() {
      return normalizeRootLogCall(LEVELS.INFO, arguments);
    },
    warn: function apiWarn() {
      return normalizeRootLogCall(LEVELS.WARN, arguments);
    },
    error: function apiError() {
      if (arguments.length > 0 && arguments[0] instanceof Error) {
        return logError('root', arguments[0], arguments[1]);
      }

      return normalizeRootLogCall(LEVELS.ERROR, arguments);
    },
    createScope: function apiCreateScope(scope, bindings) {
      return createScopedLogger(scope, bindings);
    },
    getScopedLogger: function apiGetScopedLogger(scope, bindings) {
      return createScopedLogger(scope, bindings);
    },
    child: function apiChild(scope, bindings) {
      return createScopedLogger(scope, bindings);
    },
    logError: function apiLogError(scope, error, context, meta) {
      return logError(scope || 'root', error, context, meta);
    },
    subscribe: subscribe,
    getEntries: getEntries,
    getLastEntry: getLastEntry,
    clearEntries: clearEntries,
    setMinimumLevel: setMinimumLevel,
    getMinimumLevel: getMinimumLevel,
    setConsoleMirrorEnabled: setConsoleMirrorEnabled,
    isConsoleMirrorEnabled: isConsoleMirrorEnabled,
    flushToStorage: flushToStorage,
    helpers: deepFreeze({
      normalizeLevel: normalizeLevel,
      normalizeScope: normalizeScope,
      joinScopes: joinScopes,
      shouldEmit: shouldEmit,
      sanitizeValue: function helperSanitizeValue(value) {
        return sanitizeValue(value, new WeakSet(), 0, '');
      },
      sanitizeError: function helperSanitizeError(error) {
        return sanitizeError(error, new WeakSet());
      },
      isSensitiveKeyName: isSensitiveKeyName,
      redactStringValue: redactStringValue
    })
  };

  try {
    globalScope.addEventListener('error', function onGlobalError(event) {
      if (!event || !event.error) {
        return;
      }

      logError('global', event.error, {
        source: 'window.error',
        filename: event.filename || '',
        lineno: typeof event.lineno === 'number' ? event.lineno : null,
        colno: typeof event.colno === 'number' ? event.colno : null
      }, {
        code: ERROR_CODES.UNKNOWN_ERROR || 'UNKNOWN_ERROR'
      });
    });
  } catch (error) {}

  try {
    globalScope.addEventListener('unhandledrejection', function onUnhandledRejection(event) {
      const reason = event ? event.reason : null;

      if (reason instanceof Error) {
        logError('global', reason, {
          source: 'window.unhandledrejection'
        }, {
          code: ERROR_CODES.UNKNOWN_ERROR || 'UNKNOWN_ERROR'
        });
        return;
      }

      log(LEVELS.ERROR, 'global', '[Unhandled rejection]', {
        source: 'window.unhandledrejection',
        reason: sanitizeValue(reason, new WeakSet(), 0, 'reason')
      }, {
        code: ERROR_CODES.UNKNOWN_ERROR || 'UNKNOWN_ERROR'
      });
    });
  } catch (error) {}

  root.registerValue('logger', deepFreeze(api), {
    overwrite: false,
    freeze: false,
    clone: false
  });
}(typeof globalThis !== 'undefined'
  ? globalThis
  : (typeof self !== 'undefined'
    ? self
    : (typeof window !== 'undefined' ? window : this))));
