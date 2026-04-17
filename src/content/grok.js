(() => {
  'use strict';

  const root = globalThis;
  const MAOE = (root.MAOE = root.MAOE || {});
  MAOE.Content = MAOE.Content || {};

  const Constants = MAOE.Constants || {};
  const LoggerFactory = MAOE.Logger || {};
  const Parsers = MAOE.Parsers || {};
  const ContentCommon = MAOE.Content || {};

  const createLogger = typeof LoggerFactory.create === 'function'
    ? LoggerFactory.create
    : (scope) => ({
        debug: (...args) => console.debug(`[${scope}]`, ...args),
        info: (...args) => console.info(`[${scope}]`, ...args),
        warn: (...args) => console.warn(`[${scope}]`, ...args),
        error: (...args) => console.error(`[${scope}]`, ...args)
      });

  const logger = createLogger('content/grok');
  const AI_SITE = (Constants.AI_SITES && Constants.AI_SITES.GROK) || 'grok';
  const CONTENT_EVENT_NAMESPACE =
    (Constants.EVENTS && Constants.EVENTS.CONTENT) || 'maoe:content';
  const MESSAGE_TYPES = Constants.MESSAGE_TYPES || {
    CONTENT_READY: 'CONTENT_READY',
    CONTENT_STATUS: 'CONTENT_STATUS',
    CONTENT_PACKET_CREATED: 'CONTENT_PACKET_CREATED',
    HUMAN_HUB_PACKET_REQUEST: 'HUMAN_HUB_PACKET_REQUEST',
    AI_INJECT_PROMPT: 'AI_INJECT_PROMPT',
    AI_SUBMIT_PROMPT: 'AI_SUBMIT_PROMPT',
    AI_EXTRACT_OUTPUT: 'AI_EXTRACT_OUTPUT',
    AI_PING: 'AI_PING'
  };

  const BaseAdapter = typeof ContentCommon.BaseAdapter === 'function'
    ? ContentCommon.BaseAdapter
    : class {
        constructor(config = {}) {
          this.config = config;
          this.site = config.site || 'unknown';
          this.logger = config.logger || logger;
          this.state = {
            ready: false,
            lastError: null,
            lastObservedOutput: '',
            lastObservedAt: null
          };
        }

        async init() {
          this.state.ready = true;
          return true;
        }

        async destroy() {
          this.state.ready = false;
          return true;
        }

        emitStatus(detail = {}) {
          try {
            root.dispatchEvent(
              new CustomEvent('maoe:adapter-status', {
                detail: {
                  site: this.site,
                  ready: this.state.ready,
                  lastError: this.state.lastError,
                  ...detail
                }
              })
            );
          } catch (error) {
            this.logger.warn('status dispatch failed', error);
          }
        }

        dispatchWindowEvent(name, detail) {
          try {
            root.dispatchEvent(new CustomEvent(name, { detail }));
          } catch (error) {
            this.logger.warn('window event dispatch failed', error);
          }
        }
      };

  const DomUtils = ContentCommon.DomUtils || {
    isVisible(element) {
      if (!element || !(element instanceof HTMLElement)) return false;
      const style = root.getComputedStyle(element);
      if (style && (style.display === 'none' || style.visibility === 'hidden')) {
        return false;
      }
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    },

    queryVisible(selectors, scope = document) {
      if (!Array.isArray(selectors)) return null;
      for (const selector of selectors) {
        for (const element of Array.from(scope.querySelectorAll(selector))) {
          if (this.isVisible(element)) return element;
        }
      }
      return null;
    },

    queryAllVisible(selectors, scope = document) {
      const out = [];
      if (!Array.isArray(selectors)) return out;
      for (const selector of selectors) {
        for (const element of Array.from(scope.querySelectorAll(selector))) {
          if (this.isVisible(element)) out.push(element);
        }
      }
      return out;
    },

    setNativeValue(element, value) {
      const proto = Object.getPrototypeOf(element);
      const descriptor = proto ? Object.getOwnPropertyDescriptor(proto, 'value') : null;
      if (descriptor && typeof descriptor.set === 'function') {
        descriptor.set.call(element, value);
      } else {
        element.value = value;
      }
    },

    fireInput(element, data = '') {
      try {
        element.dispatchEvent(
          new InputEvent('input', {
            bubbles: true,
            cancelable: true,
            composed: true,
            inputType: 'insertText',
            data
          })
        );
      } catch (_error) {
        element.dispatchEvent(
          new Event('input', { bubbles: true, cancelable: true, composed: true })
        );
      }
      element.dispatchEvent(
        new Event('change', { bubbles: true, cancelable: true, composed: true })
      );
    },

    wait(ms) {
      return new Promise((resolve) => root.setTimeout(resolve, ms));
    }
  };

  const HumanHubBridge = typeof ContentCommon.HumanHubBridge === 'function'
    ? ContentCommon.HumanHubBridge
    : class {
        constructor({ site }) {
          this.site = site;
        }

        createPromptTransferPacket(payload) {
          return {
            protocol: 'MAOE/HUMAN_HUB_PACKET@1',
            site: this.site,
            createdAt: new Date().toISOString(),
            kind: 'PROMPT_TRANSFER',
            payload
          };
        }

        createResponseTransferPacket(payload) {
          return {
            protocol: 'MAOE/HUMAN_HUB_PACKET@1',
            site: this.site,
            createdAt: new Date().toISOString(),
            kind: 'RESPONSE_TRANSFER',
            payload
          };
        }

        serialize(packet) {
          return JSON.stringify(packet, null, 2);
        }
      };

  const extractFencedBlocks = typeof Parsers.extractFencedBlocks === 'function'
    ? Parsers.extractFencedBlocks.bind(Parsers)
    : (text) => {
        const blocks = [];
        if (typeof text !== 'string' || !text) return blocks;
        const regex = /([a-zA-Z0-9_-]+)?\n([\s\S]*?)/g;
        let match;
        while ((match = regex.exec(text)) !== null) {
          blocks.push({
            language: (match[1] || '').trim().toLowerCase(),
            content: match[2]
          });
        }
        return blocks;
      };

  const parseAIResponsePayload = typeof Parsers.parseAIResponsePayload === 'function'
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
          errors: xmlBlocks.length > 0 ? [] : ['xml fenced block not found']
        };
      };

  const normalizeText = (value) =>
    (typeof value === 'string' ? value.replace(/\r\n/g, '\n').trim() : '');
  const ensureObject = (value) =>
    (value && typeof value === 'object' && !Array.isArray(value) ? value : {});
  const safeStringify = (value) => {
    try {
      return JSON.stringify(value, null, 2);
    } catch (_error) {
      return String(value);
    }
  };

  function createRuntimeMessenger(site) {
    return {
      async send(message) {
        if (
          !root.chrome ||
          !chrome.runtime ||
          typeof chrome.runtime.sendMessage !== 'function'
        ) {
          return { ok: false, error: 'chrome.runtime.sendMessage unavailable' };
        }
        return await new Promise((resolve) => {
          try {
            chrome.runtime.sendMessage({ site, ...message }, (response) => {
              const runtimeError =
                chrome.runtime && chrome.runtime.lastError
                  ? chrome.runtime.lastError.message
                  : null;
              if (runtimeError) {
                resolve({ ok: false, error: runtimeError });
              } else {
                resolve(response ?? { ok: true });
              }
            });
          } catch (error) {
            resolve({
              ok: false,
              error: error instanceof Error ? error.message : String(error)
            });
          }
        });
      }
    };
  }

  class GrokAdapter extends BaseAdapter {
    constructor() {
      super({ site: AI_SITE, logger });
      this.bridge = new HumanHubBridge({ site: AI_SITE, logger });
      this.messenger = createRuntimeMessenger(AI_SITE);
      this.selectors = {
        promptInput: [
          'textarea[placeholder]',
          'textarea',
          'div[contenteditable="true"][role="textbox"]',
          'div[contenteditable="true"][data-testid*="composer"]',
          'div[contenteditable="true"][data-lexical-editor="true"]',
          'div.ProseMirror[contenteditable="true"]',
          'div[contenteditable="true"]'
        ],
        submitButton: [
          'button[aria-label*="Send"]',
          'button[aria-label*="send"]',
          'button[aria-label*="送信"]',
          'button[data-testid*="send"]',
          'form button[type="submit"]',
          'form button:not([disabled])'
        ],
        assistantTurn: [
          '[data-message-author-role="assistant"]',
          '[data-author="assistant"]',
          '[data-role="assistant"]',
          '[data-testid*="assistant"]',
          '[data-testid*="response"]',
          '[data-testid*="conversation-turn"]',
          'article[data-author]',
          'article',
          'div[class*="assistant"]',
          'div[class*="response"]',
          'div[class*="message"]'
        ],
        markdownContent: [
          '.prose',
          '[data-testid*="message-content"]',
          'div[class*="markdown"]',
          'div[class*="prose"]',
          'pre',
          'code',
          'article'
        ],
        stopButton: [
          'button[aria-label*="Stop"]',
          'button[aria-label*="stop"]',
          'button[aria-label*="停止"]',
          'button[data-testid*="stop"]',
          'button[data-testid*="abort"]'
        ],
        conversationRoot: ['main', '[role="main"]', '#root', 'body']
      };
      this.boundHandleRuntimeMessage = this.handleRuntimeMessage.bind(this);
      this.boundHandleWindowPacketRequest = this.handleWindowPacketRequest.bind(this);
      this.boundHandleVisibilityChange = this.handleVisibilityChange.bind(this);
      this.domObserver = null;
      this.observationTimer = null;
      this.lastOutputHash = null;
      this.lastPacketHash = null;
      this.bootTimestamp = new Date().toISOString();
    }

    async init() {
      if (this.state.ready) return true;
      if (root.chrome && chrome.runtime && chrome.runtime.onMessage) {
        chrome.runtime.onMessage.addListener(this.boundHandleRuntimeMessage);
      }
      root.addEventListener(
        `${CONTENT_EVENT_NAMESPACE}:packet-request`,
        this.boundHandleWindowPacketRequest
      );
      document.addEventListener('visibilitychange', this.boundHandleVisibilityChange);
      this.installObserver();
      this.state.ready = true;
      this.state.lastError = null;
      this.emitStatus({
        phase: 'initialized',
        site: this.site,
        url: root.location.href,
        bootTimestamp: this.bootTimestamp
      });
      await this.notifyBackgroundReady();
      logger.info('adapter initialized', { site: this.site, href: root.location.href });
      return true;
    }

    async destroy() {
      if (!this.state.ready) return true;
      if (root.chrome && chrome.runtime && chrome.runtime.onMessage) {
        chrome.runtime.onMessage.removeListener(this.boundHandleRuntimeMessage);
      }
      root.removeEventListener(
        `${CONTENT_EVENT_NAMESPACE}:packet-request`,
        this.boundHandleWindowPacketRequest
      );
      document.removeEventListener('visibilitychange', this.boundHandleVisibilityChange);
      if (this.domObserver) this.domObserver.disconnect();
      if (this.observationTimer) root.clearTimeout(this.observationTimer);
      this.domObserver = null;
      this.observationTimer = null;
      this.state.ready = false;
      this.emitStatus({ phase: 'destroyed', site: this.site });
      return true;
    }

    installObserver() {
      this.domObserver = new MutationObserver(() => {
        if (this.observationTimer) return;
        this.observationTimer = root.setTimeout(() => {
          this.observationTimer = null;
          const output = this.extractLatestOutputText();
          if (!output) return;
          const hash = this.computeHash(output);
          if (hash === this.lastOutputHash) return;
          this.lastOutputHash = hash;
          this.state.lastObservedOutput = output;
          this.state.lastObservedAt = new Date().toISOString();
          this.emitStatus({
            phase: 'output-observed',
            site: this.site,
            observedAt: this.state.lastObservedAt,
            hasXml: this.hasXmlFence(output),
            hasJson: this.hasJsonFence(output),
            hasDiff: this.hasDiffFence(output)
          });
        }, 250);
      });
      this.domObserver.observe(document.documentElement || document.body, {
        subtree: true,
        childList: true,
        characterData: true
      });
    }

    async notifyBackgroundReady() {
      const response = await this.messenger.send({
        type: MESSAGE_TYPES.CONTENT_READY,
        payload: {
          site: this.site,
          url: root.location.href,
          title: document.title,
          bootTimestamp: this.bootTimestamp,
          capabilities: this.describeCapabilities()
        }
      });
      if (!response || response.ok === false) {
        logger.warn('failed to notify background readiness', response);
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
        supportsStableOutputWait: true
      };
    }

    handleVisibilityChange() {
      this.emitStatus({
        phase: document.hidden ? 'hidden' : 'visible',
        site: this.site,
        title: document.title
      });
    }

    async handleRuntimeMessage(message, _sender, sendResponse) {
      if (!message || typeof message !== 'object') return false;
      const requestedSite = message.site || message.targetSite || null;
      if (requestedSite && requestedSite !== this.site) return false;
      const type = message.type || message.command;
      if (!type) {
        sendResponse({ ok: false, error: 'message type missing' });
        return false;
      }
      (async () => {
        try {
          if (type === MESSAGE_TYPES.AI_PING) {
            sendResponse({
              ok: true,
              site: this.site,
              ready: this.state.ready,
              capabilities: this.describeCapabilities()
            });
            return;
          }
          if (type === MESSAGE_TYPES.AI_INJECT_PROMPT) {
            const payload = ensureObject(message.payload);
            sendResponse(
              await this.injectPrompt(
                normalizeText(payload.text || payload.prompt || ''),
                ensureObject(payload.options)
              )
            );
            return;
          }
          if (type === MESSAGE_TYPES.AI_SUBMIT_PROMPT) {
            sendResponse(await this.submitPrompt(ensureObject(message.payload)));
            return;
          }
          if (type === MESSAGE_TYPES.AI_EXTRACT_OUTPUT) {
            sendResponse(await this.extractOutput(ensureObject(message.payload)));
            return;
          }
          if (type === MESSAGE_TYPES.HUMAN_HUB_PACKET_REQUEST) {
            sendResponse(await this.createHumanHubPacket(ensureObject(message.payload)));
            return;
          }
          sendResponse({ ok: false, error: `unsupported message type: ${String(type)}` });
        } catch (error) {
          const messageText = error instanceof Error ? error.message : String(error);
          this.state.lastError = messageText;
          logger.error('runtime message handling failed', error);
          sendResponse({ ok: false, error: messageText });
        }
      })();
      return true;
    }

    async handleWindowPacketRequest(event) {
      const detail = ensureObject(event && event.detail);
      try {
        const result = await this.createHumanHubPacket(ensureObject(detail.payload));
        this.dispatchWindowEvent(`${CONTENT_EVENT_NAMESPACE}:packet-response`, {
          ok: true,
          site: this.site,
          requestId: detail.requestId || null,
          result
        });
      } catch (error) {
        this.dispatchWindowEvent(`${CONTENT_EVENT_NAMESPACE}:packet-response`, {
          ok: false,
          site: this.site,
          requestId: detail.requestId || null,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    async injectPrompt(text, options = {}) {
      if (!text) return { ok: false, error: 'prompt text is empty' };
      const input = await this.findPromptInput();
      if (!input) return { ok: false, error: 'prompt input not found' };
      await this.focusInput(input);
      await this.replaceInputText(input, text);
      const submitResult = await this.afterPromptInjected(input, text, options);
      this.emitStatus({ phase: 'prompt-injected', site: this.site, length: text.length });
      return {
        ok: true,
        site: this.site,
        injected: true,
        submitted: Boolean(submitResult && submitResult.submitted),
        submitResult: submitResult || null,
        length: text.length
      };
    }

    async submitPrompt() {
      const button = this.findSubmitButton();
      if (button && !this.isDisabledButton(button)) {
        button.click();
        this.emitStatus({ phase: 'prompt-submitted', site: this.site, method: 'button-click' });
        return { ok: true, site: this.site, submitted: true, method: 'button-click' };
      }
      const input = await this.findPromptInput();
      if (!input) return { ok: false, error: 'submit button and prompt input unavailable' };
      const form = typeof input.closest === 'function' ? input.closest('form') : null;
      if (form && typeof form.requestSubmit === 'function') {
        form.requestSubmit();
        this.emitStatus({
          phase: 'prompt-submitted',
          site: this.site,
          method: 'form-request-submit'
        });
        return {
          ok: true,
          site: this.site,
          submitted: true,
          method: 'form-request-submit'
        };
      }
      for (const eventName of ['keydown', 'keypress', 'keyup']) {
        input.dispatchEvent(
          new KeyboardEvent(eventName, {
            key: 'Enter',
            code: 'Enter',
            which: 13,
            keyCode: 13,
            bubbles: true,
            cancelable: true
          })
        );
      }
      this.emitStatus({ phase: 'prompt-submitted', site: this.site, method: 'keyboard-enter' });
      return { ok: true, site: this.site, submitted: true, method: 'keyboard-enter' };
    }

    async extractOutput(options = {}) {
      const mode = typeof options.mode === 'string' ? options.mode.toLowerCase() : 'latest';
      if (mode === 'stable' || options.waitUntilComplete === true) {
        await this.waitForStableOutput({
          timeoutMs: typeof options.timeoutMs === 'number' ? options.timeoutMs : 30000,
          settleMs: typeof options.settleMs === 'number' ? options.settleMs : 1500
        });
      }
      const rawText = this.extractLatestOutputText();
      if (!rawText) return { ok: false, error: 'assistant output not found' };
      const fencedBlocks = extractFencedBlocks(rawText);
      const parsed = parseAIResponsePayload(rawText);
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
          total: fencedBlocks.length
        }
      };
      this.state.lastObservedOutput = rawText;
      this.state.lastObservedAt = meta.extractedAt;
      this.lastOutputHash = this.computeHash(rawText);
      this.emitStatus({
        phase: 'output-extracted',
        site: this.site,
        extractedAt: meta.extractedAt,
        hasXml: meta.hasXmlFence,
        hasJson: meta.hasJsonFence,
        hasDiff: meta.hasDiffFence
      });
      return { ok: true, site: this.site, mode, rawText, fencedBlocks, parsed, meta };
    }

    async createHumanHubPacket(payload = {}) {
      const kind = typeof payload.kind === 'string' ? payload.kind.toUpperCase() : 'RESPONSE_TRANSFER';
      const options = { copyToClipboard: payload.copyToClipboard === true };
      if (kind === 'PROMPT_TRANSFER') {
        const prompt = normalizeText(payload.prompt || payload.text || '');
        if (!prompt) return { ok: false, error: 'prompt packet requires prompt text' };
        return await this.finalizePacket(
          this.bridge.createPromptTransferPacket({
            site: this.site,
            targetModel: payload.targetModel || 'grok',
            prompt,
            metadata: ensureObject(payload.metadata),
            createdAt: new Date().toISOString()
          }),
          options
        );
      }
      const extracted = await this.extractOutput(payload);
      if (!extracted.ok) return extracted;
      return await this.finalizePacket(
        this.bridge.createResponseTransferPacket({
          site: this.site,
          sourceUrl: root.location.href,
          title: document.title,
          rawText: extracted.rawText,
          fencedBlocks: extracted.fencedBlocks,
          parsed: extracted.parsed,
          metadata: ensureObject(payload.metadata),
          createdAt: new Date().toISOString()
        }),
        options
      );
    }

    async finalizePacket(packet, options = {}) {
      const serialized =
        typeof this.bridge.serialize === 'function'
          ? this.bridge.serialize(packet)
          : safeStringify(packet);
      const packetHash = this.computeHash(serialized);
      this.lastPacketHash = packetHash;
      let copiedToClipboard = false;
      let clipboardError = null;
      if (options.copyToClipboard) {
        try {
          copiedToClipboard = await this.copyTextToClipboard(serialized);
          if (!copiedToClipboard) clipboardError = 'clipboard copy failed';
        } catch (error) {
          clipboardError = error instanceof Error ? error.message : String(error);
        }
      }
      this.emitStatus({ phase: 'packet-created', site: this.site, packetHash, copiedToClipboard });
      void this.messenger.send({
        type: MESSAGE_TYPES.CONTENT_PACKET_CREATED,
        payload: { site: this.site, packet, packetHash, copiedToClipboard, clipboardError }
      });
      return {
        ok: true,
        site: this.site,
        packet,
        packetHash,
        serialized,
        copiedToClipboard,
        clipboardError
      };
    }

    async findPromptInput() {
      for (let attempt = 0; attempt < 12; attempt += 1) {
        const input = DomUtils.queryVisible(this.selectors.promptInput);
        if (input) return input;
        await DomUtils.wait(250);
      }
      return null;
    }

    findSubmitButton() {
      return DomUtils.queryVisible(this.selectors.submitButton);
    }

    findConversationRoot() {
      return DomUtils.queryVisible(this.selectors.conversationRoot) || document.body;
    }

    isDisabledButton(button) {
      return (
        !button ||
        button.disabled ||
        (button.getAttribute('aria-disabled') || '').toLowerCase() === 'true'
      );
    }

    hasXmlFence(text) {
      return /```xml[\t ]*\n[\s\S]*?```/i.test(text);
    }

    hasJsonFence(text) {
      return /```json[\t ]*\n[\s\S]*?```/i.test(text);
    }

    hasDiffFence(text) {
      return /```diff[\t ]*\n[\s\S]*?```/i.test(text);
    }

    isGenerationInProgress() {
      const stopButton = DomUtils.queryVisible(this.selectors.stopButton);
      if (stopButton && !this.isDisabledButton(stopButton)) return true;
      const busy = document.querySelector(
        '[aria-busy="true"], [data-loading="true"], [data-testid*="loading"]'
      );
      return Boolean(busy && DomUtils.isVisible(busy));
    }

    async waitForStableOutput({ timeoutMs = 30000, settleMs = 1500 } = {}) {
      const startedAt = Date.now();
      let lastHash = null;
      let stableSince = 0;
      while (Date.now() - startedAt < timeoutMs) {
        const output = this.extractLatestOutputText();
        const generating = this.isGenerationInProgress();
        if (output) {
          const hash = this.computeHash(output);
          if (hash === lastHash) {
            if (stableSince === 0) stableSince = Date.now();
            if (!generating && Date.now() - stableSince >= settleMs) return true;
          } else {
            lastHash = hash;
            stableSince = Date.now();
          }
        }
        await DomUtils.wait(300);
      }
      return false;
    }

    async focusInput(input) {
      try {
        input.focus();
        if (typeof input.scrollIntoView === 'function') {
          input.scrollIntoView({
            behavior: 'auto',
            block: 'center',
            inline: 'nearest'
          });
        }
      } catch (error) {
        logger.warn('failed to focus input', error);
      }
      await DomUtils.wait(30);
    }

    async replaceInputText(input, text) {
      const tagName = input.tagName.toLowerCase();
      if (tagName === 'textarea' || tagName === 'input') {
        DomUtils.setNativeValue(input, text);
        DomUtils.fireInput(input, text);
        return;
      }
      if (!input.isContentEditable) throw new Error('unsupported prompt input element');
      this.clearContentEditable(input);
      this.insertContentEditableText(input, text);
    }

    clearContentEditable(element) {
      element.focus();
      const selection = root.getSelection ? root.getSelection() : null;
      if (selection) {
        selection.removeAllRanges();
        const range = document.createRange();
        range.selectNodeContents(element);
        selection.addRange(range);
      }
      try {
        document.execCommand('delete', false);
      } catch (_error) {
        element.textContent = '';
      }
      if (selection) selection.removeAllRanges();
    }

    insertContentEditableText(element, text) {
      element.focus();
      let inserted = false;
      try {
        inserted = document.execCommand('insertText', false, text);
      } catch (_error) {
        inserted = false;
      }
      if (!inserted || normalizeText(element.innerText || element.textContent || '') !== normalizeText(text)) {
        element.innerHTML = '';
        const lines = text.split('\n');
        for (let i = 0; i < lines.length; i += 1) {
          if (i > 0) element.appendChild(document.createElement('br'));
          element.appendChild(document.createTextNode(lines[i]));
        }
      }
      const selection = root.getSelection ? root.getSelection() : null;
      if (selection) {
        selection.removeAllRanges();
        const range = document.createRange();
        range.selectNodeContents(element);
        range.collapse(false);
        selection.addRange(range);
      }
      try {
        element.dispatchEvent(
          new InputEvent('beforeinput', {
            bubbles: true,
            cancelable: true,
            composed: true,
            inputType: 'insertText',
            data: text
          })
        );
      } catch (_error) {
      }
      DomUtils.fireInput(element, text);
    }

    async afterPromptInjected(_input, _text, options = {}) {
      if (!options.autoSubmit) return { ok: true };
      await DomUtils.wait(
        typeof options.autoSubmitDelayMs === 'number' ? options.autoSubmitDelayMs : 100
      );
      return await this.submitPrompt(options);
    }

    collectAssistantResponseNodes() {
      const direct = [];
      for (const node of DomUtils.queryAllVisible(this.selectors.assistantTurn)) {
        if (this.looksLikeUserComposer(node)) continue;
        if (this.looksLikeAssistantResponse(node) || this.nodeContainsStructuredOutput(node)) {
          direct.push(node);
        }
      }
      if (direct.length > 0) return this.uniqueNodes(direct);
      const fallback = [];
      for (const node of Array.from(this.findConversationRoot().querySelectorAll('article, section, div, pre'))) {
        if (!DomUtils.isVisible(node) || this.looksLikeUserComposer(node)) continue;
        const text = normalizeText(node.innerText || node.textContent || '');
        if (text.length < 120) continue;
        if (this.looksLikeAssistantResponse(node) || this.nodeContainsStructuredOutput(node)) {
          fallback.push(node);
        }
      }
      return this.uniqueNodes(fallback);
    }

    extractLatestOutputText() {
      const nodes = this.collectAssistantResponseNodes();
      if (nodes.length === 0) return '';
      return normalizeText(this.extractTextFromNode(nodes[nodes.length - 1]));
    }

    extractTextFromNode(node) {
      if (!node) return '';
      const contentNodes = [];
      for (const selector of this.selectors.markdownContent) {
        contentNodes.push(...Array.from(node.querySelectorAll(selector)));
      }
      const visibleText = contentNodes
        .filter((child) => DomUtils.isVisible(child))
        .map((child) => normalizeText(child.innerText || child.textContent || ''))
        .filter(Boolean)
        .join('\n\n');
      return visibleText || normalizeText(node.innerText || node.textContent || '');
    }

    nodeContainsStructuredOutput(node) {
      const text = normalizeText(node && (node.innerText || node.textContent || ''));
      return Boolean(text) && (
        this.hasXmlFence(text) ||
        this.hasJsonFence(text) ||
        this.hasDiffFence(text)
      );
    }

    looksLikeUserComposer(node) {
      if (!node || !(node instanceof Element)) return false;
      const promptSelector = this.selectors.promptInput.join(',');
      if (node.matches(promptSelector)) return true;
      const hint = this.getNodeHint(node);
      if (/(composer|prompt|textarea|input|editor)/.test(hint)) return true;
      if (/(user|human)/.test(hint) && !/(assistant|grok|model|bot|ai)/.test(hint)) return true;
      if (node.getAttribute('contenteditable') === 'true' && node.closest('form')) return true;
      if (typeof node.querySelector === 'function' && node.querySelector(promptSelector)) return true;
      return false;
    }

    looksLikeAssistantResponse(node) {
      if (!node || !(node instanceof Element)) return false;
      const hint = this.getNodeHint(node);
      if (/(assistant|grok|model|bot|ai|response)/.test(hint)) return true;
      if (/(user|human|composer|prompt|textarea|input)/.test(hint) && !this.nodeContainsStructuredOutput(node)) {
        return false;
      }
      const text = normalizeText(node.innerText || node.textContent || '');
      return text.length >= 160 && !node.closest('form');
    }

    getNodeHint(node) {
      return [
        node.getAttribute('data-message-author-role'),
        node.getAttribute('data-author'),
        node.getAttribute('data-role'),
        node.getAttribute('data-testid'),
        node.getAttribute('aria-label'),
        node.getAttribute('class'),
        node.getAttribute('id')
      ]
        .filter((value) => typeof value === 'string' && value.trim())
        .join(' ')
        .toLowerCase();
    }

    uniqueNodes(nodes) {
      const seen = new Set();
      const out = [];
      for (const node of nodes) {
        if (!node || seen.has(node)) continue;
        seen.add(node);
        out.push(node);
      }
      return out;
    }

    computeHash(value) {
      const text = String(value);
      let hash = 0x811c9dc5;
      for (let i = 0; i < text.length; i += 1) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
      }
      return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, '0')}`;
    }

    async copyTextToClipboard(text) {
      if (
        root.navigator &&
        navigator.clipboard &&
        typeof navigator.clipboard.writeText === 'function'
      ) {
        await navigator.clipboard.writeText(text);
        return true;
      }
      const helper = document.createElement('textarea');
      helper.value = text;
      helper.setAttribute('readonly', 'readonly');
      helper.style.position = 'fixed';
      helper.style.top = '-1000px';
      helper.style.left = '-1000px';
      document.body.appendChild(helper);
      helper.focus();
      helper.select();
      let copied = false;
      try {
        copied = document.execCommand('copy');
      } finally {
        helper.remove();
      }
      return copied;
    }
  }

  function registerAdapter(adapter) {
    MAOE.Content.adapters = MAOE.Content.adapters || {};
    MAOE.Content.adapters[AI_SITE] = adapter;
    MAOE.Content.getAdapter =
      MAOE.Content.getAdapter || ((site) => MAOE.Content.adapters[site] || null);
    MAOE.Content.GrokAdapter = GrokAdapter;
  }

  function registerMessageBridge(adapter) {
    if (!MAOE || typeof MAOE.has !== 'function' || !MAOE.has('content_message_bridge')) {
      return;
    }
    let bridge;
    try {
      bridge = MAOE.require('content_message_bridge');
    } catch (error) {
      return;
    }
    if (!bridge || typeof bridge.registerHandlers !== 'function') {
      return;
    }
    try {
      bridge.registerHandlers({
        probe: async function onProbe() {
          const input = await adapter.findPromptInput().catch(() => null);
          const submit = typeof adapter.findSubmitButton === 'function' ? adapter.findSubmitButton() : null;
          return {
            ok: true,
            siteInfo: {
              siteId: AI_SITE,
              providerId: AI_SITE,
              displayName: 'Grok',
              url: root.location && root.location.href ? root.location.href : '',
              host: root.location && root.location.hostname ? root.location.hostname : ''
            },
            ready: !!(adapter.state && adapter.state.ready),
            promptElementFound: !!input,
            submitElementFound: !!submit
          };
        },
        fillPrompt: async function onFillPrompt(payload) {
          const text = payload && typeof payload.prompt === 'string' ? payload.prompt : '';
          const opts = payload && payload.options && typeof payload.options === 'object' ? payload.options : {};
          const inject = await adapter.injectPrompt(text, opts);
          let submitted = false;
          if (inject && inject.ok && opts.autoSubmit) {
            try {
              const result = await adapter.submitPrompt(opts);
              submitted = !!(result && result.ok);
            } catch (error) {
              submitted = false;
            }
          }
          return Object.assign({}, inject || {}, { submitted: submitted, providerId: AI_SITE });
        },
        extractLatestResponse: async function onExtract(payload) {
          const opts = payload && payload.options && typeof payload.options === 'object' ? payload.options : {};
          const result = await adapter.extractOutput(opts);
          return {
            ok: !!(result && result.ok),
            rawText: result && typeof result.rawText === 'string' ? result.rawText : '',
            fencedBlocks: result && Array.isArray(result.fencedBlocks) ? result.fencedBlocks : [],
            parsed: result && result.parsed ? result.parsed : null,
            meta: result && result.meta ? result.meta : null,
            providerId: AI_SITE
          };
        }
      }, {
        providerId: AI_SITE,
        siteId: AI_SITE,
        displayName: 'Grok'
      });
    } catch (error) {
      logger.warn('grok_message_bridge_register_failed', error);
    }
  }

  async function bootstrap() {
    try {
      const adapter = new GrokAdapter();
      registerAdapter(adapter);
      await adapter.init();
      registerMessageBridge(adapter);
      root.MAOE_GROK_ADAPTER = adapter;
      logger.info('bootstrap complete', { site: AI_SITE, href: root.location.href });
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      logger.error('bootstrap failed', error);
      try {
        if (root.chrome && chrome.runtime && typeof chrome.runtime.sendMessage === 'function') {
          chrome.runtime.sendMessage({
            type: MESSAGE_TYPES.CONTENT_STATUS,
            site: AI_SITE,
            payload: {
              site: AI_SITE,
              ready: false,
              error: messageText,
              url: root.location.href
            }
          });
        }
      } catch (_notifyError) {
      }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener(
      'DOMContentLoaded',
      () => {
        void bootstrap();
      },
      { once: true }
    );
  } else {
    void bootstrap();
  }
})();
