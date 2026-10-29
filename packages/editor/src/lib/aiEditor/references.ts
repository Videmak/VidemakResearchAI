import { formatCitation } from '../citations/citationService';
import { importPaper } from '../../utils/articlesApi';
import { resolveLibraryCitationBibtex } from '../../utils/libraryCitationResolver';
import type { LibraryDocumentResponse } from '../../utils/libraryApi';
import type { Paper } from './assistApi';

function htmlText(html: string) {
  const node = document.createElement('div');
  node.innerHTML = html;
  return (node.textContent || '').replace(/\s+/g, ' ').trim();
}

async function writeClipboard(text: string) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }
  // Without the Clipboard API (plain http, older browsers) a selected textarea still copies.
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
  document.body.appendChild(area);
  area.select();
  const copied = document.execCommand('copy');
  area.remove();
  if (!copied) throw new Error('Copy failed');
}

/** Outside a document there is nowhere to cite into: "Copy" puts the APA reference on the clipboard. */
export async function copyReference(bibtex: string, style = 'apa') {
  await writeClipboard(htmlText(formatCitation(bibtex, style).bibliography));
}

export async function copyLibraryReference(document: LibraryDocumentResponse, style = 'apa') {
  const resolved = await resolveLibraryCitationBibtex(document, style);
  await copyReference(resolved.bibtex, style);
}

/** Imports a search result into the Library (its PDF when open access, else the record). */
export async function addPaperToLibrary(paper: Paper) {
  const doi = paper.doi ? String(paper.doi).replace(/^https?:\/\/(dx\.)?doi\.org\//i, '') : undefined;
  const response = await importPaper({
    url: paper.oa_url || paper.pdf_url || (doi ? `https://doi.org/${doi}` : `https://openalex.org/${paper.id}`),
    pdf_url: paper.pdf_url || undefined,
    title: paper.title,
    authors: (paper.authors || []).map((author) => author.name),
    doi,
    year: paper.year || undefined,
    source: 'scholar',
    abstract: paper.abstract || undefined,
    scholar_id: paper.id || undefined,
  });
  if (!response.success) throw new Error(response.message || 'Could not save to your Library.');
  notifyLibraryChanged();
}

/** Open Library panels reload when a paper is saved or a file uploaded elsewhere. */
export const LIBRARY_CHANGED_EVENT = 'videmak:library-changed';
export function notifyLibraryChanged() {
  window.dispatchEvent(new CustomEvent(LIBRARY_CHANGED_EVENT));
}
