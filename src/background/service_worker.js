async function handleContentProbeRequest(messageMeta) {
const source = isPlainObject(messageMeta.payload) ? cloneValue(messageMeta.payload) : createNullObject();

if (!messageMeta.isContentSender) {
  return probeTab(source);
}

const tabContext = upsertTabContextFromSender(messageMeta.sender, source, {
  probed: true,
  stage: getCachedWorkflowStateSync().stage
});
const dashboard = await safeGetDashboardState({
  includeStageArtifact: true
});
const workflow = normalizeWorkflowStateFromAny(dashboard.workflow);
const stageArtifact = isPlainObject(dashboard.stageArtifact) ? dashboard.stageArtifact : null;
const preferredProviderId = normalizeLowerString(
  stageArtifact && stageArtifact.providerId
  || workflow.activeProviderId
  || ''
);
const activeForThisTab = !!(tabContext.providerId && preferredProviderId && tabContext.providerId === preferredProviderId);

return deepFreeze({
  tabContext: cloneValue(tabContext),
  workflow: cloneValue(workflow),
  stageArtifact: stageArtifact ? cloneValue(stageArtifact) : null,
  activeForThisTab: activeForThisTab,
  canFillPrompt: activeForThisTab && !!(stageArtifact && coerceText(stageArtifact.promptText)),
  canCaptureOutput: [STAGE_DESIGN, STAGE_EXECUTION, STAGE_AUDIT, STAGE_PR].indexOf(workflow.stage) >= 0
});

}

async function handleContentSiteDetected(messageMeta) {
const source = isPlainObject(messageMeta.payload) ? cloneValue(messageMeta.payload) : createNullObject();

if (!messageMeta.isContentSender) {
  throw createOrchestratorError(
    ERROR_CODES.MESSAGE_UNSUPPORTED || 'MESSAGE_UNSUPPORTED',
    'CONTENT_SITE_DETECTED must originate from a content script tab.',
    createNullObject()
  );
}

const tabContext = upsertTabContextFromSender(messageMeta.sender, source, {
  probed: true,
  stage: getCachedWorkflowStateSync().stage
});

return handleContentProbeRequest({
  type: MESSAGE_TYPES.CONTENT_PROBE,
  requestId: messageMeta.requestId,
  payload: {
    tabContext: tabContext
  },
  raw: messageMeta.raw,
  sender: messageMeta.sender,
  senderTabId: messageMeta.senderTabId,
  senderUrl: messageMeta.senderUrl,
  senderId: messageMeta.senderId,
  isContentSender: true
});

}

function previewPayloadForStage(rawText, stage, options) {
const normalizedStage = normalizeLowerString(stage);
const source = isPlainObject(options) ? options : createNullObject();

if (normalizedStage === STAGE_EXECUTION) {
  return orchestrator.helpers.parseExecutionSubmission(rawText, {
    expectedPath: source.expectedPath || source.targetFile || source.currentTaskFilePath
  });
}

if (normalizedStage === STAGE_AUDIT) {
  return orchestrator.helpers.parseAuditSubmission(rawText, source);
}

if (normalizedStage === STAGE_DESIGN) {
  const targetFile = orchestrator.helpers.extractTargetFileFromDesignText(rawText, source);

  if (!targetFile) {
    return {
      ok: false,
      submissionType: 'design',
      payload: null,
      errors: [{
        code: ERROR_CODES.INVALID_ARGUMENT || 'INVALID_ARGUMENT',
        message: 'Design submission does not contain a target file path.'
      }],
      warnings: [],
      metadata: {
        parser: 'design_target_file'
      }
    };
  }

  return {
    ok: true,
    submissionType: 'design',
    payload: {
      targetFile: targetFile
    },
    errors: [],
    warnings: [],
    metadata: {
      parser: 'design_target_file'
    }
  };
}

if (normalizedStage === STAGE_PR) {
  const pullRequestRef = orchestrator.helpers.parsePullRequestReference(rawText, {
    repository: source.repository
  });

  if (!pullRequestRef) {
    return {
      ok: false,
      submissionType: 'pull_request',
      payload: null,
      errors: [{
        code: ERROR_CODES.INVALID_ARGUMENT || 'INVALID_ARGUMENT',
        message: 'Pull request reference could not be parsed.'
      }],
      warnings: [],
      metadata: {
        parser: 'pull_request_reference'
      }
    };
  }

  return {
    ok: true,
    submissionType: 'pull_request',
    payload: pullRequestRef,
    errors: [],
    warnings: [],
    metadata: {
      parser: 'pull_request_reference'
    }
  };
}

return {
  ok: false,
  submissionType: normalizedStage || 'unknown',
  payload: null,
  errors: [{
    code: ERROR_CODES.INVALID_STATE || 'INVALID_STATE',
    message: 'No preview parser is available for this stage.'
  }],
  warnings: [],
  metadata: {
    stage: normalizedStage
  }
};

}

