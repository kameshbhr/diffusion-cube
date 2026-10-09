---
title: Bhili Language Enablement — Project Astitva
description: A collaborative ecosystem effort that brought Dehwali Bhili, a tribal language with no standard script, onto India's language AI infrastructure in Nandurbar district, producing an open-licensed model, dataset, and replication handbook designed for the next adopter.
stage: Pilot
sector: Government / Tribal Language AI
location: Nandurbar, Maharashtra, India
tags: [Tribal Language, Voice AI, Low-Resource Language, Government Services]
---

---

## Section 0 — Reading Guide

This document records what was learned bringing language AI to Dehwali Bhili speakers in Nandurbar, Maharashtra — a collaborative effort spanning the District Administration of Nandurbar, AI4Bharat, Karya, Bhashini, community contributors, language experts, and an orchestrating partner. It is written for the next adopter — a District Collector, a program lead, a state official — who is about to take on a similar effort and needs to know what decisions were made, why they were made, and under what conditions they hold.

The pathway is organised across four dimensions: who the excluded user is and what they need (Persona); what was built and how (Solution); what the institution had to do to own it (Institution); and what the wider ecosystem of partners, platforms, and data owners had to hold together (Ecosystem). Within each dimension, knowledge is tagged to the stage at which it was discovered — Explore, Define, Pilot, or Scale — so you can navigate to what is most relevant to where you are now.

Where knowledge is dense, the units are precise: real thresholds, real failure patterns, real sequencing from Nandurbar. Where knowledge is thin — particularly at Pilot and Scale — the gaps are named directly. A thin cell is not a missing section; it is an honest signal about what this deployment has not yet resolved, and what the next adopter will need to work out for themselves or contribute back.

The micro-innovations in Section 3 are the core reusable content. Each is a decision, a failure, or a playbook step that a different district or institution can lift and apply — tagged with the condition under which it holds and the condition under which it fails. Start there if you are already committed and need to know what to watch for. The journey model this pathway is built from covers 45 steps across four stages (Explore 10, Define 13, Pilot 11, Scale 11); the units here surface the decisions and failures with the highest transferable value.

---

## Section 1 — Pathway Identity

| Field | Detail |
|---|---|
| **Deployment name** | Bhili Language Enablement — Project Astitva |
| **Sector** | Government / Tribal Language AI |
| **Geography** | Nandurbar, Maharashtra, India; language community spans Maharashtra, Gujarat, Rajasthan, and Madhya Pradesh |
| **Population served** | Dehwali Bhili speakers — tribal community members including farmers, ASHA frontline health workers, low-literacy elders, and women with no prior access to government digital services in their mother tongue |
| **Stage reached** | Pilot |
| **Contributing organisation** | EkStep Foundation (pathway contributor); project partners include the District Administration of Nandurbar, AI4Bharat (IIT Madras), Karya, Bhashini / Digital India NLTM, State Tribal Research Institutes, community contributors, and language experts |
| **Key dates** | Active as of August 2026; adoption package published August 31, 2026 |
| **Summary** | Project Astitva is a collaborative ecosystem effort that brought Dehwali Bhili, a tribal language with no standard script, onto India's language AI infrastructure in Nandurbar district. The work spans community data collection, ASR/NMT/TTS model building, open hosting on Bhashini, and integration into a live government service. Partners include the District Administration of Nandurbar, AI4Bharat, Karya, Bhashini, State Tribal Research Institutes, and community contributors. The project produced an open-licensed dataset and model and a replication handbook designed to be picked up by any Indian state, district, or institution with local administrative backing. EkStep Foundation contributed this pathway document. |
| **Scale / impact achieved** | First keyword-spotting model live within weeks of data collection starting; a government department queries a real service (crop advisory) by voice in Bhili and receives a voice response in Bhili; dataset and model released to open commons under CC BY 4.0. As-of date: August 2026. |
| **Cost anchor** | ₹84 lakh – ₹1 crore for foundation-building (NMT + ASR + TTS + transcription/review + 20% contingency) for a language with a speaker base in the 10–20 lakh range and no prior digital resources. Estimate by component: translation pairs at ₹18–25 each (~₹40 lakh for 200,000 pairs); read and conversational/telephony speech at ₹1,500–2,500/hour; transcription and review at ₹110–150/minute (~₹20 lakh for 300 hours); studio TTS at ₹15,000–20,000/studio hour (~₹4 lakh for 20 hours). Add 20% contingency (~₹14 lakh). Budget separately for super reviewer compensation, government officers contributing outside office hours, and post-deployment maintenance — all excluded from this estimate. Note: a cost inconsistency exists in the source — the component table sums to approximately ₹91 lakh while a separate reference implies a higher figure; the component table is the more grounded of the two. Cost rises as speaker base falls; falls where existing media and open datasets are available. As-of date: August 2026. |
| **Build effort** | Approximately 9 months of active data collection effort under normal conditions, drawn directly from the Nandurbar experience: language survey 1–2 months, standards creation 1–2 months, pilot collection 1 month, full collection 6–9 months. Note: the source states foundation-building as "6–9 months of active effort" in one place and data collection alone as "9+ months" in another — the step-by-step breakdown is the more grounded figure. Model fine-tuning runs in parallel at approximately one week per cycle; application integration is a one-time effort of two weeks to one month after the first model-building cycle. Champion personal time: 10–12 hours/week in weeks 1–4, then 5–6 hours/week. |
| **Known downstream adopters** | Mission BAANI (Assam) is the closest parallel initiative. The adoption package is explicitly designed for replication by any Indian state, district, university, or NGO with local administrative backing. No further named downstream deployments documented in the source as of August 2026. |
| **Scope — transfers when** | A local administrative champion (District Collector or equivalent) is personally committed; a deployment use case is identified before data collection begins; technical partners (AI4Bharat or equivalent), a data collection agency (Karya or equivalent), and a model hosting platform (Bhashini or State DC) are named and engaged; the language has a speaker base large enough to recruit a contributor pool across required age, gender, dialect, and speech-style diversity. |
| **Does not transfer when** | No institutional anchor exists that will outlast a single official's tenure; the deployment use case is undefined at the point data collection begins; community trust has not been established before contracting begins; script and dialect decisions are unresolved with no named owner. |

