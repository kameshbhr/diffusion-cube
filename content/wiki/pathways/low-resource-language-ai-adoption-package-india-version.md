---
title: Bhili Language Enablement — Project Astitva
description: How EkStep Foundation brought Dehwali Bhili, a tribal language with no standard script, onto India's language AI infrastructure in Nandurbar district, producing an open-licensed model, dataset, and replication handbook designed for the next adopter.
stage: Pilot
sector: Government / Tribal Language AI
location: Nandurbar, Maharashtra, India
tags: [Tribal Language, Voice AI, Low-Resource Language, Government Services]
---

---

## Section 0 — Reading Guide

This document records what was learned building language AI for Dehwali Bhili speakers in Nandurbar, Maharashtra. It is written for the next adopter — a District Collector, a program lead, a state official — who is about to take on a similar effort and needs to know what decisions were made, why they were made, and under what conditions they hold.

The pathway is organised across four dimensions: who the excluded user is and what they need (Persona); what was built and how (Solution); what the institution had to do to own it (Institution); and what the wider ecosystem of partners, platforms, and data owners had to hold together (Ecosystem). Within each dimension, knowledge is tagged to the stage at which it was discovered — Explore, Define, Pilot, or Scale — so you can navigate to what is most relevant to where you are now.

Where knowledge is dense, the units are precise: real thresholds, real failure patterns, real sequencing from Nandurbar. Where knowledge is thin — particularly at Pilot and Scale — the gaps are named directly. A thin cell is not a missing section; it is an honest signal about what this deployment has not yet resolved, and what the next adopter will need to work out for themselves or contribute back.

The micro-innovations in Section 3 are the core reusable content. Each is a decision, a failure, or a playbook step that a different district or institution can lift and apply — tagged with the condition under which it holds and the condition under which it fails. Start there if you are already committed and need to know what to watch for.

---

## Section 1 — Pathway Identity

| Field | Detail |
|---|---|
| **Deployment name** | Bhili Language Enablement — Project Astitva |
| **Sector** | Government / Tribal Language AI |
| **Geography** | Nandurbar, Maharashtra, India; language community spans Maharashtra, Gujarat, Rajasthan, and Madhya Pradesh |
| **Population served** | Dehwali Bhili speakers — tribal community members including farmers, ASHA frontline health workers, low-literacy elders, and women with no prior access to government digital services in their mother tongue |
| **Stage reached** | Pilot |
| **Contributing organisation** | EkStep Foundation |
| **Key dates** | Active as of August 2026; adoption package published August 31, 2026 |
| **Summary** | EkStep Foundation's Project Astitva brought Dehwali Bhili, a tribal language with no standard script, onto India's language AI infrastructure in Nandurbar district. The work spans community data collection, ASR/NMT/TTS model building, open hosting on Bhashini, and integration into a live government service, with a replication handbook and open-licensed dataset and model designed to be picked up by any Indian state, district, or institution with local administrative backing. |
| **Scale / impact achieved** | First keyword-spotting model live within weeks of data collection starting; a government department queries a real service (crop advisory) by voice in Bhili and receives a voice response in Bhili; dataset and model released to open commons under CC BY 4.0. As-of date: August 2026. |
| **Cost anchor** | ₹84 lakh – ₹1 crore for foundation-building (NMT + ASR + TTS + transcription/review + 20% contingency) for a language with a speaker base in the 10–20 lakh range and no prior digital resources. This covers dataset and model only; post-deployment maintenance and domain-specific fine-tuning for additional use cases are separate and additional costs. As-of date: August 2026. |
| **Build effort** | Approximately 9 months of active data collection effort under normal conditions, drawn directly from the Nandurbar experience (language survey 1–2 months, standards creation 1–2 months, pilot collection 1 month, full collection 6–9 months). Model fine-tuning runs in parallel at approximately one week per cycle; application integration is a one-time effort of two weeks to one month after the first model-building cycle. Champion personal time: 10–12 hours/week in weeks 1–4, then 5–6 hours/week. |
| **Known downstream adopters** | Mission BAANI (Assam) is the closest parallel initiative associated with EkStep Foundation. The adoption package is explicitly designed for replication by any Indian state, district, university, or NGO with local administrative backing. No further named downstream deployments documented in the source as of August 2026. |
| **Scope — transfers when** | A local administrative champion (District Collector or equivalent) is personally committed; a deployment use case is identified before data collection begins; technical partners (AI4Bharat or equivalent), a data collection agency (Karya or equivalent), and a model hosting platform (Bhashini or State DC) are named and engaged; the language has a speaker base large enough to recruit a contributor pool across required age, gender, dialect, and speech-style diversity. |
| **Does not transfer when** | No institutional anchor exists that will outlast a single official's tenure; the deployment use case is undefined at the point data collection begins; community trust has not been established before contracting begins; script and dialect decisions are unresolved with no named owner. |

