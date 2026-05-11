# Branching And Release Model

Gilbert Codex uses a small permanent branch set plus temporary topic branches. This keeps lots of contributions organized without preserving stale empty branches.

## Permanent Branches

- `main`: stable, release-ready history. Merge into this branch only after review, passing CI, and validation on `testing`.
- `develop`: integration branch for normal contributor work. Feature, fix, docs, and chore pull requests target this branch first.
- `testing`: QA and pre-release validation branch. Promote tested batches from `develop` into this branch before they are considered ready for `main`.

## Temporary Branches

Create these only when there is real work for them:

- `feature/<short-scope>` for new product behavior.
- `fix/<short-scope>` for bug fixes.
- `docs/<short-scope>` for documentation-only changes.
- `chore/<short-scope>` for maintenance.
- `release/<version>` for release preparation that needs final polish before `main`.
- `hotfix/<short-scope>` for urgent production fixes based from `main`.

Use short, lowercase names with hyphens, for example `feature/github-pr-review` or `fix/web-search-sources`.

## Contribution Flow

1. Start contributor branches from `develop`.
2. Keep changes focused and reviewable.
3. Run `npm run check` and `git diff --check` before opening a pull request.
4. Open normal pull requests into `develop`.
5. Let CI run the `frontend-build` and `rust-host` checks.
6. Promote `develop` into `testing` when a batch is ready for QA.
7. Merge `testing` into `main` only after validation passes.

For urgent fixes:

1. Create `hotfix/<short-scope>` from `main`.
2. Open the hotfix pull request into `main`.
3. After merge, bring the fix back into `develop` and refresh `testing`.

## Promotion Pull Requests

Use promotion pull requests to make branch movement visible:

- `develop` -> `testing` for QA batches.
- `testing` -> `main` for release-ready work.
- `main` -> `develop` after hotfixes.

Promotion pull requests should summarize included changes, known risks, and validation results. They should not introduce unrelated feature work.

## Recommended Branch Protection

Protect `main`, `develop`, and `testing` with GitHub branch protection or rulesets:

- Require pull requests before merging.
- Require `frontend-build` and `rust-host` to pass.
- Require branches to be up to date before merging when GitHub offers that option.
- Require conversation resolution before merging.
- Require Code Owner review for security-sensitive files once the maintainer team grows.
- Block force pushes.
- Block branch deletion for the permanent branches.
- Delete temporary branches after merge.

`main` should be the strictest branch. `develop` can move faster, but it should still require review and checks because most contributor work flows through it.

Rulesets are the preferred long-term option because multiple rulesets can apply at the same time and contributors can inspect active rules without admin access. Branch protection rules are fine while the project is still small.
