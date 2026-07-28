---
name: ziiitv-admin
description: Design tokens do admin — extraídos do que já existe em `tailwind.config.js` e nos componentes `ui/`, com disciplina de hierarquia/elevação inspirada no design system da Airbnb.
---

# design.md — ziiitv-admin

Fonte da verdade: `tailwind.config.js` + `src/components/ui/`. Este arquivo
documenta o que já está implementado (não inventa tokens novos) e aplica uma
disciplina emprestada do Airbnb: **hierarquia tipográfica modesta, uma única
faixa de elevação, radius por escala fixa, um acento por contexto de
componente** — não colar cor/valor solto direto no JSX.

## Cores (`tailwind.config.js`)

Base/superfície:
- `base` `#0b0b0e` — fundo geral da página
- `surface` `#131318` — cards (`Card.tsx`)
- `elevated` `#1c1c22`
- `overlay` `#24242c`
- `border` / `border-strong` / `border-subtle` — sempre `rgba(255,255,255,…)`, nunca `gray-700/800` solto

Acentos (3 tons semânticos, cada um com par `-hover` e `-muted` pra badge/tag):
- `accent` `#ff2d92` (rosa, ação primária) — `accent-hover`, `accent-muted`
- `aqua` `#2dd4bf` (dado positivo/sucesso) — `aqua-hover`, `aqua-muted`
- `neon` `#ff8c42` (destaque/warning) — `neon-hover`, `neon-muted`
- `danger` `#ff3b5c`
- `brand-pink` `#ff006e` — só para o `LinkPage.tsx` (página pública, alias legado da marca ziiiTV)

Texto: `text-primary` `#fff`, `text-secondary` `#a0a0ab`, `text-muted` `#5a5a64`.

**Regra**: um componente usa no máximo um dos três acentos (`accent`/`aqua`/`neon`)
por vez, igual ao `Stat.tsx` (`tone: 'pink' | 'aqua' | 'neon'`). Não misturar
com cores fora da paleta (`indigo-600`, `yellow-500`, `gray-800` etc. aparecem
em alguns componentes antigos — são débito, não o padrão).

## Tipografia

- `font-display` → DM Sans (números grandes, `Stat.tsx` valor)
- `font-body` → Inter (texto corrido, padrão)
- `font-brand` → Outfit (só `LinkPage.tsx`)
- `font-mono` → JetBrains Mono (ids, hashes, código)

Hierarquia observada (extraída de `Stat.tsx`/`Card.tsx`):
- Valor grande: `text-[38px] font-display font-bold tracking-tightest`
- Label acima do valor: `text-xs font-medium uppercase tracking-[0.08em] text-text-muted`

Princípio Airbnb: só um ponto de maior peso por card (o valor), o resto — label,
badges, texto de apoio — fica em peso leve/médio e cor `text-muted`/`text-secondary`.

## Radius

Token oficial: `rounded-card` = **18px** (cards). Botões usam `rounded-[10px]`.

Foram encontrados vários radius ad-hoc (`rounded-lg`, `rounded-xl`,
`rounded-[20px]`, `rounded-[14px]`, `rounded-[9px]`) espalhados em telas mais
antigas — isso é inconsistência a limpar, não uma segunda escala válida.
Escala recomendada daqui pra frente:

| Uso | Classe |
|---|---|
| Badge/pill pequeno | `rounded-full` |
| Botão | `rounded-[10px]` |
| Card | `rounded-card` (18px) |
| Modal | `rounded-card` (18px) — hoje o `Modal.tsx` usa `rounded-[20px]`, considerar alinhar |

## Elevação

Não existe hoje uma faixa única — o código tem `shadow-lg`, `shadow-xl`,
`shadow-2xl`, `shadow-inner`, e sombras coloridas ad-hoc (`shadow-indigo-900/10`,
`shadow-orange-900/30`). Seguindo o Airbnb (uma faixa só + flat baseline),
proposta:

- **Flat**: a maioria das superfícies (`Card` no estado de repouso não tem sombra hoje — manter)
- **Elevado** (dropdown, modal, tooltip): uma faixa só —
  `shadow-xl` neutro (sem tingir de cor), como já usado no tooltip de `charts`

Sombras coloridas (`shadow-orange-900/30` etc.) são efeito decorativo pontual,
não elevação — se forem mantidas, não chamar de "shadow" no sentido de
profundidade, é glow.

## Spacing

Sem tailwind config custom — segue a escala padrão do Tailwind (4px base).
Botões: `sm` `px-3 py-1.5`, `md` `px-4 py-2`, `lg` `px-6 py-3` (ver `Button.tsx`).
Card padding: `sm` `p-4`, `md` `p-7`, `lg` `p-9`.

## Componentes de referência (seguir este padrão, não reinventar)

- `Button.tsx` — variant (`primary`/`aqua`/`neon`/`ghost`/`danger`) + size, nunca cor solta em `className`
- `Card.tsx` — padding `sm`/`md`/`lg`, sempre `bg-surface`
- `Stat.tsx` — label muted uppercase + valor `font-display` + badge de tendência em `tone-muted`

## Débito conhecido (não corrigido automaticamente — decidir antes de mexer)

Vários componentes mais antigos (`PlaylistImports.tsx`, `EnrichQueue.tsx`,
`ChannelsPreview.tsx` e outros) usam cores/radius/sombra fora da paleta
(`indigo-600`, `yellow-500`, `gray-800`, `rounded-xl`, `shadow-orange-900/30`).
Não foram tocados agora — é uma varredura maior, avisar antes de fazer.
