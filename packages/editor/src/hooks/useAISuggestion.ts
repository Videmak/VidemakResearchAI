"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import { getHost } from '../helpers/getHost';
import { getAuthToken } from '../utils/auth/api';
import { getJob, postDurableJson, retryJob, waitForJob } from '../utils/jobsApi';
import { LibraryDocumentResponse } from '../utils/libraryApi';

export type SuggestionType = 'idle' | 'title' | 'subtitle' | 'paragraph' | 'conclusive';
export type SourceType = 'web' | 'myfiles' | 'hybrid';
export type WritingFlowMode = 'start' | 'inline';
export type SuggestionConnectionState = 'idle' | 'connecting' | 'connected' | 'reconnecting';

type GenerationSourceSelection = {
  sourceType: SourceType;
  selectedDocumentIds: string[];
  folderId: string | null;
};

export interface Citation {
  id: string;
  bibtex: string;
  base64: string;
  displayText: string;
}

export interface AISuggestion {
  id: string;
  type: SuggestionType;
  text: string;
  html: string;
  citations: Citation[];
}

export interface WritingContext {
  topic: string;
  documentTitle: string;
  documentSummary: string;
  currentSectionTitle: string;
  currentSectionContent: string;
  previousParagraph: string;
  allCitations: Citation[];
}

export interface ContinueWritingOptions {
  topic: string;
  documentContent: string;
  previousParagraph: string;
  cursorPosition: number;
  targetBlockId?: string | null;
  documentRevision?: number | null;
}

export type PersistAcceptedSuggestion = (
  suggestion: AISuggestion,
  targetBlockId: string | null,
) => Promise<{ documentRevision: number | null; targetBlockId: string | null }>;

export interface UseAISuggestionOptions {
  onSuggestionReady?: (suggestion: AISuggestion) => void;
  onAccept?: (suggestion: AISuggestion) => void;
  onReject?: () => void;
  onStop?: () => void;
  documentId?: string | null;
  initialSource?: SourceType;
  initialAutoSuggest?: boolean;
}

export interface UseAISuggestionReturn {
  isActive: boolean;
  isLoading: boolean;
  isApplying: boolean;
  error: string | null;
  currentSuggestion: AISuggestion | null;
  suggestionType: SuggestionType;
  sourceType: SourceType;
  autoSuggestEnabled: boolean;
  selectedDocuments: LibraryDocumentResponse[];
  selectedFolderId: string | null;
  writingContext: WritingContext | null;
  activeJobId: string | null;
  progressPct: number;
  stage: string | null;
  connectionState: SuggestionConnectionState;
  flowMode: WritingFlowMode;
  targetBlockId: string | null;
  startWriting: (
    topic: string,
    targetBlockId?: string | null,
    documentRevision?: number | null,
    sourceSelection?: GenerationSourceSelection,
  ) => Promise<void>;
  continueWriting: (options: ContinueWritingOptions) => Promise<void>;
  writeConclusion: (options: ContinueWritingOptions) => Promise<void>;
  acceptSuggestion: (
    persist?: PersistAcceptedSuggestion,
    nextAction?: 'auto' | 'conclude' | 'stop',
  ) => Promise<void>;
  tryAgain: () => Promise<void>;
  conclude: () => Promise<void>;
  stop: () => Promise<void>;
  retryFailed: () => Promise<void>;
  setSourceType: (type: SourceType) => void;
  setAutoSuggest: (enabled: boolean) => void;
  setSelectedDocuments: (docs: LibraryDocumentResponse[]) => void;
  setSelectedFolderId: (folderId: string | null) => void;
}

const AI_EDITOR_GENERATION_JOB_PREFIX = 'ai-editor-generation-job';

type RememberedEditorGeneration = {
  requestId: string;
  jobId: string | null;
  type: Exclude<SuggestionType, 'idle'>;
  context: WritingContext;
  sourceType: SourceType;
  selectedDocumentIds: string[];
  folderId: string | null;
  flowMode: WritingFlowMode;
  targetBlockId: string | null;
  targetCursorPosition: number | null;
  documentRevision: number | null;
  claimId?: string;
};

type EditorGenerationSnapshot = {
  job_id: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'dead_letter';
  stage?: string | null;
  progress_pct?: number | null;
  error?: string | null;
  result?: Record<string, unknown> | null;
  request_id?: string;
  document_id?: string;
  target_block_id?: string | null;
  target_cursor_position?: number | null;
  document_revision?: number | null;
  flow_mode?: WritingFlowMode;
  suggestion_type?: Exclude<SuggestionType, 'idle'>;
  request?: Record<string, any>;
  delivery?: { state?: string };
};

