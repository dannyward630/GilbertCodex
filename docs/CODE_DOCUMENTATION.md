# Code Documentation Standards

Gilbert Codex keeps the README and setup docs broad, while source comments explain contracts that future contributors cannot safely infer from names alone.

## What To Document

- Add single-line TSDoc/JSDoc, line comments, or Rust doc comments to exported functions, exported constants, public interfaces, and React components when they cross a module boundary or represent a product/runtime contract.
- Add single-line Rust doc comments to Tauri commands, public command state, and host-layer helpers that are called from the frontend.
- Add short single-line inline comments for non-obvious security, permission, parsing, caching, fallback, or compatibility decisions.
- Keep type names, argument names, and return names descriptive enough that comments do not need to restate every field.

## What To Avoid

- Do not add comments that only narrate the next line of code.
- Do not use multi-line block comments in source; compress the contract to one clear line or move the detail into docs.
- Do not leave TODO, FIXME, temporary investigation notes, debug breadcrumbs, or stale audit language in committed source.
- Do not duplicate README-level setup instructions inside code files.
- Do not document implementation guesses. If behavior depends on a provider, platform, permission mode, or external API, name that dependency explicitly.

## Review Checklist

Before opening a pull request, check whether the touched code introduces or changes:

- A public TypeScript export.
- A Tauri command, request shape, response shape, or persisted local-data format.
- A model/runtime contract, prompt-facing instruction, approval path, or permission boundary.
- A fallback path between Tauri desktop and browser preview runtimes.

If yes, either document the contract in source or explain in the PR why the existing names and surrounding docs are enough.