---

## Section 2 — Coverage Grid and Gaps

### Coverage map

| | Explore | Define | Pilot | Scale |
|---|---|---|---|---|
| **Persona** | ●●● | ●●● | ● | ○ |
| **Solution** | ●●● | ●●● | ●●● | ●●● |
| **Institution** | ●●● | ●●● | ●● | ●●● |
| **Ecosystem** | ●● | ●●● | ●●● | ●●● |

●●● = dense · ●● = partial · ● = thin · ○ = not yet documented

### Gaps

**1. Persona × Pilot — Which user interactions are failing, and is it scope or quality?**
The journey model documents field testing (Unit 12) and the seven failure patterns (Unit 15), but does not separately record which categories of user interaction failed during live testing — whether the model was being asked things outside its mandate or answering within-mandate questions poorly. This distinction drives different fixes. Related to Units 12 and 15.

**2. Persona × Scale — Are new user segments arriving that the pilot was not designed for?**
The source defines the target population at Explore and Define stages but does not document what happens when the deployed service reaches speakers of adjacent dialects, different age groups, or users in geographies beyond Nandurbar. Whether the voice-only channel design (Unit 1) holds for a broader rollout is not yet documented.

**3. Open question — consent scope for open release**
Whether contributors' consent covers open release of their recordings under CC BY 4.0 is unresolved in the source. This needs to be resolved before release, not after. Related to Unit 8.

**4. Open question — shared foundation model upkeep post sign-off**
Who maintains and funds the shared foundation model after sign-off is not specified. The application owner is responsible for its own domain fine-tuning; the shared layer has no named maintainer. Related to Unit 20.

**5. Open question — what documentation travels with the released model**
The source does not specify what documentation should accompany the released model — coverage by dialect and speaker group, scores by group, known weaknesses. This is flagged as open in the source itself. Related to Unit 20.

**6. Open question — cost figure inconsistency**
The component-level table in Section 1 sums to approximately ₹91 lakh; a separate reference in the source implies a higher mid-point figure. These have not been reconciled. The component table is the more grounded figure and should be used as the planning anchor until reconciliation happens.

**7. Open question — duration inconsistency**
The source states foundation-building as "6–9 months of active effort" in one place and data collection alone as "9+ months" in another. The step-by-step breakdown in Unit 6 is the more grounded figure; the higher-level statement should not be used as a standalone planning reference.

**8. Open question — definition of "two complete feedback cycles"**
Whether the completion threshold (Unit 14) means two passes through the application integration and feedback gate, or two full collection-to-deployment loops, is raised as open by the source itself.

**9. Open question — handover instrument for incoming officer**
Whether a formal handover instrument for an incoming officer exists beyond the departmental order, the open release, and the handbook is not documented. Related to Unit 16.

**10. Ecosystem × Explore — who else has tried this, and what transferred**
MahaVISTAAR and Mission BAANI are named as reference implementations, but what specifically transferred to Project Astitva and what had to be rebuilt locally is not documented in detail.

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
- **Why:** Field evidence from Nandurbar showed that people do not type in Dehwali Bhili, many cannot read the dominant script, and a text-based interface would have missed the population entirely. Voice was the only channel that reached them — including women, who are frequently among the least comfortable in the administrative language and, in the same field account, among the most linguistically precise speakers of their own. Even experienced officials switch to the local language to hear a whole problem.
- **What this looked like here:** The framing "village life happens in Bhili, government camps run in Marathi" became the anchor for every subsequent channel and UX decision in the Nandurbar collaboration. The deployment use case (an agricultural IVR / crop advisory line) was chosen because it is a voice channel the target population already has some relationship with.
- **Condition — applies when:** The target population is low-literacy, non-dominant-script speakers who interact with government services only through intermediaries or not at all; the gap being closed is access, not convenience.

---

**2. Defining the excluded user precisely before building anything**

