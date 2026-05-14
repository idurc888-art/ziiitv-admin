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

# ── Episode detection — ordem importa: mais específico primeiro ───────────────
EPISODE_PATTERNS = [
    (re.compile(r'\b[ST]\s*0*(\d{1,2})\s*[Ex]\s*0*(\d{1,3})\b', re.I), 'full'),  # S01E01, T01E01
    (re.compile(r'\b0*(\d{1,2})\s*x\s*0*(\d{1,3})\b'), 'full'),                   # 1x01
    (re.compile(r'\bSeas(?:on)?\s*0*(\d{1,2})\s*Ep(?:isode)?\s*0*(\d{1,3})\b', re.I), 'full'),
    (re.compile(r'\bTemporada\s*0*(\d{1,2})\s*Epis[oó]dio\s*0*(\d{1,3})\b', re.I), 'full'),
    (re.compile(r'\bEP[IS]?\s*\.?\s*0*(\d{1,3})\b', re.I), 'ep_only'),            # EP01 → season 1
    (re.compile(r'\b[ST]\s*0*(\d{1,2})\b', re.I), 'season_only'),                 # T01 sozinho
]

# ── Streaming — mais longo primeiro para evitar match parcial ─────────────────
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
    """Remove acentos e lowercase — para comparar títulos."""
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
    """Extrai (season, episode) do nome BRUTO — antes de qualquer limpeza."""
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
    """Remove prefixos de streaming, marcadores técnicos, episódios e lixo."""
    s = raw
    # Remove prefixo de streaming no início: "NETFLIX |", "| HBO |"
    s = STREAMING_PREFIX_RE.sub('', s)
    s = re.sub(r'\|\s*(?:NETFLIX|AMAZON|PRIME|HBO|DISNEY|STAR|PARAMOUNT|APPLE|GLOBO|CRUNCHYROLL|TELECINE)\s*$', '', s, flags=re.I)
    # Remove label de categoria: "SÉRIE |", "FILME:"
    s = re.sub(r'^(?:S[EÉ]RIES?|FILMES?|MOVIES?|ANIMES?)[\s|:]+', '', s, flags=re.I)
    # Remove colchetes, chaves e parênteses
    s = re.sub(r'\[[^\]]*\]|\{[^}]*\}|\([^)]*\)', '', s)
    # Remove códigos de episódio
    s = re.sub(r'\b[ST]\s*\d{1,2}\s*[Ex]\s*\d{1,3}\b', '', s, flags=re.I)
    s = re.sub(r'\b\d{1,2}\s*x\s*\d{1,3}\b', '', s)
    s = re.sub(r'\bEP[IS]?\s*\.?\s*\d{1,3}\b', '', s, flags=re.I)
    s = re.sub(r'\bSeas(?:on)?\s+\d+\b|\bTemporada\s+\d+\b', '', s, flags=re.I)
    # Remove qualidade e codec
    s = re.sub(r'\b(4K|UHD|2160[Pp]?|FHD|FULL[\s.\-]?HD|1080[Pp]?|HD|720[Pp]?|SD|480[Pp]?|360[Pp]?|H\.?265|H\.?264|HEVC|AVC)\b', '', s, flags=re.I)
    # Remove dub/leg
    s = re.sub(r'\b(DUAL|DUB(?:LADO)?|LEG(?:ENDADO)?|PT-?BR|LEGENDAS|SUB(?:TITULO)?)\b', '', s, flags=re.I)
    # Remove ano isolado
    s = re.sub(r'\b(?:19|20)\d{2}\b', '', s)
    # Remove VOD, VIP, etc
    s = re.sub(r'\b(VOD|VIP|PREMIUM|PLUS|ULTRA|ONLINE)\b', '', s, flags=re.I)
    # Limpa separadores e espaços extras
    s = re.sub(r'[|_.\-–—:]+', ' ', s)
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
    # Fallback: nome bruto tem padrão de episódio?
    if extract_episode(raw_name):  return 'series'
    return 'live'


