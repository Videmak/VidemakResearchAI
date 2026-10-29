import { describe, expect, it } from 'vitest';
import { pdfAuthors, pdfDoi, pdfTitle } from '../src/lib/pdfMetadata.js';

describe('PDF metadata for uploads', () => {
  it('keeps real titles and drops what word processors leave behind', () => {
    expect(pdfTitle('Sleep and Memory in University Students')).toBe('Sleep and Memory in University Students');
    expect(pdfTitle('Microsoft Word - thesis draft.docx')).toBeNull();
    expect(pdfTitle('Untitled')).toBeNull();
    expect(pdfTitle('chapter3.pdf')).toBeNull();
    expect(pdfTitle('  ')).toBeNull();
  });

  it('splits real author lists and ignores placeholder names', () => {
    expect(pdfAuthors('Matthew P. Walker; Robert Stickgold')).toEqual(['Matthew P. Walker', 'Robert Stickgold']);
    expect(pdfAuthors('Rasch, Bjorn and Born, Jan')).toEqual(['Rasch, Bjorn', 'Born, Jan']);
    expect(pdfAuthors('Admin')).toEqual([]);
    expect(pdfAuthors('Windows User')).toEqual([]);
    expect(pdfAuthors(undefined)).toEqual([]);
  });

  it('finds the DOI printed on the first page', () => {
    expect(pdfDoi('Annual Review of Psychology 57 doi: 10.1146/annurev.psych.56.091103.070307. Received')).toBe('10.1146/annurev.psych.56.091103.070307');
    expect(pdfDoi('No identifier here.')).toBeNull();
  });
});
