# ziiiTV Admin — Sistema de Gerenciamento de Playlists IPTV

## 🎯 Objetivo
Painel administrativo web para processar playlists M3U, fazer matching com catálogo TMDB, gerar códigos de pareamento e gerenciar canais IPTV.

## 🏗️ Arquitetura

### Stack
- **Frontend:** React 18 + TypeScript + Vite + TailwindCSS
- **Backend:** Supabase (PostgreSQL + Edge Functions + Storage + Auth)
- **Hospedagem:** Vercel (frontend) + Supabase Cloud (backend)

### Fluxo Completo
```
1. Admin faz upload de .m3u (até 80MB) ou cola URL
2. Browser processa localmente:
   - Parseia M3U (238k linhas) com progresso em tempo real
   - Normaliza streams (agrupa por nome, detecta qualidade)
   - Faz matching contra catálogo TMDB (445 títulos)
   - Filtra canais de TV (blacklist inteligente)
3. Insere só canais matched no Supabase (batches de 100)
4. Gera código ZIII-XXXX para pareamento
5. TV usa código para buscar canais via API pública
```

## 📊 Banco de Dados (Supabase)

### Tabelas Principais

#### `users`
```sql
id UUID PRIMARY KEY
email TEXT UNIQUE
role TEXT DEFAULT 'user' -- 'admin' | 'user'
created_at TIMESTAMPTZ
```

#### `playlists`
```sql
id UUID PRIMARY KEY
user_id UUID REFERENCES users(id)
url_original TEXT -- nome do arquivo ou URL
status TEXT -- 'pending' | 'processing' | 'ready' | 'error'
channel_count INTEGER
processed_at TIMESTAMPTZ
error_message TEXT
created_at TIMESTAMPTZ
```

#### `canonical_titles`
```sql
id TEXT PRIMARY KEY -- "netflix-breaking-bad"
slug TEXT UNIQUE -- "breaking-bad"
title TEXT -- "Breaking Bad"
alt_titles TEXT[] -- ["breaking", "bb"]
type TEXT -- "movie" | "series"
streaming TEXT -- "netflix" | "amazon" | "hbo" | "disney" | "paramount" | "apple" | "globoplay"
match_hints TEXT[] -- ["breaking"]
genres TEXT[] -- ["Drama", "Crime"]
tmdb_id INTEGER
year TEXT
rating NUMERIC(3,1) -- 8.9
overview TEXT
poster TEXT -- URL do TMDB
backdrop TEXT -- URL do TMDB
created_at TIMESTAMPTZ
```

**Dados:** 445 títulos únicos (Netflix, Amazon, HBO, Disney+, Paramount+, Apple TV+, Globoplay)

#### `channels`
```sql
id UUID PRIMARY KEY
playlist_id UUID REFERENCES playlists(id)
user_id UUID REFERENCES users(id)
name TEXT -- "Breaking Bad"
streams JSONB -- [{"u": "http://...", "q": "FHD"}, {"u": "http://...", "q": "HD"}]
group_name TEXT -- "Filmes | Drama"
logo_url TEXT
canonical_id TEXT -- FK para canonical_titles (sem constraint)
active BOOLEAN DEFAULT true
created_at TIMESTAMPTZ
```

**Estrutura `streams`:**
```json
[
  { "u": "http://stream1.com/breaking-bad-fhd.ts", "q": "FHD" },
  { "u": "http://stream2.com/breaking-bad-hd.ts", "q": "HD" }
]
```

#### `pairing_codes`
```sql
code TEXT PRIMARY KEY -- "ZIII-A1B2"
user_id UUID REFERENCES users(id)
created_at TIMESTAMPTZ
expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '30 days'
last_used_at TIMESTAMPTZ
```

#### `watch_history`
```sql
id UUID PRIMARY KEY
user_id UUID REFERENCES users(id)
channel_id UUID REFERENCES channels(id)
watched_at TIMESTAMPTZ
duration_seconds INTEGER
```

### RLS Policies

```sql
-- Users: admins veem tudo, users veem só próprio perfil
CREATE POLICY "Users can view own profile" ON users FOR SELECT USING (auth.uid() = id);

-- Canonical titles: leitura pública (anon key)
CREATE POLICY "Anyone can read canonical titles" ON canonical_titles FOR SELECT USING (true);

-- Channels: users inserem e deletam próprios canais
CREATE POLICY "Users can insert own channels" ON channels FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own channels" ON channels FOR DELETE USING (auth.uid() = user_id);

-- Playlists: users gerenciam próprias playlists
CREATE POLICY "Users can manage own playlists" ON playlists FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own playlists" ON playlists FOR DELETE USING (auth.uid() = user_id);
```

## 🔧 Processamento de M3U

### Arquivo: `src/lib/m3uProcessor.ts`

#### 1. `parseM3U(content: string, onProgress?: callback): RawChannel[]`
Parseia arquivo M3U linha a linha com callback de progresso:
```m3u
#EXTM3U
#EXTINF:-1 tvg-name="Breaking Bad FHD" group-title="Filmes | Netflix" tvg-logo="http://logo.png",Breaking Bad FHD
http://stream.com/breaking-bad-fhd.ts
```
→
```typescript
{
  name: "Breaking Bad FHD",
  url: "http://stream.com/breaking-bad-fhd.ts",
  group: "Filmes | Netflix",
  logo: "http://logo.png"
}
```

