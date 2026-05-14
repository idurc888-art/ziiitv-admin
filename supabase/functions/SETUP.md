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

## 3. Deploy Edge Functions

```bash
# Login
supabase login

# Link ao projeto
supabase link --project-ref xkhlentrhydviqfgqdhv

# Deploy todas as funções
supabase functions deploy process-playlist
supabase functions deploy generate-code
supabase functions deploy get-channels

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

## 5. Testar no Admin

```bash
cd ziiitv-admin
npm run dev
# Acesse http://localhost:5173
# Login com admin@ziiitv.com
```

---

## 📡 APIs Disponíveis

### **1. Processar Playlist**
```typescript
const { data } = await supabase.functions.invoke('process-playlist', {
  body: { 
    playlist_id: 'uuid',
    url: 'http://...'
  }
})
```

### **2. Gerar Código de Pareamento**
```typescript
const { data } = await supabase.functions.invoke('generate-code')
// Retorna: { code: "ZIII-A1B2" }
```

### **3. Buscar Canais (TV)**
```typescript
const response = await fetch(
  'https://xkhlentrhydviqfgqdhv.supabase.co/functions/v1/get-channels?code=ZIII-A1B2'
)
const { channels } = await response.json()
```
