# Veterinary dictation vocabulary research — 2026-10-16

Research only; independent naming/context data, not vendor internals, treatment recommendations, or model training. Sources were checked on this date. A source documenting an abbreviation does not make its automatic expansion safe. Keep the original transcript and literal quote evidence.

## Candidate compact dataset

### General exam / SOAP

Publisher-hosted textbook excerpt supports these factual mappings: SOAP → subjective/objective/assessment/plan; QAR → quiet, alert, responsive; DSH/DMH/DLH → domestic short/medium/long hair; TPR → temperature/pulse/respiration; WNL → within normal limits; R/O → rule out. Source: Angela Taibo, Veterinary Medical Terminology Guide and Workbook, 2nd ed. (2019), table 1.4, printed pages 15–16: https://catalogimages.wiley.com/images/db/pdf/9781119465706.excerpt.pdf . Do not turn WNL into an enumerated normal exam; do not turn R/O into a confirmed diagnosis. QAR is distinct from BAR, not a normal-status synonym.

### Diagnostics, clinical terms and clinic shorthand

Kansas State University's teaching-hospital protocol, printed pages 13–15, supports: BAR → bright, alert, responsive; BCS → body condition score; CBC → complete blood count; CHEM → chemistry panel; Bx → biopsy; ECG → electrocardiogram; HISTOPATH → histopathology; IOP → intraocular pressure; PCV → packed cell volume; PLR → pupillary light response; RADS → radiographs; RECK → recheck; PU/PD → polyuria/polydipsia; CCL → cranial cruciate ligament; FLUTD → feline lower urinary tract disease; GDV → gastric dilatation volvulus; IVDD → intervertebral disk disease; KCS → keratoconjunctivitis sicca. These are naming/recognition hints only, and must not introduce findings. Source: https://www.vet.k-state.edu/handbooks/senior/docs/senior_handbook.pdf . The document dates to 2011–2012: use its lexical evidence, not its old clinical protocols as current recommendations.

ADR / “ain't doing right” is directly discussed by Antech's clinical pathologist as an informal, nonspecific owner complaint. Source: https://www.antechdiagnostics.com/podcast/s1-e4-diagnostic-testing-and-the-nba/ . The same source directly discusses PU/PD and polyuric/polydipsic. Safe use: preserve ADR or the spoken colloquial phrase; never infer appetite loss, lethargy, organ disease, or a diagnosis from that label alone. ADR also has medication-safety meanings, so do not globally replace it.

### Vaccines (spelling only)

Recognize canine distemper, adenovirus, parvovirus, parainfluenza, Leptospira, rabies, Bordetella, canine influenza, Borrelia/Lyme. Source: https://www.aaha.org/resources/2022-aaha-canine-vaccination-guidelines/ . Combination vaccine shorthand (DAPP, DA2PP, DHPP) must retain exactly the spoken/product-verified identity: never infer actual product, components, route, duration, lot, or due date from a nickname such as “distemper shot.”

Recognize FeLV (feline leukemia virus), FVRCP, feline panleukopenia, feline herpesvirus-1, feline calicivirus. Source (actual AAHA/AAFP guideline references naming these): https://www.aaha.org/resources/2020-aahaaafp-feline-vaccination-guidelines/references-9/ . Preserve FeLV vs FIV; positive status must never imply vaccination or the inverse. Vaccine and disease names need explicit spoken context.

### Medication spelling pairs (naming only; no doses, frequencies, species permissions or substitution)

