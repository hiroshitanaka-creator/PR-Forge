const MAOE = global.MAOE = global.MAOE || {};
MAOE.content = MAOE.content || {};
MAOE.content.common = MAOE.content.common || {};
MAOE.parsers = MAOE.parsers || {};
if (MAOE.content.common.humanHubBridge) {
return;
}

const protocol = MAOE.protocol || {};
const constants = MAOE.constants || {};
const sites = constants.SITES || constants.AI_SITES || {};

const ACTIONS = Object.freeze({
CONTENT_READY: (protocol.MESSAGE_TYPES && protocol.MESSAGE_TYPES.CONTENT_READY) || 'MAOE/CONTENT_READY',
GET_WORK_CONTEXT: (protocol.MESSAGE_TYPES && protocol.MESSAGE_TYPES.GET_WORK_CONTEXT) || 'MAOE/GET_WORK_CONTEXT',
SAVE_PACKET: (protocol.MESSAGE_TYPES && protocol.MESSAGE_TYPES.HUMAN_HUB_PACKET_SAVE) || 'MAOE/HUMAN_HUB/SAVE_PACKET',
SUBMIT_RESULT: (protocol.MESSAGE_TYPES && protocol.MESSAGE_TYPES.HUMAN_HUB_RESULT_SUBMIT) || 'MAOE/HUMAN_HUB/SUBMIT_RESULT',
COMMAND: (protocol.MESSAGE_TYPES && protocol.MESSAGE_TYPES.HUMAN_HUB_COMMAND) || 'MAOE/HUMAN_HUB/COMMAND',
BUILD_PACKET: (protocol.MESSAGE_TYPES && protocol.MESSAGE_TYPES.HUMAN_HUB_BUILD_PACKET) || 'MAOE/HUMAN_HUB/BUILD_PACKET',
COPY_PACKET: (protocol.MESSAGE_TYPES && protocol.MESSAGE_TYPES.HUMAN_HUB_COPY_PACKET) || 'MAOE/HUMAN_HUB/COPY_PACKET',
COPY_PROMPT: (protocol.MESSAGE_TYPES && protocol.MESSAGE_TYPES.HUMAN_HUB_COPY_PROMPT) || 'MAOE/HUMAN_HUB/COPY_PROMPT',
STAGE_PROMPT: (protocol.MESSAGE_TYPES && protocol.MESSAGE_TYPES.HUMAN_HUB_STAGE_PROMPT) || 'MAOE/HUMAN_HUB/STAGE_PROMPT',
IMPORT_PACKET_TEXT: (protocol.MESSAGE_TYPES && protocol.MESSAGE_TYPES.HUMAN_HUB_IMPORT_PACKET_TEXT) || 'MAOE/HUMAN_HUB/IMPORT_PACKET_TEXT',
EXTRACT_TEXT: (protocol.MESSAGE_TYPES && protocol.MESSAGE_TYPES.HUMAN_HUB_EXTRACT_TEXT) || 'MAOE/HUMAN_HUB/EXTRACT_TEXT',
CAPTURE_AND_SUBMIT: (protocol.MESSAGE_TYPES && protocol.MESSAGE_TYPES.HUMAN_HUB_CAPTURE_AND_SUBMIT) || 'MAOE/HUMAN_HUB/CAPTURE_AND_SUBMIT',
GET_STATUS: (protocol.MESSAGE_TYPES && protocol.MESSAGE_TYPES.HUMAN_HUB_GET_STATUS) || 'MAOE/HUMAN_HUB/GET_STATUS'
});

const EVENTS = Object.freeze({
READY: 'maoe:human-hub:ready',
PACKET_READY: 'maoe:human-hub:packet-ready',
PACKET_COPIED: 'maoe:human-hub:packet-copied',
PROMPT_STAGED: 'maoe:human-hub:prompt-staged',
RESULT_READY: 'maoe:human-hub:result-ready',
RESULT_SUBMITTED: 'maoe:human-hub:result-submitted',
ERROR: 'maoe:human-hub:error'
});

const CHANNELS = Object.freeze({
GENERIC: 'generic',
EXECUTOR: 'executor',
AUDITOR: 'auditor',
DESIGNER: 'designer'
});

const VERDICTS = Object.freeze({ APPROVE: 'APPROVE', REJECT: 'REJECT' });

const DEFAULTS = Object.freeze({
extensionName: constants.EXTENSION_NAME || 'MAOE',
schemaVersion: constants.SCHEMA_VERSION || protocol.SCHEMA_VERSION || '1.0.0',
packetSchema: 'maoe.human_hub.packet',
resultSchema: 'maoe.human_hub.result',
transportFormat: 'json',
autoNotifyReady: true,
autoPersistPacket: true,
autoSubmitCapture: true,
allowBodyFallbackRead: true,
previewLimit: 1000
});

function logger() {
const fallback = function level(method) {
return function emit() {
if (!global.console || typeof global.console[method] !== 'function') {
return;
}
const args = Array.prototype.slice.call(arguments);
global.console[method].apply(global.console, ['[content/common/human_hub_bridge]'].concat(args));
};
};
if (MAOE.logger) {
if (typeof MAOE.logger.create === 'function') {
return MAOE.logger.create('content/common/human_hub_bridge');
}
if (typeof MAOE.logger.getLogger === 'function') {
return MAOE.logger.getLogger('content/common/human_hub_bridge');
}
if (typeof MAOE.logger.info === 'function') {
return MAOE.logger;
}
}
return { debug: fallback('debug'), info: fallback('info'), warn: fallback('warn'), error: fallback('error') };
}

const log = logger();

