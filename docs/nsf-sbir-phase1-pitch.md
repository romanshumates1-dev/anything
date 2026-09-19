# NSF SBIR Phase I Project Pitch
## DealFlow AI: Bounded Autonomous Negotiation AI for Real Estate Transactions

**Company:** DealFlow Automation ("DealFlow AI")  
**Website:** dealflowautomation.com  
**Principal Investigator:** Roman Shumate, Founder & CEO  
**Submission Date:** September 2026

---

## 1. The Technology Innovation
*(Up to 3500 characters - Current: 3,411)*

DealFlow AI proposes to develop Bounded Autonomous Negotiation AI (BANAI), a novel artificial intelligence architecture enabling constrained autonomous negotiation in high-stakes financial transactions. While conversational AI has achieved remarkable fluency, no existing system can autonomously conduct binding negotiations within dynamically-enforced human-defined parameters. This represents a fundamental unsolved problem at the intersection of large language model (LLM) reasoning, constraint satisfaction, and decision-theoretic AI.

**Core Technical Innovation**

The central innovation is a constraint-aware reasoning layer that maintains strict parameter compliance during open-ended natural language negotiation. Unlike rule-based chatbots that follow decision trees, BANAI must generate contextually appropriate negotiation strategies while provably operating within bounds (e.g., "never offer above $185,000," "require 14-day inspection period"). This requires solving three interconnected technical challenges:

(1) *Dynamic Constraint Injection and Verification*: Current LLMs lack mechanisms to guarantee output compliance with runtime-specified constraints. We propose a novel verification architecture combining structured generation with post-hoc constraint checking and rollback capabilities, ensuring no commitment violates human-defined parameters regardless of conversational context.

(2) *Calibrated Escalation Under Uncertainty*: The system must recognize scenarios exceeding its bounded authority and escalate appropriately. This requires developing uncertainty quantification methods specific to negotiation contexts—detecting adversarial tactics, ambiguous counteroffers, and edge cases where human judgment is essential. Existing confidence calibration research has not addressed multi-turn strategic dialogue.

(3) *Adversarial Robustness in High-Stakes Contexts*: Negotiation counterparties may intentionally or unintentionally probe system boundaries. Preventing prompt injection, social engineering, and constraint circumvention in financially-binding contexts represents an unsolved security challenge with no existing commercial solution.

**Differentiation from Existing Solutions**

Current real estate technology relies on CRM automation (deterministic workflows), lead scoring (classification models), or conversational AI (information retrieval). None conduct autonomous negotiation. General-purpose LLMs like GPT-4 and Claude explicitly avoid making commitments due to liability concerns. DealFlow AI's innovation is enabling bounded commitment authority—AI that can say "yes" within defined parameters while guaranteeing it cannot exceed them.

**Technical Risk Profile**

This R&D carries substantial technical risk. Constraint satisfaction in open-ended dialogue remains theoretically unproven. LLM outputs are probabilistic; achieving the deterministic guarantees required for financial transactions may require fundamental advances in structured generation or hybrid symbolic-neural architectures. Adversarial robustness against sophisticated manipulation in high-stakes contexts has no established solution. These challenges may prove intractable within current LLM paradigms.

**Market Creation Potential**

Success would create an entirely new category: autonomous transaction AI. The real estate wholesaling market ($50B+ annually) currently requires human negotiators for every transaction. BANAI would extend to adjacent markets—procurement, M&A, commercial leasing—wherever bounded autonomous negotiation provides value.

---

## 2. The Technical Objectives and Challenges
*(Up to 3500 characters - Current: 3,489)*

This Phase I research addresses fundamental questions in bounded autonomous AI systems for high-stakes economic negotiations. Our objective is to develop and validate a "Bounded Negotiation AI" framework that enables large language models to conduct real estate acquisition negotiations within human-defined constraints while maintaining conversational authenticity and regulatory compliance.

**Objective 1: Constrained Autonomy with Conversational Coherence**

The core research challenge is enabling LLM-driven negotiation within dynamic constraint boundaries without degrading dialogue naturalness. Current approaches either over-constrain (producing robotic responses) or under-constrain (risking unauthorized commitments). We will investigate hybrid architectures combining constitutional AI methods with real-time constraint satisfaction layers.

*Success criteria:* Achieve less than 2% boundary violation rate while maintaining human evaluator preference scores within 10% of unconstrained baselines across 500 simulated negotiations.

