-- PROMPT 5 : paramÃ¨tres gÃ©nÃ©raux (singleton), catÃ©gories documentaires, journalisation.

create table public.app_settings (
  id smallint primary key default 1 check (id = 1),
  legal_name text not null default 'EBI-IMT',
  trade_name text,
  address text,
  city text,
  country_code text not null default 'TG',
  phone text,
  email text,
  website text,
  logo_url text,
  display_prefs jsonb not null default '{"scene3d": true}'::jsonb,
  currency text not null default 'XOF' check (currency = 'XOF'),
  retention jsonb not null default '{"library_years": 5, "audit_years": 10}'::jsonb,
  finance jsonb not null default '{"default_vat_pct": 18, "late_fee_pct": 1}'::jsonb,
  enabled_modules text[] not null default '{}'::text[],
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);

create table public.library_categories (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  label text not null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

insert into public.app_settings (id) values (1) on conflict (id) do nothing;

alter table public.app_settings enable row level security;
alter table public.library_categories enable row level security;

create policy settings_select on public.app_settings
  for select using (private.can_read_all());
create policy settings_write on public.app_settings
  for update using (private.current_role_code() = 'admin')
  with check (private.current_role_code() = 'admin');

create policy category_select on public.library_categories
  for select using (private.can_read_all());
create policy category_write on public.library_categories
  for insert with check (private.current_role_code() = 'admin');
create policy category_update on public.library_categories
  for update using (private.current_role_code() = 'admin')
  with check (private.current_role_code() = 'admin');
create policy category_delete on public.library_categories
  for delete using (private.current_role_code() = 'admin');

create or replace function public.app_settings_touch()
  returns trigger
  language plpgsql
  set search_path to ''
as $function$
begin
  new.updated_by := auth.uid();
  new.updated_at := pg_catalog.now();
  return new;
end $function$;

create trigger app_settings_touch
  before update on public.app_settings
  for each row execute function public.app_settings_touch();

create trigger audit_app_settings
  after insert or update on public.app_settings
  for each row execute function public.crm_audit_row();

create trigger audit_library_categories
  after insert or update or delete on public.library_categories
  for each row execute function public.crm_audit_row();