- **Dimension:** Persona
- **Stage:** Explore
- **Type:** Strategic Decision
- **Decision:** Name three specific user personas — the farmer who cannot describe her problem in the administrative language, the ASHA frontline health worker who must explain protocols across a language gap, and the low-literacy elder (often a woman) who has never filed a grievance — before any data collection or model design begins.
- **Alternative considered:** A generic "tribal language speaker" framing that collapses the population into a single type.
- **Why:** Each persona has a different failure mode and a different threshold for what "working" means. The farmer's failure is wrong or no advisory; the health worker's failure is mistranslation with real consequences; the elder's failure is permanent invisibility. Collapsing these into one persona produces a service optimised for none of them.
- **What this looked like here:** The three personas directly shaped the Nandurbar ecosystem's choice of deployment use case (agricultural advisory) and the domain split in data collection (generic 70%, domain-specific 30%).
- **Condition — applies when:** The excluded population is not homogeneous — it includes users whose stakes and failure modes differ, even though their shared barrier is linguistic exclusion.

---

**3. Committing the output tier before building begins**

- **Dimension:** Persona
- **Stage:** Explore
- **Also relevant at:** Define
- **Type:** Strategic Decision
- **Decision:** State the target output tier at the start — dataset only, dataset and model, live deployment, or signed off and open — and tie it to a time-bound milestone sequence before any collection or contracting begins.
- **Alternative considered:** Leaving the tier implicit and allowing it to be renegotiated as the project progresses.
- **Why:** A finished dataset and a deployable model are different milestones; treating them as one creates unrealistic expectations for funders and government partners, and makes it impossible to hold anyone accountable to a clear completion standard.
- **What this looked like here:** The four tiers from the Nandurbar journey: (1) Dataset only — end of data collection. (2) Dataset and model — ASR/NMT/TTS trained and benchmarked. (3) Live deployment — integrated into a real government service with a feedback loop running. (4) Signed off and open — formally signed off, dataset and model released to the open commons. Time-bound: a first keyword-spotting model in a pilot service at around 3 months; a department querying a real service by voice at around 6 months; open release and a wider public service at around 12 months.
- **Condition — applies when:** Any project involving both a funder and a government deployment partner; the tier decision is the shared contract between them.

---

**4. Planning contributor selection to reach elders — not just the easiest pool to find**

- **Dimension:** Persona
- **Stage:** Define
- **Type:** Strategic Decision
- **Decision:** Plan explicitly for elders in the contributor pool before recruitment begins, because collection platforms favour whoever is easiest to find and train, and elders — who carry the purest spoken form of the language — are easily missed when technology-mediated collection processes are used.
- **Alternative considered:** Recruiting contributors from whoever is most accessible and digitally familiar, and adjusting for gaps retrospectively.
- **Why:** Livelihood and direct recognition motivate contributor participation far more than a preservation pitch. But the authenticity of what is collected depends on who is in the pool. A pool skewed toward younger, more digitally literate contributors produces data that underrepresents the language as elders speak it — and the model's performance for elderly users will reflect that gap.
- **What this looked like here:** The Nandurbar ecosystem named contributor roles explicitly: audio contributors; voice artists for studio recording (community radio stations, where they exist, are a named source); annotators, transcribers, and translators; a linguistic expert; validators; and a super reviewer. Elders are named as a group to plan for explicitly alongside the others. Validators are brought in when collection formally begins, not before. Build a distributed pool of at least 5–10 trained validators, documented well enough that any one can pick up another's work — losing even one briefly can stall the project.
- **Condition — applies when:** The language's most authentic spoken form is held by elderly speakers who are unlikely to self-select into a technology-mediated collection process.

---

### Solution

**5. Keyword-spotting first — a first tangible result before full ASR is ready**

- **Dimension:** Solution
- **Stage:** Explore
- **Type:** Strategic Decision
- **Decision:** Build and deploy a keyword-spotting model as the first live product — recognising 20–30 high-priority spoken terms (health service names, scheme names, crop names, emergency phrases) — rather than waiting for full automatic speech recognition capability before showing the community any working result.
- **Alternative considered:** Waiting until full ASR was trained and validated before deploying anything to a live service.
- **Why:** A keyword-spotting model requires roughly 200–500 recorded examples per keyword — far less than a full ASR system — and can go live within weeks of data collection starting, well before the full 6–9 month collection window closes. It provides the first tangible product a community sees, which is the strongest available motivator for continued contributor participation and institutional confidence. Early tribal language models typically achieve WER 30–50% on open-ended transcription — keyword spotting is not a shortcut but a genuine first-stage capability.
- **What this looked like here:** In Nandurbar, the first keyword-spotting model — built by AI4Bharat on data collected by Karya — went live within weeks of data collection starting. At 3 months this was the documented milestone: a narrow but real first result, ahead of full ASR capability. The 6-month milestone was a government department querying a real crop advisory service by voice in Bhili and receiving a voice response; the 12-month milestone was the full dataset and model publicly available on AIkosh and Bhashini.
- **Condition — applies when:** The language has zero prior digital resources and the full ASR pipeline will take 6–9 months; community and institutional confidence need an early, visible proof point to sustain momentum through a long collection cycle.