---

## Section 2 — Coverage Grid and Gaps

### Coverage map

| | Explore | Define | Pilot | Scale |
|---|---|---|---|---|
| **Persona** | ●● | ●● | ○ | ○ |
| **Solution** | ●●● | ●●● | ●● | ○ |
| **Institution** | ●● | ●●● | ●● | ●● |
| **Ecosystem** | ● | ●●● | ●● | ●● |

●●● = dense · ●● = partial · ● = thin · ○ = not yet documented

### Gaps

**1. Persona × Pilot — Which user interactions are failing, and is it scope or quality?**
The source documents seven institutional failure patterns in detail (Unit 8), but does not separately document which categories of user interaction failed during live testing — whether the model was being asked things outside its mandate or was answering within-mandate questions poorly. This distinction drives different fixes and is not yet resolved in the source. Related to Units 6 and 8.

**2. Persona × Scale — Are new user segments arriving that the pilot was not designed for?**
The source defines the target population at Explore and Define stages (farmers, ASHA workers, low-literacy elders, women) but does not document what happens when the deployed service reaches speakers of adjacent dialects, different age groups, or users in geographies beyond Nandurbar. The condition tag on Unit 1 (voice as the only channel) holds for the defined population; whether it holds for a broader rollout is not yet documented.

**3. Solution × Scale — Which components are being unbundled, and which data sources are breaking under scale?**
The source describes the architecture at Define stage in detail (Unit 5) and notes that a shared foundation model covers common use cases while each deploying department funds its own domain-specific fine-tuning (Unit 5). Whether specific components have been unbundled in practice at scale, and which data sources have required formal SLAs as usage grows, is not yet documented.

**4. Ecosystem × Explore — Who else has tried this, and what transferred?**
MahaVISTAAR and Mission BAANI are named as precedents, but the source does not document in detail what specifically transferred from those deployments to Project Astitva and what had to be rebuilt locally. Related to Unit 11.

**5. Institution × Scale — Has the institution absorbed this beyond the champion?**
The source defines what must exist for the service to survive the champion's departure (departmental order, open licensing, replication handbook — Units 10 and 13), but does not yet document whether these mechanisms have been tested in practice. The question of who maintains the model and SDK after the project's active phase is flagged as open in the source itself. Related to Units 10 and 13.

---

## Section 3 — Micro-Innovations

---

### Persona

**1. Voice as the only channel that works — the inclusion argument, not the technology argument**

- **Dimension:** Persona
- **Stage:** Explore
- **Type:** Strategic Decision
- **Decision:** Frame the voice AI channel choice as a basic inclusion requirement rather than a technology preference. The channel is voice because the excluded users cannot read, cannot type, and have no familiarity with administrative-language interfaces — not because voice is more capable.
- **Alternative considered:** Text-based interfaces, app-based interfaces, assisted digital access.
- **Why:** Field evidence from Nandurbar showed that people do not type in Dehwali Bhili, many cannot read the dominant script, and a text-based interface would have missed the population entirely. Voice was the only channel that reached them — including women, who are frequently among the least comfortable in the administrative language and, in the same field account, among the most linguistically precise speakers of their own.
- **What this looked like here:** The framing "village life happens in Bhili, government camps run in Marathi" became the anchor for every subsequent channel and UX decision. The deployment use case (an agricultural IVR / crop advisory line) was chosen because it is a voice channel the target population already has some relationship with.
- **Condition — applies when:** The target population is low-literacy, non-dominant-script speakers who interact with government services only through intermediaries or not at all; the gap being closed is access, not convenience.

