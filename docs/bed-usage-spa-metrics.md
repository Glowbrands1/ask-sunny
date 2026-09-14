> **Provenance.** Supplied by Paulyne Camacho on 2026-09-14 as authoritative
> business documentation for Bed Usage, Spa Wellness, Spa Conversion and
> capital-performance analysis, and committed here verbatim so the code can
> cite a file rather than an email. Where this document and an older note
> disagree, this one governs. The rules it fixes and the code that enforces
> them:
>
> | Rule | Enforced in |
> |---|---|
> | Zero usage means the equipment is NOT installed | `spa-wellness/parser.ts`, `spa-wellness-analytics.ts` |
> | Bed `v Chain` bands (≥+2 / −2..+2 / −2..−8 / ≤−8) | `performance/classification.ts` — `BED_USAGE_LADDER` |
> | Spa peer bands (≥+10 / −5..+10 / −5..−15 / ≤−15) | `performance/classification.ts` — `SPA_PEER_LADDER` |
> | Spa Conversion Rate = spa sessions ÷ total tans | `bed-spa/combined.ts` |
> | FAST removals are not a negative KPI | `performance/classification.ts` — `isReportableFinding` |
>
> **Verified against the source workbooks on 2026-09-14.** The two deliveries
> this document describes were inspected directly and the rules above hold in
> them — the Spa Wellness sheets never write a zero in an equipment column at
> all, and the `Filtered Average` they publish divides by the salons that have
> the equipment. That pass also settled the one thing this document does *not*
> cover, the Spa Engagement workbook's published `Overall Rank`. See
> `docs/spa-engagement-overall-rank.md`.

# Bed Usage + Spa Capital Performance System
## Reports Analyzed and Metrics Reviewed

For the recurring monthly analysis, the system uses **two core reports**:

1. **Bed Usage Report**
2. **Spa Wellness Tracking Report**

These two reports are combined to evaluate tanning performance, spa performance, store execution, and capital allocation opportunities.

---

# 1. Bed Usage Report

## Purpose
The Bed Usage Report is used to evaluate how JB & Associates' tanning equipment performs:

- By store
- By equipment level/type
- Versus the broader Sun Tan City chain
- On a per-bed basis
- As a measure of store traffic for spa conversion analysis

## Primary Fields Reviewed

- **Salon Name**
- **Company**
- **Level**
- **Tans**
- **Qty / Beds**
- **Per Bed**
- **v Chain**

The analysis filters the company field to:

> **JB and Associates**

## Metrics Reviewed

### Total Tans
Used as the primary measure of monthly tanning traffic.

This is also used as the denominator when calculating **Spa Conversion Rate**.

### Per Bed Usage
Measures equipment utilization while accounting for how many units of that type are installed.

This helps avoid misleading comparisons between a store with one unit and a store with multiple units.

### v Chain
Measures JB performance against the broader chain benchmark.

Bed performance is categorized as:

| Performance vs Chain | Classification |
|---|---|
| ≥ +2% | Outperforming Peers |
| -2% to +2% | At Market |
| -2% to -8% | Below Market |
| ≤ -8% | Significantly Underperforming |

## Strategic Questions Answered

The Bed Usage Report helps determine:

- Are JB beds outperforming or underperforming the chain?
- Which stores have the strongest equipment utilization?
- Which stores or bed levels are underutilized?
- Are premium levels performing at or above chain?
- Are FASTER, FASTEST, and INSTANT units absorbing demand after FAST removals?
- Does a location have enough customer traffic to justify additional spa equipment?

## FAST Equipment Rule

FAST removals are intentional and are **not treated as a negative KPI**.

FAST is monitored primarily for:

- Capacity
- Volume migration
- Whether premium equipment absorbs former FAST demand

---

# 2. Spa Wellness Tracking Report

## Purpose
The Spa Wellness Tracking Report is used to evaluate:

- Spa equipment usage
- Equipment performance versus peers
- Store-level spa execution
- Recently installed equipment
- Expansion and capital allocation opportunities

## Primary Fields Reviewed

