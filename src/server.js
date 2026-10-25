import "dotenv/config";
import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { createAuthClient, requireUser } from "./lib/auth.js";
import { listTasks, getTask, createTask, updateTask, addEvent } from "./lib/store.js";

const app = express();
app.disable("x-powered-by");
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(express.json({ limit: "1mb" }));
app.use("/api", rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: "draft-8", legacyHeaders: false }));
app.locals.supabase = createAuthClient();

const TaskInput = z.object({
  instruction: z.string().trim().min(8).max(4000),
  mode: z.enum(["plan", "document", "email", "browser", "research"]).default("plan")
});
const EmailDraftInput = z.object({ instruction: z.string().trim().min(8).max(4000) });
const EmailSendInput = z.object({
  to: z.string().email().max(320),
  subject: z.string().trim().min(1).max(250),
  body: z.string().trim().min(1).max(20000),
  approved: z.literal(true)
});

app.get("/api/config", (_req,res) => res.json({
  supabaseUrl: process.env.SUPABASE_URL || "",
  supabasePublishableKey: process.env.SUPABASE_PUBLISHABLE_KEY || "",
  authConfigured: Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_PUBLISHABLE_KEY),
  appName: "Dayflow"
}));
app.get("/api/health", (_req,res) => res.json({
  ok: true, authConfigured: Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_PUBLISHABLE_KEY),
  aiConfigured: Boolean(process.env.OPENROUTER_API_KEY),
  researchConfigured: Boolean(process.env.TAVILY_API_KEY),
  browserConfigured: Boolean(process.env.BROWSERBASE_API_KEY && process.env.BROWSERBASE_PROJECT_ID),
  googleOAuthConfigured: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
  persistence: "memory-fallback",
  timestamp: new Date().toISOString()
}));
app.get("/api/me", requireUser, (req,res) => res.json({
  id: req.user.id, email: req.user.email, createdAt: req.user.created_at,
  role: req.user.role || "authenticated"
}));
app.get("/api/tasks", requireUser, (req,res) => res.json(listTasks(req.user.id)));
app.post("/api/tasks", requireUser, async (req,res) => {
  const parsed = TaskInput.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid task." });
  let task = createTask(req.user.id, parsed.data);
  if (process.env.OPENROUTER_API_KEY) {
    try {
      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, "Content-Type": "application/json", "HTTP-Referer": process.env.APP_URL || "http://localhost:3000", "X-Title": "Dayflow" },
        body: JSON.stringify({
          model: process.env.OPENROUTER_MODEL || "openai/gpt-4.1-mini",
          messages: [
            { role: "system", content: "You are Dayflow, a careful productivity planner. Return ONLY JSON: {\"summary\":\"...\",\"steps\":[{\"title\":\"...\",\"description\":\"...\"}]}. Give 3-7 concrete steps. Never claim to have performed external actions." },
            { role: "user", content: `Mode: ${parsed.data.mode}\nGoal: ${parsed.data.instruction}` }
          ],
          response_format: { type: "json_object" }, temperature: 0.3
        })
      });
      if (!response.ok) throw new Error(`AI provider returned ${response.status}`);
      const data = await response.json();
      const content = data.choices?.[0]?.message?.content;
      const plan = JSON.parse(content);
      if (!Array.isArray(plan.steps) || plan.steps.length < 1) throw new Error("AI returned an invalid plan");
      task = updateTask(req.user.id, task.id, t => {
        t.plan = plan.steps.slice(0,8).map(s => ({ title: String(s.title || "Next step").slice(0,160), description: String(s.description || "").slice(0,800) }));
        t.internalPlan = { summary: String(plan.summary || "Plan generated.").slice(0,1500) };
        t.status = "planned";
        addEvent(t, "success", "AI plan generated.");
      });
    } catch (e) {
      task = updateTask(req.user.id, task.id, t => addEvent(t, "error", "AI planning was unavailable; using the starter plan."));
    }
  }
  res.status(201).json(task);
});
app.get("/api/tasks/:id", requireUser, (req,res) => {
  const task = getTask(req.user.id, req.params.id);
  if (!task) return res.status(404).json({ error: "Task not found." });
  res.json(task);
});
app.post("/api/tasks/:id/approve", requireUser, (req,res) => {
  if (req.body?.approved !== true) return res.status(400).json({ error: "Explicit approval is required." });
  const task = updateTask(req.user.id, req.params.id, t => {
    t.approval = { required: false, approved: true, reason: "User approved the task." };
    addEvent(t, "success", "User approved the task.");
  });
  if (!task) return res.status(404).json({ error: "Task not found." });
  res.json(task);
});
app.post("/api/tasks/:id/run", requireUser, (req,res) => {
  const task = updateTask(req.user.id, req.params.id, t => {
    t.status = "completed";
    t.result = { summary: "This starter version records completion of the reviewed plan. It does not claim that external work was executed." };
    addEvent(t, "success", "Plan marked complete by the user.");
  });
  if (!task) return res.status(404).json({ error: "Task not found." });
  res.json(task);
});
app.post("/api/email/draft", requireUser, async (req,res) => {
  const parsed = EmailDraftInput.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid instruction." });
  if (!process.env.OPENROUTER_API_KEY) return res.status(503).json({ error: "AI drafting is not configured. Add OPENROUTER_API_KEY on the server." });
  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST", headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: process.env.OPENROUTER_MODEL || "openai/gpt-4.1-mini", messages: [
        { role: "system", content: "Draft a helpful professional email. Return only JSON with subject and body strings. Do not send it." },
        { role: "user", content: parsed.data.instruction }
      ], response_format: { type: "json_object" }, temperature: 0.4 })
    });
    if (!response.ok) throw new Error("AI provider request failed.");
    const data = await response.json();
    const draft = JSON.parse(data.choices?.[0]?.message?.content || "{}");
    res.json({ subject: String(draft.subject || "").slice(0,250), body: String(draft.body || "").slice(0,20000), sendEnabled: false });
  } catch { res.status(502).json({ error: "Couldn't generate a draft. Check the AI provider configuration." }); }
});
app.post("/api/email/send", requireUser, (_req,res) => res.status(501).json({
  error: "Email sending is not connected yet. Configure and test a provider integration before enabling delivery."
}));
app.get("/api/connectors/google/status", requireUser, (_req,res) => res.json({
  configured: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
  connected: false, message: "Google OAuth connection flow is not implemented in this starter."
}));
app.get("/api/connectors/google/start", requireUser, (_req,res) => res.status(501).json({
  error: "Google OAuth is not implemented yet. Configure the provider and callback flow first."
}));
app.use("/api", (_req,res) => res.status(404).json({ error: "API endpoint not found." }));
app.use(express.static("public"));
app.get("*path", (req,res,next) => {
  if (req.path.startsWith("/api/")) return next();
  res.sendFile("index.html", { root: "public" });
});
app.use((err,_req,res,_next) => {
  console.error("Request error:", err?.message || "unknown");
  res.status(500).json({ error: "Unexpected server error. Check server logs." });
});
if (process.env.NODE_ENV !== "production" && process.env.SESSION_SECRET && process.env.SESSION_SECRET.length < 32) {
  console.warn("SESSION_SECRET should be at least 32 characters.");
}
export default app;
