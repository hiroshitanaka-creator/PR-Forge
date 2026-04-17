(function registerMAOEGitHubApi(globalScope) {
  "use strict";
  const root = globalScope.MAOE;

  if (!root || typeof root.registerValue !== "function") {
    throw new Error("[MAOE] namespace.js must be loaded before github_api.js.");
  }

  if (root.has("github_api")) {
    return;
  }

  if (!root.has("constants")) {
    throw new Error("[MAOE] constants.js must be loaded before github_api.js.");
  }

  if (!root.has("storage")) {
    throw new Error("[MAOE] storage.js must be loaded before github_api.js.");
  }

  if (!root.has("protocol")) {
    throw new Error("[MAOE] protocol.js must be loaded before github_api.js.");
  }

  const constants = root.require("constants");
  const storage = root.require("storage");
  const protocol = root.require("protocol");
  const util = root.util || Object.create(null);

  const cloneValue =
    typeof util.cloneValue === "function"
      ? util.cloneValue
      : function fallbackClone(value) {
          if (value === null || typeof value !== "object") {
            return value;
          }
          try {
            return JSON.parse(JSON.stringify(value));
          } catch (error) {
            return value;
          }
        };
  const deepFreeze =
    typeof util.deepFreeze === "function"
      ? util.deepFreeze
      : function passthrough(value) {
          return value;
        };

  const safeJsonParse =
    typeof util.safeJsonParse === "function"
      ? util.safeJsonParse
      : function fallbackSafeJsonParse(text, fallbackValue) {
          try {
            return JSON.parse(text);
          } catch (error) {
            return arguments.length >= 2 ? fallbackValue : null;
          }
        };

  const hasOwn =
    typeof util.hasOwn === "function"
      ? util.hasOwn
      : function fallbackHasOwn(target, key) {
          return Object.prototype.hasOwnProperty.call(target, key);
        };

  function createFallbackLogger() {
    const consoleObject = typeof console !== "undefined" ? console : null;
    function emit(level, message, context) {
      if (!consoleObject || typeof consoleObject[level] !== "function") {
        return;
      }

      if (typeof context === "undefined") {
        consoleObject[level]("[MAOE/github_api] " + message);
        return;
      }

      consoleObject[level]("[MAOE/github_api] " + message, context);
    }

    return {
      debug: function debug(message, context) {
        emit("debug", message, context);
      },
      info: function info(message, context) {
        emit("info", message, context);
      },
      warn: function warn(message, context) {
        emit("warn", message, context);
      },
      error: function error(message, context) {
        emit("error", message, context);
      },
    };
  }

  function createScopedLogger() {
    if (!root.has("logger")) {
      return createFallbackLogger();
    }
    const loggerModule = root.require("logger");

    if (loggerModule && typeof loggerModule.createScope === "function") {
      try {
        return loggerModule.createScope("github_api");
      } catch (error) {}
    }

    if (
      loggerModule &&
      typeof loggerModule.debug === "function" &&
      typeof loggerModule.info === "function" &&
      typeof loggerModule.warn === "function" &&
      typeof loggerModule.error === "function"
    ) {
      return loggerModule;
    }

    return createFallbackLogger();
  }

  const logger = createScopedLogger();

  const APP = constants.APP || Object.create(null);
  const GITHUB = constants.GITHUB || Object.create(null);
  const REPOSITORY = constants.REPOSITORY || Object.create(null);
  const ERROR_CODES = constants.ERROR_CODES || Object.create(null);
  const HOSTS = constants.HOSTS || Object.create(null);
  const STORAGE_KEYS = constants.STORAGE_KEYS || Object.create(null);
  const CONSTANT_HELPERS = constants.helpers || Object.create(null);
  const protocolHelpers = protocol.helpers || Object.create(null);

  const DEFAULT_BASE_URL = normalizeBaseUrl(
    GITHUB.API_BASE_URL ||
      HOSTS.GITHUB_API_BASE_URL ||
      "https://api.github.com",
  );
  const DEFAULT_TIMEOUT_MS = Number.isFinite(Number(GITHUB.REQUEST_TIMEOUT_MS))
    ? Math.max(1000, Math.trunc(Number(GITHUB.REQUEST_TIMEOUT_MS)))
    : 20000;
  const DEFAULT_ACCEPT_HEADER =
    normalizeString(GITHUB.ACCEPT_HEADER) || "application/vnd.github+json";
  const DEFAULT_API_VERSION =
    normalizeString(GITHUB.API_VERSION) || "2022-11-28";
  const DEFAULT_BASE_BRANCH =
    normalizeString(REPOSITORY.DEFAULT_BASE_BRANCH) || "main";
  const DEFAULT_ISSUE_STATE =
    normalizeString(REPOSITORY.DEFAULT_ISSUE_STATE) || "open";
  const DEFAULT_ISSUE_SORT =
    normalizeString(REPOSITORY.DEFAULT_ISSUE_SORT) || "updated";
  const DEFAULT_ISSUE_DIRECTION =
    normalizeString(REPOSITORY.DEFAULT_ISSUE_DIRECTION) || "desc";
  const DEFAULT_ISSUES_PER_PAGE = Number.isFinite(
    Number(GITHUB.PAGINATION && GITHUB.PAGINATION.DEFAULT_PER_PAGE),
  )
    ? Math.max(
        1,
        Math.min(100, Math.trunc(Number(GITHUB.PAGINATION.DEFAULT_PER_PAGE))),
      )
    : 50;
  const MAX_PER_PAGE = Number.isFinite(
    Number(GITHUB.PAGINATION && GITHUB.PAGINATION.MAX_PER_PAGE),
  )
    ? Math.max(
        1,
        Math.min(100, Math.trunc(Number(GITHUB.PAGINATION.MAX_PER_PAGE))),
      )
    : 100;
  const DEFAULT_PROTOCOL_VERSION =
    normalizeString(APP.protocolVersion) || "1.0.0";
  const ENDPOINTS = isPlainObject(GITHUB.ENDPOINTS)
    ? GITHUB.ENDPOINTS
    : Object.create(null);
  const QUERY_DEFAULTS = isPlainObject(GITHUB.QUERY_DEFAULTS)
    ? GITHUB.QUERY_DEFAULTS
    : Object.create(null);
  const RESPONSE_EXPECT_VALUES = ["auto", "json", "text", "empty", "raw"];
  const HTTP_METHODS_WITHOUT_BODY = ["GET", "HEAD"];

  function createNullObject() {
    return Object.create(null);
  }

  function isPlainObject(value) {
    if (value === null || typeof value !== "object") {
      return false;
    }
    if (Object.prototype.toString.call(value) !== "[object Object]") {
      return false;
    }

    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }

  function normalizeString(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function normalizeLowerString(value) {
    return normalizeString(value).toLowerCase();
  }

  function coerceText(value) {
    if (typeof value === "string") {
      return value;
    }
    if (value === null || typeof value === "undefined") {
      return "";
    }

    return String(value);
  }

  function normalizeBoolean(value, fallbackValue) {
    if (typeof value === "boolean") {
      return value;
    }
    if (typeof value === "number") {
      return value !== 0;
    }

    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();

      if (
        normalized === "true" ||
        normalized === "1" ||
        normalized === "yes" ||
        normalized === "on"
      ) {
        return true;
      }

      if (
        normalized === "false" ||
        normalized === "0" ||
        normalized === "no" ||
        normalized === "off"
      ) {
        return false;
      }
    }

    return !!fallbackValue;
  }

  function normalizeIntegerOrNull(value) {
    if (value === null || typeof value === "undefined" || value === "") {
      return null;
    }
    const numberValue = Number(value);

    if (!Number.isFinite(numberValue)) {
      return null;
    }

    return Math.trunc(numberValue);
  }

  function normalizePositiveInteger(value, fallbackValue) {
    const fallback = Number.isFinite(Number(fallbackValue))
      ? Math.max(1, Math.trunc(Number(fallbackValue)))
      : 1;
    if (!Number.isFinite(Number(value))) {
      return fallback;
    }

    return Math.max(1, Math.trunc(Number(value)));
  }

  function oneOf(value, allowedValues, fallbackValue) {
    const normalizedValue = typeof value === "string" ? value.trim() : value;
    if (
      Array.isArray(allowedValues) &&
      allowedValues.indexOf(normalizedValue) >= 0
    ) {
      return normalizedValue;
    }

    return fallbackValue;
  }

  function stableObject(value) {
    return isPlainObject(value) ? cloneValue(value) : createNullObject();
  }

  function stableArray(value) {
    return Array.isArray(value) ? value.slice() : [];
  }

  function nowIsoString() {
    return new Date().toISOString();
  }

  function createRequestId(prefix) {
    if (
      protocolHelpers &&
      typeof protocolHelpers.generateRequestId === "function"
    ) {
      try {
        return protocolHelpers.generateRequestId(prefix || "gh");
      } catch (error) {}
    }
    const normalizedPrefix = normalizeLowerString(prefix) || "gh";
    return (
      normalizedPrefix +
      "_" +
      Date.now().toString(36) +
      "_" +
      Math.random().toString(36).slice(2, 10)
    );
  }

  function normalizeBaseUrl(value) {
    const source = normalizeString(value) || DEFAULT_BASE_URL;
    try {
      const url = new URL(source);
      url.hash = "";
      url.search = "";
      return url.toString().replace(/\/$/, "");
    } catch (error) {
      throw createGitHubApiError(
        ERROR_CODES.INVALID_ARGUMENT || "INVALID_ARGUMENT",
        "GitHub API base URL is invalid.",
        {
          baseUrl: value,
        },
      );
    }
  }

  function normalizeAbsoluteOrPath(pathOrUrl) {
    const source = normalizeString(pathOrUrl);
    if (!source) {
      throw createGitHubApiError(
        ERROR_CODES.INVALID_ARGUMENT || "INVALID_ARGUMENT",
        "GitHub API request path is required.",
        createNullObject(),
      );
    }

    return source;
  }

  function isAbsoluteUrl(value) {
    return /^https?:\/\//i.test(normalizeString(value));
  }

  function sanitizeHeaderMap(headers) {
    const source = isPlainObject(headers) ? headers : createNullObject();
    const output = createNullObject();
    for (const key of Object.keys(source)) {
      const normalizedKey = normalizeString(key);

      if (!normalizedKey) {
        continue;
      }

      if (/^authorization$/i.test(normalizedKey)) {
        continue;
      }

      const value = source[key];

      if (value === null || typeof value === "undefined") {
        continue;
      }

      output[normalizedKey] = coerceText(value);
    }

    return output;
  }

  function mergePlainObjects() {
    const output = createNullObject();
    for (let index = 0; index < arguments.length; index += 1) {
      const source = arguments[index];

      if (!isPlainObject(source)) {
        continue;
      }

      for (const key of Object.keys(source)) {
        output[key] = cloneValue(source[key]);
      }
    }

    return output;
  }

  function maskToken(token) {
    const source = normalizeString(token);
    if (!source) {
      return "";
    }

    if (source.length <= 8) {
      return "[REDACTED_TOKEN]";
    }

    return "[REDACTED_TOKEN:" + source.slice(source.length - 4) + "]";
  }

  function createGitHubApiError(code, message, details) {
    const error = new Error(normalizeString(message) || "GitHub API error.");
    error.name = "MAOEGitHubApiError";
    error.code =
      normalizeString(code) || ERROR_CODES.UNKNOWN_ERROR || "UNKNOWN_ERROR";
    error.details = isPlainObject(details)
      ? cloneValue(details)
      : createNullObject();
    error.isGitHubApiError = true;
    return error;
  }

  function isGitHubApiError(error) {
    return !!(
      error &&
      typeof error === "object" &&
      error.isGitHubApiError === true
    );
  }

  function createAbortControllerWithTimeout(timeoutMs, externalSignal) {
    const controller =
      typeof AbortController !== "undefined" ? new AbortController() : null;
    const normalizedTimeoutMs = normalizePositiveInteger(
      timeoutMs,
      DEFAULT_TIMEOUT_MS,
    );
    let timeoutId = null;
    let externalAbortHandler = null;
    if (!controller) {
      return {
        signal: externalSignal || null,
        cancel: function cancel() {
          if (typeof timeoutId === "number") {
            clearTimeout(timeoutId);
            timeoutId = null;
          }
        },
      };
    }

    if (Number.isFinite(normalizedTimeoutMs) && normalizedTimeoutMs > 0) {
      timeoutId = globalScope.setTimeout(function onTimeout() {
        try {
          controller.abort(new Error("GitHub API request timed out."));
        } catch (error) {
          controller.abort();
        }
      }, normalizedTimeoutMs);
    }

    if (
      externalSignal &&
      typeof externalSignal.addEventListener === "function"
    ) {
      if (externalSignal.aborted) {
        try {
          controller.abort(externalSignal.reason);
        } catch (error) {
          controller.abort();
        }
      } else {
        externalAbortHandler = function onExternalAbort() {
          try {
            controller.abort(externalSignal.reason);
          } catch (error) {
            controller.abort();
          }
        };
        externalSignal.addEventListener("abort", externalAbortHandler, {
          once: true,
        });
      }
    }

    return {
      signal: controller.signal,
      cancel: function cancel() {
        if (typeof timeoutId === "number") {
          clearTimeout(timeoutId);
          timeoutId = null;
        }

        if (
          externalSignal &&
          externalAbortHandler &&
          typeof externalSignal.removeEventListener === "function"
        ) {
          externalSignal.removeEventListener("abort", externalAbortHandler);
        }
      },
    };
  }

  function normalizeRepositoryRef() {
    const output = {
      owner: "",
      repo: "",
      baseBranch: "",
      defaultBranch: "",
      workingBranchPrefix: "",
    };
    for (let index = 0; index < arguments.length; index += 1) {
      const source = isPlainObject(arguments[index])
        ? arguments[index]
        : createNullObject();

      if (!output.owner && normalizeString(source.owner)) {
        output.owner = normalizeString(source.owner);
      }

      if (!output.repo && normalizeString(source.repo)) {
        output.repo = normalizeString(source.repo);
      }

      if (!output.baseBranch && normalizeString(source.baseBranch)) {
        output.baseBranch = normalizeString(source.baseBranch);
      }

      if (!output.defaultBranch && normalizeString(source.defaultBranch)) {
        output.defaultBranch = normalizeString(source.defaultBranch);
      }

      if (
        !output.workingBranchPrefix &&
        normalizeString(source.workingBranchPrefix)
      ) {
        output.workingBranchPrefix = normalizeString(
          source.workingBranchPrefix,
        );
      }
    }

    if (!output.baseBranch) {
      output.baseBranch = output.defaultBranch || DEFAULT_BASE_BRANCH;
    }

    return output;
  }

  function assertRepositoryRef(repository, options) {
    const normalized = normalizeRepositoryRef(repository);
    const config = isPlainObject(options) ? options : createNullObject();
    if (!normalized.owner || !normalized.repo) {
      throw createGitHubApiError(
        ERROR_CODES.INVALID_ARGUMENT || "INVALID_ARGUMENT",
        "GitHub repository owner/repo is not fully configured.",
        {
          repository: normalized,
          required: ["owner", "repo"],
          source: normalizeString(config.source),
        },
      );
    }

    return normalized;
  }

  async function loadStoredContext() {
    const settingsPromise =
      typeof storage.getSettings === "function"
        ? storage.getSettings()
        : Promise.resolve(createNullObject());
    const authPromise =
      typeof storage.getGitHubAuth === "function"
        ? storage.getGitHubAuth()
        : Promise.resolve(createNullObject());
    const repositoryPromise =
      typeof storage.getRepository === "function"
        ? storage.getRepository()
        : Promise.resolve(createNullObject());
    const results = await Promise.allSettled([
      settingsPromise,
      authPromise,
      repositoryPromise,
    ]);

    return {
      settings:
        results[0].status === "fulfilled" && isPlainObject(results[0].value)
          ? results[0].value
          : createNullObject(),
      auth:
        results[1].status === "fulfilled" && isPlainObject(results[1].value)
          ? results[1].value
          : createNullObject(),
      repository:
        results[2].status === "fulfilled" && isPlainObject(results[2].value)
          ? results[2].value
          : createNullObject(),
    };
  }

  async function resolveClientContext(options) {
    const source = isPlainObject(options) ? options : createNullObject();
    const skipStorage = normalizeBoolean(source.skipStorage, false);
    const stored = skipStorage
      ? {
          settings: createNullObject(),
          auth: createNullObject(),
          repository: createNullObject(),
        }
      : await loadStoredContext();
    const settings = mergePlainObjects(
      stored.settings,
      stableObject(source.settings),
    );
    const auth = mergePlainObjects(stored.auth, stableObject(source.auth));
    const repository = normalizeRepositoryRef(
      stableObject(source.repository),
      stableObject(stored.repository),
      isPlainObject(settings.repository)
        ? settings.repository
        : createNullObject(),
    );
    const githubSettings = isPlainObject(settings.github)
      ? settings.github
      : createNullObject();
    const baseUrl = normalizeBaseUrl(
      source.baseUrl || githubSettings.apiBaseUrl || DEFAULT_BASE_URL,
    );
    const timeoutMs = normalizePositiveInteger(
      source.timeoutMs || githubSettings.requestTimeoutMs,
      DEFAULT_TIMEOUT_MS,
    );
    const token = normalizeString(
      source.token ||
        source.personalAccessToken ||
        auth.personalAccessToken ||
        auth.token,
    );
    const allowUnauthenticated = normalizeBoolean(
      source.allowUnauthenticated,
      false,
    );
    const apiVersion = normalizeString(
      source.apiVersion || githubSettings.apiVersion || DEFAULT_API_VERSION,
    );
    const acceptHeader = normalizeString(
      source.accept || githubSettings.acceptHeader || DEFAULT_ACCEPT_HEADER,
    );
    const defaultHeaders = sanitizeHeaderMap(source.headers);
    const requestIdPrefix = normalizeLowerString(
      source.requestIdPrefix || "gh",
    );
    if (!token && !allowUnauthenticated) {
      throw createGitHubApiError(
        ERROR_CODES.GITHUB_UNAUTHORIZED || "GITHUB_UNAUTHORIZED",
        "GitHub personal access token is not configured.",
        {
          storageKey:
            normalizeString(STORAGE_KEYS.GITHUB_AUTH) || "github_auth",
          hasStoredAuthObject: Object.keys(auth).length > 0,
          baseUrl: baseUrl,
        },
      );
    }

    return deepFreeze({
      baseUrl: baseUrl,
      timeoutMs: timeoutMs,
      token: token,
      tokenMasked: maskToken(token),
      allowUnauthenticated: allowUnauthenticated,
      apiVersion: apiVersion,
      acceptHeader: acceptHeader,
      defaultHeaders: defaultHeaders,
      repository: repository,
      protocolVersion:
        normalizeString(APP.protocolVersion) || DEFAULT_PROTOCOL_VERSION,
      requestIdPrefix: requestIdPrefix || "gh",
      settings: cloneValue(settings),
      auth: {
        username: normalizeString(auth.username),
        tokenType: normalizeString(auth.tokenType),
        lastValidatedAt: normalizeString(auth.lastValidatedAt),
        hasToken: !!token,
      },
    });
  }

  function normalizeMethod(method) {
    const normalized = normalizeString(method).toUpperCase();
    if (!normalized) {
      throw createGitHubApiError(
        ERROR_CODES.INVALID_ARGUMENT || "INVALID_ARGUMENT",
        "HTTP method is required.",
        createNullObject(),
      );
    }

    return normalized;
  }

  function normalizeExpect(value) {
    return oneOf(
      normalizeLowerString(value || "auto"),
      RESPONSE_EXPECT_VALUES,
      "auto",
    );
  }

  function buildHeaders(context, options) {
    const source = isPlainObject(options) ? options : createNullObject();
    const headers = sanitizeHeaderMap(context.defaultHeaders);
    const extraHeaders = sanitizeHeaderMap(source.headers);
    for (const key of Object.keys(extraHeaders)) {
      headers[key] = extraHeaders[key];
    }

    const acceptHeader =
      normalizeString(source.accept) ||
      context.acceptHeader ||
      DEFAULT_ACCEPT_HEADER;
    const apiVersion =
      normalizeString(source.apiVersion) ||
      context.apiVersion ||
      DEFAULT_API_VERSION;

    if (acceptHeader) {
      headers.Accept = acceptHeader;
    }

    if (apiVersion) {
      headers["X-GitHub-Api-Version"] = apiVersion;
    }

    if (context.token) {
      headers.Authorization = "Bearer " + context.token;
    }

    return headers;
  }

  function isBodyAllowed(method) {
    return HTTP_METHODS_WITHOUT_BODY.indexOf(normalizeMethod(method)) < 0;
  }

  function normalizeBodyDescriptor(method, options) {
    const normalizedMethod = normalizeMethod(method);
    const source = isPlainObject(options) ? options : createNullObject();
    const output = {
      body: undefined,
      contentType: "",
      bodyKind: "none",
    };
    if (!isBodyAllowed(normalizedMethod)) {
      if (hasOwn(source, "body") || hasOwn(source, "json")) {
        throw createGitHubApiError(
          ERROR_CODES.INVALID_ARGUMENT || "INVALID_ARGUMENT",
          "HTTP method does not allow a request body.",
          {
            method: normalizedMethod,
          },
        );
      }

      return output;
    }

    if (hasOwn(source, "json")) {
      output.body = JSON.stringify(source.json);
      output.contentType = "application/json; charset=utf-8";
      output.bodyKind = "json";
      return output;
    }

    if (!hasOwn(source, "body")) {
      return output;
    }

    const body = source.body;

    if (body === null || typeof body === "undefined") {
      return output;
    }

    if (typeof FormData !== "undefined" && body instanceof FormData) {
      output.body = body;
      output.bodyKind = "form_data";
      return output;
    }

    if (
      typeof URLSearchParams !== "undefined" &&
      body instanceof URLSearchParams
    ) {
      output.body = body;
      output.bodyKind = "url_search_params";
      return output;
    }

    if (typeof Blob !== "undefined" && body instanceof Blob) {
      output.body = body;
      output.bodyKind = "blob";
      return output;
    }

    if (typeof ArrayBuffer !== "undefined" && body instanceof ArrayBuffer) {
      output.body = body;
      output.bodyKind = "array_buffer";
      return output;
    }

    if (
      typeof ArrayBuffer !== "undefined" &&
      ArrayBuffer.isView &&
      ArrayBuffer.isView(body)
    ) {
      output.body = body;
      output.bodyKind = "array_buffer_view";
      return output;
    }

    if (typeof body === "string") {
      output.body = body;
      output.bodyKind = "text";
      return output;
    }

    if (isPlainObject(body) || Array.isArray(body)) {
      output.body = JSON.stringify(body);
      output.contentType = "application/json; charset=utf-8";
      output.bodyKind = "json";
      return output;
    }

    output.body = body;
    output.bodyKind = typeof body;
    return output;
  }

  function applyContentTypeHeader(headers, contentType) {
    const normalizedContentType = normalizeString(contentType);
    if (!normalizedContentType) {
      return headers;
    }

    let hasContentType = false;

    for (const key of Object.keys(headers)) {
      if (key.toLowerCase() === "content-type") {
        hasContentType = true;
        break;
      }
    }

    if (!hasContentType) {
      headers["Content-Type"] = normalizedContentType;
    }

    return headers;
  }

  function normalizeQueryValue(value) {
    if (value === null || typeof value === "undefined") {
      return null;
    }
    if (typeof value === "boolean") {
      return value ? "true" : "false";
    }

    if (value instanceof Date) {
      return value.toISOString();
    }

    if (typeof value === "number") {
      if (!Number.isFinite(value)) {
        return null;
      }

      return String(value);
    }

    if (typeof value === "string") {
      return value;
    }

    return String(value);
  }

  function appendQuery(url, query) {
    const source = isPlainObject(query) ? query : createNullObject();
    for (const key of Object.keys(source)) {
      const value = source[key];

      if (Array.isArray(value)) {
        for (const item of value) {
          const normalizedValue = normalizeQueryValue(item);

          if (normalizedValue === null) {
            continue;
          }

          url.searchParams.append(key, normalizedValue);
        }

        continue;
      }

      const normalizedValue = normalizeQueryValue(value);

      if (normalizedValue === null) {
        continue;
      }

      url.searchParams.set(key, normalizedValue);
    }

    return url;
  }

  function replacePathParams(template, pathParams) {
    const source = normalizeString(template);
    const params = isPlainObject(pathParams) ? pathParams : createNullObject();
    const replaced = source.replace(
      /{([a-zA-Z0-9_]+)}/g,
      function replacer(match, key) {
        if (!hasOwn(params, key)) {
          return match;
        }
        const value = params[key];

        if (value === null || typeof value === "undefined") {
          return match;
        }

        if (typeof value === "string" && !value.trim()) {
          return match;
        }

        return encodeURIComponent(String(value));
      },
    );

    if (/\{[a-zA-Z0-9_]+\}/.test(replaced)) {
      const unresolved = replaced.match(/\{([a-zA-Z0-9_]+)\}/g) || [];
      throw createGitHubApiError(
        ERROR_CODES.INVALID_ARGUMENT || "INVALID_ARGUMENT",
        "GitHub API endpoint template contains unresolved path parameters.",
        {
          template: source,
          unresolved: unresolved,
          pathParams: cloneValue(params),
        },
      );
    }

    return replaced;
  }

  function deriveEndpointPathParams(endpointTemplate, context, options) {
    const source = isPlainObject(options) ? options : createNullObject();
    const explicitPathParams = isPlainObject(source.pathParams)
      ? source.pathParams
      : createNullObject();
    const repository = normalizeRepositoryRef(
      stableObject(source.repository),
      stableObject(context.repository),
    );
    const inferred = createNullObject();
    if (/\{owner\}/.test(endpointTemplate)) {
      inferred.owner = repository.owner;
    }

    if (/\{repo\}/.test(endpointTemplate)) {
      inferred.repo = repository.repo;
    }

    if (/\{branch\}/.test(endpointTemplate)) {
      inferred.branch =
        normalizeString(source.branch) ||
        normalizeString(source.baseBranch) ||
        normalizeString(repository.baseBranch);
    }

    if (/\{issue_number\}/.test(endpointTemplate)) {
      inferred.issue_number = source.issueNumber;

      if (
        (inferred.issue_number === null ||
          typeof inferred.issue_number === "undefined" ||
          inferred.issue_number === "") &&
        isPlainObject(source.issue)
      ) {
        inferred.issue_number = source.issue.number;
      }
    }

    if (/\{tree_sha\}/.test(endpointTemplate)) {
      inferred.tree_sha = source.treeSha || source.sha;
    }

    return mergePlainObjects(inferred, explicitPathParams);
  }

  function buildUrl(baseUrl, pathOrUrl, query, pathParams) {
    const normalizedBaseUrl = normalizeBaseUrl(baseUrl || DEFAULT_BASE_URL);
    const normalizedPathOrUrl = normalizeAbsoluteOrPath(pathOrUrl);
    const endpointPath = isAbsoluteUrl(normalizedPathOrUrl)
      ? normalizedPathOrUrl
      : replacePathParams(normalizedPathOrUrl, pathParams);
    const url = isAbsoluteUrl(endpointPath)
      ? new URL(endpointPath)
      : new URL(
          endpointPath.charAt(0) === "/" ? endpointPath : "/" + endpointPath,
          normalizedBaseUrl + "/",
        );

    assertUrlIsAllowed(url, normalizedBaseUrl);

    return appendQuery(url, query).toString();
  }

  function assertUrlIsAllowed(url, baseUrlString) {
    let baseHost = "";
    try {
      baseHost = new URL(baseUrlString).host.toLowerCase();
    } catch (error) {
      baseHost = "";
    }
    const requestHost = String(url.host || "").toLowerCase();
    const requestProtocol = String(url.protocol || "").toLowerCase();

    if (requestProtocol !== "https:") {
      throw createGitHubApiError(
        ERROR_CODES.INVALID_ARGUMENT || "INVALID_ARGUMENT",
        "GitHub API request must use https.",
        {
          url: url.toString(),
        },
      );
    }

    if (!baseHost || requestHost !== baseHost) {
      throw createGitHubApiError(
        ERROR_CODES.INVALID_ARGUMENT || "INVALID_ARGUMENT",
        "GitHub API request host is not allowed.",
        {
          url: url.toString(),
          allowedHost: baseHost,
        },
      );
    }
  }

  function headersToObject(headers) {
    const output = createNullObject();
    if (!headers || typeof headers.forEach !== "function") {
      return output;
    }

    headers.forEach(function onHeader(value, key) {
      output[String(key).toLowerCase()] = String(value);
    });

    return output;
  }

  function parseLinkHeader(headerValue) {
    const source = normalizeString(headerValue);
    const output = createNullObject();
    if (!source) {
      return output;
    }

    const parts = source.split(/,\s*(?=<)/);

    for (const part of parts) {
      const match = /^<([^>]+)>\s*;\s*rel="([^"]+)"$/i.exec(part.trim());

      if (!match) {
        continue;
      }

      output[match[2].toLowerCase()] = match[1];
    }

    return output;
  }

  function parseResponseAsData(bodyText, contentType, expect) {
    const normalizedExpect = normalizeExpect(expect);
    const text = typeof bodyText === "string" ? bodyText : "";
    if (normalizedExpect === "empty") {
      return {
        data: null,
        parseKind: "empty",
        parseError: null,
      };
    }

    if (!text) {
      return {
        data: null,
        parseKind: "empty",
        parseError: null,
      };
    }

    if (normalizedExpect === "text" || normalizedExpect === "raw") {
      return {
        data: text,
        parseKind: normalizedExpect,
        parseError: null,
      };
    }

    const normalizedContentType = normalizeLowerString(contentType);
    const looksLikeJson =
      normalizedContentType.indexOf("application/json") >= 0 ||
      normalizedContentType.indexOf("+json") >= 0 ||
      /^\s*[\[{]/.test(text);

    if (normalizedExpect === "json" || looksLikeJson) {
      const parsed = safeJsonParse(text, undefined);

      if (typeof parsed !== "undefined") {
        return {
          data: parsed,
          parseKind: "json",
          parseError: null,
        };
      }

      if (normalizedExpect === "json") {
        return {
          data: null,
          parseKind: "json",
          parseError: createGitHubApiError(
            ERROR_CODES.UNKNOWN_ERROR || "UNKNOWN_ERROR",
            "GitHub API returned invalid JSON.",
            {
              contentType: normalizedContentType,
              bodyText: text.slice(0, 2000),
            },
          ),
        };
      }
    }

    return {
      data: text,
      parseKind: "text",
      parseError: null,
    };
  }

  async function readResponse(response, expect) {
    const contentType =
      response && response.headers && typeof response.headers.get === "function"
        ? normalizeString(response.headers.get("content-type"))
        : "";
    const shouldBeEmpty =
      response &&
      (response.status === 204 ||
        response.status === 205 ||
        response.status === 304);
    const text = shouldBeEmpty ? "" : await response.text();
    const parsed = parseResponseAsData(
      text,
      contentType,
      shouldBeEmpty ? "empty" : expect,
    );
    if (parsed.parseError) {
      throw parsed.parseError;
    }

    return {
      text: text,
      data: parsed.data,
      parseKind: parsed.parseKind,
      contentType: contentType,
    };
  }

  function parseRateLimitInfoFromHeaders(headersObject) {
    const headers = isPlainObject(headersObject)
      ? headersObject
      : createNullObject();
    const limit = normalizeIntegerOrNull(headers["x-ratelimit-limit"]);
    const remaining = normalizeIntegerOrNull(headers["x-ratelimit-remaining"]);
    const resetEpoch = normalizeIntegerOrNull(headers["x-ratelimit-reset"]);
    const resource = normalizeString(headers["x-ratelimit-resource"]);
    const retryAfterSeconds = normalizeIntegerOrNull(headers["retry-after"]);
    return {
      limit: limit,
      remaining: remaining,
      resetEpoch: resetEpoch,
      resetAt:
        resetEpoch !== null ? new Date(resetEpoch * 1000).toISOString() : "",
      resource: resource,
      retryAfterSeconds: retryAfterSeconds,
    };
  }

  function extractErrorMessage(data, fallbackMessage) {
    if (typeof data === "string" && normalizeString(data)) {
      return normalizeString(data);
    }
    if (isPlainObject(data) && normalizeString(data.message)) {
      return normalizeString(data.message);
    }

    return normalizeString(fallbackMessage) || "GitHub API request failed.";
  }

  function extractDocumentationUrl(data) {
    if (isPlainObject(data) && normalizeString(data.documentation_url)) {
      return normalizeString(data.documentation_url);
    }
    return "";
  }

  function extractValidationErrors(data) {
    if (!isPlainObject(data) || !Array.isArray(data.errors)) {
      return [];
    }
    return data.errors.map(function mapEntry(entry) {
      if (isPlainObject(entry)) {
        return cloneValue(entry);
      }

      return {
        message: coerceText(entry),
      };
    });
  }

  function isRateLimitResponse(status, data, rateLimit) {
    const message = extractErrorMessage(data, "").toLowerCase();
    const remaining = rateLimit && rateLimit.remaining;
    if (status === 429) {
      return true;
    }

    if (status === 403) {
      if (remaining === 0) {
        return true;
      }

      if (message.indexOf("rate limit") >= 0) {
        return true;
      }
    }

    return false;
  }

  function mapStatusToErrorCode(status, data, rateLimit) {
    if (isRateLimitResponse(status, data, rateLimit)) {
      return ERROR_CODES.GITHUB_RATE_LIMITED || "GITHUB_RATE_LIMITED";
    }
    if (status === 401) {
      return ERROR_CODES.GITHUB_UNAUTHORIZED || "GITHUB_UNAUTHORIZED";
    }

    if (status === 403) {
      return ERROR_CODES.GITHUB_FORBIDDEN || "GITHUB_FORBIDDEN";
    }

    if (status === 404) {
      return ERROR_CODES.GITHUB_NOT_FOUND || "GITHUB_NOT_FOUND";
    }

    if (status === 400 || status === 409 || status === 422) {
      return ERROR_CODES.GITHUB_VALIDATION_FAILED || "GITHUB_VALIDATION_FAILED";
    }

    return ERROR_CODES.UNKNOWN_ERROR || "UNKNOWN_ERROR";
  }

  function createHttpError(responseMeta, data, rawText) {
    const status = responseMeta.status;
    const rateLimit = responseMeta.rateLimit;
    const code = mapStatusToErrorCode(status, data, rateLimit);
    const message = extractErrorMessage(
      data,
      responseMeta.statusText || "GitHub API request failed.",
    );
    const details = {
      status: status,
      statusText: responseMeta.statusText,
      method: responseMeta.method,
      url: responseMeta.url,
      githubRequestId: responseMeta.githubRequestId,
      documentationUrl: extractDocumentationUrl(data),
      rateLimit: cloneValue(rateLimit),
      retryAfterSeconds: rateLimit.retryAfterSeconds,
      validationErrors: extractValidationErrors(data),
      responseText: typeof rawText === "string" ? rawText.slice(0, 2000) : "",
      responseData:
        isPlainObject(data) || Array.isArray(data) ? cloneValue(data) : null,
    };
    return createGitHubApiError(code, message, details);
  }

  function normalizeNetworkError(error, requestMeta) {
    if (isGitHubApiError(error)) {
      return error;
    }
    const message =
      error && error.message
        ? error.message
        : "Network request to GitHub failed.";
    const normalizedMessage =
      normalizeString(message) || "Network request to GitHub failed.";
    let code = ERROR_CODES.GITHUB_NETWORK_ERROR || "GITHUB_NETWORK_ERROR";

    if (
      error &&
      (error.name === "AbortError" || /timed out/i.test(normalizedMessage))
    ) {
      code = ERROR_CODES.GITHUB_NETWORK_ERROR || "GITHUB_NETWORK_ERROR";
    }

    return createGitHubApiError(code, normalizedMessage, {
      method: requestMeta.method,
      url: requestMeta.url,
      requestId: requestMeta.requestId,
      causeName: error && error.name ? error.name : "",
      causeMessage: normalizedMessage,
    });
  }

  function buildRequestMeta(context, method, url, options) {
    const source = isPlainObject(options) ? options : createNullObject();
    return {
      requestId:
        normalizeString(source.requestId) ||
        createRequestId(context.requestIdPrefix || "gh"),
      method: normalizeMethod(method),
      url: url,
      endpoint: normalizeString(source.endpoint),
      startedAt: nowIsoString(),
    };
  }

  function summarizeRequestForLog(requestMeta, headers, bodyDescriptor) {
    return {
      requestId: requestMeta.requestId,
      method: requestMeta.method,
      url: requestMeta.url,
      hasAuthorization: !!headers.Authorization,
      authorization: headers.Authorization ? "[REDACTED]" : "",
      bodyKind: bodyDescriptor.bodyKind,
      hasBody: typeof bodyDescriptor.body !== "undefined",
      contentType: normalizeString(
        headers["Content-Type"] || headers["content-type"],
      ),
    };
  }

  async function executeRequest(context, method, pathOrUrl, options) {
    const normalizedMethod = normalizeMethod(method);
    const source = isPlainObject(options) ? options : createNullObject();
    const endpointPathOrUrl = normalizeAbsoluteOrPath(
      pathOrUrl || source.endpoint || source.path || source.url,
    );
    const query = isPlainObject(source.query)
      ? source.query
      : createNullObject();
    const url = buildUrl(
      context.baseUrl,
      endpointPathOrUrl,
      query,
      isPlainObject(source.pathParams) ? source.pathParams : createNullObject(),
    );
    const bodyDescriptor = normalizeBodyDescriptor(normalizedMethod, source);
    const headers = applyContentTypeHeader(
      buildHeaders(context, source),
      bodyDescriptor.contentType,
    );
    const requestMeta = buildRequestMeta(
      context,
      normalizedMethod,
      url,
      source,
    );
    const timeoutController = createAbortControllerWithTimeout(
      source.timeoutMs || context.timeoutMs,
      source.signal || null,
    );
    logger.debug(
      "GitHub API request start.",
      summarizeRequestForLog(requestMeta, headers, bodyDescriptor),
    );

    try {
      const response = await fetch(url, {
        method: normalizedMethod,
        headers: headers,
        body: bodyDescriptor.body,
        signal: timeoutController.signal,
        credentials: "omit",
        cache: "no-store",
        redirect: "follow",
      });
      const headersObject = headersToObject(response.headers);
      const rateLimit = parseRateLimitInfoFromHeaders(headersObject);
      const links = parseLinkHeader(headersObject.link || "");
      const githubRequestId = normalizeString(
        headersObject["x-github-request-id"],
      );
      const responseBody = await readResponse(response, source.expect);
      const responseMeta = {
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        url: response.url || url,
        method: normalizedMethod,
        githubRequestId: githubRequestId,
        headers: headersObject,
        links: links,
        rateLimit: rateLimit,
      };

      if (!response.ok) {
        throw createHttpError(
          responseMeta,
          responseBody.data,
          responseBody.text,
        );
      }

      const result = deepFreeze({
        ok: true,
        requestId: requestMeta.requestId,
        method: normalizedMethod,
        url: response.url || url,
        status: response.status,
        statusText: response.statusText,
        data: cloneValue(responseBody.data),
        bodyText: responseBody.text,
        parseKind: responseBody.parseKind,
        headers: cloneValue(headersObject),
        links: cloneValue(links),
        rateLimit: cloneValue(rateLimit),
        githubRequestId: githubRequestId,
        request: {
          endpoint: normalizeString(source.endpoint) || endpointPathOrUrl,
          query: cloneValue(query),
        },
      });

      logger.debug("GitHub API request success.", {
        requestId: requestMeta.requestId,
        method: normalizedMethod,
        url: responseMeta.url,
        status: responseMeta.status,
        githubRequestId: githubRequestId,
        rateLimitRemaining: rateLimit.remaining,
        parseKind: responseBody.parseKind,
      });

      return result;
    } catch (error) {
      const normalizedError = normalizeNetworkError(error, requestMeta);

      logger.warn("GitHub API request failed.", {
        requestId: requestMeta.requestId,
        method: normalizedMethod,
        url: url,
        code: normalizedError.code,
        message: normalizedError.message,
        details: cloneValue(normalizedError.details),
      });

      throw normalizedError;
    } finally {
      timeoutController.cancel();
    }
  }

  function resolveEndpointTemplate(name, fallbackValue) {
    const endpointName = normalizeString(name);
    if (!endpointName) {
      return normalizeString(fallbackValue);
    }

    if (hasOwn(ENDPOINTS, endpointName)) {
      return normalizeString(ENDPOINTS[endpointName]);
    }

    return endpointName;
  }

  function resolveRepositoryForRequest(context, options) {
    const source = isPlainObject(options) ? options : createNullObject();
    return assertRepositoryRef(
      normalizeRepositoryRef(
        stableObject(source.repository),
        stableObject(context.repository),
      ),
      {
        source: "request",
      },
    );
  }

  function buildEndpointRequestOptions(context, endpointTemplate, options) {
    const source = isPlainObject(options)
      ? cloneValue(options)
      : createNullObject();
    const template = normalizeString(endpointTemplate);
    const pathParams = deriveEndpointPathParams(template, context, source);
    if (/\{owner\}|\{repo\}/.test(template)) {
      const repository = resolveRepositoryForRequest(context, source);
      pathParams.owner = hasOwn(pathParams, "owner")
        ? pathParams.owner
        : repository.owner;
      pathParams.repo = hasOwn(pathParams, "repo")
        ? pathParams.repo
        : repository.repo;
    }

    source.endpoint = template;
    source.pathParams = pathParams;
    return source;
  }

  function createClientMethods(context) {
    return deepFreeze({
      context: cloneValue(context),
      request: function request(method, pathOrUrl, options) {
        return executeRequest(context, method, pathOrUrl, options);
      },
      requestEndpoint: function requestEndpoint(
        method,
        endpointTemplate,
        options,
      ) {
        const template = resolveEndpointTemplate(endpointTemplate, "");
        const requestOptions = buildEndpointRequestOptions(
          context,
          template,
          options,
        );
        return executeRequest(context, method, template, requestOptions);
      },
      requestData: function requestData(method, pathOrUrl, options) {
        return executeRequest(context, method, pathOrUrl, options).then(
          function mapResult(result) {
            return result.data;
          },
        );
      },
      requestEndpointData: function requestEndpointData(
        method,
        endpointTemplate,
        options,
      ) {
        return this.requestEndpoint(method, endpointTemplate, options).then(
          function mapResult(result) {
            return result.data;
          },
        );
      },
      get: function get(pathOrUrl, options) {
        return executeRequest(context, "GET", pathOrUrl, options);
      },
      post: function post(pathOrUrl, options) {
        return executeRequest(context, "POST", pathOrUrl, options);
      },
      patch: function patch(pathOrUrl, options) {
        return executeRequest(context, "PATCH", pathOrUrl, options);
      },
      put: function put(pathOrUrl, options) {
        return executeRequest(context, "PUT", pathOrUrl, options);
      },
      delete: function remove(pathOrUrl, options) {
        return executeRequest(context, "DELETE", pathOrUrl, options);
      },
      getEndpoint: function getEndpoint(endpointTemplate, options) {
        return this.requestEndpoint("GET", endpointTemplate, options);
      },
      postEndpoint: function postEndpoint(endpointTemplate, options) {
        return this.requestEndpoint("POST", endpointTemplate, options);
      },
      patchEndpoint: function patchEndpoint(endpointTemplate, options) {
        return this.requestEndpoint("PATCH", endpointTemplate, options);
      },
      putEndpoint: function putEndpoint(endpointTemplate, options) {
        return this.requestEndpoint("PUT", endpointTemplate, options);
      },
      deleteEndpoint: function deleteEndpoint(endpointTemplate, options) {
        return this.requestEndpoint("DELETE", endpointTemplate, options);
      },
      getJson: function getJson(pathOrUrl, options) {
        return this.get(
          pathOrUrl,
          Object.assign(createNullObject(), stableObject(options), {
            expect: "json",
          }),
        ).then(function mapResult(result) {
          return result.data;
        });
      },
      getEndpointJson: function getEndpointJson(endpointTemplate, options) {
        return this.getEndpoint(
          endpointTemplate,
          Object.assign(createNullObject(), stableObject(options), {
            expect: "json",
          }),
        ).then(function mapResult(result) {
          return result.data;
        });
      },
      validateAuthentication: function validateAuthentication(options) {
        return this.get(
          "/user",
          Object.assign(createNullObject(), stableObject(options), {
            expect: "json",
          }),
        );
      },
      getAuthenticatedUser: function getAuthenticatedUser(options) {
        return this.validateAuthentication(options).then(
          function mapResult(result) {
            return result.data;
          },
        );
      },
      getRateLimit: function getRateLimit(options) {
        return this.get(
          "/rate_limit",
          Object.assign(createNullObject(), stableObject(options), {
            allowUnauthenticated: true,
            expect: "json",
          }),
        );
      },
      getRepository: function getRepository(options) {
        return this.getEndpoint(
          "GET_REPOSITORY",
          Object.assign(createNullObject(), stableObject(options), {
            expect: "json",
          }),
        );
      },
      getRepositoryJson: function getRepositoryJson(options) {
        return this.getRepository(options).then(function mapResult(result) {
          return result.data;
        });
      },
      getRepositoryBranch: function getRepositoryBranch(options) {
        const source = isPlainObject(options)
          ? cloneValue(options)
          : createNullObject();
        source.pathParams = mergePlainObjects(stableObject(source.pathParams), {
          branch:
            normalizeString(source.branch) ||
            normalizeString(source.baseBranch) ||
            normalizeString(context.repository.baseBranch) ||
            DEFAULT_BASE_BRANCH,
        });
        source.expect = "json";
        return this.getEndpoint("GET_REPOSITORY_BRANCH", source);
      },
      getRepositoryBranchJson: function getRepositoryBranchJson(options) {
        return this.getRepositoryBranch(options).then(
          function mapResult(result) {
            return result.data;
          },
        );
      },
      listRepositoryIssues: function listRepositoryIssues(options) {
        const source = isPlainObject(options)
          ? cloneValue(options)
          : createNullObject();
        const defaults = isPlainObject(QUERY_DEFAULTS.LIST_ISSUES)
          ? QUERY_DEFAULTS.LIST_ISSUES
          : createNullObject();
        source.query = mergePlainObjects(defaults, stableObject(source.query), {
          state: normalizeString(
            source.state || defaults.state || DEFAULT_ISSUE_STATE,
          ),
          sort: normalizeString(
            source.sort || defaults.sort || DEFAULT_ISSUE_SORT,
          ),
          direction: normalizeString(
            source.direction || defaults.direction || DEFAULT_ISSUE_DIRECTION,
          ),
          per_page: Math.min(
            MAX_PER_PAGE,
            normalizePositiveInteger(
              source.perPage ||
                source.per_page ||
                defaults.per_page ||
                DEFAULT_ISSUES_PER_PAGE,
              DEFAULT_ISSUES_PER_PAGE,
            ),
          ),
        });
        source.expect = "json";
        return this.getEndpoint("LIST_REPOSITORY_ISSUES", source);
      },
      listRepositoryIssuesJson: function listRepositoryIssuesJson(options) {
        return this.listRepositoryIssues(options).then(
          function mapResult(result) {
            return result.data;
          },
        );
      },
      getIssue: function getIssue(options) {
        const source = isPlainObject(options)
          ? cloneValue(options)
          : createNullObject();
        const issueNumber = normalizeIntegerOrNull(
          source.issueNumber ||
            (isPlainObject(source.issue) ? source.issue.number : null),
        );
        if (issueNumber === null) {
          throw createGitHubApiError(
            ERROR_CODES.INVALID_ARGUMENT || "INVALID_ARGUMENT",
            "issueNumber is required.",
            createNullObject(),
          );
        }

        source.pathParams = mergePlainObjects(stableObject(source.pathParams), {
          issue_number: issueNumber,
        });
        source.expect = "json";
        return this.getEndpoint("GET_ISSUE", source);
      },
      getIssueJson: function getIssueJson(options) {
        return this.getIssue(options).then(function mapResult(result) {
          return result.data;
        });
      },
      getTree: function getTree(options) {
        const source = isPlainObject(options)
          ? cloneValue(options)
          : createNullObject();
        const treeSha = normalizeString(source.treeSha || source.sha);

        if (!treeSha) {
          throw createGitHubApiError(
            ERROR_CODES.INVALID_ARGUMENT || "INVALID_ARGUMENT",
            "treeSha is required.",
            createNullObject(),
          );
        }

        source.pathParams = mergePlainObjects(stableObject(source.pathParams), {
          tree_sha: treeSha,
        });
        source.query = mergePlainObjects(
          isPlainObject(QUERY_DEFAULTS.GET_TREE)
            ? QUERY_DEFAULTS.GET_TREE
            : createNullObject(),
          stableObject(source.query),
          hasOwn(source, "recursive")
            ? {
                recursive: normalizeBoolean(source.recursive, true) ? "1" : "0",
              }
            : createNullObject(),
        );
        source.expect = "json";
        return this.getEndpoint("GET_TREE", source);
      },
      getTreeJson: function getTreeJson(options) {
        return this.getTree(options).then(function mapResult(result) {
          return result.data;
        });
      },
      createPullRequest: function createPullRequest(options) {
        const source = isPlainObject(options)
          ? cloneValue(options)
          : createNullObject();
        const title = normalizeString(source.title);
        const head = normalizeString(source.head);
        const base =
          normalizeString(source.base) ||
          normalizeString(context.repository.baseBranch) ||
          DEFAULT_BASE_BRANCH;

        if (!title || !head || !base) {
          throw createGitHubApiError(
            ERROR_CODES.INVALID_ARGUMENT || "INVALID_ARGUMENT",
            "Pull request title, head, and base are required.",
            {
              title: title,
              head: head,
              base: base,
            },
          );
        }

        source.json = {
          title: title,
          head: head,
          base: base,
          body: coerceText(source.body),
          draft: normalizeBoolean(
            source.draft,
            REPOSITORY.DEFAULT_PULL_REQUEST_DRAFT === true,
          ),
        };
        source.expect = "json";
        return this.postEndpoint("CREATE_PULL_REQUEST", source);
      },
      createPullRequestJson: function createPullRequestJson(options) {
        return this.createPullRequest(options).then(function mapResult(result) {
          return result.data;
        });
      },
      resolveRepository: function resolveRepository(options) {
        return resolveRepositoryForRequest(context, options);
      },
      withRepository: function withRepository(repositoryOverrides) {
        return createClientMethods(
          Object.assign(createNullObject(), cloneValue(context), {
            repository: normalizeRepositoryRef(
              stableObject(repositoryOverrides),
              stableObject(context.repository),
            ),
          }),
        );
      },
      withContext: function withContext(contextOverrides) {
        const overrides = isPlainObject(contextOverrides)
          ? cloneValue(contextOverrides)
          : createNullObject();
        const nextContext = mergePlainObjects(cloneValue(context), overrides);
        nextContext.repository = normalizeRepositoryRef(
          stableObject(overrides.repository),
          stableObject(context.repository),
        );
        nextContext.defaultHeaders = sanitizeHeaderMap(
          nextContext.defaultHeaders,
        );
        return createClientMethods(nextContext);
      },
    });
  }

  async function createClient(options) {
    const context = await resolveClientContext(options);
    return createClientMethods(context);
  }

  async function request(method, pathOrUrl, options) {
    const client = await createClient(options);
    return client.request(method, pathOrUrl, options);
  }

  async function requestEndpoint(method, endpointTemplate, options) {
    const client = await createClient(options);
    return client.requestEndpoint(method, endpointTemplate, options);
  }

  async function requestData(method, pathOrUrl, options) {
    const result = await request(method, pathOrUrl, options);
    return result.data;
  }

  async function requestEndpointData(method, endpointTemplate, options) {
    const result = await requestEndpoint(method, endpointTemplate, options);
    return result.data;
  }

  async function validateAuthentication(options) {
    const client = await createClient(options);
    return client.validateAuthentication(options);
  }

  async function getAuthenticatedUser(options) {
    const result = await validateAuthentication(options);
    return result.data;
  }

  function summarizeContextForLog(context) {
    return {
      baseUrl: context.baseUrl,
      timeoutMs: context.timeoutMs,
      apiVersion: context.apiVersion,
      hasToken: !!context.token,
      token: context.tokenMasked,
      allowUnauthenticated: context.allowUnauthenticated,
      repository: cloneValue(context.repository),
    };
  }

  const api = {
    defaults: deepFreeze({
      baseUrl: DEFAULT_BASE_URL,
      timeoutMs: DEFAULT_TIMEOUT_MS,
      acceptHeader: DEFAULT_ACCEPT_HEADER,
      apiVersion: DEFAULT_API_VERSION,
      defaultBaseBranch: DEFAULT_BASE_BRANCH,
      defaultPerPage: DEFAULT_ISSUES_PER_PAGE,
      maxPerPage: MAX_PER_PAGE,
      protocolVersion: DEFAULT_PROTOCOL_VERSION,
    }),
    endpoints: deepFreeze(cloneValue(ENDPOINTS)),
    queryDefaults: deepFreeze(cloneValue(QUERY_DEFAULTS)),
    createClient: createClient,
    resolveClientContext: resolveClientContext,
    request: request,
    requestEndpoint: requestEndpoint,
    requestData: requestData,
    requestEndpointData: requestEndpointData,
    get: function get(pathOrUrl, options) {
      return request("GET", pathOrUrl, options);
    },
    post: function post(pathOrUrl, options) {
      return request("POST", pathOrUrl, options);
    },
    patch: function patch(pathOrUrl, options) {
      return request("PATCH", pathOrUrl, options);
    },
    put: function put(pathOrUrl, options) {
      return request("PUT", pathOrUrl, options);
    },
    delete: function remove(pathOrUrl, options) {
      return request("DELETE", pathOrUrl, options);
    },
    getRepository: async function getRepository(options) {
      const client = await createClient(options);
      return client.getRepository(options);
    },
    getRepositoryJson: async function getRepositoryJson(options) {
      const client = await createClient(options);
      return client.getRepositoryJson(options);
    },
    getRepositoryBranch: async function getRepositoryBranch(options) {
      const client = await createClient(options);
      return client.getRepositoryBranch(options);
    },
    getRepositoryBranchJson: async function getRepositoryBranchJson(options) {
      const client = await createClient(options);
      return client.getRepositoryBranchJson(options);
    },
    listRepositoryIssues: async function listRepositoryIssues(options) {
      const client = await createClient(options);
      return client.listRepositoryIssues(options);
    },
    listRepositoryIssuesJson: async function listRepositoryIssuesJson(options) {
      const client = await createClient(options);
      return client.listRepositoryIssuesJson(options);
    },
    getIssue: async function getIssue(options) {
      const client = await createClient(options);
      return client.getIssue(options);
    },
    getIssueJson: async function getIssueJson(options) {
      const client = await createClient(options);
      return client.getIssueJson(options);
    },
    getTree: async function getTree(options) {
      const client = await createClient(options);
      return client.getTree(options);
    },
    getTreeJson: async function getTreeJson(options) {
      const client = await createClient(options);
      return client.getTreeJson(options);
    },
    createPullRequest: async function createPullRequest(options) {
      const client = await createClient(options);
      return client.createPullRequest(options);
    },
    createPullRequestJson: async function createPullRequestJson(options) {
      const client = await createClient(options);
      return client.createPullRequestJson(options);
    },
    getRateLimit: async function getRateLimit(options) {
      const client = await createClient(
        Object.assign(createNullObject(), stableObject(options), {
          allowUnauthenticated: normalizeBoolean(
            options && options.allowUnauthenticated,
            true,
          ),
        }),
      );
      return client.getRateLimit(options);
    },
    validateAuthentication: validateAuthentication,
    getAuthenticatedUser: getAuthenticatedUser,
    helpers: deepFreeze({
      normalizeBaseUrl: normalizeBaseUrl,
      normalizeRepositoryRef: normalizeRepositoryRef,
      assertRepositoryRef: assertRepositoryRef,
      sanitizeHeaderMap: sanitizeHeaderMap,
      buildHeaders: buildHeaders,
      buildUrl: buildUrl,
      replacePathParams: replacePathParams,
      deriveEndpointPathParams: deriveEndpointPathParams,
      normalizeBodyDescriptor: normalizeBodyDescriptor,
      headersToObject: headersToObject,
      parseLinkHeader: parseLinkHeader,
      parseRateLimitInfoFromHeaders: parseRateLimitInfoFromHeaders,
      mapStatusToErrorCode: mapStatusToErrorCode,
      createGitHubApiError: createGitHubApiError,
      isGitHubApiError: isGitHubApiError,
      maskToken: maskToken,
      summarizeContextForLog: summarizeContextForLog,
    }),
  };

  try {
    logger.debug("GitHub API module registered.", {
      baseUrl: DEFAULT_BASE_URL,
      timeoutMs: DEFAULT_TIMEOUT_MS,
      apiVersion: DEFAULT_API_VERSION,
      endpointCount: Object.keys(ENDPOINTS).length,
    });
  } catch (error) {}

  root.registerValue("github_api", deepFreeze(api), {
    overwrite: false,
    freeze: false,
    clone: false,
  });
})(
  typeof globalThis !== "undefined"
    ? globalThis
    : typeof self !== "undefined"
      ? self
      : typeof window !== "undefined"
        ? window
        : this,
);
