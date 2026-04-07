import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export class PromptItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly resourceUri: vscode.Uri,
    public readonly isDirectory: boolean,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState
  ) {
    super(label, collapsibleState);
    this.resourceUri = resourceUri;
    this.tooltip = resourceUri.fsPath;

    if (isDirectory) {
      this.contextValue = 'folder';
      this.iconPath = vscode.ThemeIcon.Folder;
    } else {
      this.contextValue = 'file';
      this.iconPath = vscode.ThemeIcon.File;
      this.command = {
        command: 'prompta.openInEditor',
        title: 'Open Prompt',
        arguments: [resourceUri],
      };
    }
  }
}

export type PromptScope = 'global' | 'project';

export class PromptsTreeProvider
  implements vscode.TreeDataProvider<PromptItem>, vscode.TreeDragAndDropController<PromptItem>
{
  readonly dropMimeTypes: string[];
  readonly dragMimeTypes: string[];

  private _onDidChangeTreeData = new vscode.EventEmitter<PromptItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private _folder: string | undefined;
  private readonly _scope: PromptScope;
  private readonly _viewId: string;

  constructor(scope: PromptScope) {
    this._scope = scope;
    this._viewId = scope === 'global' ? 'promptaGlobalTreeView' : 'promptaProjectTreeView';
    this.dropMimeTypes = [`application/vnd.code.tree.${this._viewId}`];
    this.dragMimeTypes = [`application/vnd.code.tree.${this._viewId}`];
    this._folder = this.resolveFolder();
    if (this._folder) {
      this.ensureFolder(this._folder);
    }
  }

  get folder(): string | undefined {
    return this._folder;
  }

  get scope(): PromptScope {
    return this._scope;
  }

  private resolveFolder(): string | undefined {
    if (this._scope === 'global') {
      return this.resolveGlobalFolder();
    }
    return this.resolveProjectFolder();
  }

  private resolveGlobalFolder(): string {
    const config = vscode.workspace.getConfiguration('prompta');
    const configured = config.get<string>('globalFolder', '');
    if (configured && configured.trim() !== '') {
      return configured.startsWith('~')
        ? configured.replace('~', process.env.HOME || '')
        : configured;
    }
    return path.join(process.env.HOME || '', 'Prompta', 'prompts');
  }

  private resolveProjectFolder(): string | undefined {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      return undefined;
    }
    const config = vscode.workspace.getConfiguration('prompta');
    const relative = config.get<string>('projectFolder', '.prompta');
    return path.join(workspaceFolders[0].uri.fsPath, relative);
  }

  private ensureFolder(folderPath: string): void {
    if (!fs.existsSync(folderPath)) {
      fs.mkdirSync(folderPath, { recursive: true });
    }
  }

  refresh(): void {
    this._folder = this.resolveFolder();
    if (this._folder) {
      this.ensureFolder(this._folder);
    }
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: PromptItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: PromptItem): Thenable<PromptItem[]> {
    if (!this._folder) {
      return Promise.resolve([]);
    }

    const folderPath = element ? element.resourceUri.fsPath : this._folder;

    if (!fs.existsSync(folderPath)) {
      return Promise.resolve([]);
    }

    try {
      const entries = fs.readdirSync(folderPath, { withFileTypes: true });
      const items: PromptItem[] = entries
        .filter((e) => !e.name.startsWith('.'))
        .sort((a, b) => {
          if (a.isDirectory() && !b.isDirectory()) return -1;
          if (!a.isDirectory() && b.isDirectory()) return 1;
          return a.name.localeCompare(b.name);
        })
        .map((entry) => {
          const fullPath = path.join(folderPath, entry.name);
          const isDir = entry.isDirectory();
          return new PromptItem(
            entry.name,
            vscode.Uri.file(fullPath),
            isDir,
            isDir
              ? vscode.TreeItemCollapsibleState.Collapsed
              : vscode.TreeItemCollapsibleState.None
          );
        });
      return Promise.resolve(items);
    } catch {
      return Promise.resolve([]);
    }
  }

  getParent(element: PromptItem): vscode.ProviderResult<PromptItem> {
    if (!this._folder) return undefined;
    const parentPath = path.dirname(element.resourceUri.fsPath);
    if (parentPath === this._folder) {
      return undefined;
    }
    if (!parentPath.startsWith(this._folder)) {
      return undefined;
    }
    const name = path.basename(parentPath);
    return new PromptItem(
      name,
      vscode.Uri.file(parentPath),
      true,
      vscode.TreeItemCollapsibleState.Collapsed
    );
  }

  handleDrag(
    source: readonly PromptItem[],
    dataTransfer: vscode.DataTransfer,
    _token: vscode.CancellationToken
  ): void {
    const uris = source.map((item) => item.resourceUri.toString());
    dataTransfer.set(
      `application/vnd.code.tree.${this._viewId}`,
      new vscode.DataTransferItem(uris)
    );
  }

  async handleDrop(
    target: PromptItem | undefined,
    dataTransfer: vscode.DataTransfer,
    _token: vscode.CancellationToken
  ): Promise<void> {
    if (!this._folder) return;

    const transferItem = dataTransfer.get(`application/vnd.code.tree.${this._viewId}`);
    if (!transferItem) return;

    const uris: string[] = transferItem.value;
    const targetFolder = target
      ? target.isDirectory
        ? target.resourceUri.fsPath
        : path.dirname(target.resourceUri.fsPath)
      : this._folder;

    for (const uriStr of uris) {
      const sourceUri = vscode.Uri.parse(uriStr);
      const sourcePath = sourceUri.fsPath;
      const baseName = path.basename(sourcePath);
      let destPath = path.join(targetFolder, baseName);

      if (sourcePath === destPath) continue;

      if (destPath.startsWith(sourcePath + path.sep)) {
        vscode.window.showErrorMessage(`Cannot move a folder into itself.`);
        continue;
      }

      destPath = this.getUniqueDestPath(destPath);

      try {
        fs.renameSync(sourcePath, destPath);
      } catch (err: any) {
        vscode.window.showErrorMessage(`Failed to move ${baseName}: ${err.message}`);
      }
    }

    this.refresh();
  }

  private getUniqueDestPath(destPath: string): string {
    if (!fs.existsSync(destPath)) return destPath;

    const dir = path.dirname(destPath);
    const ext = path.extname(destPath);
    const baseName = path.basename(destPath, ext);
    let counter = 1;
    let newPath: string;
    do {
      newPath = path.join(dir, `${baseName} (${counter})${ext}`);
      counter++;
    } while (fs.existsSync(newPath));
    return newPath;
  }

  async createFile(targetItem?: PromptItem): Promise<void> {
    if (!this._folder) {
      vscode.window.showWarningMessage('No workspace open. Cannot create project prompts.');
      return;
    }

    const targetFolder = targetItem
      ? targetItem.isDirectory
        ? targetItem.resourceUri.fsPath
        : path.dirname(targetItem.resourceUri.fsPath)
      : this._folder;

    const name = await vscode.window.showInputBox({
      prompt: 'Enter prompt name',
      placeHolder: 'prompt.md',
    });
    if (!name) return;

    const filePath = path.join(targetFolder, name);
    if (fs.existsSync(filePath)) {
      vscode.window.showErrorMessage(`File "${name}" already exists.`);
      return;
    }

    fs.writeFileSync(filePath, '', 'utf-8');
    this.refresh();

    vscode.commands.executeCommand('prompta.openInEditor', vscode.Uri.file(filePath));
  }

  async createFolder(targetItem?: PromptItem): Promise<void> {
    if (!this._folder) {
      vscode.window.showWarningMessage('No workspace open. Cannot create project folders.');
      return;
    }

    const targetFolder = targetItem
      ? targetItem.isDirectory
        ? targetItem.resourceUri.fsPath
        : path.dirname(targetItem.resourceUri.fsPath)
      : this._folder;

    const name = await vscode.window.showInputBox({
      prompt: 'Enter folder name',
      placeHolder: 'subfolder',
    });
    if (!name) return;

    const folderPath = path.join(targetFolder, name);
    if (fs.existsSync(folderPath)) {
      vscode.window.showErrorMessage(`Folder "${name}" already exists.`);
      return;
    }

    fs.mkdirSync(folderPath, { recursive: true });
    this.refresh();
  }

  async renameItem(item: PromptItem): Promise<void> {
    const oldPath = item.resourceUri.fsPath;
    const oldName = path.basename(oldPath);

    const newName = await vscode.window.showInputBox({
      prompt: 'Enter new name',
      value: oldName,
    });
    if (!newName || newName === oldName) return;

    const newPath = path.join(path.dirname(oldPath), newName);
    if (fs.existsSync(newPath)) {
      vscode.window.showErrorMessage(`"${newName}" already exists.`);
      return;
    }

    try {
      fs.renameSync(oldPath, newPath);
      this.refresh();
    } catch (err: any) {
      vscode.window.showErrorMessage(`Rename failed: ${err.message}`);
    }
  }

  async deleteItem(item: PromptItem): Promise<void> {
    const itemPath = item.resourceUri.fsPath;
    const baseName = path.basename(itemPath);

    const confirm = await vscode.window.showWarningMessage(
      `Delete "${baseName}"?`,
      { modal: true },
      'Delete'
    );
    if (confirm !== 'Delete') return;

    try {
      fs.rmSync(itemPath, { recursive: true, force: true });
      this.refresh();
    } catch (err: any) {
      vscode.window.showErrorMessage(`Delete failed: ${err.message}`);
    }
  }

  async setFolder(): Promise<void> {
    if (this._scope === 'project') {
      const input = await vscode.window.showInputBox({
        prompt: 'Enter relative path from workspace root for project prompts',
        value: vscode.workspace.getConfiguration('prompta').get<string>('projectFolder', '.prompta'),
        placeHolder: '.prompta',
      });
      if (!input) return;
      const config = vscode.workspace.getConfiguration('prompta');
      await config.update('projectFolder', input, vscode.ConfigurationTarget.Workspace);
      this.refresh();
      return;
    }

    const result = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      title: 'Select Global Prompts Folder',
    });
    if (!result || result.length === 0) return;

    const folderPath = result[0].fsPath;
    const config = vscode.workspace.getConfiguration('prompta');
    await config.update('globalFolder', folderPath, vscode.ConfigurationTarget.Global);
    this.refresh();
  }
}
