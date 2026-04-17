import * as vscode from 'vscode';
import * as path from 'path';
import type { VariablesRegistry } from './promptaVariables';

type EnvSnapshot = {
  global: Record<string, string>;
  project: Record<string, string>;
};

type VarState = {
  source: 'global' | 'project' | 'custom';
  customValue: string;
};

type FileInspectorState = Map<string, VarState>;

export type SaveTargetPicker = () => Promise<'global' | 'project' | undefined>;

export class PromptaInspectorView implements vscode.WebviewViewProvider, vscode.Disposable {
  public static readonly viewType = 'promptaInspectorView';

  private _view?: vscode.WebviewView;
  private _activeFilePath?: string;
  private _activeContent = '';

  private readonly _disposables: vscode.Disposable[] = [];
  private readonly _fileStates = new Map<string, FileInspectorState>();
  private _pinned = false;
  private _onUnpinCallback?: () => void;

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _registry: VariablesRegistry,
    private readonly _pickSaveTarget: SaveTargetPicker
  ) {
    this._disposables.push(_registry.onChanged(() => this._pushEnv()));
  }

  public dispose(): void {
    this._disposables.forEach((d) => d.dispose());
    this._disposables.length = 0;
  }

  public get pinned(): boolean {
    return this._pinned;
  }

  public togglePin(): void {
    this._pinned = !this._pinned;
    vscode.commands.executeCommand('setContext', 'prompta.inspectorPinned', this._pinned);
    if (!this._pinned) {
      this._onUnpinCallback?.();
    }
  }

  public onUnpin(callback: () => void): void {
    this._onUnpinCallback = callback;
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };

    webviewView.webview.onDidReceiveMessage((msg) => {
      switch (msg.type) {
        case 'copy':
          vscode.env.clipboard.writeText(msg.content);
          vscode.window.showInformationMessage('Copied to clipboard');
          break;
        case 'saveVar':
          void this._handleSaveVar(msg.name, msg.value);
          break;
        case 'saveAll':
          void this._handleSaveAll(msg.target, msg.entries);
          break;
        case 'stateChanged':
          this._persistWebviewState(msg.states);
          break;
      }
    });

    webviewView.onDidDispose(() => {
      this._view = undefined;
    });

    this._render();
  }

  private _persistWebviewState(states: Record<string, { source: string; customValue: string }>): void {
    if (!this._activeFilePath) return;
    const stateMap = new Map<string, VarState>();
    for (const [name, val] of Object.entries(states)) {
      stateMap.set(name, {
        source: val.source as VarState['source'],
        customValue: val.customValue,
      });
    }
    this._fileStates.set(this._activeFilePath, stateMap);
  }

  private async _handleSaveVar(name: string, value: string): Promise<void> {
    const target = await this._pickSaveTarget();
    if (!target) return;
    await this._registry.save(target, name, value);
    this.notifySaved([name], target);
  }

  private async _handleSaveAll(
    target: 'global' | 'project',
    entries: Array<{ name: string; value: string }>
  ): Promise<void> {
    if (!entries?.length) return;
    await this._registry.saveMany(target, entries);
    this.notifySaved(entries.map((e) => e.name), target);
  }

  public setActiveFile(filePath: string | undefined, content: string): void {
    if (this._pinned) {
      if (filePath === this._activeFilePath) {
        this._activeContent = content;
        this._view?.webview.postMessage({ type: 'contentUpdate', content });
      }
      return;
    }

    const fileChanged = filePath !== this._activeFilePath;
    this._activeFilePath = filePath;
    this._activeContent = content;
    if (!this._view) return;

    if (fileChanged) {
      const savedState = filePath ? this._fileStates.get(filePath) : undefined;
      const stateObj = savedState ? Object.fromEntries(savedState) : null;
      const fileName = filePath ? path.basename(filePath) : '';
      this._view.webview.postMessage({
        type: 'fileSwitch',
        content,
        fileName,
        savedState: stateObj,
      });
    } else {
      this._view.webview.postMessage({ type: 'contentUpdate', content });
    }
  }

  public rerender(): void {
    if (this._view) this._render();
  }

  public notifySaved(names: string[], target: 'global' | 'project'): void {
    if (!this._view) return;
    this._view.webview.postMessage({ type: 'saved', names, target });
  }

  public postToWebview(msg: unknown): void {
    this._view?.webview.postMessage(msg);
  }

  private _envSnapshot(): EnvSnapshot {
    return {
      global: Object.fromEntries(this._registry.globalVars),
      project: Object.fromEntries(this._registry.projectVars),
    };
  }

  private _pushEnv(): void {
    if (!this._view) return;
    this._view.webview.postMessage({ type: 'envUpdate', env: this._envSnapshot() });
  }

  private _getFontSize(): number {
    return vscode.workspace.getConfiguration('prompta').get<number>('fontSize', 14);
  }

  private _savedStateJson(): string {
    if (!this._activeFilePath) return 'null';
    const state = this._fileStates.get(this._activeFilePath);
    if (!state || state.size === 0) return 'null';
    return JSON.stringify(Object.fromEntries(state));
  }

  private _render(): void {
    if (!this._view) return;
    const hasFile = !!this._activeFilePath;
    const fontSize = this._getFontSize();
    const fileName = this._activeFilePath ? path.basename(this._activeFilePath) : '';

    const content = this._activeContent
      .replace(/\\/g, '\\\\')
      .replace(/`/g, '\\`')
      .replace(/\$/g, '\\$')
      .replace(/</g, '\\x3c');

    const escapedFileName = fileName
      .replace(/\\/g, '\\\\')
      .replace(/`/g, '\\`')
      .replace(/\$/g, '\\$')
      .replace(/</g, '\\x3c');

    const envJson = JSON.stringify(this._envSnapshot());
    const savedStateJson = this._savedStateJson();

    this._view.webview.html = /*html*/ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    background: var(--vscode-sideBar-background);
    display: flex;
    flex-direction: column;
    height: 100vh;
    overflow: hidden;
  }

  .file-header {
    padding: 8px 12px 0;
    font-size: 11px;
    opacity: 0.6;
    font-family: var(--vscode-font-family);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .inline-save-btn {
    background: none;
    border: none;
    color: var(--vscode-charts-yellow, #e6c92a);
    cursor: pointer;
    padding: 0;
    border-radius: 2px;
    opacity: 0.85;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 18px;
  }
  .inline-save-btn:hover { opacity: 1; background: var(--vscode-toolbar-hoverBackground); }
  .inline-save-btn svg { width: 12px; height: 12px; fill: currentColor; }

  .body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 10px 12px;
  }

  .var-row {
    display: flex;
    flex-direction: column;
    gap: 3px;
    margin-bottom: 12px;
  }
  .var-head {
    display: flex;
    align-items: center;
    gap: 4px;
    min-height: 22px;
  }
  .var-name {
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: ${fontSize - 2}px;
    opacity: 0.85;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .var-sources {
    display: flex;
    gap: 1px;
    flex-shrink: 0;
  }
  .src-btn {
    background: none;
    border: none;
    color: var(--vscode-foreground);
    cursor: pointer;
    padding: 0;
    border-radius: 2px;
    opacity: 0.35;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 18px;
  }
  .src-btn:hover { opacity: 0.85; background: var(--vscode-toolbar-hoverBackground); }
  .src-btn.active {
    opacity: 1;
    color: var(--vscode-focusBorder);
    background: var(--vscode-toolbar-activeBackground, rgba(100,150,255,0.15));
  }
  .src-btn:disabled { opacity: 0.12; cursor: default; background: none; }
  .src-btn svg { width: 11px; height: 11px; fill: currentColor; }

  .var-input {
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, transparent);
    padding: 5px 10px;
    border-radius: 4px;
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: ${fontSize - 1}px;
    outline: none;
    width: 100%;
    resize: none;
    line-height: 1.4;
    overflow: hidden;
    white-space: pre-wrap;
    word-break: break-word;
    display: block;
  }
  .var-input:focus { border-color: var(--vscode-focusBorder); }
  .empty-state {
    opacity: 0.5;
    font-size: 12px;
    text-align: center;
    padding: 24px 8px;
  }
</style>
</head>
<body>
  <div class="file-header" id="fileHeader" style="display: ${hasFile ? 'block' : 'none'}">
    <span id="fileName"></span>
  </div>
  <div class="body" id="body">
    ${hasFile ? '<div id="varsContainer"></div>' : '<div class="empty-state">Open a prompt to see variables.</div>'}
  </div>

<script>
  const vscode = acquireVsCodeApi();
  let hasFile = ${hasFile};
  let content = \`${content}\`;
  let env = ${envJson};
  let savedState = ${savedStateJson};

  const varStates = {};

  const GLOBE_SVG = '<svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/></svg>';
  const FOLDER_SVG = '<svg viewBox="0 0 24 24"><path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/></svg>';
  const PENCIL_SVG = '<svg viewBox="0 0 24 24"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>';
  const SAVE_SVG = '<svg viewBox="0 0 24 24"><path d="M17 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V7l-4-4zm-5 16c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3zm3-10H5V5h10v4z"/></svg>';

  function extractVars(text) {
    const regex = /\\{\\{\\s*([A-Za-z_][A-Za-z0-9_]*)\\s*\\}\\}/g;
    const out = [];
    const seen = new Set();
    let m;
    while ((m = regex.exec(text)) !== null) {
      if (!seen.has(m[1])) { seen.add(m[1]); out.push(m[1]); }
    }
    return out;
  }

  function autoResize(ta) {
    ta.style.height = '0';
    ta.style.height = ta.scrollHeight + 'px';
  }

  function autoResizeAll() {
    document.querySelectorAll('.var-input').forEach(autoResize);
  }

  new ResizeObserver(() => autoResizeAll()).observe(document.body);

  function defaultSourceFor(name) {
    if (env.project[name] !== undefined) return 'project';
    if (env.global[name] !== undefined) return 'global';
    return 'custom';
  }

  function ensureState(name) {
    if (!varStates[name]) {
      if (savedState && savedState[name]) {
        varStates[name] = {
          selectedSource: savedState[name].source,
          customValue: savedState[name].customValue || ''
        };
      } else {
        varStates[name] = { selectedSource: defaultSourceFor(name), customValue: '' };
      }
    } else {
      const s = varStates[name].selectedSource;
      if (s === 'project' && env.project[name] === undefined) varStates[name].selectedSource = env.global[name] !== undefined ? 'global' : 'custom';
      if (s === 'global' && env.global[name] === undefined) varStates[name].selectedSource = env.project[name] !== undefined ? 'project' : 'custom';
    }
    return varStates[name];
  }

  function resolveValue(name) {
    const st = varStates[name];
    if (!st) return '';
    if (st.selectedSource === 'custom') return st.customValue;
    if (st.selectedSource === 'project') return env.project[name] || '';
    if (st.selectedSource === 'global') return env.global[name] || '';
    return '';
  }

  function substituteVars(text) {
    return text.replace(/\\{\\{\\s*([A-Za-z_][A-Za-z0-9_]*)\\s*\\}\\}/g, (m, name) => {
      const v = resolveValue(name);
      return v !== '' ? v : m;
    });
  }

  function hasCustomValue(name) {
    const st = varStates[name];
    if (!st) return false;
    return st.selectedSource === 'custom' && st.customValue !== '';
  }

  function collectCustomEntries() {
    const out = [];
    for (const name of Object.keys(varStates)) {
      if (hasCustomValue(name)) out.push({ name, value: varStates[name].customValue });
    }
    return out;
  }

  function notifyStateChanged() {
    const states = {};
    for (const name of Object.keys(varStates)) {
      const st = varStates[name];
      states[name] = { source: st.selectedSource, customValue: st.customValue };
    }
    vscode.postMessage({ type: 'stateChanged', states });
  }

  function makeSrcBtn(kind, state, name) {
    const btn = document.createElement('button');
    btn.className = 'src-btn';
    btn.dataset.kind = kind;
    btn.innerHTML = kind === 'global' ? GLOBE_SVG : kind === 'project' ? FOLDER_SVG : PENCIL_SVG;
    const title = kind === 'custom' ? 'Use custom value' : kind === 'project' ? 'Use project value' : 'Use global value';
    btn.title = title;
    if (state.selectedSource === kind) btn.classList.add('active');
    btn.addEventListener('click', () => {
      state.selectedSource = kind;
      redrawRow(name);
      notifyStateChanged();
    });
    return btn;
  }

  function hasExternalSource(name) {
    return env.global[name] !== undefined || env.project[name] !== undefined;
  }

  function makeSaveBtn(state, name) {
    const btn = document.createElement('button');
    btn.className = 'inline-save-btn';
    btn.innerHTML = SAVE_SVG;
    btn.title = 'Save to global / project';
    btn.addEventListener('click', () => {
      vscode.postMessage({ type: 'saveVar', name, value: state.customValue });
    });
    return btn;
  }

  function redrawRow(name) {
    const container = document.getElementById('varsContainer');
    if (!container) return;
    const row = container.querySelector('[data-key="' + CSS.escape(name) + '"]');
    if (!row) return;
    const state = varStates[name];
    const sources = row.querySelector('.var-sources');
    sources.innerHTML = '';
    if (hasExternalSource(name)) {
      if (env.global[name] !== undefined) sources.appendChild(makeSrcBtn('global', state, name));
      if (env.project[name] !== undefined) sources.appendChild(makeSrcBtn('project', state, name));
      sources.appendChild(makeSrcBtn('custom', state, name));
    }
    if (hasCustomValue(name)) sources.appendChild(makeSaveBtn(state, name));
    const input = row.querySelector('.var-input');
    const newVal = resolveValue(name);
    if (document.activeElement !== input) input.value = newVal;
    autoResize(input);
  }

  function createRow(name) {
    const state = ensureState(name);
    const row = document.createElement('div');
    row.className = 'var-row';
    row.dataset.key = name;

    const head = document.createElement('div');
    head.className = 'var-head';
    const label = document.createElement('div');
    label.className = 'var-name';
    label.textContent = name;
    const sources = document.createElement('div');
    sources.className = 'var-sources';
    head.appendChild(label);
    head.appendChild(sources);

    const input = document.createElement('textarea');
    input.className = 'var-input';
    input.rows = 1;
    input.placeholder = name;
    input.value = resolveValue(name);

    input.addEventListener('input', () => {
      if (state.selectedSource !== 'custom') {
        state.selectedSource = 'custom';
      }
      state.customValue = input.value;
      autoResize(input);
      redrawRow(name);
      notifyStateChanged();
    });

    row.appendChild(head);
    row.appendChild(input);

    if (hasExternalSource(name)) {
      if (env.global[name] !== undefined) sources.appendChild(makeSrcBtn('global', state, name));
      if (env.project[name] !== undefined) sources.appendChild(makeSrcBtn('project', state, name));
      sources.appendChild(makeSrcBtn('custom', state, name));
    }
    if (hasCustomValue(name)) sources.appendChild(makeSaveBtn(state, name));

    return row;
  }

  function syncVars() {
    if (!hasFile) return;
    const body = document.getElementById('body');
    let container = document.getElementById('varsContainer');
    if (!container) {
      container = document.createElement('div');
      container.id = 'varsContainer';
      body.innerHTML = '';
      body.appendChild(container);
    }

    const vars = extractVars(content);
    if (vars.length === 0) {
      container.innerHTML = '';
      if (!body.querySelector('.empty-state')) {
        const empty = document.createElement('div');
        empty.className = 'empty-state';
        empty.textContent = 'No {{variables}} in this prompt.';
        body.appendChild(empty);
      }
      return;
    }
    const existingEmpty = body.querySelector('.empty-state');
    if (existingEmpty) existingEmpty.remove();

    const existing = new Map();
    Array.from(container.children).forEach((row) => existing.set(row.dataset.key, row));

    const desired = new Set(vars);
    existing.forEach((row, key) => {
      if (!desired.has(key)) row.remove();
    });

    vars.forEach((name, idx) => {
      let row = existing.get(name);
      if (!row) {
        row = createRow(name);
        ensureState(name);
      } else {
        ensureState(name);
      }
      if (container.children[idx] !== row) {
        container.insertBefore(row, container.children[idx] || null);
      }
      redrawRow(name);
    });
  }

  // Initial render
  if (hasFile) {
    const el = document.getElementById('fileName');
    if (el) el.textContent = \`${escapedFileName}\`;
    syncVars();
    notifyStateChanged();
    requestAnimationFrame(autoResizeAll);
  }

  function bulkSwitch(target) {
    const vars = extractVars(content);
    vars.forEach((name) => {
      const state = ensureState(name);
      if (target === 'custom') {
        state.selectedSource = 'custom';
      } else if (target === 'project' && env.project[name] !== undefined) {
        state.selectedSource = 'project';
      } else if (target === 'global' && env.global[name] !== undefined) {
        state.selectedSource = 'global';
      }
      redrawRow(name);
    });
    notifyStateChanged();
  }

  window.addEventListener('message', (e) => {
    const msg = e.data;
    if (msg.type === 'contentUpdate') {
      content = msg.content;
      syncVars();
    } else if (msg.type === 'envUpdate') {
      env = msg.env;
      syncVars();
    } else if (msg.type === 'saved') {
      (msg.names || []).forEach((name) => {
        const st = varStates[name];
        if (!st) return;
        st.selectedSource = msg.target;
        st.customValue = '';
        redrawRow(name);
      });
      notifyStateChanged();
    } else if (msg.type === 'initiateCopy') {
      if (hasFile) vscode.postMessage({ type: 'copy', content: substituteVars(content) });
    } else if (msg.type === 'initiateSaveAll') {
      const entries = collectCustomEntries();
      if (entries.length) vscode.postMessage({ type: 'saveAll', target: msg.target, entries });
    } else if (msg.type === 'bulkSwitch') {
      bulkSwitch(msg.target);
    } else if (msg.type === 'fileSwitch') {
      content = msg.content;
      savedState = msg.savedState;
      for (const key of Object.keys(varStates)) {
        delete varStates[key];
      }
      const fileNameEl = document.getElementById('fileName');
      if (fileNameEl) fileNameEl.textContent = msg.fileName || '';
      const fileHeader = document.getElementById('fileHeader');
      if (fileHeader) fileHeader.style.display = msg.fileName ? 'block' : 'none';
      hasFile = !!msg.fileName;
      if (hasFile) {
        syncVars();
        notifyStateChanged();
        requestAnimationFrame(autoResizeAll);
      } else {
        const body = document.getElementById('body');
        body.innerHTML = '<div class="empty-state">Open a prompt to see variables.</div>';
      }
    }
  });
</script>
</body>
</html>`;
  }
}
