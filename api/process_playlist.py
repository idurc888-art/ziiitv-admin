import json
import re
import os
import unicodedata
import hashlib
import urllib.request
import urllib.error
from http.server import BaseHTTPRequestHandler
from datetime import datetime, timezone

SUPABASE_URL = os.environ.get('SUPABASE_URL', '')
SUPABASE_KEY = os.environ.get('SUPABASE_SERVICE_ROLE_KEY', '')

CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

# ── Episode detection ─────────────────────────────────────────────────────────
EPISODE_PATTERNS = [
    (re.compile(r'\b[ST]\s*0*(\d{1,2})\s*[Ex]\s*0*(\d{1,3})\b', re.I), 'full'),
    (re.compile(r'\b0*(\d{1,2})\s*x\s*0*(\d{1,3})\b'), 'full'),
    (re.compile(r'\bSeas(?:on)?\s*0*(\d{1,2})\s*Ep(?:isode)?\s*0*(\d{1,3})\b', re.I), 'full'),
    (re.compile(r'\bTemporada\s*0*(\d{1,2})\s*Epis[oó]dio\s*0*(\d{1,3})\b', re.I), 'full'),
    (re.compile(r'\bEP[IS]?\s*\.?\s*0*(\d{1,3})\b', re.I), 'ep_only'),
    (re.compile(r'\b[ST]\s*0*(\d{1,2})\b', re.I), 'season_only'),
]

STREAMING_MAP = [
    ('apple tv+', 'apple'), ('apple tv', 'apple'),
    ('amazon prime', 'amazon'), ('prime video', 'amazon'),
    ('hbo max', 'hbo'), ('hbomax', 'hbo'),
    ('disney+', 'disney'), ('disney plus', 'disney'),
    ('star+', 'disney'), ('star plus', 'disney'),
    ('paramount+', 'paramount'),
    ('globo play', 'globoplay'), ('globoplay', 'globoplay'),
    ('crunchyroll', 'crunchyroll'), ('telecine', 'telecine'),
    ('netflix', 'netflix'), ('amazon', 'amazon'), ('disney', 'disney'),
    ('hbo', 'hbo'), ('apple', 'apple'), ('paramount', 'paramount'), ('globo', 'globoplay'),
]

QUALITY_PATTERNS = [
    (re.compile(r'\b4K\b|\bUHD\b|\b2160[Pp]?\b'), '4K'),
    (re.compile(r'\bFHD\b|\bFULL[\s.\-]?HD\b|\b1080[Pp]?\b'), 'FHD'),
    (re.compile(r'\bHD\b|\b720[Pp]?\b'), 'HD'),
    (re.compile(r'\bSD\b|\b480[Pp]?\b|\b360[Pp]?\b'), 'SD'),
]

GROUP_LIVE   = re.compile(r'^(canais?|live|sport|esport|noticias?|news|abertos?|entretenimento|tv[\s_]|ppv|futebol|jogos?|combate|premiere|infantil)', re.I)
GROUP_MOVIE  = re.compile(r'^(filmes?|movies?|\bvod\b|cinema|lançamentos?|estreias?|documentar)', re.I)
GROUP_SERIES = re.compile(r'^(series?|shows?|novelas?|animes?|sitcom|minisser)', re.I)

STREAMING_PREFIX_RE = re.compile(
    r'^[\s|]*(?:NETFLIX|AMAZON|PRIME(?:\s+VIDEO)?|HBO(?:\s*MAX)?|DISNEY\+?|STAR\+?|'
    r'PARAMOUNT\+?|APPLE\s*TV\+?|GLOBO(?:PLAY|\s*PLAY)?|CRUNCHYROLL|TELECINE|UNIVERSAL)[\s|:]+',
    re.I,
)

QUALITY_ORDER = ['4K', 'FHD', 'HD', 'SD', 'UNKNOWN']


# ── Helpers ───────────────────────────────────────────────────────────────────

def norm(s):
    return unicodedata.normalize('NFD', s.lower()).encode('ascii', 'ignore').decode().strip()

def now_iso():
    return datetime.now(timezone.utc).isoformat()