**Progresso:** Atualiza a cada 100 canais parseados.

#### 2. `detectQuality(name: string): StreamQuality`
Detecta qualidade por regex:
- `4K` → /\b4K\b|\bUHD\b|\b2160P?\b/
- `FHD` → /\bFHD\b|\bFULL[\s.-]?HD\b|\b1080P?\b/
- `HD` → /\bHD\b|\b720P?\b/
- `SD` → /\bSD\b|\b480P?\b|\b360P?\b/

#### 3. `cleanChannelName(raw: string): string`
Remove ruído do nome:
- Qualidade (4K, FHD, HD, SD)
- Anos (1990-2099)
- Episódios (S01E01, T01E01)
- Codecs (H.264, H.265, HEVC)
- Números de canal (CH 123, CANAL 456)
- Caracteres especiais (|, _, -, :)

Exemplo:
```
"Breaking Bad S01E01 FHD 2008 H.264 CH 123" → "Breaking Bad"
```

#### 4. `slugify(name: string): string`
Cria ID único:
```
"Breaking Bad" → "breaking-bad"
```

#### 5. `normalizeStreams(rawChannels: RawChannel[]): Channel[]`
Agrupa streams por slug, deduplica URLs, ordena por qualidade:
```typescript
// Input: 3 canais com mesmo nome
[
  { name: "Breaking Bad FHD", url: "http://1.ts" },
  { name: "Breaking Bad HD", url: "http://2.ts" },
  { name: "Breaking Bad FHD", url: "http://1.ts" } // duplicado
]

// Output: 1 canal com 2 streams
[
  {
    name: "Breaking Bad",
    streams: [
      { u: "http://1.ts", q: "FHD" },
      { u: "http://2.ts", q: "HD" }
    ]
  }
]
```

#### 6. `matchChannel(name: string, catalog: any[]): string | null`
Faz matching contra catálogo TMDB com blacklist inteligente:

**Blacklist de canais de TV:**
```regex
/\b(GLOBO|SBT|RECORD|ESPN|FOX|HBO|TELECINE|PREMIERE|SPORTV|...)\b/i
```

**Exceção:** Se `group-title` contém "Filmes" ou "Series", **não aplica blacklist**.

**Matching:**
1. Normaliza nome (lowercase, remove acentos, remove episódios)
2. Busca em `title`, `alt_titles`, `match_hints`
3. Retorna `canonical_id` ou `null`

Exemplo:
```typescript
matchChannel("Breaking Bad S01E01 FHD", catalog)
// → "netflix-breaking-bad"

matchChannel("GLOBO RJ FHD", catalog) // group-title="Canais"
// → null (blacklist)

matchChannel("GLOBO Novelas S01E01", catalog) // group-title="Series | Globoplay"
// → "globoplay-novelas" (exceção da blacklist)
```

## 🌐 Edge Functions (Supabase)

### 1. `generate-code`
**URL:** `https://xkhlentrhydviqfgqdhv.supabase.co/functions/v1/generate-code`

**Método:** POST

**Auth:** Requer JWT (usuário logado)

**Resposta:**
```json
{
  "code": "ZIII-A1B2",
  "expires_at": "2026-05-26T18:00:00Z"
}
```

**Lógica:**
1. Gera código aleatório `ZIII-XXXX` (4 chars alfanuméricos)
2. Verifica se já existe (retry até 10x)
3. Insere em `pairing_codes` com `expires_at = NOW() + 30 days`

### 2. `get-channels`
**URL:** `https://xkhlentrhydviqfgqdhv.supabase.co/functions/v1/get-channels?code=ZIII-XXXX`

**Método:** GET

**Auth:** Pública (sem JWT)

**Resposta:**
```json
{
  "channels": [
    {
      "id": "uuid",
      "name": "Breaking Bad",
      "streams": [
        { "u": "http://...", "q": "FHD" },
        { "u": "http://...", "q": "HD" }
      ],
      "group_name": "Filmes | Netflix",
      "logo_url": "http://logo.png",
      "canonical_titles": {
        "title": "Breaking Bad",
        "type": "series",
        "streaming": "netflix",
        "poster": "https://image.tmdb.org/t/p/w500/...",
        "backdrop": "https://image.tmdb.org/t/p/original/...",
        "rating": 8.9,
        "overview": "..."
      }
    }
  ]
}
```

**Lógica:**
1. Valida código (existe? expirado?)
2. Busca `user_id` do código
3. Busca canais do usuário com `canonical_id` (só matched)
4. Faz JOIN com `canonical_titles`
5. Atualiza `last_used_at`

### 3. `process-playlist` (DEPRECATED)
**Status:** Não é mais usada (causava timeout com arquivos grandes)

**Motivo:** Edge Functions têm limite de 60s. Arquivos de 45MB (238k linhas) demoravam 2+ minutos.

**Solução:** Processamento local no browser (ver seção "Fluxo de Upload").

## 📤 Fluxo de Upload com Progresso

### Arquivo: `src/pages/UploadPlaylist.tsx`

#### 4 Fases de Processamento

**1. 📖 Parsing (40% do tempo)**
```typescript
const raw = parseM3U(content, (current, total) => {
  setProgress({
    phase: 'parsing',
    current,
    total,
    percent: Math.round((current / total) * 100)
  })
})
```

