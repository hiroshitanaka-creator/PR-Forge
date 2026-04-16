(() => {
  "use strict";
  const root = globalThis;
  const MAOE = (root.MAOE = root.MAOE || {});
  MAOE.Content = MAOE.Content || {};
  const Constants = MAOE.Constants || {};
  const LoggerFactory = MAOE.Logger || {};
  const Protocol = MAOE.Protocol || {};
  const Parsers = MAOE.Parsers || {};
  const ContentCommon = MAOE.Content || {};
  const createLogger =
    typeof LoggerFactory.create === "function"
      ? LoggerFactory.create
      : (scope) => {
          const prefix = `[${scope}]`;
          return {
            debug: (...args) => console.debug(prefix, ...args),
            info: (...args) => console.info(prefix, ...args),
            warn: (...args) => console.warn(prefix, ...args),
            error: (...args) => console.error(prefix, ...args),
          };
        };
  const logger = createLogger("content/gemini");
  const AI_SITE = (Constants.AI_SITES && Constants.AI_SITES.GEMINI) || "gemini";
  const CONTENT_EVENT_NAMESPACE =
    (Constants.EVENTS && Constants.EVENTS.CONTENT) || "maoe:content";
  const MESSAGE_TYPES = Constants.MESSAGE_TYPES || {
    CONTENT_READY: "CONTENT_READY",
    CONTENT_STATUS: "CONTENT_STATUS",
    CONTENT_PACKET_CREATED: "CONTENT_PACKET_CREATED",
    HUMAN_HUB_PACKET_REQUEST: "HUMAN_HUB_PACKET_REQUEST",
    HUMAN_HUB_PACKET_RESPONSE: "HUMAN_HUB_PACKET_RESPONSE",
    AI_INJECT_PROMPT: "AI_INJECT_PROMPT",
    AI_SUBMIT_PROMPT: "AI_SUBMIT_PROMPT",
    AI_EXTRACT_OUTPUT: "AI_EXTRACT_OUTPUT",
    AI_PING: "AI_PING",
  };
  const AdapterBase =
    typeof ContentCommon.BaseAdapter === "function"
      ? ContentCommon.BaseAdapter
      : class {
          constructor(config) {
            this.config = config || {};
            this.site = this.config.site || "unknown";
            this.logger = this.config.logger || logger;
            this.state = {
              ready: false,
              lastError: null,
              lastObservedOutput: "",
              lastObservedAt: null,
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
          emitStatus(extra = {}) {
            this.dispatchWindowEvent("maoe:adapter-status", {
              site: this.site,
              ready: this.state.ready,
              lastError: this.state.lastError,
              ...extra,
            });
          }
          dispatchWindowEvent(name, detail) {
            try {
              root.dispatchEvent(new CustomEvent(name, { detail }));
            } catch (error) {
              this.logger.warn("failed to dispatch window event", error);
            }
          }
        };
  const DomUtils = ContentCommon.DomUtils || {
    isVisible(element) {
      if (!element || !(element instanceof HTMLElement)) {
        return false;
      }
      const style = root.getComputedStyle(element);
      if (!style) {
        return true;
      }
      if (style.display === "none" || style.visibility === "hidden") {
        return false;
      }
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    },
    queryVisible(selectors, scope = document) {
      if (!Array.isArray(selectors)) {
        return null;
      }
      for (const selector of selectors) {
        const elements = Array.from(scope.querySelectorAll(selector));
        const hit = elements.find((element) => this.isVisible(element));
        if (hit) {
          return hit;
        }
      }
      return null;
    },
    queryAllVisible(selectors, scope = document) {
      if (!Array.isArray(selectors)) {
        return [];
      }
      const result = [];
      for (const selector of selectors) {
        for (const element of Array.from(scope.querySelectorAll(selector))) {
          if (this.isVisible(element)) {
            result.push(element);
          }
        }
      }
      return result;
    },
    setNativeValue(element, value) {
      const prototype = Object.getPrototypeOf(element);
      const descriptor = prototype
        ? Object.getOwnPropertyDescriptor(prototype, "value")
        : null;
      if (descriptor && typeof descriptor.set === "function") {
        descriptor.set.call(element, value);
      } else {
        element.value = value;
      }
    },
    triggerTextInputEvents(element) {
      const inputEvent = new InputEvent("input", {
        bubbles: true,
        cancelable: true,
        composed: true,
        inputType: "insertText",
        data: "",
      });
      element.dispatchEvent(inputEvent);
      const changeEvent = new Event("change", {
        bubbles: true,
        cancelable: true,
        composed: true,
      });
      element.dispatchEvent(changeEvent);
    },
    wait(ms) {
      return new Promise((resolve) => root.setTimeout(resolve, ms));
    },
  };
  const HumanHubBridge =
    typeof ContentCommon.HumanHubBridge === "function"
      ? ContentCommon.HumanHubBridge
      : class {
          constructor({ site, logger: bridgeLogger }) {
            this.site = site;
            this.logger = bridgeLogger || logger;
          }
          createPromptTransferPacket(payload) {
            return {
              protocol: "MAOE/HUMAN_HUB_PACKET@1",
              site: this.site,
              createdAt: new Date().toISOString(),
              kind: "PROMPT_TRANSFER",
              payload,
            };
          }
          createResponseTransferPacket(payload) {
            return {
              protocol: "MAOE/HUMAN_HUB_PACKET@1",
              site: this.site,
              createdAt: new Date().toISOString(),
              kind: "RESPONSE_TRANSFER",
              payload,
            };
          }
          serialize(packet) {
            return JSON.stringify(packet, null, 2);
          }
        };
  const fencedParser =
    typeof Parsers.extractFencedBlocks === "function"
      ? Parsers.extractFencedBlocks.bind(Parsers)
      : (text) => {
          const blocks = [];
          if (typeof text !== "string" || text.length === 0) {
            return blocks;
          }
          const regex = /([a-zA-Z0-9_-]+)?\n([\s\S]*?)/g;
          let match;
          while ((match = regex.exec(text)) !== null) {
            blocks.push({
              language: (match[1] || "").trim().toLowerCase(),
              content: match[2],
            });
          }
          return blocks;
        };
  const aiPayloadParser =
    typeof Parsers.parseAIResponsePayload === "function"
      ? Parsers.parseAIResponsePayload.bind(Parsers)
      : (text) => {
          const blocks = fencedParser(text);
          const xmlBlocks = blocks.filter((block) => block.language === "xml");
          return {
            ok: xmlBlocks.length > 0,
            blocks,
            xmlBlocks,
            primaryXml: xmlBlocks[0] || null,
            errors: xmlBlocks.length > 0 ? [] : ["xml fenced block not found"],
          };
        };
  function normalizeText(value) {
    return typeof value === "string" ? value.replace(/\r\n/g, "\n").trim() : "";
  }
  function ensureObject(value) {
    return value && typeof value === "object" && !Array.isArray(value)
      ? value
      : {};
  }
  function safeStringify(value) {
    try {
      return JSON.stringify(value, null, 2);
    } catch (_error) {
      return String(value);
    }
  }
  function createRuntimeMessenger(site) {
    async function send(message) {
      if (
        !root.chrome ||
        !chrome.runtime ||
        typeof chrome.runtime.sendMessage !== "function"
      ) {
        return { ok: false, error: "chrome.runtime.sendMessage unavailable" };
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
              return;
            }
            resolve(response ?? { ok: true });
          });
        } catch (error) {
          resolve({
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      });
    }
    return { send };
  }
  class GeminiAdapter extends AdapterBase {
    constructor() {
      super({
        site: AI_SITE,
        logger,
      });
      this.bridge = new HumanHubBridge({ site: AI_SITE, logger });
      this.messenger = createRuntimeMessenger(AI_SITE);
      this.selectors = {
        promptInput: [
          'div.ql-editor[contenteditable="true"]',
          'rich-textarea div[contenteditable="true"]',
          'div.textarea[contenteditable="true"]',
          'div[contenteditable="true"][role="textbox"]',
          "textarea",
        ],
        submitButton: [
          'button[aria-label*="Send"]',
          'button[aria-label*="送信"]',
          "button.send-button",
          'button[data-test-id*="send"]',
          'button[mattooltip*="Send"]',
        ],
        assistantTurn: [
          "model-response",
          "[data-response-id]",
          "message-content",
          "div.response-container",
          "div.markdown",
          "article",
        ],
        markdownContent: [
          "div.markdown",
          "message-content",
          ".model-response-text",
          "pre",
          "code",
        ],
        stopButton: [
          'button[aria-label*="Stop"]',
          'button[aria-label*="停止"]',
        ],
      };
      this.boundHandleRuntimeMessage = this.handleRuntimeMessage.bind(this);
      this.boundHandleWindowPacketRequest =
        this.handleWindowPacketRequest.bind(this);
      this.boundHandleDocumentVisibility =
        this.handleDocumentVisibility.bind(this);
      this.domObserver = null;
      this.lastPacketHash = null;
      this.lastOutputHash = null;
      this.bootTimestamp = new Date().toISOString();
    }
    async init() {
      if (this.state.ready) {
        return true;
      }
      this.installRuntimeListener();
      this.installWindowListeners();
      this.installDOMObserver();
      this.state.ready = true;
      this.state.lastError = null;
      this.emitStatus({
        phase: "initialized",
        site: this.site,
        url: root.location.href,
        bootTimestamp: this.bootTimestamp,
      });
      await this.notifyBackgroundReady();
      logger.info("adapter initialized", {
        site: this.site,
        url: root.location.href,
      });
      return true;
    }
    async destroy() {
      if (!this.state.ready) {
        return true;
      }
      this.removeRuntimeListener();
      this.removeWindowListeners();
      if (this.domObserver) {
        this.domObserver.disconnect();
        this.domObserver = null;
      }
      this.state.ready = false;
      this.emitStatus({ phase: "destroyed", site: this.site });
      return true;
    }
    installRuntimeListener() {
      if (root.chrome && chrome.runtime && chrome.runtime.onMessage) {
        chrome.runtime.onMessage.addListener(this.boundHandleRuntimeMessage);
      }
    }
    removeRuntimeListener() {
      if (root.chrome && chrome.runtime && chrome.runtime.onMessage) {
        chrome.runtime.onMessage.removeListener(this.boundHandleRuntimeMessage);
      }
    }
    installWindowListeners() {
      root.addEventListener(
        `${CONTENT_EVENT_NAMESPACE}:packet-request`,
        this.boundHandleWindowPacketRequest,
      );
      document.addEventListener(
        "visibilitychange",
        this.boundHandleDocumentVisibility,
      );
    }
    removeWindowListeners() {
      root.removeEventListener(
        `${CONTENT_EVENT_NAMESPACE}:packet-request`,
        this.boundHandleWindowPacketRequest,
      );
      document.removeEventListener(
        "visibilitychange",
        this.boundHandleDocumentVisibility,
      );
    }
    installDOMObserver() {
      this.domObserver = new MutationObserver(() => {
        const output = this.extractLatestOutputText();
        if (!output) {
          return;
        }
        const hash = this.computeHash(output);
        if (hash === this.lastOutputHash) {
          return;
        }
        this.lastOutputHash = hash;
        this.state.lastObservedOutput = output;
        this.state.lastObservedAt = new Date().toISOString();
        this.emitStatus({
          phase: "output-observed",
          site: this.site,
          hasXml: this.hasXmlFence(output),
          observedAt: this.state.lastObservedAt,
        });
      });
      this.domObserver.observe(document.documentElement || document.body, {
        subtree: true,
        childList: true,
        characterData: true,
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
          capabilities: this.describeCapabilities(),
        },
      });
      if (!response || response.ok === false) {
        logger.warn("failed to notify background readiness", response);
      }
    }
    describeCapabilities() {
      return {
        canInjectPrompt: true,
        canSubmitPrompt: true,
        canExtractOutput: true,
        canBuildHumanHubPacket: true,
        requiresHumanConfirmationForSensitiveActions: true,
        supportsXmlExtraction: true,
        supportsJsonExtraction: true,
        supportsDiffExtraction: true,
      };
    }
    handleDocumentVisibility() {
      this.emitStatus({
        phase: document.hidden ? "hidden" : "visible",
        site: this.site,
        title: document.title,
      });
    }
    async handleRuntimeMessage(message, _sender, sendResponse) {
      if (!message || typeof message !== "object") {
        return false;
      }
      const requestedSite = message.site || message.targetSite || null;
      if (requestedSite && requestedSite !== this.site) {
        return false;
      }
      const type = message.type || message.command;
      if (!type) {
        sendResponse({ ok: false, error: "message type missing" });
        return false;
      }
      (async () => {
        try {
          switch (type) {
            case MESSAGE_TYPES.AI_PING: {
              sendResponse({
                ok: true,
                site: this.site,
                ready: this.state.ready,
                capabilities: this.describeCapabilities(),
              });
              break;
            }
            case MESSAGE_TYPES.AI_INJECT_PROMPT: {
              const payload = ensureObject(message.payload);
              const text = normalizeText(payload.text || payload.prompt || "");
              const options = ensureObject(payload.options);
              const result = await this.injectPrompt(text, options);
              sendResponse(result);
              break;
            }
            case MESSAGE_TYPES.AI_SUBMIT_PROMPT: {
              const result = await this.submitPrompt(
                ensureObject(message.payload),
              );
              sendResponse(result);
              break;
            }
            case MESSAGE_TYPES.AI_EXTRACT_OUTPUT: {
              const result = await this.extractOutput(
                ensureObject(message.payload),
              );
              sendResponse(result);
              break;
            }
            case MESSAGE_TYPES.HUMAN_HUB_PACKET_REQUEST: {
              const result = await this.createHumanHubPacket(
                ensureObject(message.payload),
              );
              sendResponse(result);
              break;
            }
            default: {
              sendResponse({
                ok: false,
                error: `unsupported message type: ${String(type)}`,
              });
            }
          }
        } catch (error) {
          const messageText =
            error instanceof Error ? error.message : String(error);
          this.state.lastError = messageText;
          logger.error("runtime message handling failed", error);
          sendResponse({ ok: false, error: messageText });
        }
      })();
      return true;
    }
    async handleWindowPacketRequest(event) {
      const detail = ensureObject(event && event.detail);
      const payload = ensureObject(detail.payload);
      try {
        const result = await this.createHumanHubPacket(payload);
        this.dispatchWindowEvent(`${CONTENT_EVENT_NAMESPACE}:packet-response`, {
          ok: true,
          site: this.site,
          requestId: detail.requestId || null,
          result,
        });
      } catch (error) {
        const messageText =
          error instanceof Error ? error.message : String(error);
        this.dispatchWindowEvent(`${CONTENT_EVENT_NAMESPACE}:packet-response`, {
          ok: false,
          site: this.site,
          requestId: detail.requestId || null,
          error: messageText,
        });
      }
    }
    async injectPrompt(text, options = {}) {
      const normalized = normalizeText(text);
      if (!normalized) {
        return { ok: false, error: "prompt text is empty" };
      }
      const input = await this.findPromptInput();
      if (!input) {
        return { ok: false, error: "prompt input not found" };
      }
      await this.focusInput(input);
      await this.replaceInputText(input, normalized);
      await this.afterPromptInjected(input, normalized, options);
      this.emitStatus({
        phase: "prompt-injected",
        site: this.site,
        length: normalized.length,
      });
      return {
        ok: true,
        site: this.site,
        injected: true,
        submitted: false,
        length: normalized.length,
      };
    }
    async submitPrompt(options = {}) {
      const submitButton = this.findSubmitButton();
      if (submitButton && !submitButton.disabled) {
        submitButton.click();
        this.emitStatus({
          phase: "prompt-submitted",
          site: this.site,
          method: "button-click",
        });
        return {
          ok: true,
          site: this.site,
          submitted: true,
          method: "button-click",
        };
      }
      const input = await this.findPromptInput();
      if (!input) {
        return {
          ok: false,
          error: "submit button and prompt input unavailable",
        };
      }
      const enterEvent = new KeyboardEvent("keydown", {
        key: "Enter",
        code: "Enter",
        which: 13,
        keyCode: 13,
        bubbles: true,
        cancelable: true,
      });
      const keypressEvent = new KeyboardEvent("keypress", {
        key: "Enter",
        code: "Enter",
        which: 13,
        keyCode: 13,
        bubbles: true,
        cancelable: true,
      });
      const keyupEvent = new KeyboardEvent("keyup", {
        key: "Enter",
        code: "Enter",
        which: 13,
        keyCode: 13,
        bubbles: true,
        cancelable: true,
      });
      input.dispatchEvent(enterEvent);
      input.dispatchEvent(keypressEvent);
      input.dispatchEvent(keyupEvent);
      this.emitStatus({
        phase: "prompt-submitted",
        site: this.site,
        method: "keyboard-enter",
      });
      return {
        ok: true,
        site: this.site,
        submitted: true,
        method: "keyboard-enter",
      };
    }
    async extractOutput(options = {}) {
      const mode =
        typeof options.mode === "string"
          ? options.mode.toLowerCase()
          : "latest";
      const rawText = this.extractLatestOutputText();
      if (!rawText) {
        return { ok: false, error: "assistant output not found" };
      }
      const parsed = aiPayloadParser(rawText);
      const fencedBlocks = fencedParser(rawText);
      const result = {
        ok: true,
        site: this.site,
        mode,
        rawText,
        fencedBlocks,
        parsed,
        meta: {
          extractedAt: new Date().toISOString(),
          hasXmlFence: this.hasXmlFence(rawText),
          outputLength: rawText.length,
        },
      };
      this.state.lastObservedOutput = rawText;
      this.state.lastObservedAt = result.meta.extractedAt;
      this.emitStatus({
        phase: "output-extracted",
        site: this.site,
        hasXml: result.meta.hasXmlFence,
        extractedAt: result.meta.extractedAt,
      });
      return result;
    }
    async createHumanHubPacket(payload = {}) {
      const kind =
        typeof payload.kind === "string"
          ? payload.kind.toUpperCase()
          : "RESPONSE_TRANSFER";
      if (kind === "PROMPT_TRANSFER") {
        const prompt = normalizeText(payload.prompt || payload.text || "");
        if (!prompt) {
          return { ok: false, error: "prompt packet requires prompt text" };
        }
        const packet = this.bridge.createPromptTransferPacket({
          site: this.site,
          targetModel: payload.targetModel || "gemini",
          prompt,
          metadata: ensureObject(payload.metadata),
          createdAt: new Date().toISOString(),
        });
        return this.finalizePacket(packet);
      }
      const extracted = await this.extractOutput(payload);
      if (!extracted.ok) {
        return extracted;
      }
      const packet = this.bridge.createResponseTransferPacket({
        site: this.site,
        sourceUrl: root.location.href,
        title: document.title,
        rawText: extracted.rawText,
        fencedBlocks: extracted.fencedBlocks,
        parsed: extracted.parsed,
        metadata: ensureObject(payload.metadata),
        createdAt: new Date().toISOString(),
      });
      return this.finalizePacket(packet);
    }
    finalizePacket(packet) {
      const serialized =
        typeof this.bridge.serialize === "function"
          ? this.bridge.serialize(packet)
          : safeStringify(packet);
      const packetHash = this.computeHash(serialized);
      this.lastPacketHash = packetHash;
      this.emitStatus({ phase: "packet-created", site: this.site, packetHash });
      void this.messenger.send({
        type: MESSAGE_TYPES.CONTENT_PACKET_CREATED,
        payload: { site: this.site, packet, packetHash },
      });
      return { ok: true, site: this.site, packet, packetHash, serialized };
    }
    async findPromptInput() {
      for (let attempt = 0; attempt < 10; attempt += 1) {
        const input = DomUtils.queryVisible(this.selectors.promptInput);
        if (input) {
          return input;
        }
        await DomUtils.wait(250);
      }
      return null;
    }
    findSubmitButton() {
      return DomUtils.queryVisible(this.selectors.submitButton);
    }
    async focusInput(input) {
      try {
        input.focus();
        if (typeof input.scrollIntoView === "function") {
          input.scrollIntoView({
            behavior: "instant",
            block: "center",
            inline: "nearest",
          });
        }
      } catch (error) {
        logger.warn("failed to focus input", error);
      }
      await DomUtils.wait(30);
    }
    async replaceInputText(input, text) {
      const tagName = input.tagName.toLowerCase();
      if (tagName === "textarea" || tagName === "input") {
        DomUtils.setNativeValue(input, text);
        DomUtils.triggerTextInputEvents(input);
        return;
      }
      if (input.isContentEditable) {
        this.clearContentEditable(input);
        this.insertTextIntoContentEditable(input, text);
        return;
      }
      throw new Error("unsupported prompt input element");
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
        document.execCommand("delete", false);
      } catch (_error) {
        element.textContent = "";
      }
      if (selection) {
        selection.removeAllRanges();
      }
    }
    insertTextIntoContentEditable(element, text) {
      element.focus();
      const normalizedLines = text.split("\n");
      element.innerHTML = "";
      for (let index = 0; index < normalizedLines.length; index += 1) {
        if (index > 0) {
          element.appendChild(document.createElement("br"));
        }
        element.appendChild(document.createTextNode(normalizedLines[index]));
      }
      const selection = root.getSelection ? root.getSelection() : null;
      if (selection) {
        selection.removeAllRanges();
        const range = document.createRange();
        range.selectNodeContents(element);
        range.collapse(false);
        selection.addRange(range);
      }
      element.dispatchEvent(
        new InputEvent("beforeinput", {
          bubbles: true,
          cancelable: true,
          composed: true,
          inputType: "insertText",
          data: text,
        }),
      );
      DomUtils.triggerTextInputEvents(element);
    }
    async afterPromptInjected(_input, _text, options = {}) {
      if (options.autoSubmit) {
        await DomUtils.wait(
          typeof options.autoSubmitDelayMs === "number"
            ? options.autoSubmitDelayMs
            : 100,
        );
        return await this.submitPrompt(options);
      }
      return { ok: true };
    }
    extractLatestOutputText() {
      const assistantNodes = this.collectAssistantResponseNodes();
      if (assistantNodes.length === 0) {
        return "";
      }
      const last = assistantNodes[assistantNodes.length - 1];
      const text = this.extractTextFromNode(last);
      return normalizeText(text);
    }
    collectAssistantResponseNodes() {
      const candidates = [];
      const directNodes = DomUtils.queryAllVisible(
        this.selectors.assistantTurn,
      );
      for (const node of directNodes) {
        if (this.looksLikeUserComposer(node)) {
          continue;
        }
        candidates.push(node);
      }
      if (candidates.length > 0) {
        return this.uniqueNodes(candidates);
      }
      const fallbackContainers = Array.from(
        document.querySelectorAll("main, body"),
      );
      for (const container of fallbackContainers) {
        const textualBlocks = Array.from(
          container.querySelectorAll("div, article, section, pre"),
        );
        for (const block of textualBlocks) {
          if (!DomUtils.isVisible(block)) {
            continue;
          }
          if (this.looksLikeUserComposer(block)) {
            continue;
          }
          const text = normalizeText(
            block.innerText || block.textContent || "",
          );
          if (text.length < 40) {
            continue;
          }
          if (
            this.hasXmlFence(text) ||
            this.hasJsonFence(text) ||
            this.hasDiffFence(text)
          ) {
            candidates.push(block);
          }
        }
      }
      return this.uniqueNodes(candidates);
    }
    looksLikeUserComposer(node) {
      if (!node || !(node instanceof Element)) {
        return false;
      }
      if (node.matches(this.selectors.promptInput.join(","))) {
        return true;
      }
      const ariaLabel = (node.getAttribute("aria-label") || "").toLowerCase();
      const dataTestId = (
        node.getAttribute("data-test-id") || ""
      ).toLowerCase();
      if (ariaLabel.includes("prompt") || ariaLabel.includes("message")) {
        return true;
      }
      if (dataTestId.includes("composer") || dataTestId.includes("input")) {
        return true;
      }
      const editable = node.getAttribute("contenteditable");
      if (editable === "true" && node.closest("form")) {
        return true;
      }
      return false;
    }
    uniqueNodes(nodes) {
      const seen = new Set();
      const result = [];
      for (const node of nodes) {
        if (!node || seen.has(node)) {
          continue;
        }
        seen.add(node);
        result.push(node);
      }
      return result;
    }
    extractTextFromNode(node) {
      if (!node) {
        return "";
      }
      const contentNodes = [];
      for (const selector of this.selectors.markdownContent) {
        contentNodes.push(...Array.from(node.querySelectorAll(selector)));
      }
      const visibleTextNodes = contentNodes.filter((child) =>
        DomUtils.isVisible(child),
      );
      if (visibleTextNodes.length > 0) {
        const combined = visibleTextNodes
          .map((child) =>
            normalizeText(child.innerText || child.textContent || ""),
          )
          .filter(Boolean)
          .join("\n\n");
        if (combined) {
          return combined;
        }
      }
      return normalizeText(node.innerText || node.textContent || "");
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
    computeHash(value) {
      const text = String(value);
      let hash = 0x811c9dc5;
      for (let index = 0; index < text.length; index += 1) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
      }
      return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, "0")}`;
    }
  }
  function registerAdapter(adapter) {
    MAOE.Content.adapters = MAOE.Content.adapters || {};
    MAOE.Content.adapters[AI_SITE] = adapter;
    MAOE.Content.getAdapter =
      MAOE.Content.getAdapter ||
      ((site) => MAOE.Content.adapters[site] || null);
  }
  async function bootstrap() {
    try {
      const adapter = new GeminiAdapter();
      registerAdapter(adapter);
      await adapter.init();
      root.__MAOE_GEMINI_ADAPTER__ = adapter;
      logger.info("bootstrap complete", {
        site: AI_SITE,
        href: root.location.href,
      });
    } catch (error) {
      const messageText =
        error instanceof Error ? error.message : String(error);
      logger.error("bootstrap failed", error);
      try {
        if (
          root.chrome &&
          chrome.runtime &&
          typeof chrome.runtime.sendMessage === "function"
        ) {
          chrome.runtime.sendMessage({
            type: MESSAGE_TYPES.CONTENT_STATUS,
            site: AI_SITE,
            payload: {
              site: AI_SITE,
              ready: false,
              error: messageText,
              url: root.location.href,
            },
          });
        }
      } catch (_notifyError) {}
    }
  }
  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      () => {
        void bootstrap();
      },
      { once: true },
    );
  } else {
    void bootstrap();
  }
})();
