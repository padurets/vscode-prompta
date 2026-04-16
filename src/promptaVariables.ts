import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export const ENV_FILE_NAME = 'prompta.env';

export type VarSource = 'global' | 'project' | 'custom';

export function parseDotenv(text: string): Map<string, string> {
  const map = new Map<string, string>();
  const src = text;
  let i = 0;
  const len = src.length;

  const skipLine = () => {
    while (i < len && src[i] !== '\n') i++;
    if (i < len && src[i] === '\n') i++;
  };

  while (i < len) {
    // Skip indentation
    while (i < len && (src[i] === ' ' || src[i] === '\t')) i++;
    if (i >= len) break;

    // Blank line
    if (src[i] === '\n' || src[i] === '\r') { i++; continue; }

    // Comment line
    if (src[i] === '#') { skipLine(); continue; }

    // Read key
    const keyStart = i;
    while (i < len && src[i] !== '=' && src[i] !== '\n') i++;
    if (i >= len || src[i] === '\n') { skipLine(); continue; }
    const key = src.slice(keyStart, i).trim();
    i++; // consume '='

    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) { skipLine(); continue; }

    // Skip spaces (not newlines) before value
    while (i < len && (src[i] === ' ' || src[i] === '\t')) i++;

    let value = '';
    const q = src[i];
    if (q === '"' || q === "'") {
      const isDouble = q === '"';
      i++; // consume opening quote
      while (i < len) {
        const c = src[i];
        if (c === q) { i++; break; }
        if (isDouble && c === '\\' && i + 1 < len) {
          const nx = src[i + 1];
          if (nx === 'n') value += '\n';
          else if (nx === 'r') value += '\r';
          else if (nx === 't') value += '\t';
          else if (nx === '\\') value += '\\';
          else if (nx === '"') value += '"';
          else value += nx;
          i += 2;
        } else {
          value += c;
          i++;
        }
      }
      // Discard rest of line (trailing comments/whitespace)
      while (i < len && src[i] !== '\n') i++;
    } else {
      // Unquoted value — until newline or inline comment (# preceded by whitespace)
      while (i < len && src[i] !== '\n') {
        if (src[i] === '#' && value.length > 0 && /\s/.test(value[value.length - 1])) break;
        value += src[i];
        i++;
      }
      value = value.replace(/\s+$/, '');
      while (i < len && src[i] !== '\n') i++;
    }
    if (i < len && src[i] === '\n') i++;
    map.set(key, value);
  }
  return map;
}

function serializeDotenv(map: Map<string, string>): string {
  const lines: string[] = [];
  for (const [k, v] of map) {
    const needsQuotes = v === '' || /[\s#"'\\]/.test(v);
    let value: string;
    if (!needsQuotes) {
      value = v;
    } else {
      // Escape backslashes and double quotes; keep real newlines/tabs literal
      // inside quotes for readability.
      const escaped = v.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      value = `"${escaped}"`;
    }
    lines.push(`${k}=${value}`);
  }
  return lines.join('\n') + (lines.length ? '\n' : '');
}

export class VariablesRegistry {
  private _globalVars = new Map<string, string>();
  private _projectVars = new Map<string, string>();

  private _watchers: vscode.Disposable[] = [];
  private _onChanged = new vscode.EventEmitter<void>();
  public readonly onChanged = this._onChanged.event;

  constructor(
    private readonly _getGlobalFolder: () => string | undefined,
    private readonly _getProjectFolder: () => string | undefined
  ) {
    this.reload();
    this._setupWatchers();
  }

  public dispose(): void {
    this._watchers.forEach((d) => d.dispose());
    this._watchers = [];
    this._onChanged.dispose();
  }

  public reload(): void {
    this._globalVars = this._loadEnv(this._globalEnvPath());
    this._projectVars = this._loadEnv(this._projectEnvPath());
    this._onChanged.fire();
  }

  public resetWatchers(): void {
    this._watchers.forEach((d) => d.dispose());
    this._watchers = [];
    this._setupWatchers();
  }

  public get globalVars(): ReadonlyMap<string, string> {
    return this._globalVars;
  }

  public get projectVars(): ReadonlyMap<string, string> {
    return this._projectVars;
  }

  public globalEnvPath(): string | undefined {
    return this._globalEnvPath();
  }

  public projectEnvPath(): string | undefined {
    return this._projectEnvPath();
  }

  public async editGlobal(): Promise<void> {
    const p = this._globalEnvPath();
    if (!p) {
      vscode.window.showWarningMessage('Global prompts folder is not set.');
      return;
    }
    await this._ensureAndOpen(p);
  }

  public async editProject(): Promise<void> {
    const p = this._projectEnvPath();
    if (!p) {
      vscode.window.showWarningMessage('No workspace is open — project env is unavailable.');
      return;
    }
    await this._ensureAndOpen(p);
  }

  public async save(target: 'global' | 'project', name: string, value: string): Promise<void> {
    const envPath = target === 'global' ? this._globalEnvPath() : this._projectEnvPath();
    if (!envPath) {
      vscode.window.showWarningMessage(
        target === 'project'
          ? 'No workspace is open — cannot save to project env.'
          : 'Global prompts folder is not set.'
      );
      return;
    }

    const dir = path.dirname(envPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const map = this._loadEnv(envPath);
    map.set(name, value);
    fs.writeFileSync(envPath, serializeDotenv(map), 'utf-8');
    this.reload();
  }

  public async saveMany(
    target: 'global' | 'project',
    entries: Array<{ name: string; value: string }>
  ): Promise<void> {
    const envPath = target === 'global' ? this._globalEnvPath() : this._projectEnvPath();
    if (!envPath) return;

    const dir = path.dirname(envPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const map = this._loadEnv(envPath);
    for (const { name, value } of entries) map.set(name, value);
    fs.writeFileSync(envPath, serializeDotenv(map), 'utf-8');
    this.reload();
  }

  private _globalEnvPath(): string | undefined {
    const folder = this._getGlobalFolder();
    return folder ? path.join(folder, ENV_FILE_NAME) : undefined;
  }

  private _projectEnvPath(): string | undefined {
    const folder = this._getProjectFolder();
    return folder ? path.join(folder, ENV_FILE_NAME) : undefined;
  }

  private _loadEnv(p: string | undefined): Map<string, string> {
    if (!p || !fs.existsSync(p)) return new Map();
    try {
      return parseDotenv(fs.readFileSync(p, 'utf-8'));
    } catch {
      return new Map();
    }
  }

  private async _ensureAndOpen(filePath: string): Promise<void> {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, '', 'utf-8');
    const doc = await vscode.workspace.openTextDocument(filePath);
    await vscode.window.showTextDocument(doc, { preview: false });
  }

  private _setupWatchers(): void {
    const paths = [this._globalEnvPath(), this._projectEnvPath()].filter(
      (p): p is string => !!p
    );
    for (const p of paths) {
      const watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(path.dirname(p), path.basename(p))
      );
      watcher.onDidChange(() => this.reload());
      watcher.onDidCreate(() => this.reload());
      watcher.onDidDelete(() => this.reload());
      this._watchers.push(watcher);
    }
  }
}
