-- Seed initial admin user
-- Run this ONCE after the admin_users migration has been applied
-- Replace the UUID with the actual user_id from auth.users for abecha@gmail.com

-- To find the user_id, run:
-- SELECT id FROM auth.users WHERE email = 'abecha@gmail.com';

-- Then run:
-- INSERT INTO admin_users (user_id, role, created_by)
-- VALUES ('<user_id_here>', 'admin', '<user_id_here>');

-- Example (you need to replace the UUID):
-- INSERT INTO admin_users (user_id, role, created_by)
-- VALUES ('a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'admin', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890');

-- IMPORTANT: This should be run manually by an operator with database access
-- Do not commit actual UUIDs to source control