| Brand | Active ingredient | Primary source |
|---|---|---|
| Cerenia | maropitant citrate | https://animaldrugsatfda.fda.gov/adafda/app/search/public/document/downloadFoi/818 |
| Convenia | cefovecin sodium | https://animaldrugsatfda.fda.gov/adafda/app/search/public/document/downloadFoi/849 |
| Rimadyl | carprofen | https://animaldrugsatfda.fda.gov/adafda/app/search/public/document/downloadLabeling/363 |
| Metacam | meloxicam | FDA NSAID table below |
| Onsior | robenacoxib | FDA NSAID table below |
| Galliprant | grapiprant | FDA NSAID table below |
| Previcox | firocoxib | FDA NSAID table below |
| Deramaxx | deracoxib | FDA NSAID table below |
| Apoquel | oclacitinib | https://www.fda.gov/consumers/consumer-updates/preventing-accidental-apoquel-chewable-overdoses |
| Vetmedin | pimobendan | https://www.fda.gov/animal-veterinary/product-safety-information/dear-veterinarian-letter-advising-veterinarians-use-vetmedin-solution-pimobendan-oral-solution |
| Librela | bedinvetmab | https://www.fda.gov/animal-veterinary/product-safety-information/dear-veterinarian-letter-notifying-veterinarians-about-adverse-events-reported-dogs-treated-librela |
| Solensia | frunevetmab | https://www.fda.gov/animal-veterinary/animal-health-literacy/innovation-animal-drug-development |

FDA NSAID table: https://www.fda.gov/animal-veterinary/resources-you/what-veterinarians-should-advise-clients-about-pain-control-and-nonsteroidal-anti-inflammatory-drugs . Cerenia and Convenia are distinct drugs. A hint list must not make a noisy utterance into a certain drug choice. Brand/generic links do not authorize exchanging formulations, adding the generic to clinical content as a second prescription, or filling in doses.

## Ambiguity / safety block

Use deterministic review flags in addition to model instructions for risky abbreviations. Do not silently normalize:

- SID/BID/TID/QID/QD/qod/TIW/Qhs and free-form q-number intervals: frequency changes can cause overdoses. FDA specifically documents veterinary SID being read as BID/QID. Source: https://www.fda.gov/animal-veterinary/resources-you/microgram-prevention-worth-milligram-cure-preventing-medication-errors-animals .
- U/IU, mcg/µg/mg, mg/kg, mL, decimals and zeroes: keep the spoken value/unit; flag uncertainty; never convert units or calculate a dose from patient weight. Same FDA source, plus https://www.fda.gov/animal-veterinary/product-safety-information/veterinary-medication-errors .
- AS: left ear OR aortic stenosis; CT: collapsing trachea OR computed tomography; HL: hepatic lipidosis OR hemilaminectomy; PU alone: perineal urethrostomy, while PU/PD means polyuria/polydipsia. These actual collisions are visible in the K-State glossary. Therefore no global abbreviation expander.
- OD/OS/OU and AD/AS/AU: preserve literal laterality token and require clinician review rather than guessing eye versus ear, side, or administration schedule. K-State lists the eye/ear mappings; FDA explains the general medication error hazard.
- “pred,” “dex,” “metro,” “ace,” and unidentified product nicknames: no sourced expansion is proposed. Keep literal and flag clarification rather than selecting prednisone/prednisolone, dexamethasone/dexmedetomidine, etc.
- “negative,” “no,” “not,” “possible,” “suspected,” “history of,” “owner reports,” “declined,” “discussed,” and “not given” must govern the associated claim. A vocabulary match is never evidence of administration, diagnosis, or a normal finding.

## Implementation / evaluation suggestions

Curate a versioned small context list with term IDs, category, source URLs, and review-only ambiguity markers. For transcription, supply spelling hints in provider-supported prompt context without example patient facts or a prior chart. For SOAP, supply a separate labeled reference dictionary that is expressly not patient evidence. Append review flags for detected ambiguity deterministically so safety does not depend solely on generated flags. Preserve exact transcript excerpts when expanding only an unambiguous term in draft text. Keep all chart acceptance/signature gates.

Synthetic cases should cover RADS/BAR/BCS/CBC; PU/PD versus isolated PU; ADR without fabricated clinical signs; Cerenia versus Convenia; R/O disease retained as uncertainty; denied vomiting; declined vaccine; eye/ear laterality and SID ambiguity; decimal dose/unit preservation; fictional drug/name outside the dictionary retained/flagged rather than forced into nearest vocabulary item.

Unverified/limited sources deliberately not treated as authoritative: AAVSB 2025 VTNE glossary appears in search snippets but its direct URL returned 404; Merck abbreviations page appeared in search but repeated opens timed out. Do not attribute entries to full-page reads that failed.
