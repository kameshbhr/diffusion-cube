# Pathway Document Spec — Draft for Review

**Status:** draft, not yet applied. Nothing the app loads at runtime has changed.
Once agreed, this is split into `content/framework.md` (structure and rules) and
`content/pathway-generation-prompt.md` (generation execution rules), and code
changes follow separately.

Modelled on *Journey Model — Voice AI for Low-Resource Languages v0.1*. Every
pathway uses this one structure, whether it draws on one deployment or many,
or on a playbook.

---

## A. What changes in `content/framework.md`

| Section today | Change |
|---|---|
| The four dimensions | **Keep.** |
| Cross-cutting concerns | **Keep.** |
| The four adopter stages | **Keep.** |
| Question bank — insight forms per dimension × stage | **Keep.** Still drives Explorer/Analyse and step classification. One edit: Scale × Ecosystem insight form "Transferable unit + condition tag" → "Transferable step + where it applies + evidence". |
| Exhaustive list of questions | **Keep.** Fix heading "2. Technology Dimension" → "2. Solution Dimension" (the rest of the app says Solution). |
| The pathway document — output structure | **Replace** with section C below. |
| The five unit types | **Remove.** Steps have no types. What the types captured moves into Why / How / Evidence (see D). |
| Extraction discipline | **Replace** with section E below. |
| Source Trace appendix — specification | **Replace** with C.11 below. |

---

## B. Frontmatter

```yaml
---
title: <pathway title>
description: <one sentence: the use case and who it serves>
sector: [Agriculture, Health]      # one or more; or [Cross-Sector]
stage: <Explore | Define | Pilot | Scale>
tags: [Voice AI, Language]          # 2–4 use-case labels, not sectors
version: 0.1
timestamp: 2026-10-13
---
```

- `stage` = the most advanced *stage reached* across the Reference implementations entries — derived from them, never chosen freely. With no deployment yet (playbook-only), use the furthest stage the source's guidance is drawn from experience at; if none, `Explore`.
- `sector` is a list even when single. `Cross-Sector` is used alone, for a deliberately horizontal pathway.
- `version` starts at `0.1`; bump on every republish that changes steps. Step ids never change across versions (see D).
- Dropped from today's frontmatter: `contributor`, `location` (now per deployment, in C.2).

---

## C. Document structure

Sections appear in this order. Headings are fixed text so parsers can find them.

### C.1 `# <Title>` + `**Version x.y**`

### C.2 `## Context`

| Attribute | Value |
|---|---|
| Use case | What is being built or adopted, and into what service |
| Produces | The concrete outputs when the pathway is complete |
| Applies where | Preconditions under which this pathway holds (institution type, population, commitments in place) |
| Reference scale | The scale the guidance is calibrated to — population, duration, cost order of magnitude |
| Out of scope | What this pathway deliberately does not cover, and whose journey it is instead |
| Derived from | Playbooks, reports, or other non-deployment sources, by title — never file names. `None` if purely deployment-derived |
| Reference implementations | One line: the deployment ids from C.3, e.g. `astitva` · `baani` |
| Status | How well-evidenced the pathway is, in a sentence — e.g. "Derived from one playbook, not yet tested against contributed deployments" or "Consolidated from three live deployments" |

### C.3 `## Reference implementations`

One `###` entry per deployment. A pathway may have exactly one. Every field
always appears, in this order; unsupported fields say `Not documented`.

```markdown
### `astitva` — Project Astitva

| Field | Value |
|---|---|
| Adoption | Project Astitva — Dehwali Bhili Language Enablement |
| Owning institution | District Administration, Nandurbar |
| Sector | Agriculture |
| Geography | Nandurbar district, Maharashtra, India |
| Problem being solved | … |
| End users — who | … |
| End users — how many | … |
| End users — device access | … |
| End users — connectivity | … |
| End users — languages | … |
| Stage reached | Pilot · live |
| Effort | Duration … · team size … · partners … |
| Cost | Setup … · running … · funded by … (currency, as stated) |
| Ecosystem partners | Karya → Collection agency · AI4Bharat → Model builder · … |
| Scale and outcomes | Headline usage/outcome numbers |
| As of | 2026-07 |
```

