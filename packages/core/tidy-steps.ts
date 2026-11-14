// "Arreglar nombres y tags": los pasos del asistente (salvo el 2, en tidy-filename.ts). Cada paso recibe el contexto
// (core/tidy.ts: los temas, cómo van quedando y lo propuesto) y propone cambios o deja cosas "para mirar a mano".
import path from 'node:path'
import { ArtistSpelling, artistParts, djMc, hasVinylOnly, isSeparator, isVinylTrack, looksLikeLabel, mergeFeat, nameList, normalizeFeat, splitFeat, stripArtistFromTitle, stripChannel, stripVinylOnly, vinylSide } from './artists'
import { type Db } from './db'
import { canonGenre } from './genrewords'
import { extensionFix, sniff, suspicious } from './extensions'
import { classify } from './folderplaylists'
import { caseKind, cleanBase, fold, isCatalog, smartCase, stripCopy, stripMarks, stripSitePrefix, stylized, tidySpaces, underscoreDoubt } from './names'
import { fixMojibake, stripJunk } from './tagactions'
import { learnedStrip } from './tidy-learned'
import { safeName, type TagField } from './tagio'
import type { TidyCtx, TidyRow, TidyStep } from './tidy'
import type { TidyRule } from '@paila/shared/tidy-profiles'
import { textos } from '@paila/shared/idioma'

// lo que se ve en "para mirar a mano" y en los avisos (lo que se escribe en los tags, como "Varios Artistas", no se traduce)
const T = textos({
  pagina: { es: 'El artista era el nombre de una página de descargas: lo que queda no se sabe si es el artista', en: 'The artist was the name of a download site: it is not clear whether what is left is the artist' },
  sello: { es: (a: string, t: string) => `El artista "${a}" parece un sello o un canal de YouTube; el título dice "${t}"`, en: (a: string, t: string) => `The artist "${a}" looks like a label or a YouTube channel; the title says "${t}"` },
  caraEra: { es: (side: string) => `"${side}" era la cara del vinilo`, en: (side: string) => `"${side}" was the side of the vinyl` },
  caraDuda: {
    es: (side: string, artista: boolean) => `"${side}" adelante ${artista ? 'del artista' : 'del título'} puede ser la cara de un vinilo, o parte del nombre`,
    en: (side: string, artista: boolean) => `"${side}" at the start of the ${artista ? 'artist' : 'title'} may be the side of a vinyl, or part of the name`,
  },
  yaHay: { es: (name: string) => `Ya hay otro archivo "${name}" en la misma carpeta (¿un duplicado?)`, en: (name: string) => `There is already another file "${name}" in the same folder (a duplicate?)` },
})

export const blank = (v: string | null | undefined) => !v || !v.trim()
export const folderOf = (rel: string) => (rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '')

// 1) caracteres rotos: "GarcÃ­a" se arregla solo; "Cada d�a" (la letra se perdió) se recupera del nombre del archivo si está ahí
export function fixBroken(c: TidyCtx) {
  const { rows, val, setField } = c
  for (const r of rows) for (const f of ['title', 'artist', 'albumArtist', 'album', 'genre'] as TagField[]) {
    const v = val(r.id, f)
    if (!v) continue
    let fx = fixMojibake(v)
    if (fx.includes('�')) fx = fromFileName(fx, r.rel) ?? fx
    if (fx !== v) setField(r, f, fx, 'mojibake', undefined, 'rotos')
  }
}