# ── Parser ────────────────────────────────────────────────────────────────────

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
    """
    Classifica → normaliza → agrupa episódios → dedup.
    Retorna: { series: [...], movies: [...], live: [...] }
    """
    series_map = {}   # norm(title) → entry
    movie_map  = {}   # norm(title) → entry
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

        # ── Live TV: só agrupa por URL ────────────────────────────────────────
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

        # ── Extrai episódio ANTES de limpar o nome ────────────────────────────
        ep         = extract_episode(name) if ctype == 'series' else None
        streaming  = detect_streaming(name, group)
        quality    = detect_quality(name)
        dub        = detect_dub(name)
        title_clean = clean_title(name)

        if not title_clean or len(title_clean) < 2:
            continue

        title_key = norm(title_clean)

        stream = {'u': url, 'q': quality}
        if dub:
            stream['dub'] = dub
        if ep and ep[1]:
            stream['label'] = f"S{ep[0]:02d}E{ep[1]:02d}"

        target = series_map if ctype == 'series' else movie_map

        if title_key in target:
            entry = target[title_key]
            # Dedup por URL exata
            if not any(s['u'] == url for s in entry['streams']):
                entry['streams'].append(stream)
            # Acumula episódios na temporada
            if ep and ep[0] and ep[1]:
                seasons = entry['seasons']
                if ep[0] not in seasons:
                    seasons[ep[0]] = []
                if ep[1] not in seasons[ep[0]]:
                    seasons[ep[0]].append(ep[1])
            # Preferir fonte com streaming identificado
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

    # Ordena streams por qualidade e episódios por número
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
            length       = int(self.headers.get('Content-Length', 0))
            body         = json.loads(self.rfile.read(length))
            playlist_id  = body.get('playlist_id')
            url          = body.get('url')
            storage_path = body.get('storage_path')
            source       = body.get('source')  # 'raw_channels' para arquivos grandes

            valid = playlist_id and (url or storage_path or source == 'raw_channels')
            if not valid:
                return self._error(400, 'Precisa de playlist_id e (url, storage_path ou source=raw_channels)')

            sb('PATCH', f'playlists?id=eq.{playlist_id}', {'status': 'processing'})

            pl_rows = sb('GET', f'playlists?id=eq.{playlist_id}&select=content_hash,user_id', prefer='')
            pl = pl_rows[0] if pl_rows else {}
            user_id = pl.get('user_id')
            if not user_id:
                raise Exception('user_id não encontrado na playlist')

            # ── Obtém os canais brutos ────────────────────────────────────────
            if source == 'raw_channels':
                # Browser já fez o parse e inseriu na tabela raw_channels
                raw_rows = []
                limit, offset = 10000, 0
                while True:
                    page = sb('GET', f'raw_channels?playlist_id=eq.{playlist_id}&select=name,group_name,logo,url&limit={limit}&offset={offset}', prefer='')
                    if not page:
                        break
                    raw_rows.extend(page)
                    if len(page) < limit:
                        break
                    offset += limit
                # Limpa staging imediatamente
                sb('DELETE', f'raw_channels?playlist_id=eq.{playlist_id}')
                raw = [{'name': r['name'], 'group': r['group_name'], 'logo': r['logo'], 'url': r['url']} for r in raw_rows]
                # Hash baseado nas primeiras 5K URLs
                sample = ''.join(r['url'] for r in raw_rows[:5000])
                content_hash = hashlib.sha256(sample.encode()).hexdigest()[:32]
            elif url:
                req = urllib.request.Request(url, headers={
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
                    'Accept': '*/*',
                })
                with urllib.request.urlopen(req, timeout=30) as resp:
                    content = resp.read().decode('utf-8', errors='replace')
                raw = parse_m3u(content)
                content_hash = hashlib.sha256(content[:50000].encode()).hexdigest()[:32]
            else:
                req = urllib.request.Request(
                    f"{SUPABASE_URL}/storage/v1/object/{storage_path}",
                    headers={'Authorization': f'Bearer {SUPABASE_KEY}'},
                )
                with urllib.request.urlopen(req) as resp:
                    content = resp.read().decode('utf-8', errors='replace')
                raw = parse_m3u(content)
                content_hash = hashlib.sha256(content[:50000].encode()).hexdigest()[:32]

            # ── Dedup por hash ────────────────────────────────────────────────
            if pl.get('content_hash') == content_hash:
                sb('PATCH', f'playlists?id=eq.{playlist_id}', {
                    'status': 'ready',
                    'processed_at': now_iso(),
                })
                return self._json({'success': True, 'skipped': True, 'reason': 'content_unchanged'})

            # ── Pipeline ──────────────────────────────────────────────────────
            result       = process_channels(raw)
            series       = result['series']
            movies       = result['movies']
            live         = result['live']
            all_channels = series + movies + live

            sb('DELETE', f'channels?playlist_id=eq.{playlist_id}')
            inserted = save_channels(playlist_id, user_id, all_channels)

            try:
                enrichable = len(series) + len(movies)
                if enrichable > 0:
                    sb('POST', 'enrich_jobs', [{
                        'playlist_id':     playlist_id,
                        'status':          'pending',
                        'total_count':     enrichable,
                        'processed_count': 0,
                    }])
            except Exception:
                pass

            sb('PATCH', f'playlists?id=eq.{playlist_id}', {
                'status':        'ready',
                'channel_count': inserted,
                'content_hash':  content_hash,
                'processed_at':  now_iso(),
                'error_message': None,
            })

            self._json({
                'success':  True,
                'raw':      len(raw),
                'series':   len(series),
                'movies':   len(movies),
                'live':     len(live),
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
