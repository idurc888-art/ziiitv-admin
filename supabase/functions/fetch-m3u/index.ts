// Edge Function: fetch-m3u
// Proxy seguro para baixar listas M3U de provedores IPTV que bloqueiam requests diretos.
// A TV e o Admin chamam esta função passando a URL — ela tenta com headers de player de TV.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// Sets de headers simulando players IPTV comuns
const HEADER_SETS = [
  // FFmpeg/Lavf — player mais comum em STBs
  {
    'User-Agent': 'Lavf/58.76.100',
    'Accept': '*/*',
    'Connection': 'keep-alive',
  },
  // VLC
  {
    'User-Agent': 'VLC/3.0.18 LibVLC/3.0.18',
    'Accept': 'application/x-mpegURL, application/vnd.apple.mpegurl, */*',
  },
  // Kodi
  {
    'User-Agent': 'Kodi/20.2 (Linux; Android 10)',
    'Accept': '*/*',
  },
  // Android TV genérico
  {
    'User-Agent': 'Mozilla/5.0 (Linux; Android 10; SmartTV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0 Safari/537.36',
    'Accept': '*/*',
  },
  // Tizen (Samsung Smart TV)
  {
    'User-Agent': 'Mozilla/5.0 (SMART-TV; Linux; Tizen 6.0) AppleWebKit/538.1 (KHTML, like Gecko) Version/6.0 TV Safari/538.1',
    'Accept': '*/*',
  },
];

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Método não permitido' }), {
      status: 405, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await req.json();
    const targetUrl: string = body.url;

    if (!targetUrl || !targetUrl.startsWith('http')) {
      return new Response(JSON.stringify({ error: 'URL inválida' }), {
        status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    let lastError = 'Falha desconhecida';
    let content   = '';

    for (const headers of HEADER_SETS) {
      try {
        const resp = await fetch(targetUrl, { headers, redirect: 'follow' });

        if (resp.status === 401 || resp.status === 403) {
          // Bloqueio definitivo
          return new Response(JSON.stringify({
            error: `Provedor bloqueou o acesso (HTTP ${resp.status}). Baixe o arquivo .m3u manualmente.`,
            blocked: true,
          }), { status: 403, headers: { ...CORS, 'Content-Type': 'application/json' } });
        }

        if (!resp.ok) {
          lastError = `HTTP ${resp.status}: ${resp.statusText}`;
          continue;
        }

        content = await resp.text();

        // Valida que é M3U
        if (!content.trim().startsWith('#EXTM3U') && !content.includes('#EXTINF')) {
          lastError = `Resposta não é um arquivo M3U válido`;
          continue;
        }

        // Sucesso — retorna o conteúdo
        return new Response(JSON.stringify({ success: true, content }), {
          status: 200,
          headers: { ...CORS, 'Content-Type': 'application/json' },
        });

      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
      }
    }

    // Todos os sets de headers falharam
    return new Response(JSON.stringify({
      error: `Não foi possível baixar a lista: ${lastError}. Baixe o arquivo .m3u manualmente e use o modo Arquivo.`,
      blocked: false,
    }), { status: 502, headers: { ...CORS, 'Content-Type': 'application/json' } });

  } catch (e) {
    return new Response(JSON.stringify({ error: `Erro interno: ${e}` }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
