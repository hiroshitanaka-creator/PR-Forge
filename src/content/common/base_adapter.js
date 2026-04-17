(() => {
  'use strict';

  const root = globalThis;
  const MAOE = (root.MAOE = root.MAOE || {});
  MAOE.Content = MAOE.Content || {};

  const Constants = MAOE.Constants || {};
  const LoggerFactory = MAOE.Logger || {};
  const Protocol = MAOE.Protocol || {};
  const Parsers = MAOE.Parsers || {};
  const ContentCommon = MAOE.Content || {};

  const createLogger =
    typeof LoggerFactory.create === 'function'
      ? LoggerFactory.create
      : (scope) => ({
          debug: (...args) => console.debug(`[${scope}]`, ...args),
          info: (...args) => console.info(`[${scope}]`, ...args),
          warn: (...args) => console.warn(`[${scope}]`, ...args),
          error: (...args) => console.error(`[${scope}]`, ...args),
        });

  const sharedLogger = createLogger('content/common/base_adapter');

  const DEFAULT_MESSAGE_TYPES = Object.freeze({
    CONTENT_READY: 'CONTENT_READY',
    CONTENT_STATUS: 'CONTENT_STATUS',
    CONTENT_PACKET_CREATED: 'CONTENT_PACKET_CREATED',
    HUMAN_HUB_PACKET_REQUEST: 'HUMAN_HUB_PACKET_REQUEST',
    HUMAN_HUB_PACKET_RESPONSE: 'HUMAN_HUB_PACKET_RESPONSE',
    AI_PING: 'AI_PING',
    AI_INJECT_PROMPT: 'AI_INJECT_PROMPT',
    AI_SUBMIT_PROMPT: 'AI_SUBMIT_PROMPT',
    AI_EXTRACT_OUTPUT: 'AI_EXTRACT_OUTPUT',
  });

  const DEFAULT_SELECTORS = Object.freeze({
    promptInput: [
      'textarea',
      'input[type="text"]',
      'div[contenteditable="true"][role="textbox"]',
      'div[contenteditable="true"]',
    ],
    submitButton: ['button[type="submit"]', 'button[aria-label*="Send"]', 'button[aria-label*="送信"]'],
    stopButton: ['button[aria-label*="Stop"]', 'button[aria-label*="停止"]'],
    assistantTurn: [
      '[data-message-author-role="assistant"]',
      '[data-author="assistant"]',
      '[data-role="assistant"]',
      'article',
    ],
    markdownContent: ['.markdown', '.prose', 'pre', 'code', 'article'],
    conversationRoot: ['main', '[role="main"]', '#root', '#__next', 'body'],
    busyIndicator: [
      '[aria-busy="true"]',
      '[data-loading="true"]',
      '[data-testid*="loading"]',
      '[data-testid*="streaming"]',
    ],
  });

  const CONTENT_EVENT_NAMESPACE =
    (Constants.EVENTS && typeof Constants.EVENTS.CONTENT === 'string' && Constants.EVENTS.CONTENT.trim()) ||
    'maoe:content';

  const MESSAGE_TYPES = Object.assign(
    {},
    DEFAULT_MESSAGE_TYPES,
    Protocol.MESSAGE_TYPES && typeof Protocol.MESSAGE_TYPES === 'object' ? Protocol.MESSAGE_TYPES : {},
    Constants.MESSAGE_TYPES && typeof Constants.MESSAGE_TYPES === 'object' ? Constants.MESSAGE_TYPES : {},
  );

  const DomUtils = (() => {
    const external = ContentCommon.DomUtils || {};

    const isElement =
      typeof external.isElement === 'function'
        ? external.isElement.bind(external)
        : (value) => typeof Element !== 'undefined' && value instanceof Element;
    const isHTMLElement =
      typeof external.isHTMLElement === 'function'
        ? external.isHTMLElement.bind(external)
        : (value) => typeof HTMLElement !== 'undefined' && value instanceof HTMLElement;
    const normalizeText =
      typeof external.normalizeText === 'function'
        ? external.normalizeText.bind(external)
        : (value) => {
            if (value == null) {
              return '';
            }
            return String(value).replace(/\r\n?/g, '\n').trim();
          };
    const isVisible =
      typeof external.isVisible === 'function'
        ? external.isVisible.bind(external)
        : (element) => {
            if (!isHTMLElement(element)) {
              return false;
            }
            if (element.hidden || element.hasAttribute('hidden')) {
              return false;
            }
            const style = root.getComputedStyle(element);
            if (
              style &&
              (style.display === 'none' ||
                style.visibility === 'hidden' ||
                style.visibility === 'collapse' ||
                style.contentVisibility === 'hidden')
            ) {
              return false;
            }
            if (typeof element.getClientRects === 'function' && element.getClientRects().length === 0) {
              return false;
            }
            const rect = element.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          };
    const flattenSelectors =
      typeof external.flattenSelectors === 'function'
        ? external.flattenSelectors.bind(external)
        : (input) => {
            const out = [];
            const queue = [input];
            while (queue.length > 0) {
              const value = queue.shift();
              if (Array.isArray(value)) {
                queue.unshift(...value);
                continue;
              }
              if (typeof value === 'string' && value.trim()) {
                out.push(value.trim());
              }
            }
            return Array.from(new Set(out));
          };
    const queryFirst =
      typeof external.queryFirst === 'function'
        ? external.queryFirst.bind(external)
        : (selectors, scope = document, options = {}) => {
            const selectorList = flattenSelectors(selectors);
            const searchRoot = scope && typeof scope.querySelectorAll === 'function' ? scope : document;
            for (const selector of selectorList) {
              let nodes = [];
              try {
                nodes = Array.from(searchRoot.querySelectorAll(selector));
              } catch (_error) {
                nodes = [];
              }
              for (const node of nodes) {
                if (!isElement(node)) {
                  continue;
                }
                if (options.visibleOnly && !isVisible(node)) {
                  continue;
                }
                return node;
              }
            }
            return null;
          };
    const queryAll =
      typeof external.queryAll === 'function'
        ? external.queryAll.bind(external)
        : (selectors, scope = document, options = {}) => {
            const selectorList = flattenSelectors(selectors);
            const searchRoot = scope && typeof scope.querySelectorAll === 'function' ? scope : document;
            const out = [];
            const seen = new Set();
            for (const selector of selectorList) {
              let nodes = [];
              try {
                nodes = Array.from(searchRoot.querySelectorAll(selector));
              } catch (_error) {
                nodes = [];
              }
              for (const node of nodes) {
                if (!isElement(node) || seen.has(node)) {
                  continue;
                }
                if (options.visibleOnly && !isVisible(node)) {
                  continue;
                }
                seen.add(node);
                out.push(node);
              }
            }
            return out;
          };
    const queryVisible =
      typeof external.queryVisible === 'function'
        ? external.queryVisible.bind(external)
        : (selectors, scope = document) => queryFirst(selectors, scope, { visibleOnly: true });
    const queryAllVisible =
      typeof external.queryAllVisible === 'function'
        ? external.queryAllVisible.bind(external)
        : (selectors, scope = document) => queryAll(selectors, scope, { visibleOnly: true });
    const wait =
      typeof external.wait === 'function'
        ? external.wait.bind(external)
        : (ms = 0) => new Promise((resolve) => root.setTimeout(resolve, Math.max(0, Number(ms) || 0)));
    const focus =
      typeof external.focus === 'function'
        ? external.focus.bind(external)
        : (element, options = {}) => {
            if (!isElement(element) || typeof element.focus !== 'function') {
              return false;
            }
            try {
              if (options.scroll && typeof element.scrollIntoView === 'function') {
                element.scrollIntoView(
                  options.scrollOptions || { behavior: 'auto', block: 'center', inline: 'nearest' },
                );
              }
              element.focus({ preventScroll: Boolean(options.preventScroll) });
              if (options.select && typeof element.select === 'function') {
                element.select();
              }
              return true;
            } catch (_error) {
              try {
                element.focus();
                if (options.select && typeof element.select === 'function') {
                  element.select();
                }
                return true;
              } catch (__error) {
                return false;
              }
            }
          };
    const scrollIntoView =
      typeof external.scrollIntoView === 'function'
        ? external.scrollIntoView.bind(external)
        : (element, options = {}) => {
            if (!isElement(element) || typeof element.scrollIntoView !== 'function') {
              return false;
            }
            try {
              element.scrollIntoView({
                behavior: options.behavior || 'auto',
                block: options.block || 'center',
                inline: options.inline || 'nearest',
              });
              return true;
            } catch (_error) {
              try {
                element.scrollIntoView();
                return true;
              } catch (__error) {
                return false;
              }
            }
          };
    const isDisabled =
      typeof external.isDisabled === 'function'
        ? external.isDisabled.bind(external)
        : (element) => {
            if (!isElement(element)) {
              return false;
            }
            if ('disabled' in element && Boolean(element.disabled)) {
              return true;
            }
            return String(element.getAttribute('aria-disabled') || '').toLowerCase() === 'true';
          };
    const setNativeValue =
      typeof external.setNativeValue === 'function'
        ? external.setNativeValue.bind(external)
        : (element, value) => {
            if (!element || !('value' in element)) {
              throw new Error('Element does not support the value property');
            }
            const previousValue = element.value;
            const targets = [
              element,
              Object.getPrototypeOf(element),
              typeof HTMLInputElement !== 'undefined' ? HTMLInputElement.prototype : null,
              typeof HTMLTextAreaElement !== 'undefined' ? HTMLTextAreaElement.prototype : null,
            ].filter(Boolean);
            let applied = false;
            for (const target of targets) {
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
            const tracker = element._valueTracker;
            if (tracker && typeof tracker.setValue === 'function') {
              try {
                tracker.setValue(String(previousValue));
              } catch (_error) {}
            }
            return value;
          };
    const triggerTextInputEvents =
      typeof external.triggerTextInputEvents === 'function'
        ? external.triggerTextInputEvents.bind(external)
        : (element, options = {}) => {
            if (!isElement(element)) {
              return false;
            }
            const data = typeof options.data === 'string' ? options.data : '';
            const inputType = options.inputType || 'insertText';
            const beforeInput = options.beforeInput === true;
            const change = options.change !== false;
            if (beforeInput) {
              try {
                element.dispatchEvent(
                  new InputEvent('beforeinput', {
                    bubbles: true,
                    cancelable: true,
                    composed: true,
                    inputType,
                    data,
                  }),
                );
              } catch (_error) {}
            }
            try {
              element.dispatchEvent(
                new InputEvent('input', {
                  bubbles: true,
                  cancelable: true,
                  composed: true,
                  inputType,
                  data,
                }),
              );
            } catch (_error) {
              element.dispatchEvent(
                new Event('input', {
                  bubbles: true,
                  cancelable: true,
                  composed: true,
                }),
              );
            }
            if (change) {
              element.dispatchEvent(
                new Event('change', {
                  bubbles: true,
                  cancelable: true,
                  composed: true,
                }),
              );
            }
            return true;
          };
    const fireInput =
      typeof external.fireInput === 'function'
        ? external.fireInput.bind(external)
        : (element, data = '', inputType = 'insertText') =>
            triggerTextInputEvents(element, {
              data,
              inputType,
            });
    const replaceText =
      typeof external.replaceText === 'function'
        ? external.replaceText.bind(external)
        : (element, text, options = {}) => {
            if (!isElement(element)) {
              return false;
            }
            const shouldFocus = options.focusFirst !== false;
            if (shouldFocus) {
              focus(element, {
                scroll: Boolean(options.scroll),
                scrollOptions: options.scrollOptions || {},
                select: false,
              });
            }
            if (
              (typeof HTMLTextAreaElement !== 'undefined' && element instanceof HTMLTextAreaElement) ||
              (typeof HTMLInputElement !== 'undefined' && element instanceof HTMLInputElement)
            ) {
              setNativeValue(element, text);
              if (options.triggerEvents !== false) {
                triggerTextInputEvents(element, {
                  data: text,
                  inputType: 'insertText',
                });
              }
              return true;
            }
            if (
              isHTMLElement(element) &&
              (element.isContentEditable || element.getAttribute('contenteditable') === 'true')
            ) {
              element.innerHTML = '';
              const lines = String(text).split('\n');
              for (let index = 0; index < lines.length; index += 1) {
                if (index > 0) {
                  element.appendChild(document.createElement('br'));
                }
                element.appendChild(document.createTextNode(lines[index]));
              }
              if (typeof root.getSelection === 'function' && typeof document.createRange === 'function') {
                const selection = root.getSelection();
                if (selection) {
                  const range = document.createRange();
                  range.selectNodeContents(element);
                  range.collapse(false);
                  selection.removeAllRanges();
                  selection.addRange(range);
                }
              }
              if (options.triggerEvents !== false) {
                triggerTextInputEvents(element, {
                  data: text,
                  inputType: 'insertText',
                  beforeInput: true,
                });
              }
              return true;
            }
            return false;
          };
    const sendEnterKey =
      typeof external.sendEnterKey === 'function'
        ? external.sendEnterKey.bind(external)
        : (element, options = {}) => {
            if (!isElement(element)) {
              return false;
            }
            const payload = {
              bubbles: true,
              cancelable: true,
              composed: true,
              key: 'Enter',
              code: 'Enter',
              keyCode: 13,
              which: 13,
              altKey: Boolean(options.altKey),
              ctrlKey: Boolean(options.ctrlKey),
              metaKey: Boolean(options.metaKey),
              shiftKey: Boolean(options.shiftKey),
            };
            for (const type of ['keydown', 'keypress', 'keyup']) {
              element.dispatchEvent(new KeyboardEvent(type, payload));
            }
            return true;
          };
    const click =
      typeof external.click === 'function'
        ? external.click.bind(external)
        : (element, options = {}) => {
            if (!isElement(element) || isDisabled(element)) {
              return false;
            }
            if (options.scrollFirst && typeof element.scrollIntoView === 'function') {
              scrollIntoView(element, options.scrollOptions || {});
            }
            try {
              element.click();
              return true;
            } catch (_error) {
              try {
                return element.dispatchEvent(
                  new MouseEvent('click', {
                    bubbles: true,
                    cancelable: true,
                    composed: true,
                    view: root,
                  }),
                );
              } catch (__error) {
                return false;
              }
            }
          };
    const copyTextToClipboard =
      typeof external.copyTextToClipboard === 'function'
        ? external.copyTextToClipboard.bind(external)
        : async (text) => {
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
          };
    return {
      isElement,
      isHTMLElement,
      normalizeText,
      isVisible,
      flattenSelectors,
      queryFirst,
      queryAll,
      queryVisible,
      queryAllVisible,
      wait,
      focus,
      scrollIntoView,
      isDisabled,
      setNativeValue,
      triggerTextInputEvents,
      fireInput,
      replaceText,
      sendEnterKey,
      click,
      copyTextToClipboard,
    };
  })();

  const extractFencedBlocks =
    typeof Parsers.extractFencedBlocks === 'function'
      ? Parsers.extractFencedBlocks.bind(Parsers)
      : (text) => {
          const blocks = [];
          if (typeof text !== 'string' || text.length === 0) {
            return blocks;
          }

          const regex = /```([a-zA-Z0-9_-]+)?\n([\s\S]*?)```/g;
          let match;
          while ((match = regex.exec(text)) !== null) {
            blocks.push({
              language: (match[1] || '').trim().toLowerCase(),
              content: match[2],
            });
          }
          return blocks;
        };

  const parseAIResponsePayload =
    typeof Parsers.parseAIResponsePayload === 'function'
      ? Parsers.parseAIResponsePayload.bind(Parsers)
      : (text) => {
          const blocks = extractFencedBlocks(text);
          const xmlBlocks = blocks.filter((block) => block.language === 'xml');
          const jsonBlocks = blocks.filter((block) => block.language === 'json');
          const diffBlocks = blocks.filter((block) => block.language === 'diff');

          return {
            ok: xmlBlocks.length > 0,
            blocks,
            xmlBlocks,
            jsonBlocks,
            diffBlocks,
            primaryXml: xmlBlocks[0] || null,
            primaryJson: jsonBlocks[0] || null,
            primaryDiff: diffBlocks[0] || null,
            errors: xmlBlocks.length > 0 ? [] : ['xml fenced block not found'],
          };
        };

  function ensureObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  }

  function normalizeText(value) {
    return DomUtils.normalizeText(value);
  }

  function safeStringify(value) {
    try {
      return JSON.stringify(value, null, 2);
    } catch (_error) {
      return String(value);
    }
  }

  function mergeSelectorMap(baseSelectors, extraSelectors) {
    const out = {};
    const keys = new Set([...Object.keys(baseSelectors || {}), ...Object.keys(extraSelectors || {})]);

    for (const key of keys) {
      out[key] = DomUtils.flattenSelectors([
        Array.isArray(baseSelectors && baseSelectors[key]) ? baseSelectors[key] : [],
        Array.isArray(extraSelectors && extraSelectors[key]) ? extraSelectors[key] : [],
      ]);
    }
    return out;
  }

  function createProtocolMessage(type, payload = {}, extra = {}) {
    try {
      if (typeof Protocol.createMessage === 'function') {
        return Protocol.createMessage(type, payload, extra);
      }
    } catch (_error) {}

    try {
      if (typeof Protocol.makeMessage === 'function') {
        return Protocol.makeMessage(type, payload, extra);
      }
    } catch (_error) {}
    return {
      type,
      payload,
      ...extra,
    };
  }

  function readMessageType(message) {
    if (!message || typeof message !== 'object') {
      return null;
    }

    try {
      if (typeof Protocol.getMessageType === 'function') {
        return Protocol.getMessageType(message);
      }
    } catch (_error) {}
    return message.type || message.command || null;
  }

  function readMessagePayload(message) {
    if (!message || typeof message !== 'object') {
      return {};
    }

    try {
      if (typeof Protocol.getPayload === 'function') {
        const payload = Protocol.getPayload(message);
        return ensureObject(payload);
      }
    } catch (_error) {}
    return ensureObject(message.payload);
  }

  function readTargetSite(message) {
    if (!message || typeof message !== 'object') {
      return null;
    }

    const payload = readMessagePayload(message);
    return message.targetSite || message.site || payload.targetSite || payload.site || null;
  }

  function createRuntimeMessenger(site) {
    return {
      async send(message) {
        if (!root.chrome || !chrome.runtime || typeof chrome.runtime.sendMessage !== 'function') {
          return {
            ok: false,
            error: 'chrome.runtime.sendMessage unavailable',
          };
        }

        return await new Promise((resolve) => {
          try {
            chrome.runtime.sendMessage(
              {
                site,
                ...message,
              },
              (response) => {
                const runtimeError =
                  chrome.runtime && chrome.runtime.lastError ? chrome.runtime.lastError.message : null;
                if (runtimeError) {
                  resolve({
                    ok: false,
                    error: runtimeError,
                  });
                  return;
                }
                resolve(response ?? { ok: true });
              },
            );
          } catch (error) {
            resolve({
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        });
      },
    };
  }

  class BaseAdapter {
    constructor(config = {}) {
      const normalizedConfig = ensureObject(config);

      this.config = normalizedConfig;
      this.site =
        typeof normalizedConfig.site === 'string' && normalizedConfig.site.trim()
          ? normalizedConfig.site.trim()
          : 'unknown';
      this.logger = normalizedConfig.logger || createLogger(`content/${this.site}`);
      this.eventNamespace =
        typeof normalizedConfig.eventNamespace === 'string' && normalizedConfig.eventNamespace.trim()
          ? normalizedConfig.eventNamespace.trim()
          : CONTENT_EVENT_NAMESPACE;
      this.messageTypes = Object.assign({}, MESSAGE_TYPES, ensureObject(normalizedConfig.messageTypes));
      this.selectors = mergeSelectorMap(DEFAULT_SELECTORS, ensureObject(normalizedConfig.selectors));
      this.options = Object.assign(
        {
          promptInputPollMs: 250,
          promptInputMaxAttempts: 12,
          focusWaitMs: 30,
          autoSubmitDelayMs: 100,
          outputObservationDebounceMs: 250,
          stableOutputTimeoutMs: 30000,
          stableOutputSettleMs: 1500,
          observeDom: true,
          reportStatusToBackground: false,
        },
        ensureObject(normalizedConfig.options),
      );
      this.parsers = {
        extractFencedBlocks,
        parseAIResponsePayload,
      };
      this.dom = DomUtils;
      this.bridge = normalizedConfig.bridge || null;
      this.messenger =
        normalizedConfig.messenger && typeof normalizedConfig.messenger.send === 'function'
          ? normalizedConfig.messenger
          : createRuntimeMessenger(this.site);
      this.state = {
        ready: false,
        bootTimestamp: new Date().toISOString(),
        lastError: null,
        lastObservedOutput: '',
        lastObservedAt: null,
        lastOutputHash: null,
        lastPacketHash: null,
        url: root.location.href,
        title: document.title,
      };
      this.domObserver = null;
      this.observationTimer = null;
      this.boundHandleRuntimeMessage = this.handleRuntimeMessage.bind(this);
      this.boundHandleVisibilityChange = this.handleVisibilityChange.bind(this);
      this.boundHandleWindowPacketRequest = this.handleWindowPacketRequest.bind(this);
    }
    getStateSnapshot() {
      return Object.assign({}, this.state, {
        site: this.site,
      });
    }
    updateState(patch = {}) {
      Object.assign(this.state, ensureObject(patch), {
        url: root.location.href,
        title: document.title,
      });
      return this.getStateSnapshot();
    }
    setBridge(bridge) {
      this.bridge = bridge || null;
      return this.bridge;
    }
    setSelectors(selectors = {}) {
      this.selectors = mergeSelectorMap(this.selectors, ensureObject(selectors));
      return this.selectors;
    }
    async init() {
      if (this.state.ready) {
        return true;
      }
      await this.onBeforeInit();
      this.installRuntimeListener();
      this.installWindowListeners();
      if (this.options.observeDom) {
        this.installObserver();
      }
      this.updateState({
        ready: true,
        lastError: null,
      });
      this.emitStatus({
        phase: 'initialized',
        site: this.site,
        bootTimestamp: this.state.bootTimestamp,
      });
      await this.notifyBackgroundReady();
      await this.onAfterInit();
      return true;
    }
    async destroy() {
      if (!this.state.ready) {
        return true;
      }
      await this.onBeforeDestroy();
      this.removeRuntimeListener();
      this.removeWindowListeners();
      this.disconnectObserver();
      this.updateState({
        ready: false,
      });
      this.emitStatus({
        phase: 'destroyed',
        site: this.site,
      });
      await this.onAfterDestroy();
      return true;
    }
    async onBeforeInit() {
      return true;
    }
    async onAfterInit() {
      return true;
    }
    async onBeforeDestroy() {
      return true;
    }
    async onAfterDestroy() {
      return true;
    }
    installRuntimeListener() {
      // Legacy AI_PING / AI_INJECT_PROMPT / AI_SUBMIT_PROMPT / AI_EXTRACT_OUTPUT
      // listeners are superseded by content_message_bridge (CONTENT/* types).
      // Keeping this handler registered would race with the bridge because
      // handleRuntimeMessage synchronously responds "unsupported message type"
      // for any CONTENT/* envelope. The handler methods remain callable so
      // bridge handlers can invoke injectPrompt/extractOutput directly.
      return false;
    }
    removeRuntimeListener() {
      return true;
    }
    installWindowListeners() {
      root.addEventListener(`${this.eventNamespace}:packet-request`, this.boundHandleWindowPacketRequest);
      document.addEventListener('visibilitychange', this.boundHandleVisibilityChange);
      return true;
    }
    removeWindowListeners() {
      root.removeEventListener(`${this.eventNamespace}:packet-request`, this.boundHandleWindowPacketRequest);
      document.removeEventListener('visibilitychange', this.boundHandleVisibilityChange);
      return true;
    }
    installObserver() {
      if (typeof MutationObserver !== 'function') {
        return false;
      }
      const target = document.documentElement || document.body;
      if (!target) {
        return false;
      }
      this.disconnectObserver();
      this.domObserver = new MutationObserver(() => {
        if (this.observationTimer) {
          return;
        }
        this.observationTimer = root.setTimeout(async () => {
          this.observationTimer = null;
          try {
            await this.handlePotentialOutputChange();
          } catch (error) {
            this.logger.warn('output observation failed', error);
          }
        }, this.options.outputObservationDebounceMs);
      });
      this.domObserver.observe(target, {
        subtree: true,
        childList: true,
        characterData: true,
      });
      return true;
    }
    disconnectObserver() {
      if (this.observationTimer) {
        root.clearTimeout(this.observationTimer);
        this.observationTimer = null;
      }
      if (this.domObserver && typeof this.domObserver.disconnect === 'function') {
        this.domObserver.disconnect();
      }
      this.domObserver = null;
      return true;
    }
    async handlePotentialOutputChange() {
      const output = this.extractLatestOutputText();
      if (!output) {
        return false;
      }
      const hash = this.computeHash(output);
      if (hash === this.state.lastOutputHash) {
        return false;
      }
      this.updateState({
        lastObservedOutput: output,
        lastObservedAt: new Date().toISOString(),
        lastOutputHash: hash,
      });
      this.emitStatus({
        phase: 'output-observed',
        site: this.site,
        observedAt: this.state.lastObservedAt,
        hasXml: this.hasXmlFence(output),
        hasJson: this.hasJsonFence(output),
        hasDiff: this.hasDiffFence(output),
      });
      await this.onOutputObserved(output);
      return true;
    }
    async onOutputObserved(_output) {
      return true;
    }
    emitStatus(detail = {}) {
      const payload = Object.assign(
        {
          site: this.site,
          ready: this.state.ready,
          lastError: this.state.lastError,
          url: root.location.href,
          title: document.title,
        },
        ensureObject(detail),
        {
          state: this.getStateSnapshot(),
        },
      );
      this.dispatchWindowEvent(`${this.eventNamespace}:status`, payload);
      this.dispatchWindowEvent('maoe:adapter-status', payload);
      if (this.options.reportStatusToBackground) {
        void this.safeSendRuntime(
          createProtocolMessage(this.messageTypes.CONTENT_STATUS, payload, {
            site: this.site,
          }),
        );
      }
      return payload;
    }
    dispatchWindowEvent(name, detail) {
      try {
        root.dispatchEvent(new CustomEvent(name, { detail }));
        return true;
      } catch (error) {
        this.logger.warn('window event dispatch failed', error);
        return false;
      }
    }
    describeCapabilities() {
      return {
        canInjectPrompt: true,
        canSubmitPrompt: true,
        canExtractOutput: true,
        canBuildHumanHubPacket: true,
        canCopyPacketToClipboard: true,
        requiresHumanConfirmationForSensitiveActions: true,
        supportsXmlExtraction: true,
        supportsJsonExtraction: true,
        supportsDiffExtraction: true,
        supportsStableOutputWait: true,
      };
    }
    async notifyBackgroundReady() {
      const message = createProtocolMessage(
        this.messageTypes.CONTENT_READY,
        {
          site: this.site,
          url: root.location.href,
          title: document.title,
          bootTimestamp: this.state.bootTimestamp,
          capabilities: this.describeCapabilities(),
        },
        {
          site: this.site,
        },
      );
      const response = await this.safeSendRuntime(message);
      if (!response || response.ok === false) {
        this.logger.warn('failed to notify background readiness', response);
      }
      return response;
    }
    async safeSendRuntime(message) {
      if (!this.messenger || typeof this.messenger.send !== 'function') {
        return {
          ok: false,
          error: 'runtime messenger unavailable',
        };
      }
      try {
        return await this.messenger.send(message);
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
    isTargetedMessage(message) {
      const targetSite = readTargetSite(message);
      return !targetSite || targetSite === this.site;
    }
    async handleRuntimeMessage(message, sender, sendResponse) {
      if (!message || typeof message !== 'object') {
        return false;
      }
      if (!this.isTargetedMessage(message)) {
        return false;
      }
      const type = readMessageType(message);
      if (!type) {
        sendResponse({
          ok: false,
          error: 'message type missing',
        });
        return false;
      }
      const payload = readMessagePayload(message);
      (async () => {
        try {
          if (type === this.messageTypes.AI_PING) {
            sendResponse({
              ok: true,
              site: this.site,
              ready: this.state.ready,
              capabilities: this.describeCapabilities(),
              state: this.getStateSnapshot(),
            });
            return;
          }
          if (type === this.messageTypes.AI_INJECT_PROMPT) {
            const text = normalizeText(payload.text || payload.prompt || '');
            sendResponse(await this.injectPrompt(text, ensureObject(payload.options)));
            return;
          }
          if (type === this.messageTypes.AI_SUBMIT_PROMPT) {
            sendResponse(await this.submitPrompt(payload));
            return;
          }
          if (type === this.messageTypes.AI_EXTRACT_OUTPUT) {
            sendResponse(await this.extractOutput(payload));
            return;
          }
          if (type === this.messageTypes.HUMAN_HUB_PACKET_REQUEST) {
            sendResponse(await this.createHumanHubPacket(payload));
            return;
          }
          const customResponse = await this.handleCustomRuntimeMessage(message, sender);
          if (customResponse !== undefined) {
            sendResponse(customResponse);
            return;
          }
          sendResponse({
            ok: false,
            error: `unsupported message type: ${String(type)}`,
          });
        } catch (error) {
          const messageText = error instanceof Error ? error.message : String(error);
          this.updateState({
            lastError: messageText,
          });
          this.logger.error('runtime message handling failed', error);
          sendResponse({
            ok: false,
            error: messageText,
          });
        }
      })();
      return true;
    }
    async handleCustomRuntimeMessage(_message, _sender) {
      return undefined;
    }
    async handleWindowPacketRequest(event) {
      const detail = ensureObject(event && event.detail);
      try {
        const result = await this.createHumanHubPacket(ensureObject(detail.payload));
        this.dispatchWindowEvent(`${this.eventNamespace}:packet-response`, {
          ok: true,
          site: this.site,
          requestId: detail.requestId || null,
          result,
        });
      } catch (error) {
        this.dispatchWindowEvent(`${this.eventNamespace}:packet-response`, {
          ok: false,
          site: this.site,
          requestId: detail.requestId || null,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    handleVisibilityChange() {
      this.emitStatus({
        phase: document.hidden ? 'hidden' : 'visible',
        site: this.site,
      });
    }
    async injectPrompt(text, options = {}) {
      const normalized = normalizeText(text);
      if (!normalized) {
        return {
          ok: false,
          error: 'prompt text is empty',
        };
      }
      const input = await this.findPromptInput();
      if (!input) {
        return {
          ok: false,
          error: 'prompt input not found',
        };
      }
      await this.focusInput(input);
      await this.replaceInputText(input, normalized);
      const submitResult = await this.afterPromptInjected(input, normalized, options);
      this.emitStatus({
        phase: 'prompt-injected',
        site: this.site,
        length: normalized.length,
      });
      return {
        ok: true,
        site: this.site,
        injected: true,
        submitted: Boolean(submitResult && submitResult.submitted),
        submitResult: submitResult || null,
        length: normalized.length,
      };
    }
    async findPromptInput() {
      for (let attempt = 0; attempt < this.options.promptInputMaxAttempts; attempt += 1) {
        const input = this.dom.queryVisible(this.selectors.promptInput);
        if (input) {
          return input;
        }
        await this.dom.wait(this.options.promptInputPollMs);
      }
      return null;
    }
    findSubmitButton() {
      return this.dom.queryVisible(this.selectors.submitButton);
    }
    findStopButton() {
      return this.dom.queryVisible(this.selectors.stopButton);
    }
    getConversationRoot() {
      return this.dom.queryVisible(this.selectors.conversationRoot) || document.body;
    }
    async focusInput(input) {
      this.dom.focus(input, {
        scroll: true,
        scrollOptions: {
          behavior: 'auto',
          block: 'center',
          inline: 'nearest',
        },
      });
      await this.dom.wait(this.options.focusWaitMs);
      return true;
    }
    async replaceInputText(input, text) {
      const replaced = this.dom.replaceText(input, text, {
        focusFirst: false,
        triggerEvents: true,
      });
      if (!replaced) {
        throw new Error('unsupported prompt input element');
      }
      return true;
    }
    async afterPromptInjected(_input, _text, options = {}) {
      if (!options.autoSubmit) {
        return {
          ok: true,
        };
      }
      const delayMs =
        typeof options.autoSubmitDelayMs === 'number' ? options.autoSubmitDelayMs : this.options.autoSubmitDelayMs;
      await this.dom.wait(delayMs);
      return await this.submitPrompt(options);
    }
    isDisabledButton(button) {
      return this.dom.isDisabled(button);
    }
    async submitPrompt(options = {}) {
      const button = this.findSubmitButton();
      if (button && !this.isDisabledButton(button)) {
        this.dom.click(button, {
          scrollFirst: Boolean(options.scrollFirst),
        });
        this.emitStatus({
          phase: 'prompt-submitted',
          site: this.site,
          method: 'button-click',
        });
        return {
          ok: true,
          site: this.site,
          submitted: true,
          method: 'button-click',
        };
      }
      const input = await this.findPromptInput();
      if (!input) {
        return {
          ok: false,
          error: 'submit button and prompt input unavailable',
        };
      }
      const form = typeof input.closest === 'function' ? input.closest('form') : null;
      if (form && typeof form.requestSubmit === 'function') {
        form.requestSubmit();
        this.emitStatus({
          phase: 'prompt-submitted',
          site: this.site,
          method: 'form-request-submit',
        });
        return {
          ok: true,
          site: this.site,
          submitted: true,
          method: 'form-request-submit',
        };
      }
      this.dom.sendEnterKey(input, {
        altKey: Boolean(options.altKey),
        ctrlKey: Boolean(options.ctrlKey),
        metaKey: Boolean(options.metaKey),
        shiftKey: Boolean(options.shiftKey),
      });
      this.emitStatus({
        phase: 'prompt-submitted',
        site: this.site,
        method: 'keyboard-enter',
      });
      return {
        ok: true,
        site: this.site,
        submitted: true,
        method: 'keyboard-enter',
      };
    }
    isGenerationInProgress() {
      const stopButton = this.findStopButton();
      if (stopButton && !this.isDisabledButton(stopButton)) {
        return true;
      }
      for (const selector of this.selectors.busyIndicator) {
        let element = null;
        try {
          element = document.querySelector(selector);
        } catch (_error) {
          element = null;
        }
        if (element && this.dom.isVisible(element)) {
          return true;
        }
      }
      return false;
    }
    async waitForStableOutput(options = {}) {
      const timeoutMs = typeof options.timeoutMs === 'number' ? options.timeoutMs : this.options.stableOutputTimeoutMs;
      const settleMs = typeof options.settleMs === 'number' ? options.settleMs : this.options.stableOutputSettleMs;
      const startedAt = Date.now();
      let lastHash = null;
      let stableSince = 0;
      while (Date.now() - startedAt < timeoutMs) {
        const output = this.extractLatestOutputText();
        const generating = this.isGenerationInProgress();
        if (output) {
          const hash = this.computeHash(output);
          if (hash === lastHash) {
            if (stableSince === 0) {
              stableSince = Date.now();
            }
            if (!generating && Date.now() - stableSince >= settleMs) {
              return true;
            }
          } else {
            lastHash = hash;
            stableSince = Date.now();
          }
        }
        await this.dom.wait(300);
      }
      return false;
    }
    async extractOutput(options = {}) {
      const mode = typeof options.mode === 'string' ? options.mode.toLowerCase() : 'latest';
      if (mode === 'stable' || options.waitUntilComplete === true) {
        await this.waitForStableOutput(options);
      }
      const rawText = this.extractLatestOutputText();
      if (!rawText) {
        return {
          ok: false,
          error: 'assistant output not found',
        };
      }
      const fencedBlocks = this.parsers.extractFencedBlocks(rawText);
      const parsed = this.parsers.parseAIResponsePayload(rawText);
      const xmlBlocks = fencedBlocks.filter((block) => block.language === 'xml');
      const jsonBlocks = fencedBlocks.filter((block) => block.language === 'json');
      const diffBlocks = fencedBlocks.filter((block) => block.language === 'diff');
      const meta = {
        extractedAt: new Date().toISOString(),
        hasXmlFence: xmlBlocks.length > 0,
        hasJsonFence: jsonBlocks.length > 0,
        hasDiffFence: diffBlocks.length > 0,
        outputLength: rawText.length,
        blockCounts: {
          xml: xmlBlocks.length,
          json: jsonBlocks.length,
          diff: diffBlocks.length,
          total: fencedBlocks.length,
        },
      };
      this.updateState({
        lastObservedOutput: rawText,
        lastObservedAt: meta.extractedAt,
        lastOutputHash: this.computeHash(rawText),
        lastError: null,
      });
      this.emitStatus({
        phase: 'output-extracted',
        site: this.site,
        extractedAt: meta.extractedAt,
        hasXml: meta.hasXmlFence,
        hasJson: meta.hasJsonFence,
        hasDiff: meta.hasDiffFence,
      });
      await this.onAfterExtractOutput(rawText, parsed, meta);
      return {
        ok: true,
        site: this.site,
        mode,
        rawText,
        fencedBlocks,
        parsed,
        meta,
      };
    }
    async onAfterExtractOutput(_rawText, _parsed, _meta) {
      return true;
    }
    collectAssistantResponseNodes() {
      const direct = [];
      for (const node of this.dom.queryAllVisible(this.selectors.assistantTurn)) {
        if (this.looksLikeUserComposer(node)) {
          continue;
        }
        if (this.looksLikeAssistantResponse(node) || this.nodeContainsStructuredOutput(node)) {
          direct.push(node);
        }
      }
      if (direct.length > 0) {
        return this.uniqueNodes(direct);
      }
      const fallback = [];
      const conversationRoot = this.getConversationRoot();
      const fallbackSelectors = ['article', 'section', 'div', 'pre', 'li'];
      for (const selector of fallbackSelectors) {
        let nodes = [];
        try {
          nodes = Array.from(conversationRoot.querySelectorAll(selector));
        } catch (_error) {
          nodes = [];
        }
        for (const node of nodes) {
          if (!this.dom.isVisible(node)) {
            continue;
          }
          if (this.looksLikeUserComposer(node)) {
            continue;
          }
          const text = normalizeText(node.innerText || node.textContent || '');
          if (text.length < 120) {
            continue;
          }
          if (this.looksLikeAssistantResponse(node) || this.nodeContainsStructuredOutput(node)) {
            fallback.push(node);
          }
        }
      }
      return this.uniqueNodes(fallback);
    }
    extractLatestOutputText() {
      const nodes = this.collectAssistantResponseNodes();
      if (nodes.length === 0) {
        return '';
      }
      return normalizeText(this.extractTextFromNode(nodes[nodes.length - 1]));
    }
    extractTextFromNode(node) {
      if (!node) {
        return '';
      }
      const contentNodes = [];
      for (const selector of this.selectors.markdownContent) {
        let nodes = [];
        try {
          nodes = Array.from(node.querySelectorAll(selector));
        } catch (_error) {
          nodes = [];
        }
        contentNodes.push(...nodes);
      }
      const visibleText = contentNodes
        .filter((child) => this.dom.isVisible(child))
        .map((child) => normalizeText(child.innerText || child.textContent || ''))
        .filter(Boolean)
        .join('\n\n');
      return visibleText || normalizeText(node.innerText || node.textContent || '');
    }
    getNodeHint(node) {
      if (!node || typeof node.getAttribute !== 'function') {
        return '';
      }
      return [
        node.getAttribute('data-message-author-role'),
        node.getAttribute('data-author'),
        node.getAttribute('data-role'),
        node.getAttribute('data-testid'),
        node.getAttribute('aria-label'),
        node.getAttribute('class'),
        node.getAttribute('id'),
      ]
        .filter((value) => typeof value === 'string' && value.trim())
        .join(' ')
        .toLowerCase();
    }
    hasAssistantMarker(node) {
      if (!node || typeof node.matches !== 'function') {
        return false;
      }
      try {
        if (
          node.matches('[data-message-author-role="assistant"], [data-author="assistant"], [data-role="assistant"]')
        ) {
          return true;
        }
      } catch (_error) {}
      try {
        return Boolean(
          node.querySelector(
            '[data-message-author-role="assistant"], [data-author="assistant"], [data-role="assistant"]',
          ),
        );
      } catch (_error) {
        return false;
      }
    }
    hasUserMarker(node) {
      if (!node || typeof node.matches !== 'function') {
        return false;
      }
      try {
        if (node.matches('[data-message-author-role="user"], [data-author="user"], [data-role="user"]')) {
          return true;
        }
      } catch (_error) {}
      try {
        return Boolean(
          node.querySelector('[data-message-author-role="user"], [data-author="user"], [data-role="user"]'),
        );
      } catch (_error) {
        return false;
      }
    }
    looksLikeUserComposer(node) {
      if (!node || typeof node.matches !== 'function') {
        return false;
      }
      try {
        if (node.matches(this.selectors.promptInput.join(','))) {
          return true;
        }
      } catch (_error) {}
      try {
        if (typeof node.querySelector === 'function' && node.querySelector(this.selectors.promptInput.join(','))) {
          return true;
        }
      } catch (_error) {}
      if (node.getAttribute('contenteditable') === 'true' && node.closest('form')) {
        return true;
      }
      if (this.hasUserMarker(node) && !this.hasAssistantMarker(node)) {
        return true;
      }
      const hint = this.getNodeHint(node);
      if (/(composer|prompt|textarea|input|editor)/.test(hint)) {
        return true;
      }
      if (/(user|human)/.test(hint) && !/(assistant|model|bot|ai|response)/.test(hint)) {
        return true;
      }
      return false;
    }
    looksLikeAssistantResponse(node) {
      if (!node || typeof node.matches !== 'function') {
        return false;
      }
      if (this.hasAssistantMarker(node)) {
        return true;
      }
      if (this.hasUserMarker(node) && !this.hasAssistantMarker(node)) {
        return false;
      }
      const hint = this.getNodeHint(node);
      if (/(assistant|model|bot|ai|response)/.test(hint)) {
        return true;
      }
      if (/(user|human|composer|prompt|textarea|input|editor)/.test(hint) && !this.nodeContainsStructuredOutput(node)) {
        return false;
      }
      const text = normalizeText(node.innerText || node.textContent || '');
      return text.length >= 140 && !node.closest('form');
    }
    nodeContainsStructuredOutput(node) {
      const text = normalizeText(node && (node.innerText || node.textContent || ''));
      return Boolean(text) && (this.hasXmlFence(text) || this.hasJsonFence(text) || this.hasDiffFence(text));
    }
    uniqueNodes(nodes) {
      const out = [];
      const seen = new Set();
      for (const node of nodes) {
        if (!node || seen.has(node)) {
          continue;
        }
        seen.add(node);
        out.push(node);
      }
      return out;
    }
    hasXmlFence(text) {
      return /```xml[\t ]*\n[\s\S]*?```/i.test(String(text || ''));
    }
    hasJsonFence(text) {
      return /```json[\t ]*\n[\s\S]*?```/i.test(String(text || ''));
    }
    hasDiffFence(text) {
      return /```diff[\t ]*\n[\s\S]*?```/i.test(String(text || ''));
    }
    computeHash(value) {
      const text = String(value);
      let hash = 0x811c9dc5;
      for (let index = 0; index < text.length; index += 1) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
      }
      return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, '0')}`;
    }
    createPacketEnvelope(kind, payload) {
      try {
        if (typeof Protocol.createHumanHubPacket === 'function') {
          return Protocol.createHumanHubPacket(kind, payload, {
            site: this.site,
          });
        }
      } catch (_error) {}
      if (this.bridge) {
        if (kind === 'PROMPT_TRANSFER' && typeof this.bridge.createPromptTransferPacket === 'function') {
          return this.bridge.createPromptTransferPacket(payload);
        }
        if (kind === 'RESPONSE_TRANSFER' && typeof this.bridge.createResponseTransferPacket === 'function') {
          return this.bridge.createResponseTransferPacket(payload);
        }
      }
      return {
        protocol: 'MAOE/HUMAN_HUB_PACKET@1',
        site: this.site,
        createdAt: new Date().toISOString(),
        kind,
        payload,
      };
    }
    async createHumanHubPacket(payload = {}) {
      const normalizedPayload = ensureObject(payload);
      const kind =
        typeof normalizedPayload.kind === 'string' ? normalizedPayload.kind.toUpperCase() : 'RESPONSE_TRANSFER';
      const options = {
        copyToClipboard: normalizedPayload.copyToClipboard === true,
      };
      if (kind === 'PROMPT_TRANSFER') {
        const prompt = normalizeText(normalizedPayload.prompt || normalizedPayload.text || '');
        if (!prompt) {
          return {
            ok: false,
            error: 'prompt packet requires prompt text',
          };
        }
        const packet = this.createPacketEnvelope('PROMPT_TRANSFER', {
          site: this.site,
          targetModel: normalizedPayload.targetModel || this.site,
          prompt,
          metadata: ensureObject(normalizedPayload.metadata),
          createdAt: new Date().toISOString(),
        });
        return await this.finalizePacket(packet, options);
      }
      const extracted = await this.extractOutput(normalizedPayload);
      if (!extracted.ok) {
        return extracted;
      }
      const packet = this.createPacketEnvelope('RESPONSE_TRANSFER', {
        site: this.site,
        sourceUrl: root.location.href,
        title: document.title,
        rawText: extracted.rawText,
        fencedBlocks: extracted.fencedBlocks,
        parsed: extracted.parsed,
        metadata: ensureObject(normalizedPayload.metadata),
        createdAt: new Date().toISOString(),
      });
      return await this.finalizePacket(packet, options);
    }
    async finalizePacket(packet, options = {}) {
      const serialized =
        this.bridge && typeof this.bridge.serialize === 'function'
          ? this.bridge.serialize(packet)
          : safeStringify(packet);
      const packetHash = this.computeHash(serialized);
      this.updateState({
        lastPacketHash: packetHash,
      });
      let copiedToClipboard = false;
      let clipboardError = null;
      if (options.copyToClipboard) {
        try {
          copiedToClipboard = await this.copyTextToClipboard(serialized);
          if (!copiedToClipboard) {
            clipboardError = 'clipboard copy failed';
          }
        } catch (error) {
          clipboardError = error instanceof Error ? error.message : String(error);
        }
      }
      this.emitStatus({
        phase: 'packet-created',
        site: this.site,
        packetHash,
        copiedToClipboard,
      });
      void this.safeSendRuntime(
        createProtocolMessage(
          this.messageTypes.CONTENT_PACKET_CREATED,
          {
            site: this.site,
            packet,
            packetHash,
            copiedToClipboard,
            clipboardError,
          },
          {
            site: this.site,
          },
        ),
      );
      return {
        ok: true,
        site: this.site,
        packet,
        packetHash,
        serialized,
        copiedToClipboard,
        clipboardError,
      };
    }
    async copyTextToClipboard(text) {
      return await this.dom.copyTextToClipboard(text);
    }
  }

  BaseAdapter.VERSION = '1.0.0';
  BaseAdapter.DEFAULT_MESSAGE_TYPES = DEFAULT_MESSAGE_TYPES;
  BaseAdapter.DEFAULT_SELECTORS = DEFAULT_SELECTORS;
  BaseAdapter.createRuntimeMessenger = createRuntimeMessenger;
  BaseAdapter.createProtocolMessage = createProtocolMessage;

  MAOE.Content.BaseAdapter = BaseAdapter;
})();