**Objective 2: Few-Shot Intent Classification for Seller Motivation**

Distinguishing motivated sellers from non-serious inquiries with minimal conversational data presents a significant classification challenge. Unlike customer service domains with abundant training data, real estate seller interactions are sparse and high-variance. We will research transfer learning approaches from adjacent negotiation domains combined with active learning strategies to maximize classification accuracy with limited labeled examples.

*Success criteria:* Achieve greater than 85% precision in motivation classification within three conversational turns, validated against ground-truth transaction outcomes.

**Objective 3: Long-Horizon Negotiation State Representation**

Real estate negotiations span days to weeks with intermittent contact, requiring coherent state tracking across temporal gaps. Standard dialogue state tracking assumes continuous sessions. We will investigate memory-augmented architectures and structured state representations that preserve negotiation context, commitments, and counterparty mental models across extended timeframes.

*Success criteria:* Demonstrate less than 5% state coherence degradation in negotiations spanning 14+ days with 10+ interaction gaps.

**Objective 4: Verifiable Compliance Guardrails**

Ensuring AI systems never violate TCPA regulations, state-specific real estate laws, or make unauthorized contractual commitments requires formally verifiable constraints rather than probabilistic filtering. We will research neuro-symbolic approaches combining LLM generation with rule-based verification layers, investigating the trade-off between constraint coverage and response latency.

*Success criteria:* Zero compliance violations across 1,000 adversarial test scenarios while maintaining sub-500ms response generation.

**Objective 5: Adversarial Robustness Against Manipulation**

Sophisticated counterparties may attempt prompt injection or social engineering to extract unauthorized concessions. This represents an underexplored attack surface for deployed negotiation AI. We will characterize the threat model specific to economic negotiations and develop detection and mitigation strategies.

*Success criteria:* Less than 1% successful manipulation rate against a red-team adversarial evaluation protocol.

**Objective 6: Calibrated Escalation Decisions**

The AI must exhibit calibrated uncertainty, recognizing situations requiring human escalation versus autonomous continuation. We will research confidence calibration methods specific to negotiation outcomes and develop escalation policies optimizing the human-AI collaboration efficiency frontier.

*Success criteria:* Achieve calibration error below 0.1 on held-out negotiations while escalating less than 15% of interactions to human operators.

---

## 3. The Market Opportunity
*(Up to 1750 characters - Current: 1,742)*

The U.S. real estate investment sector faces a critical efficiency gap that impedes housing market liquidity. Approximately 350,000 active wholesalers and fix-and-flip investors serve as essential intermediaries, identifying distressed properties and facilitating transactions that return vacant or underutilized housing to productive use. However, these operators currently spend 4-6 hours daily on manual outreach tasks, causing qualified leads to deteriorate before contact and reducing overall market velocity.

The total addressable market for real estate investor software is $4.2 billion, based on 2.8 million U.S. real estate investors with average annual software expenditures of $1,500. Our serviceable addressable market of $240 million encompasses 400,000 active wholesalers and flippers. We project capturing 5-7% market share ($12-18M) by Year 5, supported by PropTech sector growth of 17.79% CAGR through 2031.

Current solutions inadequately address this efficiency gap. Existing platforms such as PropStream ($99/month) provide data without automation. Competitors including REsimpli and BatchLeads offer AI capabilities only as premium add-ons ($89-99 additional monthly), creating fragmented toolchains costing operators $500+ monthly across disconnected systems.

DealFlow AI's integrated approach delivers autonomous lead qualification, multi-channel outreach, and 24/7 response capability within a unified platform. This innovation benefits individual investors while generating broader economic impact: accelerating distressed property turnover, reducing vacancy periods, and improving housing stock utilization. NAR's 2026 survey indicates 33% of real estate professionals already report positive AI impact, demonstrating market readiness for comprehensive automation solutions addressing problems of national housing market significance.

---

## 4. The Company and Team
*(Up to 1750 characters - Current: 1,697)*

DealFlow Automation ("DealFlow AI") is a United States-based small business developing artificial intelligence solutions for real estate transaction automation. The company has completed a functional minimum viable product, secured 847 waitlist signups, and plans commercial launch within 60 days. DealFlow AI qualifies as a small business under SBA guidelines (<500 employees) with greater than 50% ownership by U.S. citizens and permanent residents.

**Principal Investigator and Technical Leadership**

