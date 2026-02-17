import { createClient } from '@supabase/supabase-js';
import { getSupabaseUrl, getSupabaseAnonKey } from '../../lib/supabaseEnv';

// Use trimmed values so trailing/leading spaces from Netlify don't cause "Invalid Supabase URL"
const supabaseUrl = getSupabaseUrl();
const supabaseAnonKey = getSupabaseAnonKey();

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export default supabase;
