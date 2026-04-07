import * as vscode from 'vscode';
import * as path from 'path';
import { PromptsTreeProvider } from './promptaTreeProvider';
import { PromptaEditorViewProvider } from './promptaEditorView';

export function activate(context: vscode.ExtensionContext) {
  const globalProvider = new PromptsTreeProvider('global');
  const projectProvider = new PromptsTreeProvider('project');
  const editorProvider = new PromptaEditorViewProvider(context.extensionUri);

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
      PromptaEditorViewProvider.viewType,
      editorProvider,
      { webviewOptions: { retainContextWhenHidden: true } }
    )
  );

  // Shared commands
  context.subscriptions.push(
    vscode.commands.registerCommand('prompta.openInEditor', (uri: vscode.Uri) => {
      editorProvider.openFile(uri.fsPath);
    }),
    vscode.commands.registerCommand('prompta.rename', (item) => {
      // Determine which provider owns this item
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
    })
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

  // Configuration changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('prompta.globalFolder')) {
        globalProvider.refresh();
      }
      if (e.affectsConfiguration('prompta.projectFolder')) {
        projectProvider.refresh();
      }
      if (e.affectsConfiguration('prompta.fontSize')) {
        editorProvider.rerender();
      }
    })
  );

  // Workspace folder changes — refresh project tree
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      projectProvider.refresh();
    })
  );

  // File system watcher
  const watcher = vscode.workspace.createFileSystemWatcher('**/*');
  context.subscriptions.push(
    watcher.onDidCreate(() => { globalProvider.refresh(); projectProvider.refresh(); }),
    watcher.onDidDelete(() => { globalProvider.refresh(); projectProvider.refresh(); }),
    watcher.onDidChange(() => { globalProvider.refresh(); projectProvider.refresh(); }),
    watcher
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
  return globalProvider;
}

export function deactivate() {}
