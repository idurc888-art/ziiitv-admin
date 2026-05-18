import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-client-info, apikey',
};

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Linux; Android 10; SmartTV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0 Safari/537.36',
  'Accept': 'application/json, */*',
};

function ok(body: object) {
  return new Response(JSON.stringify(body), {
    status: 200, headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

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

  try {
    const { host, username, password } = await req.json();

    if (!host || !username || !password) {
      return ok({ success: false, error: 'host, username e password são obrigatórios' });
    }

    const cleanHost = host.replace(/\/+$/, '');
    const base = `${cleanHost}/player_api.php?username=${username}&password=${password}`;

    const [vod, series, live] = await Promise.all([
      fetchAction(base, 'get_vod_streams'),
      fetchAction(base, 'get_series'),
      fetchAction(base, 'get_live_streams'),
    ]);

    if (vod.length === 0 && series.length === 0 && live.length === 0) {
      return ok({ success: false, error: 'Servidor Xtream não retornou canais. Verifique host, usuário e senha.' });
    }

    return ok({ success: true, vod, series, live });

  } catch (e) {
    return ok({ success: false, error: `Erro interno: ${e}` });
  }
});
