(() => {
  'use strict';

  const root = globalThis;
  const MAOE = (root.MAOE = root.MAOE || {});
  MAOE.Content = MAOE.Content || {};

  const LoggerFactory = MAOE.Logger || {};
  const createLogger =
    typeof LoggerFactory.create === 'function'
      ? LoggerFactory.create
      : (scope) => ({
          debug: (...args) => console.debug(`[${scope}]`, ...args),
          info: (...args) => console.info(`[${scope}]`, ...args),
          warn: (...args) => console.warn(`[${scope}]`, ...args),
          error: (...args) => console.error(`[${scope}]`, ...args)
        });

  const logger = createLogger('content/common/dom_utils');

  function createAbortError(message = 'Operation aborted') {
    try {
      return new DOMException(message, 'AbortError');
    } catch (_error) {
      const error = new Error(message);
      error.name = 'AbortError';
      return error;
    }
  }

  function createTimeoutError(message = 'Operation timed out') {
    try {
      return new DOMException(message, 'TimeoutError');
    } catch (_error) {
      const error = new Error(message);
      error.name = 'TimeoutError';
      return error;
    }
  }

  function uniqueArray(items) {
    return Array.from(new Set(items));
  }

  function flattenSelectors(input) {
    const out = [];
    const queue = [input];

    while (queue.length > 0) {
      const value = queue.shift();
      if (Array.isArray(value)) {
        queue.unshift(...value);
        continue;
      }
      if (typeof value === 'string') {
        const selector = value.trim();
        if (selector) {
          out.push(selector);
        }
      }
    }

    return uniqueArray(out);
  }

  function isElement(value) {
    return typeof Element !== 'undefined' && value instanceof Element;
  }

  function isHTMLElement(value) {
    return typeof HTMLElement !== 'undefined' && value instanceof HTMLElement;
  }

  function isShadowRoot(value) {
    return typeof ShadowRoot !== 'undefined' && value instanceof ShadowRoot;
  }

  function isDocumentFragment(value) {
    return typeof DocumentFragment !== 'undefined' && value instanceof DocumentFragment;
  }

  function isSearchRoot(value) {
    return Boolean(value) && typeof value.querySelectorAll === 'function';
  }

  function resolveScope(scope = document) {
    if (isSearchRoot(scope)) {
      return scope;
    }

    if (isElement(scope) && scope.shadowRoot && isSearchRoot(scope.shadowRoot)) {
      return scope.shadowRoot;
    }

    return document;
  }

  function getComposedParent(node) {
    if (!node) {
      return null;
    }

    if (node.parentElement) {
      return node.parentElement;
    }

    if (typeof node.getRootNode === 'function') {
      const rootNode = node.getRootNode();
      if (isShadowRoot(rootNode)) {
        return rootNode.host || null;
      }
    }

    return null;
  }

  function normalizeText(value, options = {}) {
    const { trim = true, collapseWhitespace = false } = options;

    let text = value == null ? '' : String(value);
    text = text.replace(/\r\n?/g, '\n');

    if (collapseWhitespace) {
      text = text.replace(/[ \t\f\v]+/g, ' ');
    }

    if (trim) {
      text = text.trim();
    }

    return text;
  }

  function getNodeText(node, options = {}) {
    if (!node) {
      return '';
    }

    if (isHTMLElement(node) && typeof node.innerText === 'string') {
      return normalizeText(node.innerText, options);
    }

    return normalizeText(node.textContent || '', options);
  }

  function hasText(node) {
    return getNodeText(node).length > 0;
  }

  function matchesAny(element, selectors) {
    if (!isElement(element)) {
      return false;
    }

    const selectorList = flattenSelectors(selectors);
    for (const selector of selectorList) {
      try {
        if (element.matches(selector)) {
          return true;
        }
      } catch (_error) {
      }
    }

    return false;
  }

  function closestAny(element, selectors) {
    if (!isElement(element)) {
      return null;
    }

    const selectorList = flattenSelectors(selectors);
    for (const selector of selectorList) {
      try {
        const match = element.closest(selector);
        if (match) {
          return match;
        }
      } catch (_error) {
      }
    }

    return null;
  }

  function isTextInputElement(element) {
    if (!isElement(element)) {
      return false;
    }

    if (typeof HTMLTextAreaElement !== 'undefined' && element instanceof HTMLTextAreaElement) {
      return true;
    }

    if (typeof HTMLInputElement !== 'undefined' && element instanceof HTMLInputElement) {
      const type = String(element.type || 'text').toLowerCase();
      const disallowed = new Set([
        'button',
        'checkbox',
        'color',
        'file',
        'hidden',
        'image',
        'radio',
        'range',
        'reset',
        'submit'
      ]);

      return !disallowed.has(type);
    }

    return false;
  }

  function isContentEditableElement(element) {
    return isHTMLElement(element) && (element.isContentEditable || element.getAttribute('contenteditable') === 'true');
  }

  function isEditable(element) {
    return isTextInputElement(element) || isContentEditableElement(element);
  }

  function isDisabled(element) {
    if (!isElement(element)) {
      return false;
    }

    if ('disabled' in element && Boolean(element.disabled)) {
      return true;
    }

    const ariaDisabled = String(element.getAttribute('aria-disabled') || '').toLowerCase();
    if (ariaDisabled === 'true') {
      return true;
    }

    if (element.hasAttribute('inert')) {
      return true;
    }

    return false;
  }

  function isConnected(node) {
    return Boolean(node) && node.isConnected !== false;
  }

  function isVisible(element, options = {}) {
    const { checkAncestors = true } = options;

    if (!isHTMLElement(element)) {
      return false;
    }

    if (!isConnected(element)) {
      return false;
    }

    if (element.hidden || element.hasAttribute('hidden')) {
      return false;
    }

    let current = element;
    while (current && isElement(current)) {
      const ariaHidden = String(current.getAttribute('aria-hidden') || '').toLowerCase();
      if (ariaHidden === 'true') {
        return false;
      }

      if (current instanceof HTMLElement) {
        const style = root.getComputedStyle(current);
        if (!style) {
          return false;
        }

        if (
          style.display === 'none' ||
          style.visibility === 'hidden' ||
          style.visibility === 'collapse' ||
          style.contentVisibility === 'hidden'
        ) {
          return false;
        }
      }

      if (!checkAncestors) {
        break;
      }

      current = getComposedParent(current);
    }

    if (typeof element.getClientRects === 'function' && element.getClientRects().length === 0) {
      return false;
    }

    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function safeQuery(selector, scope = document) {
    if (typeof selector !== 'string' || selector.trim() === '') {
      return null;
    }

    try {
      return resolveScope(scope).querySelector(selector);
    } catch (_error) {
      return null;
    }
  }

  function safeQueryAll(selector, scope = document) {
    if (typeof selector !== 'string' || selector.trim() === '') {
      return [];
    }

    try {
      return Array.from(resolveScope(scope).querySelectorAll(selector));
    } catch (_error) {
      return [];
    }
  }

  function collectSearchRoots(scope = document) {
    const rootScope = resolveScope(scope);
    const roots = [];
    const visited = new Set();
    const queue = [rootScope];

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current || visited.has(current)) {
        continue;
      }

      visited.add(current);
      roots.push(current);

      let walkerRoot = current;
      if (typeof Document !== 'undefined' && current instanceof Document) {
        walkerRoot = current.documentElement || current.body || null;
      }

      if (!walkerRoot || typeof document.createTreeWalker !== 'function') {
        continue;
      }

      const walker = document.createTreeWalker(walkerRoot, NodeFilter.SHOW_ELEMENT);
      let node = walker.currentNode;

      while (node) {
        if (node.shadowRoot && !visited.has(node.shadowRoot)) {
          queue.push(node.shadowRoot);
        }
        node = walker.nextNode();
      }
    }

    return roots;
  }

  function queryAll(selectors, scope = document, options = {}) {
    const { deep = false, visibleOnly = false } = options;

    const selectorList = flattenSelectors(selectors);
    const roots = deep ? collectSearchRoots(scope) : [resolveScope(scope)];
    const out = [];
    const seen = new Set();

    for (const searchRoot of roots) {
      for (const selector of selectorList) {
        const nodes = safeQueryAll(selector, searchRoot);

        for (const node of nodes) {
          if (!isElement(node)) {
            continue;
          }
          if (seen.has(node)) {
            continue;
          }
          if (visibleOnly && !isVisible(node)) {
            continue;
          }

          seen.add(node);
          out.push(node);
        }
      }
    }

    return out;
  }

  function queryFirst(selectors, scope = document, options = {}) {
    const { deep = false, visibleOnly = false } = options;

    const selectorList = flattenSelectors(selectors);
    const roots = deep ? collectSearchRoots(scope) : [resolveScope(scope)];

    for (const searchRoot of roots) {
      for (const selector of selectorList) {
        const nodes = safeQueryAll(selector, searchRoot);

        for (const node of nodes) {
          if (!isElement(node)) {
            continue;
          }
          if (visibleOnly && !isVisible(node)) {
            continue;
          }

          return node;
        }
      }
    }

    return null;
  }

  function queryVisible(selectors, scope = document) {
    return queryFirst(selectors, scope, { visibleOnly: true });
  }

  function queryAllVisible(selectors, scope = document) {
    return queryAll(selectors, scope, { visibleOnly: true });
  }

  function queryDeep(selectors, scope = document) {
    return queryFirst(selectors, scope, { deep: true });
  }

  function queryAllDeep(selectors, scope = document) {
    return queryAll(selectors, scope, { deep: true });
  }

  function queryDeepVisible(selectors, scope = document) {
    return queryFirst(selectors, scope, { deep: true, visibleOnly: true });
  }

  function queryAllDeepVisible(selectors, scope = document) {
    return queryAll(selectors, scope, { deep: true, visibleOnly: true });
  }

  function wait(ms = 0, options = {}) {
    const signal = options.signal;

    if (signal && signal.aborted) {
      return Promise.reject(createAbortError());
    }

    const duration = Math.max(0, Number(ms) || 0);

    return new Promise((resolve, reject) => {
      let timer = null;
      let abortHandler = null;

      const cleanup = () => {
        if (timer !== null) {
          root.clearTimeout(timer);
        }
        if (signal && abortHandler) {
          signal.removeEventListener('abort', abortHandler);
        }
      };

      abortHandler = () => {
        cleanup();
        reject(createAbortError());
      };

      if (signal) {
        signal.addEventListener('abort', abortHandler, { once: true });
      }

      timer = root.setTimeout(() => {
        cleanup();
        resolve(true);
      }, duration);
    });
  }

  function nextAnimationFrame(options = {}) {
    const { count = 1, signal } = options;

    if (signal && signal.aborted) {
      return Promise.reject(createAbortError());
    }

    const totalFrames = Math.max(1, Number(count) || 1);

    return new Promise((resolve, reject) => {
      let frame = 0;
      let rafId = null;
      let timeoutId = null;

      const cleanup = () => {
        if (typeof root.cancelAnimationFrame === 'function' && rafId !== null) {
          root.cancelAnimationFrame(rafId);
        }
        if (timeoutId !== null) {
          root.clearTimeout(timeoutId);
        }
        if (signal) {
          signal.removeEventListener('abort', onAbort);
        }
      };

      const onAbort = () => {
        cleanup();
        reject(createAbortError());
      };

      const tick = () => {
        frame += 1;
        if (frame >= totalFrames) {
          cleanup();
          resolve(true);
          return;
        }

        schedule();
      };

      const schedule = () => {
        if (typeof root.requestAnimationFrame === 'function') {
          rafId = root.requestAnimationFrame(tick);
        } else {
          timeoutId = root.setTimeout(tick, 16);
        }
      };

      if (signal) {
        signal.addEventListener('abort', onAbort, { once: true });
      }

      schedule();
    });
  }

  async function waitForCondition(predicate, options = {}) {
    const {
      timeoutMs = 10000,
      intervalMs = 100,
      signal,
      swallowErrors = true,
      rejectOnTimeout = false,
      useAnimationFrame = false
    } = options;

    const startedAt = Date.now();
    let lastError = null;

    while (Date.now() - startedAt < timeoutMs) {
      if (signal && signal.aborted) {
        throw createAbortError();
      }

      try {
        const result = await Promise.resolve(predicate());
        if (result) {
          return result;
        }
      } catch (error) {
        lastError = error;
        if (!swallowErrors) {
          throw error;
        }
      }

      if (useAnimationFrame) {
        await nextAnimationFrame({ signal });
      } else {
        await wait(intervalMs, { signal });
      }
    }

    if (rejectOnTimeout) {
      const timeoutError = createTimeoutError();
      if (lastError) {
        timeoutError.cause = lastError;
      }
      throw timeoutError;
    }

    return null;
  }

  async function waitForElement(selectors, options = {}) {
    const {
      scope = document,
      visibleOnly = false,
      deep = false,
      timeoutMs = 10000,
      intervalMs = 100,
      signal,
      rejectOnTimeout = false
    } = options;

    return await waitForCondition(() => queryFirst(selectors, scope, { visibleOnly, deep }), {
      timeoutMs,
      intervalMs,
      signal,
      rejectOnTimeout
    });
  }

  async function waitForVisibleElement(selectors, options = {}) {
    return await waitForElement(selectors, {
      ...options,
      visibleOnly: true
    });
  }

  async function waitForDocumentReady(options = {}) {
    const { timeoutMs = 10000, signal, rejectOnTimeout = false } = options;

    if (document.readyState === 'interactive' || document.readyState === 'complete') {
      return true;
    }

    return await waitForCondition(
      () => document.readyState === 'interactive' || document.readyState === 'complete',
      {
        timeoutMs,
        intervalMs: 25,
        signal,
        rejectOnTimeout
      }
    );
  }

  function scrollIntoView(element, options = {}) {
    if (!isElement(element) || typeof element.scrollIntoView !== 'function') {
      return false;
    }

    const { behavior = 'auto', block = 'center', inline = 'nearest' } = options;

    try {
      element.scrollIntoView({ behavior, block, inline });
      return true;
    } catch (_error) {
      try {
        element.scrollIntoView();
        return true;
      } catch (__error) {
        return false;
      }
    }
  }

  function focus(element, options = {}) {
    if (!isElement(element) || typeof element.focus !== 'function') {
      return false;
    }

    const {
      preventScroll = false,
      scroll = false,
      scrollOptions = {},
      select = false
    } = options;

    try {
      if (scroll) {
        scrollIntoView(element, scrollOptions);
      }

      element.focus({ preventScroll });

      if (select && typeof element.select === 'function') {
        element.select();
      }

      return true;
    } catch (_error) {
      try {
        element.focus();

        if (select && typeof element.select === 'function') {
          element.select();
        }

        return true;
      } catch (__error) {
        return false;
      }
    }
  }

  function updateReactValueTracker(element, previousValue) {
    if (!element || typeof element !== 'object') {
      return;
    }

    const tracker = element._valueTracker;
    if (tracker && typeof tracker.setValue === 'function') {
      try {
        tracker.setValue(String(previousValue));
      } catch (_error) {
      }
    }
  }

  function setNativeValue(element, value) {
    if (!element || !('value' in element)) {
      throw new Error('Element does not support the value property');
    }

    const previousValue = element.value;
    const candidateTargets = [
      element,
      Object.getPrototypeOf(element),
      typeof HTMLInputElement !== 'undefined' ? HTMLInputElement.prototype : null,
      typeof HTMLTextAreaElement !== 'undefined' ? HTMLTextAreaElement.prototype : null
    ].filter(Boolean);

    let applied = false;
    for (const target of candidateTargets) {
      const descriptor = Object.getOwnPropertyDescriptor(target, 'value');
      if (descriptor && typeof descriptor.set === 'function') {
        descriptor.set.call(element, value);
        applied = true;
        break;
      }
    }

    if (!applied) {
      element.value = value;
    }

    updateReactValueTracker(element, previousValue);
    return value;
  }

  function dispatchEventSafe(element, event) {
    if (!isElement(element) || !(event instanceof Event)) {
      return false;
    }

    try {
      return element.dispatchEvent(event);
    } catch (_error) {
      return false;
    }
  }

  function triggerTextInputEvents(element, options = {}) {
    if (!isElement(element)) {
      return false;
    }

    const {
      data = '',
      inputType = 'insertText',
      beforeInput = false,
      change = true
    } = options;

    if (beforeInput) {
      try {
        dispatchEventSafe(
          element,
          new InputEvent('beforeinput', {
            bubbles: true,
            cancelable: true,
            composed: true,
            inputType,
            data
          })
        );
      } catch (_error) {
      }
    }

    try {
      dispatchEventSafe(
        element,
        new InputEvent('input', {
          bubbles: true,
          cancelable: true,
          composed: true,
          inputType,
          data
        })
      );
    } catch (_error) {
      dispatchEventSafe(
        element,
        new Event('input', {
          bubbles: true,
          cancelable: true,
          composed: true
        })
      );
    }

    if (change) {
      dispatchEventSafe(
        element,
        new Event('change', {
          bubbles: true,
          cancelable: true,
          composed: true
        })
      );
    }

    return true;
  }

  function fireInput(element, data = '', inputType = 'insertText') {
    return triggerTextInputEvents(element, {
      data,
      inputType
    });
  }

  function dispatchKeyboardEvent(element, type, options = {}) {
    if (!isElement(element)) {
      return false;
    }

    const event = new KeyboardEvent(type, {
      bubbles: true,
      cancelable: true,
      composed: true,
      key: options.key || '',
      code: options.code || '',
      keyCode: Number(options.keyCode || 0),
      which: Number(options.which || options.keyCode || 0),
      charCode: Number(options.charCode || 0),
      repeat: Boolean(options.repeat),
      altKey: Boolean(options.altKey),
      ctrlKey: Boolean(options.ctrlKey),
      metaKey: Boolean(options.metaKey),
      shiftKey: Boolean(options.shiftKey)
    });

    return dispatchEventSafe(element, event);
  }

  function sendEnterKey(element, options = {}) {
    if (!isElement(element)) {
      return false;
    }

    const payload = {
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      which: 13,
      altKey: Boolean(options.altKey),
      ctrlKey: Boolean(options.ctrlKey),
      metaKey: Boolean(options.metaKey),
      shiftKey: Boolean(options.shiftKey)
    };

    dispatchKeyboardEvent(element, 'keydown', payload);
    dispatchKeyboardEvent(element, 'keypress', payload);
    dispatchKeyboardEvent(element, 'keyup', payload);

    return true;
  }

  function clearNodeContents(node) {
    if (!node) {
      return false;
    }

    while (node.firstChild) {
      node.removeChild(node.firstChild);
    }

    return true;
  }

  function setCaretToEnd(element) {
    if (
      !isElement(element) ||
      typeof document.createRange !== 'function' ||
      typeof root.getSelection !== 'function'
    ) {
      return false;
    }

    const selection = root.getSelection();
    if (!selection) {
      return false;
    }

    try {
      const range = document.createRange();
      range.selectNodeContents(element);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
      return true;
    } catch (_error) {
      return false;
    }
  }

  function selectNodeContents(element) {
    if (
      !isElement(element) ||
      typeof document.createRange !== 'function' ||
      typeof root.getSelection !== 'function'
    ) {
      return false;
    }

    const selection = root.getSelection();
    if (!selection) {
      return false;
    }

    try {
      const range = document.createRange();
      range.selectNodeContents(element);
      selection.removeAllRanges();
      selection.addRange(range);
      return true;
    } catch (_error) {
      return false;
    }
  }

  function clearContentEditable(element) {
    if (!isContentEditableElement(element)) {
      return false;
    }

    focus(element);

    try {
      selectNodeContents(element);
      if (typeof document.execCommand === 'function') {
        document.execCommand('delete', false);
      }
    } catch (_error) {
    }

    clearNodeContents(element);
    setCaretToEnd(element);

    return true;
  }

  function createMultilineFragment(text) {
    const fragment = document.createDocumentFragment();
    const lines = String(text).split('\n');

    for (let index = 0; index < lines.length; index += 1) {
      if (index > 0) {
        fragment.appendChild(document.createElement('br'));
      }
      fragment.appendChild(document.createTextNode(lines[index]));
    }

    return fragment;
  }

  function insertTextIntoContentEditable(element, text, options = {}) {
    if (!isContentEditableElement(element)) {
      return false;
    }

    const { replace = false, triggerEvents = true } = options;

    focus(element);

    if (replace) {
      clearContentEditable(element);
    }

    let inserted = false;
    try {
      if (typeof document.execCommand === 'function') {
        inserted = document.execCommand('insertText', false, text);
      }
    } catch (_error) {
      inserted = false;
    }

    if (!inserted || normalizeText(element.innerText || element.textContent || '') !== normalizeText(text)) {
      if (!replace) {
        clearNodeContents(element);
      }
      element.appendChild(createMultilineFragment(text));
    }

    setCaretToEnd(element);

    if (triggerEvents) {
      triggerTextInputEvents(element, {
        data: text,
        inputType: 'insertText',
        beforeInput: true
      });
    }

    return true;
  }

  function replaceText(element, text, options = {}) {
    if (!isElement(element)) {
      return false;
    }

    const {
      triggerEvents = true,
      focusFirst = true,
      scroll = false,
      scrollOptions = {}
    } = options;

    if (focusFirst) {
      focus(element, {
        scroll,
        scrollOptions
      });
    }

    if (isTextInputElement(element)) {
      setNativeValue(element, text);
      if (triggerEvents) {
        triggerTextInputEvents(element, {
          data: text,
          inputType: 'insertText'
        });
      }
      return true;
    }

    if (isContentEditableElement(element)) {
      return insertTextIntoContentEditable(element, text, {
        replace: true,
        triggerEvents
      });
    }

    return false;
  }

  function click(element, options = {}) {
    if (!isElement(element)) {
      return false;
    }

    const {
      focusFirst = false,
      scrollFirst = false,
      scrollOptions = {}
    } = options;

    if (isDisabled(element)) {
      return false;
    }

    if (focusFirst) {
      focus(element, { scroll: scrollFirst, scrollOptions });
    } else if (scrollFirst) {
      scrollIntoView(element, scrollOptions);
    }

    try {
      element.click();
      return true;
    } catch (_error) {
      const event = new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        composed: true,
        view: root
      });

      return dispatchEventSafe(element, event);
    }
  }

  async function copyTextToClipboard(text) {
    const value = String(text);

    if (root.navigator && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(value);
      return true;
    }

    if (!document.body) {
      return false;
    }

    const helper = document.createElement('textarea');
    helper.value = value;
    helper.setAttribute('readonly', 'readonly');
    helper.style.position = 'fixed';
    helper.style.top = '-1000px';
    helper.style.left = '-1000px';
    helper.style.opacity = '0';
    document.body.appendChild(helper);
    focus(helper, { select: true });

    let copied = false;
    try {
      copied = Boolean(document.execCommand && document.execCommand('copy'));
    } finally {
      helper.remove();
    }

    return copied;
  }

  function observeMutations(target, callback, options = {}) {
    const subject = target || document.documentElement || document.body;
    if (!subject || typeof MutationObserver !== 'function') {
      return null;
    }

    const observer = new MutationObserver((records, instance) => {
      try {
        callback(records, instance);
      } catch (error) {
        logger.error('Mutation observer callback failed', error);
      }
    });

    observer.observe(subject, {
      subtree: options.subtree !== false,
      childList: options.childList !== false,
      attributes: Boolean(options.attributes),
      characterData: Boolean(options.characterData),
      attributeFilter: Array.isArray(options.attributeFilter) ? options.attributeFilter : undefined
    });

    return observer;
  }

  function disconnectObserver(observer) {
    if (observer && typeof observer.disconnect === 'function') {
      observer.disconnect();
      return true;
    }

    return false;
  }

  const api = {
    VERSION: '1.0.0',
    isElement,
    isHTMLElement,
    isShadowRoot,
    isDocumentFragment,
    isSearchRoot,
    isTextInputElement,
    isContentEditableElement,
    isEditable,
    isDisabled,
    isConnected,
    isVisible,
    hasText,
    normalizeText,
    getNodeText,
    flattenSelectors,
    matchesAny,
    closestAny,
    resolveScope,
    safeQuery,
    safeQueryAll,
    query: queryFirst,
    queryFirst,
    queryAll,
    queryVisible,
    queryAllVisible,
    queryDeep,
    queryAllDeep,
    queryDeepVisible,
    queryAllDeepVisible,
    collectSearchRoots,
    wait,
    nextAnimationFrame,
    waitForCondition,
    waitForElement,
    waitForVisibleElement,
    waitForDocumentReady,
    scrollIntoView,
    focus,
    setNativeValue,
    triggerTextInputEvents,
    fireInput,
    dispatchKeyboardEvent,
    sendEnterKey,
    clearNodeContents,
    selectNodeContents,
    setCaretToEnd,
    clearContentEditable,
    insertTextIntoContentEditable,
    replaceText,
    replaceInputValue: replaceText,
    click,
    copyTextToClipboard,
    observeMutations,
    disconnectObserver
  };

  MAOE.Content.DomUtils = Object.assign(MAOE.Content.DomUtils || {}, api);
})();