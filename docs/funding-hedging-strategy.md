# DealFlow AI Funding Hedging Strategy

## Executive Summary

**Mathematical Principle**: If each funding source has a 20-25% success probability and you apply to 7 independent programs, your chance of getting at least one is:
```
1 - (0.75)^7 = 86.7% (at 25% each)
1 - (0.80)^7 = 79.0% (at 20% each)
```

This strategy identifies 7 funding programs for simultaneous application, maximizing the probability of securing at least one funding source while avoiding conflicts.

---

## Program Portfolio Overview

| # | Program | Amount | Est. Success Rate | Decision Timeline | Conflict Risk |
|---|---------|--------|-------------------|-------------------|---------------|
| 1 | NSF SBIR Phase I | $275,000 | 20-25% | 6-9 months | None (primary) |
| 2 | NIH SBIR Phase I | $275,000 | 15-20% | 9-12 months | Check cost overlap |
| 3 | Y Combinator W27 | $500,000 | 1.5-3% | 6 weeks | Equity dilution |
| 4 | Techstars (PropTech) | $120,000 | 3-5% | 8-10 weeks | Equity dilution |
| 5 | Kentucky Innovation | $50,000 | 25-35% | 3-4 months | None |
| 6 | MassChallenge | $100,000 | 5-10% | 4-5 months | None (prize) |
| 7 | AWS/Cloud Credits | $200,000 | 40-60% | 2-4 weeks | None (credits) |

---

## Detailed Program Analysis

### 1. NSF SBIR Phase I (Primary Federal Grant)

**Amount**: $275,000 (6 months)  
**Topic**: AI/Machine Learning for Business Applications  
**Acceptance Rate**: ~20-25% for Phase I  
**Timeline**: Submit Oct 2026 -> Decision Mar-Apr 2027

**Why DealFlow Qualifies**:
- Bounded Autonomous Negotiation AI is genuine R&D (not product development)
- Novel constraint-satisfaction in LLM systems
- Clear commercialization path with 847 waitlist signups
- Solo technical founder with domain expertise

**Key Requirements**:
- U.S. small business (<500 employees) - CONFIRMED
- >50% U.S. ownership - CONFIRMED  
- PI employed by company - CONFIRMED
- R&D conducted in USA - CONFIRMED

**Application Components**:
- Project Pitch (already drafted in `docs/nsf-sbir-phase1-pitch.md`)
- Full proposal (3-5 pages per section)
- Budget justification
- Commercialization plan

**No Conflict**: This is the baseline - other applications complement it.

---

### 2. NIH SBIR Phase I (Health Angle)

**Amount**: $275,000 (6-12 months)  
**Topic**: Health IT / Behavioral Health Technology  
**Acceptance Rate**: ~15-20%  
**Timeline**: Submit Jan 2027 -> Decision Sept-Oct 2027

**Eligibility Angle for DealFlow**:
Real estate wholesaling connects distressed property owners with solutions. Frame as:
- **Housing stability intervention** - preventing homelessness through faster distressed property resolution
- **Mental health connection** - housing instability is a Social Determinant of Health (SDOH)
- **AI for health-adjacent populations** - serving financially distressed individuals

**Reframed Research Question**:
"AI-assisted intervention for housing-insecure populations experiencing property distress, enabling rapid connection to housing solutions and reducing displacement-related health outcomes."

**Key Difference from NSF**:
- Different review criteria (health impact vs. technical innovation)
- Different reviewers (health experts vs. CS/business)
- Different timeline (staggered decision)

**Conflict Avoidance**:
- Cannot fund same R&D costs twice
- Must differentiate: NSF = core AI architecture; NIH = health outcome measurement module
- If both awarded, scope one down and return excess funds

---

### 3. Y Combinator Winter 2027

**Amount**: $500,000 standard deal ($125K for 7% + $375K MFN SAFE)  
**Acceptance Rate**: ~1.5-3% (150 companies / 10,000+ applications)  
**Timeline**: Apply by Nov 2 2026 -> Interviews Nov-Dec -> Decision Dec 11

**Why Apply Despite Low Odds**:
- Acceptance converts to massive signal value
- YC AI companies get premium cloud credits ($12M+ in perks)
- Demo Day exposure to 1000+ investors
- Network effects compound post-program

**Fit Assessment**:
| Criterion | DealFlow Status |
|-----------|-----------------|
| Technical founder | Yes (built MVP solo) |
| Working product | Yes (242 tests passing) |
| Market traction | 847 waitlist |
| Big market | $4.2B TAM |
| AI-native | Yes (Claude-powered) |