---

**2. Defining the excluded user precisely before building anything**

- **Dimension:** Persona
- **Stage:** Define
- **Type:** Strategic Decision
- **Decision:** Name three specific user personas — the farmer who cannot describe her problem in the administrative language, the ASHA frontline health worker who must explain protocols across a language gap, and the low-literacy elder (often a woman) who has never filed a grievance — before any data collection or model design begins.
- **Alternative considered:** A generic "tribal language speaker" framing that collapses the population into a single type.
- **Why:** Each persona has a different failure mode and a different threshold for what "working" means. The farmer's failure is wrong or no advisory; the health worker's failure is mistranslation with real consequences; the elder's failure is permanent invisibility. Collapsing these into one persona would have produced a service optimised for none of them.
- **What this looked like here:** The three personas appear at the opening of the adoption package and directly shaped the choice of deployment use case (agricultural advisory) and the domain split in data collection (generic 70%, domain-specific 30%).
- **Condition — applies when:** The excluded population is not homogeneous — it includes users whose stakes and failure modes differ, even though their shared barrier is linguistic exclusion.

---

### Solution

**3. Keyword-spotting first — a first tangible result before full ASR is ready**

- **Dimension:** Solution
- **Stage:** Explore
- **Type:** Strategic Decision
- **Decision:** Build and deploy a keyword-spotting model as the first live product — recognising 20–30 high-priority spoken terms (health service names, scheme names, crop names, emergency phrases) — rather than waiting for full automatic speech recognition capability before showing the community any working result.
- **Alternative considered:** Waiting until full ASR was trained and validated before deploying anything to a live service.
- **Why:** A keyword-spotting model requires roughly 200–500 recorded examples per keyword — far less than a full ASR system — and can go live within weeks of data collection starting, well before the full 6–9 month collection window closes. It provides the first tangible product a community sees, which is the strongest available motivator for continued contributor participation and institutional confidence. Early tribal language models typically achieve WER 30–50% on open-ended transcription — useful for keyword spotting and simple commands, but not yet suitable for full speech recognition — meaning keyword spotting is not a shortcut but a genuine first-stage capability.
- **What this looked like here:** In Nandurbar, the first keyword-spotting model went live within weeks of data collection starting. At 3 months, this was the documented milestone: a narrow but real first result, ahead of full ASR capability. The 6-month milestone was a government department querying a real crop advisory service by voice in Bhili and receiving a voice response; the 12-month milestone was the full dataset and model publicly available on AIkosh and Bhashini.
- **Condition — applies when:** The language has zero prior digital resources and the full ASR pipeline will take 6–9 months; community and institutional confidence need an early, visible proof point to sustain momentum through a long collection cycle.

---

**4. The 9-month data collection timeline — a field-grounded estimate, not a generic one**

- **Dimension:** Solution
- **Stage:** Explore
- **Also relevant at:** Define, Pilot
- **Type:** Tactical Decision
- **Decision:** Plan for approximately 9 months of active data collection effort under normal conditions, broken into four sequential steps with known durations and documented common delays at each — and treat this as a field-grounded estimate from Nandurbar, not a generic planning assumption.
- **Alternative considered:** Treating data collection as a single undifferentiated block of effort with a single completion date.
- **Why:** Each step has a different bottleneck and a different delay profile. Compressing the steps or treating them as parallel when they are sequential produces schedule failures that force expensive re-collection. Running data collection in 2–3 tranches after initial testing — rather than a single tranche — reveals gaps early enough to address them without rebuilding the whole pipeline.
- **What this looked like here:** The four steps from the Nandurbar experience: (1) Language survey — 1–2 months; common delay: script disputes. (2) Standards creation — 1–2 months; common delay: institutional sign-off delays. (3) Pilot collection — 1 month; common delay: community trust-building takes longer than planned. (4) Full collection — 6–9 months; common delays: validator availability, contributor dropout, quality failures requiring re-collection. Total: 9+ months under normal conditions. Model fine-tuning (approximately one week per cycle) and application integration (one-time, two weeks to one month) run in parallel with collection rather than after it.
- **Condition — applies when:** A language with zero prior digital resources and no open-source datasets of production quality; a speaker base in the 10–20 lakh range. Timeline rises as speaker count falls and existing media thins out.
- **Before → After:** Before treating collection as a single block: schedule failures and re-collection costs surface late. After breaking into four steps with known delay profiles: bottlenecks are anticipated, tranches are planned, and the first keyword-spotting model goes live within weeks rather than waiting for the full pipeline.

