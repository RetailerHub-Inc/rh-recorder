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
const STORAGE_KEY_MODEL = 'rh-recorder.llm.model';

// The strongest models exposed by llm-api (see agents/models/model-names.mts).
// Default favors GPT-5.4 Pro because it's the newest GPT-5 and has consistently
// the lowest API-hallucination rate in our testing. Users can switch to Gemini
// 3.1 Pro if they prefer.
export const AVAILABLE_MODELS = [
  { id: 'gpt-5.4-pro-2026-03-05', label: 'GPT-5.4 Pro' },
  { id: 'gpt-5.4-2026-03-05', label: 'GPT-5.4' },
  { id: 'gpt-5-pro-2025-10-06', label: 'GPT-5 Pro' },
  { id: 'gpt-5-2025-08-07', label: 'GPT-5' },
  { id: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro' },
  { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
] as const;

export const DEFAULT_MODEL_ID = 'gpt-5.4-pro-2026-03-05';

export interface LlmConfig {
  url: string;
  apiKey: string;
  model: string;
}

export const DEFAULT_LLM_CONFIG: LlmConfig = {
  url: '',
  apiKey: '',
  model: DEFAULT_MODEL_ID,
};

export async function loadLlmConfig(): Promise<LlmConfig> {
  const result = await chrome.storage.local.get([STORAGE_KEY_URL, STORAGE_KEY_KEY, STORAGE_KEY_MODEL]);
  return {
    url: result[STORAGE_KEY_URL] ?? '',
    apiKey: result[STORAGE_KEY_KEY] ?? '',
    model: result[STORAGE_KEY_MODEL] ?? DEFAULT_MODEL_ID,
  };
}

export async function saveLlmConfig(cfg: LlmConfig): Promise<void> {
  await chrome.storage.local.set({
    [STORAGE_KEY_URL]: cfg.url,
    [STORAGE_KEY_KEY]: cfg.apiKey,
    [STORAGE_KEY_MODEL]: cfg.model || DEFAULT_MODEL_ID,
  });
}

export type ChatMessage = { role: 'system' | 'human' | 'ai'; content: string };

export interface RewriteTestArgs {
  config: LlmConfig;
  userInstruction: string;
  currentCode: string;
  pageHtml: string;
  pageUrl?: string;
  // Prior turns in this conversation. Each call appends the new user message
  // to this array internally; the caller persists the result for next turn.
  history: ChatMessage[];
  // True if the page HTML has changed since the last turn (or this is turn 1).
  // When false, the HTML is omitted from the new user message — the model
  // already has it in conversation context.
  htmlChanged: boolean;
}

export interface RewriteTestResult {
  newCode: string;
  // The user message that was actually sent (so the caller can append it +
  // the AI response to its history).
  userMessage: ChatMessage;
  aiMessage: ChatMessage;
}

const SYSTEM_PROMPT = `You are an autonomous Playwright test editor.

You may receive multiple turns from the same developer. Each turn you'll see:
1. The CURRENT Playwright test (TypeScript, @playwright/test).
2. The HTML of the page the test is exercising — sent on the first turn and only re-sent when the page has changed. If you don't see fresh HTML in a turn, treat the previously-sent HTML as still authoritative.
3. A natural-language INSTRUCTION from the developer.

## ⚠️ Minimal-edit principle (most important rule)

The developer expects you to make ONLY the change they asked for. **Preserve everything else exactly as-is.**

- Do NOT delete existing steps, navigations, waits, fills, clicks, or assertions unless the instruction explicitly says to.
- "Add X" means ADD — keep the existing flow and insert X.
- "Fix Y" means change only what's broken with Y; leave unrelated code alone.
- "Change A to B" means modify only A; everything else stays.
- If you're unsure whether to remove an existing step, KEEP it.
- A diff-minded reviewer should be able to see exactly what the instruction asked for and nothing else.

## Output format

Output ONLY the updated test code:
- No explanation before or after.
- No markdown fences (no \`\`\`typescript wrappers).
- Preserve imports, top-level structure, and the existing test() block(s) unless the instruction explicitly says otherwise.

## Playwright API — use ONLY these documented methods. NEVER invent method names.

Locators (return a Locator):
- page.locator(selector)            — CSS / XPath / text=...
- page.getByRole('button', { name: 'X' })
- page.getByText('X')
- page.getByLabel('X')
- page.getByPlaceholder('X')
- page.getByTitle('X')
- page.getByTestId('X')
- page.getByAltText('X')

Locator narrowing:
- locator.first(), .last(), .nth(n)
- locator.filter({ hasText: 'X' })
- locator.locator(childSelector)

Locator → array of locators:
- await locator.all()               — returns Promise<Locator[]>

Common assertions (web-first, AUTO-WAIT):
- await expect(locator).toBeVisible()
- await expect(locator).toContainText('X')
- await expect(locator).toHaveText('X')
- await expect(locator).toHaveCount(n)
- await expect(locator).toBeAttached()
- await expect(page).toHaveURL(/regex/)
- await expect(page).toHaveTitle(/regex/)

## NEVER use these (they don't exist or aren't recommended):
- page.locatorAll(...)              — DOES NOT EXIST. Use page.locator(sel).all() or just page.locator(sel) directly.
- page.querySelector / page.querySelectorAll — these are DOM APIs, not Playwright. Use page.locator(sel) instead.
- locator.length / .count            — use await locator.count() (a method, returns Promise<number>) or expect(locator).toHaveCount(n).
- expect(value)                      — bare expect on a non-locator value: only use for primitive checks like expect(arr.length).toBeGreaterThan(0). For DOM presence, use expect(locator).toBeVisible() etc.

## Heuristics
- Prefer ARIA locators over CSS class/id selectors when the HTML provides accessible names.
- "Any element in the grid" → locator.first() (don't hardcode a value).
- Every test should end with at least one assertion that verifies the expected end-state visible in the HTML.
- Don't invent locators that aren't supported by the HTML provided.
- Don't insert credentials, API keys, or URLs that aren't already in the input.

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

export async function rewriteTestViaLlm(args: RewriteTestArgs): Promise<RewriteTestResult> {
  const { config, userInstruction, currentCode, pageHtml, pageUrl, history, htmlChanged } = args;

  if (!config.url) throw new Error('LLM API URL is not set. Open the AI panel settings and configure it.');
  if (!config.apiKey) throw new Error('LLM API key is not set. Open the AI panel settings and configure it.');

  // Compose the new user message. We always include the CURRENT TEST (the
  // editor may have been hand-edited between turns, so the model can't trust
  // its own prior response). We only include the page HTML when it has
  // actually changed — every other turn we tell the model the prior HTML is
  // still authoritative.
  const lines: string[] = [];
  if (pageUrl) lines.push(`Page URL: ${pageUrl}`);
  lines.push('CURRENT TEST:', '```typescript', currentCode, '```', '');
  if (htmlChanged) {
    const compactedHtml = compactHtml(pageHtml);
    lines.push('PAGE HTML (compacted):', '```html', compactedHtml, '```', '');
  } else {
    lines.push('(Page HTML unchanged from previous turn — use the HTML you already have.)', '');
  }
  lines.push('INSTRUCTION:', userInstruction);
  const userContent = lines.join('\n');

  const userMessage: ChatMessage = { role: 'human', content: userContent };

  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...history,
    userMessage,
  ];

  const url = config.url.replace(/\/+$/, '') + '/api/v1/completion';
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.apiKey,
    },
    body: JSON.stringify({
      messages,
      model: config.model || DEFAULT_MODEL_ID,
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

  const newCode = stripMarkdownFences(out);
  return {
    newCode,
    userMessage,
    aiMessage: { role: 'ai', content: out },
  };
}

// Cheap, fast hash for HTML-change detection. Crypto-strength is unnecessary;
// we just need same-text → same-output. Polynomial rolling hash on the string.
export function hashString(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

// Defensive: if the model wraps the test in ```typescript ... ``` despite the
// system prompt, peel the fences off so the editor doesn't end up with them.
function stripMarkdownFences(s: string): string {
  const trimmed = s.trim();
  const fenced = trimmed.match(/^```(?:typescript|ts|tsx|javascript|js)?\s*\n([\s\S]*?)\n```$/);
  return fenced ? fenced[1] : trimmed;
}
