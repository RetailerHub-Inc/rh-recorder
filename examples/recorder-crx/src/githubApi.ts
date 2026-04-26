/**
 * Copyright (c) RetailerHub Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 */

// Minimal GitHub API client used by the "Save to GitHub" panel.
//
// Only covers the endpoints we need to push a recorded test as a draft PR:
//   1. GET ref of the base branch (to learn its tip SHA)
//   2. CREATE a new ref off that SHA
//   3. PUT a new file at <folder>/<filename> on that ref
//   4. CREATE a draft pull request from that ref to the base branch
//
// Authenticated via a fine-grained PAT stored in chrome.storage.local.

const API = 'https://api.github.com';
const STORAGE_KEY_TOKEN = 'rh-recorder.github.token';
const STORAGE_KEY_PREFS = 'rh-recorder.github.prefs';

export interface GithubPrefs {
  owner: string;
  repo: string;
  folder: string;
  baseBranch: string;
}

export const DEFAULT_PREFS: GithubPrefs = {
  owner: 'RetailerHub-Inc',
  repo: 'rh-e2e-tests',
  folder: 'tests/unsorted',
  baseBranch: 'main',
};

export async function loadGithubToken(): Promise<string> {
  const result = await chrome.storage.local.get(STORAGE_KEY_TOKEN);
  return result[STORAGE_KEY_TOKEN] ?? '';
}

export async function saveGithubToken(token: string): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY_TOKEN]: token });
}

export async function loadGithubPrefs(): Promise<GithubPrefs> {
  const result = await chrome.storage.local.get(STORAGE_KEY_PREFS);
  return { ...DEFAULT_PREFS, ...(result[STORAGE_KEY_PREFS] ?? {}) };
}

export async function saveGithubPrefs(prefs: GithubPrefs): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY_PREFS]: prefs });
}

interface ApiOptions {
  token: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH';
  body?: unknown;
}

async function api<T>(path: string, opts: ApiOptions): Promise<T> {
  const headers: Record<string, string> = {
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Authorization': `Bearer ${opts.token}`,
  };
  if (opts.body) headers['Content-Type'] = 'application/json';

  const res = await fetch(`${API}${path}`, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });

  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body?.message) detail += ` — ${body.message}`;
    } catch { /* ignore body parse errors */ }
    throw new Error(`GitHub ${opts.method ?? 'GET'} ${path} failed: ${detail}`);
  }

  return res.json() as Promise<T>;
}

export interface PushedTestResult {
  branchName: string;
  filePath: string;
  prUrl: string;
  prNumber: number;
}

export interface PushTestArgs {
  token: string;
  prefs: GithubPrefs;
  filename: string;            // e.g. "2026-04-25-add-to-cart.spec.ts"
  content: string;             // the recorded test code
  testTitle?: string;          // for PR title; falls back to filename
}

// Encodes a UTF-8 string as base64 for the GitHub Contents API.
function utf8ToBase64(input: string): string {
  // btoa requires a binary string. UTF-8 → percent-encoding → unescape → btoa.
  return btoa(unescape(encodeURIComponent(input)));
}

// Swap the recorder's default `import { test, expect } from '@playwright/test'`
// for our shared fixtures module. The fixtures module re-exports test+expect
// from Playwright but layers in repo-wide setup (auto-navigate to /documents,
// future reusable flows like startChatWithAi). Tests written by the recorder
// don't have to know any of this — the swap happens at push time.
//
// The path alias `@fixtures/test` is configured in rh-e2e-tests/tsconfig.json
// so it's stable across categorizer moves (a test going from tests/unsorted/
// → tests/checkout/cart/ doesn't need its imports rewritten).
export function rewriteImportsForRepo(code: string): string {
  // Match imports of test+expect from @playwright/test in any quote/order.
  const importPattern = /^(\s*import\s*\{[^}]*\}\s*from\s*)(['"])@playwright\/test\2(\s*;?\s*$)/m;
  return code.replace(importPattern, '$1$2@fixtures/test$2$3');
}

export async function pushRecordedTest(args: PushTestArgs): Promise<PushedTestResult> {
  const { token, prefs, filename, testTitle } = args;
  const { owner, repo, folder, baseBranch } = prefs;

  // Swap the @playwright/test import for our shared fixtures module so
  // repo-wide setup (auto-navigation etc.) applies without the user editing.
  const content = rewriteImportsForRepo(args.content);

  // 1. Read the tip of the base branch.
  const ref = await api<{ object: { sha: string } }>(
      `/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(baseBranch)}`,
      { token },
  );
  const baseSha = ref.object.sha;

  // 2. Create a new branch.
  const branchName = makeBranchName(filename);
  await api(`/repos/${owner}/${repo}/git/refs`, {
    token,
    method: 'POST',
    body: { ref: `refs/heads/${branchName}`, sha: baseSha },
  });

  // 3. Create the test file on the new branch.
  const cleanFolder = folder.replace(/^\/+|\/+$/g, '');
  const filePath = cleanFolder ? `${cleanFolder}/${filename}` : filename;
  const commitMessage = `test: add ${filename} (recorded by rh-recorder)`;

  await api(`/repos/${owner}/${repo}/contents/${encodeURI(filePath)}`, {
    token,
    method: 'PUT',
    body: {
      message: commitMessage,
      content: utf8ToBase64(content),
      branch: branchName,
    },
  });

  // 4. Open the PR (ready-for-review, not draft — repo-level email
  //    notifications fire on opened PRs and we want them to fire here).
  const pr = await api<{ html_url: string; number: number }>(
      `/repos/${owner}/${repo}/pulls`,
      {
        token,
        method: 'POST',
        body: {
          title: `test: ${testTitle ?? filename}`,
          head: branchName,
          base: baseBranch,
          draft: false,
          body: `Recorded by **rh-recorder** Chrome extension.\n\n` +
            `File: \`${filePath}\`\n\n` +
            `After merge, the next \`/qa-e2e\` run on the VPS will categorize this test ` +
            `into the appropriate \`tests/<bounded-context>/<feature>/\` folder.`,
        },
      },
  );

  return {
    branchName,
    filePath,
    prUrl: pr.html_url,
    prNumber: pr.number,
  };
}

function makeBranchName(filename: string): string {
  const stem = filename.replace(/\.spec\.ts$/, '').replace(/[^a-zA-Z0-9-]/g, '-').slice(0, 50);
  // Add a short random suffix to dodge collisions across recordings on the same day.
  const suffix = Math.random().toString(36).slice(2, 8);
  return `rh-recorder/${stem}-${suffix}`;
}

export function suggestFilename(): string {
  // ISO timestamp without colons → YYYY-MM-DD-HHMMSS — close to the existing
  // tests/unsorted/2026-04-25-* pattern that the categorizer is happy to consume.
  const now = new Date();
  const pad = (n: number) => n.toString().padStart(2, '0');
  const date = `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}`;
  const time = `${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`;
  return `${date}-${time}-recording.spec.ts`;
}