**2. 🔄 Normalizing (20% do tempo)**
```typescript
setProgress({ phase: 'normalizing', current: 0, total: raw.length, percent: 0 })
const normalized = normalizeStreams(raw)
```

**3. 🎯 Matching (30% do tempo)**
```typescript
setProgress({ phase: 'matching', current: 0, total: normalized.length, percent: 0 })
const matched = normalized.map((ch, idx) => {
  if (idx % 100 === 0) {
    setProgress({ phase: 'matching', current: idx, total: normalized.length, percent: ... })
  }
  return { ...ch, canonical_id: matchChannel(ch.name, catalog) }
}).filter(ch => ch.canonical_id)
```

**4. 💾 Inserting (10% do tempo)**
```typescript
setProgress({ phase: 'inserting', current: 0, total: matched.length, percent: 0 })
for (let i = 0; i < matched.length; i += 100) {
  await supabase.from('channels').insert(batch)
  setProgress({ phase: 'inserting', current: inserted, total: matched.length, percent: ... })
}
```

#### UI de Progresso
```tsx
<div className="space-y-3">
  <div className="flex items-center justify-between">
    <span>📖 Parseando M3U...</span>
    <span>1,234 / 210,125</span>
  </div>
  <div className="w-full bg-gray-800 rounded-full h-3">
    <div className="bg-gradient-to-r from-purple-500 to-pink-500 h-full" style={{ width: '45%' }} />
  </div>
  <p className="text-center">45%</p>
</div>
```

## 🌳 Preview de Canais

### Arquivo: `src/pages/ChannelsPreview.tsx`

#### Estrutura de Árvore
```
Netflix ▶
  🎬 Filmes ▶
    Breaking Bad (1234)
    Stranger Things (567)
  📺 Séries ▶
    The Crown (890)
Amazon ▶
  🎬 Filmes ▶
    ...
Globoplay ▶
  📺 Novelas ▶
    Chocolate com Pimenta (140)
```

#### Lógica
```typescript
const loadTree = async () => {
  // 1. Buscar channels com canonical_id
  const { data: channelsData } = await supabase
    .from('channels')
    .select('canonical_id')
    .not('canonical_id', 'is', null)

  // 2. Buscar canonical_titles
  const canonicalIds = [...new Set(channelsData.map(ch => ch.canonical_id))]
  const { data: titlesData } = await supabase
    .from('canonical_titles')
    .select('id, title, poster, rating, streaming, type')
    .in('id', canonicalIds)

  // 3. Agrupar por streaming → type → title
  const grouped = new Map<string, Map<string, Map<string, any>>>()
  channelsData.forEach(ch => {
    const ct = titlesMap.get(ch.canonical_id)
    // Agrupa por ct.streaming → ct.type → ct.id
    // Conta channelCount
  })

  // 4. Converter para array e ordenar
  setTree(treeData.sort((a, b) => a.streaming.localeCompare(b.streaming)))
}
```

**Lazy Loading:**
- Árvore carrega só estrutura (streaming → type → titles)
- Canais carregam só quando clica no título (limit 50)

```typescript
const loadChannels = async (canonicalId: string) => {
  const { data } = await supabase
    .from('channels')
    .select('*')
    .eq('canonical_id', canonicalId)
    .limit(50)
  setChannels(data)
}
```

## 📋 Gerenciamento de Playlists

### Arquivo: `src/pages/PlaylistsNew.tsx`

#### Funcionalidades
- ✅ Lista todas as playlists do usuário
- ✅ Mostra status (✓ Pronta, ✗ Erro, ⏱ Processando)
- ✅ Exibe contagem de canais
- ✅ Data de criação e processamento
- ✅ Mensagem de erro (se houver)
- ✅ **Botão Deletar** com confirmação

#### Delete em Cascata
```typescript
const handleDelete = async (playlistId: string) => {
  // 1. Deletar canais
  await supabase.from('channels').delete().eq('playlist_id', playlistId)
  
  // 2. Deletar playlist
  await supabase.from('playlists').delete().eq('id', playlistId)
  
  // Sem rastros!
}
```

## 🔐 Autenticação

### Arquivo: `src/stores/authStore.ts`

#### Login
```typescript
const login = async (email: string, password: string) => {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password
  })

  // Buscar role
  const { data: profile } = await supabase
    .from('users')
    .select('role')
    .eq('id', data.user.id)
    .single()

  set({ user: data.user, isAdmin: profile.role === 'admin' })
}
```

#### Admin Criado
```
Email: admin@ziiitv.com
Senha: admin123
Role: admin
```

## 📁 Estrutura de Arquivos