---

**5. Model-agnostic architecture — building the language capability as a general-purpose foundation, not a single-use deployment**

- **Dimension:** Solution
- **Stage:** Define
- **Also relevant at:** Scale
- **Type:** Strategic Decision
- **Decision:** Build the ASR/NMT/TTS models as general-purpose, reusable language infrastructure — model-agnostic by design — hosted on open, sovereign infrastructure (Bhashini / State Data Centres), so a second department or a different state can build on the same underlying language capability without renegotiating access.
- **Alternative considered:** Building a model locked to the first deployment use case and the first vendor's platform.
- **Why:** If the model is built as a single-use deployment, every subsequent use case requires rebuilding from scratch, and the community's contribution of time and voice data benefits only one application. Open hosting on Bhashini's ULCA repository means the dataset and model outlive any single contract or champion.
- **What this looked like here:** The model is deployed into the agricultural IVR as the first application, but the foundation model is not tuned exclusively to agriculture. Subsequent departments fund and own their own domain-specific fine-tuning on top of the shared foundation — a deliberate split between shared infrastructure and per-use-case investment.
- **Condition — applies when:** Multiple future use cases are foreseeable; the goal is a public language infrastructure good rather than a single departmental tool; sovereign, open hosting is available.

---

**6. Three-metric quality bar — WER, BLEU, and MOS with explicit numeric thresholds**

- **Dimension:** Solution
- **Stage:** Define
- **Also relevant at:** Pilot
- **Type:** Tactical Decision
- **Decision:** Adopt three standard evaluation metrics — WER (ASR accuracy), BLEU (translation quality), MOS (voice naturalness) — with explicit numeric thresholds agreed before model building begins, and track them continuously rather than checking only at sign-off.
- **Alternative considered:** Informal quality judgements by the technical partner without agreed numeric thresholds; checking only at the end of the pipeline.
- **Why:** Without agreed thresholds, "good enough" is renegotiated at the point of sign-off, giving the technical partner or the institution the ability to move the bar to suit the outcome. Tracking continuously means problems surface early, when they can be addressed through targeted re-collection or model adjustment, rather than at the end, when re-collection is expensive.
- **What this looked like here:** WER below 20% = generally usable; below 10% = production-grade. BLEU above 20 = usable for domain-specific content; above 35 = approaches human-level fluency. MOS 3.5 or above = generally acceptable for public service use. Early tribal language models typically achieve WER 30–50% (useful for keyword spotting), BLEU 10–25, and MOS 2.5–3.5 at first iteration — thresholds calibrated to what is achievable, not what is ideal.
- **Condition — applies when:** A technical partner is building models for a government deployment; the government needs a defensible, non-negotiable quality gate that neither the vendor nor the institution can informally override.
- **Before → After:** Before agreed thresholds: quality judgements made at sign-off, with the bar subject to negotiation. After: the technical partner benchmarks against shared standards at every model-building cycle; Quality PMU audits the result; the number is the gate, not the conversation.

---

**7. Two-stage use-case acceptance testing — metrics as supporting evidence, not the deciding factor**