async function handleContentAiOutputCaptured(messageMeta) {
const source = isPlainObject(messageMeta.payload) ? cloneValue(messageMeta.payload) : createNullObject();

if (!messageMeta.isContentSender) {
  throw createOrchestratorError(
    ERROR_CODES.MESSAGE_UNSUPPORTED || 'MESSAGE_UNSUPPORTED',
    'CONTENT_AI_OUTPUT_CAPTURED must originate from a content script tab.',
    createNullObject()
  );
}

const rawText = coerceText(source.rawText || source.text || source.response || '');
const workflow = await getWorkflowState();
const stage = normalizeLowerString(source.stage || workflow.stage || '');
const tabContext = upsertTabContextFromSender(messageMeta.sender, source, {
  probed: false,
  stage: stage
});

if (rawText) {
  updateTabCapture(messageMeta.senderTabId, rawText, stage);
}

if (normalizeBoolean(source.autoSubmit, false) && rawText) {
  const submission = await orchestrator.submitHumanPayload(rawText, mergePlainObjects(source, {
    stage: stage,
    recordHumanAction: hasOwn(source, 'recordHumanAction') ? source.recordHumanAction : true
  }));

  return deepFreeze({
    tabContext: cloneValue(tabContext),
    rawTextLength: rawText.length,
    autoSubmitted: true,
    submission: cloneValue(submission)
  });
}

const bootstrap = await getBootstrapState();
const repository = resolveRepositoryFromBootstrap(bootstrap, source);
const preview = previewPayloadForStage(rawText, stage, {
  repository: repository,
  targetFile: workflow.currentTaskFilePath,
  currentTaskFilePath: workflow.currentTaskFilePath
});

return deepFreeze({
  tabContext: cloneValue(tabContext),
  rawTextLength: rawText.length,
  autoSubmitted: false,
  preview: cloneValue(preview),
  extractedBlocks: Array.isArray(source.extractedBlocks) ? cloneValue(source.extractedBlocks) : [],
  parsedPacket: isPlainObject(source.parsedPacket) ? cloneValue(source.parsedPacket) : null
});

}

async function handleContentBuildManualPacket(messageMeta) {
const source = isPlainObject(messageMeta.payload) ? cloneValue(messageMeta.payload) : createNullObject();
const result = await buildManualPacket(source);

if (normalizeBoolean(hasOwn(source, 'recordHumanAction') ? source.recordHumanAction : false, false)
  && result.packetText) {
  await stateStore.recordHumanAction(HUMAN_ACTION_COPY_PROMPT, {
    stage: result.stageArtifact && result.stageArtifact.stage ? result.stageArtifact.stage : '',
    packetLength: result.packetText.length
  }, {
    appendLog: false
  });
}

return result;

}

async function handleContentFillPrompt(messageMeta) {
return fillPromptInTab(messageMeta.payload);
}

async function handleContentExtractLatestResponse(messageMeta) {
return extractLatestResponseFromTab(messageMeta.payload);
}

