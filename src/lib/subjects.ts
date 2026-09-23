import type { ExamBoard, StemSubject } from "@/lib/types";

export const SUBJECTS: { value: StemSubject; label: string; blurb: string }[] = [
  { value: "Mathematics", label: "Mathematics", blurb: "Pure, mechanics & statistics" },
  { value: "Further_Maths", label: "Further Maths", blurb: "Complex numbers to matrices" },
  { value: "Physics", label: "Physics", blurb: "From mechanics to particle physics" },
  { value: "Chemistry", label: "Chemistry", blurb: "Organic, inorganic & physical" },
  { value: "Biology", label: "Biology", blurb: "Cell biology to ecology" },
  { value: "Computing", label: "Computing", blurb: "Algorithms, systems & programming" },
];

export const EXAM_BOARDS: { value: ExamBoard; label: string }[] = [
  { value: "AQA", label: "AQA" },
  { value: "Edexcel", label: "Edexcel" },
  { value: "OCR_A", label: "OCR A" },
  { value: "OCR_B", label: "OCR B" },
  { value: "WJEC", label: "WJEC" },
  { value: "CIE", label: "CIE" },
];

export function subjectLabel(s: StemSubject) {
  return SUBJECTS.find((x) => x.value === s)?.label ?? s;
}

/** "OCR_A" -> "OCR A". Board values are stored as enums; never render them raw. */
export function boardLabel(b: ExamBoard) {
  return EXAM_BOARDS.find((x) => x.value === b)?.label ?? String(b).replace(/_/g, " ");
}
