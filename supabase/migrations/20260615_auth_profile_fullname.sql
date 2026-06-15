-- =====================================================================
-- Auth profiles: auto-create profile on signup, storing the full name
-- =====================================================================
-- Idempotent. Safe to run even though profiles/RLS already exist — it just
-- ensures the table, columns, RLS policies, and the signup trigger are present
-- and that the trigger persists the user's name/email/created_at.
-- Run in: Supabase Dashboard → SQL Editor.

-- 1) Table (id, name, email, created_at) ------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
  id            UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email         TEXT NOT NULL,
  full_name     TEXT,
  company_name  TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

-- Ensure columns exist when the table predates this migration.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS full_name    TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS company_name TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS created_at   TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now());
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS updated_at   TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now());

-- 2) Row Level Security ----------------------------------------------
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own profile"   ON public.profiles;
DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;

CREATE POLICY "Users can view own profile"
  ON public.profiles FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile"
  ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE USING (auth.uid() = id);

-- 3) Auto-create profile on signup (reads metadata from auth.users) ---
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, company_name, created_at, updated_at)
  VALUES (
    NEW.id,
    COALESCE(NEW.email, NEW.raw_user_meta_data->>'email'),
    NULLIF(NEW.raw_user_meta_data->>'full_name', ''),
    NULLIF(NEW.raw_user_meta_data->>'company_name', ''),
    now(),
    now()
  )
  ON CONFLICT (id) DO UPDATE
    SET full_name    = COALESCE(public.profiles.full_name, EXCLUDED.full_name),
        company_name = COALESCE(public.profiles.company_name, EXCLUDED.company_name);
  RETURN NEW;
END;
$$;

-- 4) Trigger ----------------------------------------------------------
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 5) Index ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS profiles_email_idx ON public.profiles(email);
