-- Promote an existing user to admin (run in Supabase SQL Editor).
-- Prerequisite: the user must exist in auth.users (signed up) AND in public.users (same id).
-- This does NOT set their password — set that in Dashboard → Authentication → Users, or use Forgot password.

UPDATE public.users
SET role = 'admin'
WHERE lower(trim(email)) = lower(trim('sahidh.drunkeelabadmin@gmail.com'));

-- Optional: confirm row updated
-- SELECT id, email, role FROM public.users WHERE lower(trim(email)) = lower(trim('sahidh.drunkeelabadmin@gmail.com'));
