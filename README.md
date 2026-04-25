# rh-recorder

Chrome extension that records Playwright tests in your browser and pushes them as **pull requests** to `RetailerHub-Inc/rh-e2e-tests`. Forked from [`playwright-crx`](https://github.com/ruifigueira/playwright-crx) (Apache-2.0).

This is the **author-time** half of the qa-e2e system. The runtime half lives on the VPS at `~/repos/personal-assistant/qa-e2e/`.

> **First time here? Read `CLAUDE.md` first** for the rule about "what's ours vs. upstream." After changes to anything in the ours list, update this README in the same commit.

## What this adds on top of playwright-crx

A "Save to GitHub" button in the recorder toolbar. After recording a flow, click it to:

1. Enter your fine-grained GitHub PAT (saved in `chrome.storage.local`, never logged).
2. Confirm the target repo + folder (defaults: `RetailerHub-Inc/rh-e2e-tests` / `tests/unsorted`).
3. Choose a filename (auto-suggests `<UTC-timestamp>-recording.spec.ts`).
4. Hit "Open pull request."

The extension creates a fresh branch off `main`, commits the recorded `.spec.ts` to `<folder>/<filename>` via the GitHub Contents API, and opens a ready-for-review PR. The PR description points at this extension as the source. The PR is opened ready (not draft) so GitHub's repo-level email notifications fire — see "Notifications" below.

After you merge the PR, the next `/qa-e2e` run on the VPS picks up the new test, the categorizer Claude organizes it into `tests/<bounded-context>/<feature>/`, and the suite runs.

## End-to-end flow

```
Chrome (Mac) — record clicks                       VPS
├── playwright-crx codegen → generates .spec.ts    │
└── "Save to GitHub" button (this fork)            │
        │                                           │
        ▼                                           │
GitHub: RetailerHub-Inc/rh-e2e-tests               │
        ↓ (you merge the PR)                       │
        └─────────► /qa-e2e on VPS ─────► categorize → run → triage
```

## GitHub PAT — what scopes you need

Use a **fine-grained** PAT scoped to `RetailerHub-Inc/rh-e2e-tests` only:

| Permission | Access | Why |
|---|---|---|
| Contents | Read & write | Create the branch + commit the test file |
| Pull requests | Read & write | Open the PR |
| Metadata | Read (auto) | Required by all fine-grained PATs |

Generate at: https://github.com/settings/tokens?type=beta → "Generate new token" → "Only select repositories" → `RetailerHub-Inc/rh-e2e-tests`.

## Build

This is a multi-package npm workspace. The first build is heavy because it bundles the vendored Playwright source.

```bash
# 1. Install workspace deps
npm install

# 2. Install vendored playwright bundles (only needed once, or after updates)
npm run ci:pw:bundles

# 3. Build the playwright-crx library (produces lib/)
npm run build:crx

# 4. Build the extension (produces examples/recorder-crx/dist/)
npm run build:examples:recorder
```

After step 4, `examples/recorder-crx/dist/` is a load-unpacked-able Chrome extension.

## Load in Chrome

1. Open `chrome://extensions`
2. Toggle **Developer mode** on (top-right)
3. Click **Load unpacked**
4. Select `/path/to/rh-recorder/examples/recorder-crx/dist`
5. The extension's icon (rh-recorder) appears in the toolbar.

To use:
- Click the rh-recorder icon → opens the side panel.
- Press `Shift+Alt+R` (or click the record button) to start recording on the active tab.
- Click around in your app. The side panel shows the generated Playwright code in real time.
- When done, click **Save to GitHub** in the side-panel toolbar. Fill in PAT (first time only) → Push.
- A PR appears in `RetailerHub-Inc/rh-e2e-tests`.

## Notifications

The extension does NOT send notifications itself (no ntfy, no email — the local Mac shouldn't have to know about either). Instead, configure GitHub to email you when a PR is opened in `rh-e2e-tests`:

1. Go to https://github.com/RetailerHub-Inc/rh-e2e-tests
2. Click the **Watch** button (top-right) → **Custom**
3. Check **Pull requests** (and uncheck the others if you don't want issue/release noise)
4. Click **Apply**

Emails go to whichever address GitHub has on file for your account. To route this org's notifications to a specific address (e.g., `adrian@retailerhub.ai`):

1. Make sure the address is added + verified at https://github.com/settings/emails
2. Go to https://github.com/settings/notifications → "Custom routing" → set per-org address.

PRs are opened as **ready-for-review (not draft)** specifically because GitHub's repo-watch emails fire on opened PRs — drafts don't trigger the same notification cascade.

## Files we own (vs. inherited upstream)

See `CLAUDE.md` for the full list. Quick reference:

- `examples/recorder-crx/src/githubApi.ts` — GitHub fetch client + storage helpers.
- `examples/recorder-crx/src/githubSaveForm.tsx` — modal form component.
- `examples/recorder-crx/src/crxRecorder.tsx` — UI integration (toolbar button + handler). Otherwise upstream.
- `examples/recorder-crx/src/form.css` — small additions for password input + row/col layout + hint styles.
- `examples/recorder-crx/public/manifest.json` — name + description.

Everything else is upstream `playwright-crx`. Don't modify it without good reason; document the reason in `CLAUDE.md`.

## Tracking upstream

```bash
git fetch upstream
git merge upstream/main
```

Almost all conflicts will be in `crxRecorder.tsx`. Resolve in favor of keeping the "Save to GitHub" button.

## Future / roadmap

- **OAuth instead of PAT.** Requires hosting a token-exchange endpoint on the VPS (Chrome extensions can't safely hold an OAuth client secret). Defer until needed.
- **In-extension test review.** Today the side panel shows the codegen output but the user has to trust it before pushing. A "preview + edit" textarea inside the GitHub modal would let users tune assertions before the push.
- **Smart assertions.** The recorder captures clicks/fills/expects — but for generative features (image gen, LLM responses) we need semantic assertions. See `RetailerHub-Inc/rh-e2e-tests/README.md` future section.
- **Repo picker.** Today the owner+repo are typed manually (with sane defaults). Could fetch user's repos via GitHub API and show a dropdown.

## Related

- Tests repo: [`RetailerHub-Inc/rh-e2e-tests`](https://github.com/RetailerHub-Inc/rh-e2e-tests)
- Runner agent on VPS: `~/repos/personal-assistant/qa-e2e/` (in [`RetailerHub-Inc/personal-assistant`](https://github.com/RetailerHub-Inc/personal-assistant))
- Upstream we forked: [`ruifigueira/playwright-crx`](https://github.com/ruifigueira/playwright-crx)