function str(v, d) {
if (typeof v === 'string') return v;
if (v === undefined || v === null) return typeof d === 'string' ? d : '';
return String(v);
}

function trim(v, d) {
return str(v, d).trim();
}

function arr(v) {
if (Array.isArray(v)) return v;
if (v === undefined || v === null) return [];
return [v];
}

function obj(v) {
return Object.prototype.toString.call(v) === '[object Object]';
}

function clone(v) {
if (v === null || typeof v !== 'object') return v;
if (Array.isArray(v)) return v.map(clone);
const out = {};
const keys = Object.keys(v);
for (let i = 0; i < keys.length; i += 1) out[keys[i]] = clone(v[keys[i]]);
return out;
}

function sortClone(v) {
if (v === null || typeof v !== 'object') return v;
if (Array.isArray(v)) return v.map(sortClone);
const out = {};
const keys = Object.keys(v).sort();
for (let i = 0; i < keys.length; i += 1) out[keys[i]] = sortClone(v[keys[i]]);
return out;
}

function stable(v) {
return JSON.stringify(sortClone(v));
}

function line(v) {
return str(v).replace(/\r\n?/g, '\n');
}

function preview(v, max) {
const t = trim(v);
return t.length <= max ? t : t.slice(0, max) + '…';
}

function uniq(v) {
const seen = new Set();
const out = [];
const items = arr(v);
for (let i = 0; i < items.length; i += 1) {
const s = trim(items[i]);
if (!s || seen.has(s)) continue;
seen.add(s);
out.push(s);
}
return out;
}

function fnv1a(text) {
let h = 0x811c9dc5;
const s = str(text);
for (let i = 0; i < s.length; i += 1) {
h ^= s.charCodeAt(i);
h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
}
return (h >>> 0).toString(16).padStart(8, '0');
}

function checksum(payload) {
return fnv1a(stable(payload));
}

function withChecksum(payload) {
const out = clone(payload);
delete out.checksum;
out.checksum = checksum(out);
return out;
}

function nowIso() {
return new Date().toISOString();
}

