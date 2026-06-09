# Qp Onboarding v2 — Product Requirements Document

**Status:** Draft  
**Date:** 2026-06-05  
**Scope:** Chat-driven proactive enrichment, replacing the passive import experience

---

## The Problem

When a user pastes or imports a list of tasks with only titles, three things happen that quietly kill the value of the app:

1. **The Planner is empty.** No dates = nothing on the timeline.
2. **Filters are useless.** No categories = every dropdown says "All".
3. **Qp gives shallow answers.** "What's overdue?" → nothing has a due date, so nothing.

The app doesn't tell the user any of this. It accepts the bare tasks and shows them a kanban board. The user gets a tidy list view — exactly what they already had in a spreadsheet — and doesn't understand why they'd come back.

A good assistant doesn't accept an incomplete brief. It asks the right questions.

---

## Vision

Qp is an expert planner who notices what's missing and fills the gaps — one smart question at a time, always in context, never all at once.

The user pastes 12 tasks. Qp says: *"Nice, I've added these. A few things would make your plan a lot more useful — want me to help tidy them up? It'll take about 2 minutes."* Two minutes later, every task has a date and a category. The Planner is populated. The briefing is meaningful.

---

## User Stories

| User | Want | So that |
|------|------|---------|
| New user imports a task list | Qp to notice missing data and offer to fill it | They get value on day one, not day seven |
| User navigates to Planner | Qp to explain why it's empty and offer to fix it | They don't think the app is broken |
| User asks "which tasks have no deadline?" | Qp shows them and lets them set dates inline | They don't have to open every task modal |
| User asks "help me plan this" | Qp walks them through the whole project in conversation | They have a complete plan without touching a form |
| User returns after a few days | Qp's briefing includes what's still missing | They're nudged to complete the plan without nagging |

---

## Core Concept: Task Completeness

Every task gets a completeness score. This drives everything else — what Qp surfaces, when, and in what order.

### Field weights

| Field | Weight | Why it matters |
|-------|--------|----------------|
| End date (deadline) | 35% | Without it: no Planner, no overdue detection, no upcoming view |
| Category | 20% | Without it: filters are empty, grouping is useless |
| Start date | 15% | Without it: Planner bars can't be drawn |
| Status (if not default) | 15% | Without it: "what's in progress?" returns nothing real |
| Assigned person | 15% | Without it: "what's mine?" returns nothing |

**Project health score** = average completeness across all tasks.  
Shown as a small progress ring in the sidebar next to the project name.

---

## Gap Triggers

Qp surfaces at the right moment — not randomly, not repeatedly.

### 1. Import trigger (highest priority)
**When:** User adds ≥3 tasks in one action (paste, CSV import, bulk create) with average completeness < 50%.  
**What:** Qp opens automatically and offers the enrichment conversation.  
**Once per import session** — not every time they return to the project.

### 2. View trigger
**When:** User navigates to Planner and ≥30% of active tasks have no date.  
**What:** A non-blocking banner appears: *"5 tasks aren't showing because they have no dates. [Add them now →]"*  
Clicking opens the enrichment flow in chat. Banner is dismissible per session.

### 3. Chat trigger (reactive)
**When:** User asks something that requires data that doesn't exist yet.  
**Example:** "What's overdue?" → no tasks have dates → Qp explains and offers to fix:  
*"Nothing's marked overdue — but none of your tasks have due dates yet. Want me to help you add them?"*

### 4. Briefing trigger (ambient)
**When:** Project health < 60% and it's been ≥3 days since last enrichment nudge.  
**What:** The daily/weekly briefing includes a one-line health note:  
*"7 tasks still have no deadline — type 'add dates' to sort that out."*  
Not a blocker. Just a line in the normal briefing.

### 5. Filter trigger
**When:** User opens the category or room filter and ≥70% of tasks have no value for that field.  
**What:** Inline note below the empty dropdown: *"Most tasks have no category yet. [Set them quickly →]"*

---

## Enrichment Flows

### Flow A — Post-import (automatic, sequential)

The primary flow. Triggered immediately after a bulk import.

**Step 1 — Project scope**
Qp asks about the project as a whole first, not task by task.  
This sets a baseline that applies to all tasks.

```
Qp: I've added your 10 tasks. Dates and categories will unlock the 
    Planner and make filtering useful — want to set them up? 
    Should take about 2 minutes.

User: yeah

Qp: When does this project need to be finished?

User: end of September

Qp: And roughly when does it start?

User: we've already started, last week

Qp: Got it — project runs mid-May to end of September.
    Now I'll go through each task quickly.
```

**Step 2 — Per-task enrichment**
One task at a time. Qp asks only for what's missing. If the task name strongly implies a category, Qp proposes it.

```
Qp: "Install kitchen cabinetry" — when does this need to be done by?

User: June 20

Qp: Done. Looks like a trade job — should I file it under "Trade"?

User: yes

Qp: ✓ Next: "Paint hallway walls" — due date?

User: July 5, and yes trade again

Qp: Done ✓  [continues...]
```

After all tasks:
```
Qp: All done. Your project is now 85% complete — the Planner is 
    ready to use and your briefings will be a lot more useful. 
    [Open Planner →]
```

**Conversation rules:**
- One question per turn, never two
- Accept "skip", "later", "don't know" gracefully — mark the task and move on
- Accept bulk replies: "June 20, that's a trade job" gets parsed as both date and category
- Accept date ranges: "June 20 to 25" sets both start and end
- Respect shortcuts: "same as last one" / "same category" / "next month"

### Flow B — Chat-driven (on demand)

User initiates. No automatic trigger.

