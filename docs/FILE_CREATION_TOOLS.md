# File Creation Tools

Gilbert Codex exposes typed file creation tools through the local computer runtime. They are designed for agent use: each call has a clear file kind, writes only inside enabled workspace roots, respects the current permission mode, and refreshes the local file index after success.

## Tool Set

| Tool | Use |
| --- | --- |
| `create_text_file` | Create `.txt` notes, plain text, checklists, transcripts, and scratch files. |
| `create_markdown_file` | Create `.md` project notes, specs, READMEs, docs, prompts, and planning files. |
| `create_code_file` | Create source files for TypeScript, JavaScript, Python, Rust, Go, Java, Kotlin, Swift, C/C++, C#, PHP, Ruby, SQL, CSS, JSON, YAML, shell, and other extension-driven languages. |
| `create_react_file` | Create `.tsx` or `.jsx` React component files, including fenced-code extraction from Markdown. |
| `create_html_file` | Create full HTML documents from HTML or Markdown-like content. |
| `create_pdf_file` | Render Markdown-like notes into a local PDF file. |
| `create_files` | Create many files in one atomic-intent batch from a JSON manifest. |

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

The batch writer validates every target path against the enabled roots and duplicate policy before writing so a blocked file does not leave a partial multi-file operation.

## Design Notes

The shape follows the same broad agent-tool principles used by current coding agents: explicit tool contracts, sandboxed/local root boundaries, permission-aware writes, and compact results that the model can use in the next turn. The implementation was checked against official Claude Code and OpenAI Codex documentation for tool availability, permissions, sandboxing, and local environment expectations:

- [Claude Code settings](https://docs.anthropic.com/en/docs/claude-code/settings)
- [Claude Code overview](https://docs.anthropic.com/en/docs/claude-code/overview)
- [OpenAI Codex docs](https://platform.openai.com/docs/codex)
- [OpenAI tools guide](https://developers.openai.com/api/docs/guides/tools)