async function handleMessage(messageMeta) {
const type = normalizeString(messageMeta.type);

if (!type) {
  throw createOrchestratorError(
    ERROR_CODES.MESSAGE_UNSUPPORTED || 'MESSAGE_UNSUPPORTED',
    'Message type is required.',
    createNullObject()
  );
}

runtimeState.lastMessageId = messageMeta.requestId;

if (type === MESSAGE_TYPES.POPUP_GET_BOOTSTRAP) {
  return handlePopupGetBootstrap(messageMeta);
}

if (type === MESSAGE_TYPES.POPUP_SAVE_GITHUB_SETTINGS) {
  return handlePopupSaveGithubSettings(messageMeta);
}

if (type === MESSAGE_TYPES.POPUP_LOAD_ISSUES) {
  return handlePopupLoadIssues(messageMeta);
}

if (type === MESSAGE_TYPES.POPUP_LOAD_REPO_TREE) {
  return handlePopupLoadRepoTree(messageMeta);
}

if (type === MESSAGE_TYPES.POPUP_SELECT_ISSUE) {
  return handlePopupSelectIssue(messageMeta);
}

if (type === MESSAGE_TYPES.POPUP_SUBMIT_HUMAN_PAYLOAD) {
  return handlePopupSubmitHumanPayload(messageMeta);
}

if (type === MESSAGE_TYPES.POPUP_ADVANCE_STAGE) {
  return handlePopupAdvanceStage(messageMeta);
}

if (type === MESSAGE_TYPES.POPUP_RESET_WORKFLOW) {
  return handlePopupResetWorkflow(messageMeta);
}

if (type === MESSAGE_TYPES.POPUP_GET_WORKFLOW_STATE) {
  return handlePopupGetWorkflowState(messageMeta);
}

if (type === MESSAGE_TYPES.POPUP_GET_EVENT_LOG) {
  return handlePopupGetEventLog(messageMeta);
}

if (type === MESSAGE_TYPES.CONTENT_PROBE) {
  return handleContentProbeRequest(messageMeta);
}

if (type === MESSAGE_TYPES.CONTENT_SITE_DETECTED) {
  return handleContentSiteDetected(messageMeta);
}

if (type === MESSAGE_TYPES.CONTENT_AI_OUTPUT_CAPTURED) {
  return handleContentAiOutputCaptured(messageMeta);
}

if (type === MESSAGE_TYPES.CONTENT_BUILD_MANUAL_PACKET) {
  return handleContentBuildManualPacket(messageMeta);
}

if (type === MESSAGE_TYPES.CONTENT_FILL_PROMPT) {
  return handleContentFillPrompt(messageMeta);
}

if (type === MESSAGE_TYPES.CONTENT_EXTRACT_LATEST_RESPONSE) {
  return handleContentExtractLatestResponse(messageMeta);
}

throw createOrchestratorError(
  ERROR_CODES.MESSAGE_UNSUPPORTED || 'MESSAGE_UNSUPPORTED',
  'Unsupported message type.',
  {
    type: type
  }
);

}

function buildWorkflowBroadcastPayload(eventType, workflow, extra) {
return deepFreeze(mergePlainObjects(
{
eventType: normalizeString(eventType),
workflow: cloneValue(workflow)
},
stableObject(extra)
));
}

function extractWorkflowFromStateEvent(event) {
const source = isPlainObject(event) ? event : createNullObject();
const payload = isPlainObject(source.payload) ? source.payload : createNullObject();

if (isPlainObject(payload.current)) {
  return normalizeWorkflowStateFromAny(payload.current);
}

if (isPlainObject(payload.bootstrap) && isPlainObject(payload.bootstrap.workflow)) {
  return normalizeWorkflowStateFromAny(payload.bootstrap.workflow);
}

return getCachedWorkflowStateSync();

}

