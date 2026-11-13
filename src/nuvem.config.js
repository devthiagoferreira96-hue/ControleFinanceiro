   const env = import.meta.env || {};
   const URL_BASE = String(env.VITE_SUPABASE_URL || '').trim().replace(/\/+$/, '');
   const CHAVE = String(env.VITE_SUPABASE_ANON_KEY || '').trim();