**Equity Trade-off**:
- 7% standard dilution
- Worth it if converts to Series A at $25M+
- Non-dilutive grants preferred but YC brand value significant

**No Conflict with SBIR**:
- YC funding is equity investment
- SBIR is grant for R&D
- Can use both simultaneously (YC for operations, SBIR for research)

---

### 4. Techstars (PropTech or Fintech Track)

**Amount**: $120,000 ($20K note + $100K optional)  
**Equity**: 6% common stock  
**Acceptance Rate**: ~3-5% (10-12 companies per program / 300+ applications)  
**Timeline**: Rolling applications -> Cohort start Q1/Q2 2027

**Target Programs**:
1. **Techstars Chicago** - Strong midwest presence, real estate market
2. **Techstars New York City** - Real estate capital of US
3. **Techstars Real Estate (if available)** - Previously partnered with MetaProp

**Differentiation from YC**:
- Higher acceptance rate
- Strong corporate partnerships (real estate corps)
- Less competitive, still valuable network
- Different timeline = hedging

**Strategy**: Apply to 2-3 Techstars programs simultaneously (allowed).

---

### 5. Kentucky Innovation Network / SBIR Matching

**Amount**: $50,000-$100,000  
**Type**: State matching grant (non-dilutive)  
**Acceptance Rate**: ~25-35% (less competitive than federal)  
**Timeline**: Rolling - decision in 3-4 months

**Kentucky Programs**:
1. **Kentucky SBIR/STTR Matching Funds Program** - Matches federal SBIR awards
2. **Kentucky Innovation Network** - Pre-seed and seed grants
3. **KY Cabinet for Economic Development** - Tech company incentives

**Why Kentucky**:
- Lower competition than coastal states
- State wants to attract/retain tech companies
- Can stack with federal SBIR (matching, not duplicating)

**Application Strategy**:
- Register Kentucky business address (or relocate founder)
- Apply immediately upon NSF SBIR submission
- Use conditional language ("contingent on federal award")

---

### 6. MassChallenge (Non-Dilutive Competition)

**Amount**: Up to $100,000 (prize money, no equity)  
**Acceptance Rate**: ~5-10% into program, ~20% of finalists win prizes  
**Timeline**: Apply Q4 2026 -> Program Q1-Q2 2027 -> Awards June 2027

**Program Benefits Beyond Cash**:
- Zero equity taken
- Corporate partner connections
- Boston real estate ecosystem access
- Media/PR exposure

**Fit for DealFlow**:
- Early Stage program (industry agnostic)
- Or Challenge program (if real estate vertical runs)

**No Conflict**: Prize money is non-dilutive and unrestricted.

---

### 7. AWS Activate + Cloud Credits (Near-Guaranteed)

**Amount**: Up to $200,000 in AWS credits  
**Type**: In-kind credits (non-dilutive)  
**Acceptance Rate**: ~40-60% for full amount  
**Timeline**: 2-4 weeks approval

**DealFlow AWS Usage**:
- AWS Bedrock (Claude API) - core AI
- AWS SES (email) - campaigns
- AWS SNS (SMS) - notifications
- Potential: EC2, RDS, Lambda

**Application Path**:
1. **AWS Activate Founders** - Up to $100K credits
2. **AWS Activate Portfolio** - If accepted to YC/Techstars, additional credits
3. **Anthropic Partnership Credits** - Additional Claude API credits via Anthropic

**Why Include**:
- High approval rate anchors probability calculation
- Real cash equivalent (reduces burn)
- Converts to runway extension

---

## Probability Calculations

### Conservative Scenario (Lower Success Rates)

| Program | Success Prob | Failure Prob |
|---------|-------------|--------------|
| NSF SBIR | 20% | 80% |
| NIH SBIR | 15% | 85% |
| Y Combinator | 2% | 98% |
| Techstars | 4% | 96% |
| Kentucky | 25% | 75% |
| MassChallenge | 7% | 93% |
| AWS Credits | 50% | 50% |

