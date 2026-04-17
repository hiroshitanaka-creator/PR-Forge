(function registerMAOEPopup(globalScope) {
'use strict';

const root = globalScope.MAOE;

if (!root || typeof root.registerValue !== 'function') {
throw new Error('[MAOE] namespace.js must be loaded before popup.js.');
}

if (root.has('popup')) {
return;
}

function bindGlobalControls() {
const dom = getDom();

dom.dismissGlobalErrorButton.addEventListener('click', function onDismissGlobalErrorClick() {
  clearErrorBanner();
  showStatus('info', runtimeState.lastStatusText || 'Ready.');
  announce('Error dismissed.');
});

}

function bindRepositoryControls() {
const dom = getDom();

dom.loadRepoTreeButton.addEventListener('click', function onLoadRepoTreeClick() {
  void withErrorHandling(function execute() {
    return loadRepositoryTree({
      refreshTree: true,
      successText: 'Repository tree loaded.'
    });
  }, 'Failed to load repository tree.');
});

dom.treePathPrefixInput.addEventListener('input', function onTreePathPrefixInput() {
  runtimeState.dirty.treePathPrefix = true;
});

dom.treePathPrefixInput.addEventListener('keydown', function onTreePathPrefixKeydown(event) {
  if (event.key !== 'Enter') {
    return;
  }

  event.preventDefault();

  void withErrorHandling(function execute() {
    return loadRepositoryTree({
      refreshTree: true,
      successText: 'Repository tree loaded.'
    });
  }, 'Failed to load repository tree.');
});

}

function bindIssueControls() {
const dom = getDom();

dom.loadIssuesButton.addEventListener('click', function onLoadIssuesClick() {
  void withErrorHandling(function execute() {
    return loadIssues({
      refreshIssues: false,
      autoPaginate: true,
      successText: 'Issues loaded.'
    });
  }, 'Failed to load issues.');
});

dom.refreshIssuesButton.addEventListener('click', function onRefreshIssuesClick() {
  void withErrorHandling(function execute() {
    return loadIssues({
      refreshIssues: true,
      autoPaginate: true,
      successText: 'Issues refreshed.'
    });
  }, 'Failed to refresh issues.');
});

dom.issueFilterInput.addEventListener('input', function onIssueFilterInput() {
  updateIssueFilter(dom.issueFilterInput.value, {
    persist: true
  });
});

dom.issuesTableBody.addEventListener('change', function onIssuesTableBodyChange(event) {
  const target = event.target;

  if (!target || typeof target.closest !== 'function') {
    return;
  }

  const radio = target.closest('.issue-select-radio');

  if (!radio) {
    return;
  }

  setSelectedIssueNumber(radio.value);
});

dom.issuesTableBody.addEventListener('click', function onIssuesTableBodyClick(event) {
  const target = event.target;

  if (!target || typeof target.closest !== 'function') {
    return;
  }

  const row = target.closest('.issue-row');

  if (!row) {
    return;
  }

  const radio = row.querySelector('.issue-select-radio');

  if (!radio) {
    return;
  }

  radio.checked = true;
  setSelectedIssueNumber(radio.value);
});

dom.selectedTargetFileInput.addEventListener('input', function onSelectedTargetFileInput() {
  runtimeState.dirty.targetFile = true;
});

dom.selectIssueButton.addEventListener('click', function onSelectIssueClick() {
  void withErrorHandling(applyIssueSelection, 'Failed to apply selected issue.');
});

dom.buildDesignArtifactButton.addEventListener('click', function onBuildDesignArtifactClick() {
  void withErrorHandling(buildDesignArtifact, 'Failed to build design artifact.');
});

}

function bindStageArtifactControls() {
const dom = getDom();

dom.probeActiveTabButton.addEventListener('click', function onProbeActiveTabClick() {
  void withErrorHandling(probeActiveTab, 'Failed to probe active tab.');
});

dom.sendPromptToActiveTabButton.addEventListener('click', function onSendPromptToActiveTabClick() {
  void withErrorHandling(function execute() {
    return sendPromptToTab(null);
  }, 'Failed to send prompt to the active tab.');
});

dom.copyStageArtifactPromptButton.addEventListener('click', function onCopyStageArtifactPromptClick() {
  void withErrorHandling(copyStageArtifactPrompt, 'Failed to copy prompt.');
});

dom.buildManualPacketFromArtifactButton.addEventListener('click', function onBuildManualPacketFromArtifactClick() {
  void withErrorHandling(buildCurrentManualPacket, 'Failed to build manual packet from artifact.');
});

dom.copyStageArtifactPacketButton.addEventListener('click', function onCopyStageArtifactPacketClick() {
  void withErrorHandling(copyStageArtifactPacket, 'Failed to copy packet.');
});

dom.copyStageArtifactBothButton.addEventListener('click', function onCopyStageArtifactBothClick() {
  void withErrorHandling(copyStageArtifactBoth, 'Failed to copy prompt and packet.');
});

}

async function probeTab(tabId) {
return runBusy('probeTab', 'Probing AI tab...', async function runProbeTab() {
  const response = await sendBackgroundMessage(MESSAGE_TYPES.CONTENT_PROBE, {
    tabId: normalizeIntegerOrNull(tabId),
    reason: 'popup_probe'
  });

  if (response && response.tabContext) {
    updateTabContextLocal(response.tabContext);
  }

  renderTabContexts();
  clearErrorBanner();
  showStatus('success', 'Tab probe completed.');
  announce('Tab probe completed.');
  return response;
});

}

function bindTabContextControls() {
const dom = getDom();

dom.refreshTabContextsButton.addEventListener('click', function onRefreshTabContextsClick() {
  void withErrorHandling(refreshTabContexts, 'Failed to refresh AI tabs.');
});

dom.tabContextList.addEventListener('click', function onTabContextListClick(event) {
  const target = event.target;

  if (!target || typeof target.closest !== 'function') {
    return;
  }

  const probeButton = target.closest('.tab-probe-button');
  const sendPromptButton = target.closest('.tab-send-prompt-button');
  const extractButton = target.closest('.tab-extract-button');

  if (!probeButton && !sendPromptButton && !extractButton) {
    return;
  }

  const sourceButton = probeButton || sendPromptButton || extractButton;
  const tabId = normalizeIntegerOrNull(sourceButton && sourceButton.dataset && sourceButton.dataset.tabId);

  if (probeButton) {
    void withErrorHandling(function execute() {
      return probeTab(tabId);
    }, 'Failed to probe AI tab.');
    return;
  }

  if (sendPromptButton) {
    void withErrorHandling(function execute() {
      return sendPromptToTab(tabId);
    }, 'Failed to send prompt to AI tab.');
    return;
  }

  if (extractButton) {
    void withErrorHandling(function execute() {
      return extractLatestResponse(tabId, getDom().manualResponseAutoSubmitCheckbox.checked);
    }, 'Failed to extract latest AI response.');
  }
});

}

function bindEventLogControls() {
const dom = getDom();

dom.refreshEventLogButton.addEventListener('click', function onRefreshEventLogClick() {
  void withErrorHandling(function execute() {
    return refreshEventLog({
      successText: 'Event log refreshed.'
    });
  }, 'Failed to refresh event log.');
});

dom.showDebugLogCheckbox.addEventListener('change', function onShowDebugLogChange() {
  updateShowDebugLog(dom.showDebugLogCheckbox.checked, {
    persist: true
  });
});

}

function bindSettingsControls() {
const dom = getDom();

dom.settingsForm.addEventListener('submit', function onSettingsSubmit(event) {
  event.preventDefault();

  const submitter = event.submitter && event.submitter.id ? event.submitter.id : '';

  if (submitter === 'save-github-settings-button') {
    void withErrorHandling(function execute() {
      return saveGithubSettings(false, false);
    }, 'Failed to save GitHub settings.');
    return;
  }

  void withErrorHandling(function execute() {
    return saveGithubSettings(false, true);
  }, 'Failed to save settings.');
});

dom.validateGitHubButton.addEventListener('click', function onValidateGitHubClick() {
  void withErrorHandling(validateGitHubToken, 'Failed to validate GitHub token.');
});

dom.clearGitHubTokenButton.addEventListener('click', function onClearGitHubTokenClick() {
  void withErrorHandling(clearGitHubToken, 'Failed to clear GitHub token.');
});

dom.reloadBootstrapButton.addEventListener('click', function onReloadBootstrapClick() {
  void withErrorHandling(function execute() {
    return refreshBootstrap({
      successText: 'Extension state refreshed.'
    });
  }, 'Failed to reload extension state.');
});

dom.settingsShowDebugLogCheckbox.addEventListener('change', function onSettingsShowDebugLogChange() {
  updateShowDebugLog(dom.settingsShowDebugLogCheckbox.checked, {
    persist: true
  });
});

dom.settingsIncludeIssueBodyCheckbox.addEventListener('change', function onIncludeIssueBodyChange() {
  updateTransientPreferences({
    includeIssueBody: dom.settingsIncludeIssueBodyCheckbox.checked
  }, {
    persist: true
  });
});

dom.settingsIncludeTreeCheckbox.addEventListener('change', function onIncludeTreeChange() {
  updateTransientPreferences({
    includeTree: dom.settingsIncludeTreeCheckbox.checked
  }, {
    persist: true
  });
});

}

function bindManualHubControls() {
const dom = getDom();

dom.buildManualPacketButton.addEventListener('click', function onBuildManualPacketClick() {
  void withErrorHandling(buildCurrentManualPacket, 'Failed to build manual packet.');
});

dom.copyManualPacketButton.addEventListener('click', function onCopyManualPacketClick() {
  void withErrorHandling(copyManualPacket, 'Failed to copy manual packet.');
});

dom.validateManualPacketButton.addEventListener('click', function onValidateManualPacketClick() {
  void withErrorHandling(validateManualPacket, 'Failed to validate manual packet.');
});

dom.copyManualHubPacketButton.addEventListener('click', function onCopyManualHubPacketClick() {
  void withErrorHandling(copyManualPacket, 'Failed to copy outgoing packet.');
});

dom.manualHubPacketTypeSelect.addEventListener('change', function onManualHubPacketTypeChange() {
  runtimeState.manualHub.lastPacketType = normalizeString(dom.manualHubPacketTypeSelect.value);
  runtimeState.dirty.manualPacket = true;

  void persistManualHubState({
    lastPacketType: runtimeState.manualHub.lastPacketType,
    lastPacketText: coerceText(dom.manualHubPacketTextarea.value),
    clipboardFormat: runtimeState.manualHub.clipboardFormat
  });
});

dom.manualHubPacketTextarea.addEventListener('input', function onManualHubPacketInput() {
  updateManualPacketText(dom.manualHubPacketTextarea.value, {
    persist: true,
    dirty: true
  });
});

dom.manualResponseTextarea.addEventListener('input', function onManualResponseInput() {
  updateManualResponseText(dom.manualResponseTextarea.value, {
    persist: true,
    dirty: true
  });
});

dom.extractFromActiveTabButton.addEventListener('click', function onExtractFromActiveTabClick() {
  void withErrorHandling(function execute() {
    return extractLatestResponse(null, dom.manualResponseAutoSubmitCheckbox.checked);
  }, 'Failed to extract latest response from the active tab.');
});

dom.previewManualResponseButton.addEventListener('click', function onPreviewManualResponseClick() {
  void withErrorHandling(previewManualResponse, 'Failed to preview manual response.');
});

dom.submitManualResponseButton.addEventListener('click', function onSubmitManualResponseClick() {
  void withErrorHandling(submitManualResponse, 'Failed to submit manual response.');
});

dom.submitManualResponseConfirmButton.addEventListener('click', function onSubmitManualResponseConfirmClick() {
  void withErrorHandling(submitManualResponse, 'Failed to apply manual response to workflow.');
});

dom.manualApplyStageStateButton.addEventListener('click', function onManualApplyStageStateClick() {
  void withErrorHandling(applyManualStageState, 'Failed to apply manual stage/status.');
});

dom.manualMarkReadyButton.addEventListener('click', function onManualMarkReadyClick() {
  void withErrorHandling(function execute() {
    return markCurrentStageStatus(STATUS_READY);
  }, 'Failed to mark the workflow ready.');
});

dom.manualMarkInProgressButton.addEventListener('click', function onManualMarkInProgressClick() {
  void withErrorHandling(function execute() {
    return markCurrentStageStatus(STATUS_IN_PROGRESS);
  }, 'Failed to mark the workflow in progress.');
});

dom.manualMarkAwaitHumanButton.addEventListener('click', function onManualMarkAwaitHumanClick() {
  void withErrorHandling(function execute() {
    return markCurrentStageStatus(STATUS_AWAITING_HUMAN);
  }, 'Failed to mark the workflow as awaiting human action.');
});

dom.manualMarkApprovedButton.addEventListener('click', function onManualMarkApprovedClick() {
  void withErrorHandling(function execute() {
    return markCurrentStageStatus(STATUS_APPROVED);
  }, 'Failed to mark the workflow approved.');
});

dom.manualMarkRejectedButton.addEventListener('click', function onManualMarkRejectedClick() {
  void withErrorHandling(function execute() {
    return markCurrentStageStatus(STATUS_REJECTED);
  }, 'Failed to mark the workflow rejected.');
});

dom.manualMarkCompletedButton.addEventListener('click', function onManualMarkCompletedClick() {
  void withErrorHandling(function execute() {
    return markCurrentStageStatus(STATUS_COMPLETED);
  }, 'Failed to mark the workflow completed.');
});

dom.manualClearErrorButton.addEventListener('click', function onManualClearErrorClick() {
  void withErrorHandling(clearWorkflowError, 'Failed to clear the workflow error.');
});

}

function bindAllControls() {
if (runtimeState.bindingsInstalled === true) {
  return;
}

bindGlobalControls();
bindTabButtons();
bindWorkflowControls();
bindRepositoryControls();
bindIssueControls();
bindStageArtifactControls();
bindTabContextControls();
bindEventLogControls();
bindSettingsControls();
bindManualHubControls();

runtimeState.bindingsInstalled = true;

}

async function initializePopup() {
ensureRuntimeState();

if (runtimeState.initialized === true) {
  renderAll();
  return runtimeState;
}

if (runtimeState.initializingPromise) {
  return runtimeState.initializingPromise;
}

runtimeState.initializingPromise = (async function runInitializePopup() {
  getDom();
  bindAllControls();
  installRuntimeMessageListener();
  clearErrorBanner();
  renderAll();
  showStatus('info', 'Loading extension state...');

  if (typeof storage.initializeDefaults === 'function') {
    try {
      await storage.initializeDefaults({
        area: STORAGE_AREA_LOCAL
      });
    } catch (error) {
      logger.warn('Failed to initialize popup storage defaults.', {
        message: error && error.message ? error.message : String(error)
      });
    }
  }

  runtimeState.transientPreferences = await loadTransientPreferences();
  renderSettings();
  renderManualHub();

  await refreshBootstrap({
    statusText: 'Loading extension state...',
    successText: 'Extension state loaded.',
    announceText: 'Extension state loaded.'
  });

  initializeFormDefaultsFromBootstrap();
  renderAll();

  runtimeState.initialized = true;
  return runtimeState;
}()).catch(function handleInitializationError(error) {
  const normalized = normalizePopupError(error, 'Failed to initialize popup.');
  runtimeState.lastError = cloneValue(normalized);
  showErrorBanner(normalized);
  showStatus('error', normalized.message);
  announce(normalized.message);
  logger.error('Popup initialization failed.', {
    code: normalized.code,
    message: normalized.message,
    details: cloneValue(normalized.details)
  });
  throw normalized;
}).finally(function clearInitializingPromise() {
  runtimeState.initializingPromise = null;
});

return runtimeState.initializingPromise;

}

function startPopup() {
void initializePopup().catch(function ignoreInitializationError() {
});
}

const popupApi = deepFreeze({
initialize: initializePopup,
refreshBootstrap: refreshBootstrap,
refreshWorkflow: refreshWorkflow,
refreshEventLog: refreshEventLog,
loadIssues: loadIssues,
loadRepositoryTree: loadRepositoryTree,
applyIssueSelection: applyIssueSelection,
buildCurrentArtifact: buildCurrentArtifact,
buildDesignArtifact: buildDesignArtifact,
advanceStage: advanceStage,
resetWorkflow: resetWorkflow,
clearWorkflowError: clearWorkflowError,
createPullRequestNow: createPullRequestNow,
previewManualResponseResult: previewManualResponseResult,
getRuntimeState: function getRuntimeState() {
  return cloneValue(runtimeState);
}
});

root.registerValue('popup', popupApi, {
overwrite: false,
freeze: false,
clone: false
});

if (globalScope.document && globalScope.document.readyState === 'loading') {
globalScope.document.addEventListener('DOMContentLoaded', startPopup, {
  once: true
});
} else {
startPopup();
}

}(typeof globalThis !== 'undefined'
  ? globalThis
  : (typeof self !== 'undefined'
    ? self
    : (typeof window !== 'undefined' ? window : this))));