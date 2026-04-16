# Changelog

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