function extractErrorRecordFromStateEvent(event) {
const source = isPlainObject(event) ? event : createNullObject();
const payload = isPlainObject(source.payload) ? source.payload : createNullObject();

if (isPlainObject(payload.bootstrap) && isPlainObject(payload.bootstrap.lastError)) {
  return payload.bootstrap.lastError;
}

if (isPlainObject(payload.current)
  && (normalizeString(payload.current.lastErrorCode) || normalizeString(payload.current.lastErrorMessage))) {
  return {
    code: normalizeString(payload.current.lastErrorCode),
    message: normalizeString(payload.current.lastErrorMessage),
    details: createNullObject(),
    at: nowIsoString()
  };
}

if (typeof stateStore.getCachedBootstrapState === 'function') {
  try {
    const bootstrap = stateStore.getCachedBootstrapState();
    if (isPlainObject(bootstrap.lastError)) {
      return bootstrap.lastError;
    }
  } catch (error) {
  }
}

return null;

}

function broadcastStateChanged(eventType, workflow, extra) {
broadcastMessage(createBroadcastMessage(
MESSAGE_TYPES.BACKGROUND_STATE_CHANGED,
buildWorkflowBroadcastPayload(eventType, workflow, extra),
{
channel: 'workflow'
}
), {
toTabs: true
});
}

function broadcastError(eventType, errorRecord) {
if (!errorRecord) {
return;
}

broadcastMessage(createBroadcastMessage(
  MESSAGE_TYPES.BACKGROUND_ERROR,
  {
    eventType: normalizeString(eventType),
    error: cloneValue(errorRecord)
  },
  {
    channel: 'error'
  }
), {
  toTabs: true
});

}

function broadcastLogAppended(eventType, entry) {
if (!entry) {
return;
}

broadcastMessage(createBroadcastMessage(
  MESSAGE_TYPES.BACKGROUND_LOG_APPENDED,
  {
    eventType: normalizeString(eventType),
    entry: cloneValue(entry)
  },
  {
    channel: 'log'
  }
), {
  toTabs: true
});

}
async function handleStateStoreEvent(event) {
const normalizedEvent = isPlainObject(event) ? event : createNullObject();
const type = normalizeString(normalizedEvent.type);

if (!type) {
  return;
}

const workflow = extractWorkflowFromStateEvent(normalizedEvent);
const payload = isPlainObject(normalizedEvent.payload) ? normalizedEvent.payload : createNullObject();

if (type === normalizeString(STATE_STORE_EVENT_TYPES.EVENT_LOG_APPENDED || 'EVENT_LOG_APPENDED')) {
  broadcastLogAppended(type, payload.entry);
  return;
}

if (type === normalizeString(STATE_STORE_EVENT_TYPES.ERROR_SET || 'ERROR_SET')) {
  broadcastStateChanged(type, workflow, {
    summary: stableObject(payload.summary),
    meta: stableObject(payload.meta)
  });
  broadcastError(type, extractErrorRecordFromStateEvent(normalizedEvent));
  return;
}

if (type === normalizeString(STATE_STORE_EVENT_TYPES.ERROR_CLEARED || 'ERROR_CLEARED')) {
  broadcastStateChanged(type, workflow, {
    summary: stableObject(payload.summary),
    meta: stableObject(payload.meta)
  });
  return;
}

if (type === normalizeString(STATE_STORE_EVENT_TYPES.INITIALIZED || 'INITIALIZED')
  || type === normalizeString(STATE_STORE_EVENT_TYPES.REFRESHED || 'REFRESHED')
  || type === normalizeString(STATE_STORE_EVENT_TYPES.WORKFLOW_CHANGED || 'WORKFLOW_CHANGED')
  || type === normalizeString(STATE_STORE_EVENT_TYPES.ISSUE_SELECTED || 'ISSUE_SELECTED')
  || type === normalizeString(STATE_STORE_EVENT_TYPES.PROVIDERS_CHANGED || 'PROVIDERS_CHANGED')
  || type === normalizeString(STATE_STORE_EVENT_TYPES.ACTIVE_PROVIDER_CHANGED || 'ACTIVE_PROVIDER_CHANGED')
  || type === normalizeString(STATE_STORE_EVENT_TYPES.HUMAN_ACTION_RECORDED || 'HUMAN_ACTION_RECORDED')
  || type === normalizeString(STATE_STORE_EVENT_TYPES.EXECUTOR_RESPONSE_RECORDED || 'EXECUTOR_RESPONSE_RECORDED')
  || type === normalizeString(STATE_STORE_EVENT_TYPES.AUDIT_RESULT_RECORDED || 'AUDIT_RESULT_RECORDED')
  || type === normalizeString(STATE_STORE_EVENT_TYPES.PULL_REQUEST_RECORDED || 'PULL_REQUEST_RECORDED')
  || type === normalizeString(STATE_STORE_EVENT_TYPES.RESET || 'RESET')
  || type === normalizeString(STATE_STORE_EVENT_TYPES.EXTERNAL_STORAGE_SYNC || 'EXTERNAL_STORAGE_SYNC')) {
  broadcastStateChanged(type, workflow, {
    summary: stableObject(payload.summary),
    meta: stableObject(payload.meta),
    source: normalizeString(payload.source || '')
  });
}

}

