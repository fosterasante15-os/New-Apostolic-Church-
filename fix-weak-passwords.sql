-- ==============================================================================
-- Run in Supabase -> SQL Editor.  Do STEP 1 first, then STEP 2.
-- ==============================================================================

-- STEP 1 (read-only): list every account that still uses an easy password.
-- Select ONLY this statement, click Run, and read the result.
select email,
       case when encrypted_password = crypt('12345678',  encrypted_password) then '12345678'
            when encrypted_password = crypt('admin123',  encrypted_password) then 'admin123'
            when encrypted_password = crypt('password',  encrypted_password) then 'password'
            when encrypted_password = crypt('password123', encrypted_password) then 'password123'
            when encrypted_password = crypt('admin',     encrypted_password) then 'admin'
       end as weak_password
from auth.users
where encrypted_password = crypt('12345678',  encrypted_password)
   or encrypted_password = crypt('admin123',  encrypted_password)
   or encrypted_password = crypt('password',  encrypted_password)
   or encrypted_password = crypt('password123', encrypted_password)
   or encrypted_password = crypt('admin',     encrypted_password);


-- STEP 2: set a new password for the Main Admin and sign that account out of every device.
-- Replace TYPE-YOUR-NEW-PASSWORD-HERE with your real password (at least 8 characters),
-- keep the quotes, then select this whole block and click Run.
-- Type the password here in Supabase only. Never save it in GitHub or send it in a chat.
do $$
declare
  v_email    text := 'fosterasante15@gmail.com';
  v_password text := 'TYPE-YOUR-NEW-PASSWORD-HERE';
  v_id uuid;
begin
  if v_password = 'TYPE-YOUR-NEW-PASSWORD-HERE' or length(v_password) < 8 then
    raise exception 'Put your real password (at least 8 characters) in v_password before running.';
  end if;
  select id into v_id from auth.users where email = v_email;
  if v_id is null then raise exception 'No account found for %', v_email; end if;

  update auth.users
     set encrypted_password = crypt(v_password, gen_salt('bf')), updated_at = now()
   where id = v_id;

  delete from auth.sessions where user_id = v_id;     -- every phone/computer must sign in again with the new password
  raise notice 'Password changed for %. All devices are signed out.', v_email;
end $$;
