import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { PromptsTreeProvider, SectionItem, PromptItem } from './promptaTreeProvider';
import { PromptaInspectorView } from './promptaInspectorView';
import { VariablesRegistry } from './promptaVariables';

export function activate(context: vscode.ExtensionContext) {
  const ORDER_KEY = 'prompta.sectionOrder';
  const treeProvider = new PromptsTreeProvider(
    () => context.globalState.get<string[]>(ORDER_KEY, []),
    (order) => { context.globalState.update(ORDER_KEY, order); }
  );

  const variables = new VariablesRegistry(
    () => treeProvider.globalFolder,
    () => treeProvider.projectFolder
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

  const treeView = vscode.window.createTreeView(PromptsTreeProvider.viewId, {
    treeDataProvider: treeProvider,
    dragAndDropController: treeProvider,
    canSelectMany: true,
  });
  context.subscriptions.push(treeView);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      PromptaInspectorView.viewType,
      inspector,
      { webviewOptions: { retainContextWhenHidden: true } }
    )
  );

  vscode.commands.executeCommand('setContext', 'prompta.inspectorAutoPickup', inspector.autoPickup);

  inspector.onAutoPickupChanged((enabled) => {
    if (enabled) syncInspectorFromEditor(vscode.window.activeTextEditor);
  });

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

  const resolveUriFromArg = (arg: any): vscode.Uri | undefined => {
    if (arg?.resourceUri && !(arg instanceof SectionItem)) return arg.resourceUri;
    if (arg instanceof vscode.Uri) return arg;
    const sel = treeView.selection;
    if (sel.length > 0) {
      const first = sel[0];
      if (first instanceof PromptItem && !first.isDirectory) return first.resourceUri;
    }
    return undefined;
  };

  // Tree commands
  context.subscriptions.push(
    vscode.commands.registerCommand('prompta.newFile', (item) => treeProvider.createFile(item)),
    vscode.commands.registerCommand('prompta.newFolder', (item) => treeProvider.createFolder(item)),
    vscode.commands.registerCommand('prompta.refresh', () => treeProvider.refresh()),
    vscode.commands.registerCommand('prompta.rename', (item) => treeProvider.renameItem(item)),
    vscode.commands.registerCommand('prompta.delete', (item) => treeProvider.deleteItem(item)),
    vscode.commands.registerCommand('prompta.setDefaultGlobalFolder', () => treeProvider.setGlobalFolder()),
    vscode.commands.registerCommand('prompta.addGlobalFolder', () => treeProvider.addGlobalFolder()),
    vscode.commands.registerCommand('prompta.addWorkspaceFolder', () => treeProvider.addWorkspaceFolder()),
    vscode.commands.registerCommand('prompta.renameSection', (item) => {
      if (item instanceof SectionItem) treeProvider.renameSection(item);
    }),
    vscode.commands.registerCommand('prompta.removeSection', (item) => {
      if (item instanceof SectionItem) treeProvider.removeSection(item);
    })
  );

  // File commands
  context.subscriptions.push(
    vscode.commands.registerCommand('prompta.editFile', async (item?: any) => {
      const uri = resolveUriFromArg(item);
      if (!uri) return;
      const doc = await vscode.workspace.openTextDocument(uri);
      inspector.setActiveFile(uri.fsPath, doc.getText(), { explicit: true });
      await vscode.window.showTextDocument(doc, { preview: false });
    }),
    vscode.commands.registerCommand('prompta.openInInspector', async (item?: any) => {
      const uri = resolveUriFromArg(item);
      if (!uri) return;
      const doc = await vscode.workspace.openTextDocument(uri);
      inspector.setActiveFile(uri.fsPath, doc.getText(), { explicit: true });
    }),
    vscode.commands.registerCommand('prompta.openInPane', async (arg?: any) => {
      const uri = resolveUriFromArg(arg);
      if (!uri) return;
      const doc = await vscode.workspace.openTextDocument(uri);
      inspector.setActiveFile(uri.fsPath, doc.getText(), { explicit: true });
      await vscode.window.showTextDocument(doc, {
        viewColumn: vscode.ViewColumn.One,
        preview: true,
        preserveFocus: false,
      });
    }),
    vscode.commands.registerCommand('prompta.openFileInMainEditor', (item?: any) => {
      vscode.commands.executeCommand('prompta.editFile', item);
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
        vscode.env.clipboard.writeText(path.relative(wsFolder.uri.fsPath, item.resourceUri.fsPath));
      } else {
        vscode.env.clipboard.writeText(item.resourceUri.fsPath);
      }
    })
  );

  // Inspector commands
  context.subscriptions.push(
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
    ),
    vscode.commands.registerCommand('prompta.inspector.enableAutoPickup', () => inspector.setAutoPickup(true)),
    vscode.commands.registerCommand('prompta.inspector.disableAutoPickup', () => inspector.setAutoPickup(false))
  );

  // Sync inspector with active editor
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      syncInspectorFromEditor(editor);
    }),
    vscode.window.onDidChangeTextEditorSelection((e) => {
      syncInspectorFromEditor(e.textEditor);
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
      if (
        e.affectsConfiguration('prompta.globalFolder') ||
        e.affectsConfiguration('prompta.folders')
      ) {
        treeProvider.refresh();
        variables.resetWatchers();
        variables.reload();
        resetTreeWatchers();
      } else if (e.affectsConfiguration('prompta.projectFolder')) {
        variables.resetWatchers();
        variables.reload();
      }
      if (e.affectsConfiguration('prompta.fontSize')) {
        inspector.rerender();
      }
    })
  );

  // Workspace folder changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      treeProvider.refresh();
      variables.resetWatchers();
      variables.reload();
      resetTreeWatchers();
    })
  );

  // File system watchers — scoped per section folder
  let treeWatchers: vscode.Disposable[] = [];
  const resetTreeWatchers = (): void => {
    treeWatchers.forEach((d) => d.dispose());
    treeWatchers = [];

    for (const folder of treeProvider.allFolders) {
      if (!fs.existsSync(folder)) continue;
      const watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(folder, '**/*')
      );
      const refresh = () => treeProvider.refresh();
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
}

export function deactivate() {}