- The id (`astitva`) is a stable lowercase slug; Evidence cites it.
- Stage reached = one of the four stages, plus state: `live` · `paused` · `discontinued`.
- Partner roles use names from the Roles table (C.6).
- A playbook is not a deployment — it goes in Context's *Derived from*, never here.

### C.4 `## Stages`

| Stage | The question | What is committed | Closes with |
|---|---|---|---|

Stage names are fixed (Explore, Define, Pilot, Scale). The other three columns
are written for this use case. "Closes with" lists the options of that stage's
closing decision step.

### C.5 `## Dimensions`

| Dimension | Covers in this use case | Groups |
|---|---|---|

Dimension names are fixed (Persona, Solution, Institution, Ecosystem). Groups
are 2–3 per dimension, named for this use case; every step belongs to exactly
one group.

### C.6 `## Roles referred to in the steps`

| Role | Does | Examples |
|---|---|---|

Every role named in a step or a partner list appears here. Examples are real
named organisations or posts where the source gives them, else `—`.

### C.7 Steps — one `#` heading per stage

```markdown
# Explore

*<the stage's question, from C.4>*

### `explore.champion` — Secure a champion
Persona | Solution | Institution | Ecosystem · <Group> · Source: S1 §2.1, S2

**Decision points**
`key`: option · option · option

**What.** …

**Why.** …

**How.** …

**Evidence.**
- *astitva:* …
- *baani:* …
```

Anatomy and rules in section D.

### C.8 `# Decision point register`

| Decision point | Settled at |
|---|---|

Every `key` used in a step, once, with the step id where it is settled.

### C.9 `# Step count`

Total and per-stage counts in one line, then:

| Dimension | Steps |
|---|---|

Must match the steps exactly.

### C.10 `# Open points`

| Step | Open point |
|---|---|

Questions the sources could not settle — ambiguities, contradictions between
sources or deployments, missing figures. Each is a question for a contributor,
not a gap to fill. Step column may say `Context` or a section name. Replaces
today's Section 2 Gaps list.

### C.11 `# Source Trace` (contributor-only)

Separated by a `---` divider. Never surfaced to adopters, in any mode. The
heading must contain "Source Trace" (the existing hiding logic cuts there).

| Ref | Source | Covers | Notes |
|---|---|---|---|
| S1 | <file name / doc title, as-of date> | Context; C.3 `astitva`; steps `explore.*`, `define.governance` | Primary / confirms only / superseded |

`Ref` is the label steps cite in their `Source:` line, so adopter-facing text
shows only `S1 §4.2` and never a file name.

---

## D. Step rules

**Id.** `<stage>.<kebab-slug>`, unique in the document, stable forever once
published. New material adds new ids; existing ids are never renamed or
renumbered. A step that moves stage keeps its id.

**Title.** An imperative, decision-oriented phrase.

**Tag line.** `Dimension · Group · Source: <refs>`. Exactly one dimension and
one group. Source cites `S#` refs from C.11, with section numbers where the
source has them.

**Decision points.** Only where the source names the options, or where it is
the stage's closing decision. Format `` `key`: option · option ``.

**What.** The outcome of the step — what exists when it is done. One or two
sentences.

**Why.** Why the step matters and what goes wrong without it. General — written
for the next adopter, not about one deployment.

**How.** How to do it: sequence, thresholds, roles, numbers that are guidance.
Conditions go here as "Where X, do Y; where Z, don't" — this replaces the old
condition tag. If the source gives no how, write `Not specified in the sources.`