**P(at least one success) = 1 - (0.80 x 0.85 x 0.98 x 0.96 x 0.75 x 0.93 x 0.50)**
```
= 1 - (0.80 x 0.85 x 0.98 x 0.96 x 0.75 x 0.93 x 0.50)
= 1 - (0.68 x 0.98 x 0.96 x 0.75 x 0.93 x 0.50)
= 1 - (0.6664 x 0.96 x 0.75 x 0.93 x 0.50)
= 1 - (0.6398 x 0.75 x 0.93 x 0.50)
= 1 - (0.4799 x 0.93 x 0.50)
= 1 - (0.4463 x 0.50)
= 1 - 0.2231
= 77.7%
```

### Optimistic Scenario (Higher Success Rates)

| Program | Success Prob | Failure Prob |
|---------|-------------|--------------|
| NSF SBIR | 25% | 75% |
| NIH SBIR | 20% | 80% |
| Y Combinator | 3% | 97% |
| Techstars | 5% | 95% |
| Kentucky | 35% | 65% |
| MassChallenge | 10% | 90% |
| AWS Credits | 60% | 40% |

**P(at least one success) = 1 - (0.75 x 0.80 x 0.97 x 0.95 x 0.65 x 0.90 x 0.40)**
```
= 1 - 0.1243
= 87.6%
```

### Summary
- **Conservative**: 77.7% chance of at least one funding source
- **Optimistic**: 87.6% chance of at least one funding source
- **Midpoint**: ~82% probability

---

## Funding Scenarios

### Best Case (All Programs Succeed)
| Program | Amount |
|---------|--------|
| NSF SBIR | $275,000 |
| NIH SBIR | $275,000 |
| Y Combinator | $500,000 |
| Techstars | $120,000 |
| Kentucky | $50,000 |
| MassChallenge | $100,000 |
| AWS Credits | $200,000 |
| **TOTAL** | **$1,520,000** |

*Note: Would need to carefully manage federal grant overlaps. Likely decline one SBIR or reduce scope.*

### Expected Value Calculation
| Program | Amount | Prob | Expected Value |
|---------|--------|------|----------------|
| NSF SBIR | $275,000 | 22% | $60,500 |
| NIH SBIR | $275,000 | 17% | $46,750 |
| Y Combinator | $500,000 | 2.5% | $12,500 |
| Techstars | $120,000 | 4.5% | $5,400 |
| Kentucky | $50,000 | 30% | $15,000 |
| MassChallenge | $100,000 | 8% | $8,000 |
| AWS Credits | $200,000 | 55% | $110,000 |
| **Expected Total** | | | **$258,150** |

### Minimum Realistic Outcome
If only AWS credits succeed (highest probability):
- **Minimum**: $200,000 in credits = ~24 months runway extension

### Median Outcome (50th percentile)
AWS credits + one other program:
- **Median**: $200,000 credits + $50,000-$275,000 cash = $250,000-$475,000

---

## Application Calendar

### September 2026
| Week | Action |
|------|--------|
| Week 1-2 | Finalize NSF SBIR Project Pitch |
| Week 2 | Submit AWS Activate application |
| Week 3-4 | Draft NIH SBIR health framing |

### October 2026
| Week | Action |
|------|--------|
| Week 1 | **NSF SBIR Project Pitch deadline** (check exact date) |
| Week 2-3 | Y Combinator application preparation |
| Week 4 | Research Kentucky state programs |

### November 2026
| Date | Action |
|------|--------|
| Nov 2 | **Y Combinator W27 on-time deadline** |
| Nov 5-15 | Techstars applications (multiple programs) |
| Nov 15-30 | MassChallenge application prep |

### December 2026
| Week | Action |
|------|--------|
| Week 1-2 | Y Combinator interviews (if invited) |
| Dec 11 | Y Combinator decision notification |
| Week 3-4 | Kentucky Innovation Network application |

### January 2027
| Week | Action |
|------|--------|
| Week 1-2 | **NSF SBIR full proposal** (if pitch accepted) |
| Week 2 | NIH SBIR submission (standard receipt date) |
| Week 3-4 | MassChallenge application deadline |

### February-March 2027
| Month | Expected Decisions |
|-------|-------------------|
| Feb | AWS Credits (approved) |
| Feb | Techstars interviews |
| Mar | Kentucky decision |
| Mar-Apr | NSF SBIR Phase I decision |

### April-June 2027
| Month | Expected Decisions |
|-------|-------------------|
| Apr-May | MassChallenge finalist selection |
| May-Jun | Techstars final decision |
| Jun | MassChallenge awards |

### September-October 2027
| Month | Expected Decisions |
|-------|-------------------|
| Sep-Oct | NIH SBIR decision |

---

## Conflict Management Matrix

