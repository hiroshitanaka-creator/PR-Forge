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
