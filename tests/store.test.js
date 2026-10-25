import test from "node:test";
import assert from "node:assert/strict";
import { createTask, getTask, listTasks, updateTask, clearForTests } from "../src/lib/store.js";

test("tasks are scoped to their owner", () => {
  clearForTests();
  const task = createTask("user-a", { instruction: "Prepare a project plan", mode: "plan" });
  assert.equal(getTask("user-a", task.id).id, task.id);
  assert.equal(getTask("user-b", task.id), null);
  assert.equal(listTasks("user-a").length, 1);
  assert.equal(listTasks("user-b").length, 0);
});
test("task update changes status", () => {
  clearForTests();
  const task = createTask("user-a", { instruction: "Prepare a project plan", mode: "plan" });
  const updated = updateTask("user-a", task.id, t => { t.status = "completed"; });
  assert.equal(updated.status, "completed");
});
