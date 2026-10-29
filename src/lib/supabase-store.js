
import { randomUUID } from "node:crypto";

function check(result) {
  if (result.error) {
    throw new Error(`Dayflow database error: ${result.error.message}`);
  }
  return result.data;
}

async function ensureWorkspace(db, userId) {
  const membership = check(
    await db
      .from("workspace_members")
      .select("workspace_id")
      .eq("user_id", userId)
      .limit(1)
  );

  if (membership?.length) return membership[0].workspace_id;

  const workspaceId = randomUUID();

  check(
    await db.from("workspaces").insert({
      id: workspaceId,
      name: "Personal workspace",
      owner_id: userId
    })
  );

  check(
    await db.from("workspace_members").insert({
      workspace_id: workspaceId,
      user_id: userId,
      role: "owner"
    })
  );

  return workspaceId;
}

async function readEvents(db, taskId) {
  return check(
    await db
      .from("task_events")
      .select("id,event_type,message,created_at")
      .eq("task_id", taskId)
      .order("created_at", { ascending: true })
  ) || [];
}

function mapTask(row, events = []) {
  return {
    id: row.id,
    userId: row.created_by,
    instruction: row.instruction,
    mode: row.mode,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    plan: row.plan || [],
    internalPlan: {
      summary: "Task saved in your Dayflow workspace."
    },
    result: row.result ?? null,
    approval: {
      required: false,
      approved: false,
      reason: ""
    },
    events: events.map(event => ({
      id: event.id,
      type: event.event_type,
      message: event.message,
      at: event.created_at
    }))
  };
}

export async function listTasks(db, userId) {
  const workspaceId = await ensureWorkspace(db, userId);

  const rows = check(
    await db
      .from("tasks")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("updated_at", { ascending: false })
  ) || [];

  return Promise.all(
    rows.map(async row => mapTask(row, await readEvents(db, row.id)))
  );
}

export async function getTask(db, userId, taskId) {
  const workspaceId = await ensureWorkspace(db, userId);

  const rows = check(
    await db
      .from("tasks")
      .select("*")
      .eq("id", taskId)
      .eq("workspace_id", workspaceId)
      .limit(1)
  ) || [];

  if (!rows.length) return null;

  return mapTask(rows[0], await readEvents(db, taskId));
}

export async function createTask(db, userId, input) {
  const workspaceId = await ensureWorkspace(db, userId);
  const now = new Date().toISOString();

  const row = {
    id: randomUUID(),
    workspace_id: workspaceId,
    created_by: userId,
    title: String(input.instruction || "New task").slice(0, 120),
    instruction: input.instruction,
    mode: input.mode || "plan",
    status: "planned",
    plan: [
      {
        title: "Prepare the work",
        description: "Organize the request into practical steps."
      },
      {
        title: "Review the result",
        description: "Check the outcome before relying on it."
      }
    ],
    result: null,
    created_at: now,
    updated_at: now
  };

  const inserted = check(
    await db.from("tasks").insert(row).select("*").single()
  );

  check(
    await db.from("task_events").insert({
      task_id: inserted.id,
      actor_id: userId,
      event_type: "info",
      message: "Task created and saved.",
      metadata: {}
    })
  );

  return getTask(db, userId, inserted.id);
}

export async function updateTask(db, userId, taskId, updater) {
  const current = await getTask(db, userId, taskId);
  if (!current) return null;

  const next = structuredClone(current);
  updater(next);

  const workspaceId = await ensureWorkspace(db, userId);

  const updated = check(
    await db
      .from("tasks")
      .update({
        status: next.status,
        plan: next.plan || [],
        result: next.result ?? null,
        updated_at: new Date().toISOString()
      })
      .eq("id", taskId)
      .eq("workspace_id", workspaceId)
      .select("id")
      .maybeSingle()
  );

  if (!updated) return null;

  const previousIds = new Set(current.events.map(event => event.id));
  const newEvents = next.events.filter(event => !previousIds.has(event.id));

  for (const event of newEvents) {
    check(
      await db.from("task_events").insert({
        task_id: taskId,
        actor_id: userId,
        event_type: event.type || "info",
        message: event.message || "Task updated.",
        metadata: {}
      })
    );
  }

  return getTask(db, userId, taskId);
}