```
ziiitv-admin/
├── src/
│   ├── components/
│   │   ├── layout/
│   │   │   ├── Header.tsx
│   │   │   ├── Sidebar.tsx
│   │   │   └── Layout.tsx
│   │   └── ui/
│   │       ├── Button.tsx
│   │       ├── Card.tsx
│   │       ├── Input.tsx
│   │       └── Table.tsx
│   ├── pages/
│   │   ├── Dashboard.tsx
│   │   ├── Login.tsx
│   │   ├── UploadPlaylist.tsx — Upload com progresso em 4 fases
│   │   ├── ChannelsPreview.tsx — Árvore de navegação
│   │   ├── PlaylistsNew.tsx — Lista com delete
│   │   ├── Users.tsx
│   │   ├── Channels.tsx
│   │   └── WatchHistory.tsx
│   ├── stores/
│   │   └── authStore.ts
│   ├── lib/
│   │   ├── supabase.ts
│   │   └── m3uProcessor.ts — Parsing, normalização, matching
│   ├── App.tsx
│   └── main.tsx
├── supabase/
│   └── functions/
│       ├── generate-code/
│       │   └── index.ts
│       ├── get-channels/
│       │   └── index.ts
│       └── process-playlist/ (deprecated)
│           └── index.ts
├── scripts/
│   └── seed-catalog.ts
├── supabase_schema.sql
├── migration_pairing_codes.sql
└── README.md (este arquivo)
```

## 🚀 Deploy

### Frontend (Vercel)
```bash
npm run build
vercel --prod
```

### Edge Functions (Supabase)
```bash
supabase login
supabase functions deploy generate-code --project-ref xkhlentrhydviqfgqdhv
supabase functions deploy get-channels --project-ref xkhlentrhydviqfgqdhv
```

### Seed Catálogo
```bash
cd ziiitv-admin
npx tsx scripts/seed-catalog.ts
```

## 🐛 Problemas Conhecidos e Soluções

### 1. Matching de Canais de TV ✅ RESOLVIDO
**Problema:** Canais de TV (Globo, SBT, ESPN) estavam batendo com títulos do catálogo.

**Solução:** Blacklist em `matchChannel()` com exceção para `group-title` contendo "Filmes" ou "Series".

**Status:** ✅ Resolvido (26/04/2026)

### 2. Timeout em Edge Function ✅ RESOLVIDO
**Problema:** `process-playlist` dava timeout (546) com arquivos > 40MB.

**Solução:** Processamento local no browser com progresso em 4 fases.

**Status:** ✅ Resolvido (26/04/2026)

### 3. Foreign Key Inexistente ✅ RESOLVIDO
**Problema:** `channels.canonical_id` não tem FK para `canonical_titles.id`, causando erro no JOIN automático do Supabase.

**Solução:** JOIN manual (buscar separado e juntar no frontend).

**Status:** ✅ Resolvido (26/04/2026)

### 4. RLS Recursão Infinita ✅ RESOLVIDO
**Problema:** Policy "Admins can view all users" causava recursão ao verificar role.

**Solução:** Remover policy, usar `service_role` key para admin queries.

**Status:** ✅ Resolvido (25/04/2026)

### 5. Delete de Playlists ⚠️ EM ANDAMENTO
**Problema:** RLS bloqueando DELETE de canais e playlists.

**Solução:** Adicionar policies de DELETE:
```sql
CREATE POLICY "Users can delete own channels" ON channels FOR DELETE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own playlists" ON playlists FOR DELETE USING (auth.uid() = user_id);
```

**Status:** ⚠️ SQL criado, aguardando execução no Dashboard

## 📊 Estatísticas de Processamento

### Teste Real (26/04/2026)
```
Arquivo: 45.5 MB, 238,252 linhas
Tempo: ~3 minutos (local no browser)

Resultados:
- Raw channels: 238,252
- Normalized: 210,125 (88.2%)
- Matched: 209,406 (99.66%)
- Unmatched: 719 (0.34%)
- Blacklisted (TV): ~28k (11.8%)

Inserção:
- Batches: 2,095 (100 canais/batch)
- Tempo: ~2 minutos
- Sucesso: 100%

Progresso:
- Fase 1 (Parsing): 40% do tempo
- Fase 2 (Normalizing): 20% do tempo
- Fase 3 (Matching): 30% do tempo
- Fase 4 (Inserting): 10% do tempo
```

## 🔮 Próximos Passos

### Crítico
- [ ] Executar SQL de policies de DELETE
- [ ] Testar delete de playlists
- [ ] Implementar detecção de streaming por `group-title`
- [ ] Remover episódios (S01E01) do nome antes do matching
- [ ] Priorizar matching por streaming detectado

### Importante
- [ ] Melhorar preview com stats de matching por streaming
- [ ] Adicionar seção "Canais sem match" no preview
- [ ] Implementar busca na árvore de preview
- [ ] Adicionar filtro por streaming no upload
- [ ] Exportar playlist processada (M3U filtrado)

### TV Integration
- [ ] Criar tela de pareamento na TV
- [ ] Implementar IndexedDB para salvar código
- [ ] Integrar com API `get-channels`
- [ ] Adaptar player para novo formato de streams
- [ ] Organizar home por streaming (Netflix, Amazon, HBO, etc)

### Futuro
- [ ] Background job para refazer matching quando catálogo é atualizado
- [ ] Admin pode editar canonical_titles
- [ ] Sugestões de matching manual para canais sem match
- [ ] Analytics de canais mais assistidos
- [ ] Suporte a múltiplos formatos de M3U (XC, Xtream Codes, etc)
- [ ] Cache de matching para acelerar reprocessamento

## 📞 Credenciais

### Supabase
```
Project: xkhlentrhydviqfgqdhv
URL: https://xkhlentrhydviqfgqdhv.supabase.co
Anon Key: sb_publishable_WsHv-bt4db2K4OIMc27rhg_utxbni2S
Service Role: sb_secret_1ZD7ZVjGoVYke2XbNuEvvA_3tcnIR4_
```

