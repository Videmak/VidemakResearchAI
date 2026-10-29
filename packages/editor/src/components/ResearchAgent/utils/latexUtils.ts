/**
 * LaTeX Utility Functions
 * 
 * Helper functions for processing LaTeX content in the editor.
 * Used for converting existing content to use proper math nodes.
 */

import katex from 'katex';
import { hasDelimitedMath, transformLatexInHtml } from './mathDelimiters';
import { normalizeLatexSource, normalizeLatexInText } from './renderingSanitizers';

/**
 * Convert raw LaTeX syntax to HTML with rendered KaTeX
 * This is for displaying content that hasn't been processed by the editor
 */
export function renderLatexInHtml(html: string): string {
  if (!html) return '';
  
  let processed = normalizeLatexInText(html);
  
  // First, render any data-latex attributes (from editor math nodes)
  processed = processed.replace(
    /<(?:div|span)[^>]*data-latex="([^"]*)"[^>]*>[\s\S]*?<\/(?:div|span)>/gi,
    (match, encodedLatex) => {
      // Decode HTML entities
      const latex = normalizeLatexSource(encodedLatex
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>'));
      
      const isBlock = match.startsWith('<div') || /data-display-mode="true"/.test(match);
      try {
        const rendered = katex.renderToString(latex.trim(), {
          throwOnError: false,
          displayMode: isBlock,
        });
        return isBlock 
          ? `<div class="math-block-rendered" data-tex-source="${encodeURIComponent(latex)}" style="text-align: center; margin: 1.5rem 0; padding: 1rem; background: #f8fafc; border-radius: 8px; overflow-x: auto;">${rendered}</div>`
          : `<span class="math-inline-rendered" data-tex-source="${encodeURIComponent(latex)}">${rendered}</span>`;
      } catch (e) {
        return isBlock
          ? `<div class="math-block-error" style="color: red;">[Math Error: ${latex}]</div>`
          : `<span class="math-inline-error" style="color: red;">[${latex}]</span>`;
      }
    }
  );
  
  processed = transformLatexInHtml(processed, (latex, displayMode) => {
    const rendered = katex.renderToString(latex, { throwOnError: false, displayMode });
    return displayMode
      ? `<div class="math-block-rendered" data-tex-source="${encodeURIComponent(latex)}" style="text-align: center; margin: 1.5rem 0; overflow-x: auto;">${rendered}</div>`
      : `<span class="math-inline-rendered" data-tex-source="${encodeURIComponent(latex)}">${rendered}</span>`;
  });

  return processed;
}

/**
 * Check if a string contains LaTeX math syntax
 */
export function containsLatex(text: string): boolean {
  return Boolean(text && (hasDelimitedMath(text) || /data-latex=|data-type="(?:inline|block)-math"/.test(text)));
}

/**
 * Extract all LaTeX expressions from text
 */
export function extractLatexExpressions(text: string): { type: 'block' | 'inline'; latex: string }[] {
  if (!text) return [];
  const expressions: { type: 'block' | 'inline'; latex: string }[] = [];
  transformLatexInHtml(text, (latex, display, raw) => {
    expressions.push({ type: display ? 'block' : 'inline', latex });
    return raw;
  });

  return expressions;
}

/**
 * Preview a LaTeX expression
 */
export function previewLatex(latex: string, displayMode: boolean = false): string {
  try {
    return katex.renderToString(normalizeLatexSource(latex), {
      throwOnError: false,
      displayMode,
    });
  } catch (e) {
    return `<span style="color: red;">Error: ${(e as Error).message}</span>`;
  }
}

export default {
  renderLatexInHtml,
  containsLatex,
  extractLatexExpressions,
  previewLatex,
};
