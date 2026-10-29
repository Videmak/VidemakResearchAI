'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Block } from '@blocknote/core';
import type { AIEditorAccessRole, AIEditorCollaborator } from '../types/ai-editor';
import { AIEditorCRDTSocketProvider } from '../lib/aiEditor/hocuspocusProvider';

type ProviderStatus = 'connecting' | 'connected' | 'error';

type UseAIEditorCrdtResult = {
  collaboration:
    | {
        fragment: any;
        provider: AIEditorCRDTSocketProvider;
        user: {
          name: string;
          color: string;
        };
        showCursorLabels: 'activity';
      }
    | null;
  isReady: boolean;
  isConnecting: boolean;
  shouldSeedInitialContent: boolean;
  status: ProviderStatus;
  pendingUpdateCount: number;
  flush: () => Promise<number | null>;
};

export function useAIEditorCrdt(
  documentId: string | null,
  session: AIEditorCollaborator | null,
  requestedRole: AIEditorAccessRole | null,
  seedBlocks: Block<any, any, any>[],
): UseAIEditorCrdtResult {
  const [provider, setProvider] = useState<AIEditorCRDTSocketProvider | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [isEmpty, setIsEmpty] = useState(false);
  const [status, setStatus] = useState<ProviderStatus>('connecting');
  const [pendingUpdateCount, setPendingUpdateCount] = useState(0);
  const sessionRef = useRef(session);
  sessionRef.current = session;

  const sessionId = session?.sessionId ?? null;

  useEffect(() => {
    const currentSession = sessionRef.current;
    if (!documentId || !currentSession) {
      setProvider(null);
      setIsReady(false);
      setIsEmpty(false);
      setStatus('connecting');
      setPendingUpdateCount(0);
      return;
    }

    setIsReady(false);
    setIsEmpty(false);
    setStatus('connecting');

    const nextProvider = new AIEditorCRDTSocketProvider({
      documentId,
      session: currentSession,
      requestedRole,
      onInit: ({ isEmpty: nextIsEmpty }) => {
        setIsEmpty(nextIsEmpty);
        setIsReady(true);
      },
      onStatusChange: setStatus,
      onPendingChange: setPendingUpdateCount,
    });

    setProvider(nextProvider);

    return () => {
      nextProvider.destroy();
      setProvider(null);
    };
  }, [documentId, requestedRole, sessionId]);

  const sessionDisplayName = session?.displayName ?? '';
  const sessionColor = session?.color ?? '';

  const collaboration = useMemo(() => {
    if (!provider || !sessionId || !isReady) {
      return null;
    }

    return {
      fragment: provider.doc.getXmlFragment('prosemirror'),
      provider,
      user: {
        name: sessionDisplayName,
        color: sessionColor,
      },
      showCursorLabels: 'activity' as const,
    };
  }, [isReady, provider, sessionId, sessionDisplayName, sessionColor]);

  const flush = useCallback(
    () => provider?.flush() ?? Promise.resolve(null),
    [provider],
  );

  return {
    collaboration,
    isReady,
    isConnecting: !isReady && status !== 'error',
    shouldSeedInitialContent: isReady && isEmpty && seedBlocks.length > 0,
    status,
    pendingUpdateCount,
    flush,
  };
}
