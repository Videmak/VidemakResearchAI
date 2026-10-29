/**
 * Defensive cleanup for generated academic content before visual renderers see it.
 *
 * LLM output can pass through JSON/string layers that turn LaTeX commands such as
 * \frac and \times into control characters. Mermaid also rejects some otherwise
 * reasonable labels unless they are quoted.
 */

const htmlEntityMap: Record<string, string> = {
  '&amp;': '&',
  '&quot;': '"',
  '&#39;': "'",
  '&#039;': "'",
  '&lt;': '<',
  '&gt;': '>',
  '&#10;': '\n',
  '&#x0a;': '\n',
  '&#x0A;': '\n',
};

export function decodeBasicHtmlEntities(value: string): string {
  return value.replace(
    /&(amp|quot|lt|gt);|&#(?:0?39|10);|&#x0a;/gi,
    (entity) => htmlEntityMap[entity] ?? htmlEntityMap[entity.toLowerCase()] ?? entity,
  );
}

export function normalizeLatexSource(value: string): string {
  if (!value) return '';

  return value
    .replace(/&#12;|&#x0c;|&#x0C;/g, '\f')
    .replace(/\u000c\s*rac/g, '\\frac')
    .replace(/\u0009\s*imes/g, '\\times')
    .replace(/\u0009\s*ext/g, '\\text')
    .replace(/\u0009\s*heta/g, '\\theta')
    .replace(/\u0009\s*au/g, '\\tau')
    .replace(/\u0008\s*eta/g, '\\beta')
    .replace(/\u0008\s*ig/g, '\\big')
    .replace(/\u000d\s*ho/g, '\\rho')
    .replace(/\u000b\s*ert/g, '\\vert')
    .replace(/(^|[\s=({[+\-*/])rac\{/g, '$1\\frac{')
    .replace(/(^|[\s{([])imes(?=([\s\d({[]|$))/g, '$1\\times');
}

export function normalizeLatexInText(value: string): string {
  if (!value) return '';

  const normalized = normalizeLatexSource(value);

  return normalized.replace(
    /(\$\$[\s\S]*?\$\$|\\{1,2}\[[\s\S]*?\\{1,2}\]|(?<!\$)\$[^$\n]+?\$(?!\$)|\\{1,2}\([^)]*?\\{1,2}\))/g,
    (match) => normalizeLatexSource(match),
  );
}

function quoteMermaidLabel(label: string): string {
  const decoded = decodeBasicHtmlEntities(label)
    .replace(/\\n/g, '<br/>')
    .replace(/\r?\n/g, '<br/>')
    .trim();

  if (
    (decoded.startsWith('"') && decoded.endsWith('"')) ||
    (decoded.startsWith("'") && decoded.endsWith("'")) ||
    decoded.startsWith('`')
  ) {
    return decoded;
  }

  return `"${decoded.replace(/"/g, '\\"')}"`;
}

/**
 * Mermaid lays unrelated nodes inside a subgraph on one very wide row. Large
 * conceptual frameworks can therefore render several thousand pixels wide,
 * leaving the editor viewport on what looks like an empty slice of the SVG.
 * Invisible links constrain only layout; they do not add visible relationships.
 */
export function compactMermaidSubgraphs(value: string): string {
  if (!value || !/^(?:graph|flowchart)\s+/im.test(value) || !/^\s*subgraph\b/im.test(value)) {
    return value;
  }

  const lines = value.split('\n');
  const output: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!/^\s*subgraph\b/i.test(line)) {
      output.push(line);
      continue;
    }

    let depth = 1;
    let endIndex = index + 1;
    for (; endIndex < lines.length; endIndex += 1) {
      if (/^\s*subgraph\b/i.test(lines[endIndex])) depth += 1;
      if (/^\s*end\s*$/i.test(lines[endIndex])) depth -= 1;
      if (depth === 0) break;
    }
    if (depth !== 0) {
      output.push(line);
      continue;
    }

    const body = lines.slice(index + 1, endIndex);
    const hasNestedSubgraph = body.some((item) => /^\s*subgraph\b/i.test(item));
    const hasLayoutLink = body.some((item) => /~~~/.test(item));
    const nodeIds = body
      .map((item) => item.match(/^\s*([A-Za-z][\w-]*)\s*(?:\[|\(|\{)/)?.[1] || '')
      .filter(Boolean);

    output.push(line);
    if (!hasNestedSubgraph && !hasLayoutLink && nodeIds.length >= 3) {
      const indent = line.match(/^\s*/)?.[0] || '';
      if (!body.some((item) => /^\s*direction\s+/i.test(item))) {
        output.push(`${indent}    direction TB`);
      }
      output.push(...body);
      output.push(`${indent}    ${nodeIds.join(' ~~~ ')}`);
    } else {
      output.push(...body);
    }
    output.push(lines[endIndex]);
    index = endIndex;
  }

  return output.join('\n');
}

export function normalizeMermaidSource(value: string): string {
  if (!value) return '';

  let code = decodeBasicHtmlEntities(value)
    .replace(/\r\n?/g, '\n')
    .replace(/\\n/g, '<br/>');

  code = code.replace(
    /(^|[\s;])([A-Za-z][\w-]*)\[([^\]\n]+)\]/g,
    (match, prefix: string, nodeId: string, label: string) => {
      if (/^\s*subgraph\b/i.test(match)) return match;
      return `${prefix}${nodeId}[${quoteMermaidLabel(label)}]`;
    },
  );

  code = code.replace(
    /(^|[\s;])([A-Za-z][\w-]*)\(([^()\n]+)\)/g,
    (match, prefix: string, nodeId: string, label: string) => {
      // Mermaid shape syntax such as A(["Outcome"]) and A{"Context"}
      // is already valid. Quoting the nested brackets turns the shape into
      // invalid text (A("[\"Outcome\"]")), which the parser rejects.
      if (/^\s*[\[{]/.test(label) || /^\s*["'`]/.test(label)) return match;
      if (!/[<>()/,\[\]{}:;]|\s{2,}/.test(label) && !label.includes('<br/>')) return match;
      return `${prefix}${nodeId}(${quoteMermaidLabel(label)})`;
    },
  );

  return compactMermaidSubgraphs(code.trim());
}

/** Store Mermaid source without literal newlines or quote entities in HTML attributes. */
export function encodeMermaidDataAttribute(value: string): string {
  return `uri:${encodeURIComponent(normalizeMermaidSource(value).trim())}`;
}

/** Decode both the URI-safe format and legacy entity/newline attributes. */
export function decodeMermaidDataAttribute(value: string): string {
  if (!value) return '';
  if (value.startsWith('uri:')) {
    try {
      return normalizeMermaidSource(decodeURIComponent(value.slice(4)));
    } catch {
      return normalizeMermaidSource(value.slice(4));
    }
  }
  return normalizeMermaidSource(decodeBasicHtmlEntities(value).replace(/&#10;/gi, '\n'));
}

export function stripMermaidErrorArtifacts(html: string): string {
  if (!html || !/Syntax error in text|mermaid version/i.test(html)) return html;

  return html
    .replace(/<svg\b[^>]*>[\s\S]*?(?:Syntax error in text|mermaid version)[\s\S]*?<\/svg>/gi, '')
    .replace(/<div\b[^>]*class="[^"]*mermaid[^"]*"[^>]*>[\s\S]*?(?:Syntax error in text|mermaid version)[\s\S]*?<\/div>/gi, '')
    .replace(/(?:Syntax error in text\s*)?(?:mermaid version\s*[\w.-]+\s*)+/gi, '')
    .replace(/(?:<p>\s*<\/p>\s*){2,}/gi, '');
}

/**
 * Detect an actual Mermaid grammar header, not ordinary prose such as
 * "Timeline: the study will run for 12 months" or "Graph theory...".
 */
export function isMermaidDiagramSource(value: string): boolean {
  const firstLine = normalizeMermaidSource(value)
    .trim()
    .split(/\r?\n/, 1)[0]
    .trim();

  if (/^(?:graph|flowchart)\s+(?:TB|TD|BT|RL|LR)(?:\s|$)/i.test(firstLine)) return true;
  if (/^pie(?:\s+(?:showData|title\b.*))?$/i.test(firstLine)) return true;

  return /^(?:sequenceDiagram|classDiagram(?:-v2)?|stateDiagram(?:-v2)?|erDiagram|journey|gantt|mindmap|timeline|xychart-beta)$/i.test(firstLine);
}
