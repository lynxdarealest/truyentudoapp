import { emitLocalWorkspaceChanged } from './localWorkspaceSync';

export type AiProvider = 'openai' | 'anthropic' | 'gemini' | 'custom';

export interface BudgetState {
  monthlyBudgetUsd: number;
  currentSpendUsd: number;
  billingCycleStart: string;
  billingCycleEnd: string;
  isExhausted: boolean;
  lastCalculatedAt: string;
  lastChargeUsd: number;
  lastChargeAt: string;
  lastChargeNote?: string;
}

const STORAGE_KEY = 'finops_budget_state_v1';

type PricingRow = {
  provider: AiProvider;
  modelPrefix: string;
  inputPricePer1M: number;
  outputPricePer1M: number;
};

// Simplified pricing table (USD per 1M tokens). These are adjustable by ops later.
const PRICING: PricingRow[] = [
  { provider: 'openai', modelPrefix: 'gpt-4.1', inputPricePer1M: 5.0, outputPricePer1M: 15.0 },
  { provider: 'openai', modelPrefix: 'gpt-4o', inputPricePer1M: 2.5, outputPricePer1M: 10.0 },
  { provider: 'openai', modelPrefix: 'gpt-4o-mini', inputPricePer1M: 0.15, outputPricePer1M: 0.6 },
  { provider: 'anthropic', modelPrefix: 'claude-3-5', inputPricePer1M: 3.0, outputPricePer1M: 15.0 },
  { provider: 'anthropic', modelPrefix: 'claude-3-5-haiku', inputPricePer1M: 0.8, outputPricePer1M: 4.0 },
  { provider: 'gemini', modelPrefix: 'gemini-2.5-pro', inputPricePer1M: 1.25, outputPricePer1M: 5.0 },
  { provider: 'gemini', modelPrefix: 'gemini-2.5-flash', inputPricePer1M: 0.15, outputPricePer1M: 0.45 },
  { provider: 'gemini', modelPrefix: 'gemini-2.0-flash', inputPricePer1M: 0.10, outputPricePer1M: 0.30 },
];

function nowIso(): string {
  return new Date().toISOString();
}

export function loadBudgetState(): BudgetState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return {
        monthlyBudgetUsd: 20,
        currentSpendUsd: 0,
        billingCycleStart: nowIso(),
        billingCycleEnd: new Date(Date.now() + 28 * 24 * 3600 * 1000).toISOString(),
        isExhausted: false,
        lastCalculatedAt: nowIso(),
        lastChargeUsd: 0,
        lastChargeAt: '',
        lastChargeNote: '',
      };
    }
    const parsed = JSON.parse(raw) as Partial<BudgetState>;
    const start = parsed.billingCycleStart || nowIso();
    const end = parsed.billingCycleEnd || new Date(Date.now() + 28 * 24 * 3600 * 1000).toISOString();
    const today = Date.now();
    // Reset spend if cycle ended
    if (new Date(end).getTime() < today) {
      return {
        monthlyBudgetUsd: parsed.monthlyBudgetUsd ?? 20,
        currentSpendUsd: 0,
        billingCycleStart: nowIso(),
        billingCycleEnd: new Date(Date.now() + 28 * 24 * 3600 * 1000).toISOString(),
        isExhausted: false,
        lastCalculatedAt: nowIso(),
        lastChargeUsd: 0,
        lastChargeAt: '',
        lastChargeNote: '',
      };
    }
    return {
      monthlyBudgetUsd: parsed.monthlyBudgetUsd ?? 20,
      currentSpendUsd: parsed.currentSpendUsd ?? 0,
      billingCycleStart: start,
      billingCycleEnd: end,
      isExhausted: Boolean(parsed.isExhausted) || (parsed.currentSpendUsd ?? 0) >= (parsed.monthlyBudgetUsd ?? 20),
      lastCalculatedAt: parsed.lastCalculatedAt || nowIso(),
      lastChargeUsd: parsed.lastChargeUsd ?? 0,
      lastChargeAt: parsed.lastChargeAt || '',
      lastChargeNote: parsed.lastChargeNote || '',
    };
  } catch {
    return {
      monthlyBudgetUsd: 20,
      currentSpendUsd: 0,
      billingCycleStart: nowIso(),
      billingCycleEnd: new Date(Date.now() + 28 * 24 * 3600 * 1000).toISOString(),
      isExhausted: false,
      lastCalculatedAt: nowIso(),
      lastChargeUsd: 0,
      lastChargeAt: '',
      lastChargeNote: '',
    };
  }
}

export function saveBudgetState(state: BudgetState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  emitLocalWorkspaceChanged('finops_budget');
}

function pickPricing(provider: AiProvider, model: string): PricingRow {
  const found = PRICING.find((row) => row.provider === provider && model.startsWith(row.modelPrefix));
  if (found) return found;
  // Default cheap tier if unknown
  return { provider, modelPrefix: 'default', inputPricePer1M: 0.2, outputPricePer1M: 0.6 };
}

export function estimateCostUsd(provider: AiProvider, model: string, promptChars: number, outputChars = 400): number {
  const tokensIn = Math.max(1, Math.round(promptChars / 4));
  const tokensOut = Math.max(1, Math.round(outputChars / 4));
  const pricing = pickPricing(provider, model);
  const cost =
    (tokensIn / 1_000_000) * pricing.inputPricePer1M +
    (tokensOut / 1_000_000) * pricing.outputPricePer1M;
  return Number(cost.toFixed(6));
}

export function chargeBudget(costUsd: number, note?: string): BudgetState {
  const state = loadBudgetState();
  const nextSpend = state.currentSpendUsd + costUsd;
  const updated: BudgetState = {
    ...state,
    currentSpendUsd: nextSpend,
    isExhausted: nextSpend >= state.monthlyBudgetUsd,
    lastCalculatedAt: nowIso(),
    lastChargeUsd: costUsd,
    lastChargeAt: nowIso(),
    lastChargeNote: note,
  };
  saveBudgetState(updated);
  return updated;
}

export function canSpend(costUsd: number): { allowed: boolean; remaining: number; state: BudgetState } {
  const state = loadBudgetState();
  const remaining = Math.max(0, state.monthlyBudgetUsd - state.currentSpendUsd);
  return {
    allowed: costUsd <= remaining,
    remaining,
    state,
  };
}