Roman Shumate, Founder and CEO, will serve as Principal Investigator. Mr. Shumate brings rare dual expertise: deep domain knowledge from personally closing over 50 wholesale real estate transactions, combined with hands-on technical capability demonstrated by independently architecting and building the company's production platform. This system employs Next.js 14, PostgreSQL on AWS infrastructure, and integrates large language models via AWS Bedrock and the Claude API. The codebase maintains 242 passing automated tests with full CI/CD pipeline integration.

Mr. Shumate will be employed full-time by DealFlow AI and commits to exceeding the required 173 hours per six-month project period. All proposed R&D activities will be conducted within the United States.

**Addressing Capability Gaps**

Post-funding, DealFlow AI will recruit a Senior Machine Learning Engineer to accelerate model development. The company has identified a real estate compliance expert for advisory board appointment and is exploring university partnership opportunities for collaborative AI research.

**Commercial Motivation**

With demonstrated market validation through waitlist traction and a functioning product, DealFlow AI possesses both the technical foundation and commercial motivation to translate proposed innovations into market-ready solutions.

---

## Appendix A: Eligibility Checklist

| Requirement | Status |
|-------------|--------|
| Small business (<500 employees) | ✓ Confirmed |
| ≥50% U.S. citizen/permanent resident ownership | ✓ Confirmed |
| All work conducted in United States | ✓ Confirmed |
| PI employed ≥20 hours/week by company | ✓ Full-time |
| PI commits to ≥173 hours per 6-month period | ✓ Confirmed |
| Not majority-owned by VC/PE/hedge funds | ✓ Confirmed |

---

## Appendix B: 7-Criteria Self-Assessment

| Criterion | Answer | Evidence |
|-----------|--------|----------|
| 1. Technological innovation | **YES** | Bounded Autonomous Negotiation AI - novel safety architecture |
| 2. Risky, unproven R&D | **YES** | Constraint satisfaction in open dialogue theoretically unproven |
| 3. Big impact on nation/economy | **YES** | $46T housing market efficiency, neighborhood stabilization |
| 4. Competitive advantage | **YES** | 18-month replication barrier, patent-pending architecture |
| 5. Commercial potential | **YES** | $4.2B TAM, 847 waitlist, no dominant competitor |
| 6. Qualified, dedicated team | **YES** | 50+ deals closed, built MVP, 242 passing tests |
| 7. Engaged project lead | **YES** | PI is 100% dedicated founder, sole technical developer |

---

## Appendix C: Key Technical Differentiators

### The Bounded Negotiation Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    HUMAN-DEFINED CONSTRAINTS                 │
│  • Max offer: $185,000    • Min inspection: 14 days         │
│  • Escalation triggers    • Compliance rules                │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    LLM GENERATION LAYER                      │
│  Generates natural negotiation prose with {OFFER} slots     │
│  NO access to actual dollar amounts during generation       │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│              DETERMINISTIC COMPUTATION LAYER                 │
│  computeNextOffer() - Pure function, bounded by constraints │
│  Injects computed values into {OFFER} slots                 │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   NUMERIC GUARD LAYER                        │
│  numericGuard() validates ALL outbound text                 │
│  Blocks any message containing unauthorized amounts         │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   COMPLIANCE GATE                            │
│  Final fail-closed check before transmission                │
│  Audit logging for all outbound commitments                 │
└─────────────────────────────────────────────────────────────┘
```

**Why This Matters for NSF:**
- This is AI SAFETY research, not product development
- The architecture is generalizable to insurance, lending, legal, healthcare
- No existing commercial or academic solution addresses this problem
- Fundamental research questions about LLM constraint satisfaction

---

## Appendix D: Research Publications Pathway

Phase I research will produce peer-reviewable findings in:

1. **AI Safety:** "Bounded Commitment Authority in LLM-Based Negotiation Agents"
2. **HCI:** "Human Trust Calibration in AI Financial Negotiators"
3. **NLP:** "Constraint-Preserving Generation in Multi-Turn Strategic Dialogue"
4. **Behavioral Economics:** "Automated Detection of Seller Motivation Signals"

---

## Contact Information

**Company:** DealFlow Automation  
**Website:** dealflowautomation.com  
**Principal Investigator:** Roman Shumate  
**Email:** romanshumate@gmail.com

---

*This document is formatted for submission to NSF SBIR Phase I via seedfund.nsf.gov*
