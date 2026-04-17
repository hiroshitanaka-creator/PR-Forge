(function registerMAOEContentMessageBridge(globalScope) {
  'use strict';

  const root = globalScope.MAOE;

  if (!root || typeof root.registerValue !== 'function') {
    throw new Error('[MAOE] namespace.js must be loaded before content_message_bridge.js.');
  }

  if (root.has('content_message_bridge')) {
    return;
  }

  const constants = root.has('constants') ? root.require('constants') : Object.create(null);
  const MESSAGE_TYPES = (constants.MESSAGING && constants.MESSAGING.TYPES) || Object.create(null);
  const ERROR_CODES = (constants.MESSAGING && constants.MESSAGING.ERROR_CODES) || Object.create(null);

  const CONTENT_PROBE = MESSAGE_TYPES.CONTENT_PROBE || 'CONTENT/PROBE';
  const CONTENT_FILL_PROMPT = MESSAGE_TYPES.CONTENT_FILL_PROMPT || 'CONTENT/FILL_PROMPT';
  const CONTENT_EXTRACT_LATEST_RESPONSE = MESSAGE_TYPES.CONTENT_EXTRACT_LATEST_RESPONSE || 'CONTENT/EXTRACT_LATEST_RESPONSE';
  const CODE_NOT_READY = ERROR_CODES.INVALID_STATE || 'INVALID_STATE';
  const CODE_UNSUPPORTED = ERROR_CODES.MESSAGE_UNSUPPORTED || 'MESSAGE_UNSUPPORTED';
  const CODE_DELIVERY = ERROR_CODES.MESSAGE_DELIVERY_FAILED || 'MESSAGE_DELIVERY_FAILED';

  function createFallbackLogger() {
    const consoleObject = typeof console !== 'undefined' ? console : null;
    const noop = function noop() {};
    function emit(level) {
      return function emitLevel(message, context) {
        if (!consoleObject || typeof consoleObject[level] !== 'function') {
          return;
        }
        if (typeof context === 'undefined') {
          consoleObject[level]('[MAOE/content_message_bridge] ' + message);
        } else {
          consoleObject[level]('[MAOE/content_message_bridge] ' + message, context);
        }
      };
    }
    return {
      debug: consoleObject ? emit('debug') : noop,
      info: consoleObject ? emit('info') : noop,
      warn: consoleObject ? emit('warn') : noop,
      error: consoleObject ? emit('error') : noop
    };
  }

  function resolveLogger() {
    if (!root.has('logger')) {
      return createFallbackLogger();
    }
    const loggerModule = root.require('logger');
    if (loggerModule && typeof loggerModule.createScope === 'function') {
      try {
        return loggerModule.createScope('content_message_bridge');
      } catch (error) {
      }
    }
    return createFallbackLogger();
  }

  const logger = resolveLogger();

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

  function cloneJson(value) {
    if (value === null || typeof value !== 'object') {
      return value;
    }
    try {
      return JSON.parse(JSON.stringify(value));
    } catch (error) {
      return null;
    }
  }

  const handlerRegistry = Object.create(null);
  const providerMeta = {
    providerId: '',
    siteId: '',
    displayName: ''
  };
  let listenerInstalled = false;

  function buildErrorEnvelope(requestEnvelope, code, message, details) {
    return {
      status: 'error',
      type: normalizeString(requestEnvelope && requestEnvelope.type),
      requestId: normalizeString(requestEnvelope && requestEnvelope.requestId),
      data: null,
      error: {
        code: normalizeString(code) || CODE_DELIVERY,
        message: normalizeString(message) || 'Content script failed to handle message.',
        details: isPlainObject(details) ? cloneJson(details) : Object.create(null)
      },
      meta: Object.create(null)
    };
  }

  function buildSuccessEnvelope(requestEnvelope, data) {
    return {
      status: 'ok',
      type: normalizeString(requestEnvelope && requestEnvelope.type),
      requestId: normalizeString(requestEnvelope && requestEnvelope.requestId),
      data: typeof data === 'undefined' ? null : cloneJson(data),
      error: null,
      meta: Object.create(null)
    };
  }

  function normalizeErrorObject(error) {
    if (error && typeof error === 'object') {
      const code = normalizeString(error.code) || CODE_DELIVERY;
      const message = normalizeString(error.message) || 'Content handler threw an error.';
      const details = isPlainObject(error.details) ? error.details : Object.create(null);
      return { code: code, message: message, details: details };
    }
    return {
      code: CODE_DELIVERY,
      message: typeof error === 'string' && error ? error : 'Content handler threw an error.',
      details: Object.create(null)
    };
  }

  function getHandler(type) {
    switch (type) {
      case CONTENT_PROBE:
        return handlerRegistry.probe || null;
      case CONTENT_FILL_PROMPT:
        return handlerRegistry.fillPrompt || null;
      case CONTENT_EXTRACT_LATEST_RESPONSE:
        return handlerRegistry.extractLatestResponse || null;
      default:
        return null;
    }
  }

  function handlesType(type) {
    return type === CONTENT_PROBE
      || type === CONTENT_FILL_PROMPT
      || type === CONTENT_EXTRACT_LATEST_RESPONSE;
  }

  function handleRuntimeMessage(envelope, sender, sendResponse) {
    if (!isPlainObject(envelope)) {
      return false;
    }
    const type = normalizeString(envelope.type);
    if (!type || !handlesType(type)) {
      return false;
    }

    const handler = getHandler(type);
    if (typeof handler !== 'function') {
      const response = buildErrorEnvelope(envelope, CODE_NOT_READY, 'Content script is not ready to handle ' + type + '.', {
        providerId: providerMeta.providerId,
        siteId: providerMeta.siteId
      });
      try {
        sendResponse(response);
      } catch (error) {
      }
      return false;
    }

    Promise.resolve()
      .then(function invoke() {
        return handler(isPlainObject(envelope.payload) ? envelope.payload : Object.create(null), envelope);
      })
      .then(function onResolved(result) {
        try {
          sendResponse(buildSuccessEnvelope(envelope, result));
        } catch (error) {
          logger.warn('Failed to deliver success response.', { type: type, error: error && error.message });
        }
      })
      .catch(function onRejected(error) {
        const normalized = normalizeErrorObject(error);
        logger.warn('Content handler rejected.', { type: type, code: normalized.code, message: normalized.message });
        try {
          sendResponse(buildErrorEnvelope(envelope, normalized.code, normalized.message, normalized.details));
        } catch (innerError) {
          logger.warn('Failed to deliver error response.', { type: type, error: innerError && innerError.message });
        }
      });

    return true;
  }

  function ensureListenerInstalled() {
    if (listenerInstalled) {
      return true;
    }
    const runtime = typeof chrome !== 'undefined' && chrome && chrome.runtime ? chrome.runtime : null;
    if (!runtime || !runtime.onMessage || typeof runtime.onMessage.addListener !== 'function') {
      logger.warn('chrome.runtime.onMessage is unavailable; bridge listener not installed.');
      return false;
    }
    runtime.onMessage.addListener(handleRuntimeMessage);
    listenerInstalled = true;
    logger.debug('Content message bridge listener installed.');
    return true;
  }

  function registerHandlers(handlers, options) {
    if (!isPlainObject(handlers)) {
      throw new TypeError('[MAOE] registerHandlers requires a handlers object.');
    }
    const opts = isPlainObject(options) ? options : Object.create(null);

    if (typeof handlers.probe === 'function') {
      handlerRegistry.probe = handlers.probe;
    }
    if (typeof handlers.fillPrompt === 'function') {
      handlerRegistry.fillPrompt = handlers.fillPrompt;
    }
    if (typeof handlers.extractLatestResponse === 'function') {
      handlerRegistry.extractLatestResponse = handlers.extractLatestResponse;
    }

    if (typeof opts.providerId === 'string' && opts.providerId) {
      providerMeta.providerId = opts.providerId;
    }
    if (typeof opts.siteId === 'string' && opts.siteId) {
      providerMeta.siteId = opts.siteId;
    }
    if (typeof opts.displayName === 'string' && opts.displayName) {
      providerMeta.displayName = opts.displayName;
    }

    ensureListenerInstalled();

    return {
      providerId: providerMeta.providerId,
      siteId: providerMeta.siteId,
      displayName: providerMeta.displayName,
      registered: {
        probe: typeof handlerRegistry.probe === 'function',
        fillPrompt: typeof handlerRegistry.fillPrompt === 'function',
        extractLatestResponse: typeof handlerRegistry.extractLatestResponse === 'function'
      }
    };
  }

  function getRegisteredState() {
    return {
      providerId: providerMeta.providerId,
      siteId: providerMeta.siteId,
      displayName: providerMeta.displayName,
      listenerInstalled: listenerInstalled,
      registered: {
        probe: typeof handlerRegistry.probe === 'function',
        fillPrompt: typeof handlerRegistry.fillPrompt === 'function',
        extractLatestResponse: typeof handlerRegistry.extractLatestResponse === 'function'
      }
    };
  }

  function clearHandlers() {
    delete handlerRegistry.probe;
    delete handlerRegistry.fillPrompt;
    delete handlerRegistry.extractLatestResponse;
    return true;
  }

  const api = {
    registerHandlers: registerHandlers,
    getRegisteredState: getRegisteredState,
    clearHandlers: clearHandlers,
    MESSAGE_TYPES: {
      CONTENT_PROBE: CONTENT_PROBE,
      CONTENT_FILL_PROMPT: CONTENT_FILL_PROMPT,
      CONTENT_EXTRACT_LATEST_RESPONSE: CONTENT_EXTRACT_LATEST_RESPONSE
    },
    ERROR_CODES: {
      NOT_READY: CODE_NOT_READY,
      UNSUPPORTED: CODE_UNSUPPORTED,
      DELIVERY_FAILED: CODE_DELIVERY
    }
  };

  root.registerValue('content_message_bridge', api, {
    overwrite: false,
    freeze: true,
    clone: false
  });
}(typeof globalThis !== 'undefined'
  ? globalThis
  : (typeof self !== 'undefined'
      ? self
      : (typeof window !== 'undefined' ? window : this))));
