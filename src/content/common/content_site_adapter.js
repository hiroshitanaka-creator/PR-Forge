(function registerMAOEContentSiteAdapter(globalScope) {
  'use strict';

  const root = globalScope.MAOE;

  if (!root || typeof root.registerValue !== 'function') {
    throw new Error('[MAOE] namespace.js must be loaded before content_site_adapter.js.');
  }

  if (root.has('content_site_adapter')) {
    return;
  }

  const constants = root.has('constants') ? root.require('constants') : Object.create(null);
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

  const MESSAGE_TYPES = (constants.MESSAGING && constants.MESSAGING.TYPES) || Object.create(null);
  const CONTENT_SITE_DETECTED = MESSAGE_TYPES.CONTENT_SITE_DETECTED || 'CONTENT/SITE_DETECTED';
  const CONTENT_AI_OUTPUT_CAPTURED = MESSAGE_TYPES.CONTENT_AI_OUTPUT_CAPTURED || 'CONTENT/AI_OUTPUT_CAPTURED';

  function createScopedLogger() {
    if (!root.has('logger')) {
      return createFallbackLogger();
    }
    const loggerModule = root.require('logger');
    if (loggerModule && typeof loggerModule.createScope === 'function') {
      try {
        return loggerModule.createScope('content_site_adapter');
      } catch (error) {
      }
    }
    return createFallbackLogger();
  }

  function createFallbackLogger() {
    const noop = function noop() {};
    const consoleObject = typeof console !== 'undefined' ? console : null;
    function emit(level) {
      return function emitLevel(message, context) {
        if (!consoleObject || typeof consoleObject[level] !== 'function') {
          return;
        }
        if (typeof context === 'undefined') {
          consoleObject[level]('[MAOE/content_site_adapter] ' + message);
        } else {
          consoleObject[level]('[MAOE/content_site_adapter] ' + message, context);
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

  const logger = createScopedLogger();

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

  function nowIsoString() {
    return new Date().toISOString();
  }

  function ensureArray(value) {
    if (Array.isArray(value)) {
      return value;
    }
    if (value === null || typeof value === 'undefined') {
      return [];
    }
    return [value];
  }

  function queryFirst(selectors, context) {
    const scope = context || globalScope.document;
    if (!scope || typeof scope.querySelector !== 'function') {
      return null;
    }
    const list = ensureArray(selectors);
    for (let index = 0; index < list.length; index += 1) {
      const selector = normalizeString(list[index]);
      if (!selector) {
        continue;
      }
      try {
        const found = scope.querySelector(selector);
        if (found) {
          return found;
        }
      } catch (error) {
      }
    }
    return null;
  }

  function queryAll(selectors, context) {
    const scope = context || globalScope.document;
    const results = [];
    if (!scope || typeof scope.querySelectorAll !== 'function') {
      return results;
    }
    const list = ensureArray(selectors);
    for (let index = 0; index < list.length; index += 1) {
      const selector = normalizeString(list[index]);
      if (!selector) {
        continue;
      }
      try {
        const nodeList = scope.querySelectorAll(selector);
        for (let nodeIndex = 0; nodeIndex < nodeList.length; nodeIndex += 1) {
          results.push(nodeList[nodeIndex]);
        }
      } catch (error) {
      }
    }
    return results;
  }

  function uniqueElements(elements) {
    const seen = typeof Set === 'function' ? new Set() : null;
    const out = [];
    for (let index = 0; index < elements.length; index += 1) {
      const element = elements[index];
      if (!element) {
        continue;
      }
      if (seen) {
        if (seen.has(element)) {
          continue;
        }
        seen.add(element);
      }
      out.push(element);
    }
    return out;
  }

  function matchesAny(element, selectors) {
    if (!element || typeof element.matches !== 'function') {
      return false;
    }
    const list = ensureArray(selectors);
    for (let index = 0; index < list.length; index += 1) {
      const selector = normalizeString(list[index]);
      if (!selector) {
        continue;
      }
      try {
        if (element.matches(selector)) {
          return true;
        }
      } catch (error) {
      }
    }
    return false;
  }

  async function sendRuntimeMessage(type, payload) {
    const runtime = typeof chrome !== 'undefined' && chrome && chrome.runtime ? chrome.runtime : null;
    if (!runtime || typeof runtime.sendMessage !== 'function') {
      return null;
    }
    try {
      return await new Promise(function executor(resolve) {
        try {
          runtime.sendMessage({ type: type, payload: payload }, function onResponse(response) {
            if (runtime.lastError) {
              resolve(null);
              return;
            }
            resolve(response || null);
          });
        } catch (error) {
          resolve(null);
        }
      });
    } catch (error) {
      return null;
    }
  }

  function createAdapter(config, options) {
    const normalizedConfig = isPlainObject(config) ? config : Object.create(null);
    const siteId = normalizeString(normalizedConfig.siteId) || 'unknown_site';
    const providerId = normalizeString(normalizedConfig.providerId) || siteId;
    const displayName = normalizeString(normalizedConfig.displayName) || providerId;

    const state = {
      ready: false,
      readyAt: '',
      lastOutputAt: '',
      lastOutputKind: '',
      lastOutputLength: null,
      siteDetectedSent: false,
      lastExtractionAt: '',
      installed: false,
      installedAt: ''
    };

    const observers = [];

    function locatePromptElement() {
      if (typeof normalizedConfig.getPromptElement === 'function') {
        const provided = normalizedConfig.getPromptElement();
        if (provided) {
          return provided;
        }
      }
      return queryFirst(normalizedConfig.promptTargets);
    }

    function locateSubmitElement(promptElement) {
      if (typeof normalizedConfig.getSubmitElement === 'function') {
        const provided = normalizedConfig.getSubmitElement(promptElement);
        if (provided) {
          return provided;
        }
      }
      const formScope = promptElement && typeof promptElement.closest === 'function'
        ? promptElement.closest('form')
        : null;
      const inForm = formScope ? queryFirst(normalizedConfig.submitTargets, formScope) : null;
      if (inForm) {
        return inForm;
      }
      return queryFirst(normalizedConfig.submitTargets);
    }

    function locateResponseElements() {
      let elements = [];
      if (typeof normalizedConfig.getResponseElements === 'function') {
        const provided = normalizedConfig.getResponseElements();
        if (Array.isArray(provided)) {
          elements = provided.slice();
        } else if (provided && typeof provided.length === 'number') {
          elements = Array.prototype.slice.call(provided);
        }
      } else {
        elements = queryAll(normalizedConfig.responseTargets);
      }
      const exclusions = normalizedConfig.responseExclusionTargets;
      if (ensureArray(exclusions).length > 0) {
        elements = elements.filter(function keepAllowed(element) {
          return !matchesAny(element, exclusions);
        });
      }
      return uniqueElements(elements);
    }

    function buildSiteInfo(overrides) {
      const base = {
        siteId: siteId,
        providerId: providerId,
        displayName: displayName,
        host: (globalScope.location && globalScope.location.host) || '',
        url: (globalScope.location && globalScope.location.href) || '',
        protocolVersion: normalizedConfig.protocolVersion || '',
        detectedAt: nowIsoString()
      };
      if (typeof normalizedConfig.deriveSiteInfo === 'function') {
        try {
          const derived = normalizedConfig.deriveSiteInfo(adapter);
          if (isPlainObject(derived)) {
            Object.assign(base, derived);
          }
        } catch (error) {
          logger.warn('deriveSiteInfo threw; continuing with base site info.', { error: error && error.message });
        }
      }
      if (isPlainObject(overrides)) {
        Object.assign(base, overrides);
      }
      return base;
    }

    function probe() {
      const siteInfo = buildSiteInfo();
      const promptElement = locatePromptElement();
      const submitElement = locateSubmitElement(promptElement);
      const responseElements = locateResponseElements();
      const ready = !!promptElement;
      state.ready = ready;
      if (ready && !state.readyAt) {
        state.readyAt = nowIsoString();
      }
      return {
        ok: true,
        siteInfo: siteInfo,
        ready: ready,
        promptElementFound: !!promptElement,
        submitElementFound: !!submitElement,
        responseElementCount: responseElements.length
      };
    }

    async function notifySiteDetected(overrides) {
      const siteInfo = buildSiteInfo(overrides);
      await sendRuntimeMessage(CONTENT_SITE_DETECTED, siteInfo);
      state.siteDetectedSent = true;
      return siteInfo;
    }

    function normalizePromptText(text) {
      const source = coerceText(text);
      if (typeof normalizedConfig.normalizePromptText === 'function') {
        try {
          return normalizedConfig.normalizePromptText(source);
        } catch (error) {
          logger.warn('normalizePromptText threw; using raw text.', { error: error && error.message });
        }
      }
      return source;
    }

    function normalizeResponseText(text) {
      const source = coerceText(text);
      if (typeof normalizedConfig.normalizeResponseText === 'function') {
        try {
          return normalizedConfig.normalizeResponseText(source);
        } catch (error) {
          logger.warn('normalizeResponseText threw; using raw text.', { error: error && error.message });
        }
      }
      return source;
    }

    function dispatchInputEvents(element) {
      if (!element || typeof element.dispatchEvent !== 'function') {
        return;
      }
      try {
        element.dispatchEvent(new Event('input', { bubbles: true }));
      } catch (error) {
      }
      try {
        element.dispatchEvent(new Event('change', { bubbles: true }));
      } catch (error) {
      }
    }

    async function fillPrompt(rawText, callOptions) {
      const promptElement = locatePromptElement();
      if (!promptElement) {
        return { ok: false, error: 'prompt_element_not_found' };
      }
      const text = normalizePromptText(rawText);
      try {
        if (typeof promptElement.focus === 'function') {
          promptElement.focus();
        }
        if ('value' in promptElement) {
          promptElement.value = text;
        } else if (promptElement.isContentEditable) {
          promptElement.textContent = text;
        } else {
          promptElement.textContent = text;
        }
        dispatchInputEvents(promptElement);
      } catch (error) {
        return { ok: false, error: 'prompt_fill_failed', message: error && error.message };
      }

      const shouldAutoSubmit = callOptions && typeof callOptions.autoSubmit === 'boolean'
        ? callOptions.autoSubmit
        : !!normalizedConfig.defaultAutoSubmit;

      let submitted = false;
      if (shouldAutoSubmit) {
        const submitElement = locateSubmitElement(promptElement);
        if (submitElement && !submitElement.disabled) {
          try {
            submitElement.click();
            submitted = true;
          } catch (error) {
            logger.warn('Submit button click failed.', { error: error && error.message });
          }
        }
      }

      return {
        ok: true,
        length: text.length,
        submitted: submitted,
        promptElementTag: normalizeString(promptElement.tagName).toLowerCase(),
        contentEditable: !!promptElement.isContentEditable
      };
    }

    async function extractLatestResponse(callOptions) {
      const options = isPlainObject(callOptions) ? callOptions : Object.create(null);
      const responses = locateResponseElements();
      const latest = responses.length > 0 ? responses[responses.length - 1] : null;
      if (!latest) {
        return { ok: false, rawText: '', error: 'no_response_element' };
      }
      const raw = coerceText(latest.textContent);
      const normalized = normalizeResponseText(raw);
      state.lastOutputAt = nowIsoString();
      state.lastOutputLength = normalized.length;
      state.lastOutputKind = normalizeString(options.kind) || 'ai_output';
      state.lastExtractionAt = state.lastOutputAt;

      if (options.broadcast !== false) {
        await sendRuntimeMessage(CONTENT_AI_OUTPUT_CAPTURED, {
          siteId: siteId,
          providerId: providerId,
          rawText: normalized,
          kind: state.lastOutputKind,
          capturedAt: state.lastOutputAt
        });
      }

      return {
        ok: true,
        rawText: normalized,
        length: normalized.length,
        responseElementCount: responses.length,
        capturedAt: state.lastOutputAt
      };
    }

    function getState() {
      return {
        ready: state.ready,
        readyAt: state.readyAt,
        lastOutputAt: state.lastOutputAt,
        lastOutputKind: state.lastOutputKind,
        lastOutputLength: state.lastOutputLength,
        siteDetectedSent: state.siteDetectedSent,
        installed: state.installed,
        installedAt: state.installedAt
      };
    }

    function installObserver() {
      if (!normalizedConfig.autoObserve) {
        return;
      }
      const MutationObserverCtor = globalScope.MutationObserver || null;
      if (!MutationObserverCtor || !globalScope.document) {
        return;
      }
      try {
        const observer = new MutationObserverCtor(function onMutation() {
          probe();
        });
        observer.observe(globalScope.document.body || globalScope.document.documentElement, {
          childList: true,
          subtree: true
        });
        observers.push(observer);
      } catch (error) {
        logger.warn('Failed to install MutationObserver.', { error: error && error.message });
      }
    }

    function uninstall() {
      while (observers.length > 0) {
        const observer = observers.pop();
        try {
          observer.disconnect();
        } catch (error) {
        }
      }
      state.installed = false;
    }

    const adapter = {
      probe: probe,
      notifySiteDetected: notifySiteDetected,
      fillPrompt: fillPrompt,
      extractLatestResponse: extractLatestResponse,
      buildSiteInfo: buildSiteInfo,
      getState: getState,
      uninstall: uninstall,
      helpers: {
        locatePromptElement: locatePromptElement,
        locateSubmitElement: locateSubmitElement,
        locateResponseElements: locateResponseElements,
        normalizePromptText: normalizePromptText,
        normalizeResponseText: normalizeResponseText
      }
    };

    state.installed = true;
    state.installedAt = nowIsoString();
    installObserver();

    return adapter;
  }

  async function installAdapter(config, options) {
    const opts = isPlainObject(options) ? options : Object.create(null);
    const adapter = createAdapter(config, opts);
    const probeResult = adapter.probe();
    if (config && config.autoNotifySiteDetected !== false) {
      try {
        await adapter.notifySiteDetected(probeResult && probeResult.siteInfo ? probeResult.siteInfo : null);
      } catch (error) {
        logger.warn('notifySiteDetected failed during install.', { error: error && error.message });
      }
    }
    return {
      ok: true,
      adapter: adapter,
      probe: probeResult
    };
  }

  const api = {
    installAdapter: installAdapter,
    createAdapter: createAdapter
  };

  root.registerValue('content_site_adapter', api, {
    overwrite: false,
    freeze: true,
    clone: false
  });
}(typeof globalThis !== 'undefined'
  ? globalThis
  : (typeof self !== 'undefined'
      ? self
      : (typeof window !== 'undefined' ? window : this))));
