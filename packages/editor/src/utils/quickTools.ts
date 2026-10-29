export type QuickTool = { id: string; label: string; count?: number; open: () => void };
export function useQuickTools(): QuickTool[] {
  return [];
}
