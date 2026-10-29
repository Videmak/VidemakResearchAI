import DOMPurify from 'isomorphic-dompurify';

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  }
});

const PURIFY_CONFIG = {
  ADD_ATTR: ['target', 'rel', 'class', 'id', 'data-source', 'data-ref', 'data-cite', 'data-mermaid', 'data-display-mode', 'title', 'aria-label', 'style', 'contenteditable', 'suppresscontenteditablewarning'],
  ADD_TAGS: ['sup', 'sub'],
  ALLOW_DATA_ATTR: true,
};

export function sanitize(dirty: string): string {
  return DOMPurify.sanitize(dirty, PURIFY_CONFIG);
}

export default sanitize;