---

**6. The 9-month data collection timeline — a field-grounded estimate from Nandurbar, not a generic one**

- **Dimension:** Solution
- **Stage:** Explore
- **Also relevant at:** Define, Pilot
- **Type:** Tactical Decision
- **Decision:** Plan for approximately 9 months of active data collection effort under normal conditions, broken into four sequential steps with known durations and documented common delays at each — and treat this as a field-grounded estimate from Nandurbar, not a generic planning assumption. Run collection in 2–3 tranches rather than a single block, with a model update and testing round after each tranche.
- **Alternative considered:** Treating data collection as a single undifferentiated block of effort with a single completion date.
- **Why:** Each step has a different bottleneck and a different delay profile. Compressing the steps or treating them as parallel when they are sequential produces schedule failures that force expensive re-collection. Tranches reveal surprises and unaccounted gaps while there is still time to correct them — quality failures found after a single full-volume tranche are far more expensive to fix than those caught after a smaller early tranche.
- **What this looked like here:** The four steps from the Nandurbar experience, with Karya leading field collection and AI4Bharat leading model building: (1) Language survey — 1–2 months; common delay: script disputes. (2) Standards creation — 1–2 months; common delay: institutional sign-off delays. (3) Pilot collection — 1 month; common delay: community trust-building takes longer than planned. (4) Full collection — 6–9 months in 2–3 tranches; common delays: validator availability, contributor dropout, quality failures requiring re-collection. Total: 9+ months under normal conditions. After every tranche, the ASR/TTS model is updated and tested before the next tranche begins. Model fine-tuning (approximately one week per cycle) and application integration (one-time, two weeks to one month) run in parallel with collection rather than after it.
- **Condition — applies when:** A language with zero prior digital resources and no open-source datasets of production quality; a speaker base in the 10–20 lakh range. Timeline rises as speaker count falls and existing media thins out.
- **Before → After:** Before treating collection as a single block: schedule failures and re-collection costs surface late. After breaking into four steps with tranches: bottlenecks are anticipated, gaps are caught early, and the first keyword-spotting model goes live within weeks rather than waiting for the full pipeline.

---

**7. Dataset specification — who to collect from and in what proportion**

- **Dimension:** Solution
- **Stage:** Define
- **Type:** Tactical Decision
- **Decision:** Specify the dataset by volume tier and by contributor mix before collection begins, and treat the mix as non-negotiable rather than adjusting it for convenience once collection starts.
- **Alternative considered:** Collecting from whoever is available and adjusting the mix retrospectively.
- **Why:** What the model can do depends on whose speech it hears. A pool skewed toward one age group, gender, or speech style produces a model that underperforms for the groups not represented. A production-ready system needs far more than a first model; a realistic starting point lies between the must-have and good-to-have tiers.
- **What this looked like here:** Volume tiers drawn from the AI4Bharat DMU framework and applied in Nandurbar:

| Data type | Must have | Good to have | Great to have |
|---|---|---|---|
| Speech | 100 hrs | 500 hrs | 1,000+ hrs |
| Studio speech | 10 hrs | 40 hrs | 80+ hrs |
| Text images (OCR) | 10K pages | 50K pages | 100K+ pages |
| Translation pairs | 100K | 500K | 1M+ |
| Text corpus | 5–10B tokens | 25–30B tokens | 50B+ tokens |
| Dictionary entries | 20K | 50K | 100K |

Contributor mix: ages 6–18 at 20%, 18–45 at 40%, 45–60 at 30%, 60+ at 10%; read speech 10%, spontaneous 45% (speaking freely on a topic, e.g. describing a picture), conversational 45% (two-way with a purpose, e.g. calling an agriculture officer to report crop damage); generic domain 70%, specialist domain 30% (health, agriculture, governance, education); half of audio by telephony channel; equal by gender. A language with zero prior digital resources needs a practical minimum of about 300 hours of audio and 200,000 translation pairs for a first functional model. Plan collection in 2–3 tranches.

- **Condition — applies when:** Any language AI project; the mix matters most for the groups most likely to be underrepresented — elders, women, telephony speakers, and speakers of minority sub-dialects.

---

**8. Consent and data-protection compliance before collection begins**

- **Dimension:** Solution
- **Stage:** Define
- **Type:** Strategic Decision
- **Decision:** Complete a consent process with every contributor before collection starts, and confirm compliance with the Digital Personal Data Protection Act, as a non-negotiable precondition — not a step to return to once collection is underway.
- **Alternative considered:** Beginning collection and addressing consent documentation retrospectively.
- **Why:** Consent is a legal and ethical precondition for collection. An open question the source flags explicitly: whether contributors' consent covers open release of their recordings under CC BY 4.0 needs to be resolved before release, not after. The consent design must address open release explicitly, not just internal use.
- **What this looked like here:** Named as a Stage 1 requirement in the Nandurbar journey. The scope of consent relative to open release is an unresolved open question in the source as of August 2026.
- **Condition — applies when:** Any project where the dataset will be released to the open commons; consent design must address open release explicitly.

---

