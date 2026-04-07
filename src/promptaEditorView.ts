import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export class PromptaEditorViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'promptaEditorView';

  private _view?: vscode.WebviewView;
  private _currentFilePath?: string;
  private _currentContent?: string;
  private _currentFileName?: string;
  private _isPreview = false;

  constructor(private readonly _extensionUri: vscode.Uri) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };

    this._updateHtml();

    webviewView.webview.onDidReceiveMessage((msg) => {
      switch (msg.type) {
        case 'save':
          this._saveFile(msg.content);
          break;
        case 'copy':
          vscode.env.clipboard.writeText(msg.content);
          vscode.window.showInformationMessage('Copied to clipboard');
          break;
        case 'modeChange':
          this._isPreview = msg.isPreview;
          break;
      }
    });

    webviewView.onDidDispose(() => {
      this._view = undefined;
    });
  }

  openFile(filePath: string): void {
    this._currentFilePath = filePath;
    this._currentFileName = path.basename(filePath);
    try {
      this._currentContent = fs.readFileSync(filePath, 'utf-8');
    } catch {
      this._currentContent = '';
    }

    if (this._view) {
      this._view.show?.(true);
      this._updateHtml();
    } else {
      vscode.commands.executeCommand('promptaEditorView.focus');
    }
  }

  rerender(): void {
    if (this._view) {
      this._updateHtml();
    }
  }

  private _saveFile(content: string): void {
    if (!this._currentFilePath) return;
    this._currentContent = content;
    try {
      fs.writeFileSync(this._currentFilePath, content, 'utf-8');
    } catch (err: any) {
      vscode.window.showErrorMessage(`Save failed: ${err.message}`);
    }
  }

  private _getFontSize(): number {
    return vscode.workspace.getConfiguration('prompta').get<number>('fontSize', 14);
  }

  private _updateHtml(): void {
    if (!this._view) return;

    const hasFile = !!this._currentFilePath;
    const fileName = this._currentFileName || '';
    const fontSize = this._getFontSize();
    const startInPreview = this._isPreview;
    const content = (this._currentContent || '')
      .replace(/\\/g, '\\\\')
      .replace(/`/g, '\\`')
      .replace(/\$/g, '\\$');

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

  .toolbar {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 8px;
    border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border, var(--vscode-panel-border));
    background: var(--vscode-sideBarSectionHeader-background, transparent);
    flex-shrink: 0;
    min-height: 28px;
  }

  .file-name {
    flex: 1;
    font-weight: 600;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    opacity: 0.8;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .toolbar-btn {
    background: none;
    border: none;
    color: var(--vscode-foreground);
    cursor: pointer;
    padding: 3px 5px;
    border-radius: 3px;
    opacity: 0.7;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
  }
  .toolbar-btn:hover { opacity: 1; background: var(--vscode-toolbar-hoverBackground); }
  .toolbar-btn.active { opacity: 1; background: var(--vscode-toolbar-activeBackground, rgba(255,255,255,0.12)); }
  .toolbar-btn svg { width: 16px; height: 16px; fill: currentColor; }

  .save-indicator {
    font-size: 9px;
    opacity: 0;
    transition: opacity 0.2s;
    color: var(--vscode-descriptionForeground);
  }
  .save-indicator.visible { opacity: 1; }

  .editor-container { flex: 1; overflow: hidden; position: relative; }

  textarea {
    width: 100%;
    height: 100%;
    background: var(--vscode-sideBar-background);
    color: var(--vscode-foreground);
    border: none;
    outline: none;
    resize: none;
    padding: 10px 12px;
    font-family: var(--vscode-editor-font-family, 'Consolas', 'Courier New', monospace);
    font-size: ${fontSize}px;
    line-height: 1.6;
    tab-size: 2;
    white-space: pre-wrap;
    word-wrap: break-word;
  }

  /* --- Preview --- */
  .preview-container {
    width: 100%;
    height: 100%;
    overflow-y: auto;
    display: none;
    flex-direction: column;
  }
  .var-panel {
    padding: 8px 12px;
    border-bottom: 1px solid var(--vscode-panel-border);
    background: var(--vscode-sideBarSectionHeader-background, rgba(128,128,128,0.05));
    flex-shrink: 0;
  }
  .var-panel-title { font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; opacity: 0.6; margin-bottom: 6px; }
  .var-row { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
  .var-label {
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: ${fontSize - 1}px;
    opacity: 0.8;
    min-width: 80px;
    white-space: nowrap;
  }
  .var-input {
    flex: 1;
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, transparent);
    padding: 2px 6px;
    border-radius: 3px;
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: ${fontSize - 1}px;
    outline: none;
  }
  .var-input:focus { border-color: var(--vscode-focusBorder); }

  .preview {
    padding: 10px 12px;
    line-height: 1.6;
    font-size: ${fontSize}px;
    overflow-y: auto;
    flex: 1;
  }
  .preview h1, .preview h2, .preview h3, .preview h4 { margin: 0.8em 0 0.4em; font-weight: 600; }
  .preview h1 { font-size: 1.4em; border-bottom: 1px solid var(--vscode-panel-border); padding-bottom: 4px; }
  .preview h2 { font-size: 1.2em; }
  .preview h3 { font-size: 1.05em; }
  .preview p { margin: 0.4em 0; }
  .preview ul, .preview ol { padding-left: 1.5em; margin: 0.4em 0; }
  .preview code {
    background: var(--vscode-textCodeBlock-background, rgba(128,128,128,0.15));
    padding: 1px 5px; border-radius: 3px;
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 0.92em;
  }
  .preview pre {
    background: var(--vscode-textCodeBlock-background, rgba(128,128,128,0.15));
    padding: 10px; border-radius: 4px; overflow-x: auto; margin: 0.6em 0;
  }
  .preview pre code { background: none; padding: 0; }
  .preview blockquote {
    border-left: 3px solid var(--vscode-textBlockQuote-border, #666);
    padding-left: 10px; margin: 0.4em 0; opacity: 0.85;
  }
  .preview .template-var {
    background: var(--vscode-badge-background, #007acc);
    color: var(--vscode-badge-foreground, #fff);
    padding: 1px 6px; border-radius: 3px;
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 0.9em;
  }
  .preview .template-var.filled {
    background: var(--vscode-testing-iconPassed, #388a34);
  }

  .empty-state {
    display: flex; align-items: center; justify-content: center;
    height: 100%; opacity: 0.5; font-size: 12px; text-align: center; padding: 20px;
  }
</style>
</head>
<body>
  ${hasFile ? `
  <div class="toolbar">
    <span class="file-name">${fileName}</span>
    <span class="save-indicator" id="saveIndicator">saved</span>
    <button class="toolbar-btn${startInPreview ? ' active' : ''}" id="previewBtn" title="${startInPreview ? 'Edit' : 'Preview'}">
      <svg id="previewIcon" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        ${startInPreview
          ? '<path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>'
          : '<path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/>'}
      </svg>
    </button>
    <button class="toolbar-btn" id="copyBtn" title="Copy">
      <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <path d="M16 1H4a2 2 0 0 0-2 2v14h2V3h12V1zm3 4H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2zm0 16H8V7h11v14z"/>
      </svg>
    </button>
  </div>
  <div class="editor-container">
    <textarea id="editor" spellcheck="false"></textarea>
    <div class="preview-container" id="previewContainer">
      <div class="var-panel" id="varPanel" style="display:none;">
        <div class="var-panel-title">Variables</div>
        <div id="varInputs"></div>
      </div>
      <div class="preview" id="preview"></div>
    </div>
  </div>
  ` : `
  <div class="editor-container">
    <div class="empty-state">Select a prompt to edit</div>
  </div>
  `}

<script>
  const vscode = acquireVsCodeApi();
  const hasFile = ${hasFile};

  if (hasFile) {
    const initialContent = \`${content}\`;
    const editor = document.getElementById('editor');
    const previewContainer = document.getElementById('previewContainer');
    const preview = document.getElementById('preview');
    const varPanel = document.getElementById('varPanel');
    const varInputs = document.getElementById('varInputs');
    const saveIndicator = document.getElementById('saveIndicator');
    const previewBtn = document.getElementById('previewBtn');
    const previewIcon = document.getElementById('previewIcon');
    const copyBtn = document.getElementById('copyBtn');

    let isPreview = ${startInPreview};
    let saveTimer = null;
    let currentContent = initialContent;
    let varValues = {};

    const eyeSvg = '<path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/>';
    const pencilSvg = '<path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>';

    editor.value = initialContent;

    // Start in correct mode
    if (isPreview) {
      enterPreview();
    }

    editor.addEventListener('input', () => {
      currentContent = editor.value;
      saveIndicator.textContent = 'saving...';
      saveIndicator.classList.add('visible');
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        vscode.postMessage({ type: 'save', content: editor.value });
        saveIndicator.textContent = 'saved';
        setTimeout(() => saveIndicator.classList.remove('visible'), 1500);
      }, 500);
    });

    editor.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') {
        e.preventDefault();
        const start = editor.selectionStart;
        const end = editor.selectionEnd;
        editor.value = editor.value.substring(0, start) + '  ' + editor.value.substring(end);
        editor.selectionStart = editor.selectionEnd = start + 2;
        editor.dispatchEvent(new Event('input'));
      }
    });

    previewBtn.addEventListener('click', () => {
      isPreview = !isPreview;
      previewBtn.classList.toggle('active', isPreview);
      previewIcon.innerHTML = isPreview ? pencilSvg : eyeSvg;
      previewBtn.title = isPreview ? 'Edit' : 'Preview';
      vscode.postMessage({ type: 'modeChange', isPreview });
      if (isPreview) {
        enterPreview();
      } else {
        exitPreview();
      }
    });

    function enterPreview() {
      const vars = extractVars(currentContent);
      if (vars.length > 0) {
        varPanel.style.display = 'block';
        renderVarInputs(vars);
      } else {
        varPanel.style.display = 'none';
      }
      updatePreviewContent();
      previewContainer.style.display = 'flex';
      editor.style.display = 'none';
    }

    function exitPreview() {
      editor.style.display = 'block';
      previewContainer.style.display = 'none';
      editor.focus();
    }

    // --- Variable handling ---
    function extractVars(text) {
      const regex = /\\{\\{\\s*([A-Za-z_][A-Za-z0-9_]*)\\s*\\}\\}/g;
      const found = new Set();
      let m;
      while ((m = regex.exec(text)) !== null) {
        found.add(m[1]);
      }
      return Array.from(found);
    }

    function renderVarInputs(vars) {
      varInputs.innerHTML = '';
      vars.forEach(v => {
        const row = document.createElement('div');
        row.className = 'var-row';
        const label = document.createElement('span');
        label.className = 'var-label';
        label.textContent = v;
        const input = document.createElement('input');
        input.className = 'var-input';
        input.type = 'text';
        input.placeholder = v;
        input.value = varValues[v] || '';
        input.addEventListener('input', () => {
          varValues[v] = input.value;
          updatePreviewContent();
        });
        row.appendChild(label);
        row.appendChild(input);
        varInputs.appendChild(row);
      });
    }

    function substituteVars(text) {
      return text.replace(/\\{\\{\\s*([A-Za-z_][A-Za-z0-9_]*)\\s*\\}\\}/g, (match, name) => {
        return varValues[name] || match;
      });
    }

    function updatePreviewContent() {
      const substituted = substituteVars(currentContent);
      preview.innerHTML = renderMarkdownPreview(substituted, varValues);
    }

    copyBtn.addEventListener('click', () => {
      let textToCopy = currentContent;
      if (isPreview) {
        textToCopy = substituteVars(currentContent);
      }
      vscode.postMessage({ type: 'copy', content: textToCopy });
    });

    function renderMarkdownPreview(text, vars) {
      if (!text) return '<p style="opacity:0.5">Empty prompt</p>';
      let html = escapeHtml(text);

      // Template vars in preview
      html = html.replace(/\\{\\{\\s*([A-Za-z_][A-Za-z0-9_]*)\\s*\\}\\}/g, (match, name) => {
        const filled = vars && vars[name];
        return '<span class="template-var' + (filled ? ' filled' : '') + '">' + (filled ? escapeHtml(vars[name]) : match) + '</span>';
      });

      html = html.replace(/\`\`\`(\\w*)\\n([\\s\\S]*?)\`\`\`/g, '<pre><code>$2</code></pre>');
      html = html.replace(/\`([^\`]+)\`/g, '<code>$1</code>');
      html = html.replace(/^#### (.+)$/gm, '<h4>$1</h4>');
      html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
      html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
      html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
      html = html.replace(/\\*\\*(.+?)\\*\\*/g, '<strong>$1</strong>');
      html = html.replace(/\\*(.+?)\\*/g, '<em>$1</em>');
      html = html.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');
      html = html.replace(/^[\\-\\*] (.+)$/gm, '<li>$1</li>');
      html = html.replace(/(<li>.*<\\/li>\\n?)+/g, '<ul>$&</ul>');
      html = html.replace(/^\\d+\\. (.+)$/gm, '<li>$1</li>');
      html = html.replace(/\\n\\n/g, '</p><p>');
      html = html.replace(/\\n/g, '<br>');
      html = '<p>' + html + '</p>';
      html = html.replace(/<p><(h[1-4]|pre|ul|ol|blockquote)/g, '<$1');
      html = html.replace(/<\\/(h[1-4]|pre|ul|ol|blockquote)><\\/p>/g, '</$1>');
      return html;
    }

    function escapeHtml(text) {
      return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
  }
</script>
</body>
</html>`;
  }
}