def detect_streaming(name, group):
    combined = norm(f"{group or ''} {name}")
    for key, val in STREAMING_MAP:
        if key in combined:
            return val
    return None

def detect_quality(name):
    for pattern, q in QUALITY_PATTERNS:
        if pattern.search(name):
            return q
    return 'UNKNOWN'

def detect_dub(name):
    n = name.upper()
    if any(x in n for x in ('DUB', 'DUAL', 'DUBLADO', 'PT-BR')):
        return 'D'
    if any(x in n for x in ('LEG', 'LEGENDADO', 'LEGENDAS', 'SUB')):
        return 'L'
    return None

def extract_episode(raw):
    for pattern, mode in EPISODE_PATTERNS:
        m = pattern.search(raw)
        if not m:
            continue
        if mode == 'full':
            return int(m.group(1)), int(m.group(2))
        if mode == 'ep_only':
            return 1, int(m.group(1))
        if mode == 'season_only':
            return int(m.group(1)), None
    return None

def clean_title(raw):
    s = raw
    s = STREAMING_PREFIX_RE.sub('', s)
    s = re.sub(r'\|\s*(?:NETFLIX|AMAZON|PRIME|HBO|DISNEY|STAR|PARAMOUNT|APPLE|GLOBO|CRUNCHYROLL|TELECINE)\s*$', '', s, flags=re.I)
    s = re.sub(r'^(?:S[EÉ]RIES?|FILMES?|MOVIES?|ANIMES?)[\s|:]+', '', s, flags=re.I)
    s = re.sub(r'\[[^\]]*\]|\{[^}]*\}|\([^)]*\)', '', s)
    s = re.sub(r'\b[ST]\s*\d{1,2}\s*[Ex]\s*\d{1,3}\b', '', s, flags=re.I)
    s = re.sub(r'\b\d{1,2}\s*x\s*\d{1,3}\b', '', s)
    s = re.sub(r'\bEP[IS]?\s*\.?\s*\d{1,3}\b', '', s, flags=re.I)
    s = re.sub(r'\bSeas(?:on)?\s+\d+\b|\bTemporada\s+\d+\b', '', s, flags=re.I)
    s = re.sub(r'\b(4K|UHD|2160[Pp]?|FHD|FULL[\s.\-]?HD|1080[Pp]?|HD|720[Pp]?|SD|480[Pp]?|360[Pp]?|H\.?265|H\.?264|HEVC|AVC)\b', '', s, flags=re.I)
    s = re.sub(r'\b(DUAL|DUB(?:LADO)?|LEG(?:ENDADO)?|PT-?BR|LEGENDAS|SUB(?:TITULO)?)\b', '', s, flags=re.I)
    s = re.sub(r'\b(?:19|20)\d{2}\b', '', s)
    s = re.sub(r'\b(VOD|VIP|PREMIUM|PLUS|ULTRA|ONLINE)\b', '', s, flags=re.I)
    s = re.sub(r'[|_.\-\u2013\u2014:]+', ' ', s)
    s = re.sub(r'\s{2,}', ' ', s).strip()
    return s.title() if s else ''

def get_group_prefix(group):
    if not group:
        return ''
    return norm(re.split(r'[|:]', group)[0])

def detect_type(raw_name, group):
    prefix = get_group_prefix(group)
    if GROUP_LIVE.match(prefix):   return 'live'
    if GROUP_MOVIE.match(prefix):  return 'movie'
    if GROUP_SERIES.match(prefix): return 'series'
    if extract_episode(raw_name):  return 'series'
    return 'live'


# ── Parser M3U ────────────────────────────────────────────────────────────────

def parse_m3u(content):
    channels, current = [], None
    for line in content.splitlines():
        line = line.strip()
        if line.startswith('#EXTINF:'):
            name_m  = re.search(r',(.+)$', line)
            group_m = re.search(r'group-title="([^"]*)"', line)
            logo_m  = re.search(r'tvg-logo="([^"]*)"', line)
            current = {
                'name':  name_m.group(1).strip() if name_m else '',
                'group': group_m.group(1) if group_m else None,
                'logo':  logo_m.group(1)  if logo_m  else None,
            }
        elif line and not line.startswith('#') and current and current['name']:
            current['url'] = line
            channels.append(current)
            current = None
    return channels


