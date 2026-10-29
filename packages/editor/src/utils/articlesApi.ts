import { postDurableJson } from './jobsApi';

export interface PaperImportRequest {
  url?: string;
  pdf_url?: string;
  title?: string;
  authors?: string[];
  doi?: string;
  year?: number;
  source?: string;
  abstract?: string;
  scholar_id?: string;
  folder_id?: string;
  [key: string]: unknown;
}

export interface PaperImportResponse {
  success: boolean;
  document_id: string | null;
  message: string;
  processing_status: string | null;
  reason_code?: string | null;
  upgrade_url?: string | null;
}

/** Saves a paper (metadata, and its open-access PDF when there is one) to the Library. */
export async function importPaper(paper: PaperImportRequest): Promise<PaperImportResponse> {
  return postDurableJson<PaperImportResponse>('/api/library/papers/import', paper);
}
