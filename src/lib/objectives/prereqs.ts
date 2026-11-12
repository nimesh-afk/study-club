// Prerequisite checks for the objective map. Pure functions, no I/O.

export type PrereqEdge = { objective_id: string; prereq_id: string };

// Would giving `objectiveId` these prerequisites create a loop
// (A needs B ... needs A)? `edges` are all existing links in the subject.
export function createsLoop(
  edges: PrereqEdge[],
  objectiveId: string,
  newPrereqIds: string[],
): boolean {
  // The objective's own current links are being replaced, so ignore them.
  const needs = new Map<string, string[]>();
  for (const e of edges) {
    if (e.objective_id === objectiveId) continue;
    needs.set(e.objective_id, [...(needs.get(e.objective_id) ?? []), e.prereq_id]);
  }
  // A loop exists if any new prerequisite (directly or indirectly) needs objectiveId.
  const seen = new Set<string>();
  const stack = [...newPrereqIds];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current === objectiveId) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    stack.push(...(needs.get(current) ?? []));
  }
  return false;
}
