# CLAUDE.md

You are about to work on **rh-recorder** — RetailerHub's Chrome extension that records Playwright tests and pushes them as draft PRs to `RetailerHub-Inc/rh-e2e-tests`. **Read `README.md` first** for the architecture, build steps, and which files we own vs. inherited from upstream.

## What's ours, what's upstream

This is a **fork of [`ruifigueira/playwright-crx`](https://github.com/ruifigueira/playwright-crx) (Apache-2.0)**. We track `upstream/main`. The vast majority of the code is unmodified upstream — Playwright codegen wrapped as a Chrome extension.

**Files we own** (RetailerHub-specific):
- `examples/recorder-crx/src/githubApi.ts` — fetch-based GitHub client + chrome.storage helpers for PAT/prefs
- `examples/recorder-crx/src/githubSaveForm.tsx` — modal form (PAT + repo + folder + filename + push)
- `examples/recorder-crx/src/llmApi.ts` — fetch client for the local llm-api `/api/v1/completion` endpoint, plus chrome.storage helpers for the LLM URL + key, plus the system prompt and the HTML compaction helper
- `examples/recorder-crx/src/aiPromptBox.tsx` — "Edit with AI" panel rendered below the upstream `<Recorder />` (textarea + Send + collapsible settings). Captures page HTML via `chrome.scripting.executeScript` against the active recorded tab and dispatches the LLM response back through `onCodeUpdated → window.dispatch({event: 'codeChanged'})`.
- `examples/recorder-crx/src/aiPromptBox.css` — styles for the AI panel.
- Modifications to `examples/recorder-crx/src/crxRecorder.tsx` — adds the "Save to GitHub" toolbar button + handler, AND mounts `<AiPromptBox />` below the upstream `<Recorder />`. Changes are scoped: import additions, two callbacks, two new JSX elements. Local-save flow is left intact.
- Additions to `examples/recorder-crx/src/form.css` — styles for the GitHub form (input[type="password"], `.row`/`.col`, `.hint`).
- Manifest changes in `examples/recorder-crx/public/manifest.json` — only `name` and `description`. **No `host_permissions`** is intentional: any host_permissions change (even narrow patterns like `https://*.azurewebsites.net/*`) causes Chrome to detach active `chrome.debugger` sessions, which breaks the recorder's click-capture pipeline. The AI panel's CORS need is solved server-side — `llm-api` allows `chrome-extension://*` origins as of [RetailerHub-Inc/llm-api PR #54](https://github.com/RetailerHub-Inc/llm-api/pull/54). If a future llm-api host doesn't honor that allow-rule, fix it server-side; do NOT re-introduce host_permissions here.

**Files we should NOT modify** (upstream — touch only when necessary, and document why):
- `playwright/` — vendored Playwright source.
- `src/` (root) — the playwright-crx library itself.
- `examples/recorder-crx/src/{crxRecorder.css, dialog.tsx, dialog.css, index.tsx, settings.ts, preferences*, saveCodeForm.tsx}` — these are upstream.
- `examples/recorder-crx/src/background.ts` — upstream, but with **two targeted additions**: (1) the top-level `chrome.contextMenus.create({id: 'pw-recorder', ...})` is wrapped in `chrome.contextMenus.removeAll()` because in MV3 the service worker re-wakes re-run that block, and Chrome throws "Cannot create item with duplicate id" on the second registration; (2) a `chrome.runtime.onMessage` listener that handles `rh-recorder/getRecordedTabHtml` by routing through the already-attached `chrome.debugger` session (Runtime.evaluate → outerHTML). This was deliberately moved off `chrome.scripting.executeScript` because adding `scripting` + `host_permissions: <all_urls>` triggered Chrome to detach active debugger sessions, breaking recording. Look for `// rh-recorder addition` / `// rh-recorder modification` comments — if upstream pulls conflict, re-apply both.
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
