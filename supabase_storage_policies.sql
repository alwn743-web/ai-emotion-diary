-- ==========================================================================
-- Supabase Storage Buckets & RLS Security Policies SQL Script
-- File: supabase_storage_policies.sql
-- Instructions: Run this script in Supabase Dashboard -> SQL Editor
-- ==========================================================================

-- 0. Ensure 'avatars' and 'chat-images' public buckets exist in storage.buckets
INSERT INTO storage.buckets (id, name, public)
VALUES 
    ('avatars', 'avatars', true),
    ('chat-images', 'chat-images', true)
ON CONFLICT (id) DO UPDATE SET public = true;


-- ==========================================================================
-- 1. 'avatars' Bucket Policies
--    - Public SELECT: Anyone can view avatar images
--    - Authenticated INSERT/UPDATE/DELETE: Restricted to own user_id folder path
-- ==========================================================================

-- Remove existing policies for clean idempotency if needed
DROP POLICY IF EXISTS "Public Read Access for Avatars" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated Insert Own Folder in Avatars" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated Update Own Folder in Avatars" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated Delete Own Folder in Avatars" ON storage.objects;

-- 1-1) SELECT Policy (Public Read)
CREATE POLICY "Public Read Access for Avatars"
ON storage.objects
FOR SELECT
USING (bucket_id = 'avatars');

-- 1-2) INSERT Policy (Authenticated User's Own Folder: avatars/user_id/*)
CREATE POLICY "Authenticated Insert Own Folder in Avatars"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
    bucket_id = 'avatars' AND 
    (storage.foldername(name))[1] = auth.uid()::text
);

-- 1-3) UPDATE Policy (Authenticated User's Own Folder)
CREATE POLICY "Authenticated Update Own Folder in Avatars"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
    bucket_id = 'avatars' AND 
    (storage.foldername(name))[1] = auth.uid()::text
)
WITH CHECK (
    bucket_id = 'avatars' AND 
    (storage.foldername(name))[1] = auth.uid()::text
);

-- 1-4) DELETE Policy (Authenticated User's Own Folder)
CREATE POLICY "Authenticated Delete Own Folder in Avatars"
ON storage.objects
FOR DELETE
TO authenticated
USING (
    bucket_id = 'avatars' AND 
    (storage.foldername(name))[1] = auth.uid()::text
);


-- ==========================================================================
-- 2. 'chat-images' Bucket Policies
--    - Public SELECT: Anyone can view chat images
--    - Authenticated INSERT: Logged-in users can upload chat images
-- ==========================================================================

-- Remove existing policies for clean idempotency if needed
DROP POLICY IF EXISTS "Public Read Access for Chat Images" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated Insert for Chat Images" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated Update for Chat Images" ON storage.objects;

-- 2-1) SELECT Policy (Public Read)
CREATE POLICY "Public Read Access for Chat Images"
ON storage.objects
FOR SELECT
USING (bucket_id = 'chat-images');

-- 2-2) INSERT Policy (Authenticated Upload)
CREATE POLICY "Authenticated Insert for Chat Images"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'chat-images');

-- 2-3) UPDATE Policy (Authenticated Update)
CREATE POLICY "Authenticated Update for Chat Images"
ON storage.objects
FOR UPDATE
TO authenticated
USING (bucket_id = 'chat-images');