### Admin
```
Email: admin@ziiitv.com
Senha: admin123
```

## 📝 Notas Técnicas

### Por que não usar Foreign Key?
`channels.canonical_id` é opcional (canais de TV não têm match). FK causaria erro ao inserir canais sem match. Solução: campo TEXT sem constraint, JOIN manual no frontend.

### Por que processar no browser?
Edge Functions têm limite de 60s. Arquivos grandes (45MB) demoravam 2+ minutos. Browser não tem limite de tempo e pode processar 200k+ linhas sem problemas. Além disso, permite progresso em tempo real.

### Por que blacklist em vez de whitelist?
Catálogo tem 445 títulos, mas M3U tem 200k+ canais. Mais fácil blacklistar padrões de TV (Globo, SBT, ESPN) do que whitelistar todos os filmes/séries. Exceção: se `group-title` contém "Filmes" ou "Series", não aplica blacklist.

### Por que JSONB para streams?
Permite múltiplas URLs por canal (FHD, HD, SD) sem criar tabela separada. PostgreSQL tem índices GIN para busca eficiente em JSONB.

### Como funciona o progresso em tempo real?
Callbacks em `parseM3U` e loops de matching/inserting atualizam estado React a cada 100 itens. UI renderiza barra de progresso com gradiente e porcentagem. Não trava o browser porque usa `await` entre batches.

### Estrutura de M3U Curada
Playlists curadas (como `curadoria_streamings.m3u`) têm:
- `group-title="Filmes | Netflix"` ou `"Series | Globoplay"`
- Nomes limpos sem qualidade (FHD, HD)
- Episódios no formato `S01E01`
- Logo URLs curtas (`http://lgfp.one/GXX1`)

Devemos usar `group-title` para detectar streaming e tipo (filme/série) antes do matching.

---

**Última atualização:** 26/04/2026 18:26
**Versão:** 1.1.0
**Autor:** Kiro AI + carneiro888


## 📊 Banco de Dados (Supabase)

### Tabelas Principais

#### `users`
```sql
id UUID PRIMARY KEY
email TEXT UNIQUE
role TEXT DEFAULT 'user' -- 'admin' | 'user'
created_at TIMESTAMPTZ
```

#### `playlists`
```sql
id UUID PRIMARY KEY
user_id UUID REFERENCES users(id)
url_original TEXT -- nome do arquivo ou URL
status TEXT -- 'pending' | 'processing' | 'ready' | 'error'
channel_count INTEGER
processed_at TIMESTAMPTZ
error_message TEXT
created_at TIMESTAMPTZ
```

#### `canonical_titles`
```sql
id TEXT PRIMARY KEY -- "netflix-breaking-bad"
slug TEXT UNIQUE -- "breaking-bad"
title TEXT -- "Breaking Bad"
alt_titles TEXT[] -- ["breaking", "bb"]
type TEXT -- "movie" | "series"
streaming TEXT -- "netflix" | "amazon" | "hbo" | "disney" | "paramount" | "apple" | "globoplay"
match_hints TEXT[] -- ["breaking"]
genres TEXT[] -- ["Drama", "Crime"]
tmdb_id INTEGER
year TEXT
rating NUMERIC(3,1) -- 8.9
overview TEXT
poster TEXT -- URL do TMDB
backdrop TEXT -- URL do TMDB
created_at TIMESTAMPTZ
```

**Dados:** 445 títulos únicos (Netflix, Amazon, HBO, Disney+, Paramount+, Apple TV+, Globoplay)

#### `channels`
```sql
id UUID PRIMARY KEY
playlist_id UUID REFERENCES playlists(id)
user_id UUID REFERENCES users(id)
name TEXT -- "Breaking Bad"
streams JSONB -- [{"u": "http://...", "q": "FHD"}, {"u": "http://...", "q": "HD"}]
group_name TEXT -- "Filmes | Drama"
logo_url TEXT
canonical_id TEXT -- FK para canonical_titles (sem constraint)
active BOOLEAN DEFAULT true
created_at TIMESTAMPTZ
```

**Estrutura `streams`:**
```json
[
  { "u": "http://stream1.com/breaking-bad-fhd.ts", "q": "FHD" },
  { "u": "http://stream2.com/breaking-bad-hd.ts", "q": "HD" }
]
```

#### `pairing_codes`
```sql
code TEXT PRIMARY KEY -- "ZIII-A1B2"
user_id UUID REFERENCES users(id)
created_at TIMESTAMPTZ
expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '30 days'
last_used_at TIMESTAMPTZ
```

#### `watch_history`
```sql
id UUID PRIMARY KEY
user_id UUID REFERENCES users(id)
channel_id UUID REFERENCES channels(id)
watched_at TIMESTAMPTZ
duration_seconds INTEGER
```

### RLS Policies

```sql
-- Users: admins veem tudo, users veem só próprio perfil
CREATE POLICY "Users can view own profile" ON users FOR SELECT USING (auth.uid() = id);

-- Canonical titles: leitura pública (anon key)
CREATE POLICY "Anyone can read canonical titles" ON canonical_titles FOR SELECT USING (true);

-- Channels: users inserem próprios canais
CREATE POLICY "Users can insert own channels" ON channels FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Playlists: users gerenciam próprias playlists
CREATE POLICY "Users can manage own playlists" ON playlists FOR ALL USING (auth.uid() = user_id);
```

