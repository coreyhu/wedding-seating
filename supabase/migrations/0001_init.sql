create extension if not exists unaccent;
create extension if not exists pg_trgm;

create table tables (
  table_no int primary key check (table_no between 1 and 12),
  label_en text not null,
  label_zh text not null
);

create table guests (
  id uuid primary key default gen_random_uuid(),
  name_en text not null default '',
  name_zh text not null default '',
  table_no int references tables(table_no),
  seat_no int check (seat_no between 1 and 8),
  check (name_en <> '' or name_zh <> ''),
  check ((table_no is null) = (seat_no is null)),
  constraint guests_one_per_seat unique (table_no, seat_no) deferrable initially immediate,
  constraint guests_identity unique (name_en, name_zh)
);

alter table tables enable row level security;
alter table guests enable row level security;

create policy tables_read on tables for select to anon, authenticated using (true);
create policy guests_read_auth on guests for select to authenticated using (true);
-- deliberately NO anon policy on guests; also revoke to fail loudly:
revoke all on guests from anon;

-- admin allowlist: signups are disabled in config, and write RPCs additionally
-- require the caller's uid to be in this table (the anon key is public by
-- design, so "any authenticated user" is not a sufficient gate).
create table admins (user_id uuid primary key);
alter table admins enable row level security;  -- no policies: not readable/writable via API

create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as
$$ select exists (select 1 from admins where user_id = auth.uid()) $$;

create or replace function normalize_en(s text) returns text
language sql immutable as $$
  select lower(regexp_replace(unaccent(coalesce(s, '')), '\s', '', 'g'))
$$;

create or replace function search_guests(q text)
returns table (id uuid, name_en text, name_zh text, table_no int, seat_no int, label_en text, label_zh text)
language plpgsql security definer set search_path = public as $$
declare
  norm text := normalize_en(q);
  is_cjk boolean := coalesce(q, '') ~ '[一-鿿]';
begin
  if is_cjk then
    return query
      select g.id, g.name_en, g.name_zh, g.table_no, g.seat_no, t.label_en, t.label_zh
      from guests g left join tables t on t.table_no = g.table_no
      where replace(g.name_zh, ' ', '') like '%' || replace(trim(q), ' ', '') || '%'
      limit 20;
  elsif char_length(norm) >= 2 then
    return query
      select g.id, g.name_en, g.name_zh, g.table_no, g.seat_no, t.label_en, t.label_zh
      from guests g left join tables t on t.table_no = g.table_no
      where normalize_en(g.name_en) like '%' || norm || '%'
         or similarity(normalize_en(g.name_en), norm) > 0.4
      order by (normalize_en(g.name_en) like norm || '%') desc
      limit 20;
  end if; -- too-short queries return nothing
end $$;

create or replace function assign_seat(p_guest_id uuid, p_table_no int, p_seat_no int)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_occupant uuid;
  v_old_table int; v_old_seat int;
begin
  if not is_admin() then raise exception 'not authorized'; end if;
  set constraints guests_one_per_seat deferred;
  select g.table_no, g.seat_no into v_old_table, v_old_seat from guests g where g.id = p_guest_id;
  if not found then raise exception 'unknown guest'; end if;
  select g.id into v_occupant from guests g
    where g.table_no = p_table_no and g.seat_no = p_seat_no and g.id <> p_guest_id;
  if v_occupant is not null then
    update guests set table_no = v_old_table, seat_no = v_old_seat where id = v_occupant;
  end if;
  update guests set table_no = p_table_no, seat_no = p_seat_no where id = p_guest_id;
end $$;

create or replace function unseat(p_guest_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'not authorized'; end if;
  update guests set table_no = null, seat_no = null where id = p_guest_id;
end $$;

create or replace function import_guests(rows jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare v_count int;
begin
  if not is_admin() then raise exception 'not authorized'; end if;
  insert into guests (name_en, name_zh)
  select trim(coalesce(r->>'name_en', '')), trim(coalesce(r->>'name_zh', ''))
  from jsonb_array_elements(rows) r
  where trim(coalesce(r->>'name_en', '')) <> '' or trim(coalesce(r->>'name_zh', '')) <> ''
  on conflict on constraint guests_identity do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

revoke execute on all functions in schema public from anon, authenticated;
grant execute on function search_guests(text) to anon, authenticated;
grant execute on function assign_seat(uuid, int, int) to authenticated;
grant execute on function unseat(uuid) to authenticated;
grant execute on function import_guests(jsonb) to authenticated;
