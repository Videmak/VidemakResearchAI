import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.JWT_SECRET ||= 'test-secret-for-realtime-merge-0123456789';
});

import { mergeStaleComments } from '../src/realtime.js';

describe('mergeStaleComments', () => {
  it('keeps the sender’s list plus comments others added after the sender’s copy', () => {
    const base = 1_000;
    const current = [
      { id: 'old', createdAt: 500, text: 'deleted by the sender' },
      { id: 'kept', createdAt: 600, text: 'server copy' },
      { id: 'new-elsewhere', createdAt: 1_500, text: 'added by a collaborator' },
    ];
    const incoming = [
      { id: 'kept', createdAt: 600, text: 'edited by the sender' },
      { id: 'ai-1', createdAt: 1_200, text: 'claim check result' },
    ];
    expect(mergeStaleComments(current, incoming, base).map((comment) => comment.id)).toEqual(['new-elsewhere', 'kept', 'ai-1']);
    expect(mergeStaleComments(current, incoming, base)[1].text).toBe('edited by the sender');
  });
});