function generationStorageKey(documentId: string): string {
  return `${AI_EDITOR_GENERATION_JOB_PREFIX}:${documentId}`;
}

function readRemembered(documentId: string): RememberedEditorGeneration | null {
  if (typeof window === 'undefined') return null;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(generationStorageKey(documentId)) || 'null');
    if (!parsed?.requestId || !parsed?.type || !parsed?.context) return null;
    return parsed as RememberedEditorGeneration;
  } catch {
    return null;
  }
}

function writeRemembered(documentId: string, remembered: RememberedEditorGeneration): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(generationStorageKey(documentId), JSON.stringify(remembered));
}

function clearRemembered(documentId: string): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(generationStorageKey(documentId));
}

function toSuggestion(data: any, type: SuggestionType): AISuggestion {
  return {
    id: String(data?.id || `suggestion_${Date.now()}`),
    type,
    text: String(data?.text || ''),
    html: String(data?.html || ''),
    citations: Array.isArray(data?.citations) ? data.citations : [],
  };
}

function serializeContext(context: WritingContext) {
  return {
    topic: context.topic,
    document_title: context.documentTitle,
    document_summary: context.documentSummary,
    current_section_title: context.currentSectionTitle,
    current_section_content: context.currentSectionContent,
    previous_paragraph: context.previousParagraph,
    citations: context.allCitations.map((citation) => ({ id: citation.id, bibtex: citation.bibtex })),
  };
}

function restoreContext(raw: Record<string, any> | undefined): WritingContext {
  return {
    topic: String(raw?.topic || 'Document draft'),
    documentTitle: String(raw?.document_title || ''),
    documentSummary: String(raw?.document_summary || ''),
    currentSectionTitle: String(raw?.current_section_title || ''),
    currentSectionContent: String(raw?.current_section_content || ''),
    previousParagraph: String(raw?.previous_paragraph || ''),
    allCitations: Array.isArray(raw?.citations)
      ? raw.citations.map((citation: any) => ({
          id: String(citation?.id || ''),
          bibtex: String(citation?.bibtex || ''),
          base64: String(citation?.base64 || ''),
          displayText: String(citation?.displayText || ''),
        }))
      : [],
  };
}

function rememberedFromSnapshot(snapshot: EditorGenerationSnapshot): RememberedEditorGeneration {
  const request = snapshot.request || {};
  return {
    requestId: String(snapshot.request_id || request.request_id || crypto.randomUUID()),
    jobId: snapshot.job_id,
    type: snapshot.suggestion_type || request.type || 'paragraph',
    context: restoreContext(request.context),
    sourceType: request.source_type || 'web',
    selectedDocumentIds: Array.isArray(request.selected_document_ids) ? request.selected_document_ids : [],
    folderId: typeof request.folder_id === 'string' ? request.folder_id : null,
    flowMode: snapshot.flow_mode || request.flow_mode || 'inline',
    targetBlockId: snapshot.target_block_id || request.target_block_id || null,
    targetCursorPosition: snapshot.target_cursor_position ?? request.target_cursor_position ?? null,
    documentRevision: snapshot.document_revision ?? request.document_revision ?? null,
  };
}

async function recoveryJson<T>(url: string, init?: RequestInit): Promise<T | null> {
  const token = getAuthToken();
  const response = await fetch(url, {
    ...init,
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers || {}),
    },
  });
  if (response.status === 404) return null;
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(String(body?.detail || body?.error || `AI writing recovery failed (${response.status})`));
  }
  return response.json() as Promise<T>;
}

async function discoverGeneration(documentId: string, requestId?: string): Promise<EditorGenerationSnapshot | null> {
  const query = requestId ? `?request_id=${encodeURIComponent(requestId)}` : '';
  return recoveryJson<EditorGenerationSnapshot>(
    `${getHost()}/api/editor/documents/${encodeURIComponent(documentId)}/generation${query}`,
  );
}

async function updateDelivery(
  jobId: string,
  action: 'claim' | 'seen' | 'accepted' | 'dismissed',
  claimId?: string,
  documentRevision?: number | null,
): Promise<{ state?: string } | null> {
  const response = await recoveryJson<{ delivery?: { state?: string } }>(
    `${getHost()}/api/editor/generations/${encodeURIComponent(jobId)}/delivery`,
    {
      method: 'POST',
      body: JSON.stringify({ action, claim_id: claimId, document_revision: documentRevision }),
    },
  );
  return response?.delivery || null;
}

