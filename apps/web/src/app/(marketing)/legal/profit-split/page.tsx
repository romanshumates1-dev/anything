import type { Metadata } from "next";
import Link from "next/link";

import { PROFIT_SPLIT_POLICIES, type ProfitSplitPolicyId } from "@/config/billing-math";

export const metadata: Metadata = {
  title: "Profit-Split Policy",
  description:
    "DealFlow AI deal profit-split policy (25/75, 50/50, 90/10) — a policy incorporated by reference into the Terms of Service.",
};

// {/* TEMPLATE — requires attorney review before launch */}
// The split percentages render from src/config/billing-math.ts so the policy
// text and the arithmetic can never drift apart.

const LEGAL_ENTITY_NAME = process.env.LEGAL_ENTITY_NAME || "[LEGAL_ENTITY_NAME]";
const LEGAL_ENTITY_STATE = process.env.LEGAL_ENTITY_STATE || "[LEGAL_ENTITY_STATE]";
const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || "[SUPPORT_EMAIL]";

const ORDER: ProfitSplitPolicyId[] = ["25_75", "50_50", "90_10"];

export default function ProfitSplitPolicyPage() {
  return (
    <div className="py-16">
      <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8 prose prose-slate">
        <div className="not-prose mb-6 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <strong>Template — requires attorney review before launch.</strong> This policy uses
          placeholder entity details ({LEGAL_ENTITY_NAME}, {LEGAL_ENTITY_STATE}) and must be reviewed
          by counsel in each jurisdiction before it is relied upon.
        </div>

        <h1>Deal Profit-Split Policy</h1>
        <p className="text-sm text-gray-500">
          Incorporated by reference into the{" "}
          <Link href="/legal/terms">Terms of Service</Link>. Version 1.0.
        </p>

        <h2>1. Purpose</h2>
        <p>
          This Policy describes the optional profit-split arrangements available on the DealFlow AI
          platform, operated by {LEGAL_ENTITY_NAME}, a company organized under the laws of{" "}
          {LEGAL_ENTITY_STATE} (the &ldquo;Company&rdquo;). It exists to make the commercial terms of
          any revenue- or profit-sharing between the Company and a user (&ldquo;Partner&rdquo;)
          transparent and to serve as the referenced policy for the related disclaimers in the Terms.
          Nothing in this Policy is legal, financial, or real-estate advice.
        </p>

        <h2>2. Available split tiers</h2>
        <p>
          Where a deal is closed through the platform under an agreed split, the gross profit on that
          deal is divided between the Company and the Partner according to one of the following
          tiers, as recorded for that engagement:
        </p>
        <table>
          <thead>
            <tr>
              <th>Tier</th>
              <th>Company share</th>
              <th>Partner share</th>
            </tr>
          </thead>
          <tbody>
            {ORDER.map((id) => {
              const p = PROFIT_SPLIT_POLICIES[id];
              const company = p.companyBps / 100;
              return (
                <tr key={id}>
                  <td>{id.replace("_", " / ")}</td>
                  <td>{company}%</td>
                  <td>{100 - company}%</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <h2>3. How the split is calculated</h2>
        <p>
          Splits are computed on gross profit in whole cents. When a division does not resolve to a
          whole cent, the remaining cent is allocated to the Company. The applicable tier for any
          engagement is the tier recorded at the time the engagement is agreed; it does not change
          retroactively.
        </p>

        <h2>4. No guarantee of results</h2>
        <p>
          Participation in a split does not guarantee that any deal will close or that any profit will
          result. Wholesaling and assignment activity is regulated differently in each state, and the
          Partner is solely responsible for compliance with the laws applicable to their transactions.
          Results are not typical and depend on factors outside the Company&rsquo;s control.
        </p>

        <h2>5. Contact</h2>
        <p>
          Questions about this Policy may be directed to{" "}
          <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
        </p>
      </div>
    </div>
  );
}
