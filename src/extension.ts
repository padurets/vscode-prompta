import * as vscode from 'vscode';
import * as path from 'path';
import { PromptsTreeProvider } from './promptaTreeProvider';
import { PromptaInspectorView } from './promptaInspectorView';
import { VariablesRegistry } from './promptaVariables';

export function activate(context: vscode.ExtensionContext) {
  const globalProvider = new PromptsTreeProvider('global');
  const projectProvider = new PromptsTreeProvider('project');

  const variables = new VariablesRegistry(
    () => globalProvider.folder,
    () => projectProvider.folder
  );
  context.subscriptions.push({ dispose: () => variables.dispose() });

  const pickSaveTarget = async (): Promise<'global' | 'project' | undefined> => {
    const picked = await vscode.window.showQuickPick(
      [
        {
          label: '$(globe) Save to Global',
          description: variables.globalEnvPath() ?? '(no global folder)',
          target: 'global' as const,
        },
        {
          label: '$(root-folder) Save to Project',
          description: variables.projectEnvPath() ?? '(no workspace)',
          target: 'project' as const,
        },
      ],
      { placeHolder: 'Where to save?' }
    );
    return picked?.target;
  };

  const inspector = new PromptaInspectorView(context.extensionUri, variables, pickSaveTarget);
  context.subscriptions.push(inspector);

  const globalTreeView = vscode.window.createTreeView('promptaGlobalTreeView', {
    treeDataProvider: globalProvider,
    dragAndDropController: globalProvider,
    canSelectMany: true,
  });

  const projectTreeView = vscode.window.createTreeView('promptaProjectTreeView', {
    treeDataProvider: projectProvider,
    dragAndDropController: projectProvider,
    canSelectMany: true,
  });

  context.subscriptions.push(globalTreeView, projectTreeView);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      PromptaInspectorView.viewType,
      inspector,
      { webviewOptions: { retainContextWhenHidden: true } }
    )
  );

  const INSPECTOR_SCHEMES = new Set(['file', 'untitled']);

  const isInspectorTarget = (doc: vscode.TextDocument): boolean => {
    if (!INSPECTOR_SCHEMES.has(doc.uri.scheme)) return false;
    const base = path.basename(doc.uri.fsPath);
    if (base === 'prompta.env') return false;
    return true;
  };

  const syncInspectorFromEditor = (editor: vscode.TextEditor | undefined): void => {
    if (!editor) return;
    if (isInspectorTarget(editor.document)) {
      inspector.setActiveFile(editor.document.uri.fsPath, editor.document.getText());
    }
  };

  // Shared commands
  context.subscriptions.push(
    vscode.commands.registerCommand('prompta.openInPane', async (arg?: any) => {
      let uri: vscode.Uri | undefined;
      if (arg?.resourceUri) uri = arg.resourceUri;
      else if (arg instanceof vscode.Uri) uri = arg;
      else {
        const sel = globalTreeView.selection.length > 0 ? globalTreeView.selection : projectTreeView.selection;
        if (sel.length > 0 && !sel[0].isDirectory) uri = sel[0].resourceUri;
      }
      if (!uri) return;

      const doc = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(doc, {
        viewColumn: vscode.ViewColumn.One,
        preview: true,
        preserveFocus: false,
      });
      // Inspector picks this up via onDidChangeActiveTextEditor.
    }),
    vscode.commands.registerCommand('prompta.openFileInMainEditor', async (item?: any) => {
      let uri: vscode.Uri | undefined;
      if (item?.resourceUri) {
        uri = item.resourceUri;
      } else if (item instanceof vscode.Uri) {
        uri = item;
      } else {
        const sel = globalTreeView.selection.length > 0
          ? globalTreeView.selection
          : projectTreeView.selection;
        if (sel.length > 0 && !sel[0].isDirectory) {
          uri = sel[0].resourceUri;
        }
      }
      if (uri) {
        await vscode.window.showTextDocument(uri, { preview: false });
      }
    }),
    vscode.commands.registerCommand('prompta.rename', (item) => {
      const provider = resolveProvider(item, globalProvider, projectProvider);
      provider?.renameItem(item);
    }),
    vscode.commands.registerCommand('prompta.delete', (item) => {
      const provider = resolveProvider(item, globalProvider, projectProvider);
      provider?.deleteItem(item);
    }),
    vscode.commands.registerCommand('prompta.toggleSidebar', () => {
      vscode.commands.executeCommand('workbench.view.extension.prompta');
    }),
    vscode.commands.registerCommand('prompta.copyPath', (item) => {
      if (!item?.resourceUri) return;
      vscode.env.clipboard.writeText(item.resourceUri.fsPath);
    }),
    vscode.commands.registerCommand('prompta.copyRelativePath', (item) => {
      if (!item?.resourceUri) return;
      const wsFolder = vscode.workspace.workspaceFolders?.[0];
      if (wsFolder) {
        const relative = path.relative(wsFolder.uri.fsPath, item.resourceUri.fsPath);
        vscode.env.clipboard.writeText(relative);
      } else {
        vscode.env.clipboard.writeText(item.resourceUri.fsPath);
      }
    }),
    vscode.commands.registerCommand('prompta.editGlobalEnv', () => variables.editGlobal()),
    vscode.commands.registerCommand('prompta.editProjectEnv', () => variables.editProject()),
    vscode.commands.registerCommand('prompta.reloadVariables', () => variables.reload()),
    vscode.commands.registerCommand('prompta.copyWithSubstitutions', () =>
      inspector.postToWebview({ type: 'initiateCopy' })
    ),
    vscode.commands.registerCommand('prompta.useGlobalForAll', () =>
      inspector.postToWebview({ type: 'bulkSwitch', target: 'global' })
    ),
    vscode.commands.registerCommand('prompta.useProjectForAll', () =>
      inspector.postToWebview({ type: 'bulkSwitch', target: 'project' })
    ),
    vscode.commands.registerCommand('prompta.useCustomForAll', () =>
      inspector.postToWebview({ type: 'bulkSwitch', target: 'custom' })
    ),
    vscode.commands.registerCommand('prompta.saveAllAsGlobal', () =>
      inspector.postToWebview({ type: 'initiateSaveAll', target: 'global' })
    ),
    vscode.commands.registerCommand('prompta.saveAllAsProject', () =>
      inspector.postToWebview({ type: 'initiateSaveAll', target: 'project' })
    )
  );

  // Global commands
  context.subscriptions.push(
    vscode.commands.registerCommand('prompta.global.newFile', (item) => globalProvider.createFile(item)),
    vscode.commands.registerCommand('prompta.global.newFolder', (item) => globalProvider.createFolder(item)),
    vscode.commands.registerCommand('prompta.global.refresh', () => globalProvider.refresh()),
    vscode.commands.registerCommand('prompta.global.setFolder', () => globalProvider.setFolder())
  );

  // Project commands
  context.subscriptions.push(
    vscode.commands.registerCommand('prompta.project.newFile', (item) => projectProvider.createFile(item)),
    vscode.commands.registerCommand('prompta.project.newFolder', (item) => projectProvider.createFolder(item)),
    vscode.commands.registerCommand('prompta.project.refresh', () => projectProvider.refresh()),
    vscode.commands.registerCommand('prompta.project.setFolder', () => projectProvider.setFolder())
  );

  // Keep inspector in sync with the active editor
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      syncInspectorFromEditor(editor);
    }),
    vscode.workspace.onDidChangeTextDocument((e) => {
      const active = vscode.window.activeTextEditor;
      if (!active || active.document.uri.toString() !== e.document.uri.toString()) return;
      if (isInspectorTarget(e.document)) {
        inspector.setActiveFile(e.document.uri.fsPath, e.document.getText());
      }
    })
  );

  // Configuration changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('prompta.globalFolder')) {
        globalProvider.refresh();
        variables.resetWatchers();
        variables.reload();
      }
      if (e.affectsConfiguration('prompta.projectFolder')) {
        projectProvider.refresh();
        variables.resetWatchers();
        variables.reload();
      }
      if (e.affectsConfiguration('prompta.fontSize')) {
        inspector.rerender();
      }
    })
  );

  // Workspace folder changes — refresh project tree and env watchers
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      projectProvider.refresh();
      variables.resetWatchers();
      variables.reload();
    })
  );

  // File system watchers — scoped per prompts folder so we don't react
  // to every change in the workspace.
  let treeWatchers: vscode.Disposable[] = [];
  const resetTreeWatchers = (): void => {
    treeWatchers.forEach((d) => d.dispose());
    treeWatchers = [];

    const targets: Array<{ folder: string; provider: PromptsTreeProvider }> = [];
    if (globalProvider.folder) targets.push({ folder: globalProvider.folder, provider: globalProvider });
    if (projectProvider.folder) targets.push({ folder: projectProvider.folder, provider: projectProvider });

    for (const { folder, provider } of targets) {
      const watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(folder, '**/*')
      );
      const refresh = () => provider.refresh();
      treeWatchers.push(
        watcher.onDidCreate(refresh),
        watcher.onDidDelete(refresh),
        watcher.onDidChange(refresh),
        watcher
      );
    }
  };
  resetTreeWatchers();
  context.subscriptions.push({ dispose: () => treeWatchers.forEach((d) => d.dispose()) });

  // Re-arm watchers when folders move.
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('prompta.globalFolder') || e.affectsConfiguration('prompta.projectFolder')) {
        resetTreeWatchers();
      }
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => resetTreeWatchers())
  );
}

function resolveProvider(
  item: any,
  globalProvider: PromptsTreeProvider,
  projectProvider: PromptsTreeProvider
): PromptsTreeProvider | undefined {
  if (!item?.resourceUri) return undefined;
  const fsPath = item.resourceUri.fsPath || item.resourceUri.path;
  const globalFolder = globalProvider.folder;
  const projectFolder = projectProvider.folder;
  if (globalFolder && fsPath.startsWith(globalFolder)) return globalProvider;
  if (projectFolder && fsPath.startsWith(projectFolder)) return projectProvider;
  return undefined;
}

export function deactivate() {}
