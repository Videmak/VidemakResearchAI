/** Acknowledge only the exact handoff that was successfully persisted.
 * A failed parse/save, or a newer export from another tab, must retain its data.
 */
export function captureEditorHandoff(source: 'research-agent' | 'thesis-manuscript') {
  const keys = ['content', 'markdown', 'title', 'authors', 'bibtex', 'citation-style']
    .map(field => `${source}-editor-${field}`);
  const captured = [sessionStorage, localStorage].flatMap(storage =>
    keys.map(key => ({storage, key, value: storage.getItem(key)})));
  const pendingKey = `${source}-pending-doc`;
  const pending = sessionStorage.getItem(pendingKey);
  return () => {
    if (sessionStorage.getItem(pendingKey) !== pending ||
        captured.some(({storage, key, value}) => storage.getItem(key) !== value)) return;
    for (const {storage, key, value} of captured) {
      if (value !== null) storage.removeItem(key);
    }
    sessionStorage.removeItem(pendingKey);
  };
}
