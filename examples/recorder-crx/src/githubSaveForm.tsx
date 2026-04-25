/**
 * Copyright (c) RetailerHub Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 */

import React from 'react';
import {
  DEFAULT_PREFS,
  GithubPrefs,
  loadGithubPrefs,
  loadGithubToken,
  pushRecordedTest,
  saveGithubPrefs,
  saveGithubToken,
  suggestFilename,
} from './githubApi';

export interface GithubSaveFormProps {
  code: string;
  onSubmit: (result: { prUrl: string; filePath: string }) => void;
  onError: (error: Error) => void;
}

export const GithubSaveForm: React.FC<GithubSaveFormProps> = ({ code, onSubmit, onError }) => {
  const [token, setToken] = React.useState<string>('');
  const [prefs, setPrefs] = React.useState<GithubPrefs>(DEFAULT_PREFS);
  const [filename, setFilename] = React.useState<string>(suggestFilename());
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    Promise.all([loadGithubToken(), loadGithubPrefs()])
        .then(([loadedToken, loadedPrefs]) => {
          setToken(loadedToken);
          setPrefs(loadedPrefs);
        })
        .catch(() => { /* fall through with defaults */ });
  }, []);

  const onPatch = (patch: Partial<GithubPrefs>) => setPrefs(prev => ({ ...prev, ...patch }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !filename || !prefs.owner || !prefs.repo) return;

    setBusy(true);
    try {
      // Persist before pushing so a successful PAT/prefs setup survives even
      // if the API call fails afterward (the user can retry without re-entry).
      await Promise.all([
        saveGithubToken(token),
        saveGithubPrefs(prefs),
      ]);

      const result = await pushRecordedTest({
        token,
        prefs,
        filename,
        content: code,
      });

      onSubmit({ prUrl: result.prUrl, filePath: result.filePath });
    } catch (err) {
      onError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form id='github-save-form' className='github-save-form' onSubmit={handleSubmit}>
      <label htmlFor='gh-token'>GitHub Personal Access Token (fine-grained)</label>
      <input
        type='password'
        id='gh-token'
        autoComplete='off'
        spellCheck={false}
        placeholder='github_pat_...'
        required
        value={token}
        onChange={e => setToken(e.target.value)}
      />
      <small className='hint'>
        Stored locally via <code>chrome.storage.local</code>. Needs Contents (read+write) and Pull requests (read+write) on the target repo.
      </small>

      <div className='row'>
        <div className='col'>
          <label htmlFor='gh-owner'>Owner</label>
          <input
            type='text'
            id='gh-owner'
            required
            value={prefs.owner}
            onChange={e => onPatch({ owner: e.target.value.trim() })}
          />
        </div>
        <div className='col'>
          <label htmlFor='gh-repo'>Repo</label>
          <input
            type='text'
            id='gh-repo'
            required
            value={prefs.repo}
            onChange={e => onPatch({ repo: e.target.value.trim() })}
          />
        </div>
      </div>

      <label htmlFor='gh-folder'>Folder</label>
      <input
        type='text'
        id='gh-folder'
        required
        value={prefs.folder}
        onChange={e => onPatch({ folder: e.target.value.trim() })}
      />

      <label htmlFor='gh-filename'>Filename</label>
      <input
        type='text'
        id='gh-filename'
        required
        value={filename}
        onChange={e => setFilename(e.target.value.trim())}
      />

      <label htmlFor='gh-base-branch'>Base branch</label>
      <input
        type='text'
        id='gh-base-branch'
        required
        value={prefs.baseBranch}
        onChange={e => onPatch({ baseBranch: e.target.value.trim() })}
      />

      <button id='submit' type='submit' disabled={busy || !token || !filename}>
        {busy ? 'Pushing…' : 'Push as draft PR'}
      </button>
    </form>
  );
};
