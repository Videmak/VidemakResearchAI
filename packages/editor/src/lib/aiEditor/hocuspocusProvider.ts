'use client';

import * as Y from 'yjs';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { IndexeddbPersistence } from 'y-indexeddb';
import type { Awareness } from 'y-protocols/awareness';
import type { AIEditorAccessRole, AIEditorCollaborator } from '../../types/ai-editor';
import { getAuthToken } from '../../utils/auth/api';
import { getEditorConfig } from '../../runtime';

type ProviderStatus = 'connecting' | 'connected' | 'error';

type Options = {
  documentId: string;
  session: AIEditorCollaborator;
  requestedRole: AIEditorAccessRole | null;
  onInit: (payload: { isEmpty: boolean }) => void;
  onStatusChange?: (status: ProviderStatus) => void;
  onPendingChange?: (pendingCount: number) => void;
};

function realtimeUrl() {
  const configured = getEditorConfig().realtimeUrl;
  if (configured) return configured;
  const url = new URL('/collab', window.location.origin);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}

const fragmentIsEmpty = (doc: Y.Doc) => doc.getXmlFragment('prosemirror').length === 0;

/**
 * Live document sync over Hocuspocus, with a copy kept in the browser (IndexedDB) so a
 * document opens instantly and keeps working offline. Same surface as the provider the
 * editor was written against: doc, awareness, flush(), destroy() and the three callbacks.
 */
export class AIEditorCRDTSocketProvider {
  public readonly doc: Y.Doc;
  public readonly awareness: Awareness;
  private readonly remote: HocuspocusProvider;
  private readonly local: IndexeddbPersistence | null;
  private initialised = false;
  private destroyed = false;
  private readonly onInit: Options['onInit'];
  private readonly onPendingChange?: Options['onPendingChange'];
  private flushWaiters: Array<(revision: number | null) => void> = [];

  constructor(options: Options) {
    this.doc = new Y.Doc();
    this.onInit = options.onInit;
    this.onPendingChange = options.onPendingChange;

    // A cached copy with content can be shown at once. An empty cache must wait for the
    // server: reporting "empty" early would make the editor seed a second copy of the text.
    this.local = typeof indexedDB !== 'undefined' ? new IndexeddbPersistence(`videmak-doc-${options.documentId}`, this.doc) : null;
    this.local?.once('synced', () => {
      if (!this.initialised && !fragmentIsEmpty(this.doc)) this.init(false);
    });

    this.remote = new HocuspocusProvider({
      url: realtimeUrl(),
      name: options.documentId,
      document: this.doc,
      token: () => getAuthToken() || '',
      parameters: options.requestedRole ? { access: options.requestedRole } : {},
      onStatus: ({ status }) => {
        if (status === 'connected') options.onStatusChange?.('connected');
        else options.onStatusChange?.('connecting');
      },
      onSynced: () => {
        if (!this.initialised) this.init(fragmentIsEmpty(this.doc));
        this.reportPending();
      },
      onAuthenticationFailed: () => options.onStatusChange?.('error'),
    });
    this.awareness = this.remote.awareness as unknown as Awareness;
    this.awareness.setLocalStateField('user', { name: options.session.displayName, color: options.session.color });
    this.remote.on('unsyncedChanges', () => this.reportPending());
  }

  private init(isEmpty: boolean) {
    if (this.initialised || this.destroyed) return;
    this.initialised = true;
    this.onInit({ isEmpty });
  }

  private reportPending() {
    const pending = this.remote.unsyncedChanges;
    this.onPendingChange?.(pending);
    if (pending === 0) this.flushWaiters.splice(0).forEach((resolve) => resolve(Date.now()));
  }

  /** Resolves once every local change has reached the server (or at once when offline-safe). */
  public flush(): Promise<number | null> {
    if (this.remote.unsyncedChanges === 0) return Promise.resolve(Date.now());
    return new Promise((resolve) => {
      this.flushWaiters.push(resolve);
      window.setTimeout(() => resolve(null), 15_000);
    });
  }

  public destroy() {
    this.destroyed = true;
    this.flushWaiters.splice(0).forEach((resolve) => resolve(null));
    this.awareness.setLocalState(null);
    this.remote.destroy();
    this.local?.destroy();
    this.doc.destroy();
  }
}
