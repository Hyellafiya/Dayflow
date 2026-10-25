# Dayflow SaaS Starter

A fresh Dayflow codebase with a premium responsive interface, Supabase authentication, an Express API, task planning, optional OpenRouter planning, health/status checks, rate limiting, and a starter database schema.

## Included product areas
- Overview dashboard
- My tasks and task details
- Projects (starter view)
- Calendar (starter view)
- Inbox/review queue
- Research studio
- Documents studio
- Email drafting studio
- Browser tasks
- Analytics
- Integrations
- Activity log
- Plans & billing preview
- Profile, workspace, security, service, and privacy settings

## Important: starter vs production
This is a starter scaffold, not a fully launched SaaS. The following areas are intentionally not represented as complete when they are not implemented:
- Task storage currently uses in-memory storage; serverless restarts can clear tasks. A migration schema is included for a persistence phase.
- Project, calendar, inbox, analytics, and billing pages are starter views.
- Email delivery is disabled; only optional AI drafting is implemented.
- Browser execution, Google OAuth connector, real payment checkout/webhooks, document export, and research-source retrieval are not implemented.
- Do not charge users until billing, webhook verification, and server-side entitlement enforcement are complete.

## Install locally (Windows)
1. Install Node.js 20 or newer.
2. Extract this project folder.
3. Open Command Prompt in the folder.
4. Run `npm install`.
5. Copy `.env.example` to `.env` and fill in your own Supabase project URL and publishable key.
6. Set `SESSION_SECRET` to a unique random value at least 32 characters long.
7. Run `npm run dev`.
8. Visit `http://localhost:3000`.

Do not paste secrets into chat or commit `.env` to GitHub.

## Deploy to Vercel
1. Push this project to a new GitHub repository, or replace the existing repository after backing it up.
2. Import the repository into Vercel.
3. Add `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and `SESSION_SECRET` in Vercel Project Settings → Environment Variables for Production, Preview, and Development as needed.
4. Add `OPENROUTER_API_KEY` if you want AI-generated plans. Keep it server-side.
5. Redeploy after environment changes.
6. Test `/api/config` (must return JSON), `/api/health`, and the homepage.

## Existing Dayflow repository
If you want to replace the current repo, make a backup branch or download a ZIP first. Copy the new files over deliberately; don't mix old `src` routes blindly. The current `vercel.json` uses explicit builds/routes, so if Vercel reports a conflict, inspect the latest deployment logs before changing framework settings.

## Security notes
- Supabase's publishable key is intended for client use; never put the service-role key in the browser.
- API endpoints require a valid Supabase bearer token except config/health.
- Input validation and basic API rate limiting are enabled.
- Memory task storage is not suitable for production or multi-instance consistency.
