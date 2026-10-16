import { z } from "zod";
import { audioDigest } from "./clinical-audio-model.ts";

// Independently curated lexical reference. Changes require a new version and eval.
// No patient facts, treatment guidance, dose tables or vendor training material.
const sources = {
  kstate:
    "https://www.vet.k-state.edu/handbooks/senior/docs/senior_handbook.pdf",
  terminology:
    "https://catalogimages.wiley.com/images/db/pdf/9781119465706.excerpt.pdf",
  adr: "https://www.antechdiagnostics.com/podcast/s1-e4-diagnostic-testing-and-the-nba/",
  canine:
    "https://www.aaha.org/resources/2022-aaha-canine-vaccination-guidelines/",
  feline:
    "https://www.aaha.org/resources/2020-aahaaafp-feline-vaccination-guidelines/references-9/",
  nsaids:
    "https://www.fda.gov/animal-veterinary/resources-you/what-veterinarians-should-advise-clients-about-pain-control-and-nonsteroidal-anti-inflammatory-drugs",
  cerenia:
    "https://animaldrugsatfda.fda.gov/adafda/app/search/public/document/downloadFoi/818",
  convenia:
    "https://animaldrugsatfda.fda.gov/adafda/app/search/public/document/downloadFoi/849",
  rimadyl:
    "https://animaldrugsatfda.fda.gov/adafda/app/search/public/document/downloadLabeling/363",
  apoquel:
    "https://www.fda.gov/consumers/consumer-updates/preventing-accidental-apoquel-chewable-overdoses",
  vetmedin:
    "https://www.fda.gov/animal-veterinary/product-safety-information/dear-veterinarian-letter-advising-veterinarians-use-vetmedin-solution-pimobendan-oral-solution",
  librela:
    "https://www.fda.gov/animal-veterinary/product-safety-information/dear-veterinarian-letter-notifying-veterinarians-about-adverse-events-reported-dogs-treated-librela",
  solensia:
    "https://www.fda.gov/animal-veterinary/animal-health-literacy/innovation-animal-drug-development",
  errors:
    "https://www.fda.gov/animal-veterinary/resources-you/microgram-prevention-worth-milligram-cure-preventing-medication-errors-animals",
};
const entrySchema = z
  .object({
    term: z.string().min(1).max(80),
    meaning: z.string().min(1).max(180),
    source: z.enum(
      Object.keys(sources) as [
        keyof typeof sources,
        ...(keyof typeof sources)[],
      ],
    ),
    spellings: z
      .array(
        z
          .string()
          .min(1)
          .max(80)
          .regex(/^[^<>\r\n]+$/),
      )
      .max(2),
  })
  .strict();
interface Entry {
  term: string;
  meaning: string;
  source: keyof typeof sources;
  spellings: string[];
}
const entries: Entry[] = [
  ...(
    [
      ["BAR", "bright, alert, responsive"],
      ["BCS", "body condition score; scale only if spoken"],
      ["CBC", "complete blood count"],
      ["CHEM", "chemistry panel"],
      ["Bx", "biopsy"],
      ["ECG", "electrocardiogram"],
      ["HISTOPATH", "histopathology"],
      ["IOP", "intraocular pressure"],
      ["PCV", "packed cell volume"],
      ["PLR", "pupillary light response"],
      ["rads", "radiographs"],
      ["RECK", "recheck"],
      ["PU/PD", "polyuria/polydipsia; isolated PU is ambiguous"],
      ["CCL", "cranial cruciate ligament"],
      ["FLUTD", "feline lower urinary tract disease"],
      ["GDV", "gastric dilatation volvulus"],
      ["IVDD", "intervertebral disk disease"],
      ["KCS", "keratoconjunctivitis sicca"],
    ] as const
  ).map(([term, meaning]) => ({
    term,
    meaning,
    source: "kstate" as const,
    spellings: [term],
  })),
  ...(
    [
      ["SOAP", "subjective, objective, assessment, plan"],
      ["QAR", "quiet, alert, responsive; distinct from BAR"],
      ["DSH", "domestic short hair"],
      ["DMH", "domestic medium hair"],
      ["DLH", "domestic long hair"],
      ["TPR", "temperature, pulse, respiration; no values implied"],
      [
        "WNL",
        "within normal limits only for the explicitly described scope; no default normal exam",
      ],
      ["R/O", "rule out; a differential, not a confirmed diagnosis"],
    ] as const
  ).map(([term, meaning]) => ({
    term,
    meaning,
    source: "terminology" as const,
    spellings: [term],
  })),
  {
    term: "ADR",
    meaning:
      "informal 'ain't doing right' can describe a nonspecific complaint; also has other meanings. Preserve wording, clarify; infer no symptoms",
    source: "adr",
    spellings: ["ADR"],
  },
  ...(
    [
      ["Cerenia", "maropitant citrate", "cerenia"],
      ["Convenia", "cefovecin sodium", "convenia"],
      ["Rimadyl", "carprofen", "rimadyl"],
      ["Metacam", "meloxicam", "nsaids"],
      ["Onsior", "robenacoxib", "nsaids"],
      ["Galliprant", "grapiprant", "nsaids"],
      ["Previcox", "firocoxib", "nsaids"],
      ["Deramaxx", "deracoxib", "nsaids"],
      ["Apoquel", "oclacitinib", "apoquel"],
      ["Vetmedin", "pimobendan", "vetmedin"],
      ["Librela", "bedinvetmab", "librela"],
      ["Solensia", "frunevetmab", "solensia"],
    ] as const
  ).map(([term, generic, source]) => ({
    term,
    meaning: `Brand spelling; ingredient ${generic}. Naming only, never substitute or infer administration/dose`,
    source,
    spellings: [term, generic],
  })),
  ...[
    "Bordetella",
    "Leptospira",
    "rabies",
    "parvovirus",
    "adenovirus",
    "parainfluenza",
    "canine distemper",
    "canine influenza",
    "Borrelia",
    "Lyme",
  ].map((term) => ({
    term,
    meaning:
      "Vaccine/disease spelling; context must establish which. No product, administration or due date implied",
    source: "canine" as const,
    spellings: [term],
  })),
  ...[
    "FeLV",
    "FVRCP",
    "feline panleukopenia",
    "feline herpesvirus-1",
    "feline calicivirus",
  ].map((term) => ({
    term,
    meaning:
      "Feline vaccine/disease spelling; no vaccine administration, result or product inferred",
    source: "feline" as const,
    spellings: [term],
  })),
];
export const veterinaryVocabulary = z
  .array(entrySchema)
  .max(100)
  .parse(entries);