- **Salon Name**
- **Company**
- Individual **Spa Equipment Columns**

Spa equipment columns are dynamic and are identified by their actual report headers rather than fixed column positions.

## Critical Equipment Presence Rule

> **Zero usage means the equipment is NOT installed.**

A zero is not treated as underperformance.

For equipment comparisons:

- JB must have non-zero usage for that equipment
- Peer locations must also have non-zero usage for the same equipment
- Only like-for-like installed equipment is compared

## Metrics Reviewed

### Monthly Spa Sessions
Measures raw utilization of each piece of spa equipment.

### JB Average vs Peer Average
For each equipment type, JB usage is compared with other locations that have the same equipment installed.

Spa equipment performance is classified as:

| Performance vs Peer Average | Classification |
|---|---|
| ≥ +10% | Outperforming Peers |
| -5% to +10% | At Market |
| -5% to -15% | Below Market |
| ≤ -15% | Significantly Underperforming |

### Store-Level Equipment Usage
Used to identify:

- Strong operators
- Weak operators
- High-performing equipment
- Underutilized equipment
- Potential capacity constraints

### New Equipment Ramp
Recently installed equipment is evaluated with the understanding that short-term dilution or ramp-up is expected.

The focus is on:

- Session growth
- Conversion improvement
- Ramp over time

---

# 3. Combined Metric: Spa Conversion Rate

The Bed Usage Report and Spa Wellness Tracking Report are combined to calculate the primary store execution metric.

## Formula

> **Spa Conversion Rate = Monthly Spa Sessions ÷ Monthly Total Tans**

## Why It Matters

Raw spa sessions alone can be misleading because higher-volume stores naturally have more customer opportunities.

Spa Conversion Rate normalizes spa usage for store traffic.

It measures how effectively each salon converts tanning customers into spa usage.

## Used For

- Ranking JB stores
- Identifying top spa operators
- Identifying low-conversion locations
- Comparing stores with different traffic levels
- Separating traffic issues from execution issues
- Determining whether a store should receive additional equipment

---

# 4. Capital and Expansion Metrics

The two reports are combined to determine where future spa capital should be deployed.

## Favor Expansion Where

- Spa conversion is high
- Existing equipment performs at or above peers
- Store traffic supports additional capacity
- The equipment type is proven
- Existing utilization suggests additional demand

## Fix Before Expanding Where

- Traffic is high but conversion is low
- Existing spa equipment is below peer performance
- Current equipment appears underutilized
- Operational execution is weak
- Newly installed equipment has not had enough time to ramp

---

# 5. Core Monthly Metrics

Every month, the analysis focuses on five primary areas:

## 1. Tanning Equipment Performance
**Question:** Are JB beds winning versus the chain?

Metrics include:

- v Chain
- Tans
- Per Bed usage
- Equipment level performance

## 2. Spa Equipment Performance
**Question:** Is JB getting competitive usage from each equipment type?

Metrics include:

- Sessions by equipment
- JB average
- Peer average
- Percentage above/below peers

## 3. Store Execution
**Question:** How effectively does each store convert customer traffic into spa usage?

Primary metric:

> **Spa Conversion Rate**

## 4. Capital Effectiveness
**Question:** Are installed spa pieces creating meaningful utilization?

Metrics include:

- Equipment sessions
- Store conversion
- Peer performance
- Ramp trends
- Utilization after installation

## 5. Expansion Opportunity
**Question:** Where should the next equipment dollar go?

Decisions consider:

- Store traffic
- Spa conversion
- Existing equipment utilization
- Equipment performance versus peers
- Capacity
- Execution quality

---

# Monthly Analysis Outcome

Using the **Bed Usage Report** and **Spa Wellness Tracking Report**, the system is designed to answer:

- **What is working?**
- **What is not working?**
- **Which stores are executing best?**
- **Which equipment is performing best?**
- **Where is capital being underutilized?**
- **Where should JB add equipment next?**
- **Which stores should improve execution before receiving more equipment?**

The goal is not simply to report session counts.

The goal is to use **traffic + utilization + conversion + peer performance** to make better operating and capital deployment decisions.
