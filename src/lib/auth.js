
import { createClient } from "@supabase/supabase-js";

export function createAuthClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;

  if (!url || !key) return null;

  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    }
  });
}

export function createUserDb(accessToken) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;

  if (!url || !key || !accessToken) {
    throw new Error("Supabase user database configuration is missing.");
  }

  return createClient(url, key, {
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    }
  });
}

export async function requireUser(req, res, next) {
  try {
    const client = req.app.locals.supabase;

    if (!client) {
      return res.status(503).json({
        error: "Authentication is not configured. Check the Supabase environment variables."
      });
    }

    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ")
      ? header.slice(7)
      : "";

    if (!token) {
      return res.status(401).json({
        error: "Sign in to continue."
      });
    }

    const { data, error } = await client.auth.getUser(token);

    if (error || !data?.user) {
      return res.status(401).json({
        error: "Your session is invalid or expired. Sign in again."
      });
    }

    req.user = data.user;
    req.accessToken = token;
    next();
  } catch {
    return res.status(401).json({
      error: "Could not validate your session."
    });
  }
}
