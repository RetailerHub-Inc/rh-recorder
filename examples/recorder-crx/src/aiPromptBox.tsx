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
  LlmConfig,
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
  const [config, setConfig] = React.useState<LlmConfig>({ url: '', apiKey: '' });

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
      // Capture the active recorded tab's HTML.
      const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      let pageHtml = '';
      let pageUrl: string | undefined;

      if (activeTab?.id) {
        pageUrl = activeTab.url;
        try {
          const [{ result }] = await chrome.scripting.executeScript({
            target: { tabId: activeTab.id },
            func: () => document.documentElement.outerHTML,
          });
          pageHtml = (result as string) ?? '';
        } catch (e) {
          // Common failure: trying to script a chrome:// page or a tab the
          // extension can't inject into. Continue without HTML — the LLM can
          // still operate on the test code alone.
          pageHtml = `<!-- could not capture HTML: ${e instanceof Error ? e.message : String(e)} -->`;
        }
      } else {
        pageHtml = '<!-- no active tab detected -->';
      }

      const updated = await rewriteTestViaLlm({
        config,
        userInstruction: prompt,
        currentCode,
        pageHtml,
        pageUrl,
      });

      onCodeUpdated(updated);
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

  return (
    <div className='ai-prompt-box'>
      <div className='ai-prompt-header'>
        <span className='ai-prompt-title'>Edit with AI</span>
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
          <button type='button' onClick={onSettingsSave} disabled={!config.url || !config.apiKey}>
            Save
          </button>
          <small className='ai-prompt-hint'>
            Saved locally via <code>chrome.storage.local</code>. Sent only to the configured URL.
          </small>
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
        <button
          type='button'
          className='ai-prompt-send'
          onClick={onSend}
          disabled={busy || !prompt.trim()}
        >
          {busy ? 'Thinking…' : 'Send'}
        </button>
      </div>

      {error && <div className='ai-prompt-error'>{error}</div>}
    </div>
  );
};
