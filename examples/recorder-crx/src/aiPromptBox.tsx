/**
 * Copyright (c) RetailerHub Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 */

import * as React from 'react';
import {
  loadLlmConfig,
  saveLlmConfig,
  rewriteTestViaLlm,
  hashString,
  LlmConfig,
  ChatMessage,
  AVAILABLE_MODELS,
  DEFAULT_MODEL_ID,
} from './llmApi';
import './aiPromptBox.css';

export interface AiPromptBoxProps {
  // The current generated test code shown in the recorder editor.
  currentCode: string;
  // Called with the LLM-rewritten code; the parent dispatches it back through
  // the recorder so the editor re-renders.
  onCodeUpdated: (newCode: string) => void;
}

export const AiPromptBox: React.FC<AiPromptBoxProps> = ({ currentCode, onCodeUpdated }) => {
  const [prompt, setPrompt] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [showSettings, setShowSettings] = React.useState(false);
  const [config, setConfig] = React.useState<LlmConfig>({ url: '', apiKey: '', model: DEFAULT_MODEL_ID });

  // Multi-turn conversation history. Each Send appends the user message + AI
  // response. Reset wipes it.
  const [history, setHistory] = React.useState<ChatMessage[]>([]);

  // Per-turn snapshots of the editor code BEFORE the AI replaced it. Undo
  // pops the last one and restores. Hand-edits between turns aren't snapshot
  // (only AI replacements are), so undo strictly reverses AI actions.
  const [codeSnapshots, setCodeSnapshots] = React.useState<string[]>([]);

  // Hash of the page HTML last sent to the model. When the next capture
  // matches, we tell the model the HTML is unchanged instead of re-sending it.
  const [lastHtmlHash, setLastHtmlHash] = React.useState<string | null>(null);

  React.useEffect(() => {
    loadLlmConfig().then(cfg => {
      setConfig(cfg);
      // First-run UX: if either field is missing, expand settings so the
      // user can fill them in before sending anything.
      if (!cfg.url || !cfg.apiKey) setShowSettings(true);
    }).catch(() => {});
  }, []);

  const onSettingsSave = async () => {
    await saveLlmConfig(config);
    setShowSettings(false);
    setError(null);
  };

  const onResetConversation = () => {
    setHistory([]);
    setCodeSnapshots([]);
    setLastHtmlHash(null);
    setError(null);
  };

  const onUndo = () => {
    if (codeSnapshots.length === 0) return;
    const previous = codeSnapshots[codeSnapshots.length - 1];
    setCodeSnapshots(prev => prev.slice(0, -1));
    // Pop the last user + AI exchange from history so a follow-up doesn't
    // reference the undone turn.
    setHistory(prev => prev.slice(0, -2));
    onCodeUpdated(previous);
  };

  const captureHtml = async (): Promise<{ html: string; url: string | undefined }> => {
    try {
      const resp = await chrome.runtime.sendMessage({
        type: 'rh-recorder/getRecordedTabHtml',
      }) as { ok: boolean; html?: string; tabId?: number; error?: string };

      if (resp?.ok && typeof resp.html === 'string') {
        let url: string | undefined;
        if (resp.tabId !== undefined) {
          const tab = await chrome.tabs.get(resp.tabId).catch(() => undefined);
          url = tab?.url;
        }
        return { html: resp.html, url };
      }
      return { html: `<!-- could not capture HTML: ${resp?.error ?? 'unknown error'} -->`, url: undefined };
    } catch (e) {
      return { html: `<!-- could not capture HTML: ${e instanceof Error ? e.message : String(e)} -->`, url: undefined };
    }
  };

  const onSend = async () => {
    setError(null);

    if (!prompt.trim()) {
      setError('Type an instruction first.');
      return;
    }
    if (!config.url || !config.apiKey) {
      setShowSettings(true);
      setError('Set the LLM API URL and API key first.');
      return;
    }

    setBusy(true);
    try {
      const { html: pageHtml, url: pageUrl } = await captureHtml();

      const newHash = hashString(pageHtml);
      const htmlChanged = newHash !== lastHtmlHash;

      const result = await rewriteTestViaLlm({
        config,
        userInstruction: prompt,
        currentCode,
        pageHtml,
        pageUrl,
        history,
        htmlChanged,
      });

      // Snapshot the pre-AI code so Undo can restore it. Push BEFORE we replace.
      setCodeSnapshots(prev => [...prev, currentCode]);
      // Append both sides of this turn to history.
      setHistory(prev => [...prev, result.userMessage, result.aiMessage]);
      setLastHtmlHash(newHash);

      onCodeUpdated(result.newCode);
      setPrompt('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Cmd/Ctrl+Enter sends.
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      void onSend();
    }
  };

  const configured = !!config.url && !!config.apiKey;
  const turnCount = Math.floor(history.length / 2);
  const canUndo = codeSnapshots.length > 0;

  return (
    <div className='ai-prompt-box'>
      <div className='ai-prompt-header'>
        <span className='ai-prompt-title'>
          Edit with AI
          {turnCount > 0 && <span className='ai-prompt-turn-count'>· {turnCount} turn{turnCount === 1 ? '' : 's'}</span>}
        </span>
        <button
          type='button'
          className='ai-prompt-settings-toggle'
          onClick={() => setShowSettings(s => !s)}
          title='LLM API settings'
        >
          {showSettings ? 'Hide settings' : (configured ? 'Settings' : 'Set up')}
        </button>
      </div>

      {showSettings && (
        <div className='ai-prompt-settings'>
          <label>
            LLM API URL
            <input
              type='text'
              value={config.url}
              onChange={e => setConfig({ ...config, url: e.target.value.trim() })}
              placeholder='https://rh-prod-llm-api-...azurewebsites.net'
            />
          </label>
          <label>
            API key
            <input
              type='password'
              value={config.apiKey}
              autoComplete='off'
              spellCheck={false}
              onChange={e => setConfig({ ...config, apiKey: e.target.value.trim() })}
              placeholder='x-api-key value'
            />
          </label>
          <label>
            Model
            <select
              value={config.model}
              onChange={e => setConfig({ ...config, model: e.target.value })}
            >
              {AVAILABLE_MODELS.map(m => (
                <option key={m.id} value={m.id}>{m.label} ({m.id})</option>
              ))}
            </select>
          </label>
          <button type='button' onClick={onSettingsSave} disabled={!config.url || !config.apiKey}>
            Save
          </button>
          <small className='ai-prompt-hint'>
            Saved locally via <code>chrome.storage.local</code>. Sent only to the configured URL.
          </small>
          {turnCount > 0 && (
            <button
              type='button'
              className='ai-prompt-reset-link'
              onClick={onResetConversation}
            >
              Clear conversation history ({turnCount} turn{turnCount === 1 ? '' : 's'})
            </button>
          )}
        </div>
      )}

      <textarea
        className='ai-prompt-textarea'
        placeholder={'e.g. "Select any row in the documents grid, capture the retailer name, then assert any expanded sub-row appears beneath it."'}
        value={prompt}
        onChange={e => setPrompt(e.target.value)}
        onKeyDown={onKeyDown}
        rows={3}
        disabled={busy}
      />

      <div className='ai-prompt-footer'>
        <span className='ai-prompt-hotkey'>⌘/Ctrl + Enter to send</span>
        <div className='ai-prompt-actions'>
          <button
            type='button'
            className='ai-prompt-undo'
            onClick={onUndo}
            disabled={busy || !canUndo}
            title={canUndo ? 'Revert the last AI edit' : 'Nothing to undo'}
          >
            Undo
          </button>
          <button
            type='button'
            className='ai-prompt-send'
            onClick={onSend}
            disabled={busy || !prompt.trim()}
          >
            {busy ? 'Thinking…' : 'Send'}
          </button>
        </div>
      </div>

      {error && <div className='ai-prompt-error'>{error}</div>}
    </div>
  );
};
