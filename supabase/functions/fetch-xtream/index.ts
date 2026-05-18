import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Linux; Android 10; SmartTV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0 Safari/537.36',
  'Accept': 'application/json, */*',
};

async function fetchAction(base: string, action: string): Promise<any[]> {
  try {
    const resp = await fetch(`${base}&action=${action}`, { headers: HEADERS });
    if (!resp.ok) return [];
    const data = await resp.json();
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

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
    const { host, username, password } = await req.json();

    if (!host || !username || !password) {
      return new Response(JSON.stringify({ error: 'host, username e password são obrigatórios' }), {
        status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    const cleanHost = host.replace(/\/+$/, '');
    const base = `${cleanHost}/player_api.php?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`;

    // Verifica credenciais primeiro
    const authResp = await fetch(`${base}&action=get_account_info`, { headers: HEADERS });
    if (authResp.status === 403 || authResp.status === 401) {
      return new Response(JSON.stringify({ error: 'Credenciais inválidas ou acesso negado pelo servidor Xtream.' }), {
        status: 401, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    const [vod, series, live] = await Promise.all([
      fetchAction(base, 'get_vod_streams'),
      fetchAction(base, 'get_series'),
      fetchAction(base, 'get_live_streams'),
    ]);

    return new Response(JSON.stringify({ success: true, vod, series, live }), {
      status: 200, headers: { ...CORS, 'Content-Type': 'application/json' },
    });

  } catch (e) {
    return new Response(JSON.stringify({ error: `Erro interno: ${e}` }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
