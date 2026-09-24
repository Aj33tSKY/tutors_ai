-- Session review reads this optional key when a consented recording is later
-- stored in the private session-recordings bucket.
alter table public.session_analytics add column if not exists recording_path text;