**9. Three-metric quality bar — WER, BLEU, and MOS with explicit numeric thresholds**

- **Dimension:** Solution
- **Stage:** Define
- **Also relevant at:** Pilot
- **Type:** Tactical Decision
- **Decision:** Adopt three standard evaluation metrics — WER (ASR accuracy), BLEU (translation quality), MOS (voice naturalness) — with explicit numeric thresholds agreed before model building begins, and track them continuously rather than checking only at sign-off.
- **Alternative considered:** Informal quality judgements by the technical partner without agreed numeric thresholds; checking only at the end of the pipeline.
- **Why:** Without agreed thresholds, "good enough" is renegotiated at the point of sign-off. Tracking continuously means problems surface early, when they can be addressed through targeted re-collection or model adjustment, rather than at the end, when re-collection is expensive. A model that scores well in controlled conditions may still underperform with real dialects and noise; field testing stays a standing supplement.
- **What this looked like here:** Thresholds used in the Nandurbar collaboration, benchmarked by AI4Bharat: WER below 20% = generally usable for government service applications; below 10% = production-grade. First tribal-language models typically achieve 30–50% — useful for keyword spotting, with open-ended transcription still a stage away. BLEU above 20 = usable for domain-specific content; above 35 = approaches human-level fluency for constrained domains. First-generation models typically score 10–25. MOS 3.5 or above = generally acceptable for public service use; 4.0–4.5 = studio-quality. Community TTS models typically achieve 2.5–3.5 at first iteration.
- **Condition — applies when:** A technical partner is building models for a government deployment; the government needs a defensible, non-negotiable quality gate that neither the vendor nor the institution can informally override.
- **Before → After:** Before agreed thresholds: quality judgements made at sign-off, with the bar subject to negotiation. After: the technical partner benchmarks against shared standards at every model-building cycle; Quality PMU audits the result; the number is the gate, not the conversation.

---

**10. Model-agnostic architecture — building the language capability as a general-purpose foundation, not a single-use deployment**

- **Dimension:** Solution
- **Stage:** Define
- **Also relevant at:** Scale
- **Type:** Strategic Decision
- **Decision:** Build the ASR/NMT/TTS models as general-purpose, reusable language infrastructure — model-agnostic by design — hosted on open, sovereign infrastructure (Bhashini / State Data Centres), so a second department or a different state can build on the same underlying language capability without renegotiating access.
- **Alternative considered:** Building a model locked to the first deployment use case and the first vendor's platform.
- **Why:** If the model is built as a single-use deployment, every subsequent use case requires rebuilding from scratch, and the community's contribution of time and voice data benefits only one application. Open hosting on Bhashini's ULCA repository means the dataset and model outlive any single contract or champion.
- **What this looked like here:** In Nandurbar, the model built by AI4Bharat was deployed into the agricultural IVR as the first application, but the foundation model was not tuned exclusively to agriculture. Subsequent departments fund and own their own domain-specific fine-tuning on top of the shared foundation — a deliberate split between shared infrastructure and per-use-case investment.
- **Condition — applies when:** Multiple future use cases are foreseeable; the goal is a public language infrastructure good rather than a single departmental tool; sovereign, open hosting is available.

---

**11. Committing to proceed — the seven-item pre-start gate at Explore**

- **Dimension:** Solution
- **Stage:** Explore
- **Also relevant at:** Define
- **Type:** Playbook
- **Playbook:**
  1. Check seven items before committing to proceed: (a) an institutional anchor committed for 2–3 years (a role, not a person); (b) a committed deployment application identified — the one non-negotiable gate; (c) a champion able to convene across departments; (d) the script/orthography decision made, or an owner assigned to make it; (e) technical partners identified for collection, model building, and hosting; (f) first-stage funding secured; (g) a Nodal Officer designated by post.
  2. Record the outcome of each item explicitly — met, not met, or in progress with a named gap.
  3. A "No" on any item is a task to complete before starting, not a disqualifier. Starting with unmet items creates mismatched expectations and rework.
  4. Record the stage-closing decision: commit / stop / hold pending a named gap.
- **Note:** The most common failure is treating item (b) — the committed deployment application — as something that can be sorted after collection begins. It cannot. This is the failure that produces data collected but never deployed (Unit 17).
- **Condition — applies when:** Any low-resource language AI project before any data collection or vendor contracting begins.

---

**12. Two-stage use-case acceptance testing — metrics as supporting evidence, not the deciding factor**

- **Dimension:** Solution
- **Stage:** Pilot
- **Type:** Playbook
- **Playbook:**
  1. Run the three benchmark metrics (WER, BLEU, MOS) to confirm the model is technically sound against the thresholds in Unit 9.
  2. Separately, run a defined batch of real test interactions — approximately 100 test calls to the live IVR service — as use-case acceptance testing. Use the testing template: https://docs.google.com/spreadsheets/d/1jU6n_zQeWrrWEH7UugB-CzjZH40gfXZpy-urmEBxW8Q/edit?gid=608885123#gid=608885123
  3. Brief field testers on the protocol; they need no technical knowledge and use everyday questions. Language and engineering teams evaluate separately and analyse what testers found.
  4. Have the deploying department's officials and community members judge whether the output was acceptable for their purpose — not the technical partner whose model is being evaluated.
  5. Appoint an independent third party to conduct this acceptance judgement, separate from the vendor.
  6. A passed use-case acceptance test triggers sign-off; benchmark scores are supporting evidence, not the deciding factor.
  7. Do not advance to full deployment until both layers have passed. Repeat every cycle.