- **Dimension:** Solution
- **Stage:** Pilot
- **Type:** Playbook
- **Playbook:**
  1. Run the three benchmark metrics (WER, BLEU, MOS) to confirm the model is technically sound against the thresholds in Unit 6.
  2. Separately, run a defined batch of real test interactions — approximately 100 test calls to the live IVR service — as use-case acceptance testing.
  3. Have the deploying department's officials and community members judge whether the output was acceptable for their purpose — not the technical partner whose model is being evaluated.
  4. Appoint an independent third party to conduct this acceptance judgement, separate from the vendor.
  5. A passed use-case acceptance test triggers sign-off; benchmark scores are supporting evidence, not the deciding factor.
  6. Do not advance to full deployment until both layers have passed.
- **Note:** The most common failure mode is treating the benchmark metrics as sufficient and skipping the independent use-case acceptance step. A model that passes WER/BLEU/MOS in controlled conditions can still underperform in real-world dialect variation or noise conditions — field testing is a genuine supplement, not a formality.
- **Condition — applies when:** A government service is being handed to a public that includes low-literacy users in variable acoustic environments; the deploying department needs to own the quality judgement, not inherit it from the vendor.
- **Before → After:** Not documented as a before/after for this specific deployment; the documented approach is drawn from the MahaVISTAAR precedent referenced as the clearest working example of this method.

---

### Institution

**8. Seven documented failure patterns — named before they happen**

- **Dimension:** Institution
- **Stage:** Pilot
- **Type:** Tactical Decision
- **Decision:** Document the seven most common failure patterns from field experience and build explicit mitigations for each into the project structure before they are encountered, rather than treating them as surprises to be managed in real time.
- **Alternative considered:** Managing failures reactively as they surface during the project.
- **Why:** Each of the seven patterns has a known mitigation, and the mitigation is far cheaper before the failure than after it. Several (contributor dropout, language expert bottleneck, vendor lock-in) can end or permanently damage a project if not anticipated. The mitigations are structural — they require decisions made at Define or before Pilot, not reactive fixes during Pilot.
- **What this looked like here:** The seven patterns are: (1) Community disengages midway — mitigated by real-time progress visibility and showing contributors the actual product early; hearing a real result in their own language is the strongest motivator available. (2) Contributor selection and training poorly planned — old veterans missed, coordinators deployed across dialects without proper training. (3) Data collected but never deployed — see Unit 12 for the full treatment of this failure and its fix. (4) Language expert bottleneck — distributed validator pool of 5–10 trained people, with documentation thorough enough that any validator can pick up where another left off. (5) Political or administrative change — mandate written into departmental order, not carried in the champion's memory; see Unit 10. (6) Vendor or platform lock-in — open data standards and ULCA-compatible exports from day one; Bhashini's ULCA repository exists specifically to prevent this. (7) Low community adoption — end-users involved in testing before formal launch; often the missing piece is low awareness, requiring a structured programme from the application owner.
- **Condition — applies when:** Any low-resource language AI project; patterns 3, 5, and 6 are especially critical and are not recoverable after the fact without major rework.

---

**9. Champion personally convenes community — institutional weight is not delegable**

- **Dimension:** Institution
- **Stage:** Define
- **Type:** Strategic Decision
- **Decision:** The District Collector or equivalent champion personally convenes the first round of meetings with community leaders, language experts, and tribal welfare associations — not the Nodal Officer or an external partner on the champion's behalf — and does so before any vendor is contracted.
- **Alternative considered:** Delegating community convening to the Nodal Officer or the orchestrating partner from the outset.
- **Why:** The champion's institutional weight is what makes the first meeting land in the way it needs to. A Nodal Officer sending an invitation reads differently from the Collector personally showing up to say this effort is not being done for the community, it is only possible with the community. The community's trust in the project's legitimacy, and their willingness to contribute voice data over a 6–9 month collection cycle, is contingent on that first signal being credible. Budget 3–4 such meetings; keep the first one personal, and give this step the time it needs rather than compressing it under timeline pressure.
- **What this looked like here:** District Collector Mitali Sethi personally convened the community meetings and chaired the language-prioritisation meeting in Nandurbar before any data collection vendor was contracted. A prior tribal posting had given her direct knowledge of what changes when a service speaks someone's own language — the community's trust was earned through that history, not assumed from the title.
- **Condition — applies when:** The community being recruited to contribute voice data has no prior relationship with the institution and has legitimate reason to be sceptical of government-initiated digital projects; the champion's institutional standing is the primary credibility signal available.

