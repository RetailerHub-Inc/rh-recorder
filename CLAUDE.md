# CLAUDE.md

You are about to work on **rh-recorder** — RetailerHub's Chrome extension that records Playwright tests and pushes them as draft PRs to `RetailerHub-Inc/rh-e2e-tests`. **Read `README.md` first** for the architecture, build steps, and which files we own vs. inherited from upstream.

## What's ours, what's upstream

This is a **fork of [`ruifigueira/playwright-crx`](https://github.com/ruifigueira/playwright-crx) (Apache-2.0)**. We track `upstream/main`. The vast majority of the code is unmodified upstream — Playwright codegen wrapped as a Chrome extension.

**Files we own** (RetailerHub-specific):
- `examples/recorder-crx/src/githubApi.ts` — fetch-based GitHub client + chrome.storage helpers for PAT/prefs
- `examples/recorder-crx/src/githubSaveForm.tsx` — modal form (PAT + repo + folder + filename + push)
- Modifications to `examples/recorder-crx/src/crxRecorder.tsx` — adds the "Save to GitHub" toolbar button + handler. Changes are scoped: import additions, a `saveToGithub` callback, a new toolbar button. Local-save flow is left intact.
- Additions to `examples/recorder-crx/src/form.css` — styles for the new form (input[type="password"], `.row`/`.col`, `.hint`).
- Manifest changes in `examples/recorder-crx/public/manifest.json` — `name` and `description`.

**Files we should NOT modify** (upstream — touch only when necessary, and document why):
- `playwright/` — vendored Playwright source.
- `src/` (root) — the playwright-crx library itself.
- `examples/recorder-crx/src/{crxRecorder.css, dialog.tsx, dialog.css, index.tsx, background.ts, settings.ts, preferences*, saveCodeForm.tsx}` — these are upstream.
- `vite.config.mts`, `eslint.config.mjs`, `tsconfig*.json`, `package*.json` (root) — configs we inherit. If you must touch, document the diff in this CLAUDE.md.

## Working rule

When you change anything in the "ours" list, **update README.md in the same commit** so the build steps, the "Save to GitHub" UX flow, and the GitHub API surface stay accurately documented for the next session.

## Tracking upstream

Periodically pull from `upstream/main`:

```bash
git fetch upstream
git merge upstream/main         # or rebase if you prefer linear history
```

Conflicts will almost always be in `examples/recorder-crx/src/crxRecorder.tsx` (the toolbar). Resolve in favor of keeping the "Save to GitHub" button.

## Counterpart docs

- The test repo this extension pushes into: `RetailerHub-Inc/rh-e2e-tests` (`README.md` there describes the test layout and what happens after merge).
- The runner that picks up merged PRs: `~/repos/personal-assistant/qa-e2e/` on the VPS.
