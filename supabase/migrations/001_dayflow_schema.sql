-- Dayflow persistent storage schema
create extension if not exists pgcrypto;

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Personal workspace',
  owner_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member'
    check (role in ('owner','admin','member')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  name text not null,
  description text not null default '',
  status text not null default 'active'
    check (status in ('active','paused','completed','archived')),
  due_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  created_by uuid not null references auth.users(id) on delete cascade,
  title text not null,
  instruction text not null,
  mode text not null default 'plan'
    check (mode in ('plan','research','document','email','browser')),
  status text not null default 'planned'
    check (status in ('planned','running','awaiting_approval','completed','failed','cancelled')),
  plan jsonb not null default '[]'::jsonb,
  result jsonb,
  due_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.task_events (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  event_type text not null,
  message text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null unique references public.workspaces(id) on delete cascade,
  provider text,
  provider_customer_id text,
  provider_subscription_id text unique,
  plan_key text not null default 'free',
  status text not null default 'free'
    check (status in ('free','trialing','active','past_due','cancelled','incomplete')),
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.projects enable row level security;
alter table public.tasks enable row level security;
alter table public.task_events enable row level security;
alter table public.subscriptions enable row level security;

-- Secure helper for the first workspace owner membership.
create or replace function public.dayflow_is_workspace_owner(
  target_workspace uuid,
  target_user uuid
)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1
    from public.workspaces w
    where w.id = target_workspace
      and w.owner_id = target_user
  );
$$;

revoke all on function public.dayflow_is_workspace_owner(uuid, uuid) from public;
grant execute on function public.dayflow_is_workspace_owner(uuid, uuid) to authenticated;

-- Remove existing named policies before recreating them.
drop policy if exists "members can read their workspaces" on public.workspaces;
drop policy if exists "owners can create workspaces" on public.workspaces;
drop policy if exists "members can read memberships" on public.workspace_members;
drop policy if exists "owners can add initial membership" on public.workspace_members;
drop policy if exists "workspace members read projects" on public.projects;
drop policy if exists "workspace members create projects" on public.projects;
drop policy if exists "workspace members update projects" on public.projects;
drop policy if exists "workspace members read tasks" on public.tasks;
drop policy if exists "workspace members create tasks" on public.tasks;
drop policy if exists "workspace members update tasks" on public.tasks;
drop policy if exists "workspace members delete tasks" on public.tasks;
drop policy if exists "workspace members read task events" on public.task_events;
drop policy if exists "workspace members create task events" on public.task_events;
drop policy if exists "members read own workspace subscription" on public.subscriptions;

create policy "members can read their workspaces"
on public.workspaces for select to authenticated
using (
  exists (
    select 1 from public.workspace_members m
    where m.workspace_id = workspaces.id
      and m.user_id = auth.uid()
  )
);

create policy "owners can create workspaces"
on public.workspaces for insert to authenticated
with check (owner_id = auth.uid());

create policy "members can read memberships"
on public.workspace_members for select to authenticated
using (user_id = auth.uid());

create policy "owners can add initial membership"
on public.workspace_members for insert to authenticated
with check (
  user_id = auth.uid()
  and role = 'owner'
  and public.dayflow_is_workspace_owner(workspace_id, auth.uid())
);

create policy "workspace members read projects"
on public.projects for select to authenticated
using (
  exists (
    select 1 from public.workspace_members m
    where m.workspace_id = projects.workspace_id
      and m.user_id = auth.uid()
  )
);

create policy "workspace members create projects"
on public.projects for insert to authenticated
with check (
  created_by = auth.uid()
  and exists (
    select 1 from public.workspace_members m
    where m.workspace_id = projects.workspace_id
      and m.user_id = auth.uid()
  )
);

create policy "workspace members update projects"
on public.projects for update to authenticated
using (
  exists (
    select 1 from public.workspace_members m
    where m.workspace_id = projects.workspace_id
      and m.user_id = auth.uid()
  )
)
with check (
  created_by = auth.uid()
  and exists (
    select 1 from public.workspace_members m
    where m.workspace_id = projects.workspace_id
      and m.user_id = auth.uid()
  )
);

create policy "workspace members read tasks"
on public.tasks for select to authenticated
using (
  exists (
    select 1 from public.workspace_members m
    where m.workspace_id = tasks.workspace_id
      and m.user_id = auth.uid()
  )
);

create policy "workspace members create tasks"
on public.tasks for insert to authenticated
with check (
  created_by = auth.uid()
  and exists (
    select 1 from public.workspace_members m
    where m.workspace_id = tasks.workspace_id
      and m.user_id = auth.uid()
  )
);

create policy "workspace members update tasks"
on public.tasks for update to authenticated
using (
  exists (
    select 1 from public.workspace_members m
    where m.workspace_id = tasks.workspace_id
      and m.user_id = auth.uid()
  )
)
with check (
  created_by = auth.uid()
  and exists (
    select 1 from public.workspace_members m
    where m.workspace_id = tasks.workspace_id
      and m.user_id = auth.uid()
  )
);

create policy "workspace members delete tasks"
on public.tasks for delete to authenticated
using (
  exists (
    select 1 from public.workspace_members m
    where m.workspace_id = tasks.workspace_id
      and m.user_id = auth.uid()
  )
);

create policy "workspace members read task events"
on public.task_events for select to authenticated
using (
  exists (
    select 1
    from public.tasks t
    join public.workspace_members m
      on m.workspace_id = t.workspace_id
    where t.id = task_events.task_id
      and m.user_id = auth.uid()
  )
);

create policy "workspace members create task events"
on public.task_events for insert to authenticated
with check (
  actor_id = auth.uid()
  and exists (
    select 1
    from public.tasks t
    join public.workspace_members m
      on m.workspace_id = t.workspace_id
    where t.id = task_events.task_id
      and m.user_id = auth.uid()
  )
);

create policy "members read own workspace subscription"
on public.subscriptions for select to authenticated
using (
  exists (
    select 1 from public.workspace_members m
    where m.workspace_id = subscriptions.workspace_id
      and m.user_id = auth.uid()
  )
);

-- Subscription writes must come from trusted server-side code.
