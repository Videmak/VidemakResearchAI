import { createLlmSlot } from './llm.js';
import { createPapersSlot } from './papers.js';
import type { LlmSlot, PapersSlot, Slots } from './types.js';
import { settings, settingsVersion } from '../lib/settings.js';

/**
 * The service slots, rebuilt whenever an admin changes a provider or key (no restart).
 * Never throws: an unconfigured slot fails per call with a clear message.
 */
export function createSlots(): Slots {
  let builtAt = -1;
  let llm: LlmSlot;
  let papers: PapersSlot;
  const current = () => {
    if (builtAt !== settingsVersion()) {
      const effective = settings();
      llm = createLlmSlot({ settings: effective });
      papers = createPapersSlot({ settings: effective });
      builtAt = settingsVersion();
    }
  };
  return {
    get llm() { current(); return llm; },
    get papers() { current(); return papers; },
  };
}
