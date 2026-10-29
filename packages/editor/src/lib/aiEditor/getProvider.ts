'use client';

import { createDocsBackendProvider } from './docsProvider';
import { createLocalAIEditorProvider, type AIEditorProvider } from './provider';

let providerSingleton: AIEditorProvider | null = null;

export function getAIEditorProvider(): AIEditorProvider {
  if (!providerSingleton) {
    const providerMode = process.env.NEXT_PUBLIC_AI_EDITOR_PROVIDER?.toLowerCase();
    providerSingleton =
      providerMode === 'local' ? createLocalAIEditorProvider() : createDocsBackendProvider();
  }

  return providerSingleton;
}
