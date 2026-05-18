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

function extractArray(data: any): any[] {
  if (Array.isArray(data))             return data;
  if (data && Array.isArray(data.data))    return data.data;
  if (data && Array.isArray(data.result))  return data.result;
  if (data && Array.isArray(data.streams)) return data.streams;
  return [];
}

async function fetchAction(url: string): Promise<{ items: any[]; status: number; raw: string }> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 25000);
    const resp  = await fetch(url, { headers: HEADERS, signal: ctrl.signal });
    clearTimeout(timer);
    const text  = await resp.text();
    let parsed: any = null;
    try { parsed = JSON.parse(text) } catch { /* não é JSON */ }
    return { items: parsed ? extractArray(parsed) : [], status: resp.status, raw: text.slice(0, 400) };
  } catch (e) {
    return { items: [], status: 0, raw: String(e) };
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

    // Busca em série para não sobrecarregar e respeitar o timeout total
    const vodResult    = await fetchAction(`${base}&action=get_vod_streams`);
    const seriesResult = await fetchAction(`${base}&action=get_series`);
    const liveResult   = await fetchAction(`${base}&action=get_live_streams`);

    const vod    = vodResult.items;
    const series = seriesResult.items;
    const live   = liveResult.items;

    if (vod.length === 0 && series.length === 0 && live.length === 0) {
      return ok({
        success: false,
        error: 'Servidor não retornou canais.',
        debug: {
          vod_status:    vodResult.status,    vod_raw:    vodResult.raw,
          series_status: seriesResult.status, series_raw: seriesResult.raw,
          live_status:   liveResult.status,   live_raw:   liveResult.raw,
        },
      });
    }

    return ok({ success: true, vod, series, live });

  } catch (e) {
    return ok({ success: false, error: `Erro interno: ${e}` });
  }
});
