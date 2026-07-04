create or replace function set_table_label(p_table_no int, p_label_en text, p_label_zh text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if not is_admin() then raise exception 'not authorized'; end if;
  update tables set
    label_en = coalesce(nullif(trim(p_label_en), ''), format('Table %s', p_table_no)),
    label_zh = coalesce(nullif(trim(p_label_zh), ''), format('%s号桌', p_table_no))
  where table_no = p_table_no;
  if not found then raise exception 'unknown table'; end if;
end $$;

revoke execute on function set_table_label(int, text, text) from public, anon, authenticated;
grant execute on function set_table_label(int, text, text) to authenticated;
