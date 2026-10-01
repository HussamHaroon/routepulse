// Favorite routes — persisted in localStorage (P1 feature).
const KEY = 'rp_fav_routes'

export function getFavs() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) ?? []
  } catch {
    return []
  }
}

export function toggleFav(id) {
  const favs = getFavs()
  const i = favs.indexOf(String(id))
  if (i === -1) favs.push(String(id))
  else favs.splice(i, 1)
  localStorage.setItem(KEY, JSON.stringify(favs))
  return favs
}

export const isFav = (id) => getFavs().includes(String(id))