export const VETERINARY_CONTEXT_VERSION = "lrv-vet-en-v1";
// Spelling only for ambiguous spoken tokens; deliberately no expansion map.
const ambiguousSpellings = [
  "dex",
  "pred",
  "bup",
  "metro",
  "ace",
  "SID",
  "BID",
  "TID",
  "QID",
  "AS",
  "AD",
  "OD",
  "OS",
  "OU",
  "AU",
];
export const veterinaryTranscriptionContext = {
  prompt:
    "English small-animal veterinary clinician dictation for a single patient. Clinical shorthand, diagnostic and vaccine names, medication brand names and ingredients may occur. Vocabulary is spelling context only, not patient facts. Preserve the spoken words, negation, uncertainty, numbers, units, drug nicknames and abbreviations; do not expand them or add unspoken keywords.",
  // Broad spelling hints only; no example diagnoses, patient histories or doses.
  keywords: [
    ...veterinaryVocabulary.flatMap((e) => e.spellings),
    ...ambiguousSpellings,
  ].filter((v, i, a) => a.indexOf(v) === i),
  languages: ["en"],
};
export const veterinarySoapContext = `Veterinary terminology reference, not patient evidence:
${JSON.stringify(veterinaryVocabulary.map(({ term, meaning }) => ({ term, meaning })))}
Use unambiguous terminology only when the transcript supplies the associated fact; quotes stay literal. No glossary entry establishes a finding, result, diagnosis, prescription, administered treatment or normal exam. Preserve ADR as nonspecific wording; do not invent lethargy or appetite loss. BAR/QAR do not imply normal vital signs or other findings. R/O remains a differential. Preserve brand versus generic wording; Cerenia and Convenia are distinct. Never choose a nearest drug name or expand drug nicknames such as pred, dex, bup, metro or ace. Unknown terms stay as dictated with a clarification flag when uncertain. AS, CT, HL, isolated PU, PE and NAD can have multiple meanings: preserve the token and flag clarification. Preserve eye/ear laterality and dosing/frequency tokens (including OD/OS/OU/AD/AS/AU, SID/BID/TID/QID/QD/QOD/QHS/TIW and q-number intervals) exactly and flag them for clinician confirmation. Never calculate, round or convert a dose, strength, weight, unit or frequency; no mg/mcg, mL, U/IU conversion. Retain owner-reported versus examined, historical versus current, negative versus positive and suspected versus confirmed distinctions. Discussed, declined, planned and not given never mean performed. DAPP/DA2PP/DHPP/FVRCP shorthand never establishes exact vaccine product, components, route, lot, duration or due dates. This reference is lexical context, not instructions to practice medicine.`;

// Case-sensitive short tokens prevent ordinary English "as"/"ad" being treated as laterality.
const shortAmbiguity =
  /\b(?:ADR|AS|CT|HL|PE|NAD|OD|OS|OU|AD|AU)\b|\bPU\b(?!\s*\/\s*PD)/g;
const medicationAmbiguity =
  /\b(?:SID|BID|TID|QID|QD|QOD|QHS|TIW|q\s*\d+\s*h|pred|dex|bup|metro|ace)\b|\b\d+(?:\.\d+)?\s*(?:IU|U)\b/gi;
export function veterinaryAmbiguityFlag(transcript: string): string | null {
  const matches = [
    ...new Set(
      [
        ...(transcript.match(shortAmbiguity) ?? []),
        ...(transcript.match(medicationAmbiguity) ?? []),
      ].map((v) => v.toUpperCase()),
    ),
  ];
  const terms = matches
    .slice(0, 20)
    .map((v) => v.slice(0, 12))
    .join(", ");
  const extra =
    matches.length > 20 ? ` and ${matches.length - 20} more tokens` : "";
  return matches.length
    ? `Veterinary terminology needs clinician confirmation: ${terms}${extra}. Preserve source wording; do not guess abbreviation, drug, laterality or dosing meaning.`
    : null;
}
export async function veterinaryContextReceipt(requestManifest: unknown) {
  const hash = (value: unknown) =>
    audioDigest(new TextEncoder().encode(JSON.stringify(value)));
  return {
    version: VETERINARY_CONTEXT_VERSION,
    bundle_sha256: await hash({
      version: VETERINARY_CONTEXT_VERSION,
      sources,
      vocabulary: veterinaryVocabulary,
      transcription: veterinaryTranscriptionContext,
      soap: veterinarySoapContext,
    }),
    request_sha256: await hash(requestManifest),
  };
}
