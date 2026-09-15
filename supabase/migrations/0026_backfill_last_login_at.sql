-- last_login_at had never been written for anyone (see lib/api/password.ts): the
-- login route's update went out under the user's token and was refused. The
-- inactivity policy therefore measured every account from the day it was created.
--
-- Auth recorded the sign-ins the app lost, so take them from there. Only fills gaps;
-- a value the app did record is left alone.

update public.user_storage s
set last_login_at = u.last_sign_in_at
from auth.users u
where u.id = s.user_id
  and s.last_login_at is null
  and u.last_sign_in_at is not null;