function installStateStoreSubscription() {
if (runtimeState.stateStoreSubscriptionInstalled === true) {
return;
}

if (typeof stateStore.subscribe !== 'function') {
  return;
}

runtimeState.stateStoreUnsubscribe = stateStore.subscribe(function onStateStoreEvent(event) {
  void handleStateStoreEvent(event);
});
runtimeState.stateStoreSubscriptionInstalled = true;

}

async function initializeServiceWorker(options) {
ensureRuntimeState();

const source = isPlainObject(options) ? options : createNullObject();
const reason = normalizeString(source.reason || source.source) || 'initialize';

if (runtimeState.initialized === true && normalizeBoolean(source.forceRefresh, false) !== true) {
  return getBootstrapState();
}

if (runtimeState.initializingPromise && normalizeBoolean(source.forceRefresh, false) !== true) {
  return runtimeState.initializingPromise;
}

const promise = (async function initializeInternal() {
  const bootstrap = await ensureInitialized({
    forceRefresh: normalizeBoolean(source.forceRefresh, false),
    syncSelectedProvidersFromSettings: normalizeBoolean(source.syncSelectedProvidersFromSettings, false)
  });

  installStateStoreSubscription();

  runtimeState.initialized = true;
  runtimeState.bootCount += 1;
  runtimeState.readyAt = nowIsoString();
  runtimeState.lastInitReason = reason;
  runtimeState.lastDashboard = null;
  runtimeState.lastError = null;

  await appendEventLog('Service worker initialized.', 'SERVICE_WORKER_INITIALIZED', {
    reason: reason,
    bootCount: runtimeState.bootCount
  }, 'debug');

  return bootstrap;
}());

runtimeState.initializingPromise = promise;

try {
  return await promise;
} catch (error) {
  runtimeState.lastError = normalizeServiceWorkerError(error, 'Service worker initialization failed.');
  throw runtimeState.lastError;
} finally {
  runtimeState.initializingPromise = null;
}

}

async function ensureInitialized(options) {
if (typeof orchestrator.ensureInitialized === 'function') {
return orchestrator.ensureInitialized(options);
}

if (typeof stateStore.ensureInitialized === 'function') {
  return stateStore.ensureInitialized(options);
}

return createNullObject();

}

async function getBootstrapState(options) {
if (typeof orchestrator.getBootstrapState === 'function') {
return orchestrator.getBootstrapState(options);
}

if (typeof stateStore.getBootstrapState === 'function') {
  return stateStore.getBootstrapState(options);
}

return createNullObject();

}

async function getWorkflowState(options) {
if (typeof orchestrator.getWorkflowState === 'function') {
return orchestrator.getWorkflowState(options);
}

if (typeof stateStore.getWorkflowState === 'function') {
  return stateStore.getWorkflowState(options);
}

return normalizeWorkflowStateFromAny(DEFAULTS.workflow);

}

async function getEventLog(options) {
if (typeof orchestrator.getEventLog === 'function') {
return orchestrator.getEventLog(options);
}

if (typeof stateStore.getEventLog === 'function') {
  return stateStore.getEventLog(options);
}

return [];

}

function getLastSubmission() {
if (typeof orchestrator.getLastSubmission === 'function') {
  try {
    return orchestrator.getLastSubmission();
  } catch (error) {
  }
}

return null;

}

