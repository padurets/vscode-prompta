# Prompta

> Organize, edit and preview AI prompts with template variables — right in VS Code.

![Prompta Preview](assets/prompta-preview.png)

## Features

- **Global & Project prompts** — keep a personal library (`~/Prompta/prompts`) and per-project prompts (`.prompta/` in workspace) side by side
- **Sidebar file tree** — browse both collections from a dedicated panel in the activity bar
- **Built-in editor** — edit prompts directly in the sidebar with autosave, no extra tabs needed
- **Markdown preview** — toggle between edit and rendered preview mode
- **Template variables** — use `{{ VARIABLE_NAME }}` placeholders; fill them in via input fields in preview mode
- **Copy with substitution** — one-click copy with all variables replaced
- **File management** — create, rename, delete, drag & drop to reorganize
- **Copy path** — quickly copy absolute or relative path of any prompt file

## Template Variables

Write prompts with placeholders:

```
You are a {{ ROLE }}.
Given the following context: {{ CONTEXT }}
Please {{ TASK }}.
```

Switch to preview mode — a variables panel appears where you can fill in values. All occurrences update in real time. Copy the final result without modifying the source file.

## Settings

| Setting | Default | Description |
|---|---|---|
| `prompta.globalFolder` | `~/Prompta/prompts` | Absolute path to the global prompts folder |
| `prompta.projectFolder` | `.prompta` | Relative path (from workspace root) to the project prompts folder |
| `prompta.fontSize` | `14` | Font size in the prompt editor (px) |

## Getting Started

1. Install the extension
2. Click the **Prompta** icon in the activity bar
3. **Global Prompts** are ready to use — add your reusable prompts there
4. **Project Prompts** appear when you have a workspace open — great for project-specific prompts shared via git
5. Use `Prompta: Toggle Sidebar` from the command palette to quickly open the panel

## License

[MIT](LICENSE)
