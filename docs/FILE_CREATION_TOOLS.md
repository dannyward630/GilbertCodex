# File Creation Tools

Gilbert Codex exposes typed file creation tools through the local computer runtime. They are designed for agent use: each call has a clear file kind, writes only inside enabled workspace roots, respects the current permission mode, and refreshes the local file index after success. Auto Full mode writes without approval prompts inside those roots; Review and Ask First modes pause mutating actions for approval.

## Tool Set

| Tool | Use |
| --- | --- |
| `create_text_file` | Create `.txt` notes, plain text, checklists, transcripts, and scratch files. |
| `create_markdown_file` | Create `.md` project notes, specs, READMEs, docs, prompts, and planning files. |
| `create_code_file` | Create source files for TypeScript, JavaScript, Python, Rust, Go, Java, Kotlin, Swift, C/C++, C#, PHP, Ruby, SQL, CSS, JSON, YAML, shell, and other extension-driven languages. |
| `create_react_file` | Create `.tsx` or `.jsx` React component files, including fenced-code extraction from Markdown. |
| `create_html_file` | Create full HTML documents from HTML or Markdown-like content. |
| `create_pdf_file` | Render Markdown notes into a clean PDF file with headings, lists, tables, rules, and code blocks. If no workspace is selected, PDF-only creation returns a downloadable chat artifact. |
| `create_files` | Create many files in one atomic-intent batch from a JSON manifest. |
| `create_vite_project` | Create a complete Vite React scaffold directly in the selected workspace folder by default. |

All tools accept `path`, `content`, `markdown`, `text`, `body`, `title`, `overwrite`, `duplicate_strategy`, and `createParentDirs` where relevant. File creation defaults to `overwrite=false` to prevent accidental duplicates. If the model provides fenced Markdown to a code tool, Gilbert extracts the best matching code fence before writing the file.

## Batch Format

Use `create_files` when a feature needs several files. The `files_json` argument can be an array or an object with a `files` array:

```json
{
  "files": [
    {
      "path": "src/components/Widget.tsx",
      "kind": "react",
      "content": "```tsx\nexport function Widget() {\n  return <div />;\n}\n```"
    },
    {
      "path": "docs/widget.md",
      "kind": "markdown",
      "title": "Widget Notes",
      "markdown": "- Behavior\n- Testing"
    }
  ]
}
```

The batch writer validates every target path against the enabled roots and duplicate policy before writing so a blocked file does not leave a partial multi-file operation. Absolute paths are checked as-is; workspace-relative paths are resolved under the selected root. If a batch repeats the selected project folder name as its first path segment, Gilbert rebases that segment to the open folder so generated project scaffolds land in the current workspace instead of being blocked as outside-root paths.

`create_vite_project` follows the same selected-folder rule: when `project_path` is omitted, the scaffold is written directly into the selected workspace root. `project_name` controls the package/display name; it does not create a same-named child folder. To intentionally scaffold under a child folder, pass `project_path`.

PDF export is the one regular-chat exception: when there is no selected workspace, `create_pdf_file` and `create_chat_pdf` return a downloadable artifact directly in the assistant message. Other file creation, source edits, terminal commands, deletes, and Git operations still require selected workspace roots.

## Design Notes

The shape follows the same broad agent-tool principles used by current coding agents: explicit tool contracts, sandboxed/local root boundaries, permission-aware writes, and compact results that the model can use in the next turn. The implementation was checked against official Claude Code and OpenAI Codex documentation for tool availability, permissions, sandboxing, and local environment expectations:

- [Claude Code settings](https://docs.anthropic.com/en/docs/claude-code/settings)
- [Claude Code overview](https://docs.anthropic.com/en/docs/claude-code/overview)
- [OpenAI Codex docs](https://platform.openai.com/docs/codex)
- [OpenAI tools guide](https://developers.openai.com/api/docs/guides/tools)
