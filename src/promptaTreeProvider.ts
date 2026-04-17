import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export type SectionKind = 'global' | 'custom';

export interface FolderEntry {
  name: string;
  path: string;
}

export interface ResolvedSection {
  kind: SectionKind;
  name: string;
  folderPath: string;
}

export class SectionItem extends vscode.TreeItem {
  public readonly folderPath: string;
  public readonly sectionKind: SectionKind;

  constructor(section: ResolvedSection) {
    super(section.name, vscode.TreeItemCollapsibleState.Expanded);
    this.folderPath = section.folderPath;
    this.sectionKind = section.kind;
    this.id = `section:${section.folderPath}`;
    this.tooltip = section.folderPath;
    this.resourceUri = vscode.Uri.file(section.folderPath);
    this.contextValue = section.kind === 'custom' ? 'section-custom' : 'section';
    this.iconPath = new vscode.ThemeIcon(
      section.kind === 'global' ? 'globe' : 'folder-library'
    );
  }
}

export class PromptItem extends vscode.TreeItem {
  public readonly isDirectory: boolean;

  constructor(
    label: string,
    public readonly resourceUri: vscode.Uri,
    isDirectory: boolean,
    collapsibleState: vscode.TreeItemCollapsibleState
  ) {
    super(label, collapsibleState);
    this.isDirectory = isDirectory;
    this.id = resourceUri.fsPath;
    this.tooltip = resourceUri.fsPath;

    if (isDirectory) {
      this.contextValue = 'folder';
      this.iconPath = vscode.ThemeIcon.Folder;
    } else {
      this.contextValue = 'file';
      this.iconPath = vscode.ThemeIcon.File;
      this.command = {
        command: 'prompta.openInInspector',
        title: 'Open in Inspector',
        arguments: [resourceUri],
      };
    }
  }
}

export type TreeNode = SectionItem | PromptItem;

