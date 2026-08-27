/**
 * Supabase Client Configuration for Node.js / Vercel Serverless Functions
 * Uses environment variables set automatically by Vercel Integration
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
    console.warn('[Supabase Client] SUPABASE_URL 또는 SUPABASE_ANON_KEY 환경변수가 설정되지 않았습니다.');
}

/**
 * Standard Supabase Client (Anon Role)
 */
export const supabase = createClient(
    supabaseUrl || '',
    supabaseAnonKey || '',
    {
        auth: {
            persistSession: false
        }
    }
);

/**
 * Supabase Admin Client (Service Role - Serverless Backend ONLY)
 * Use for administrative operations bypassing Row Level Security (RLS) if needed.
 */
export const supabaseAdmin = supabaseServiceRoleKey
    ? createClient(supabaseUrl || '', supabaseServiceRoleKey, {
        auth: {
            persistSession: false
        }
    })
    : supabase;

export default supabase;