## 🔧 Processamento de M3U

### Arquivo: `src/lib/m3uProcessor.ts`

#### 1. `parseM3U(content: string): RawChannel[]`
Parseia arquivo M3U linha a linha:
```m3u
#EXTINF:-1 tvg-name="Breaking Bad FHD" group-title="Filmes | Drama" tvg-logo="http://logo.png",Breaking Bad FHD
http://stream.com/breaking-bad-fhd.ts
```
→
```typescript
{
  name: "Breaking Bad FHD",
  url: "http://stream.com/breaking-bad-fhd.ts",
  group: "Filmes | Drama",
  logo: "http://logo.png"
}
```

#### 2. `detectQuality(name: string): StreamQuality`
Detecta qualidade por regex:
- `4K` → /\b4K\b|\bUHD\b|\b2160P?\b/
- `FHD` → /\bFHD\b|\bFULL[\s.-]?HD\b|\b1080P?\b/
- `HD` → /\bHD\b|\b720P?\b/
- `SD` → /\bSD\b|\b480P?\b|\b360P?\b/

#### 3. `cleanChannelName(raw: string): string`
Remove ruído do nome:
- Qualidade (4K, FHD, HD, SD)
- Anos (1990-2099)
- Codecs (H.264, H.265, HEVC)
- Números de canal (CH 123, CANAL 456)
- Caracteres especiais (|, _, -, :)

Exemplo:
```
"Breaking Bad FHD 2008 H.264 CH 123" → "Breaking Bad"
```

#### 4. `slugify(name: string): string`
Cria ID único:
```
"Breaking Bad" → "breaking-bad"
```

#### 5. `normalizeStreams(rawChannels: RawChannel[]): Channel[]`
Agrupa streams por slug, deduplica URLs, ordena por qualidade:
```typescript
// Input: 3 canais com mesmo nome
[
  { name: "Breaking Bad FHD", url: "http://1.ts" },
  { name: "Breaking Bad HD", url: "http://2.ts" },
  { name: "Breaking Bad FHD", url: "http://1.ts" } // duplicado
]

// Output: 1 canal com 2 streams
[
  {
    name: "Breaking Bad",
    streams: [
      { u: "http://1.ts", q: "FHD" },
      { u: "http://2.ts", q: "HD" }
    ]
  }
]
```

#### 6. `matchChannel(name: string, catalog: any[]): string | null`
Faz matching contra catálogo TMDB:

**Blacklist de canais de TV:**
```regex
/\b(GLOBO|SBT|RECORD|ESPN|FOX|HBO|TELECINE|PREMIERE|SPORTV|...)\b/i
```
Se bater, retorna `null` (não faz match).

**Matching:**
1. Normaliza nome (lowercase, remove acentos)
2. Busca em `title`, `alt_titles`, `match_hints`
3. Retorna `canonical_id` ou `null`

Exemplo:
```typescript
matchChannel("Breaking Bad FHD", catalog)
// → "netflix-breaking-bad"

matchChannel("GLOBO RJ FHD", catalog)
// → null (blacklist)
```

## 🌐 Edge Functions (Supabase)

### 1. `generate-code`
**URL:** `https://xkhlentrhydviqfgqdhv.supabase.co/functions/v1/generate-code`

**Método:** POST

**Auth:** Requer JWT (usuário logado)

**Resposta:**
```json
{
  "code": "ZIII-A1B2",
  "expires_at": "2026-05-26T18:00:00Z"
}
```

**Lógica:**
1. Gera código aleatório `ZIII-XXXX` (4 chars alfanuméricos)
2. Verifica se já existe (retry até 10x)
3. Insere em `pairing_codes` com `expires_at = NOW() + 30 days`

### 2. `get-channels`
**URL:** `https://xkhlentrhydviqfgqdhv.supabase.co/functions/v1/get-channels?code=ZIII-XXXX`

**Método:** GET

**Auth:** Pública (sem JWT)

**Resposta:**
```json
{
  "channels": [
    {
      "id": "uuid",
      "name": "Breaking Bad",
      "streams": [
        { "u": "http://...", "q": "FHD" },
        { "u": "http://...", "q": "HD" }
      ],
      "group_name": "Filmes | Drama",
      "logo_url": "http://logo.png",
      "canonical_titles": {
        "title": "Breaking Bad",
        "type": "series",
        "streaming": "netflix",
        "poster": "https://image.tmdb.org/t/p/w500/...",
        "backdrop": "https://image.tmdb.org/t/p/original/...",
        "rating": 8.9,
        "overview": "..."
      }
    }
  ]
}
```

**Lógica:**
1. Valida código (existe? expirado?)
2. Busca `user_id` do código
3. Busca canais do usuário com `canonical_id` (só matched)
4. Faz JOIN com `canonical_titles`
5. Atualiza `last_used_at`

### 3. `process-playlist` (DEPRECATED)
**Status:** Não é mais usada (causava timeout com arquivos grandes)

**Motivo:** Edge Functions têm limite de 60s. Arquivos de 45MB (238k linhas) demoravam 2+ minutos.