async function routeMessage(request, sender) {
const messageMeta = normalizeIncomingMessage(request, sender);
await initializeServiceWorker({
source: 'message',
syncSelectedProvidersFromSettings: false
});
return handleMessage(messageMeta);
}

function handleOnMessage(request, sender, sendResponse) {
if (request && request.__maoeBroadcast === true) {
return false;
}

if (!request || !normalizeString(request.type || request.messageType)) {
  return false;
}

void routeMessage(request, sender).then(function onResolved(data) {
  sendResponse(createOkResponse(normalizeIncomingMessage(request, sender), data));
}).catch(function onRejected(error) {
  sendResponse(createErrorResponse(normalizeIncomingMessage(request, sender), error));
});

return true;

}

function handleTabUpdated(tabId, changeInfo, tab) {
const normalizedTabId = normalizeIntegerOrNull(tabId);

if (normalizedTabId === null) {
  return;
}

const registry = ensureTabRegistry();
const existing = hasOwn(registry, String(normalizedTabId))
  ? registry[String(normalizedTabId)]
  : null;
const url = normalizeString(changeInfo && changeInfo.url || tab && tab.url);
const detected = detectSiteFromUrl(url);

if (!existing && !detected.providerId) {
  return;
}

const nextContext = normalizeTabContext(mergePlainObjects(
  stableObject(existing),
  {
    tabId: normalizedTabId,
    windowId: normalizeIntegerOrNull(tab && tab.windowId),
    title: normalizeString(tab && tab.title),
    url: url || normalizeString(existing && existing.url),
    siteId: detected.siteId || normalizeString(existing && existing.siteId),
    providerId: detected.providerId || normalizeString(existing && existing.providerId),
    displayName: detected.displayName || normalizeString(existing && existing.displayName),
    status: normalizeString(changeInfo && changeInfo.status || tab && tab.status || existing && existing.status),
    lastSeenAt: nowIsoString()
  }
));

registry[String(normalizedTabId)] = cloneValue(nextContext);

}

function installChromeListeners() {
if (runtimeState.listenersInstalled === true) {
return;
}

runtimeState.listenersInstalled = true;

if (typeof chrome !== 'undefined'
  && chrome.runtime
  && chrome.runtime.onInstalled
  && typeof chrome.runtime.onInstalled.addListener === 'function') {
  chrome.runtime.onInstalled.addListener(function onInstalled(details) {
    void initializeServiceWorker({
      source: 'onInstalled',
      reason: normalizeString(details && details.reason) || 'onInstalled'
    });
  });
}

if (typeof chrome !== 'undefined'
  && chrome.runtime
  && chrome.runtime.onStartup
  && typeof chrome.runtime.onStartup.addListener === 'function') {
  chrome.runtime.onStartup.addListener(function onStartup() {
    void initializeServiceWorker({
      source: 'onStartup',
      reason: 'onStartup'
    });
  });
}

if (typeof chrome !== 'undefined'
  && chrome.runtime
  && chrome.runtime.onMessage
  && typeof chrome.runtime.onMessage.addListener === 'function') {
  chrome.runtime.onMessage.addListener(handleOnMessage);
}

if (typeof chrome !== 'undefined'
  && chrome.tabs
  && chrome.tabs.onRemoved
  && typeof chrome.tabs.onRemoved.addListener === 'function') {
  chrome.tabs.onRemoved.addListener(function onTabRemoved(tabId) {
    removeTabContext(tabId);
  });
}

if (typeof chrome !== 'undefined'
  && chrome.tabs
  && chrome.tabs.onUpdated
  && typeof chrome.tabs.onUpdated.addListener === 'function') {
  chrome.tabs.onUpdated.addListener(handleTabUpdated);
}

try {
  globalScope.addEventListener('install', function onInstall() {
    void initializeServiceWorker({
      source: 'install',
      reason: 'install'
    });
  });
} catch (error) {
}

try {
  globalScope.addEventListener('activate', function onActivate() {
    void initializeServiceWorker({
      source: 'activate',
      reason: 'activate'
    });
  });
} catch (error) {
}

}

