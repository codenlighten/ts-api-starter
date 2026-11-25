create table idempotency_keys (
  tenant_id uuid not null references tenants (id),
  key text not null,
  request_hash text not null,
  status_code integer,
  response_body jsonb,
  created_at timestamptz not null default now(),
  primary key (tenant_id, key)
);
