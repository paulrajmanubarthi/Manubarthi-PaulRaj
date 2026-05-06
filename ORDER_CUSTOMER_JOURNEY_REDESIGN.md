# Order Customer Journey Tool — UI/UX Redesign (Cleaner High‑Level + Full Detail)

## Quick opinion on the current screen
The current screen has **all the right data**, but it feels hard to scan because:
- Important KPIs are buried in dense tables.
- Sections are visually heavy and equally emphasized (no clear reading priority).
- The same/related fields appear in different places, causing cognitive load.
- The page is very wide but not information-hierarchical.
- “Analysis”, “Database Data”, and “GraphQL Data” are mixed with operational UI instead of being progressive disclosure.

In short: **data quality is good, information architecture is noisy**.

---

## Redesign goals
1. Make it easy to answer in <10 seconds:
   - Is this order healthy?
   - Is preorder logic correct?
   - Is payment clean?
2. Keep every detail available (nothing removed).
3. Separate high-level summary from forensic/debug details.
4. Keep support agents fast on desktop and safe on smaller screens.

---

## Proposed information architecture

### 1) Sticky header (always visible)
- **Order #3657**
- Health badge: `Healthy` / `Needs attention` / `Critical`
- Chips: `Preorder`, `Paid`, `Online Store`, `US`
- Actions: `Copy Order ID`, `Open Shopify`, `Export JSON`, `View Timeline`

### 2) Executive summary cards (top row)
Use 6 compact cards with icon + primary value + secondary context:
- **Order Status**: Preorder match ✅
- **Created**: May 06, 2026 20:59 (local + UTC)
- **Customer Journey**: Added to cart → ordered in 0.0h
- **Payment**: Paid $148.00 (2 successful transactions)
- **Preorder Risk**: Low (within quantity limit)
- **Items**: 1 line item / Preorder count 1 of 3

### 3) “Journey Timeline” (centerpiece)
A vertical timeline component replacing fragmented timestamps:
- Preorder setup created
- Added to cart
- Authorization
- Capture
- Order placed
- Any anomalies (out-of-order events, missing capture, changed plan)

Each event node contains:
- Event name + status icon
- Timestamp
- Source (`DB`, `Shopify`, `GraphQL`)
- “Inspect payload” toggle

### 4) Diagnostic sections (accordion)
Default open: only critical sections.
- **A. Order Overview** (structured key-value grid)
- **B. Payment & Transactions** (table + status chips + mismatch detector)
- **C. Line Items** (each item in card/tab)
- **D. Preorder Validation** (rule-by-rule checks)
- **E. Technical Raw Data** (collapsed by default)
  - Database data
  - GraphQL raw
  - Debug IDs

### 5) Line-item panel redesign (per product)
Current 4-column layout is dense; switch to this:
- Left: product identity + variant + CTA
- Middle: preorder configuration snapshot
- Right: validation outcome + selling plan match
- Bottom (collapsible): raw data and debug strings

Add “diff style” comparison:
- **Expected** vs **Observed** fields:
  - selling_plan_id
  - inventory provider
  - preorder limit
  - preorder sold count

Green when exact match; amber/red when drift.

---

## Visual design cleanup

### Typography
- Section headings 20/24 semibold
- Labels 13/16 medium
- Values 15/22 regular
- Monospace only for IDs/raw payload

### Spacing
- 8px baseline grid
- Card paddings: 16–20px
- Section gaps: 20–24px

### Color semantics
- Success: green
- Warning: amber
- Error: red
- Info: blue
- Debug: gray

Do not use saturated header bars for every block; reserve strong color only for alerts and status badges.

### Data formatting
- Money normalized: `$148.00 USD`
- Time normalized with timezone: `May 06, 2026, 8:59 PM UTC`
- IDs truncated with copy button: `gid://shopify/Order/7032…4516`

---

## Suggested component model (implementation-oriented)

1. `OrderHeader`
2. `KpiCardGrid`
3. `JourneyTimeline`
4. `ValidationSummary`
5. `PaymentPanel`
6. `LineItemInspector`
7. `RawDataDrawer`

All panels receive typed view models so UI is separated from raw API payload shape.

---

## Rule engine surface (don’t miss details)
Convert current text checks into explicit machine-readable checks:

- `selling_plan_match`
- `order_after_preorder_setup`
- `preorder_count_within_limit`
- `payment_fully_captured`
- `transaction_status_consistent`
- `inventory_policy_consistent`

Each rule has:
- status (`pass|warn|fail`)
- evidence fields
- remediation runbook link

This keeps details mandatory and auditable while showing clean top-level summaries.

---

## Example “high-level first” layout (wireframe)

- Header: `Order #3657` [Healthy]
- Row 1: 6 KPI cards
- Row 2:
  - Left 70%: Journey Timeline
  - Right 30%: Validation Summary (pass/warn/fail counts)
- Row 3: Payment panel
- Row 4: Line item inspector (tabs if multiple items)
- Row 5: Raw data (collapsed)

---

## Migration plan (safe incremental)

1. **Phase 1 — Presentation-only refactor**
   - Keep same backend payloads.
   - Re-map existing fields into new sections.
2. **Phase 2 — Validation normalization**
   - Emit standardized rule objects.
3. **Phase 3 — Performance/UX polish**
   - Virtualize long payloads.
   - Add sticky quick-nav and copy helpers.

---

## Acceptance criteria
- Agent can determine order health in <10 seconds.
- All existing fields remain available.
- Raw/debug data is present but collapsed by default.
- Validation results are deterministic and mapped to explicit rules.
- Layout remains usable at 1280px width and above.

---

## Final recommendation
Your tool is already **data-rich and trustworthy**, which is great. The biggest improvement is not adding more data, but **restructuring for progressive disclosure**:
- **Top = decisions**
- **Middle = evidence**
- **Bottom = raw payloads**

That will make the Order Customer Journey lookup cleaner, faster, and still complete for deep debugging.