const api = {
initialize: initializeServiceWorker,
ensureInitialized: initializeServiceWorker,
routeMessage: routeMessage,
getBootstrapState: getBootstrapState,
getWorkflowState: getWorkflowState,
getEventLog: getEventLog,
getTabContexts: getTabContexts,
getTabContext: getTabContext,
clearCaches: clearCaches,
probeTab: probeTab,
fillPromptInTab: fillPromptInTab,
extractLatestResponseFromTab: extractLatestResponseFromTab,
buildManualPacket: buildManualPacket,
saveGithubSettings: saveGithubSettings,
helpers: deepFreeze({
normalizeIncomingMessage: normalizeIncomingMessage,
createOkResponse: createOkResponse,
createErrorResponse: createErrorResponse,
createBroadcastMessage: createBroadcastMessage,
detectSiteFromUrl: detectSiteFromUrl,
normalizeTabContext: normalizeTabContext,
upsertTabContextFromSender: upsertTabContextFromSender,
updateTabCapture: updateTabCapture,
buildIssueListCacheKey: buildIssueListCacheKey,
buildTreeCacheKey: buildTreeCacheKey,
normalizeIssueListQuerySnapshot: normalizeIssueListQuerySnapshot,
normalizeServiceWorkerError: normalizeServiceWorkerError,
createOrchestratorError: createOrchestratorError,
isServiceWorkerError: isServiceWorkerError,
buildRepositoryDescriptor: buildRepositoryDescriptor,
buildRepositoryUrls: buildRepositoryUrls,
normalizeIssueInput: normalizeIssueInput,
normalizeIssueRef: normalizeIssueRef,
normalizePullRequestRef: normalizePullRequestRef,
normalizeWorkflowStateFromAny: normalizeWorkflowStateFromAny,
normalizeSelectedProviderIds: normalizeSelectedProviderIds,
resolveProviderForRole: resolveProviderForRole,
inferRoleFromStage: inferRoleFromStage,
nextStageAfter: nextStageAfter,
normalizeTaskFilePath: normalizeTaskFilePath,
normalizeGitRef: normalizeGitRef,
normalizeReviewDecision: normalizeReviewDecision,
normalizeLastParsedPayloadRecord: normalizeLastParsedPayloadRecord,
buildSuggestedWorkingBranch: buildSuggestedWorkingBranch,
previewPayloadForStage: previewPayloadForStage,
extractTargetFileFromDesignText: orchestrator.helpers && orchestrator.helpers.extractTargetFileFromDesignText
? orchestrator.helpers.extractTargetFileFromDesignText
: function fallbackExtractTargetFile(text, options) {
return '';
},
parseExecutionSubmission: orchestrator.helpers && orchestrator.helpers.parseExecutionSubmission
? orchestrator.helpers.parseExecutionSubmission
: function fallbackParseExecution() {
return {
ok: false,
errors: []
};
},
parseAuditSubmission: orchestrator.helpers && orchestrator.helpers.parseAuditSubmission
? orchestrator.helpers.parseAuditSubmission
: function fallbackParseAudit() {
return {
ok: false,
errors: []
};
},
parsePullRequestReference: orchestrator.helpers && orchestrator.helpers.parsePullRequestReference
? orchestrator.helpers.parsePullRequestReference
: function fallbackParsePullRequestReference() {
return null;
}
})
};

installChromeListeners();
void initializeServiceWorker({
source: 'module_load',
reason: 'module_load'
});

try {
logger.debug('Service worker module registered.', {
protocolVersion: DEFAULT_PROTOCOL_VERSION,
messageTypeCount: Object.keys(MESSAGE_TYPES).length,
providerCount: PROVIDER_IDS.length
});
} catch (error) {
}

root.registerValue('service_worker', deepFreeze(api), {
overwrite: false,
freeze: false,
clone: false
});
}(typeof globalThis !== 'undefined'
? globalThis
: (typeof self !== 'undefined'
? self
: (typeof window !== 'undefined' ? window : this))));