export class PromptsTreeProvider
  implements vscode.TreeDataProvider<TreeNode>, vscode.TreeDragAndDropController<TreeNode>
{
  static readonly viewId = 'promptaPromptsView';

  readonly dropMimeTypes = [`application/vnd.code.tree.${PromptsTreeProvider.viewId}`];
  readonly dragMimeTypes = [`application/vnd.code.tree.${PromptsTreeProvider.viewId}`];

  private _onDidChangeTreeData = new vscode.EventEmitter<TreeNode | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private _sections: ResolvedSection[] = [];

  constructor(
    private readonly _getOrder: () => string[],
    private readonly _setOrder: (order: string[]) => void
  ) {
    this._sections = this._resolveSections();
    this._ensureBuiltInFolders();
  }

  get globalFolder(): string | undefined {
    return this._sections.find((s) => s.kind === 'global')?.folderPath;
  }

  get projectFolder(): string | undefined {
    return this._resolveProjectFolder();
  }

  get allFolders(): string[] {
    return this._sections.map((s) => s.folderPath);
  }

  refresh(): void {
    this._sections = this._resolveSections();
    this._ensureBuiltInFolders();
    this._onDidChangeTreeData.fire();
  }

  // -- TreeDataProvider --

  getTreeItem(element: TreeNode): vscode.TreeItem {
    return element;
  }

  getChildren(element?: TreeNode): Thenable<TreeNode[]> {
    if (!element) {
      return Promise.resolve(this._sections.map((s) => new SectionItem(s)));
    }
    if (element instanceof SectionItem) {
      return this._readFolder(element.folderPath);
    }
    if (element instanceof PromptItem && element.isDirectory) {
      return this._readFolder(element.resourceUri.fsPath);
    }
    return Promise.resolve([]);
  }

  getParent(element: TreeNode): vscode.ProviderResult<TreeNode> {
    if (element instanceof SectionItem) return undefined;

    const section = this._findSectionForPath(element.resourceUri.fsPath);
    if (!section) return undefined;

    const parentPath = path.dirname(element.resourceUri.fsPath);
    if (parentPath === section.folderPath) {
      return new SectionItem(section);
    }
    if (!parentPath.startsWith(section.folderPath)) {
      return undefined;
    }
    return new PromptItem(
      path.basename(parentPath),
      vscode.Uri.file(parentPath),
      true,
      vscode.TreeItemCollapsibleState.Collapsed
    );
  }

  // -- DnD (within same section only) --

  handleDrag(
    source: readonly TreeNode[],
    dataTransfer: vscode.DataTransfer,
    _token: vscode.CancellationToken
  ): void {
    const uris = source.map((item) =>
      item instanceof SectionItem
        ? `section:${item.folderPath}`
        : item.resourceUri.toString()
    );
    dataTransfer.set(
      `application/vnd.code.tree.${PromptsTreeProvider.viewId}`,
      new vscode.DataTransferItem(uris)
    );
  }

  async handleDrop(
    target: TreeNode | undefined,
    dataTransfer: vscode.DataTransfer,
    _token: vscode.CancellationToken
  ): Promise<void> {
    const transferItem = dataTransfer.get(
      `application/vnd.code.tree.${PromptsTreeProvider.viewId}`
    );
    if (!transferItem || !target) return;

    const uris: string[] = transferItem.value;
    if (uris.length === 0) return;

    const sectionPaths = uris.filter((u) => u.startsWith('section:')).map((u) => u.slice(8));
    if (sectionPaths.length > 0 && target instanceof SectionItem) {
      this._reorderSections(sectionPaths, target);
      return;
    }

    let targetFolder: string;
    if (target instanceof SectionItem) {
      targetFolder = target.folderPath;
    } else if (target.isDirectory) {
      targetFolder = target.resourceUri.fsPath;
    } else {
      targetFolder = path.dirname(target.resourceUri.fsPath);
    }

    const targetSection = this._findSectionForPath(targetFolder);
    if (!targetSection) return;

    for (const uriStr of uris) {
      const sourceUri = vscode.Uri.parse(uriStr);
      const sourcePath = sourceUri.fsPath;

      const sourceSection = this._findSectionForPath(sourcePath);
      if (!sourceSection || sourceSection.folderPath !== targetSection.folderPath) continue;

      const baseName = path.basename(sourcePath);
      let destPath = path.join(targetFolder, baseName);
      if (sourcePath === destPath) continue;
      if (destPath.startsWith(sourcePath + path.sep)) {
        vscode.window.showErrorMessage('Cannot move a folder into itself.');
        continue;
      }

      destPath = this._getUniqueDestPath(destPath);
      try {
        await fs.promises.rename(sourcePath, destPath);
      } catch (err: any) {
        vscode.window.showErrorMessage(`Failed to move ${baseName}: ${err.message}`);
      }
    }

    this.refresh();
  }

  // -- File operations --

  async createFile(targetItem?: TreeNode): Promise<void> {
    const targetFolder = await this._resolveTargetFolderOrPick(targetItem);
    if (!targetFolder) return;

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

    await fs.promises.writeFile(filePath, '', 'utf-8');
    this.refresh();
    vscode.commands.executeCommand('prompta.openInPane', vscode.Uri.file(filePath));
  }

  async createFolder(targetItem?: TreeNode): Promise<void> {
    const targetFolder = await this._resolveTargetFolderOrPick(targetItem);
    if (!targetFolder) return;

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

    await fs.promises.mkdir(folderPath, { recursive: true });
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
      await fs.promises.rename(oldPath, newPath);
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
      await fs.promises.rm(itemPath, { recursive: true, force: true });
      this.refresh();
    } catch (err: any) {
      vscode.window.showErrorMessage(`Delete failed: ${err.message}`);
    }
  }

  // -- Section management --

  async setGlobalFolder(): Promise<void> {
    const result = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      title: 'Select Global Prompts Folder',
    });
    if (!result || result.length === 0) return;
    const config = vscode.workspace.getConfiguration('prompta');
    await config.update('globalFolder', result[0].fsPath, vscode.ConfigurationTarget.Global);
    this.refresh();
  }

  async addGlobalFolder(): Promise<void> {
    await this._addFolderToScope(vscode.ConfigurationTarget.Global, 'Select Global Folder');
  }

  async addWorkspaceFolder(): Promise<void> {
    await this._addFolderToScope(vscode.ConfigurationTarget.Workspace, 'Select Workspace Folder');
  }

  async renameSection(section: SectionItem): Promise<void> {
    if (section.sectionKind !== 'custom') {
      vscode.window.showWarningMessage('Built-in sections cannot be renamed.');
      return;
    }

    const newName = await vscode.window.showInputBox({
      prompt: 'Enter new name for this section',
      value: section.label as string,
    });
    if (!newName || newName === section.label) return;

    const config = vscode.workspace.getConfiguration('prompta');
    const inspected = config.inspect<FolderEntry[]>('folders');

    const workspaceFolders = [...(inspected?.workspaceValue ?? [])];
    const wIdx = workspaceFolders.findIndex((f) => this._resolvePath(f.path) === section.folderPath);
    if (wIdx >= 0) {
      workspaceFolders[wIdx] = { ...workspaceFolders[wIdx], name: newName };
      await config.update('folders', workspaceFolders, vscode.ConfigurationTarget.Workspace);
      this.refresh();
      return;
    }

    const globalFolders = [...(inspected?.globalValue ?? [])];
    const gIdx = globalFolders.findIndex((f) => this._resolvePath(f.path) === section.folderPath);
    if (gIdx >= 0) {
      globalFolders[gIdx] = { ...globalFolders[gIdx], name: newName };
      await config.update('folders', globalFolders, vscode.ConfigurationTarget.Global);
      this.refresh();
    }
  }

  private async _addFolderToScope(
    target: vscode.ConfigurationTarget,
    title: string
  ): Promise<void> {
    const result = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      title,
    });
    if (!result || result.length === 0) return;

    const folderPath = result[0].fsPath;
    const name = await vscode.window.showInputBox({
      prompt: 'Display name for this folder',
      value: path.basename(folderPath),
    });
    if (!name) return;

    const config = vscode.workspace.getConfiguration('prompta');
    const inspected = config.inspect<FolderEntry[]>('folders');
    const existing =
      target === vscode.ConfigurationTarget.Global
        ? [...(inspected?.globalValue ?? [])]
        : [...(inspected?.workspaceValue ?? [])];

    existing.push({ name, path: folderPath });
    await config.update('folders', existing, target);
    this.refresh();
  }

  async removeSection(section: SectionItem): Promise<void> {
    if (section.sectionKind !== 'custom') {
      vscode.window.showWarningMessage('Built-in sections cannot be removed.');
      return;
    }

    const config = vscode.workspace.getConfiguration('prompta');
    const inspected = config.inspect<FolderEntry[]>('folders');

    const workspaceFolders = [...(inspected?.workspaceValue ?? [])];
    const wIdx = workspaceFolders.findIndex((f) => this._resolvePath(f.path) === section.folderPath);
    if (wIdx >= 0) {
      workspaceFolders.splice(wIdx, 1);
      await config.update(
        'folders',
        workspaceFolders.length ? workspaceFolders : undefined,
        vscode.ConfigurationTarget.Workspace
      );
      this.refresh();
      return;
    }

    const globalFolders = [...(inspected?.globalValue ?? [])];
    const gIdx = globalFolders.findIndex((f) => this._resolvePath(f.path) === section.folderPath);
    if (gIdx >= 0) {
      globalFolders.splice(gIdx, 1);
      await config.update(
        'folders',
        globalFolders.length ? globalFolders : undefined,
        vscode.ConfigurationTarget.Global
      );
      this.refresh();
    }
  }

  private _reorderSections(sourcePaths: string[], target: SectionItem): void {
    const order = this._sections.map((s) => s.folderPath);
    for (const sp of sourcePaths) {
      const idx = order.indexOf(sp);
      if (idx >= 0) order.splice(idx, 1);
    }
    const targetIdx = order.indexOf(target.folderPath);
    if (targetIdx >= 0) {
      order.splice(targetIdx, 0, ...sourcePaths);
    } else {
      order.push(...sourcePaths);
    }
    this._setOrder(order);
    this.refresh();
  }

  // -- Private helpers --

  private _resolveSections(): ResolvedSection[] {
    const sections: ResolvedSection[] = [];

    const globalPath = this._resolveGlobalFolder();
    sections.push({ kind: 'global', name: 'Global Prompts', folderPath: globalPath });

    const config = vscode.workspace.getConfiguration('prompta');
    const inspected = config.inspect<FolderEntry[]>('folders');
    const userFolders = inspected?.globalValue ?? [];
    const workspaceFolders = inspected?.workspaceValue ?? [];

    for (const entry of [...userFolders, ...workspaceFolders]) {
      const resolved = this._resolvePath(entry.path);
      if (resolved === globalPath) continue;
      if (sections.some((s) => s.folderPath === resolved)) continue;
      sections.push({ kind: 'custom', name: entry.name, folderPath: resolved });
    }

    const order = this._getOrder();
    if (order.length > 0) {
      sections.sort((a, b) => {
        const ai = order.indexOf(a.folderPath);
        const bi = order.indexOf(b.folderPath);
        return (ai >= 0 ? ai : order.length) - (bi >= 0 ? bi : order.length);
      });
    }

    return sections;
  }

  private _resolveGlobalFolder(): string {
    const config = vscode.workspace.getConfiguration('prompta');
    const configured = config.get<string>('globalFolder', '');
    if (configured && configured.trim() !== '') {
      return this._resolvePath(configured);
    }
    return path.join(process.env.HOME || '', 'Prompta', 'prompts');
  }

  private _resolveProjectFolder(): string | undefined {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) return undefined;
    const config = vscode.workspace.getConfiguration('prompta');
    const relative = config.get<string>('projectFolder', '.prompta');
    return path.join(workspaceFolders[0].uri.fsPath, relative);
  }

  private _resolvePath(p: string): string {
    return p.startsWith('~') ? p.replace('~', process.env.HOME || '') : p;
  }

  private _ensureBuiltInFolders(): void {
    for (const s of this._sections) {
      if (s.kind === 'global' && s.folderPath && !fs.existsSync(s.folderPath)) {
        fs.mkdirSync(s.folderPath, { recursive: true });
      }
    }
  }

  private _findSectionForPath(fsPath: string): ResolvedSection | undefined {
    return this._sections
      .filter((s) => fsPath === s.folderPath || fsPath.startsWith(s.folderPath + path.sep))
      .sort((a, b) => b.folderPath.length - a.folderPath.length)[0];
  }

  private _readFolder(folderPath: string): Thenable<PromptItem[]> {
    if (!fs.existsSync(folderPath)) return Promise.resolve([]);
    try {
      const entries = fs.readdirSync(folderPath, { withFileTypes: true });
      return Promise.resolve(
        entries
          .filter((e) => !e.name.startsWith('.') && e.name !== 'prompta.env')
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
          })
      );
    } catch {
      return Promise.resolve([]);
    }
  }

  private async _resolveTargetFolderOrPick(item?: TreeNode): Promise<string | undefined> {
    if (item) {
      if (item instanceof SectionItem) return item.folderPath;
      if (item.isDirectory) return item.resourceUri.fsPath;
      return path.dirname(item.resourceUri.fsPath);
    }
    const section = await this._pickSection();
    return section?.folderPath;
  }

  private async _pickSection(): Promise<ResolvedSection | undefined> {
    if (this._sections.length === 1) return this._sections[0];
    const picked = await vscode.window.showQuickPick(
      this._sections.map((s) => ({ label: s.name, description: s.folderPath, section: s })),
      { placeHolder: 'Select folder' }
    );
    return picked?.section;
  }

  private _getUniqueDestPath(destPath: string): string {
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
}
