'use client';

import { Info } from 'lucide-react';
import { buildPlainContractSummary, PlainContractInput } from '@/app/api/utils/plainContractSummary';

interface ContractPlainSummaryProps {
  /** The raw contract row from /api/contracts (see ContractsPage's ContractData). */
  contract: {
    direction?: string | null;
    status?: string | null;
    esign_status?: string | null;
    contract_price_cents?: number | null;
    assignment_fee_cents?: number | null;
    metadata?: { closingDate?: string; closing_date?: string; property_address?: string } | null;
  };
}

/** Maps the raw contract row onto the summary builder's input shape. */
function toPlainInput(c: ContractPlainSummaryProps['contract']): PlainContractInput {
  const closingDate = c.metadata?.closingDate || c.metadata?.closing_date || null;
  return {
    direction: c.direction ?? null,
    status: c.status ?? c.esign_status ?? null,
    esignStatus: c.esign_status ?? null,
    contractPriceCents: c.contract_price_cents ?? null,
    assignmentFeeCents: c.assignment_fee_cents ?? null,
    closingDate,
    propertyAddress: c.metadata?.property_address ?? null,
  };
}

/**
 * Plain-language contract summary.
 *
 * WHY: sellers/buyers don't read status chips or cents. They need to know, in
 * one glance, "what is this deal and why is it good for me?". This renders that
 * summary from the SAME fields the rest of the card uses, so the explanation
 * can never disagree with the numbers on screen (anti-fabrication is enforced
 * in buildPlainContractSummary and its tests).
 *
 * Placed prominently near the top of each contract card.
 */
export default function ContractPlainSummary({ contract }: ContractPlainSummaryProps) {
  const summary = buildPlainContractSummary(toPlainInput(contract));

  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-tertiary)]/40 p-4">
      <div className="flex items-start gap-3">
        <Info className="h-5 w-5 mt-0.5 text-[var(--accent-blue)] flex-none" aria-hidden="true" />
        <div className="space-y-3">
          <h3 className="text-base font-semibold text-[var(--text-primary)]">
            {summary.headline}
          </h3>
          <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
            {summary.what}
          </p>

          {summary.whyGoodForYou.length > 0 && (
            <ul className="list-none space-y-1.5 pl-0">
              {summary.whyGoodForYou.map((b, i) => (
                <li key={`why-${i}`} className="flex items-start gap-2">
                  <span className="text-[var(--color-success)] mt-0.5" aria-hidden="true">✓</span>
                  <span className="text-sm text-[var(--text-secondary)]">{b}</span>
                </li>
              ))}
            </ul>
          )}

          <ul className="list-none space-y-1.5 pl-0">
            {summary.nextSteps.map((s, i) => (
              <li key={`next-${i}`} className="flex items-start gap-2">
                <span className="text-[var(--accent-blue)] mt-0.5" aria-hidden="true">→</span>
                <span className="text-sm font-medium text-[var(--text-primary)]">{s}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