function getNextType(current: SuggestionType, conclude: boolean): Exclude<SuggestionType, 'idle'> {
  if (conclude) return 'conclusive';
  if (current === 'idle') return 'title';
  if (current === 'title') return 'subtitle';
  if (current === 'conclusive') return 'subtitle';
  return 'paragraph';
}

export function useAISuggestion(options: UseAISuggestionOptions = {}): UseAISuggestionReturn {
  const {
    onSuggestionReady,
    onAccept,
    onReject,
    onStop,
    documentId,
    initialSource = 'web',
    initialAutoSuggest = true,
  } = options;

  const callbacksRef = useRef({ onSuggestionReady, onAccept, onReject, onStop });
  callbacksRef.current = { onSuggestionReady, onAccept, onReject, onStop };

  const [isActive, setIsActive] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentSuggestion, setCurrentSuggestion] = useState<AISuggestion | null>(null);
  const [suggestionType, setSuggestionType] = useState<SuggestionType>('idle');
  const [sourceType, setSourceType] = useState<SourceType>(initialSource);
  const [autoSuggestEnabled, setAutoSuggestEnabled] = useState(initialAutoSuggest);
  const [selectedDocuments, setSelectedDocuments] = useState<LibraryDocumentResponse[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [writingContext, setWritingContext] = useState<WritingContext | null>(null);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [progressPct, setProgressPct] = useState(0);
  const [stage, setStage] = useState<string | null>(null);
  const [connectionState, setConnectionState] = useState<SuggestionConnectionState>('idle');
  const [flowMode, setFlowMode] = useState<WritingFlowMode>('inline');
  const [targetBlockId, setTargetBlockId] = useState<string | null>(null);

  const acceptedContent = useRef<string[]>([]);
  const allCitations = useRef<Citation[]>([]);
  const activeRecordRef = useRef<RememberedEditorGeneration | null>(null);
  const recoveryVersionRef = useRef(0);
  const waitAbortRef = useRef<AbortController | null>(null);

  const beginWait = useCallback(() => {
    waitAbortRef.current?.abort();
    const controller = new AbortController();
    waitAbortRef.current = controller;
    return controller;
  }, []);

  const showResult = useCallback((record: RememberedEditorGeneration, data: any) => {
    if (!data?.success) throw new Error(String(data?.error || 'Generation failed'));
    const suggestion = toSuggestion(data, record.type);
    activeRecordRef.current = record;
    setCurrentSuggestion(suggestion);
    setSuggestionType(record.type);
    setWritingContext(record.context);
    setFlowMode(record.flowMode);
    setTargetBlockId(record.targetBlockId);
    setIsActive(true);
    setIsLoading(false);
    setProgressPct(100);
    setStage('suggestion_ready');
    setError(null);
    setConnectionState('connected');
    callbacksRef.current.onSuggestionReady?.(suggestion);
    window.dispatchEvent(new CustomEvent('credits-updated'));
    if (record.jobId) void updateDelivery(record.jobId, 'seen').catch(() => undefined);
  }, []);

  const followRecord = useCallback(async (
    record: RememberedEditorGeneration,
    snapshot?: EditorGenerationSnapshot | null,
  ) => {
    const controller = beginWait();
    activeRecordRef.current = record;
    if (documentId) writeRemembered(documentId, record);
    setIsActive(true);
    setIsLoading(true);
    setSuggestionType(record.type);
    setWritingContext(record.context);
    setFlowMode(record.flowMode);
    setTargetBlockId(record.targetBlockId);
    setActiveJobId(record.jobId);
    setError(null);
    setProgressPct(Number(snapshot?.progress_pct || 0));
    setStage(snapshot?.stage || 'queued');
    setConnectionState('connecting');

    if (!record.jobId) throw new Error('The writing task has not been queued yet.');
    if (snapshot?.status === 'failed' || snapshot?.status === 'cancelled' || snapshot?.status === 'dead_letter') {
      throw new Error(snapshot.error || 'The saved AI writing task could not be completed.');
    }
    const data = snapshot?.status === 'completed'
      ? snapshot.result
      : await waitForJob(record.jobId, {
          timeoutMs: null,
          signal: controller.signal,
          onProgress: (pct: any, nextStage: any) => {
            setProgressPct(pct);
            if (nextStage) setStage(nextStage);
          },
          onConnectionState: setConnectionState,
        });
    if (!controller.signal.aborted) showResult(record, data);
  }, [beginWait, documentId, showResult]);

  const submitRecord = useCallback(async (record: RememberedEditorGeneration) => {
    const controller = beginWait();
    activeRecordRef.current = record;
    if (documentId) writeRemembered(documentId, record);
    setIsActive(true);
    setIsLoading(true);
    setCurrentSuggestion(null);
    setError(null);
    setSuggestionType(record.type);
    setWritingContext(record.context);
    setFlowMode(record.flowMode);
    setTargetBlockId(record.targetBlockId);
    setProgressPct(0);
    setStage('queued');
    setConnectionState('connecting');

    try {
      const data = await postDurableJson<any>(
        `${getHost()}/api/editor/generate`,
        {
          request_id: record.requestId,
          document_id: documentId || undefined,
          target_block_id: record.targetBlockId,
          target_cursor_position: record.targetCursorPosition,
          document_revision: record.documentRevision,
          flow_mode: record.flowMode,
          type: record.type,
          context: serializeContext(record.context),
          source_type: record.sourceType,
          selected_document_ids: record.selectedDocumentIds,
          folder_id: record.folderId,
        },
        {
          requestId: record.requestId,
          timeoutMs: null,
          signal: controller.signal,
          onQueued: ({ job_id }) => {
            record.jobId = job_id;
            activeRecordRef.current = record;
            setActiveJobId(job_id);
            if (documentId) writeRemembered(documentId, record);
          },
          onProgress: (pct, nextStage) => {
            setProgressPct(pct);
            if (nextStage) setStage(nextStage);
          },
          onConnectionState: setConnectionState,
        },
      );
      if (!controller.signal.aborted) showResult(record, data);
    } catch (submitError) {
      if (controller.signal.aborted || (submitError instanceof DOMException && submitError.name === 'AbortError')) return;
      if (documentId) {
        const discovered = await discoverGeneration(documentId, record.requestId).catch(() => null);
        if (discovered) {
          const recovered = rememberedFromSnapshot(discovered);
          recovered.claimId = record.claimId;
          writeRemembered(documentId, recovered);
          await followRecord(recovered, discovered);
          return;
        }
      }
      throw submitError;
    }
  }, [beginWait, documentId, followRecord, showResult]);

  const generateNextSuggestion = useCallback(async (
    type: Exclude<SuggestionType, 'idle'>,
    context: WritingContext,
    mode: WritingFlowMode,
    anchor: string | null,
    cursor: number | null,
    revision: number | null,
    sourceSelection?: GenerationSourceSelection,
  ) => {
    const record: RememberedEditorGeneration = {
      requestId: crypto.randomUUID(),
      jobId: null,
      type,
      context,
      sourceType: sourceSelection?.sourceType ?? sourceType,
      selectedDocumentIds: sourceSelection?.selectedDocumentIds ?? selectedDocuments.map((document) => document.id),
      folderId: sourceSelection?.folderId ?? selectedFolderId,
      flowMode: mode,
      targetBlockId: anchor,
      targetCursorPosition: cursor,
      documentRevision: revision,
    };
    try {
      await submitRecord(record);
    } catch (generationError) {
      setError(generationError instanceof Error ? generationError.message : 'Failed to generate suggestion');
      setIsLoading(false);
      setConnectionState('idle');
    }
  }, [selectedDocuments, selectedFolderId, sourceType, submitRecord]);

  useEffect(() => {
    if (!documentId || typeof window === 'undefined') return;
    waitAbortRef.current?.abort();
    activeRecordRef.current = null;
    setCurrentSuggestion(null);
    setActiveJobId(null);
    setIsActive(false);
    setIsLoading(false);
    setError(null);
    const version = ++recoveryVersionRef.current;
    let disposed = false;

    void (async () => {
      const remembered = readRemembered(documentId);
      try {
        const discovered = await discoverGeneration(documentId, remembered?.requestId);
        if (disposed || recoveryVersionRef.current !== version) return;
        if (discovered) {
          const recovered = rememberedFromSnapshot(discovered);
          recovered.claimId = remembered?.claimId;
          writeRemembered(documentId, recovered);
          await followRecord(recovered, discovered);
          return;
        }
        if (remembered?.jobId) {
          clearRemembered(documentId);
          return;
        }
        if (remembered) {
          await submitRecord(remembered);
          return;
        }
        const newest = await discoverGeneration(documentId);
        if (disposed || recoveryVersionRef.current !== version || !newest) return;
        const recovered = rememberedFromSnapshot(newest);
        writeRemembered(documentId, recovered);
        await followRecord(recovered, newest);
      } catch (recoveryError) {
        if (!disposed) {
          setIsActive(Boolean(remembered));
          setIsLoading(false);
          setError(recoveryError instanceof Error ? recoveryError.message : 'The saved writing task could not be restored.');
        }
      }
    })();

    return () => {
      disposed = true;
      waitAbortRef.current?.abort();
    };
  }, [documentId, followRecord, submitRecord]);

  const startWriting = useCallback(async (
    topic: string,
    anchor: string | null = null,
    revision: number | null = null,
    sourceSelection?: GenerationSourceSelection,
  ) => {
    acceptedContent.current = [];
    allCitations.current = [];
    const context: WritingContext = {
      topic,
      documentTitle: '',
      documentSummary: '',
      currentSectionTitle: '',
      currentSectionContent: '',
      previousParagraph: '',
      allCitations: [],
    };
    setWritingContext(context);
    await generateNextSuggestion('title', context, 'start', anchor, null, revision, sourceSelection);
  }, [generateNextSuggestion]);

  const continueWriting = useCallback(async (request: ContinueWritingOptions) => {
    const context: WritingContext = {
      topic: request.topic,
      documentTitle: request.topic,
      documentSummary: request.documentContent.substring(0, 500),
      currentSectionTitle: '',
      currentSectionContent: request.documentContent,
      previousParagraph: request.previousParagraph,
      allCitations: allCitations.current,
    };
    setWritingContext(context);
    await generateNextSuggestion(
      'paragraph',
      context,
      'inline',
      request.targetBlockId || null,
      request.cursorPosition,
      request.documentRevision ?? null,
    );
  }, [generateNextSuggestion]);

  const writeConclusion = useCallback(async (request: ContinueWritingOptions) => {
    const context: WritingContext = {
      topic: request.topic,
      documentTitle: request.topic,
      documentSummary: request.documentContent.substring(0, 500),
      currentSectionTitle: '',
      currentSectionContent: request.documentContent,
      previousParagraph: request.previousParagraph,
      allCitations: allCitations.current,
    };
    setWritingContext(context);
    await generateNextSuggestion(
      'conclusive',
      context,
      'inline',
      request.targetBlockId || null,
      request.cursorPosition,
      request.documentRevision ?? null,
    );
  }, [generateNextSuggestion]);

  const acceptSuggestion = useCallback(async (
    persist?: PersistAcceptedSuggestion,
    nextAction: 'auto' | 'conclude' | 'stop' = 'auto',
  ) => {
    if (!currentSuggestion || !writingContext || isApplying) return;
    const record = activeRecordRef.current;
    const claimId = record?.claimId || crypto.randomUUID();
    if (record) {
      record.claimId = claimId;
      if (documentId) writeRemembered(documentId, record);
    }
    setIsApplying(true);
    setError(null);
    try {
      if (record?.jobId && documentId) {
        const delivery = await updateDelivery(record.jobId, 'claim', claimId);
        if (delivery?.state === 'accepted' || delivery?.state === 'dismissed') {
          clearRemembered(documentId);
          setCurrentSuggestion(null);
          setIsActive(false);
          setActiveJobId(null);
          activeRecordRef.current = null;
          return;
        }
      }
      const commit = persist
        ? await persist(currentSuggestion, record?.targetBlockId || null)
        : { documentRevision: null, targetBlockId: record?.targetBlockId || null };
      const committedRevision = commit.documentRevision;
      const committedTargetBlockId = commit.targetBlockId;
      if (record?.jobId && documentId) {
        await updateDelivery(record.jobId, 'accepted', claimId, committedRevision);
        clearRemembered(documentId);
      } else if (documentId) {
        clearRemembered(documentId);
      }

      acceptedContent.current.push(currentSuggestion.html);
      allCitations.current.push(...currentSuggestion.citations);
      const updatedContext: WritingContext = { ...writingContext, allCitations: allCitations.current };
      if (currentSuggestion.type === 'title') updatedContext.documentTitle = currentSuggestion.text;
      if (currentSuggestion.type === 'subtitle') {
        updatedContext.currentSectionTitle = currentSuggestion.text;
        updatedContext.currentSectionContent = '';
      }
      if (currentSuggestion.type === 'paragraph' || currentSuggestion.type === 'conclusive') {
        updatedContext.currentSectionContent += `\n${currentSuggestion.html}`;
        updatedContext.previousParagraph = currentSuggestion.text;
      }
      setWritingContext(updatedContext);
      setTargetBlockId(committedTargetBlockId);
      callbacksRef.current.onAccept?.(currentSuggestion);
      setCurrentSuggestion(null);
      setActiveJobId(null);
      activeRecordRef.current = null;

      if (nextAction === 'conclude') {
        await generateNextSuggestion('conclusive', updatedContext, flowMode, committedTargetBlockId, null, committedRevision);
      } else if (nextAction === 'auto' && autoSuggestEnabled && flowMode === 'start') {
        await generateNextSuggestion(
          getNextType(currentSuggestion.type, false),
          updatedContext,
          flowMode,
          committedTargetBlockId,
          null,
          committedRevision,
        );
      } else {
        setIsActive(false);
        setSuggestionType('idle');
      }
    } catch (acceptError) {
      setError(acceptError instanceof Error ? acceptError.message : 'The suggestion could not be saved.');
    } finally {
      setIsApplying(false);
    }
  }, [autoSuggestEnabled, currentSuggestion, documentId, flowMode, generateNextSuggestion, isApplying, writingContext]);

  const tryAgain = useCallback(async () => {
    if (!writingContext || suggestionType === 'idle') return;
    const record = activeRecordRef.current;
    if (record?.jobId && documentId) {
      await updateDelivery(record.jobId, 'dismissed');
      clearRemembered(documentId);
    }
    callbacksRef.current.onReject?.();
    setCurrentSuggestion(null);
    await generateNextSuggestion(
      suggestionType,
      writingContext,
      flowMode,
      targetBlockId,
      record?.targetCursorPosition ?? null,
      record?.documentRevision ?? null,
    );
  }, [documentId, flowMode, generateNextSuggestion, suggestionType, targetBlockId, writingContext]);

  const conclude = useCallback(async () => {
    if (!writingContext) return;
    await generateNextSuggestion('conclusive', writingContext, flowMode, targetBlockId, null, null);
  }, [flowMode, generateNextSuggestion, targetBlockId, writingContext]);

  const stop = useCallback(async () => {
    const record = activeRecordRef.current;
    try {
      if (record?.jobId && documentId) await updateDelivery(record.jobId, 'dismissed');
      if (documentId) clearRemembered(documentId);
      activeRecordRef.current = null;
      setIsActive(false);
      setCurrentSuggestion(null);
      setSuggestionType('idle');
      setIsLoading(false);
      setActiveJobId(null);
      setError(null);
      setConnectionState('idle');
      callbacksRef.current.onStop?.();
    } catch (stopError) {
      setError(stopError instanceof Error ? stopError.message : 'The writing task could not be dismissed.');
    }
  }, [documentId]);

  const retryFailed = useCallback(async () => {
    const record = activeRecordRef.current;
    if (!record?.jobId) return;
    setError(null);
    setIsLoading(true);
    try {
      await retryJob(record.jobId);
      const snapshot = await getJob(record.jobId);
      await followRecord(record, {
        job_id: snapshot.id,
        status: snapshot.status,
        stage: snapshot.stage,
        progress_pct: snapshot.progress_pct,
        error: snapshot.error,
        result: snapshot.result_json,
      });
    } catch (retryError) {
      setIsLoading(false);
      setError(retryError instanceof Error ? retryError.message : 'The writing task could not be retried.');
    }
  }, [followRecord]);

  return {
    isActive,
    isLoading,
    isApplying,
    error,
    currentSuggestion,
    suggestionType,
    sourceType,
    autoSuggestEnabled,
    selectedDocuments,
    selectedFolderId,
    writingContext,
    activeJobId,
    progressPct,
    stage,
    connectionState,
    flowMode,
    targetBlockId,
    startWriting,
    continueWriting,
    writeConclusion,
    acceptSuggestion,
    tryAgain,
    conclude,
    stop,
    retryFailed,
    setSourceType,
    setAutoSuggest: setAutoSuggestEnabled,
    setSelectedDocuments,
    setSelectedFolderId,
  };
}

export default useAISuggestion;
