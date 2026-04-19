# Prompta

> Organize and compose AI prompts with reusable variables — right in VS Code.

![Prompta Preview](assets/prompta-preview.png)

## Features

- **Prompt Explorer** — a unified tree view with collapsible sections: a built-in **Global Prompts** section (`~/Prompta/prompts` by default) plus any number of custom folders you add
- **Custom folders** — add any folder as a named section via _Add Global Folder_ / _Add Workspace Folder_, rename or remove sections at any time
- **Native editor** — prompts open as regular text documents, so syntax highlighting, search, multi-cursor, Copilot, Git and every other VS Code feature just work
- **Prompt Inspector** — a side panel that auto-discovers `{{ variables }}` in the active prompt, with an **Auto-Pickup** toggle that controls whether the inspector follows `.md` files opened in the editor
- **Per-variable sources** — switch each variable between **Global**, **Project** or a one-off **Custom** value on the fly
- **Reusable values** — store variables in `prompta.env` files per scope, ready to reuse across prompts
- **Bulk actions** — switch all variables to a single source, or save all custom values to Global/Project in one click
- **Copy with Substitutions** — copy the prompt to clipboard with variables resolved
- **File management** — create, rename, delete, drag & drop; drag sections to reorder them
- **Copy path / relative path** from the context menu

## Template Variables

Write prompts with placeholders:

```
You are a {{ ROLE }}.
Given the following context: {{ CONTEXT }}
Please {{ TASK }}.
```

Open the prompt and the **Prompt Inspector** lists every variable with three source buttons:

- **Global** — value from `<globalFolder>/prompta.env`
- **Project** — value from `<workspace>/<projectFolder>/prompta.env`
- **Custom** — a one-off value you type directly in the Inspector

Use the **Save** button next to a custom value to persist it to the Global or Project env file, or run _Save All to Global / Project_ to persist every custom value at once.

Run **Copy with Substitutions** to copy the prompt with all `{{ variables }}` resolved.

## Auto-Pickup

The **Prompt Inspector** header has a toggle that controls which files it tracks:

- **Auto-Pickup on** (default, `$(sync)` icon) — the inspector follows any `.md` file you open in the editor _and_ any file you select in Prompt Explorer.
- **Auto-Pickup off** (`$(sync-ignored)` icon) — the inspector only updates when you explicitly select a file in Prompt Explorer. Opening other `.md` files in the editor leaves the inspector untouched.

Clicking a file in Prompt Explorer always loads it into the inspector (regardless of this toggle) and _does not_ open an editor tab — use _Edit_ from the context menu when you actually want to edit the file.

## Commands

| Command | Purpose |
|---|---|
| `Prompta: New Prompt` | Create a new prompt file |
| `Prompta: Add Global Folder...` | Add a custom folder visible in all workspaces |
| `Prompta: Add Workspace Folder...` | Add a custom folder for the current workspace |
| `Prompta: Set Default Global Prompts Folder` | Change the built-in global folder path |
| `Prompta: Copy with Substitutions` | Copy active prompt with variables replaced |
| `Prompta: Edit Global Variables` / `Edit Project Variables` | Open the corresponding `prompta.env` file |
| `Prompta: Reload Variables` | Re-read env files from disk |
| `Prompta: Switch All to Global` / `Project` / `Custom` | Bulk source switcher for the active prompt |
| `Prompta: Save All to Global` / `Save All to Project` | Persist all custom values at once |
| `Prompta: Toggle Sidebar` | Show/hide the Prompta panel |

## Settings

| Setting | Default | Description |
|---|---|---|
| `prompta.globalFolder` | `~/Prompta/prompts` | Absolute path to the global prompts folder |
| `prompta.folders` | `[]` | Additional prompt folders (User Settings = global, Workspace Settings = per-project) |
| `prompta.projectFolder` | `.prompta` | Relative path (from workspace root) for project-scoped variables (`prompta.env`) |
| `prompta.fontSize` | `14` | Font size in the Prompt Inspector panel (px) |

## Getting Started

1. Install the extension
2. Click the **Prompta** icon in the activity bar
3. The **Prompt Explorer** shows your **Global Prompts** section — add reusable prompts there
4. Use _Add Global Folder_ or _Add Workspace Folder_ from the tree menu (⋯) to add more sections
5. Open any prompt and the **Prompt Inspector** below the tree will list its variables
6. Use `Prompta: Toggle Sidebar` from the command palette to quickly open the panel

## License

[MIT](LICENSE)
