import { preprocessRichDocumentHtml } from '../../utils/googleDocsHtmlForBlockNote';

/** Preserve Studio source payloads as native, editable main-editor citations. */
export function prepareStudioHtmlForEditor(html: string, citationStyle: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('span.citation-token[data-citation]').forEach((span) => {
    span.setAttribute('data-inline-content-type', 'aiCitation');
    span.setAttribute('data-base64', span.getAttribute('data-citation') || '');
    span.setAttribute('data-display-text', span.getAttribute('data-display-text') || span.textContent || '(Citation)');
    span.setAttribute('data-style', citationStyle);
  });
  return preprocessRichDocumentHtml(doc.body.innerHTML);
}
