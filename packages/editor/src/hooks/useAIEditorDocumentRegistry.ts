'use client';

import { useCallback, useEffect, useState } from 'react';
import { getAIEditorProvider } from '../lib/aiEditor/getProvider';
import type { AIEditorDocumentSnapshot, AIEditorDocumentSummary } from '../types/ai-editor';

export function useAIEditorDocumentRegistry(
  snapshot: AIEditorDocumentSnapshot | null,
  currentSessionId: string | null,
  currentUserEmail?: string | null,
) {
  const [documents, setDocuments] = useState<AIEditorDocumentSummary[]>([]);
  const [sharedDocuments, setSharedDocuments] = useState<AIEditorDocumentSummary[]>([]);
  const provider = getAIEditorProvider();

  useEffect(() => {
    return provider.subscribeToDocuments((nextDocuments) => {
      setDocuments(nextDocuments);
      setSharedDocuments(
        currentUserEmail ? provider.listDocumentsSharedWith(currentUserEmail) : [],
      );
    });
  }, [currentUserEmail, provider]);

  useEffect(() => {
    if (snapshot) {
      setDocuments(provider.listDocuments());
      setSharedDocuments(
        currentUserEmail ? provider.listDocumentsSharedWith(currentUserEmail) : [],
      );
    }
  }, [currentUserEmail, provider, snapshot]);

  const createDocument = useCallback(() => {
    return provider.createDocument(currentSessionId ?? provider.getSession().sessionId);
  }, [currentSessionId, provider]);

  const deleteDocument = useCallback(
    (documentId: string) => {
      return provider.deleteDocument(documentId, currentSessionId ?? provider.getSession().sessionId);
    },
    [currentSessionId, provider],
  );

  const renameDocument = useCallback(
    (documentId: string, title: string) => {
      const sessionId = currentSessionId ?? provider.getSession().sessionId;
      const nextSnapshot = provider.updateTitle(documentId, sessionId, title);
      setDocuments(provider.listDocuments());
      setSharedDocuments(
        currentUserEmail ? provider.listDocumentsSharedWith(currentUserEmail) : [],
      );
      return nextSnapshot;
    },
    [currentSessionId, currentUserEmail, provider],
  );

  return {
    documents,
    sharedDocuments,
    createDocument,
    deleteDocument,
    renameDocument,
  };
}
