# Changelog

## 0.3.0 — 2026-04-17

### Changed

- **Unified Prompt Explorer.** The separate Global Prompts and Project Prompts trees have been merged into a single "Prompt Explorer" view with collapsible sections.
- **Section-based architecture.** Each prompt folder is now represented as a named section (`Global Prompts`, or a custom display name) with drag-and-drop reordering between sections.
- File operations (`rename`, `move`, `delete`, `create`) now use non-blocking async I/O instead of synchronous calls.
- `prompta.projectFolder` config changes now only reload variables, without unnecessary tree refresh.

### Added

- **Custom folders.** Add any folder as a prompt section via `Add Global Folder...` / `Add Workspace Folder...` commands, with configurable display names.
- **Section management** — rename and remove custom sections from the context menu.
- **Pin / Unpin Inspector** — lock the inspector to a specific file so it doesn't follow the active editor.
- **Open in Inspector** command — send any prompt file to the inspector without switching the editor.
- Welcome content shown when the Prompt Explorer tree is empty.
- `prompta.folders` configuration for declaring additional prompt folders in User or Workspace settings.

### Removed

- Separate `promptaGlobalTreeView` / `promptaProjectTreeView` views (replaced by unified `promptaPromptsView`).
- Per-scope commands (`prompta.global.*`, `prompta.project.*`) replaced by unified commands.
- `viewsWelcome` entries for the old split views.

### Fixed / Improved

- Hardened webview HTML escaping — `<` is now escaped to prevent potential `</script>` injection.
- Section ordering is persisted via `globalState` and survives restarts.

## 0.2.0 — 2026-04-16

### Changed

- **Editing moved to the native VSCode editor.** The built-in webview editor (textarea + markdown preview) has been removed; prompts now open as regular text documents in the main editor area. Syntax highlighting, multi-cursor, search, Git integration, extensions — all work out of the box.
- The side panel is now a **Prompt Inspector** focused purely on template variables of the active prompt.

### Added

- **Prompt Inspector view** — shows `{{variables}}` detected in the active prompt with per-variable source controls.
- **Per-variable source switching** between Global, Project and Custom values.
- **Bulk actions**: Switch All to Global / Project / Custom, Save All to Global / Project.
- **Env files** (`prompta.env`) in the global and project prompts folders store reusable variable values.
- **Copy with Substitutions** command — copies the prompt to clipboard with variables resolved.
- **Edit Global / Project Variables** commands — open the underlying `prompta.env` file.
- **Reload Variables** command.
- **Save** action next to a custom value to persist it to Global or Project env.

### Fixed / Improved

- File system watchers are now scoped to the prompts folders instead of the whole workspace.
- Inspector state stays in sync with the active editor (including unsaved edits).
- Cleaner command/menu organisation with dedicated tree and inspector submenus.

### Removed

- Built-in webview editor and its in-panel markdown preview.
- `prompta.openInEditorModifier` setting (was not used).

## 0.1.0 — 2026-04-06

- Initial release
- **Global & Project prompts** — separate trees for personal and per-project prompts
- Sidebar file tree for browsing prompts
- Built-in editor with autosave
- Markdown preview mode
- Template variables with `{{ VAR }}` syntax
- Variable substitution panel in preview mode
- Copy with variable replacement
- Copy path / copy relative path from context menu
- Drag & drop file management
- Toggle Sidebar command
- Configurable global folder, project folder, and editor font size
