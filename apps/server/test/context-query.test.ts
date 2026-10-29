import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.JWT_SECRET ||= 'test-secret-for-context-query-0123456789ab';
});
const { contextQuery, sharesTopic } = await import('../src/lib/assist-papers.js');

describe('autocomplete paper search', () => {
  const before =
    'These findings have practical consequences for students and shift workers alike. When sleep is restricted after learning, retention of declarative material declines measurably, even when total study time is held constant.';

  it('searches for the topic and the sentence being continued, not the first words', () => {
    const query = contextQuery({ title: 'Sleep and memory in students', section: 'Introduction', before });
    expect(query.split(' ')).toEqual(expect.arrayContaining(['sleep', 'memory']));
    expect(query).not.toMatch(/practical|consequences|introduction/);
  });

  it('keeps papers on the topic and drops unrelated ones', () => {
    const query = contextQuery({ title: 'Sleep and memory in students', before });
    expect(sharesTopic(query, { title: 'Sleep-dependent memory consolidation', abstract: '' })).toBe(true);
    expect(sharesTopic(query, { title: 'Complexities in Student Placements Under COVID-19: Moral and Practical Considerations', abstract: '' })).toBe(false);
  });
});

describe('BibTeX author names', () => {
  it('keeps surname particles with the surname', async () => {
    const { authorLastFirst } = await import('../src/lib/assist-papers.js');
    expect(authorLastFirst('Hans P. A. Van Dongen')).toBe('Van Dongen, Hans P. A.');
    expect(authorLastFirst('Ludwig van Beethoven')).toBe('van Beethoven, Ludwig');
    expect(authorLastFirst('Matthew P. Walker')).toBe('Walker, Matthew P.');
    expect(authorLastFirst('Rasch, Björn')).toBe('Rasch, Björn');
  });
});