---

**10. Mandate in the departmental order — not in the champion's memory**

- **Dimension:** Institution
- **Stage:** Define
- **Also relevant at:** Scale
- **Type:** Strategic Decision
- **Decision:** Write every non-delegable champion action, the review mechanism, the Nodal Officer's post (post-based rather than person-based), and the project's governance structure into a formal departmental order issued in week one — so the project runs on its institutional mandate rather than on any one person's energy or memory.
- **Alternative considered:** Verbal agreements, informal practice, and the assumption that a committed champion will remain in post for the project's duration.
- **Why:** District Collectors transfer. A verbal agreement rarely survives a transfer; a departmental order does. The successor can pick up the project directly from the order without needing to reconstruct the approach from handover conversations. Open licensing of the dataset and model under CC BY 4.0 ensures the work outlives the specific contracts and people who built it. The replication handbook is the third mechanism: a successor can pick up the project directly from the order and the handbook together.
- **What this looked like here:** Three survival mechanisms are named explicitly in the Nandurbar design: the departmental order (covering every item in the champion's non-delegable actions), open release of the dataset and model to the public commons (Bhashini/ULCA, CC BY 4.0), and this published replication handbook. Whether these mechanisms have been tested through an actual champion transfer is not yet documented in the source as of August 2026.
- **Condition — applies when:** Any multi-year government AI project where the champion is a transferable post; this is not optional for a project expected to survive beyond a single official's tenure.

---

**11. The champion's role is a midwife's, not an owner's**

- **Dimension:** Institution
- **Stage:** Scale
- **Also relevant at:** Define, Pilot
- **Type:** Strategic Decision
- **Decision:** Hold the champion's role explicitly as facilitative rather than proprietary — facilitating what needs to be facilitated, then stepping back and becoming redundant to the process, rather than remaining personally indispensable to its day-to-day operation.
- **Alternative considered:** A champion who remains the central decision-maker and bottleneck for the project's operational continuity.
- **Why:** A project still fully dependent on its champion's day-to-day involvement at the point they leave has fallen short of done in any meaningful sense, whatever its technical gate status. Sustainability is itself a condition for completion. The midwife framing — drawn from the recorded Mitali Sethi interview — names this precisely: the goal is to deliver something that lives independently, not to remain the person without whom it cannot function.
- **What this looked like here:** The Nandurbar design builds this in structurally: the departmental order, the post-based (not person-based) Nodal Officer appointment, the open licensing, and the published handbook are all mechanisms by which the champion makes themselves redundant to the process rather than indispensable to it. The framing is attributed directly to Mitali Sethi.
- **Condition — applies when:** Any government AI project where the champion is a transferable post and the service is expected to outlast their tenure; applies from the moment the project is designed, not only at the point of handover.
- **Before → After:** Before this framing is held explicitly: a departing champion creates a gap the institution cannot fill without rebuilding relationships and re-establishing credibility. After: the mandate, the team structure, the open assets, and the handbook carry the project forward without the individual.

---

### Ecosystem

**12. Data collected but never deployed — identifying the deployment owner before collection begins**

- **Dimension:** Ecosystem
- **Stage:** Define
- **Also relevant at:** Explore
- **Type:** Failure and Fix
- **Failure:** Models get trained but no government system integrates them, because the deployment platform was never engaged as a partner from the start, or was not ready to be tested when the models were built. The data collection investment is complete; the last mile — the live service the community was promised — never arrives.
- **Fix:** Make the identification of a committed deployment application a non-negotiable readiness gate before any data collection begins. The Core Application Owner (e.g., State Agriculture Department / POCRA-MahaVISTAAR application) must be in the room — and must have committed — before a data collection vendor is contracted. Contracting collection first and looking for a deployment owner later is the documented failure sequence this gate exists to prevent.
- **Insight:** The failure is not technical — the model works. The failure is that the institution that was supposed to deploy it was never part of the design. Community trust, contributor effort, and public funds are all spent; the benefit never reaches the people it was built for. This is recoverable only with a full re-engagement of the deployment partner, which often cannot be done on the original timeline or budget.
- **Condition — applies when:** Any multi-stakeholder language AI project with a community data collection phase; the failure mode is especially acute when the deploying department is distinct from the institution funding the data collection effort, since their commitment cannot be assumed from the funder's commitment.

---

**13. Eight named ecosystem roles — convening sequence matters as much as the roles themselves**

- **Dimension:** Ecosystem
- **Stage:** Define
- **Type:** Strategic Decision
- **Decision:** Name all eight ecosystem roles before any data collection vendor is contracted, and follow a specific convening sequence: community leadership and the Core Application Owner must be in the room before the Data Collection Agency is engaged.
- **Alternative considered:** Contracting a data collection agency first, then identifying a deployment owner once data collection is underway or complete.
- **Why:** Contracting collection first and looking for a deployment owner later is the documented failure sequence in Unit 12. Community leadership in the room before a vendor is contracted changes the nature of the community's relationship to the project: they are participants in the design, not subjects of a data extraction exercise.
- **What this looked like here:** The eight roles are: Steering Committee; Project Management Unit (split into Management and Quality arms, kept independent); District/Local Administration; District-Level Line Departments; Core Application Owner (e.g., State Agriculture Department / POCRA-MahaVISTAAR); Ecosystem Orchestrator (e.g., EkStep Foundation-equivalent); Linguistic Experts; Community Contributors and Local Community Leaders. Data Collection Agency, Model Builder (AI4Bharat), and Model Hoster (Bhashini) are all external vendors contracted in after these roles are in place.
- **Condition — applies when:** Any multi-stakeholder language AI project with a community data collection phase; the failure mode of collecting data without a committed deployment owner is not recoverable without major re-investment.

---

**14. Two-layer independent validation — the collection agency does not grade its own work**

- **Dimension:** Ecosystem
- **Stage:** Pilot
- **Also relevant at:** Define
- **Type:** Playbook
- **Playbook:**
  1. Layer 1: The data collection agency conducts its own first-pass validation, built into its scope of work as a contractual requirement.
  2. Layer 2: An independent Super Reviewer (e.g., university linguist, State Tribal Research Institute, or credentialed expert) is appointed by the government on a contract separate from the collection agency's — contractually separated so no single party grades its own work.
  3. Data moves through a defined chain with escalation logic at each handoff: Audio Contributor → Transcriber → Validator → Super Reviewer (for speech data); Translator → Validator → Super Reviewer (for translation data).
  4. A Validator's rejection routes back to the Transcriber/Translator with specific correction guidance, not a bare pass/fail flag.
  5. The Super Reviewer's audit feeds systemic error patterns back into the Transcriber/Translator's ongoing calibration — addressing the pattern, not just the individual item.
  6. One central programme office sets the transcription guidelines, metadata schema, and quality bar, applied uniformly across every field team.
- **Note:** The most common failure mode is allowing the collection agency to set and apply its own quality standard informally — the two-layer structure exists specifically to close that gap. Quality checks batched only at the end of the pipeline force expensive re-collection; embedding review throughout makes catching a problem affordable.
- **Condition — applies when:** Any language data collection project where the collection agency's financial incentive is tied to volume rather than quality; government deployment where the dataset will be released to the open commons and must be defensible to future users.

---

**15. Open commons release as an ecosystem infrastructure decision, not an afterthought**

- **Dimension:** Ecosystem
- **Stage:** Scale
- **Also relevant at:** Define
- **Type:** Strategic Decision
- **Decision:** Treat the release of the dataset and model to the open commons (Bhashini/ULCA, CC BY 4.0 or equivalent) as a formal, planned step in the project's sign-off process — not an informal afterthought once the work is done.
- **Alternative considered:** Releasing informally, or leaving the dataset and model within a single vendor's or department's platform without open licensing.
- **Why:** Open hosting on Bhashini's ULCA repository is what allows a second department, or a different state, to build on the same underlying language capability without renegotiating access. Closed hosting means every subsequent adopter rebuilds from scratch. The open release is also the primary mechanism by which the community's contribution of time and voice data generates value beyond the first deployment.
- **What this looked like here:** Open release under CC BY 4.0 is named as a formal sign-off gate rather than a post-project step. The adoption package itself is also released under CC BY 4.0, as the replication handbook for the next adopter.
- **Condition — applies when:** The language capability is intended to serve as public infrastructure for multiple future use cases and deployers; the community's data contribution should generate ongoing public value rather than being locked to a single contract.

---

## Section 4 — Toolkits and Playbooks

| Unit | Title | Type | Reuse condition |
|---|---|---|---|
| 7 | Two-stage use-case acceptance testing | Playbook | Use when a government service is being handed to a public that includes low-literacy users in variable acoustic environments; the deploying department must own the quality judgement independently of the vendor |
| 14 | Two-layer independent validation | Playbook | Use when the data collection agency's incentive is tied to volume; essential for any dataset intended for open commons release |
| 4 | The 9-month data collection timeline | Tactical Decision | Use as a field-grounded planning estimate for a language with zero prior digital resources; break into four steps with known delay profiles rather than treating as a single block |
| 6 | WER / BLEU / MOS quality thresholds | Tactical Decision | Use as the numeric quality gate when commissioning ASR/NMT/TTS models from a technical partner; thresholds are calibrated to what is achievable for tribal/low-resource languages, not what is ideal for scheduled languages |
| 8 | Seven documented failure patterns | Tactical Decision | Use at Define stage before Pilot begins; patterns 3 (data collected but never deployed), 5 (political change), and 6 (vendor lock-in) are not recoverable after the fact |
| 10 | Mandate in the departmental order | Strategic Decision | Use in any multi-year government AI project where the champion is a transferable post; issue in week one, not at the end of the project |

---

## Section 6 — Retrieval Guide

*"How do I make sure the community actually shows up to contribute voice data?"* → Unit 3 (keyword-spotting first as early proof), Unit 8 (failure pattern 1: community disengages midway), Unit 9 (champion personally convenes community)

*"What quality bar should I set for the model before deploying it?"* → Unit 6 (WER/BLEU/MOS thresholds), Unit 7 (use-case acceptance testing as the deciding layer above metrics)

*"Who needs to be in the room before we start?"* → Unit 13 (eight named ecosystem roles and convening sequence), Unit 9 (champion personally convenes community before any vendor is contracted)

*"How do I stop the data collection agency from grading its own work?"* → Unit 14 (two-layer independent validation playbook)

*"What happens if the District Collector transfers mid-project?"* → Unit 10 (mandate in the departmental order), Unit 11 (midwife framing — becoming redundant to the process by design), Unit 8 (failure pattern 5: political or administrative change)

*"We've collected data but no government department will integrate the model — what now?"* → Unit 12 (data collected but never deployed — failure and fix), Unit 13 (convening sequence: deployment owner must be in the room before data collection starts)

*"How do I avoid the model being locked to one vendor's platform?"* → Unit 5 (model-agnostic architecture on open hosting), Unit 15 (open commons release as a formal sign-off gate), Unit 8 (failure pattern 6: vendor or platform lock-in)

*"What's the realistic cost and timeline for a language with no prior digital resources?"* → Section 1 (cost anchor: ₹84 lakh – ₹1 crore; build effort: 9 months data collection), Unit 4 (step-by-step breakdown with common delays from Nandurbar), Unit 3 (first keyword-spotting model live within weeks of starting)

*"How much of my time will this actually take?"* → Section 1 (build effort: 10–12 hours/week for champion in weeks 1–4, then 5–6 hours/week), Unit 9 (what falls to the champion personally vs. the Nodal Officer)

*"How do I make sure a successor can pick this up after I leave?"* → Unit 10 (departmental order + open licensing + replication handbook as the three survival mechanisms), Unit 11 (midwife framing — the goal is to become redundant to the process)

*"Why voice and not an app or text interface?"* → Unit 1 (voice as the only channel