function uid(prefix) {
if (global.crypto && typeof global.crypto.randomUUID === 'function') {
return prefix + '*' + global.crypto.randomUUID();
}
return prefix + '*' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

function redact(v) {
if (typeof v !== 'string') return v;
return v
.replace(/ghp_[A-Za-z0-9_]{20,}/g, '[REDACTED_GITHUB_PAT]')
.replace(/github_pat_[A-Za-z0-9_]{20,}/g, '[REDACTED_GITHUB_FINE_GRAINED_PAT]');
}

function siteId(hostname) {
const host = (hostname || (global.location && global.location.hostname) || '').toLowerCase();
if (host.indexOf('chatgpt.com') >= 0 || host.indexOf('chat.openai.com') >= 0) return sites.CHATGPT || 'chatgpt';
if (host.indexOf('claude.ai') >= 0) return sites.CLAUDE || 'claude';
if (host.indexOf('gemini.google.com') >= 0) return sites.GEMINI || 'gemini';
if (host.indexOf('grok.com') >= 0) return sites.GROK || 'grok';
return sites.UNKNOWN || 'unknown';
}

function title() {
return global.document && typeof global.document.title === 'string' ? global.document.title : '';
}

function href() {
return global.location && typeof global.location.href === 'string' ? global.location.href : '';
}

function findAdapter(adapter, names) {
if (!adapter) return null;
const list = arr(names);
for (let i = 0; i < list.length; i += 1) {
const name = list[i];
if (!name) continue;
if (adapter[name] !== undefined) return { name: name, member: adapter[name] };
}
return null;
}

function callAdapter(adapter, names) {
const hit = findAdapter(adapter, names);
if (!hit) return undefined;
const args = Array.prototype.slice.call(arguments, 2);
if (typeof hit.member === 'function') return hit.member.apply(adapter, args);
return args.length === 0 ? hit.member : undefined;
}

function asPromise(v) {
return Promise.resolve(v);
}

function event(name, detail) {
try {
if (typeof global.CustomEvent !== 'function' || typeof global.dispatchEvent !== 'function') return false;
global.dispatchEvent(new global.CustomEvent(name, { detail: detail }));
return true;
} catch (e) {
log.warn('custom_event_failed', redact(e && e.message));
return false;
}
}

function send(message) {
if (!global.chrome || !global.chrome.runtime || typeof global.chrome.runtime.sendMessage !== 'function') {
return Promise.resolve({ ok: false, error: 'runtime_unavailable' });
}
return new Promise(function resolveMessage(resolve) {
try {
global.chrome.runtime.sendMessage(message, function onResponse(response) {
const err = global.chrome.runtime.lastError;
if (err) {
resolve({ ok: false, error: err.message || 'runtime_error' });
return;
}
resolve(response || { ok: true });
});
} catch (e) {
resolve({ ok: false, error: e && e.message ? e.message : 'runtime_send_failed' });
}
});
}

async function copy(text) {
const value = str(text);
if (global.navigator && global.navigator.clipboard && typeof global.navigator.clipboard.writeText === 'function') {
try {
await global.navigator.clipboard.writeText(value);
return true;
} catch (e) {
log.warn('clipboard_write_failed', redact(e && e.message));
}
}
try {
if (!global.document || !global.document.body || typeof global.document.createElement !== 'function') return false;
const el = global.document.createElement('textarea');
el.value = value;
el.setAttribute('readonly', 'readonly');
el.style.position = 'fixed';
el.style.top = '-9999px';
el.style.left = '-9999px';
global.document.body.appendChild(el);
el.focus();
el.select();
const ok = typeof global.document.execCommand === 'function' ? global.document.execCommand('copy') : false;
global.document.body.removeChild(el);
return !!ok;
} catch (e) {
log.warn('clipboard_fallback_failed', redact(e && e.message));
return false;
}
}

function safeJson(text) {
try {
return { ok: true, value: JSON.parse(text) };
} catch (e) {
return { ok: false, error: e };
}
}

function escapeXml(text) {
return str(text)
.replace(/&/g, '&amp;')
.replace(/</g, '&lt;')
.replace(/>/g, '&gt;')
.replace(/"/g, '&quot;')
.replace(/'/g, '&apos;');
}

function tag(name) {
const t = trim(name || 'item').replace(/[^A-Za-z0-9_.-]/g, '*');
return /^[A-Za-z*]/.test(t) ? t : '_' + t;
}

function cdata(text) {
return line(text).replace(new RegExp('\]\]' + '>', 'g'), ']]' + ']]' + '>' + '<![CDATA[');
}

function xmlNode(name, value, indent) {
const t = tag(name);
const pad = indent || '';
const inPad = pad + '  ';
if (value === undefined || value === null) return pad + '<' + t + '/>';
if (typeof value === 'string') return pad + '<' + t + '><![CDATA[' + cdata(value) + ']]' + '>' + '</' + t + '>';
if (typeof value === 'number' || typeof value === 'boolean') return pad + '<' + t + '>' + escapeXml(String(value)) + '</' + t + '>';
if (Array.isArray(value)) {
if (!value.length) return pad + '<' + t + '/>';
return pad + '<' + t + '>\n' + value.map(function mapItem(item) { return xmlNode('item', item, inPad); }).join('\n') + '\n' + pad + '</' + t + '>';
}
const keys = Object.keys(value);
if (!keys.length) return pad + '<' + t + '/>';
return pad + '<' + t + '>\n' + keys.map(function mapKey(k) { return xmlNode(k, value[k], inPad); }).join('\n') + '\n' + pad + '</' + t + '>';
}

function fencedBlocks(text) {
const api = MAOE.parsers.fencedBlockParser || MAOE.fencedBlockParser || {};
try {
if (typeof api.extractAllBlocks === 'function') return arr(api.extractAllBlocks(text));
if (typeof api.extractBlocks === 'function') return arr(api.extractBlocks(text));
} catch (e) {
log.warn('fenced_block_parser_failed', redact(e && e.message));
}
const blocks = [];
const re = /```([A-Za-z0-9_+.-]*)\n([\s\S]*?)```/g;
let m;
const src = line(text);
while ((m = re.exec(src)) !== null) {
blocks.push({ language: trim(m[1]).toLowerCase(), content: m[2], raw: m[0], start: m.index, end: re.lastIndex });
}
return blocks;
}

function xmlFiles(text) {
const out = [];
const re = new RegExp('<File\\s+path="([^\\"]+)"\\s*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>' + '\\s*<\\/File>', 'g');
let m;
const src = line(text);
while ((m = re.exec(src)) !== null) {
out.push({ path: trim(m[1]), code: m[2], raw: m[0], start: m.index, end: re.lastIndex });
}
return out;
}

function firstJson(text) {
const direct = safeJson(trim(text));
if (direct.ok && (obj(direct.value) || Array.isArray(direct.value))) return direct.value;
const blocks = fencedBlocks(text);
for (let i = 0; i < blocks.length; i += 1) {
const b = blocks[i];
if (b.language !== 'json' && b.language !== 'js' && b.language !== 'javascript') continue;
const parsed = safeJson(trim(b.content));
if (parsed.ok && (obj(parsed.value) || Array.isArray(parsed.value))) return parsed.value;
}
return null;
}

function firstDiff(text) {
const blocks = fencedBlocks(text);
for (let i = 0; i < blocks.length; i += 1) {
const b = blocks[i];
if (b.language === 'diff' || /^(---|\+\+\+|@@)/m.test(b.content)) return line(b.content);
}
return null;
}

function verdictValue(value) {
const t = trim(value).toUpperCase();
if (t === VERDICTS.APPROVE) return VERDICTS.APPROVE;
if (t === VERDICTS.REJECT) return VERDICTS.REJECT;
return null;
}

function verdict(text, json) {
if (obj(json)) {
const decision = verdictValue(json.decision || json.verdict || (json.audit && (json.audit.decision || json.audit.verdict)));
if (decision) {
return {
decision: decision,
reason: trim(json.reason || json.message || json.summary || (json.audit && json.audit.reason)) || null,
source: 'json'
};
}
}
const xmlMatch = line(text).match(/<Verdict\s+decision="(APPROVE|REJECT)"\s*>([\s\S]*?)<\/Verdict>/i);
if (xmlMatch) return { decision: verdictValue(xmlMatch[1]), reason: trim(xmlMatch[2]) || null, source: 'xml' };
const textMatch = line(text).match(/(?:^|\n)\s*(APPROVE|REJECT)\s*(?::|-)?\s*(.*?)(?:\n|$)/i);
if (textMatch) return { decision: verdictValue(textMatch[1]), reason: trim(textMatch[2]) || null, source: 'text' };
return { decision: null, reason: null, source: null };
}

function labels(value) {
return arr(value).reduce(function reduceLabels(out, item) {
if (typeof item === 'string') {
const name = trim(item);
if (name) out.push({ name: name });
return out;
}
if (obj(item) && trim(item.name)) {
out.push({ name: trim(item.name), color: trim(item.color), description: trim(item.description) });
}
return out;
}, []);
}

function repo(value) {
const v = obj(value) ? value : {};
const fullName = trim(v.fullName || v.full_name || (trim(v.owner) && trim(v.name) ? trim(v.owner) + '/' + trim(v.name) : ''));
const parts = fullName ? fullName.split('/') : [];
return {
owner: trim(v.owner) || (parts[0] || ''),
name: trim(v.name) || (parts[1] || ''),
fullName: fullName,
defaultBranch: trim(v.defaultBranch || v.default_branch),
baseBranch: trim(v.baseBranch || v.base_branch),
headBranch: trim(v.headBranch || v.head_branch),
url: trim(v.url || v.html_url || v.htmlUrl)
};
}

function issue(value) {
const v = obj(value) ? value : {};
const n = v.number === '' || v.number === undefined || v.number === null ? null : Number(v.number);
return {
number: Number.isFinite(n) ? n : null,
title: trim(v.title),
body: trim(v.body),
state: trim(v.state),
url: trim(v.url || v.html_url || v.htmlUrl),
labels: labels(v.labels)
};
}

function task(value) {
const v = obj(value) ? value : {};
return {
id: trim(v.id || v.taskId),
title: trim(v.title),
description: trim(v.description || v.body),
acceptanceCriteria: uniq(v.acceptanceCriteria || v.acceptance_criteria || v.criteria)
};
}

function workflow(value) {
const v = obj(value) ? value : {};
const n = v.issueNumber === '' || v.issueNumber === undefined || v.issueNumber === null ? null : Number(v.issueNumber);
return {
sessionId: trim(v.sessionId || v.session_id),
runId: trim(v.runId || v.run_id),
stepId: trim(v.stepId || v.step_id),
phase: trim(v.phase),
currentRole: trim(v.currentRole || v.current_role),
issueNumber: Number.isFinite(n) ? n : null
};
}

function contextFiles(value) {
return arr(value).reduce(function reduceFiles(out, item) {
if (typeof item === 'string') {
const path = trim(item);
if (path) out.push({ path: path, summary: '', sha: '', status: '' });
return out;
}
if (obj(item)) {
const path = trim(item.path || item.file || item.filePath);
if (path) {
out.push({ path: path, summary: trim(item.summary || item.description), sha: trim(item.sha), status: trim(item.status) });
}
}
return out;
}, []);
}

function inputs(value) {
const v = obj(value) ? value : {};
return {
promptText: trim(v.promptText || v.prompt || v.text || v.body || v.instructionsText),
promptTemplateId: trim(v.promptTemplateId || v.templateId || v.template),
instructions: uniq(v.instructions),
notes: uniq(v.notes),
repoTreeText: trim(v.repoTreeText || v.treeText || v.repoTree),
diffText: line(v.diffText || v.diff || ''),
issueText: trim(v.issueText || v.issueBody || v.issueDescription),
contextFiles: contextFiles(v.contextFiles || v.files),
extra: obj(v.extra) ? clone(v.extra) : {}
};
}

function strictSingleFile(text) {
const api = MAOE.parsers.aiPayloadParser || MAOE.aiPayloadParser || {};
const methods = ['parseSingleFileOutput', 'parseSingleFileResponse', 'extractSingleFile', 'parseFileEnvelope'];
for (let i = 0; i < methods.length; i += 1) {
const name = methods[i];
if (typeof api[name] !== 'function') continue;
try {
const result = api[name](text);
if (result && result.ok === true && result.file) return { ok: true, file: { path: trim(result.file.path), code: str(result.file.code) }, source: name };
if (result && result.path && result.code !== undefined) return { ok: true, file: { path: trim(result.path), code: str(result.code) }, source: name };
if (result && result.ok === false && result.error) return { ok: false, error: str(result.error) };
} catch (e) {
log.warn('ai_payload_parser_failed', redact(e && e.message));
}
}
const files = xmlFiles(text);
if (files.length === 1) return { ok: true, file: { path: files[0].path, code: files[0].code }, source: 'xml-file-block' };
if (files.length > 1) return { ok: false, error: 'multiple_file_blocks_detected' };
return { ok: false, error: 'single_file_block_not_found' };
}

function parsePacketXml(text) {
if (typeof global.DOMParser !== 'function') return { ok: false, error: new Error('dom_parser_unavailable') };
try {
const doc = new global.DOMParser().parseFromString(text, 'application/xml');
const parseErrors = doc.getElementsByTagName('parsererror');
if (parseErrors && parseErrors.length) return { ok: false, error: new Error(trim(parseErrors[0].textContent, 'xml_parse_error')) };
const node = doc.getElementsByTagName('HumanHubPacket')[0];
if (!node) return { ok: false, error: new Error('human_hub_packet_node_not_found') };
function read(path) {
const parts = path.split('/');
let cur = node;
for (let i = 0; i < parts.length; i += 1) {
const next = cur.getElementsByTagName(parts[i])[0];
if (!next) return '';
cur = next;
}
return trim(cur.textContent);
}
const num = read('Issue/Number') ? Number(read('Issue/Number')) : null;
const issueNum = Number.isFinite(num) ? num : null;
return {
ok: true,
value: {
schema: node.getAttribute('schema') || DEFAULTS.packetSchema,
schemaVersion: node.getAttribute('schemaVersion') || DEFAULTS.schemaVersion,
packetType: read('PacketType') || 'PROMPT_PACKET',
packetId: read('PacketId'),
channel: read('Channel') || CHANNELS.GENERIC,
source: { extension: read('Source/Extension'), site: read('Source/Site'), adapterId: read('Source/AdapterId'), pageUrl: read('Source/PageUrl'), title: read('Source/Title') },
target: { site: read('Target/Site'), model: read('Target/Model') },
workflow: workflow({ sessionId: read('Workflow/SessionId'), runId: read('Workflow/RunId'), stepId: read('Workflow/StepId'), phase: read('Workflow/Phase'), currentRole: read('Workflow/CurrentRole'), issueNumber: read('Workflow/IssueNumber') }),
repository: repo({ owner: read('Repository/Owner'), name: read('Repository/Name'), fullName: read('Repository/FullName'), defaultBranch: read('Repository/DefaultBranch'), baseBranch: read('Repository/BaseBranch'), headBranch: read('Repository/HeadBranch'), url: read('Repository/Url') }),
issue: issue({ number: issueNum, title: read('Issue/Title'), body: read('Issue/Body'), state: read('Issue/State'), url: read('Issue/Url') }),
task: task({ id: read('Task/Id'), title: read('Task/Title'), description: read('Task/Description') }),
inputs: inputs({ promptText: read('Inputs/PromptText'), promptTemplateId: read('Inputs/PromptTemplateId'), repoTreeText: read('Inputs/RepoTreeText'), diffText: read('Inputs/DiffText'), issueText: read('Inputs/IssueText') }),
createdAt: read('CreatedAt'),
checksum: read('Checksum')
}
};
} catch (e) {
return { ok: false, error: e };
}
}

function parsePacketText(text) {
const src = trim(text);
if (!src) return { ok: false, error: new Error('packet_text_empty') };
const direct = safeJson(src);
if (direct.ok && obj(direct.value)) return { ok: true, value: direct.value, source: 'json' };
if (src.indexOf('<HumanHubPacket') >= 0) {
const xml = parsePacketXml(src);
if (xml.ok) return { ok: true, value: xml.value, source: 'xml' };
}
const blocks = fencedBlocks(src);
for (let i = 0; i < blocks.length; i += 1) {
const b = blocks[i];
if (b.language === 'json') {
const parsed = safeJson(trim(b.content));
if (parsed.ok && obj(parsed.value)) return { ok: true, value: parsed.value, source: 'fenced_json' };
}
if (b.language === 'xml' || b.content.indexOf('<HumanHubPacket') >= 0) {
const xml = parsePacketXml(b.content);
if (xml.ok) return { ok: true, value: xml.value, source: 'fenced_xml' };
}
}
return { ok: false, error: new Error('packet_text_unrecognized') };
}

function validatePacket(packet) {
if (!obj(packet)) return { ok: false, error: 'packet_must_be_object' };
if (!trim(packet.packetId)) return { ok: false, error: 'packet_id_required' };
if (!trim(packet.channel)) return { ok: false, error: 'channel_required' };
if (!packet.inputs || !trim(packet.inputs.promptText)) return { ok: false, error: 'inputs_prompt_text_required' };
return { ok: true };
}

function promptEnvelope(packet) {
return [
'[MAOE_PROMPT_PACKET]',
'packet_id: ' + packet.packetId,
'channel: ' + packet.channel,
'site: ' + packet.source.site,
'target_site: ' + (packet.target.site || ''),
'target_model: ' + (packet.target.model || ''),
'issue_number: ' + (packet.issue.number !== null ? String(packet.issue.number) : ''),
'issue_title: ' + packet.issue.title,
'repository: ' + packet.repository.fullName,
'checksum: ' + packet.checksum,
'---',
packet.inputs.promptText
].join('\n');
}

function packetXml(packet) {
return [
'<?xml version=\"1.0\" encoding=\"UTF-8\"?>',
'<HumanHubPacket schema="' + escapeXml(packet.schema) + '" schemaVersion="' + escapeXml(packet.schemaVersion) + '">',
'  <PacketType>' + escapeXml(packet.packetType) + '</PacketType>',
'  <PacketId>' + escapeXml(packet.packetId) + '</PacketId>',
'  <Channel>' + escapeXml(packet.channel) + '</Channel>',
xmlNode('Source', { Extension: packet.source.extension, Site: packet.source.site, AdapterId: packet.source.adapterId, PageUrl: packet.source.pageUrl, Title: packet.source.title }, '  '),
xmlNode('Target', { Site: packet.target.site, Model: packet.target.model }, '  '),
xmlNode('Workflow', { SessionId: packet.workflow.sessionId, RunId: packet.workflow.runId, StepId: packet.workflow.stepId, Phase: packet.workflow.phase, CurrentRole: packet.workflow.currentRole, IssueNumber: packet.workflow.issueNumber }, '  '),
xmlNode('Repository', { Owner: packet.repository.owner, Name: packet.repository.name, FullName: packet.repository.fullName, DefaultBranch: packet.repository.defaultBranch, BaseBranch: packet.repository.baseBranch, HeadBranch: packet.repository.headBranch, Url: packet.repository.url }, '  '),
xmlNode('Issue', { Number: packet.issue.number, Title: packet.issue.title, Body: packet.issue.body, State: packet.issue.state, Url: packet.issue.url, Labels: packet.issue.labels }, '  '),
xmlNode('Task', { Id: packet.task.id, Title: packet.task.title, Description: packet.task.description, AcceptanceCriteria: packet.task.acceptanceCriteria }, '  '),
xmlNode('Inputs', { PromptText: packet.inputs.promptText, PromptTemplateId: packet.inputs.promptTemplateId, Instructions: packet.inputs.instructions, Notes: packet.inputs.notes, RepoTreeText: packet.inputs.repoTreeText, DiffText: packet.inputs.diffText, IssueText: packet.inputs.issueText, ContextFiles: packet.inputs.contextFiles, Extra: packet.inputs.extra }, '  '),
'  <CreatedAt>' + escapeXml(packet.createdAt) + '</CreatedAt>',
'  <Checksum>' + escapeXml(packet.checksum) + '</Checksum>',
'</HumanHubPacket>'
].join('\n');
}

function serializePacket(packet, format) {
const mode = trim(format, DEFAULTS.transportFormat).toLowerCase();
if (mode === 'xml') return packetXml(packet);
if (mode === 'text' || mode === 'prompt') return promptEnvelope(packet);
return JSON.stringify(packet, null, 2);
}

function buildPromptPacket(base, ctx, input) {
const value = obj(input) ? input : {};
const packet = {
schema: base.packetSchema,
schemaVersion: base.schemaVersion,
packetType: 'PROMPT_PACKET',
packetId: trim(value.packetId) || uid('packet'),
channel: trim(value.channel, CHANNELS.GENERIC) || CHANNELS.GENERIC,
source: {
extension: base.extensionName,
site: ctx.siteId,
adapterId: ctx.adapterId,
pageUrl: href(),
title: title()
},
target: {
site: trim(value.target && value.target.site),
model: trim(value.target && value.target.model)
},
workflow: workflow(value.workflow || ctx.workflow),
repository: repo(value.repository || value.repo || ctx.repository),
issue: issue(value.issue || ctx.issue),
task: task(value.task || ctx.task),
inputs: inputs(value.inputs || value),
createdAt: nowIso()
};
return withChecksum(packet);
}

function buildResult(base, ctx, input) {
const value = obj(input) ? input : {};
const rawText = line(value.rawText || '');
const parsedFile = strictSingleFile(rawText);
const extractedFiles = xmlFiles(rawText).map(function mapFile(item) { return { path: item.path, code: item.code }; });
const jsonPayload = firstJson(rawText);
const diffText = firstDiff(rawText);
const v = verdict(rawText, jsonPayload);
const diagnostics = {
rawLength: rawText.length,
rawPreview: preview(rawText, base.previewLimit),
xmlFileBlocks: extractedFiles.length,
hasJsonPayload: !!jsonPayload,
hasDiffBlock: !!diffText,
errors: [],
warnings: []
};
if (!parsedFile.ok && parsedFile.error) diagnostics.errors.push(str(parsedFile.error));
if (!parsedFile.ok && !v.decision && !jsonPayload && !diffText) diagnostics.warnings.push('no_structured_artifact_detected');

return withChecksum({
  schema: base.resultSchema,
  schemaVersion: base.schemaVersion,
  resultType: 'AI_RESPONSE_SUBMISSION',
  submissionId: trim(value.submissionId) || uid('submission'),
  packetId: trim(value.packetId || (value.packet && value.packet.packetId)) || null,
  source: {
    extension: base.extensionName,
    site: ctx.siteId,
    adapterId: ctx.adapterId,
    pageUrl: href(),
    title: title(),
    model: trim(value.model || value.targetModel || value.modelName)
  },
  workflow: workflow(value.workflow || (value.packet && value.packet.workflow) || ctx.workflow),
  repository: repo(value.repository || value.repo || (value.packet && value.packet.repository) || ctx.repository),
  issue: issue(value.issue || (value.packet && value.packet.issue) || ctx.issue),
  task: task(value.task || (value.packet && value.packet.task) || ctx.task),
  rawText: rawText,
  extracted: {
    singleFile: parsedFile.ok ? { path: parsedFile.file.path, code: parsedFile.file.code, source: parsedFile.source } : null,
    xmlFileBlocks: extractedFiles,
    jsonPayload: jsonPayload,
    diffText: diffText,
    verdict: v
  },
  diagnostics: diagnostics,
  createdAt: nowIso()
});

}

function delivery(response) {
return { ok: response ? response.ok !== false : true, response: response || null, deliveredAt: nowIso() };
}

function commandFromMessage(message) {
if (!message) return '';
if (message.type === ACTIONS.COMMAND && message.command) return trim(message.command).toUpperCase();
switch (message.type) {
case ACTIONS.BUILD_PACKET: return 'BUILD_PACKET';
case ACTIONS.COPY_PACKET: return 'COPY_PACKET';
case ACTIONS.COPY_PROMPT: return 'COPY_PROMPT';
case ACTIONS.STAGE_PROMPT: return 'STAGE_PROMPT';
case ACTIONS.IMPORT_PACKET_TEXT: return 'IMPORT_PACKET_TEXT';
case ACTIONS.EXTRACT_TEXT: return 'EXTRACT_TEXT';
case ACTIONS.CAPTURE_AND_SUBMIT: return 'CAPTURE_AND_SUBMIT';
case ACTIONS.GET_STATUS: return 'GET_STATUS';
default: return '';
}
}

class HumanHubBridge {
constructor(adapter, options) {
this.options = Object.assign({}, DEFAULTS, obj(options) ? options : {});
this.adapter = adapter || null;
this.siteId = siteId();
this.adapterId = trim(callAdapter(this.adapter, ['getAdapterId', 'getId', 'adapterId', 'id']), this.siteId);
this.bridgeId = uid('bridge');
this.runtimeContext = null;
this.lastPreparedPacket = null;
this.lastExtraction = null;
this.lastDelivery = null;
this.initialized = false;
this.runtimeListener = this.handleRuntimeMessage.bind(this);
}

capabilities() {
  return {
    siteId: this.siteId,
    adapterId: this.adapterId,
    buildPacket: true,
    copyPacket: true,
    copyPrompt: true,
    stagePrompt: true,
    importPacketText: true,
    extractText: true,
    captureAndSubmit: true,
    strictSingleFile: true,
    supportsClipboard: !!(global.navigator && global.navigator.clipboard),
    supportsRuntimeMessaging: !!(global.chrome && global.chrome.runtime)
  };
}

status() {
  return {
    bridgeId: this.bridgeId,
    siteId: this.siteId,
    adapterId: this.adapterId,
    initialized: this.initialized,
    capabilities: this.capabilities(),
    lastPreparedPacket: this.lastPreparedPacket ? { packetId: this.lastPreparedPacket.packetId, channel: this.lastPreparedPacket.channel, checksum: this.lastPreparedPacket.checksum, createdAt: this.lastPreparedPacket.createdAt } : null,
    lastExtraction: this.lastExtraction ? { submissionId: this.lastExtraction.submissionId, packetId: this.lastExtraction.packetId, checksum: this.lastExtraction.checksum, createdAt: this.lastExtraction.createdAt, singleFilePath: this.lastExtraction.extracted.singleFile ? this.lastExtraction.extracted.singleFile.path : null, verdict: this.lastExtraction.extracted.verdict.decision } : null,
    runtimeContext: this.runtimeContext ? { workflow: this.runtimeContext.workflow, repository: this.runtimeContext.repository, issue: this.runtimeContext.issue } : null
  };
}

async initialize() {
  if (this.initialized) return this;
  if (global.chrome && global.chrome.runtime && global.chrome.runtime.onMessage) {
    global.chrome.runtime.onMessage.addListener(this.runtimeListener);
  }
  this.initialized = true;
  if (this.options.autoNotifyReady) {
    this.lastDelivery = delivery(await send({
      type: ACTIONS.CONTENT_READY,
      payload: {
        bridgeId: this.bridgeId,
        siteId: this.siteId,
        adapterId: this.adapterId,
        capabilities: this.capabilities(),
        url: href(),
        title: title(),
        initializedAt: nowIso()
      }
    }));
  }
  event(EVENTS.READY, this.status());
  log.info('human_hub_bridge_ready', { bridgeId: this.bridgeId, siteId: this.siteId, adapterId: this.adapterId });
  return this;
}

destroy() {
  if (global.chrome && global.chrome.runtime && global.chrome.runtime.onMessage) {
    try { global.chrome.runtime.onMessage.removeListener(this.runtimeListener); } catch (e) { log.warn('runtime_listener_remove_failed', redact(e && e.message)); }
  }
  this.initialized = false;
}

async getRuntimeContext(forceRefresh) {
  if (this.runtimeContext && !forceRefresh) return this.runtimeContext;
  const response = await send({
    type: ACTIONS.GET_WORK_CONTEXT,
    payload: { bridgeId: this.bridgeId, siteId: this.siteId, adapterId: this.adapterId, url: href(), title: title() }
  });
  const ctx = response && response.ok !== false ? (response.payload || response.data || response.context || null) : null;
  this.runtimeContext = {
    repository: repo(ctx && (ctx.repository || ctx.repo)),
    issue: issue(ctx && ctx.issue),
    task: task(ctx && ctx.task),
    workflow: workflow(ctx && ctx.workflow)
  };
  return this.runtimeContext;
}

async buildPromptPacket(input) {
  const ctx = await this.getRuntimeContext(false);
  const packet = buildPromptPacket(this.options, {
    siteId: this.siteId,
    adapterId: this.adapterId,
    repository: ctx.repository,
    issue: ctx.issue,
    task: ctx.task,
    workflow: ctx.workflow
  }, input);
  const ok = validatePacket(packet);
  if (!ok.ok) throw new Error(ok.error);
  this.lastPreparedPacket = packet;
  if (this.options.autoPersistPacket) {
    await send({ type: ACTIONS.SAVE_PACKET, payload: { bridgeId: this.bridgeId, packet: packet } });
  }
  event(EVENTS.PACKET_READY, { packet: packet, serialized: serializePacket(packet, this.options.transportFormat) });
  return packet;
}

serializePacket(packet, format) {
  return serializePacket(packet, format || this.options.transportFormat);
}

renderPrompt(packet) {
  return promptEnvelope(packet);
}

async copyPacket(inputOrPacket, options) {
  const cfg = obj(options) ? options : {};
  const packet = inputOrPacket && inputOrPacket.packetType === 'PROMPT_PACKET' ? inputOrPacket : await this.buildPromptPacket(inputOrPacket || {});
  const format = trim(cfg.format, this.options.transportFormat);
  const text = serializePacket(packet, format);
  const copied = await copy(text);
  const detail = { packet: packet, copied: copied, format: format, textPreview: preview(text, this.options.previewLimit) };
  event(EVENTS.PACKET_COPIED, detail);
  return detail;
}

async copyPrompt(inputOrPacket) {
  const packet = inputOrPacket && inputOrPacket.packetType === 'PROMPT_PACKET' ? inputOrPacket : await this.buildPromptPacket(inputOrPacket || {});
  const text = promptEnvelope(packet);
  const copied = await copy(text);
  const detail = { packet: packet, copied: copied, format: 'prompt', textPreview: preview(text, this.options.previewLimit) };
  event(EVENTS.PACKET_COPIED, detail);
  return detail;
}

async stagePrompt(inputOrPacket) {
  const packet = inputOrPacket && inputOrPacket.packetType === 'PROMPT_PACKET' ? inputOrPacket : await this.buildPromptPacket(inputOrPacket || {});
  const setter = findAdapter(this.adapter, ['setComposerText', 'setInputText', 'setPromptText', 'writeToInput']);
  if (!setter || typeof setter.member !== 'function') throw new Error('adapter_missing_text_setter');
  const text = promptEnvelope(packet);
  await asPromise(callAdapter(this.adapter, ['focusComposer', 'focusInput']));
  await asPromise(setter.member.call(this.adapter, text));
  const detail = { packet: packet, staged: true, promptPreview: preview(text, this.options.previewLimit) };
  event(EVENTS.PROMPT_STAGED, detail);
  return detail;
}

async importPacketText(text) {
  const parsed = parsePacketText(text);
  if (!parsed.ok) throw parsed.error;
  const ok = validatePacket(parsed.value);
  if (!ok.ok) throw new Error(ok.error);
  this.lastPreparedPacket = parsed.value;
  event(EVENTS.PACKET_READY, { packet: parsed.value, imported: true, source: parsed.source });
  return { packet: parsed.value, source: parsed.source };
}

async readLatestResponseText() {
  const result = await asPromise(callAdapter(this.adapter, ['getLatestAssistantText', 'getLatestResponseText', 'readLatestResponseText', 'getVisibleTranscriptText', 'getTranscriptText']));
  const text = trim(result);
  if (text) return text;
  if (!this.options.allowBodyFallbackRead || !global.document || !global.document.body) return '';
  return trim(global.document.body.innerText || global.document.body.textContent || '');
}

extractText(rawText, options) {
  const cfg = obj(options) ? options : {};
  const submission = buildResult(this.options, {
    siteId: this.siteId,
    adapterId: this.adapterId,
    repository: this.runtimeContext ? this.runtimeContext.repository : {},
    issue: this.runtimeContext ? this.runtimeContext.issue : {},
    task: this.runtimeContext ? this.runtimeContext.task : {},
    workflow: this.runtimeContext ? this.runtimeContext.workflow : {}
  }, Object.assign({}, cfg, {
    packet: cfg.packet || this.lastPreparedPacket,
    packetId: cfg.packetId || (this.lastPreparedPacket ? this.lastPreparedPacket.packetId : ''),
    rawText: rawText
  }));
  this.lastExtraction = submission;
  event(EVENTS.RESULT_READY, { submission: submission, diagnostics: submission.diagnostics });
  return submission;
}

async captureAndSubmit(options) {
  const cfg = obj(options) ? options : {};
  const rawText = trim(cfg.rawText) || (await this.readLatestResponseText());
  const submission = this.extractText(rawText, cfg);
  if (cfg.submit === false || this.options.autoSubmitCapture === false) return submission;
  return this.submitResult(submission);
}

async submitResult(submission) {
  const payload = obj(submission) ? submission : this.lastExtraction;
  if (!payload) throw new Error('submission_required');
  const response = await send({ type: ACTIONS.SUBMIT_RESULT, payload: { bridgeId: this.bridgeId, submission: payload } });
  this.lastDelivery = delivery(response);
  event(EVENTS.RESULT_SUBMITTED, { submission: payload, delivery: this.lastDelivery });
  return Object.assign({}, payload, { delivery: this.lastDelivery });
}

async executeCommand(command, payload) {
  switch (trim(command).toUpperCase()) {
    case 'PING':
    case 'GET_STATUS':
      return { ok: true, status: this.status() };
    case 'BUILD_PACKET': {
      const packet = await this.buildPromptPacket(payload || {});
      return { ok: true, packet: packet, serialized: serializePacket(packet, (payload && payload.format) || this.options.transportFormat) };
    }
    case 'COPY_PACKET':
      return { ok: true, result: await this.copyPacket(payload || {}, payload || {}) };
    case 'COPY_PROMPT':
      return { ok: true, result: await this.copyPrompt(payload || {}) };
    case 'STAGE_PROMPT':
      return { ok: true, result: await this.stagePrompt(payload || {}) };
    case 'IMPORT_PACKET_TEXT':
      return { ok: true, result: await this.importPacketText(payload && payload.text ? payload.text : '') };
    case 'EXTRACT_TEXT':
      return { ok: true, result: this.extractText(payload && payload.rawText ? payload.rawText : '', payload || {}) };
    case 'CAPTURE_AND_SUBMIT':
      return { ok: true, result: await this.captureAndSubmit(payload || {}) };
    default:
      return { ok: false, error: 'unsupported_command:' + command };
  }
}

handleRuntimeMessage(message, sender, sendResponse) {
  const command = commandFromMessage(message);
  if (!command) return false;
  Promise.resolve()
    .then(() => this.executeCommand(command, obj(message.payload) ? message.payload : {}))
    .then(function onSuccess(result) {
      if (typeof sendResponse === 'function') sendResponse(result);
    })
    .catch(function onError(err) {
      const error = err && err.message ? err.message : String(err);
      log.error('human_hub_command_failed', { command: command, sender: sender && sender.id ? sender.id : '', error: redact(error) });
      event(EVENTS.ERROR, { command: command, error: error });
      if (typeof sendResponse === 'function') sendResponse({ ok: false, error: error });
    });
  return true;
}

}

function createHumanHubBridge(adapter, options) {
return new HumanHubBridge(adapter, options);
}

MAOE.content.common.HumanHubBridge = HumanHubBridge;
MAOE.content.common.createHumanHubBridge = createHumanHubBridge;
MAOE.content.common.humanHubBridge = {
ACTIONS: ACTIONS,
CHANNELS: CHANNELS,
EVENTS: EVENTS,
VERDICTS: VERDICTS,
HumanHubBridge: HumanHubBridge,
createHumanHubBridge: createHumanHubBridge,
parsePacketText: parsePacketText,
serializePacket: serializePacket,
extractText: function extractTextFacade(rawText, options) {
const bridge = new HumanHubBridge(null, options);
return bridge.extractText(rawText, options);
},
createChecksum: checksum,
siteId: siteId
};
})(globalThis);