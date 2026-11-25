create table tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 100),
  created_at timestamptz not null default now()
);

create table users (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id),
  email text not null unique check (email = lower(email)),
  password_hash text not null,
  created_at timestamptz not null default now()
);

create table projects (
  seq bigint generated always as identity,
  id uuid not null default gen_random_uuid(),
  tenant_id uuid not null references tenants (id),
  name text not null check (length(name) between 1 and 200),
  created_at timestamptz not null default now(),
  primary key (id),
  -- target of the composite foreign key below, so a task can only point at a
  -- project of its own tenant
  unique (tenant_id, id)
);
create index projects_tenant_seq on projects (tenant_id, seq desc);

create table tasks (
  seq bigint generated always as identity,
  id uuid not null default gen_random_uuid(),
  tenant_id uuid not null references tenants (id),
  project_id uuid not null,
  title text not null check (length(title) between 1 and 300),
  status text not null default 'todo' check (status in ('todo', 'doing', 'done')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (id),
  foreign key (tenant_id, project_id) references projects (tenant_id, id)
);
create index tasks_project_seq on tasks (tenant_id, project_id, seq desc);
