/**
 * Type declarations for Citation.js packages
 * @see https://citation.js.org/
 */

declare module '@citation-js/core' {
  export class Cite {
    constructor(data?: any, options?: any);
    
    static async(data: any, options?: any): Promise<Cite>;
    
    format(type: string, options?: {
      format?: 'html' | 'text' | 'rtf';
      template?: string;
      lang?: string;
      entry?: string | string[];
      prepend?: (entry: any) => string;
      append?: (entry: any) => string;
    }): string;
    
    get(options?: any): any[];
    
    set(data: any, options?: any): Cite;
    
    add(data: any, options?: any): Cite;
    
    reset(): Cite;
    
    sort(): Cite;
    
    options(options: any): Cite;
    
    data: any[];
    
    static plugins: {
      input: any;
      output: any;
      dict: any;
      config: {
        get: (plugin: string) => {
          templates: {
            add: (name: string, template: string) => void;
            get: (name: string) => string;
            has: (name: string) => boolean;
            remove: (name: string) => void;
          };
          locales: {
            add: (name: string, locale: string) => void;
            get: (name: string) => string;
            has: (name: string) => boolean;
            remove: (name: string) => void;
          };
        };
      };
    };
  }
  
  export function plugins(plugins: any[]): void;
}

declare module '@citation-js/plugin-csl' {
  // CSL plugin - loaded for side effects
  // Adds 'bibliography' and 'citation' output formats
  // Adds CSL-JSON input format
}

declare module '@citation-js/plugin-bibtex' {
  // BibTeX plugin - loaded for side effects
  // Adds BibTeX and BibLaTeX input/output formats
}

declare module '@citation-js/plugin-doi' {
  // DOI plugin - loaded for side effects
  // Adds DOI resolution capability
}