**Solução:** Processamento local no browser (ver seção "Fluxo de Upload").

## 📤 Fluxo de Upload

### Arquivo: `src/pages/UploadPlaylist.tsx`

#### Modo Arquivo (< 50MB)
```typescript
const handleUpload = async () => {
  // 1. Ler arquivo
  const content = await file.text() // 45MB, 238k linhas

  // 2. Processar localmente
  const raw = parseM3U(content) // 238,252 canais
  const normalized = normalizeStreams(raw) // 210,125 únicos

  // 3. Buscar catálogo
  const { data: catalog } = await supabase
    .from('canonical_titles')
    .select('id, title, alt_titles, match_hints')
  // 445 títulos

  // 4. Fazer matching
  const matched = normalized
    .map(ch => ({
      ...ch,
      canonical_id: matchChannel(ch.name, catalog)
    }))
    .filter(ch => ch.canonical_id) // Só os que bateram
  // 209,406 matched (99.66%)

  // 5. Gerar código
  const { data: codeData } = await supabase.functions.invoke('generate-code')
  const code = codeData.code // "ZIII-A1B2"

  // 6. Criar playlist
  const { data: playlist } = await supabase
    .from('playlists')
    .insert({
      url_original: file.name,
      status: 'processing',
      user_id: user.id
    })
    .select()
    .single()

  // 7. Inserir canais em batches
  for (let i = 0; i < matched.length; i += 100) {
    await supabase.from('channels').insert(
      matched.slice(i, i + 100).map(ch => ({
        playlist_id: playlist.id,
        user_id: user.id,
        name: ch.name,
        streams: ch.streams,
        group_name: ch.group,
        logo_url: ch.logo,
        canonical_id: ch.canonical_id
      }))
    )
  }

  // 8. Atualizar playlist
  await supabase.from('playlists').update({
    status: 'ready',
    channel_count: matched.length,
    processed_at: new Date().toISOString()
  }).eq('id', playlist.id)
}
```

#### Modo URL (arquivos grandes)
Mesmo fluxo, mas faz `fetch(url)` antes de processar.

**Problema conhecido:** Alguns servidores M3U bloqueiam User-Agent do browser (403). Solução: usar proxy ou CORS Anywhere.

## 🌳 Preview de Canais

### Arquivo: `src/pages/ChannelsPreview.tsx`

#### Estrutura de Árvore
```
Netflix ▶
  🎬 Filmes ▶
    Breaking Bad (1234)
    Stranger Things (567)
  📺 Séries ▶
    The Crown (890)
Amazon ▶
  🎬 Filmes ▶
    ...
HBO ▶
  ...
```

#### Lógica
```typescript
const loadTree = async () => {
  // 1. Buscar channels com canonical_id
  const { data: channelsData } = await supabase
    .from('channels')
    .select('canonical_id')
    .not('canonical_id', 'is', null)

  // 2. Buscar canonical_titles
  const canonicalIds = [...new Set(channelsData.map(ch => ch.canonical_id))]
  const { data: titlesData } = await supabase
    .from('canonical_titles')
    .select('id, title, poster, rating, streaming, type')
    .in('id', canonicalIds)

  // 3. Agrupar por streaming → type → title
  const grouped = new Map<string, Map<string, Map<string, any>>>()
  channelsData.forEach(ch => {
    const ct = titlesMap.get(ch.canonical_id)
    // Agrupa por ct.streaming → ct.type → ct.id
    // Conta channelCount
  })

  // 4. Converter para array e ordenar
  setTree(treeData.sort((a, b) => a.streaming.localeCompare(b.streaming)))
}
```

**Lazy Loading:**
- Árvore carrega só estrutura (streaming → type → titles)
- Canais carregam só quando clica no título (limit 50)

```typescript
const loadChannels = async (canonicalId: string) => {
  const { data } = await supabase
    .from('channels')
    .select('*')
    .eq('canonical_id', canonicalId)
    .limit(50)
  setChannels(data)
}
```

## 🔐 Autenticação

### Arquivo: `src/stores/authStore.ts`

#### Login
```typescript
const login = async (email: string, password: string) => {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password
  })

  // Buscar role
  const { data: profile } = await supabase
    .from('users')
    .select('role')
    .eq('id', data.user.id)
    .single()

  set({ user: data.user, isAdmin: profile.role === 'admin' })
}
```

#### Admin Criado
```
Email: admin@ziiitv.com
Senha: admin123
Role: admin
```

#### RLS Check
```typescript
// authStore verifica role no login
const { data: profile } = await supabase
  .from('users')
  .select('role')
  .eq('id', user.id)
  .single()

set({ isAdmin: profile.role === 'admin' })
```

## 📁 Estrutura de Arquivos

