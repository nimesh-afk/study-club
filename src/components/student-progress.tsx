// One student's progress: each subject with its approved topics and the
// student's stage on each (CLAUDE.md 1 "Topic progress"). Server component;
// the caller fetches the data with its own session (RLS decides who sees what).
import { STAGE_LABEL, reached, type Stage } from "@/lib/progress/stages";

export const STAGE_STYLE: Record<Stage, string> = {
  locked: "bg-zinc-100 text-zinc-700",
  notes_in: "bg-blue-100 text-blue-900",
  checkpoint_passed: "bg-indigo-100 text-indigo-900",
  practising: "bg-amber-100 text-amber-900",
  secure: "bg-green-100 text-green-900",
  explained: "bg-green-200 text-green-950",
};

export type ProgressTopic = { id: string; subject_id: string; title: string | null; statement: string };
export type ProgressSubject = { id: string; name: string };

export function StudentProgress({
  subjects,
  topics,
  stageOf,
}: {
  subjects: ProgressSubject[];
  topics: ProgressTopic[];
  stageOf: (topicId: string) => Stage;
}) {
  const withTopics = subjects.filter((s) => topics.some((t) => t.subject_id === s.id));
  if (withTopics.length === 0) return <p className="text-sm text-zinc-600">No topics are ready yet.</p>;
  return (
    <div className="flex flex-col gap-5">
      {withTopics.map((subject) => {
        const list = topics.filter((t) => t.subject_id === subject.id);
        const started = list.filter((t) => stageOf(t.id) !== "locked").length;
        const passed = list.filter((t) => reached(stageOf(t.id), "checkpoint_passed")).length;
        const secure = list.filter((t) => reached(stageOf(t.id), "secure")).length;
        return (
          <div key={subject.id}>
            <h3 className="font-medium">{subject.name}</h3>
            <p className="text-sm text-zinc-600">
              {list.length} topics · {started} started · {passed} checkpoints passed · {secure} secure
            </p>
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {list.map((t) => {
                const stage = stageOf(t.id);
                return (
                  <li
                    key={t.id}
                    title={`${t.title ?? t.statement}: ${STAGE_LABEL[stage]}`}
                    className={`rounded px-2 py-1 text-xs ${STAGE_STYLE[stage]}`}
                  >
                    {t.title ?? t.statement}
                    <span className="sr-only">: {STAGE_LABEL[stage]}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
      <p className="flex flex-wrap gap-1.5 text-xs text-zinc-600">
        {(Object.keys(STAGE_LABEL) as Stage[]).map((s) => (
          <span key={s} className={`rounded px-2 py-0.5 ${STAGE_STYLE[s]}`}>
            {STAGE_LABEL[s]}
          </span>
        ))}
      </p>
    </div>
  );
}
