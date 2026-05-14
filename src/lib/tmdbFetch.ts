const TMDB_KEY: string =
  (typeof import.meta !== 'undefined' ? (import.meta as any).env?.VITE_TMDB_API_KEY : undefined)
  ?? (typeof process !== 'undefined' ? process.env.VITE_TMDB_API_KEY : undefined)
  ?? 'b68afbadedebf0889f00a0cf577d3e5a'

/**
 * Faz a chamada detalhada para o TMDB (Movie ou TV) puxando vídeos, créditos e datas de lançamento.
 * Retorna um objeto com os metadados enriquecidos para o banco.
 */
export async function getDetailedTMDBData(tmdbId: number, type: 'movie' | 'tv' | 'series'): Promise<any> {
  const actualType = type === 'series' ? 'tv' : type
  const isTv = actualType === 'tv'
  
  // Appends: credits (elenco e direção), videos (trailers), release_dates / content_ratings (Classificação indicativa)
  const append = isTv ? 'credits,videos,content_ratings' : 'credits,videos,release_dates'
  const url = `https://api.themoviedb.org/3/${actualType}/${tmdbId}?api_key=${TMDB_KEY}&language=pt-BR&append_to_response=${append}`

  try {
    const res = await fetch(url)
    if (!res.ok) return null
    
    const details = await res.json()

    // 1. Genres
    const genres = (details.genres || []).map((g: any) => g.name)

    // 2. Cast & Director
    const credits = details.credits || {}
    const rawCast = credits.cast || []
    
    // Limita para top 10 atores
    const castinfo = rawCast.slice(0, 10).map((c: any) => ({
      name: c.name,
      character: c.character,
      profile_path: c.profile_path ? `https://image.tmdb.org/t/p/w185${c.profile_path}` : null
    }))

    // Diretor (apenas para movies ou series se aplicável)
    const crew = credits.crew || []
    const directorObj = crew.find((c: any) => c.job === 'Director')
    const director = directorObj ? directorObj.name : null

    // 3. Trailer URL (Busca primeiro PT-BR no youtube, se não achar, usa default array com pt-BR e en-US)
    const videos = (details.videos?.results || [])
    let trailer_url = null
    
    // Filtra apenas do Youtube
    const ytVideos = videos.filter((v: any) => v.site === 'YouTube' && v.type === 'Trailer')
    // Pega o primeiro trailer PT-BR
    let trailer = ytVideos.find((v: any) => v.iso_639_1 === 'pt')
    // Se não tiver, cai pro que tiver (Inglês)
    if (!trailer) trailer = ytVideos[0]
    
    if (trailer) {
      trailer_url = trailer.key // key do youtube (e.g. dQw4w9WgXcQ)
    }

    // 4. Age Rating (Classificação Indicativa)
    let age_rating = null
    if (isTv) {
      const results = details.content_ratings?.results || []
      const brRating = results.find((r: any) => r.iso_3166_1 === 'BR')
      if (brRating) age_rating = brRating.rating
      else if (results.length > 0) age_rating = results[0].rating // pega o EUA se não tiver
    } else {
      const results = details.release_dates?.results || []
      const brRating = results.find((r: any) => r.iso_3166_1 === 'BR')
      if (brRating && brRating.release_dates && brRating.release_dates.length > 0) {
        age_rating = brRating.release_dates[0].certification
      } else if (results.length > 0 && results[0].release_dates?.[0]?.certification) {
        age_rating = results[0].release_dates[0].certification
      }
    }

    // 5. Duração
    let duration = null
    if (isTv) {
      if (details.episode_run_time && details.episode_run_time.length > 0) {
        duration = details.episode_run_time[0]
      }
    } else {
      duration = details.runtime
    }

    return {
      genres,
      castinfo,
      director,
      age_rating: age_rating === '' ? null : age_rating,
      duration,
      trailer_url
    }
  } catch (err) {
    console.error('Falha ao buscar detalhes TMDB:', err)
    return null
  }
}
