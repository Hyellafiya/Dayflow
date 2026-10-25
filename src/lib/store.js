import { randomUUID } from "node:crypto";

/**
 * Local development fallback only. Serverless memory is ephemeral.
 * Production persistence should use Supabase tables (see schema.sql).
 */
const tasks = new Map();
const events = new Map();

export function listTasks(userId) {
  return [...tasks.values()].filter(t => t.userId === userId).sort((a,b) => b.updatedAt.localeCompare(a.updatedAt));
}
export function getTask(userId, id) {
  const t = tasks.get(id);
  return t?.userId === userId ? structuredClone(t) : null;
}
export function addEvent(task, type, message) {
  task.events ||= [];
  task.events.push({ id: randomUUID(), type, message, at: new Date().toISOString() });
}
export function createTask(userId, input) {
  const now = new Date().toISOString();
  const task = {
    id: randomUUID(), userId, instruction: input.instruction, mode: input.mode || "plan",
    status: "planned", createdAt: now, updatedAt: now,
    plan: [
      { title: "Clarify the outcome", description: "Confirm the goal and what a useful result should include." },
      { title: "Prepare the work", description: "Organize the request into a practical sequence of steps." },
      { title: "Review the result", description: "Inspect the outcome and decide what to do next." }
    ],
    internalPlan: { summary: "A starter plan is ready for your review. Configure an AI provider to generate richer plans." },
    result: null, approval: { required: false, approved: false, reason: "" }, events: []
  };
  addEvent(task, "info", "Task created and initial plan prepared.");
  tasks.set(task.id, task);
  return structuredClone(task);
}
export function updateTask(userId, id, updater) {
  const current = tasks.get(id);
  if (!current || current.userId !== userId) return null;
  const next = structuredClone(current);
  updater(next);
  next.updatedAt = new Date().toISOString();
  tasks.set(id, next);
  return structuredClone(next);
}
export function clearForTests() { tasks.clear(); events.clear(); }