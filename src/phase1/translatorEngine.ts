import { type GlossaryTerm, findGlossaryViolations, translateSegment } from '../phase0/aiGateway';
import type { Phase1GlossaryEntry, TmMatch } from './types';

export interface SourceSegment {
  id: string;
  text: string;
}

export function splitSourceToSegments(source: string): SourceSegment[] {
  const lines = source
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length > 1) {
    return lines.map((line, idx) => ({ id: `seg-${idx + 1}`, text: line }));
  }

  return source
    .split(/(?<=[.!?\u3002\uFF01\uFF1F])\s+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, idx) => ({ id: `seg-${idx + 1}`, text: line }));
}

export function glossaryToTerms(rows: Phase1GlossaryEntry[]): GlossaryTerm[] {
  return rows
    .filter((row) => row.source.trim() && row.target.trim())
    .map((row) => ({
      source: row.source.trim(),
      target: row.target.trim(),
    }));
}

export function applyGlossaryAutoFix(sourceText: string, translatedText: string, glossary: GlossaryTerm[]): string {
  let output = translatedText;

  glossary.forEach((term) => {
    if (!sourceText.includes(term.source)) return;

    const escaped = term.source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    output = output.replace(new RegExp(escaped, 'g'), term.target);
  });

  return output;
}

export async function translateWithGlossary(input: {
  sourceText: string;
  glossary: Phase1GlossaryEntry[];
  tone: string;
  parallelMode?: boolean;
}): Promise<{
  provider: string;
  alternatives: string[];
  violationsByOption: string[][];
  comparisons: Array<{ provider: string; model: string; text: string; latencyMs: number }>;
  usage?: { sessionRequests: number; estimatedTokens: number; byProvider: Record<string, number>; byKey: Record<string, number> };
  failoverTrail: string[];
}> {
  const glossaryTerms = glossaryToTerms(input.glossary);
  const response = await translateSegment({
    sourceText: input.sourceText,
    sourceLang: 'zh-CN',
    targetLang: 'vi-VN',
    glossary: glossaryTerms,
    tone: input.tone,
    parallelProviders: input.parallelMode ? 3 : 1,
  });

  const alternatives = response.alternatives
    .slice(0, 3)
    .map((option) => applyGlossaryAutoFix(input.sourceText, option, glossaryTerms));

  const violationsByOption = alternatives.map((option) =>
    findGlossaryViolations(input.sourceText, option, glossaryTerms),
  );

  return {
    provider: response.provider,
    alternatives,
    violationsByOption,
    comparisons: response.comparisons || [],
    usage: response.usage,
    failoverTrail: response.failoverTrail || [],
  };
}

export function hashSource(text: string): string {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return `h-${(hash >>> 0).toString(16)}`;
}

function normalizeForMatch(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenDiceScore(a: string, b: string): number {
  const aa = normalizeForMatch(a).split(' ').filter(Boolean);
  const bb = normalizeForMatch(b).split(' ').filter(Boolean);

  if (!aa.length || !bb.length) return 0;

  const setA = new Set(aa);
  const setB = new Set(bb);
  let overlap = 0;

  setA.forEach((token) => {
    if (setB.has(token)) overlap += 1;
  });

  return (2 * overlap) / (setA.size + setB.size);
}

export function searchTmMatches(querySource: string, tm: Array<{ id: string; source: string; target: string }>): TmMatch[] {
  const normalizedQuery = normalizeForMatch(querySource);
  const exact: TmMatch[] = [];
  const fuzzy: TmMatch[] = [];

  tm.forEach((row) => {
    const normalizedSource = normalizeForMatch(row.source);
    if (!normalizedSource) return;

    if (normalizedSource === normalizedQuery) {
      exact.push({
        tmId: row.id,
        source: row.source,
        target: row.target,
        score: 1,
        matchType: 'exact',
      });
      return;
    }

    const score = tokenDiceScore(querySource, row.source);
    if (score >= 0.55) {
      fuzzy.push({
        tmId: row.id,
        source: row.source,
        target: row.target,
        score,
        matchType: 'fuzzy',
      });
    }
  });

  fuzzy.sort((a, b) => b.score - a.score);

  return [...exact, ...fuzzy].slice(0, 5);
}

export function buildTranslatedChapterText(
  segments: SourceSegment[],
  translations: Record<string, { text: string }>,
): string {
  return segments
    .map((seg) => translations[seg.id]?.text?.trim() || '')
    .filter(Boolean)
    .join('\n\n');
}