# ── Pipeline principal ────────────────────────────────────────────────────────

def process_channels(raw_channels):
    series_map = {}
    movie_map  = {}
    live_seen  = set()
    live_list  = []

    for raw in raw_channels:
        name  = raw.get('name', '')
        group = raw.get('group')
        url   = raw.get('url', '')
        logo  = raw.get('logo')

        if not name or not url:
            continue

        ctype = detect_type(name, group)

        if ctype == 'live':
            if url not in live_seen:
                live_seen.add(url)
                live_list.append({
                    'name':         clean_title(name) or name,
                    'group':        group,
                    'logo':         logo or '',
                    'streams':      [{'u': url, 'q': detect_quality(name)}],
                    'streaming':    None,
                    'content_type': 'live',
                    'seasons':      None,
                    'enriched':     False,
                })
            continue

        ep          = extract_episode(name) if ctype == 'series' else None
        streaming   = detect_streaming(name, group)
        quality     = detect_quality(name)
        dub         = detect_dub(name)
        title_clean = clean_title(name)

        if not title_clean or len(title_clean) < 2:
            continue

        title_key = norm(title_clean)
        stream    = {'u': url, 'q': quality}
        if dub:
            stream['dub'] = dub
        if ep and ep[1]:
            stream['label'] = f"S{ep[0]:02d}E{ep[1]:02d}"

        target = series_map if ctype == 'series' else movie_map

        if title_key in target:
            entry = target[title_key]
            if not any(s['u'] == url for s in entry['streams']):
                entry['streams'].append(stream)
            if ep and ep[0] and ep[1]:
                seasons = entry['seasons']
                if ep[0] not in seasons:
                    seasons[ep[0]] = []
                if ep[1] not in seasons[ep[0]]:
                    seasons[ep[0]].append(ep[1])
            if not entry['streaming'] and streaming:
                entry['streaming'] = streaming
            if not entry['logo'] and logo:
                entry['logo'] = logo
        else:
            seasons = {}
            if ep and ep[0] and ep[1]:
                seasons = {ep[0]: [ep[1]]}
            target[title_key] = {
                'name':         title_clean,
                'group':        group,
                'logo':         logo or '',
                'streams':      [stream],
                'streaming':    streaming,
                'content_type': ctype,
                'seasons':      seasons if ctype == 'series' else None,
                'enriched':     False,
            }

    for entry in list(series_map.values()) + list(movie_map.values()):
        entry['streams'].sort(
            key=lambda s: QUALITY_ORDER.index(s['q']) if s['q'] in QUALITY_ORDER else 99
        )
    for entry in series_map.values():
        for s in entry['seasons']:
            entry['seasons'][s].sort()

    return {
        'series': list(series_map.values()),
        'movies': list(movie_map.values()),
        'live':   live_list,
    }


# ── Supabase REST ─────────────────────────────────────────────────────────────

def sb(method, path, body=None, prefer='return=minimal'):
    url  = f"{SUPABASE_URL}/rest/v1/{path}"
    data = json.dumps(body).encode() if body is not None else None
    req  = urllib.request.Request(url, data=data, method=method)
    req.add_header('apikey', SUPABASE_KEY)
    req.add_header('Authorization', f'Bearer {SUPABASE_KEY}')
    req.add_header('Content-Type', 'application/json')
    req.add_header('Prefer', prefer)
    try:
        with urllib.request.urlopen(req) as resp:
            raw = resp.read()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        raise Exception(f"Supabase {method} {path} → {e.code}: {e.read().decode()[:200]}")


def save_channels(playlist_id, user_id, channels):
    inserted = 0
    for i in range(0, len(channels), 300):
        batch = [
            {
                'playlist_id':  playlist_id,
                'user_id':      user_id,
                'name':         ch['name'],
                'streams':      ch['streams'],
                'group_name':   ch['group'],
                'logo_url':     ch['logo'] or None,
                'canonical_id': None,
                'streaming':    ch['streaming'],
                'content_type': ch['content_type'],
                'seasons':      ch['seasons'],
                'enriched':     False,
            }
            for ch in channels[i:i+300]
        ]
        sb('POST', 'channels', batch)
        inserted += len(batch)
    return inserted


