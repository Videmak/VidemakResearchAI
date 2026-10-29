/**
 * Type declarations for citeproc-js
 */

declare module 'citeproc' {
  export interface SystemObject {
    retrieveLocale: (lang: string) => string | null;
    retrieveItem: (id: string) => any;
    variableWrapper?: (params: any, prePunct: string, str: string, postPunct: string) => string;
    embedBibliographyEntry?: (str: string) => string;
    getAbbreviation?: (styleID: string, abbrev: any, name: string, type: string, subtype: string) => void;
  }

  export interface BibliographyResult {
    0: {
      maxoffset: number;
      entryspacing: number;
      linespacing: number;
      hangingindent: number;
      second_field_align: boolean;
      bibstart: string;
      bibend: string;
      bibliography_errors: string[];
    };
    1: string[];
  }

  export interface CitationResult {
    bibchange: boolean;
    citation_errors: string[];
  }

  export default class CSL {
    constructor(sys: SystemObject, style: string, lang?: string, forceLang?: boolean);
    
    updateItems(idList: string[]): void;
    updateUncitedItems(idList: string[]): void;
    
    makeBibliography(): BibliographyResult | false;
    makeCitationCluster(items: { id: string; locator?: string; label?: string }[]): string;
    
    processCitationCluster(
      citation: any,
      citationsPre: [string, number][],
      citationsPost: [string, number][]
    ): [CitationResult, [number, string][]];
    
    previewCitationCluster(
      citation: any,
      citationsPre: [string, number][],
      citationsPost: [string, number][],
      format: string
    ): string;
    
    restoreProcessorState(citations?: any[]): [number, string, string][];
    
    setOutputFormat(format: string): void;
    
    static getAbbreviation(
      styleEngine: CSL,
      abbrevs: any,
      name: string,
      type: string,
      subtype: string
    ): void;
    
    static LOCALES: Record<string, string>;
    static STYLES: Record<string, string>;
  }
}

