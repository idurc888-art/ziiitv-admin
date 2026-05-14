# Edge Functions — ziiiTV

## 1. Executar Schema SQL

```bash
# Abrir Supabase Dashboard → SQL Editor
# Copiar conteúdo de supabase_schema.sql
# Colar e executar
```

## 2. Popular Catálogo (399 títulos)

```bash
cd ziiitv-admin
npm install @supabase/supabase-js tsx
npx tsx scripts/seed-catalog.ts
```

## 3. Deploy Edge Function

```bash
# Login
supabase login

# Link ao projeto
supabase link --project-ref xkhlentrhydviqfgqdhv

# Deploy
supabase functions deploy process-playlist

# Setar secrets
supabase secrets set SUPABASE_URL=https://xkhlentrhydviqfgqdhv.supabase.co
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=sb_secret_1ZD7ZVjGoVYke2XbNuEvvA_3tcnIR4_
```

## 4. Criar Usuário Admin

```bash
# Supabase Dashboard → Authentication → Users → Add user
# Email: admin@ziiitv.com
# Senha: (sua senha)

# Depois: Table Editor → users → Editar role para "admin"
```

## 5. Testar

```typescript
// Frontend
const { data, error } = await supabase.functions.invoke('process-playlist', {
  body: { 
    playlist_id: 'uuid-aqui', 
    url: 'http://cdc55.cc/get.php?username=0357028521&password=82740&type=m3u_plus&output=ts'
  }
})
```
