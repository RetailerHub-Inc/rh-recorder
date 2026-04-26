/**
 * Copyright (c) RetailerHub Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 */

// Client for RetailerHub's llm-api `/api/v1/completion` endpoint and storage
// helpers for the URL + API key (settings the user enters once and we keep).
//
// Auth model: x-api-key header (service-to-service). The fine-grained PAT pattern
// from githubApi.ts is the model.
//
// Endpoint contract (see llm-api/routes/completion.js):
//   POST {LLM_API_URL}/api/v1/completion
//   Headers: x-api-key: <key>, content-type: application/json
//   Body: { messages: [{role, content}], model?, provider?, temperature?, ... }
//   Response (api-key auth): { response: string|object, fullPayload: {...}, usage: {...} }

const STORAGE_KEY_URL = 'rh-recorder.llm.url';
const STORAGE_KEY_KEY = 'rh-recorder.llm.apiKey';

export interface LlmConfig {
  url: string;
  apiKey: string;
}

export const DEFAULT_LLM_CONFIG: LlmConfig = {
  url: '',
  apiKey: '',
};

export async function loadLlmConfig(): Promise<LlmConfig> {
  const result = await chrome.storage.local.get([STORAGE_KEY_URL, STORAGE_KEY_KEY]);
  return {
    url: result[STORAGE_KEY_URL] ?? '',
    apiKey: result[STORAGE_KEY_KEY] ?? '',
  };
}

export async function saveLlmConfig(cfg: LlmConfig): Promise<void> {
  await chrome.storage.local.set({
    [STORAGE_KEY_URL]: cfg.url,
    [STORAGE_KEY_KEY]: cfg.apiKey,
  });
}

export interface RewriteTestArgs {
  config: LlmConfig;
  userInstruction: string;
  currentCode: string;
  pageHtml: string;
  pageUrl?: string;
}

const SYSTEM_PROMPT = `You are an autonomous Playwright test editor.

You will receive:
1. The CURRENT Playwright test (TypeScript / @playwright/test).
2. The HTML of the page the test is exercising.
3. A natural-language INSTRUCTION from the developer.

Apply the instruction by rewriting the CURRENT test. Output ONLY the updated test code:
- No explanation before or after.
- No markdown fences (no \`\`\`typescript \`\`\` wrappers).
- Preserve imports, top-level structure, and the existing test() block(s) unless the instruction explicitly says otherwise.
- Prefer ARIA-based locators (page.getByRole, getByLabel, getByText) over CSS/XPath.
- When the instruction says "any element in the grid" or similar non-deterministic phrasing, use locators that select the first match (e.g., page.getByRole('row').first()) rather than hardcoding a value.
- Keep assertions concrete: every test should end with at least one expect(...) that verifies the expected end-state visible in the HTML.
- Do not invent locators that aren't supported by the HTML provided.
- Do not insert credentials, API keys, or URLs that aren't already in the input.

Return only the .ts source. Anything else you output will end up in the test file and break it.`;

// Cap page HTML so the LLM call stays within reasonable context budgets.
// Strip the heavy bits (script/style bodies, base64 image data) before truncating.
function compactHtml(html: string, maxLen = 60_000): string {
  let h = html;
  // Drop full <script>...</script> bodies (keep the tag for context if needed).
  h = h.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '<script>/* stripped */</script>');
  h = h.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '<style>/* stripped */</style>');
  h = h.replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, '<svg>/* stripped */</svg>');
  // Strip data: URIs (base64 images, fonts, etc.).
  h = h.replace(/(['"])data:[^'"]+\1/gi, '"data:stripped"');
  // Collapse whitespace runs.
  h = h.replace(/\s+/g, ' ');
  if (h.length > maxLen)
    h = h.slice(0, maxLen) + '\n<!-- HTML truncated, original was ' + html.length + ' chars -->';
  return h;
}

export async function rewriteTestViaLlm(args: RewriteTestArgs): Promise<string> {
  const { config, userInstruction, currentCode, pageHtml, pageUrl } = args;

  if (!config.url) throw new Error('LLM API URL is not set. Open the AI panel settings and configure it.');
  if (!config.apiKey) throw new Error('LLM API key is not set. Open the AI panel settings and configure it.');

  const compactedHtml = compactHtml(pageHtml);

  const userMessage = [
    pageUrl ? `Page URL: ${pageUrl}` : '',
    'CURRENT TEST:',
    '```typescript',
    currentCode,
    '```',
    '',
    'PAGE HTML (compacted):',
    '```html',
    compactedHtml,
    '```',
    '',
    'INSTRUCTION:',
    userInstruction,
  ].filter(Boolean).join('\n');

  const url = config.url.replace(/\/+$/, '') + '/api/v1/completion';
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.apiKey,
    },
    body: JSON.stringify({
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'human', content: userMessage },
      ],
      // Let the server pick the model + provider.
      temperature: 0.2,
    }),
  });

  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const body = await res.text();
      if (body) detail += ` — ${body.slice(0, 500)}`;
    } catch { /* ignore */ }
    throw new Error(`llm-api call failed: ${detail}`);
  }

  const json = await res.json() as { response?: string | Record<string, unknown> };
  const out = json.response;
  if (typeof out !== 'string')
    throw new Error('llm-api returned a non-string response (got ' + typeof out + '). The completions endpoint should return { response: string } for plain text.');

  return stripMarkdownFences(out);
}

// Defensive: if the model wraps the test in ```typescript ... ``` despite the
// system prompt, peel the fences off so the editor doesn't end up with them.
function stripMarkdownFences(s: string): string {
  const trimmed = s.trim();
  const fenced = trimmed.match(/^```(?:typescript|ts|tsx|javascript|js)?\s*\n([\s\S]*?)\n```$/);
  return fenced ? fenced[1] : trimmed;
}
