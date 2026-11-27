// Topic stages and topic order (CLAUDE.md 1 "Topic progress"). Pure functions.

export type Stage =
  | "locked"
  | "notes_in"
  | "checkpoint_passed"
  | "practising"
  | "secure"
  | "explained";

export const STAGE_LABEL: Record<Stage, string> = {
  locked: "Not started",
  notes_in: "Notes in",
  checkpoint_passed: "Checkpoint passed",
  practising: "Practising",
  secure: "Secure",
  explained: "Explained",
};

const ORDER: Stage[] = ["locked", "notes_in", "checkpoint_passed", "practising", "secure", "explained"];

// True if `stage` is at or past `target`.
export function reached(stage: Stage, target: Stage): boolean {
  return ORDER.indexOf(stage) >= ORDER.indexOf(target);
}

// Can the student start this topic? A topic marked "keep in order" (locked)
// needs every earlier approved topic of the subject past its checkpoint.
export function canStartTopic(
  topic: { id: string; locked: boolean; sort_order: number },
  subjectTopics: { id: string; sort_order: number }[],
  stageOf: (topicId: string) => Stage,
): boolean {
  if (!topic.locked) return true;
  return subjectTopics
    .filter((t) => t.sort_order < topic.sort_order)
    .every((t) => reached(stageOf(t.id), "checkpoint_passed"));
}
