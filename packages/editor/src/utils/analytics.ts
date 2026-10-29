import { emitEditorEvent } from '../runtime';

export const trackAIEditorDocumentCreated = (properties?: Record<string, any>) =>
  emitEditorEvent('document_created', properties);

export const trackAIEditorReviewCompleted = (issueCount: number, properties?: Record<string, any>) =>
  emitEditorEvent('review_completed', { issue_count: issueCount, ...(properties || {}) });
