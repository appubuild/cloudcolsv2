-- Shape and length of uploaded media, recorded once at upload.
--
-- Without these, anything that wants a video's dimensions or duration has to fetch
-- the file's header from storage first — a range request across the world to learn
-- two numbers, repeated on every listing that wants to reserve the right space or
-- show a running time. The browser already knows all three the moment it generates
-- the thumbnail, so it costs nothing to record them.
--
-- All nullable: every file uploaded before today has none, and a video whose metadata
-- the browser could not read is a normal outcome rather than a failed upload.

alter table public.files
  add column if not exists width integer,
  add column if not exists height integer,
  add column if not exists duration_seconds numeric(10, 3);

-- Guard against a client sending nonsense. The values arrive from the browser, so
-- they are input, not facts: a negative duration or a 200-megapixel width is a bug
-- or an attack, and neither belongs in a column something will later divide by.
alter table public.files
  drop constraint if exists files_width_sane;
alter table public.files
  add constraint files_width_sane check (width is null or (width > 0 and width <= 100000));

alter table public.files
  drop constraint if exists files_height_sane;
alter table public.files
  add constraint files_height_sane check (height is null or (height > 0 and height <= 100000));

alter table public.files
  drop constraint if exists files_duration_sane;
alter table public.files
  add constraint files_duration_sane
  check (duration_seconds is null or (duration_seconds >= 0 and duration_seconds <= 604800));

comment on column public.files.width is 'Pixel width of an image or video, as read by the browser at upload.';
comment on column public.files.height is 'Pixel height of an image or video, as read by the browser at upload.';
comment on column public.files.duration_seconds is 'Playing time in seconds for audio and video.';
