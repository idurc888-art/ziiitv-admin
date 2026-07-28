# Worker de importação QI220

Este processo consome a fila PGMQ `playlist_imports`. Ele não deve ser executado no navegador nem como função curta da Vercel.

## Variáveis obrigatórias

- `SUPABASE_URL`: URL do novo projeto Supabase.
- `SUPABASE_SERVICE_ROLE_KEY`: segredo disponível somente no runtime do worker.
- `WORKER_MODE=continuous`: mantém polling da fila; omita para processar no máximo uma mensagem e sair.

## Container

O contexto do build deve ser a raiz do `ziiitv-admin`:

```bash
docker build -f worker/Dockerfile -t ziiitv-playlist-worker .
```

Execute como background worker em uma rede com saída HTTPS. Escale horizontalmente apenas aumentando réplicas do mesmo container; o claim PGMQ impede que duas réplicas recebam a mesma mensagem visível.

O processo responde a `SIGTERM`/`SIGINT`, termina o lote em curso e então encerra. Não existe porta HTTP nem credencial embutida na imagem.
