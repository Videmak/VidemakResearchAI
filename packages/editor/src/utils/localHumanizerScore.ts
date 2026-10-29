"use client";

export interface LocalAIScoreResult {
  score: number;
  reasons: string[];
  severity: "low" | "medium" | "high";
}

const AI_VOCAB = [
  "leverage",
  "robust",
  "seamless",
  "pivotal",
  "furthermore",
  "moreover",
  "landscape",
  "showcasing",
  "testament",
  "underscores",
  "delve",
  "groundbreaking",
  "realm",
  "fosters",
  "vibrant",
  "transformative",
];

const FILLER_PHRASES = [
  "in today's rapidly evolving",
  "it is worth noting",
  "in conclusion",
  "the future looks bright",
  "let me know if",
  "i hope this helps",
  "without leaving",
  "underscoring its importance",
  "highlighting the need",
  "could potentially",
  "despite challenges",
  "marks a pivotal moment",
  "represents a paradigm shift",
];

const COPULA_AVOIDANCE = [
  "serves as",
  "stands as",
  "boasts",
  "features",
  "functions as",
];

const PROMO_PHRASES = [
  "cutting-edge",
  "state-of-the-art",
  "powerful experiences",
  "unlocking creativity",
  "drives innovation",
  "best practices",
  "maximize roi",
];

const countPhraseHits = (text: string, phrases: string[]) =>
  phrases.reduce((count, phrase) => count + (text.includes(phrase) ? 1 : 0), 0);

const countRegexHits = (text: string, regex: RegExp) => {
  const matches = text.match(regex);
  return matches ? matches.length : 0;
};

export const scoreTextForAI = (rawText: string): LocalAIScoreResult => {
  const text = rawText.toLowerCase().replace(/\s+/g, " ").trim();
  if (!text) {
    return { score: 0, reasons: [], severity: "low" };
  }

  const reasons: string[] = [];
  let score = 0;

  const aiVocabHits = countPhraseHits(text, AI_VOCAB);
  if (aiVocabHits > 0) {
    score += Math.min(28, aiVocabHits * 7);
    reasons.push("AI vocabulary");
  }

  const fillerHits = countPhraseHits(text, FILLER_PHRASES);
  if (fillerHits > 0) {
    score += Math.min(24, fillerHits * 8);
    reasons.push("Filler phrases");
  }

  const copulaHits = countPhraseHits(text, COPULA_AVOIDANCE);
  if (copulaHits > 0) {
    score += Math.min(18, copulaHits * 6);
    reasons.push("Copula avoidance");
  }

  const promoHits = countPhraseHits(text, PROMO_PHRASES);
  if (promoHits > 0) {
    score += Math.min(16, promoHits * 6);
    reasons.push("Promotional language");
  }

  const emDashHits = countRegexHits(rawText, /—/g);
  if (emDashHits > 0) {
    score += Math.min(12, emDashHits * 4);
    reasons.push("Em dash overuse");
  }

  const exclamationHits = countRegexHits(rawText, /!/g);
  if (exclamationHits > 0) {
    score += Math.min(6, exclamationHits * 2);
    reasons.push("Overexcited punctuation");
  }

  if (/it's not just .+?, it's /i.test(rawText)) {
    score += 10;
    reasons.push("Negative parallelism");
  }

  if (/(, [a-z][^,]{2,}){2,},? and /i.test(rawText)) {
    score += 8;
    reasons.push("Rule of three phrasing");
  }

  if (/great question|absolutely right|exciting times/i.test(rawText)) {
    score += 10;
    reasons.push("Chatty assistant tone");
  }

  const boundedScore = Math.max(0, Math.min(100, score));
  const severity =
    boundedScore >= 60 ? "high" : boundedScore >= 35 ? "medium" : "low";

  return {
    score: boundedScore,
    reasons: reasons.slice(0, 4),
    severity,
  };
};