| If Awarded... | NSF SBIR | NIH SBIR | YC | Techstars | Kentucky | MassChallenge | AWS |
|---------------|----------|----------|----|-----------| ---------|---------------|-----|
| **NSF SBIR** | - | Scope differentiation | OK | OK | Stacks | OK | OK |
| **NIH SBIR** | Scope diff | - | OK | OK | Stacks | OK | OK |
| **YC** | OK | OK | - | Choose one | OK | OK | Stacks |
| **Techstars** | OK | OK | Choose one | - | OK | OK | Stacks |
| **Kentucky** | Stacks | Stacks | OK | OK | - | OK | OK |
| **MassChallenge** | OK | OK | OK | OK | OK | - | OK |
| **AWS** | OK | OK | Stacks | Stacks | OK | OK | - |

### Key Rules:
1. **Cannot double-dip federal grants** on identical costs (NSF + NIH must have differentiated scopes)
2. **Cannot do YC + Techstars** simultaneously (both are full-time programs)
3. **State matching funds stack** with federal SBIR
4. **AWS credits stack with everything**
5. **Prize money (MassChallenge) is unrestricted**

---

## Risk Mitigation

### Risk: All applications rejected
**Mitigation**: 
- 77-87% success probability makes this unlikely
- Fallback: Bootstrap with waitlist conversions, angel round

### Risk: Multiple acceptances create conflict
**Mitigation**:
- YC vs Techstars: Choose YC (larger funding, better brand)
- NSF vs NIH: Differentiate scope, or decline smaller/later one
- Decision timing staggered - will know YC before SBIR decisions

### Risk: Application fatigue affects quality
**Mitigation**:
- Core materials (pitch deck, product demo) are reusable
- Schedule applications over 4 months, not simultaneously
- Hire grant writer for SBIR applications ($3K-$10K investment)

### Risk: Kentucky residency requirement
**Mitigation**:
- Verify requirements (some allow remote founders)
- Consider establishing Kentucky presence (low cost)
- Alternative: Apply to founder's actual state programs

---

## Resource Requirements

### Time Investment
| Application | Hours | Complexity |
|-------------|-------|------------|
| NSF SBIR | 80-120 | High |
| NIH SBIR | 80-120 | High |
| Y Combinator | 10-15 | Medium |
| Techstars | 8-12 | Medium |
| Kentucky | 20-30 | Low-Medium |
| MassChallenge | 15-25 | Medium |
| AWS Activate | 2-4 | Low |
| **TOTAL** | **215-326 hours** | |

### Financial Investment
| Item | Cost |
|------|------|
| Grant writer (SBIR x2) | $6,000-$20,000 |
| Application fees | $0-$500 |
| Travel (interviews) | $1,000-$3,000 |
| Legal review | $1,000-$2,000 |
| **TOTAL** | **$8,000-$25,500** |

**ROI**: Potential $250K-$1.5M funding for $10K-$25K investment = 10-60x return

---

## Next Actions

### Immediate (This Week)
1. [ ] Submit AWS Activate application
2. [ ] Review NSF SBIR Project Pitch final draft
3. [ ] Research Y Combinator W27 application questions

### This Month (September 2026)
1. [ ] Complete NSF SBIR Project Pitch submission
2. [ ] Outline NIH SBIR health framing
3. [ ] Identify Kentucky state programs with founder eligibility

### Next Month (October 2026)
1. [ ] Y Combinator application submission
2. [ ] Begin Techstars applications (2-3 programs)
3. [ ] If NSF pitch accepted, begin full proposal

---

## Appendix: Additional Programs to Monitor

### Future Consideration (Not in Initial Portfolio)
| Program | Amount | Notes |
|---------|--------|-------|
| DOE SBIR | $200K | If energy efficiency angle found |
| USDA SBIR | $175K | If rural housing angle developed |
| Arch Grants | $50K | Non-dilutive, St. Louis relocation |
| 43North | $1M | Buffalo, NY relocation required |
| Plug and Play | Varies | PropTech accelerator |
| MetaProp | $250K | NYC real estate focus |

### Corporate Grant Programs
| Program | Amount | Notes |
|---------|--------|-------|
| Google for Startups | Cloud credits | AI/ML focus |
| Microsoft for Startups | Azure credits | Founders Hub |
| Anthropic Partner Credits | API credits | Direct outreach |

---

*Document created: September 2, 2026*  
*Last updated: September 2, 2026*  
*Review schedule: Monthly during application period*