**"Which tasks have no deadline?"**
```
Qp: 4 tasks have no due date:
    • Install kitchen cabinetry  [Set date]
    • Paint hallway walls  [Set date]
    • Sand floors  [Set date]
    • Council sign-off  [Set date]

    Want me to go through them one by one?
```

Each `[Set date]` button opens an inline date picker inside the chat — no modal required.

**"Help me plan this"**  
Triggers the full Flow A enrichment conversation regardless of import state.

**"What's incomplete in this project?"**
```
Qp: Project health: 62%

    Missing deadlines (4 tasks):
    Install kitchen cabinetry, Paint hallway, Sand floors, Council sign-off

    Missing categories (2 tasks):
    Council sign-off, Skip bin hire

    Missing person (3 tasks):
    Paint hallway, Sand floors, Splashback tiling

    Want to fix any of these? Try "add dates to the painting tasks" 
    or "set category for council sign-off".
```

### Flow C — Context nudge (view-triggered)

Minimal interruption. A single line, not a modal.

On the Planner:
> *"5 tasks aren't showing — they have no dates. [Add them in chat →]*"

On filters:
> *"No categories set yet. [Set them quickly →]*"

Clicking either link opens chat with the right enrichment prompt pre-loaded.

---

## Inline Editing from Chat

This is the enabler for all flows. Qp's responses include actionable inline controls — not just text.

### What can be set inline

| Field | Control |
|-------|---------|
| End date | Date picker embedded in chat bubble |
| Start date | Same |
| Category | Dropdown (existing categories) or type-to-create |
| Assigned | Name input with autocomplete from project members |
| Status | Inline status pill (tap to cycle) |

### Confirmation pattern
After each inline edit, Qp confirms in the same thread:
> *"Done — 'Paint hallway walls' is now due July 5, category: Finishing."*

No page reload. No modal. The task card updates in the background.

---

## Smart Inference

When an LLM API key is configured, Qp can suggest values instead of just asking.

| Task name | Qp suggests |
|-----------|-------------|
| "Install kitchen cabinetry" | Category: Trade |
| "Council permit application" | Category: Planning |
| "Paint feature wall" | Category: Finishing |
| "Waterproofing" | Depends on: "Demolish old bathroom" |

Without an LLM key, a keyword lookup table covers the most common patterns (same approach as the existing local intent engine).

**Important:** Suggestions are always presented as questions, not silently applied.  
*"Looks like a trade job — should I file it under 'Trade'?"*

---

## Project Health Indicator

A small visual in the sidebar next to each project name.

- **Ring**: fills proportionally to completeness (0–100%)
- **Colour**: green (80–100%) → amber (50–79%) → red (<50%)
- **Tooltip on hover**: *"7/12 tasks have dates · 4/12 have categories"*
- **Click**: opens chat with enrichment prompt pre-loaded

On mobile, the ring appears in the project header.

Not shown for projects at 100% — no reason to show a completed indicator perpetually.

---

## What Qp Does Not Do

- **Ask for everything at once.** One question per turn, always.
- **Open a modal.** All enrichment happens in chat or inline.
- **Nag.** Each trigger fires once per session. Dismiss is always respected.
- **Require the LLM.** Every flow works locally. LLM improves suggestions only.
- **Ask why fields matter more than once.** Explain dates once at the start of a flow. Never again in that session.
- **Block the user.** All flows are opt-in. "Later" is always a valid answer.

---

## Phased Delivery

### Phase 1 — Gap detection + chat intents (foundation)
*Lowest risk. Builds entirely on the existing intent engine.*

- Task completeness score function (new, in storage layer)
- Project health score (aggregate)
- New chat intents:
  - "which tasks have no deadline/date"
  - "which tasks have no category"  
  - "what's incomplete / project health"
  - "help me plan this" (triggers enrichment)
- Inline `[Set date]` and `[Set category]` buttons in chat responses
- Confirmation messages after inline edits

### Phase 2 — Post-import enrichment
*The main event. Requires the sequential conversation engine.*

- Import trigger detection (bulk add ≥3 tasks, low completeness)
- Sequential enrichment conversation flow
- Project-scope questions (dates, type) before per-task questions
- "Skip / later / don't know" handling
- Bulk reply parsing ("June 20, that's a trade job")
- Keyword-based category inference (no LLM required)
- Completion celebration + Planner shortcut

### Phase 3 — Context triggers
*Ambient nudges that surface in the right moment.*

- Planner empty-state banner with enrichment link
- Filter empty-state note
- Briefing health summary line
- Per-project "last nudge" timestamp (prevents repetition)
- Project health ring in sidebar

### Phase 4 — LLM-enhanced inference
*Requires API key. Improves suggestion quality.*

- Category suggestions from task names via Claude
- Dependency suggestions ("this probably comes after X")
- Duration estimates ("trade tasks like this usually take 2–3 days")
- "Plan this project from a description" — paste a brief, Qp generates a skeleton

---

## Success Metrics

| Metric | Target |
|--------|--------|
| Tasks with a date within 5 min of import | >60% |
| Project health at end of first session | >70% |
| "No date" tasks at day 3 vs day 1 | -50% |
| Enrichment conversation completion rate | >70% |
| Chat enrichment intent usage per DAU | ≥1 per active project |

---

## Open Questions for Design

1. Should the health ring be in the sidebar (always visible) or only in the project header (contextual)?
2. When Qp auto-opens after import, should the chat panel slide in, or should there be a prompt first?
3. For "skip" tasks during enrichment — should they be tagged so Qp remembers to ask again later, or just left blank?
4. Category inference: keyboard keyword table vs LLM — what's the threshold for switching?
5. Should the inline date picker use the existing `date-range-picker.js` component or a simpler single-date input for speed?