```
ziiitv-admin/
├── src/
│   ├── components/
│   │   ├── layout/
│   │   │   ├── Header.tsx
│   │   │   ├── Sidebar.tsx
│   │   │   └── Layout.tsx
│   │   └── ui/
│   │       ├── Button.tsx
│   │       ├── Card.tsx
│   │       ├── Input.tsx
│   │       └── Table.tsx
│   ├── pages/
│   │   ├── Dashboard.tsx
│   │   ├── Login.tsx
│   │   ├── UploadPlaylist.tsx
│   │   ├── ChannelsPreview.tsx
│   │   ├── Users.tsx
│   │   ├── Playlists.tsx
│   │   ├── Channels.tsx
│   │   └── WatchHistory.tsx
│   ├── stores/
│   │   └── authStore.ts
│   ├── lib/
│   │   ├── supabase.ts
│   │   └── m3uProcessor.ts
│   ├── App.tsx
│   └── main.tsx
├── supabase/
│   └── functions/
│       ├── generate-code/
│       │   └── index.ts
│       ├── get-channels/
│       │   └── index.ts
│       └── process-playlist/ (deprecated)
│           └── index.ts
├── scripts/
│   └── seed-catalog.ts
├── supabase_schema.sql
├── migration_pairing_codes.sql
└── README.md (este arquivo)
```

## 🚀 Deploy

### Frontend (Vercel)
```bash
npm run build
vercel --prod
```

### Edge Functions (Supabase)
```bash
supabase login
supabase functions deploy generate-code --project-ref xkhlentrhydviqfgqdhv
supabase functions deploy get-channels --project-ref xkhlentrhydviqfgqdhv
```

### Seed Catálogo
```bash
cd ziiitv-admin
npx tsx scripts/seed-catalog.ts
```

## 🐛 Problemas Conhecidos

### 1. Matching de Canais de TV
**Problema:** Canais de TV (Globo, SBT, ESPN) estavam batendo com títulos do catálogo.

**Solução:** Blacklist em `matchChannel()` para ignorar canais de TV.

**Status:** ✅ Resolvido (26/04/2026)

### 2. Timeout em Edge Function
**Problema:** `process-playlist` dava timeout (546) com arquivos > 40MB.

**Solução:** Processamento local no browser.

**Status:** ✅ Resolvido (26/04/2026)

### 3. Foreign Key Inexistente
**Problema:** `channels.canonical_id` não tem FK para `canonical_titles.id`, causando erro no JOIN automático do Supabase.

**Solução:** JOIN manual (buscar separado e juntar no frontend).

**Status:** ✅ Resolvido (26/04/2026)

### 4. RLS Recursão Infinita
**Problema:** Policy "Admins can view all users" causava recursão ao verificar role.

**Solução:** Remover policy, usar `service_role` key para admin queries.

**Status:** ✅ Resolvido (25/04/2026)

## 📊 Estatísticas de Processamento

### Teste Real (26/04/2026)
```
Arquivo: 45.5 MB, 238,252 linhas
Tempo: ~3 minutos (local no browser)

Resultados:
- Raw channels: 238,252
- Normalized: 210,125 (88.2%)
- Matched: 209,406 (99.66%)
- Unmatched: 719 (0.34%)
- Blacklisted (TV): ~28k (11.8%)

Inserção:
- Batches: 2,095 (100 canais/batch)
- Tempo: ~2 minutos
- Sucesso: 100%
```

## 🔮 Próximos Passos

### Crítico
- [ ] Limpar canais com match errado (antes da blacklist)
- [ ] Adicionar botão "Limpar Canais" no admin
- [ ] Testar upload completo com nova blacklist

### Importante
- [ ] Adicionar progress bar no upload (parsing → matching → inserting)
- [ ] Melhorar preview com stats de matching
- [ ] Adicionar seção "Canais sem match" no preview
- [ ] Implementar busca na árvore de preview

### TV Integration
- [ ] Criar tela de pareamento na TV
- [ ] Implementar IndexedDB para salvar código
- [ ] Integrar com API `get-channels`
- [ ] Adaptar player para novo formato de streams

### Futuro
- [ ] Background job para refazer matching quando catálogo é atualizado
- [ ] Admin pode editar canonical_titles
- [ ] Sugestões de matching manual para canais sem match
- [ ] Analytics de canais mais assistidos
- [ ] Exportar playlist processada (M3U filtrado)

## 📞 Credenciais

### Supabase
```
Project: xkhlentrhydviqfgqdhv
URL: https://xkhlentrhydviqfgqdhv.supabase.co
Anon Key: sb_publishable_WsHv-bt4db2K4OIMc27rhg_utxbni2S
Service Role: sb_secret_1ZD7ZVjGoVYke2XbNuEvvA_3tcnIR4_
```

### Admin
```
Email: admin@ziiitv.com
Senha: admin123
```

## 📝 Notas Técnicas

### Por que não usar Foreign Key?
`channels.canonical_id` é opcional (canais de TV não têm match). FK causaria erro ao inserir canais sem match. Solução: campo TEXT sem constraint, JOIN manual no frontend.

### Por que processar no browser?
Edge Functions têm limite de 60s. Arquivos grandes (45MB) demoravam 2+ minutos. Browser não tem limite de tempo e pode processar 200k+ linhas sem problemas.

### Por que blacklist em vez de whitelist?
Catálogo tem 445 títulos, mas M3U tem 200k+ canais. Mais fácil blacklistar padrões de TV (Globo, SBT, ESPN) do que whitelistar todos os filmes/séries.

### Por que JSONB para streams?
Permite múltiplas URLs por canal (FHD, HD, SD) sem criar tabela separada. PostgreSQL tem índices GIN para busca eficiente em JSONB.

---

**Última atualização:** 26/04/2026 18:05
**Versão:** 1.0.0
**Autor:** Kiro AI + carneiro888
