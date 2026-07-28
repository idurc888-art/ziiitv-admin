const host = process.env.XTREAM_HOST
const user = process.env.XTREAM_USER
const pass = process.env.XTREAM_PASS
const url = new URL('/player_api.php', host)
url.searchParams.set('username', user)
url.searchParams.set('password', pass)
url.searchParams.set('action', 'get_live_categories')
console.log('URL host:', url.hostname)
try {
  const res = await fetch(url, { headers: { 'User-Agent': 'ziiiTV-import-worker/1.0', Accept: '*/*' } })
  console.log('status:', res.status)
} catch (e) {
  console.log('ERROR:', e.message)
  console.log('cause:', e.cause)
}