# ── Fetch URL com fallback de headers IPTV ───────────────────────────────────

IPTV_HEADERS = [
    # Tenta simular player de TV comum
    {
        'User-Agent': 'Lavf/58.76.100',
        'Accept': '*/*',
        'Connection': 'keep-alive',
    },
    # Tenta simular VLC
    {
        'User-Agent': 'VLC/3.0.18 LibVLC/3.0.18',
        'Accept': '*/*',
    },
    # Tenta simular browser Android TV
    {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 10; SmartTV) AppleWebKit/537.36',
        'Accept': 'application/x-mpegURL, application/vnd.apple.mpegurl, */*',
        'Referer': '',
    },
    # Fallback genérico
    {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Accept': '*/*',
    },
]


def fetch_m3u_url(url):
    """Tenta baixar M3U com múltiplos sets de headers. Retorna conteúdo ou lança exceção."""
    last_error = None
    for headers in IPTV_HEADERS:
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=30) as resp:
                content = resp.read().decode('utf-8', errors='replace')
                if content.strip().startswith('#EXTM3U') or '#EXTINF' in content[:500]:
                    return content
                # Se retornou algo mas não parece M3U, continua tentando
                last_error = Exception(f'Resposta não é M3U válido (primeiros chars: {content[:80]!r})')
        except urllib.error.HTTPError as e:
            last_error = Exception(f'HTTP {e.code}: {e.reason} — provedor bloqueou a requisição')
            if e.code in (401, 403):
                # 401/403 é bloqueio definitivo, não adianta tentar outros headers
                raise Exception(
                    f'Acesso bloqueado pelo provedor IPTV (HTTP {e.code}). '
                    'Baixe o arquivo .m3u manualmente e use o modo Arquivo.'
                )
        except Exception as e:
            last_error = e
    raise last_error or Exception('Não foi possível baixar a lista M3U')


# ── Handler Vercel ────────────────────────────────────────────────────────────

class handler(BaseHTTPRequestHandler):

    def log_message(self, *args):
        pass

    def do_OPTIONS(self):
        self.send_response(204)
        for k, v in CORS.items():
            self.send_header(k, v)
        self.end_headers()

    def do_POST(self):
        playlist_id = None
        try:
            length  = int(self.headers.get('Content-Length', 0))
            raw_body = self.rfile.read(length)

            # Detecta body truncado (< Content-Length real)
            if len(raw_body) < length:
                return self._error(400, f'Body truncado: esperado {length} bytes, recebeu {len(raw_body)}. Arquivo muito grande para este endpoint.')

            body = json.loads(raw_body)
            playlist_id    = body.get('playlist_id')
            url            = body.get('url')
            storage_path   = body.get('storage_path')
            content_inline = body.get('content')       # arquivo pequeno direto
            from_db        = body.get('from_db', False) # modo: canais já estão no banco (batch do browser)

            if not playlist_id:
                return self._error(400, 'Falta playlist_id')

            if not from_db and not url and not storage_path and not content_inline:
                return self._error(400, 'Precisa de: url, storage_path, content ou from_db=true')

            # Busca playlist info
            pl_rows = sb('GET', f'playlists?id=eq.{playlist_id}&select=content_hash,user_id', prefer='')
            if not pl_rows:
                return self._error(404, f'Playlist {playlist_id} não encontrada')
            pl      = pl_rows[0]
            user_id = pl.get('user_id')
            if not user_id:
                return self._error(400, 'user_id não encontrado na playlist')

            sb('PATCH', f'playlists?id=eq.{playlist_id}', {'status': 'processing'})

            # ── MODO from_db: canais raw já foram salvos pelo browser em batches ──
            if from_db:
                # Lê os canais raw da tabela channels (content_type IS NULL = raw ainda não processado)
                # Busca em páginas de 1000
                all_raw = []
                offset  = 0
                while True:
                    page = sb('GET',
                        f'channels?playlist_id=eq.{playlist_id}&enriched=eq.false&select=name,group_name,logo_url,streams&order=id&limit=1000&offset={offset}',
                        prefer=''
                    )
                    if not page:
                        break
                    all_raw.extend(page)
                    if len(page) < 1000:
                        break
                    offset += 1000

                if not all_raw:
                    return self._error(400, 'Nenhum canal raw encontrado no banco para esta playlist. O browser enviou os batches?')

                # Converte formato do banco para formato do parser
                raw_channels = [
                    {
                        'name':  r.get('name', ''),
                        'group': r.get('group_name'),
                        'logo':  r.get('logo_url'),
                        'url':   (r.get('streams') or [{}])[0].get('u', '') if r.get('streams') else '',
                    }
                    for r in all_raw
                ]

                # Limpa os canais raw antes de salvar os processados
                sb('DELETE', f'channels?playlist_id=eq.{playlist_id}')

                result    = process_channels(raw_channels)
                all_ch    = result['series'] + result['movies'] + result['live']
                inserted  = save_channels(playlist_id, user_id, all_ch)

                enrichable = len(result['series']) + len(result['movies'])
                if enrichable > 0:
                    sb('POST', 'enrich_jobs', [{
                        'playlist_id':     playlist_id,
                        'status':          'pending',
                        'total_count':     enrichable,
                        'processed_count': 0,
                    }])

                sb('PATCH', f'playlists?id=eq.{playlist_id}', {
                    'status':        'ready',
                    'channel_count': inserted,
                    'processed_at':  now_iso(),
                    'error_message': None,
                })

                return self._json({
                    'success':  True,
                    'mode':     'from_db',
                    'raw':      len(all_raw),
                    'series':   len(result['series']),
                    'movies':   len(result['movies']),
                    'live':     len(result['live']),
                    'inserted': inserted,
                })

            # ── MODO normal: busca o conteúdo e processa aqui ─────────────────
            if content_inline:
                content = content_inline
            elif url:
                content = fetch_m3u_url(url)
            else:
                req = urllib.request.Request(
                    f"{SUPABASE_URL}/storage/v1/object/{storage_path}",
                    headers={'Authorization': f'Bearer {SUPABASE_KEY}'},
                )
                with urllib.request.urlopen(req) as resp:
                    content = resp.read().decode('utf-8', errors='replace')

            # Hash para evitar reprocessamento desnecessário
            content_hash = hashlib.sha256(content[:50000].encode()).hexdigest()[:32]

            if pl.get('content_hash') == content_hash:
                sb('PATCH', f'playlists?id=eq.{playlist_id}', {
                    'status':       'ready',
                    'processed_at': now_iso(),
                })
                return self._json({'success': True, 'skipped': True, 'reason': 'content_unchanged'})

            raw    = parse_m3u(content)
            result = process_channels(raw)
            all_ch = result['series'] + result['movies'] + result['live']

            sb('DELETE', f'channels?playlist_id=eq.{playlist_id}')
            inserted = save_channels(playlist_id, user_id, all_ch)

            enrichable = len(result['series']) + len(result['movies'])
            if enrichable > 0:
                sb('POST', 'enrich_jobs', [{
                    'playlist_id':     playlist_id,
                    'status':          'pending',
                    'total_count':     enrichable,
                    'processed_count': 0,
                }])

            sb('PATCH', f'playlists?id=eq.{playlist_id}', {
                'status':        'ready',
                'channel_count': inserted,
                'content_hash':  content_hash,
                'processed_at':  now_iso(),
                'error_message': None,
            })

            self._json({
                'success':  True,
                'mode':     'direct',
                'raw':      len(raw),
                'series':   len(result['series']),
                'movies':   len(result['movies']),
                'live':     len(result['live']),
                'inserted': inserted,
            })

        except Exception as e:
            if playlist_id:
                try:
                    sb('PATCH', f'playlists?id=eq.{playlist_id}', {
                        'status':        'error',
                        'error_message': str(e)[:500],
                    })
                except Exception:
                    pass
            self._error(500, str(e))

    def _json(self, data, status=200):
        body = json.dumps(data).encode()
        self.send_response(status)
        for k, v in CORS.items():
            self.send_header(k, v)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _error(self, status, message):
        self._json({'error': message}, status)
