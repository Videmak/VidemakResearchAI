/** The humanizer is not part of this build, so access is always off (with safe limits). */
const OFF = { enabled: false, wordsLimit: 0, usesLeft: 0, unlimited: false };

export function useAIToolsAccess() {
  return { canUseHumanizer: false, humanizer: OFF, isLoading: false };
}
