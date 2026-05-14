# CLAUDE.md — ziiitv-admin (Web Admin + Edge Functions)

## Repo: ziiitv-admin
This repo contains the mobile web pairing page, admin dashboard, Edge Functions, and backend logic.

## What belongs here
- `src/pages/` — web pages (LinkPage, admin dashboard)
- `src/lib/` — backend libraries (m3uProcessor, tmdb, supabase client)
- `src/components/` — web UI components (not Tizen)
- `supabase/functions/` — all Supabase Edge Functions
- `supabase/migrations/` — database migrations

## What does NOT belong here
- TV Tizen code (`src/App.tsx`, `src/screens/`, Tizen components) → commit to `/home/carneiro888/Documentos/zikualdo/ziiiTV`
- Never put Samsung/Tizen/AVPlay code in this repo

## Tech stack
- React + TypeScript (Vite, standard modern browsers — NOT Tizen)
- Supabase JS SDK is available and should be used here (unlike the TV)
- Edge Functions run in Deno — use Deno imports (`https://esm.sh/...`)
- Deployed via Supabase (Edge Functions) + likely Vercel/Netlify for the web app

## No unnecessary comments
Write zero comments unless the WHY is genuinely non-obvious.

## Git rules
- Commit admin/Edge Function code here, in `/home/carneiro888/Documentos/zikualdo/ziiitv-admin`
- Never commit Tizen TV app files into this repo
- Never mix the two repos in a single commit or push

## Key files
- `src/pages/LinkPage.tsx` — mobile QR pairing page (login + list upload flow)
- `supabase/functions/process-playlist/` — processes M3U after pairing
- `supabase/functions/delete-device-data/` — full DB cleanup when device deletes list