// 3) basura de YouTube y sitios en títulos, artistas y álbumes (lo que ya estaba y lo recién completado),
//    y el artista repetido dentro del título ("Alphaville - Big In Japan")
export function cleanJunk(c: TidyCtx) {
  const { rows, steps, on, changes, isSet, val, setField, doubt } = c
  for (const r of rows) for (const f of ['title', 'artist', 'album'] as TagField[]) {
    const v = val(r.id, f)
    if (!v) continue
    let cl = stripJunk(v).replace(/^[\s\-–]+|[\s\-–]+$/g, '').trim() // un "_" en la punta era un signo: no se borra
    if (f === 'artist') cl = stripChannel(cl) // "Damas Gratis Oficial", "Cristem Dj - CANAL OFICIAL"
    if (!cl || cl === v) continue
    // "WWW.ELGENERO.COM - Un Bellaqueo" en el artista: lo que queda después de la página no es un artista
    if (f === 'artist' && /^\s*[[(]?\s*(?:www\.|[\w-]+\.(?:com|net|org)\b)/i.test(v)) { doubt(r, f, cl, T.pagina); continue }
    setField(r, f, cl, 'junk', undefined, 'basura')
  }
  if (c.on.has('vinilo')) stripVinyl(c)
  // lo que se acaba de leer del nombre del archivo se lee entero bien (sin el artista repetido) en cualquier perfil;
  // en los tags que ya estaban, sacar el artista repetido es una regla del perfil ("repetidos")
  const filledTitle = new Set(changes.filter((c) => c.field === 'title' && c.step === 'filename').map((c) => c.id))
  for (const r of rows) {
    const a = val(r.id, 'artist'), t = val(r.id, 'title')
    if (!a || !t || isSet.has(r.id)) continue
    const own = filledTitle.has(r.id)
    const s = own || (on.has('repetidos') && steps.has('style')) ? stripArtistFromTitle(t, a) : { title: t, feat: null }
    if (s.title !== t) {
      const [step, rule]: [TidyStep, TidyRule | undefined] = own ? ['junk', undefined] : ['style', 'repetidos']
      setField(r, 'title', s.title, step, undefined, rule)
      const full = s.artist ?? a
      if (s.feat || s.artist) setField(r, 'artist', s.feat ? mergeFeat(normalizeFeat(full), s.feat) : full, step, undefined, rule)
      continue
    }
    // el "artista" es un sello o un canal ("MUEVA Records") y el título trae "Artista - Tema": se propone, pero que lo mire alguien
    const m = t.match(/^(.+?)\s+-\s+(.+)$/)
    if (looksLikeLabel(a) && m && !/\s-\s/.test(m[2])) {
      const why = T.sello(a, t)
      doubt(r, 'artist', tidySpaces(m[1]), why); doubt(r, 'title', tidySpaces(m[2]), why)
    }
  }
}

/**
 * Regla `vinilo` (decidido el 22/10): "VINYL ONLY" se saca del título, del artista y del álbum, y la cara del
 * vinilo de adelante del artista o del título ("A1 Bodeler" → "Bodeler", "B2 Mi Casa Su Casa" → "Mi Casa Su Casa"). El dato
 * no se pierde: queda en `c.vinyl` (tidy() lo guarda en la tabla `vinyl`). La cara se saca solo con pruebas de que es un
 * vinilo: el n.º de tema dice lo mismo, el título, el álbum o la carpeta dicen "vinyl"/"vinilo", hay otras caras distintas en
 * la misma carpeta, o (en el artista) el artista sin la cara ya está en la biblioteca. Si no, queda para mirar a mano
 * ("C4 Pedro" es un artista). Si lo único que tiene el título es la cara ("A11 VINYL ONLY"), la cara queda como título.
 */
function stripVinyl(c: TidyCtx) {
  const { rows, isSet, val, setField, doubt, vinyl } = c
  const proof = (r: TidyRow) => /\b(?:vinyl|vinilo|vinile)\b/i.test([r.title, r.album, r.artist, r.rel].join(' '))
  const mark = (r: TidyRow, side: string | null) => { const m = vinyl.get(r.id); vinyl.set(r.id, { side: side ?? m?.side ?? null, foundIn: m?.foundIn ?? r.rel }) }
  // "VINYL ONLY": siempre seguro
  for (const r of rows) {
    if (isSet.has(r.id)) continue
    let any = false
    for (const f of ['title', 'artist', 'album'] as TagField[]) {
      const v = val(r.id, f)
      if (!hasVinylOnly(v)) continue
      any = true
      const s = stripVinylOnly(v!)
      if (s) setField(r, f, s, 'junk', undefined, 'vinilo')
    }
    // la cara: el n.º de tema ("A1") o un título que quedó solo con la cara ("A11 VINYL ONLY" → "A11")
    const onlySide = val(r.id, 'title')?.trim().match(/^[A-H][1-9]\d?$/i)?.[0].toUpperCase() ?? null
    if (any || (proof(r) && isVinylTrack(r.track))) mark(r, isVinylTrack(r.track) ? r.track!.trim().toUpperCase() : onlySide)
  }
  // la cara adelante del artista o del título
  const found = rows.flatMap((r) => (['artist', 'title'] as const).flatMap((f) => {
    const a = val(r.id, f); const v = a && !isSet.has(r.id) ? vinylSide(a) : null
    return v ? [{ r, f, side: v.side, rest: v.artist }] : []
  }))
  const sides = new Map<string, Set<string>>()
  for (const x of found) { const d = folderOf(x.r.rel); sides.set(d, (sides.get(d) ?? new Set()).add(x.side)) }
  const known = found.some((x) => x.f === 'artist') ? new Set(rows.flatMap((r) => { const a = val(r.id, 'artist'); return a && !vinylSide(a) ? artistParts(a).filter((p) => !isSeparator(p)).map(fold) : [] })) : new Set<string>()
  for (const { r, f, side, rest } of found) {
    const sure = (val(r.id, 'track') ?? '').toUpperCase() === side
      || proof(r)
      || (sides.get(folderOf(r.rel))?.size ?? 0) >= 2
      || (f === 'artist' && known.has(fold(rest)))
    if (sure) { setField(r, f, rest, 'junk', T.caraEra(side), 'vinilo'); mark(r, side) }
    else doubt(r, f, rest, T.caraDuda(side, f === 'artist'))
  }
}

// 4) cómo se escriben los nombres, según las reglas del perfil elegido (shared/tidy-profiles.ts). Cada cambio anota qué
//    regla lo hizo, para mostrar en la pantalla cuánto hace cada una.
export function applyStyle(c: TidyCtx) {
  const { rows, on, isSet, val, setField } = c
  const spell = new ArtistSpelling()
  for (const r of rows) { spell.addTag(val(r.id, 'artist')); for (const seg of folderOf(r.rel).split('/')) spell.addFolder(seg) }
  for (const r of rows) {
    if (isSet.has(r.id)) continue
    let a = val(r.id, 'artist'), t = val(r.id, 'title')
    const ra = new Set<TidyRule>(), rt = new Set<TidyRule>()
    const doA = (rule: TidyRule, fn: (v: string) => string) => { if (!a || !on.has(rule)) return; const v = fn(a); if (v !== a) { a = v; ra.add(rule) } }
    const doT = (rule: TidyRule, fn: (v: string) => string) => { if (!t || !on.has(rule)) return; const v = fn(t); if (v !== t) { t = v; rt.add(rule) } }
    doA('feat', normalizeFeat)
    doA('djmc', djMc)
    // "De La Calle 2011": el año pegado al artista se va si lo que queda es un artista conocido
    doA('basura', (v) => { const y = v.match(/^(.+?)\s+(?:19|20)\d{2}$/); return y && spell.known(y[1]) ? y[1] : v })
    // el feat. del título va al artista; si el título todavía tiene "X - Y" no se sabe quién es quién y no se toca
    if (a && t && on.has('feat')) { const s = splitFeat(t); if (s.feat && !/\s-\s/.test(s.title)) { t = s.title; a = mergeFeat(a, s.feat); ra.add('feat'); rt.add('feat') } }
    // "Tak Tiki Tax (1)" con el archivo "… (1).mp3": la copia del navegador
    doT('copias', (v) => stripCopy(v, path.basename(r.rel, path.extname(r.rel))))
    doT('marcas', stripMarks)
    doA('acentos', (v) => spell.fix(v, true)) // solo acentos y signos ("Babasonicos" → "Babasónicos"), antes que las mayúsculas
    if (on.has('mayusculas')) {
      const ka = a ? caseKind(a) : 'none', kt = t ? caseKind(t) : 'none'
      const flat = (k: string) => k === 'lower' || k === 'upper'
      // solo si TODO el nombre está así (con el artista bien escrito, "Ariana Grande - positions" es a propósito).
      // Un artista de una sola palabra en mayúsculas ("FJAAK", "KAS_ST", "MARTTEIN") puede ser estilizado: se deja.
      if ((flat(ka) || flat(kt)) && (ka === kt || ka === 'none' || kt === 'none')) {
        if (flat(ka)) doA('mayusculas', (v) => artistParts(v).map((p) => (isSeparator(p) ? p : stylized(p) ?? spell.best(p) ?? (caseKind(p) === 'upper' && !/\s/.test(p.trim()) ? p : smartCase(p)))).join(''))
        if (flat(kt)) doT('mayusculas', smartCase)
      }
      doA('mayusculas', (v) => spell.fix(v)) // el mismo artista con distintas mayúsculas ("DUKI" → "Duki", "Ysy A" → "YSY A")
    }
    doA('djmc', djMc) // "Gusty Dj" puede ser la forma más usada, pero DJ va en mayúsculas igual
    if (a && a !== val(r.id, 'artist')) setField(r, 'artist', a, 'style', undefined, [...ra])
    if (t && t !== val(r.id, 'title')) setField(r, 'title', t, 'style', undefined, [...rt])
  }
}

// 5) álbum, año y artista desde carpetas que son álbumes, solo donde faltan; compilados → "Varios Artistas"
export function fillFromFolders(c: TidyCtx) {
  const { rows, val, setField } = c
  const byDir = new Map<string, TidyRow[]>()
  for (const r of rows) byDir.set(folderOf(r.rel), [...(byDir.get(folderOf(r.rel)) ?? []), r])
  for (const [dir, rs] of byDir) {
    if (!dir || rs.length < 3) continue
    const parts = dir.split('/')
    const albumDir = parts[parts.length - 1], artistDir = parts.length > 1 ? parts[parts.length - 2] : ''
    const tagged = rs.map((r) => val(r.id, 'artist')).filter((a): a is string => !!a)
    const artists = new Set(tagged.map((a) => fold(a.split(' feat. ')[0])))
    // "Rock/El Bordo": una carpeta con el nombre del artista no es un disco (y "Rock" no es el artista);
    // a los temas sin artista de esa carpeta les toca ese artista, escrito como en los demás
    if (artists.has(fold(albumDir))) {
      if (artists.size === 1 && tagged.length >= 2) {
        const spelled = tagged.find((a) => fold(a.split(' feat. ')[0]) === fold(albumDir))!.split(' feat. ')[0]
        for (const r of rs) if (blank(val(r.id, 'artist'))) setField(r, 'artist', spelled, 'folder')
      }
      continue
    }
    // "TECHNO TECH PROG/melodic": una carpeta con nombre de género agrupa por estilo, no es un disco; tampoco lo es la que tiene temas
    // de un "artista" que es un código de catálogo ("AL046"). Si los temas ya traen álbum, ese vale.
    if (!rs.some((r) => !blank(val(r.id, 'album'))) && (canonGenre(albumDir, true) || (tagged.length > 0 && tagged.every(isCatalog)))) continue
    const c = classify(rs) // con los tags de origen: una carpeta sin tags no se declara álbum
    if (c.kind !== 'album') continue
    const m = albumDir.match(/^(\d{4})\s*[-–]\s*(.+)$/)
    const albums = new Set(rs.map((r) => val(r.id, 'album')).filter(Boolean).map((a) => fold(a!)))
    // el primer motivo de classify ("Todos los temas tienen el mismo álbum"), sin comparar su texto (que se traduce)
    const sameAlbum = c.albums === 1 && rs.filter((r) => r.album).length / rs.length >= 0.7
    for (const r of rs) {
      if (blank(val(r.id, 'album')) && albums.size <= 1) setField(r, 'album', [...albums].length ? val(rs.find((x) => val(x.id, 'album'))!.id, 'album')! : (m ? m[2] : albumDir).trim(), 'folder')
      if (m && blank(val(r.id, 'year'))) setField(r, 'year', m[1], 'folder')
      // la carpeta de arriba es el artista solo si coincide con el de los temas que ya lo tienen
      if (blank(val(r.id, 'artist')) && artistDir && artists.size === 1 && artists.has(fold(artistDir))) setField(r, 'artist', artistDir.trim(), 'folder')
    }
    // un compilado: el mismo disco con temas de varios artistas va en "Varios Artistas" (así el Organizador no lo parte)
    //    ("flowanastasia and nymfo", "flowanastasia and loko"… es un disco de flowanastasia con invitados, no un compilado)
    const leads = new Set(tagged.map((a) => fold(nameList(a)[0] ?? a)))
    const vaDir = /^(?:VA|V\.A\.?|Various(?: Artists)?|Varios(?: Artistas)?)\b/i.test(albumDir) // "VA - The Year Of The Conga"
    if (sameAlbum && ((artists.size >= 3 && leads.size >= 3) || (vaDir && artists.size >= 2))) {
      for (const r of rs) if (blank(val(r.id, 'albumArtist'))) setField(r, 'albumArtist', 'Varios Artistas', 'folder')
    } else if (sameAlbum && leads.size === 1 && artists.size > 1) {
      // un disco de un artista con invitados: el artista del álbum es el principal, así el Organizador no lo parte en carpetas
      const lead = nameList(tagged[0])[0]
      const spelled = tagged.map((a) => nameList(a)[0]).find((a) => !/\s(?:and|y|&)\s/i.test(a) && fold(a) === fold(lead)) ?? lead
      for (const r of rs) if (blank(val(r.id, 'albumArtist'))) setField(r, 'albumArtist', spelled, 'folder')
    }
  }
}

// 6) extensiones que mienten: el escaneo leyó un códec que no es el de la extensión y los primeros bytes lo confirman
export function fixExtensions(c: TidyCtx, pathOf: (id: number) => string | null) {
  const { rows, changes, val } = c
  for (const r of rows) {
    if (!suspicious(r.ext, r.codec)) continue
    const abs = pathOf(r.id)
    let real: string | null = null
    try { real = abs ? sniff(abs) : null } catch { continue }
    const fix = real && extensionFix(r.rel, real, val(r.id, 'title'))
    if (!fix) continue
    const file = r.rel.slice(r.rel.lastIndexOf('/') + 1), oldExt = path.extname(file)
    if (fix.base) changes.push({ id: r.id, rel: r.rel, field: 'filename', from: file.slice(0, file.length - oldExt.length), to: fix.base, step: 'extension' })
    changes.push({ id: r.id, rel: r.rel, field: 'extension', from: oldExt.slice(1), to: fix.ext, step: 'extension' })
  }
}

// 7) "_" que no se sabe qué era ("AC_DC", "Who Are You_", "_One Piece_"…): no se cambia solo; queda para mirar a mano
//    (o para comparar con el nombre oficial en internet, Fase C). El "_" + espacio, que era ":", ya se arregló arriba.
export function markUnderscores(c: TidyCtx) {
  const { rows, val, doubt } = c
  for (const r of rows) for (const f of ['title', 'artist'] as TagField[]) {
    const v = val(r.id, f)
    const u = v ? underscoreDoubt(v, f) : null
    if (u && u.to !== v) doubt(r, f, u.to, u.kind)
  }
}

// 8) nombres de archivo con basura ("[www.slider.kz]", "(Official Video)"): la misma limpieza que los tags, en el nombre.
//    Nunca la extensión (ni el ".mp3" que es parte del título, como en "Jagger.mp3 (Official Video).mp3"), nunca sample
//    packs (no están en la Música) y nunca un nombre que ya existe en la carpeta.
export function cleanFilenames(c: TidyCtx): number {
  const { db, rows, changes, review } = c
  let inRekordbox = 0
  const exported = rbExported(db)
  const taken = new Map<string, Set<string>>() // carpeta → nombres (en minúscula) que hay o va a haber
  // a propósito con los desaparecidos y excluidos: su archivo puede seguir ahí, y renombrar encima lo pisaría
  for (const f of db.prepare('SELECT rel_path AS rel FROM files WHERE trashed_at IS NULL').all() as { rel: string }[]) {
    const d = folderOf(f.rel)
    taken.set(d, (taken.get(d) ?? new Set()).add(f.rel.slice(f.rel.lastIndexOf('/') + 1).toLowerCase()))
  }
  const renamed = new Set(changes.filter((c) => c.field === 'filename').map((c) => c.id))
  const newExt = new Map(changes.filter((c) => c.field === 'extension').map((c) => [c.id, `.${c.to}`]))
  for (const r of rows) {
    if (renamed.has(r.id)) continue // la corrección de extensión ya arma el nombre nuevo (el disco ".mp3" de Emilia)
    const file = r.rel.slice(r.rel.lastIndexOf('/') + 1), base = file.slice(0, file.length - path.extname(file).length)
    const ext = newExt.get(r.id) ?? path.extname(file) // si también cambia la extensión, el choque se mira con la nueva
    let clean = stripJunk(stripSitePrefix(base), true).replace(/\s+-\s+-\s+/g, ' - ').replace(/^[\s\-–]+|[\s\-–]+$/g, '')
    const learned = learnedStrip(clean, c.learned) // las palabras aprendidas (con el motivo)
    clean = learned.text
    const flat = (s: string) => s.replace(/\s+/g, ' ').replace(/^[\s\-–]+|[\s\-–]+$/g, '')
    if (!clean || flat(clean) === flat(base)) continue // si solo cambiarían espacios, no vale la pena renombrar
    const name = safeName(clean)
    if (!name || name === base) continue
    const names = taken.get(folderOf(r.rel))!
    if (names.has((name + ext).toLowerCase())) {
      review.push({ id: r.id, rel: r.rel, field: 'filename', from: base, to: name, why: T.yaHay(name + ext), staged: false, blocked: true })
      continue
    }
    names.delete(file.toLowerCase()); names.add((name + ext).toLowerCase())
    changes.push({ id: r.id, rel: r.rel, field: 'filename', from: base, to: name, step: 'filenames', ...(learned.note ? { note: learned.note, rules: ['aprendidas' as const] } : {}) })
    if (exported.has(r.id)) inRekordbox++
  }
  return inRekordbox
}

/** Los temas que ya se exportaron a Rekordbox (renombrarlos obliga a relocalizarlos allá). */
function rbExported(db: Db): Set<number> {
  try { return new Set((db.prepare('SELECT file_id AS id FROM rb_exports').all() as { id: number }[]).map((r) => r.id)) } catch { return new Set() }
}

/** Recupera letras perdidas ("Cada d\uFFFDa") con el nombre del archivo, si ahí está escrito bien ("Track03 - Cada día.mp3"). */
function fromFileName(v: string, rel: string): string | null {
  const base = cleanBase(path.basename(rel, path.extname(rel)))
  const re = new RegExp(v.split('\uFFFD').map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join(String.raw`[^\s]{1,2}`), 'iu')
  const m = base.match(re)
  return m && !m[0].includes('\uFFFD') ? m[0] : null
}