**Evidence.** Optional. What actually happened in named deployments that backs
the step:
- Each item starts with a deployment id from C.3: `- *astitva:* …`.
- Only concrete facts: outcomes and before→after, figures, an alternative that
  was genuinely weighed, something that broke and the fix.
- Omit the field entirely when no deployment supports the step. Never write
  "Not documented" here.
- Playbook and report content is never Evidence — it informs What/Why/How and
  is cited through `Source:`.
- Where deployments disagree: if the source explains the difference, turn it
  into a condition in How; if not, add a row to Open points.

**Stage close.** The last step of every stage is its closing decision, in the
Institution dimension, with a decision point listing C.4's "Closes with"
options.

**Size.** Guideline 6–12 steps per stage. Merge steps that express the same
insight; do not split one insight across stages.

---

## E. Generation rules (carried into the generation prompt)

Kept from today, adapted:

1. **Classify against the insight form.** Check each step's dimension × stage
   against the question bank's insight form for that cell, not by how it
   sounds.
2. **Re-check every axis when moving a step.** Changing a step's stage means
   re-checking its dimension and group too.
3. **Institution vs Ecosystem** — the chain-of-command test. If the
   counterpart needed a separate negotiated agreement, MoU, or incentive
   alignment with an organisationally distinct actor, it is Ecosystem, even if
   state-affiliated.
4. **General principle in What/Why/How, specific case in Evidence.** A step
   whose How only restates one deployment's example is under-generalised.
5. **Practice vs instance.** A named local tool or platform is the instance
   (Evidence, or an example in Roles), not the transferable practice.
6. **Don't fabricate.** No invented figures, alternatives, conditions or
   names. Unsupported Reference implementation fields say `Not documented`;
   unsupported How says `Not specified in the sources.`; unsupported Evidence
   is omitted.
7. **Don't resolve ambiguity.** State what the source says; put the ambiguity
   in Open points.
8. **Alternatives must be real.** Only an alternative actually weighed in a
   deployment counts as Evidence; general advice about what others could
   consider does not.
9. **Never mention the framework**, this prompt, or classification reasoning
   anywhere above the Source Trace.

Dropped: the 8-unit cap, unit types and their fields, the Playbook/Toolkit
bars, the coverage grid density rule, the four gap-survival tests (Open points
replace gaps), Toolkits table, Retrieval guide, Section 5.

## F. Self-check before finalising

- Frontmatter `stage` equals the most advanced *stage reached* in C.3.
- Every Evidence item's id exists in C.3; every C.3 id appears in Context.
- Every role named in steps or partner lists is in the Roles table.
- Every step's group is listed under its dimension in C.5.
- Every stage ends with a closing decision step.
- Decision point register and Step count match the steps exactly.
- Every `S#` cited in a step exists in Source Trace; no file name appears above it.
- No framework references or meta-commentary above Source Trace.

---

## G. Open design questions

1. **Groups — free-form or tied to framework sub-categories?** The attached
   model names groups per use case (e.g. Data · Models · Hosting). Proposed:
   free-form, no mapping. Cross-pathway retrieval works on dimension × stage,
   which is unchanged. Tying groups to sub-categories (Solution D, E…) would
   help comparison across pathways but adds jargon the app already hides.
2. **Corpus size.** A 45-step pathway is ~35 KB — about the size of today's
   largest pathways, and the whole corpus goes into context. The 6–12 per
   stage guideline keeps it bounded; retrieval becomes necessary sooner either
   way as the corpus grows.
3. **Contributor-written pathways (Contributor flow).** A single contributor's
   conversation yields one deployment with one source (`S1 — Adoption
   Companion conversation`). Proposed: same structure, no exceptions; Context
   *Status* says it is one contributor's account, not independently verified.
4. **Analyse draft (Explorer's own adoption write-up).** Today it uses a
   trimmed Section 0–6 skeleton with no Source Trace. Proposed: same new
   structure, minus Source Trace, minus the `Source:` part of the tag line.