- **Note:** The most common failure mode is treating the benchmark metrics as sufficient and skipping the independent use-case acceptance step. Findings may send work back to the data, the model, or the application before another round of testing.
- **Condition — applies when:** A government service is being handed to a public that includes low-literacy users in variable acoustic environments; the deploying department needs to own the quality judgement, not inherit it from the vendor.
- **Before → After:** Not documented as a before/after for this specific deployment; the documented approach is drawn from the MahaVISTAAR precedent referenced as the clearest working example of this method.

---

**13. Pilot review — the gated decision before full collection**

- **Dimension:** Solution
- **Stage:** Pilot
- **Type:** Playbook
- **Playbook:**
  1. After pilot collection and the first model, the steering committee reviews four things together: pilot data quality against the rubric (Unit 18); contributor pool registration and mix compliance (Unit 7); first model benchmark scores (Unit 9); and use-case acceptance result (Unit 12).
  2. No single item passes the pilot on its own — all four are reviewed together.
  3. Record the stage-closing decision: proceed to full collection / rework and re-pilot / pause / stop. Name the gap if the decision is rework, pause, or stop.
  4. Do not begin full collection until the steering committee has recorded its decision.
- **Note:** The most common failure mode is treating the pilot as a formality and beginning full collection before results are reviewed. Quality failures found after full-volume collection cost far more to fix than those caught at pilot scale.
- **Condition — applies when:** Any language AI project before committing to the full collection tranche; the pilot gate is the cheapest point at which to catch a systematic quality or design problem.

---

**14. Scale decision — completing the foundation or continuing**

- **Dimension:** Solution
- **Stage:** Scale
- **Type:** Playbook
- **Playbook:**
  1. Count completed passes through the application integration and feedback gate (Gate 3 in the sign-off sequence): dataset validated and signed off by the super reviewer; models meeting benchmarks, signed by the technical partner and audited by the quality PMU; and the service live, acceptance test passed, gaps fed back.
  2. Check that the project no longer depends on its champion's day-to-day involvement (Unit 20).
  3. When at least two complete feedback cycles have been passed and the project runs on its institutional mandate, record the stage-closing decision: foundation complete / another cycle / pause / discontinue.
  4. "Done" means the latest model is live and usable by the public in the target application, with at least two complete feedback cycles behind it. Improvement continues after that as ongoing operation, without changing completion status.
- **Note:** An open question in the source: whether "two complete feedback cycles" means two passes through the application integration gate specifically, or two full collection-to-deployment loops. This needs to be resolved before the completion criterion is applied.
- **Condition — applies when:** Any project approaching the end of its foundation-building phase; the completion criterion is not a technical gate but a combination of output quality and institutional independence.

---

### Institution

**15. Seven documented failure patterns — named before they happen**

- **Dimension:** Institution
- **Stage:** Pilot
- **Type:** Tactical Decision
- **Decision:** Document the seven most common failure patterns from field experience and build explicit mitigations for each into the project structure before they are encountered, rather than treating them as surprises to be managed in real time.
- **Alternative considered:** Managing failures reactively as they surface during the project.
- **Why:** Each of the seven patterns has a known mitigation, and the mitigation is far cheaper before the failure than after it. Several (contributor dropout, language expert bottleneck, vendor lock-in) can end or permanently damage a project if not anticipated. The mitigations are structural — they require decisions made at Define or before Pilot, not reactive fixes during Pilot.
- **What this looked like here:** The seven patterns documented across Project Astitva and related initiatives: (1) Community disengages midway — mitigated by real-time progress visibility and showing contributors the actual product early; hearing a real result in their own language is the strongest motivator available. (2) Contributor selection and training poorly planned — elders missed; coordinators deployed across dialects without proper training, creating errors and frustration. (3) Data collected but never deployed — see Unit 17 for the full treatment; the fix is identifying the deployment owner before collection begins. (4) Language expert bottleneck — distributed validator pool of at least 5–10 trained people, with documentation thorough enough that any validator can pick up where another left off. (5) Political or administrative change — mandate written into departmental order, not carried in the champion's memory; see Unit 16. (6) Vendor or platform lock-in — open data standards and ULCA-compatible exports from day one; Bhashini's ULCA repository exists specifically to prevent this. (7) Low community adoption — end-users involved in testing before formal launch; the missing piece is often low awareness, requiring a structured awareness programme from the application owner.
- **Condition — applies when:** Any low-resource language AI project; patterns 3, 5, and 6 are especially critical and are not recoverable after the fact without major rework.

---

**16. Mandate in the departmental order — not in the champion's memory**

