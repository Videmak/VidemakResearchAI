import { describe, expect, it } from 'vitest';
import { parseBibtex, parseIds, parseRis } from '../src/lib/referenceFiles.js';

describe('reference files', () => {
  it('reads BibTeX entries with braces, quotes, accents and skips @string', () => {
    const items = parseBibtex(`@string{nrn = "Nature Reviews Neuroscience"}
@article{rasch2013,
  title = {About Sleep's Role in {Memory}},
  author = {Rasch, Bj{\\"o}rn and Born, Jan},
  journal = "Physiological Reviews", year = 2013,
  doi = {https://doi.org/10.1152/physrev.00032.2012},
}
@book{walker, title={Why We Sleep}, author={Matthew Walker}, year={2017}}`);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ title: "About Sleep's Role in Memory", authors: ['Bjorn Rasch', 'Jan Born'], year: '2013', doi: '10.1152/physrev.00032.2012', journal: 'Physiological Reviews', key: 'rasch2013' });
    expect(items[0].bibtex).toMatch(/^@article\{rasch2013/);
    expect(items[1]).toMatchObject({ title: 'Why We Sleep', authors: ['Matthew Walker'], year: '2017', doi: null });
  });

  it('reads RIS records', () => {
    const items = parseRis(`TY  - JOUR\nTI  - The memory function of sleep\nAU  - Diekelmann, Susanne\nAU  - Born, Jan\nPY  - 2010\nJO  - Nat Rev Neurosci\nDO  - 10.1038/nrn2762\nER  - \nTY  - BOOK\nT1  - Second\nER  - `);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ title: 'The memory function of sleep', authors: ['Susanne Diekelmann', 'Jan Born'], year: '2010', doi: '10.1038/nrn2762' });
  });

  it('finds DOIs, PubMed ids and arXiv ids once each', () => {
    expect(parseIds('10.1038/nrn2762, https://doi.org/10.1038/NRN2762\nPMID: 23589831 2301.00001v2 https://arxiv.org/abs/1706.03762 hello')).toEqual([
      { kind: 'doi', value: '10.1038/nrn2762' },
      { kind: 'pmid', value: '23589831' },
      { kind: 'arxiv', value: '2301.00001' },
      { kind: 'arxiv', value: '1706.03762' },
    ]);
  });
});
