-- Direct messaging for the portable API.
--
-- 1. The private attachment bucket is declared here instead of being a
--    dashboard-only step. Limits repeat what the API enforces, so a client that
--    talks to Storage directly cannot exceed them either. SVG is deliberately
--    absent: it can carry script and is opened from a signed URL.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('message-attachments', 'message-attachments', false, 10485760,
  array['image/png','image/jpeg','image/gif','image/webp','application/pdf','application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- 2. A message may only reference an object in its own conversation, uploaded
--    by its own sender. NOT VALID enforces this for every new row without
--    rejecting historical rows written before the API owned uploads.
alter table public.direct_messages add constraint direct_messages_attachment_scope check (
  attachment_path is null or (
    attachment_name is not null and attachment_type is not null
    and attachment_path like conversation_id::text || '/' || sender_id::text || '/%'
    and attachment_path !~ '(^|/)\.\.(/|$)'
  )
) not valid;

-- 3. Bumping the conversation's ordering timestamp is part of sending, not a
--    second write the browser might never make. The function is internal and
--    only touches the conversation of the row that caused it.
create function private.touch_direct_conversation() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.direct_conversations set updated_at = greatest(updated_at, new.created_at) where id = new.conversation_id;
  return new;
end;
$$;
revoke all on function private.touch_direct_conversation() from public, anon, authenticated, service_role;
create trigger touch_direct_conversation after insert on public.direct_messages
for each row execute function private.touch_direct_conversation();

-- 4. Cursor pagination reads newest-first by (created_at, id).
create index if not exists direct_messages_conversation_cursor_idx
  on public.direct_messages (conversation_id, created_at desc, id desc);