- **Dimension:** Institution
- **Stage:** Define
- **Also relevant at:** Scale
- **Type:** Strategic Decision
- **Decision:** Write every non-delegable champion action, the review mechanism, the Nodal Officer's post (post-based rather than person-based), and the project's governance structure into a formal departmental order issued in week one — so the project runs on its institutional mandate rather than on any one person's energy or memory.
- **Alternative considered:** Verbal agreements, informal practice, and the assumption that a committed champion will remain in post for the project's duration.
- **Why:** District Collectors transfer. A verbal agreement rarely survives a transfer; a departmental order does. The successor can pick up the project directly from the order without needing to reconstruct the approach from handover conversations. Open licensing of the dataset and model under CC BY 4.0 ensures the work outlives the specific contracts and people who built it. An open question the source flags: whether a formal handover instrument for an incoming officer exists beyond the departmental order, the open release, and the handbook.
- **What this looked like here:** Three survival mechanisms are named explicitly in the Nandurbar design: the departmental order (covering every item in the champion's non-delegable actions), open release to the public commons (Bhashini/ULCA, CC BY 4.0), and the published replication handbook. Whether these mechanisms have been tested through an actual champion transfer is not yet documented as of August 2026.
- **Condition — applies when:** Any multi-year government AI project where the champion is a transferable post; this is not optional for a project expected to survive beyond a single official's tenure.

---

**17. Identifying the deployment application before data collection begins — the one non-negotiable gate**

- **Dimension:** Institution
- **Stage:** Explore
- **Also relevant at:** Define
- **Type:** Strategic Decision
- **Decision:** Identify and commit a live deployment application and its owner before any data collection starts. This is the single non-negotiable precondition — not one item on a checklist among equals.
- **Alternative considered:** Beginning data collection while the deployment application is still being identified, on the assumption it can be sorted in parallel.
- **Why:** Data collected without a committed deployment tends never to be deployed. Models are trained but no government system takes them up, because the deployment platform was not engaged as a partner from the start or was not ready to test when models were built. The Nandurbar ecosystem named this as the documented failure pattern most likely to produce wasted effort at scale.
- **What this looked like here:** The agricultural IVR / crop advisory line was identified as the deployment application before Karya began field collection in Nandurbar. The application owner — the State Agriculture Department / POCRA — was engaged as a partner from the start, not once models existed.
- **Condition — applies when:** Any low-resource language AI project; applies most critically when a government department must separately agree to integrate a model that another part of the ecosystem is building.
- **Before → After:** Before: models trained, no government system ready to integrate them, effort stalls. After: deployment owner engaged from the start, integration timeline agreed before collection begins, first model moves directly into a live service.

---

**18. Champion personally convenes community — institutional weight is not delegable**

- **Dimension:** Institution
- **Stage:** Define
- **Type:** Strategic Decision
- **Decision:** The District Collector or equivalent champion personally convenes the first round of meetings with community leaders, language experts, and tribal welfare associations — not the Nodal Officer or an external partner on the champion's behalf — and does so before any vendor is contracted.
- **Alternative considered:** Delegating community convening to the Nodal Officer or the orchestrating partner from the outset.
- **Why:** The champion's institutional weight is what makes the first meeting land in the way it needs to. A Nodal Officer sending an invitation reads differently from the Collector personally showing up to say this effort is not being done for the community, it is only possible with the community. The community's trust in the project — and its willingness to contribute — is established at this point, not later.
- **What this looked like here:** In Nandurbar, the District Collector personally chaired the first round of community-expert meetings. The source documents 3–4 such meetings, with the first kept personal, and explicitly cautions against compressing this step under timeline pressure.
- **Condition — applies when:** Any government-led language AI project; the community's willingness to contribute voice data and sustain participation through a 9-month collection effort depends on trust established at the convening stage, not at launch.

---

### Ecosystem

**19. Separating the three external technical roles — scope boundaries that prevent lock-in**

- **Dimension:** Ecosystem
- **Stage:** Define
- **Type:** Strategic Decision
- **Decision:** Keep the collection agency, model builder, and hoster as three contractually separate roles with explicitly bounded scopes — never allowing any one party to span two or more of them.
- **Alternative considered:** A single integrated vendor handling collection, model building, and hosting under one contract.
- **Why:** When data, models, or workflows sit with one commercial platform, the project depends on that vendor's continued interest and pricing. Contractual separation means no party grades its own work, and no party's exit takes the whole stack down. Open data standards and ULCA-compatible exports from day one let the dataset and model move independently of any single vendor.
- **What this looked like here:** In Nandurbar: Karya led field collection, transcription, task management, and first-pass validation — not model building or final sign-off. AI4Bharat led training, benchmarking, and retraining — not field collection or deployment. Bhashini provided open, publicly accessible hosting and service availability — not model quality decisions or data collection. Each role was separately contracted.
- **Condition — applies when:** Any multi-partner language AI project; most critical where government data, community voice recordings, and trained models must remain openly accessible after the project ends.

---

**20. Open release as a structural commitment, not an afterthought**

- **Dimension:** Ecosystem
- **Stage:** Scale
- **Type:** Strategic Decision
- **Decision:** Treat the release of the dataset and model to the open commons as a formal, contractually required output — agreed before collection begins — rather than an optional step at the end of the project.
- **Alternative considered:** Releasing the dataset and model informally, at the discretion of the project team, after the project concludes.
- **Why:** Open release is what lets the work outlive the contracts and people who built it. If release is left to the end as an informal decision, it tends not to happen — the dataset sits with the collection agency, the model sits with the model builder, and a second adopter has to start from scratch. Bhashini's ULCA repository and AIkosh exist specifically to host this kind of release; using them is a structural choice, not a convenience.
- **What this looked like here:** The Nandurbar collaboration committed to CC BY 4.0 release of both the dataset (to Bhashini's ULCA / AIKosh) and the model (to Bhashini / Hugging Face) as a formal project output, alongside the published replication handbook. Two open questions remain: what documentation travels with the released model, and who maintains the shared foundation model after sign-off.
- **Condition — applies when:** Any project where the dataset or model is intended to be reused by a second department, state, or institution; open release terms must be agreed before collection begins, not after, because consent scope and licensing are set at the contributor level.

---

## Section 4 — Toolkits and Playbooks

| Unit | Asset | One-line reuse condition |
|---|---|---|
| Unit 11 | Seven-item pre-start checklist | Use before committing to any low-resource language AI project; each item is a task to complete, not a disqualifier |
| Unit 12 | Two-stage use-case acceptance testing playbook with testing template link | Use when a government department needs to own the quality judgement on a model built by an external technical partner |
| Unit 13 | Pilot review gate — four-item steering committee checklist | Use before committing to full collection; the cheapest point to catch a systematic quality or design problem |
| Unit 14 | Scale decision playbook — foundation completion criteria | Use when approaching the end of foundation-building; applies when at least two feedback cycles have been completed and the project runs on institutional mandate |
| Unit 7 | Dataset volume tiers and contributor mix table | Use at Define stage to specify collection before it begins; the mix is non-negotiable once collection starts |
| Unit 6 | Four-step data collection timeline with common delays per step | Use at Explore/Define to set realistic expectations with funders and government partners; grounded in Nandurbar experience |

---

## Section 6 — Retrieval Guide

*"How do I know if we're ready to start?"* → Unit 11

*"What channel should we use for low-literacy rural users?"* → Unit 1

*"Who exactly are we building this for?"* → Unit 2

*"How long will data collection take?"* → Unit 6

*"How much data do we need to collect, and from whom?"* → Unit 7

*"How do we show the community something is working before the full model is ready?"* → Unit 5

*"What quality bar should we hold the model builder to?"* → Unit 9

*"How do we make sure the model works for real users, not just in controlled tests?"* → Unit 12

*"What are the most common ways this kind of project fails?"* → Unit 15

*"How do we make sure the project survives when the District Collector transfers?"* → Unit 16, Unit 18

*"How do we make sure data collected doesn't just sit unused?"* → Unit 17, Unit 11

*"How should we structure contracts with our technical partners?"* → Unit 19

*"When is the project done?"* → Unit 14

*"How do we make the dataset and model available for others to build on?"* → Unit 20

*"What should we set as output milestones for funders?"* → Unit 3

*"How do we make sure elders are represented in what we collect?"* → Unit 4

*"Should we build one model for everything or keep it general-purpose?"* → Unit 10

*"When do we move from pilot to full collection?"* → Unit 13

*"How do we stop a single vendor from locking us in?"* → Unit 19, Unit 10

*"What's the right governance structure for a project like this?"* → Unit 16, Unit 18

---

---
*Source Trace — contributor-facing only; not surfaced in adopter-facing responses*

| Source file | Covers | Notes |
|---|---|---|
| Adoption_Package_India_Rebuild_31_Aug_2026.md (1).pdf, as-of August 31, 2026 | Pathway Identity — all fields; Section 2 gaps 1–10; Units 1–20; Section 4 toolkit table; Section 6 retrieval guide | Primary source. All cost figures, timeline estimates, benchmark thresholds, contributor mix, failure patterns, governance structure, sign-off gates, and open questions drawn from this document. Internal "Only for Author" section used for source provenance tracking and open question identification; not surfaced in adopter-facing content. |
| journey-model-voice-low-resource-languages.md, as-of August 2026 | Pathway Identity — stage, scope fields; Section 2 coverage grid; Units 1–20 (structural organisation, step sequencing, decision point register); Section 4 toolkit table | Primary source for journey model structure, step sequencing, and decision point register. Used to organise units by stage and dimension, and to identify the 45-step count referenced in Section 0. Where content overlaps with the adoption package, the adoption package is the more grounded source for specific figures and field detail. |
| Adoption companion conversation, as-of October 9, 2026 | Section 1 — Contributing organisation field; Section 0 — collaborative framing; Units 1, 2, 4, 5, 6, 15, 17, 18, 19 — "What this looked like here" fields updated to reflect collaborative ecosystem framing; title and description fields | Contributor's own account. Reflects the contributor's instruction to remove sole attribution to EkStep Foundation and replace with collaborative ecosystem framing. Not independently verified. |