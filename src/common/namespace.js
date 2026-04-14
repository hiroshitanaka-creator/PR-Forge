(function initializeMAOENamespace(globalScope) {
  'use strict';

  const NAMESPACE_NAME = 'MAOE';
  const EXTENSION_NAME = 'Multi-Agent Orchestrator Extension';
  const EXTENSION_SHORT_NAME = 'MAOE';
  const EXTENSION_VERSION = '0.1.0';
  const PROTOCOL_VERSION = '1.0.0';

  if (typeof globalScope !== 'object' && typeof globalScope !== 'function') {
    throw new Error('[MAOE] Global scope is not available.');
  }

  function isObjectLike(value) {
    return value !== null && (typeof value === 'object' || typeof value === 'function');
  }

  const existingRoot = globalScope[NAMESPACE_NAME];

  if (isObjectLike(existingRoot) && existingRoot.__initialized === true) {
    return;
  }

  if (typeof existingRoot !== 'undefined' && !isObjectLike(existingRoot)) {
    throw new Error('[MAOE] Global namespace collision detected: MAOE already exists and is not an object.');
  }

  function hasOwn(target, key) {
    return Object.prototype.hasOwnProperty.call(target, key);
  }

  function isPlainObject(value) {
    if (!isObjectLike(value) || Object.prototype.toString.call(value) !== '[object Object]') {
      return false;
    }

    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }

  function normalizeKey(value, label) {
    if (typeof value !== 'string') {
      throw new TypeError('[MAOE] ' + label + ' must be a non-empty string.');
    }

    const normalized = value.trim();

    if (!normalized) {
      throw new TypeError('[MAOE] ' + label + ' must be a non-empty string.');
    }

    return normalized;
  }

  function valueKind(value) {
    if (value === null) {
      return 'null';
    }

    if (Array.isArray(value)) {
      return 'array';
    }

    if (value instanceof Date) {
      return 'date';
    }

    if (value instanceof RegExp) {
      return 'regexp';
    }

    if (value instanceof Map) {
      return 'map';
    }

    if (value instanceof Set) {
      return 'set';
    }

    return typeof value;
  }

  function isoNow() {
    return new Date().toISOString();
  }

  function cloneValue(value, seen) {
    const activeSeen = seen || new WeakMap();

    if (!isObjectLike(value)) {
      return value;
    }

    if (activeSeen.has(value)) {
      return activeSeen.get(value);
    }

    if (Array.isArray(value)) {
      const arrayClone = [];
      activeSeen.set(value, arrayClone);

      for (let index = 0; index < value.length; index += 1) {
        arrayClone[index] = cloneValue(value[index], activeSeen);
      }

      return arrayClone;
    }

    if (value instanceof Date) {
      return new Date(value.getTime());
    }

    if (value instanceof RegExp) {
      return new RegExp(value.source, value.flags);
    }

    if (value instanceof Map) {
      const mapClone = new Map();
      activeSeen.set(value, mapClone);

      for (const entry of value.entries()) {
        mapClone.set(cloneValue(entry[0], activeSeen), cloneValue(entry[1], activeSeen));
      }

      return mapClone;
    }

    if (value instanceof Set) {
      const setClone = new Set();
      activeSeen.set(value, setClone);

      for (const entry of value.values()) {
        setClone.add(cloneValue(entry, activeSeen));
      }

      return setClone;
    }

    if (isPlainObject(value)) {
      const objectClone = Object.create(Object.getPrototypeOf(value));
      activeSeen.set(value, objectClone);

      for (const key of Object.keys(value)) {
        objectClone[key] = cloneValue(value[key], activeSeen);
      }

      return objectClone;
    }

    return value;
  }

  function deepFreeze(value, seen) {
    const activeSeen = seen || new WeakSet();

    if (!isObjectLike(value) || activeSeen.has(value)) {
      return value;
    }

    activeSeen.add(value);

    if (Array.isArray(value)) {
      for (const item of value) {
        deepFreeze(item, activeSeen);
      }

      return Object.freeze(value);
    }

    if (value instanceof Map) {
      for (const entry of value.entries()) {
        deepFreeze(entry[0], activeSeen);
        deepFreeze(entry[1], activeSeen);
      }

      return Object.freeze(value);
    }

    if (value instanceof Set) {
      for (const item of value.values()) {
        deepFreeze(item, activeSeen);
      }

      return Object.freeze(value);
    }

    for (const key of Reflect.ownKeys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);

      if (!descriptor) {
        continue;
      }

      if ('value' in descriptor) {
        deepFreeze(descriptor.value, activeSeen);
      }
    }

    return Object.freeze(value);
  }

  function safeJsonParse(text, fallbackValue) {
    const fallback = arguments.length >= 2 ? fallbackValue : null;

    if (typeof text !== 'string') {
      return fallback;
    }

    try {
      return JSON.parse(text);
    } catch (error) {
      return fallback;
    }
  }

  function safeJsonStringify(value, space) {
    const indentation = typeof space === 'number' ? space : 2;

    try {
      return JSON.stringify(value, null, indentation);
    } catch (error) {
      const message = error && error.message ? error.message : String(error);
      return JSON.stringify(
        {
          error: 'JSON_SERIALIZATION_FAILED',
          message: message
        },
        null,
        indentation
      );
    }
  }

  function detectRuntimeContext(scope) {
    const hasChromeRuntime =
      typeof chrome !== 'undefined' &&
      !!chrome.runtime &&
      typeof chrome.runtime.id === 'string' &&
      chrome.runtime.id.length > 0;

    const hasWindow = typeof window !== 'undefined' && scope === window;
    const hasDocument = typeof document !== 'undefined' && !!document;
    const hasImportScripts = typeof scope.importScripts === 'function';

    let locationHref = '';

    try {
      if (scope.location && typeof scope.location.href === 'string') {
        locationHref = scope.location.href;
      }
    } catch (error) {
      locationHref = '';
    }

    let type = 'unknown';

    if (hasWindow && hasDocument) {
      type = locationHref.indexOf('chrome-extension://') === 0 ? 'extension_page' : 'content_script';
    } else if (!hasWindow && hasChromeRuntime && hasImportScripts) {
      type = 'service_worker';
    } else if (!hasWindow && hasImportScripts) {
      type = 'worker';
    } else if (!hasWindow && hasChromeRuntime) {
      type = 'extension_worker';
    }

    return {
      type: type,
      hasChromeRuntime: hasChromeRuntime,
      hasWindow: hasWindow,
      hasDocument: hasDocument,
      hasImportScripts: hasImportScripts,
      locationHref: locationHref
    };
  }

  function assert(condition, message) {
    if (!condition) {
      throw new Error('[MAOE] ' + (message || 'Assertion failed.'));
    }
  }

  function normalizeOptions(options) {
    if (typeof options === 'undefined') {
      return {
        overwrite: false,
        freeze: false,
        clone: false
      };
    }

    if (!isPlainObject(options)) {
      throw new TypeError('[MAOE] Options must be a plain object.');
    }

    return {
      overwrite: options.overwrite === true,
      freeze: options.freeze === true,
      clone: options.clone === true
    };
  }

  const root = isObjectLike(existingRoot) ? existingRoot : Object.create(null);
  const registry = isObjectLike(root.registry) && !Array.isArray(root.registry) ? root.registry : Object.create(null);
  const state = isObjectLike(root.state) && !Array.isArray(root.state) ? root.state : Object.create(null);

  const initializedAt =
    isPlainObject(root.meta) && typeof root.meta.initializedAt === 'string'
      ? root.meta.initializedAt
      : isoNow();

  const meta = deepFreeze({
    namespace: NAMESPACE_NAME,
    extensionName: EXTENSION_NAME,
    shortName: EXTENSION_SHORT_NAME,
    version: EXTENSION_VERSION,
    protocolVersion: PROTOCOL_VERSION,
    initializedAt: initializedAt
  });

  const diagnostics = deepFreeze({
    initializedAt: initializedAt,
    lastLoadedAt: isoNow(),
    loadCount:
      isPlainObject(root.diagnostics) && Number.isFinite(root.diagnostics.loadCount)
        ? root.diagnostics.loadCount + 1
        : 1,
    context: detectRuntimeContext(globalScope)
  });

  function has(name) {
    const key = normalizeKey(name, 'module name');
    return hasOwn(registry, key);
  }

  function get(name, fallbackValue) {
    const key = normalizeKey(name, 'module name');
    return hasOwn(registry, key) ? registry[key] : fallbackValue;
  }

  function requireModule(name) {
    const key = normalizeKey(name, 'module name');

    if (!hasOwn(registry, key)) {
      throw new Error('[MAOE] Required module is not registered: ' + key);
    }

    return registry[key];
  }

  function listModules() {
    return Object.keys(registry).sort();
  }

  function registerValue(name, value, options) {
    const key = normalizeKey(name, 'module name');
    const resolvedOptions = normalizeOptions(options);

    if (hasOwn(registry, key) && resolvedOptions.overwrite !== true) {
      throw new Error('[MAOE] Module is already registered: ' + key);
    }

    let finalValue = resolvedOptions.clone ? cloneValue(value) : value;

    if (resolvedOptions.freeze) {
      finalValue = deepFreeze(finalValue);
    }

    registry[key] = finalValue;
    return registry[key];
  }

  function defineModule(name, factory, options) {
    const key = normalizeKey(name, 'module name');
    const resolvedOptions = normalizeOptions(options);

    if (typeof factory !== 'function') {
      throw new TypeError('[MAOE] Module factory must be a function for module: ' + key);
    }

    if (hasOwn(registry, key) && resolvedOptions.overwrite !== true) {
      throw new Error('[MAOE] Module is already registered: ' + key);
    }

    let producedValue;

    try {
      producedValue = factory(root);
    } catch (error) {
      const message = error && error.message ? error.message : String(error);
      throw new Error('[MAOE] Module factory failed for ' + key + ': ' + message);
    }

    if (typeof producedValue === 'undefined') {
      throw new Error('[MAOE] Module factory returned undefined for module: ' + key);
    }

    if (resolvedOptions.clone) {
      producedValue = cloneValue(producedValue);
    }

    if (resolvedOptions.freeze) {
      producedValue = deepFreeze(producedValue);
    }

    registry[key] = producedValue;
    return registry[key];
  }

  function remove(name) {
    const key = normalizeKey(name, 'module name');

    if (!hasOwn(registry, key)) {
      return false;
    }

    delete registry[key];
    return true;
  }

  function hasState(key) {
    const normalizedKey = normalizeKey(key, 'state key');
    return hasOwn(state, normalizedKey);
  }

  function getState(key, fallbackValue) {
    const normalizedKey = normalizeKey(key, 'state key');
    return hasOwn(state, normalizedKey) ? state[normalizedKey] : fallbackValue;
  }

  function setState(key, value) {
    const normalizedKey = normalizeKey(key, 'state key');
    state[normalizedKey] = value;
    return state[normalizedKey];
  }

  function ensureState(key, initializer) {
    const normalizedKey = normalizeKey(key, 'state key');

    if (!hasOwn(state, normalizedKey)) {
      state[normalizedKey] = typeof initializer === 'function'
        ? initializer()
        : initializer;
    }

    return state[normalizedKey];
  }

  function mergeState(key, patch) {
    const normalizedKey = normalizeKey(key, 'state key');

    if (!isPlainObject(patch)) {
      throw new TypeError('[MAOE] State patch must be a plain object.');
    }

    const currentValue = hasOwn(state, normalizedKey) && isPlainObject(state[normalizedKey])
      ? state[normalizedKey]
      : Object.create(null);

    state[normalizedKey] = Object.assign(
      Object.create(null),
      cloneValue(currentValue),
      cloneValue(patch)
    );

    return state[normalizedKey];
  }

  function deleteState(key) {
    const normalizedKey = normalizeKey(key, 'state key');

    if (!hasOwn(state, normalizedKey)) {
      return false;
    }

    delete state[normalizedKey];
    return true;
  }

  function clearState() {
    for (const key of Object.keys(state)) {
      delete state[key];
    }
  }

  function snapshot() {
    const moduleSummary = listModules().map(function mapModuleName(name) {
      return {
        name: name,
        kind: valueKind(registry[name])
      };
    });

    return deepFreeze({
      meta: cloneValue(meta),
      diagnostics: cloneValue(diagnostics),
      modules: moduleSummary,
      state: cloneValue(state)
    });
  }

  const util = deepFreeze({
    isObjectLike: isObjectLike,
    isPlainObject: isPlainObject,
    hasOwn: hasOwn,
    normalizeKey: normalizeKey,
    valueKind: valueKind,
    cloneValue: cloneValue,
    deepFreeze: deepFreeze,
    safeJsonParse: safeJsonParse,
    safeJsonStringify: safeJsonStringify,
    detectRuntimeContext: detectRuntimeContext
  });

  root.meta = meta;
  root.VERSION = EXTENSION_VERSION;
  root.registry = registry;
  root.state = state;
  root.diagnostics = diagnostics;
  root.util = util;

  root.assert = assert;
  root.has = has;
  root.get = get;
  root.require = requireModule;
  root.listModules = listModules;
  root.registerValue = registerValue;
  root.defineModule = defineModule;
  root.remove = remove;

  root.hasState = hasState;
  root.getState = getState;
  root.setState = setState;
  root.ensureState = ensureState;
  root.mergeState = mergeState;
  root.deleteState = deleteState;
  root.clearState = clearState;

  root.snapshot = snapshot;

  Object.defineProperty(root, '__initialized', {
    value: true,
    writable: false,
    enumerable: false,
    configurable: false
  });

  Object.defineProperty(root, '__namespaceName', {
    value: NAMESPACE_NAME,
    writable: false,
    enumerable: false,
    configurable: false
  });

  try {
    Object.defineProperty(globalScope, NAMESPACE_NAME, {
      value: root,
      writable: false,
      enumerable: false,
      configurable: false
    });
  } catch (error) {
    globalScope[NAMESPACE_NAME] = root;
  }
}(
  typeof globalThis !== 'undefined'
    ? globalThis
    : (typeof self !== 'undefined'
      ? self
      : (typeof window !== 'undefined' ? window : this))
));