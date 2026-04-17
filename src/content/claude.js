(function initClaudeContentScript(global) {
  'use strict';

  const MAOE = global.MAOE = global.MAOE || {};
  MAOE.content = MAOE.content || {};
  MAOE.content.common = MAOE.content.common || {};
  MAOE.content.adapters = MAOE.content.adapters || {};

  if (MAOE.content.__claudeContentScriptLoaded === true) {
    return;
  }
  MAOE.content.__claudeContentScriptLoaded = true;

  const constants = MAOE.constants || {};
  const domUtils = MAOE.content.common.domUtils || MAOE.domUtils || {};
  const bridgeNamespace = MAOE.content.common || {};
  const createBridge =
    (typeof bridgeNamespace.createHumanHubBridge === 'function' && bridgeNamespace.createHumanHubBridge) ||
    (bridgeNamespace.humanHubBridge &&
      typeof bridgeNamespace.humanHubBridge.createHumanHubBridge === 'function' &&
      bridgeNamespace.humanHubBridge.createHumanHubBridge) ||
    null;

  const SITE_ID = (constants.SITES && constants.SITES.CLAUDE) || 'claude';
  const READY_EVENT = 'maoe:claude:ready';
  const STATUS_EVENT = 'maoe:claude:status';
  const ERROR_EVENT = 'maoe:claude:error';

  const SELECTORS = Object.freeze({
    transcriptRoot: [
      '[role="main"]',
      'main',
      '[data-testid*="conversation"]',
      '[data-testid*="chat"]'
    ],
    composer: [
      'form .ProseMirror[contenteditable="true"]',
      'form [contenteditable="true"][role="textbox"]',
      'form [contenteditable="true"]',
      'form [contenteditable]',
      'form textarea',
      'footer .ProseMirror[contenteditable="true"]',
      'footer [contenteditable="true"][role="textbox"]',
      'footer [contenteditable="true"]',
      'footer [contenteditable]',
      'footer textarea',
      '[aria-label*="Message Claude"]',
      '[aria-label*="Talk to Claude"]',
      '[placeholder*="Message Claude"]',
      '[placeholder*="Talk to Claude"]',
      '[contenteditable="true"][data-testid*="composer"]',
      '[contenteditable][data-testid*="composer"]'
    ],
    submitButton: [
      'form button[type="submit"]',
      'form button[aria-label*="Send"]',
      'form button[aria-label*="send"]',
      'form button[data-testid*="send"]',
      'footer button[type="submit"]',
      'footer button[aria-label*="Send"]',
      'footer button[aria-label*="send"]',
      'button[aria-label*="Send message"]',
      'button[aria-label*="Send"]'
    ],
    stopButton: [
      'form button[aria-label*="Stop"]',
      'form button[data-testid*="stop"]',
      'button[aria-label*="Stop generating"]',
      'button[aria-label*="Stop response"]'
    ],
    assistantTurns: [
      '[data-message-author-role="assistant"]',
      '[data-author="assistant"]',
      '[data-role="assistant"]',
      '[data-testid*="assistant"]',
      '[class*="assistant"]'
    ],
    userTurns: [
      '[data-message-author-role="user"]',
      '[data-author="user"]',
      '[data-role="user"]',
      '[data-testid*="user"]',
      '[class*="user"]'
    ],
    turnLike: [
      '[data-message-author-role]',
      '[data-testid*="conversation-turn"]',
      '[data-testid*="message"]',
      '[data-testid*="turn"]',
      '[data-author]',
      '[data-role]',
      '[class*="message"]',
      '[class*="turn"]',
      'article',
      'section'
    ]
  });

  function logger() {
    const fallback = function make(method) {
      return function emit() {
        if (!global.console || typeof global.console[method] !== 'function') {
          return;
        }
        const args = Array.prototype.slice.call(arguments);
        global.console[method].apply(global.console, ['[content/claude]'].concat(args));
      };
    };
    if (MAOE.logger) {
      if (typeof MAOE.logger.create === 'function') {
        return MAOE.logger.create('content/claude');
      }
      if (typeof MAOE.logger.getLogger === 'function') {
        return MAOE.logger.getLogger('content/claude');
      }
      if (typeof MAOE.logger.info === 'function') {
        return MAOE.logger;
      }
    }
    return {
      debug: fallback('debug'),
      info: fallback('info'),
      warn: fallback('warn'),
      error: fallback('error')
    };
  }

  const log = logger();

  function str(value, fallback) {
    if (typeof value === 'string') return value;
    if (value === null || value === undefined) return typeof fallback === 'string' ? fallback : '';
    return String(value);
  }

  function trim(value, fallback) {
    return str(value, fallback).trim();
  }

  function arr(value) {
    if (Array.isArray(value)) return value;
    if (value === null || value === undefined) return [];
    return [value];
  }

  function obj(value) {
    return Object.prototype.toString.call(value) === '[object Object]';
  }

  function line(value) {
    return str(value).replace(/\r\n?/g, '\n');
  }

  function normalizeText(value) {
    return line(value)
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]{2,}/g, ' ')
      .trim();
  }

  function uniqNodes(nodes) {
    const seen = new Set();
    const out = [];
    const list = arr(nodes);
    for (let i = 0; i < list.length; i += 1) {
      const node = list[i];
      if (!node || seen.has(node)) continue;
      seen.add(node);
      out.push(node);
    }
    return out;
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function safeCall(fn, context) {
    if (typeof fn !== 'function') return undefined;
    const args = Array.prototype.slice.call(arguments, 2);
    try {
      return fn.apply(context, args);
    } catch (error) {
      log.warn('safe_call_failed', error && error.message ? error.message : String(error));
      return undefined;
    }
  }

  function emit(name, detail) {
    try {
      if (typeof global.CustomEvent !== 'function' || typeof global.dispatchEvent !== 'function') {
        return false;
      }
      global.dispatchEvent(new global.CustomEvent(name, { detail: detail }));
      return true;
    } catch (error) {
      log.warn('emit_failed', error && error.message ? error.message : String(error));
      return false;
    }
  }

  function delay(ms) {
    return new Promise(function resolveDelay(resolve) {
      global.setTimeout(resolve, ms);
    });
  }

  function nextFrame() {
    return new Promise(function resolveFrame(resolve) {
      if (typeof global.requestAnimationFrame === 'function') {
        global.requestAnimationFrame(function onFrame() {
          resolve();
        });
        return;
      }
      global.setTimeout(resolve, 16);
    });
  }

  function hasElement(node) {
    return !!(node && node.nodeType === 1);
  }

  function queryFirst(selectors, root) {
    const scope = root || global.document;
    if (!scope) return null;
    if (typeof domUtils.queryFirst === 'function') {
      const result = safeCall(domUtils.queryFirst, domUtils, selectors, scope);
      if (result) return result;
    }
    const list = arr(selectors);
    for (let i = 0; i < list.length; i += 1) {
      const selector = list[i];
      if (!selector || typeof selector !== 'string') continue;
      try {
        const hit = scope.querySelector(selector);
        if (hit) return hit;
      } catch (error) {
        log.warn('query_first_invalid_selector', selector);
      }
    }
    return null;
  }

  function queryAll(selectors, root) {
    const scope = root || global.document;
    if (!scope) return [];
    if (typeof domUtils.queryAll === 'function') {
      const result = safeCall(domUtils.queryAll, domUtils, selectors, scope);
      if (Array.isArray(result) && result.length) return uniqNodes(result);
    }
    const out = [];
    const list = arr(selectors);
    for (let i = 0; i < list.length; i += 1) {
      const selector = list[i];
      if (!selector || typeof selector !== 'string') continue;
      try {
        const hits = scope.querySelectorAll(selector);
        for (let j = 0; j < hits.length; j += 1) out.push(hits[j]);
      } catch (error) {
        log.warn('query_all_invalid_selector', selector);
      }
    }
    return uniqNodes(out);
  }

  async function waitForElement(selectors, options) {
    const settings = obj(options) ? options : {};
    if (typeof domUtils.waitForElement === 'function') {
      const result = safeCall(domUtils.waitForElement, domUtils, selectors, settings);
      if (result && typeof result.then === 'function') {
        const awaited = await result;
        if (awaited) return awaited;
      } else if (result) {
        return result;
      }
    }
    const timeout = Number.isFinite(settings.timeout) ? settings.timeout : 15000;
    const interval = Number.isFinite(settings.interval) ? settings.interval : 120;
    const root = settings.root || global.document;
    const start = Date.now();
    let found = queryFirst(selectors, root);
    if (found) return found;
    while (Date.now() - start < timeout) {
      await delay(interval);
      found = queryFirst(selectors, root);
      if (found) return found;
    }
    return null;
  }

  function isVisible(node) {
    if (!hasElement(node)) return false;
    if (typeof domUtils.isVisible === 'function') {
      const result = safeCall(domUtils.isVisible, domUtils, node);
      if (typeof result === 'boolean') return result;
    }
    if (!node.isConnected) return false;
    const style = global.getComputedStyle ? global.getComputedStyle(node) : null;
    if (style) {
      if (style.display === 'none' || style.visibility === 'hidden') return false;
    }
    if (typeof node.getClientRects === 'function' && node.getClientRects().length === 0) return false;
    return true;
  }

  function textOf(node) {
    if (!hasElement(node)) return '';
    const raw = typeof node.innerText === 'string' && node.innerText ? node.innerText : str(node.textContent);
    return normalizeText(raw);
  }

  function fireEvent(node, type, init) {
    if (!hasElement(node)) return;
    let event;
    const cfg = Object.assign({ bubbles: true, cancelable: true }, init || {});
    try {
      if ((type === 'input' || type === 'beforeinput') && typeof global.InputEvent === 'function') {
        event = new global.InputEvent(type, cfg);
      } else if (
        (type === 'keydown' || type === 'keyup' || type === 'keypress') &&
        typeof global.KeyboardEvent === 'function'
      ) {
        event = new global.KeyboardEvent(type, cfg);
      } else {
        event = new global.Event(type, cfg);
      }
    } catch (error) {
      event = global.document.createEvent('Event');
      event.initEvent(type, true, true);
    }
    node.dispatchEvent(event);
  }

  function nativeValueSetter(element) {
    if (!hasElement(element)) return null;
    if (element.tagName === 'TEXTAREA' && global.HTMLTextAreaElement) {
      const descriptor = Object.getOwnPropertyDescriptor(global.HTMLTextAreaElement.prototype, 'value');
      return descriptor && typeof descriptor.set === 'function' ? descriptor.set : null;
    }
    if (element.tagName === 'INPUT' && global.HTMLInputElement) {
      const descriptor = Object.getOwnPropertyDescriptor(global.HTMLInputElement.prototype, 'value');
      return descriptor && typeof descriptor.set === 'function' ? descriptor.set : null;
    }
    return null;
  }

  function setPlainInputValue(element, value) {
    if (!hasElement(element)) return false;
    if (!('value' in element)) return false;
    const setter = nativeValueSetter(element);
    if (setter) setter.call(element, value);
    else element.value = value;
    fireEvent(element, 'input', { data: value, inputType: 'insertText' });
    fireEvent(element, 'change');
    fireEvent(element, 'keyup', { key: 'End', code: 'End' });
    return true;
  }

  function selectNodeContents(element) {
    if (!hasElement(element) || !global.document || !global.getSelection || !global.document.createRange) return false;
    try {
      const selection = global.getSelection();
      const range = global.document.createRange();
      range.selectNodeContents(element);
      selection.removeAllRanges();
      selection.addRange(range);
      return true;
    } catch (error) {
      return false;
    }
  }

  function setContentEditableValue(element, value) {
    if (!hasElement(element)) return false;
    const editable = element.getAttribute('contenteditable');
    if (editable === null || trim(editable).toLowerCase() === 'false') return false;
    const text = line(value);
    element.focus();
    selectNodeContents(element);
    fireEvent(element, 'beforeinput', {
      data: text,
      inputType: 'insertFromPaste'
    });
    let inserted = false;
    if (global.document && typeof global.document.execCommand === 'function') {
      try {
        inserted = global.document.execCommand('insertText', false, text);
      } catch (error) {
        inserted = false;
      }
    }
    if (!inserted) {
      while (element.firstChild) element.removeChild(element.firstChild);
      const lines = text.split('\n');
      for (let i = 0; i < lines.length; i += 1) {
        if (i > 0) element.appendChild(global.document.createElement('br'));
        element.appendChild(global.document.createTextNode(lines[i]));
      }
    }
    fireEvent(element, 'input', {
      data: text,
      inputType: 'insertText'
    });
    fireEvent(element, 'keyup', { key: 'End', code: 'End' });
    fireEvent(element, 'change');
    return true;
  }

  function topLevel(nodes) {
    const list = uniqNodes(nodes);
    if (list.length <= 1) return list;
    const set = new Set(list);
    return list.filter(function filterNode(node) {
      let cursor = node.parentElement;
      while (cursor) {
        if (set.has(cursor)) return false;
        cursor = cursor.parentElement;
      }
      return true;
    });
  }

  function isInsideComposer(node) {
    if (!hasElement(node)) return false;
    return !!node.closest('form, footer');
  }

  function extractDataAttributes(node) {
    if (!hasElement(node) || !node.attributes) return '';
    const out = [];
    for (let i = 0; i < node.attributes.length; i += 1) {
      const attr = node.attributes[i];
      if (!attr || typeof attr.name !== 'string') continue;
      if (attr.name.indexOf('data-') === 0 || attr.name === 'aria-label' || attr.name === 'role') {
        out.push(attr.name + '=' + attr.value);
      }
    }
    return out.join(' ');
  }

  function containsMessageSemantics(node) {
    if (!hasElement(node)) return false;
    const bag = [
      str(node.className),
      str(node.getAttribute && node.getAttribute('data-testid')),
      str(node.getAttribute && node.getAttribute('data-message-author-role')),
      str(node.getAttribute && node.getAttribute('data-author')),
      str(node.getAttribute && node.getAttribute('data-role')),
      extractDataAttributes(node)
    ]
      .join(' ')
      .toLowerCase();
    return /message|turn|assistant|user|human|claude|conversation/.test(bag);
  }

  function inferRole(node) {
    if (!hasElement(node)) return 'unknown';
    const bag = [
      str(node.className),
      str(node.getAttribute && node.getAttribute('data-testid')),
      str(node.getAttribute && node.getAttribute('data-message-author-role')),
      str(node.getAttribute && node.getAttribute('data-author')),
      str(node.getAttribute && node.getAttribute('data-role')),
      str(node.getAttribute && node.getAttribute('aria-label')),
      extractDataAttributes(node)
    ]
      .join(' ')
      .toLowerCase();

    if (/assistant|claude|model/.test(bag)) return 'assistant';
    if (/\buser\b|\bhuman\b|\byou\b/.test(bag)) return 'user';

    const labels = queryAll(
      [
        'h1',
        'h2',
        'h3',
        'h4',
        'strong',
        'b',
        '[aria-label]',
        '[data-testid]',
        '[class*="label"]',
        '[class*="author"]',
        '[class*="title"]'
      ],
      node
    )
      .slice(0, 12)
      .map(textOf)
      .join(' ')
      .toLowerCase();

    if (/assistant|claude|model/.test(labels)) return 'assistant';
    if (/\buser\b|\bhuman\b|\byou\b/.test(labels)) return 'user';

    return 'unknown';
  }

  function fillUnknownRoles(turns) {
    if (!Array.isArray(turns) || !turns.length) return turns;
    const hasKnown = turns.some(function hasKnownRole(turn) {
      return turn.role !== 'unknown';
    });
    if (!hasKnown) {
      for (let i = 0; i < turns.length; i += 1) {
        turns[i].role = i % 2 === 0 ? 'user' : 'assistant';
      }
      return turns;
    }
    for (let i = 0; i < turns.length; i += 1) {
      if (turns[i].role !== 'unknown') continue;
      const prev = i > 0 ? turns[i - 1] : null;
      const next =
        turns.slice(i + 1).find(function findNext(turn) {
          return turn.role !== 'unknown';
        }) || null;
      if (prev && prev.role !== 'unknown') {
        turns[i].role = prev.role === 'user' ? 'assistant' : 'user';
      } else if (next && next.role !== 'unknown') {
        turns[i].role = next.role === 'user' ? 'assistant' : 'user';
      } else {
        turns[i].role = i % 2 === 0 ? 'user' : 'assistant';
      }
    }
    return turns;
  }

  class ClaudeAdapter {
    constructor() {
      this.id = SITE_ID;
      this.siteId = SITE_ID;
      this.bridge = null;
      this.started = false;
      this.destroyed = false;
      this.composer = null;
      this.observer = null;
      this.urlTimer = null;
      this.lastKnownUrl = str(global.location && global.location.href);
      this.state = {
        initializedAt: null,
        lastReadyAt: null,
        lastMutationAt: null,
        lastUrlChangeAt: null,
        lastInputAt: null,
        lastReadAt: null,
        lastSubmitAt: null,
        lastError: null
      };
    }

    getAdapterId() {
      return this.id;
    }

    getId() {
      return this.id;
    }

    getSiteId() {
      return this.siteId;
    }

    isSupportedHost() {
      const host = trim(global.location && global.location.hostname).toLowerCase();
      return host === 'claude.ai' || host.endsWith('.claude.ai');
    }

    getTranscriptRoot() {
      const node = queryFirst(SELECTORS.transcriptRoot, global.document);
      return node || global.document.body || global.document.documentElement || null;
    }

    findComposer() {
      if (hasElement(this.composer) && this.composer.isConnected && isVisible(this.composer)) {
        return this.composer;
      }
      const candidates = queryAll(SELECTORS.composer, global.document).filter(isVisible);
      const chosen =
        candidates.find(function pick(node) {
          if (!hasElement(node)) return false;
          if (node.matches && node.matches('textarea, input')) return true;
          const role = trim(node.getAttribute && node.getAttribute('role')).toLowerCase();
          const editable = node.getAttribute && node.getAttribute('contenteditable');
          return role === 'textbox' || (editable !== null && trim(editable).toLowerCase() !== 'false');
        }) ||
        candidates[0] ||
        null;
      this.composer = chosen;
      return chosen;
    }

    async waitForComposer(timeout) {
      const found = this.findComposer();
      if (found) return found;
      this.composer = await waitForElement(SELECTORS.composer, {
        timeout: timeout || 15000,
        root: global.document
      });
      return this.composer;
    }

    findSubmitButton() {
      const composer = this.findComposer();
      if (composer) {
        const form = composer.closest('form');
        if (form) {
          const withinForm = queryFirst(SELECTORS.submitButton, form);
          if (withinForm && isVisible(withinForm)) return withinForm;
        }
      }
      return queryAll(SELECTORS.submitButton, global.document).find(isVisible) || null;
    }

    findStopButton() {
      return queryAll(SELECTORS.stopButton, global.document).find(isVisible) || null;
    }

    isGenerating() {
      return !!this.findStopButton();
    }

    async focusComposer() {
      const composer = await this.waitForComposer(8000);
      if (!composer) return false;
      try {
        composer.scrollIntoView({ block: 'center', inline: 'nearest' });
      } catch (error) {}
      composer.focus();
      await nextFrame();
      return global.document.activeElement === composer || composer.contains(global.document.activeElement);
    }

    readComposerText() {
      const composer = this.findComposer();
      if (!composer) return '';
      if ('value' in composer) return str(composer.value);
      return textOf(composer);
    }

    async setComposerText(value) {
      const composer = await this.waitForComposer(12000);
      if (!composer) throw new Error('claude_composer_not_found');
      await this.focusComposer();
      const text = str(value);
      let ok = false;

      if (composer.matches && composer.matches('textarea, input')) {
        ok = setPlainInputValue(composer, text);
      } else {
        ok = setContentEditableValue(composer, text);
        if (!ok && 'value' in composer) ok = setPlainInputValue(composer, text);
      }

      if (!ok) throw new Error('claude_composer_write_failed');
      this.state.lastInputAt = nowIso();
      return { ok: true, value: text, length: text.length };
    }

    async setInputText(value) {
      return this.setComposerText(value);
    }

    async setPromptText(value) {
      return this.setComposerText(value);
    }

    async writeToInput(value) {
      return this.setComposerText(value);
    }

    async appendComposerText(value, separator) {
      const existing = this.readComposerText();
      const joiner = separator === undefined ? '\n\n' : str(separator);
      const next = existing ? existing + joiner + str(value) : str(value);
      return this.setComposerText(next);
    }

    async submit() {
      const button = this.findSubmitButton();
      if (!button) throw new Error('claude_submit_button_not_found');
      if (button.disabled) throw new Error('claude_submit_button_disabled');
      button.click();
      this.state.lastSubmitAt = nowIso();
      return { ok: true };
    }

    filterTurnNode(node, root) {
      if (!hasElement(node)) return false;
      if (!node.isConnected || !isVisible(node)) return false;
      if (node === root) return false;
      if (node.matches && node.matches('button, svg, path, form, textarea, input, nav, aside, footer, header')) {
        return false;
      }
      if (isInsideComposer(node)) return false;
      const text = textOf(node);
      if (!text) return false;
      if (text.length < 8) return false;
      if (!containsMessageSemantics(node) && text.length < 48) return false;
      if (
        node.querySelector &&
        node.querySelector('form textarea, form [contenteditable], footer textarea, footer [contenteditable]')
      ) {
        return false;
      }
      return true;
    }

    collectTurnNodes() {
      const root = this.getTranscriptRoot();
      if (!root) return [];

      const primary = topLevel(
        queryAll(
          [
            '[data-message-author-role]',
            '[data-testid*="conversation-turn"]',
            '[data-testid*="message"]',
            '[data-testid*="turn"]',
            '[data-author]',
            '[data-role]'
          ],
          root
        ).filter((node) => this.filterTurnNode(node, root))
      );

      if (primary.length >= 2) return primary;

      const secondary = topLevel(queryAll(SELECTORS.turnLike, root).filter((node) => this.filterTurnNode(node, root)));

      if (secondary.length >= 2) return secondary;

      const children = topLevel(
        Array.prototype.slice.call(root.children || []).filter((node) => this.filterTurnNode(node, root))
      );

      if (children.length) return children;

      const blocks = queryAll(['pre', 'code', 'p', 'div'], root)
        .filter(isVisible)
        .filter(function filterFallback(node) {
          if (!hasElement(node) || node === root) return false;
          if (isInsideComposer(node)) return false;
          const text = textOf(node);
          return text.length >= 120;
        });

      return topLevel(blocks);
    }

    collectConversationTurns() {
      const nodes = this.collectTurnNodes();
      const turns = [];
      for (let i = 0; i < nodes.length; i += 1) {
        const node = nodes[i];
        const text = textOf(node);
        if (!text) continue;
        turns.push({
          index: i,
          role: inferRole(node),
          text: text,
          element: node
        });
      }

      fillUnknownRoles(turns);

      if (turns.length) return turns;

      const root = this.getTranscriptRoot();
      const fallbackText = root ? textOf(root) : '';
      if (!fallbackText) return [];
      return [
        {
          index: 0,
          role: 'unknown',
          text: fallbackText,
          element: root
        }
      ];
    }

    getLatestAssistantText() {
      const turns = this.collectConversationTurns();
      const assistants = turns.filter(function filterAssistant(turn) {
        return turn.role === 'assistant' && trim(turn.text).length > 0;
      });
      const latest = assistants.length ? assistants[assistants.length - 1] : turns.length ? turns[turns.length - 1] : null;
      const text = latest ? latest.text : '';
      this.state.lastReadAt = nowIso();
      return text;
    }

    getLatestResponseText() {
      return this.getLatestAssistantText();
    }

    readLatestResponseText() {
      return this.getLatestAssistantText();
    }

    getVisibleTranscriptText() {
      const turns = this.collectConversationTurns();
      if (!turns.length) return '';
      this.state.lastReadAt = nowIso();
      return turns
        .map(function mapTurn(turn) {
          return '[[' + turn.role.toUpperCase() + ']]\n' + turn.text;
        })
        .join('\n\n');
    }

    getTranscriptText() {
      return this.getVisibleTranscriptText();
    }

    getPageMetadata() {
      return {
        siteId: this.siteId,
        url: str(global.location && global.location.href),
        title: str(global.document && global.document.title),
        isGenerating: this.isGenerating(),
        composerReady: !!this.findComposer()
      };
    }

    getStatus() {
      return {
        adapterId: this.id,
        siteId: this.siteId,
        started: this.started,
        destroyed: this.destroyed,
        lastKnownUrl: this.lastKnownUrl,
        state: Object.assign({}, this.state),
        metadata: this.getPageMetadata(),
        bridge: this.bridge && typeof this.bridge.status === 'function' ? this.bridge.status() : null
      };
    }

    async attachBridge() {
      if (this.bridge) return this.bridge;
      if (!createBridge) {
        log.warn('human_hub_bridge_factory_unavailable');
        return null;
      }
      const bridge = createBridge(this, {
        transportFormat: 'json',
        autoNotifyReady: true,
        autoPersistPacket: true,
        autoSubmitCapture: true,
        allowBodyFallbackRead: true
      });
      if (bridge && typeof bridge.initialize === 'function') {
        await bridge.initialize();
      }
      this.bridge = bridge || null;
      return this.bridge;
    }

    installDomObserver() {
      if (this.observer || typeof global.MutationObserver !== 'function' || !global.document || !global.document.documentElement) {
        return;
      }
      this.observer = new global.MutationObserver(() => {
        this.state.lastMutationAt = nowIso();
        if (!this.composer || !this.composer.isConnected) {
          this.composer = this.findComposer();
        }
        if (str(global.location && global.location.href) !== this.lastKnownUrl) {
          this.handleUrlChange(str(global.location && global.location.href));
        }
      });
      this.observer.observe(global.document.documentElement, {
        subtree: true,
        childList: true,
        characterData: false,
        attributes: false
      });
    }

    installUrlWatcher() {
      if (this.urlTimer) return;
      this.urlTimer = global.setInterval(() => {
        const current = str(global.location && global.location.href);
        if (current !== this.lastKnownUrl) {
          this.handleUrlChange(current);
        }
      }, 1000);
    }

    handleUrlChange(nextUrl) {
      this.lastKnownUrl = nextUrl;
      this.state.lastUrlChangeAt = nowIso();
      this.composer = null;
      if (this.bridge && typeof this.bridge.getRuntimeContext === 'function') {
        safeCall(this.bridge.getRuntimeContext, this.bridge, true);
      }
      emit(STATUS_EVENT, this.getStatus());
    }

    register() {
      MAOE.content.adapters.claude = this;
      MAOE.content.currentAdapter = this;

      const common = MAOE.content.common || {};
      if (typeof common.registerAdapter === 'function') {
        safeCall(common.registerAdapter, common, this);
      }
      if (common.baseAdapter && typeof common.baseAdapter.registerAdapter === 'function') {
        safeCall(common.baseAdapter.registerAdapter, common.baseAdapter, this);
      }
      if (typeof MAOE.registerAdapter === 'function') {
        safeCall(MAOE.registerAdapter, MAOE, this);
      }
    }

    async bootstrap() {
      if (this.started || this.destroyed) return this;
      if (!this.isSupportedHost()) {
        throw new Error('unsupported_host_for_claude_adapter');
      }

      await waitForElement(SELECTORS.transcriptRoot, { timeout: 15000, root: global.document });
      await this.waitForComposer(15000).catch(function ignoreComposerFailure() {
        return null;
      });

      this.register();
      await this.attachBridge();

      this.installDomObserver();
      this.installUrlWatcher();

      this.started = true;
      this.state.initializedAt = nowIso();
      this.state.lastReadyAt = nowIso();

      if (global.document && global.document.documentElement) {
        global.document.documentElement.setAttribute('data-maoe-claude-ready', 'true');
      }

      emit(READY_EVENT, this.getStatus());
      emit(STATUS_EVENT, this.getStatus());
      log.info('claude_adapter_ready', this.getStatus());

      return this;
    }

    destroy() {
      this.destroyed = true;
      this.started = false;
      if (this.observer) {
        this.observer.disconnect();
        this.observer = null;
      }
      if (this.urlTimer) {
        global.clearInterval(this.urlTimer);
        this.urlTimer = null;
      }
      if (this.bridge && typeof this.bridge.destroy === 'function') {
        safeCall(this.bridge.destroy, this.bridge);
      }
      this.bridge = null;
      this.composer = null;
    }
  }

  const adapter = new ClaudeAdapter();

  function exposeFacade(instance) {
    instance.__moduleLoaded = true;
    instance.commands = {
      status: function status() {
        return instance.getStatus();
      },
      metadata: function metadata() {
        return instance.getPageMetadata();
      },
      transcript: function transcript() {
        return instance.getVisibleTranscriptText();
      },
      latest: function latest() {
        return instance.getLatestAssistantText();
      },
      focus: function focus() {
        return instance.focusComposer();
      },
      write: function write(text) {
        return instance.setComposerText(text);
      },
      append: function append(text, separator) {
        return instance.appendComposerText(text, separator);
      },
      submit: function submit() {
        return instance.submit();
      },
      bridge: function bridge() {
        return instance.bridge;
      }
    };
    return instance;
  }

  function registerMessageBridge(instance) {
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
          const status = typeof instance.getStatus === 'function' ? instance.getStatus() : {};
          const composer = typeof instance.findComposer === 'function' ? instance.findComposer() : null;
          const submitButton = typeof instance.findSubmitButton === 'function' ? instance.findSubmitButton() : null;
          return {
            ok: true,
            siteInfo: {
              siteId: SITE_ID,
              providerId: SITE_ID,
              displayName: 'Claude',
              url: global.location && global.location.href ? global.location.href : '',
              host: global.location && global.location.hostname ? global.location.hostname : ''
            },
            ready: !!instance.started,
            promptElementFound: !!composer,
            submitElementFound: !!submitButton,
            status: status
          };
        },
        fillPrompt: async function onFillPrompt(payload) {
          const text = payload && typeof payload.prompt === 'string' ? payload.prompt : '';
          const result = await instance.setComposerText(text);
          let submitted = false;
          const autoSubmit = !!(payload && payload.options && payload.options.autoSubmit);
          if (autoSubmit) {
            try {
              await instance.submit();
              submitted = true;
            } catch (error) {
              submitted = false;
            }
          }
          return {
            ok: !!(result && result.ok !== false),
            length: result && typeof result.length === 'number' ? result.length : text.length,
            submitted: submitted,
            providerId: SITE_ID
          };
        },
        extractLatestResponse: async function onExtract() {
          const rawText = typeof instance.getLatestAssistantText === 'function'
            ? instance.getLatestAssistantText()
            : '';
          const text = typeof rawText === 'string' ? rawText : '';
          return {
            ok: text.length > 0,
            rawText: text,
            length: text.length,
            providerId: SITE_ID
          };
        }
      }, {
        providerId: SITE_ID,
        siteId: SITE_ID,
        displayName: 'Claude'
      });
    } catch (error) {
      log.warn('claude_message_bridge_register_failed', error && error.message ? error.message : String(error));
    }
  }

  async function start() {
    try {
      exposeFacade(adapter);
      registerMessageBridge(adapter);
      await adapter.bootstrap();
    } catch (error) {
      adapter.state.lastError = error && error.message ? error.message : String(error);
      emit(ERROR_EVENT, {
        adapterId: adapter.getAdapterId(),
        error: adapter.state.lastError
      });
      log.error('claude_adapter_bootstrap_failed', adapter.state.lastError);
    }
  }

  if (global.document && global.document.readyState === 'loading') {
    global.document.addEventListener(
      'DOMContentLoaded',
      function onDomReady() {
        start();
      },
      { once: true }
    );
  } else {
    start();
  }
})(globalThis);