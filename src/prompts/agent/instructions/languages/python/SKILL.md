---
name: python-project
description: Use when the workspace is a Python project (pyproject.toml, requirements.txt, setup.py, conda, uv, poetry, pipenv) or when the user asks to build, scaffold, run, install, test, package, or ship a Python app.
---

# Python Project Recipe

## Detect first
- Identify shape from files (highest precedence first): `pyproject.toml` (PEP 621), `Pipfile`, `requirements.txt`, `environment.yml` (conda), legacy `setup.py`.
- Identify the tool from lockfiles: `uv.lock` -> `uv`, `poetry.lock` -> `poetry`, `Pipfile.lock` -> `pipenv`, otherwise plain `pip` + `venv`.
- Check `requires-python` in `pyproject.toml` and any `.python-version` file before assuming an interpreter.

## Bootstrap a new project
- Pick the modern tool the project already uses; do not introduce a new package manager mid-project.
- `uv`: `uv init`, then `uv add <pkg>`. Fast, reproducible, no separate venv activation needed for `uv run ...`.
- `poetry`: `poetry new <name>` or edit an existing `pyproject.toml`, then `poetry install` and `poetry add <pkg>`.
- Plain venv: `python -m venv .venv`, then activate per shell (see Windows pitfalls below), then `pip install -e .` for a `pyproject.toml` project or `pip install -r requirements.txt` for a legacy one.

## Run the right thing
- Always run through the project tool when one is detected: `uv run pytest`, `poetry run python -m app`, `pipenv run ...`. Avoid mixing `pip install` with `poetry` or `uv` - that desyncs the lockfile.
- For ad-hoc commands, prefer `python -m <module>` over a bare script path so `sys.path` is correct.
- Set `cwd` to the project root (where `pyproject.toml` lives) when running tests, formatters, or builds.

## Windows shell pitfalls
- Use `py -3` (the Windows launcher) when multiple Pythons are installed; `python` may resolve to the Microsoft Store stub if no real interpreter is on PATH.
- Activate venv per shell: PowerShell `.\.venv\Scripts\Activate.ps1`, cmd `.\.venv\Scripts\activate.bat`, bash/zsh `source .venv/bin/activate`. The PowerShell variant may need `Set-ExecutionPolicy -Scope Process Bypass` once per session.
- Most `uv run` / `poetry run` commands skip activation entirely - prefer them on Windows to dodge the activation dance.
- Prefer `pathlib.Path` over `os.path` joining. Avoid hard-coded `\\` separators in source files; cross-platform tests will fail otherwise.
- Shebang lines do not work on Windows the way they do on POSIX. Invoke scripts with `python <file>` or install them as entry points in `pyproject.toml`.

## Verify before saying it works
- Smoke import: `python -c "import <package>"` (or `uv run python -c ...`) before claiming a package installs cleanly.
- Tests: `pytest -q` (or the project tool wrapper) from the project root. Add `-x` while iterating to fail on first error.
- Type and lint: `mypy`, `ruff`, or `pyright` if configured. Read `pyproject.toml` `[tool.*]` sections before guessing.
