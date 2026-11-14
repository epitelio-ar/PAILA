// El único juego de íconos de la familia PAILA + NAPIA: líneas de 1,7 px en una grilla de 24×24, sin dependencias. Heredan el color del texto.
const PATHS = {
  home: 'M3 11l9-8 9 8M5 10v10h14V10M10 20v-6h4v6',
  activity: 'M3 12h4l3-8 4 16 3-8h4',
  note: 'M9 18V5l12-2v13M6 21a3 3 0 100-6 3 3 0 000 6zM18 19a3 3 0 100-6 3 3 0 000 6z',
  folder: 'M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z',
  list: 'M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01',
  sparkle: 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16z',
  wand: 'M5 19L15 9M13 5l1-2 1 2 2 1-2 1-1 2-1-2-2-1 2-1zM17 12l.7-1.4L19 10l-1.3-.6L17 8l-.7 1.4L15 10l1.3.6L17 12z',
  globe: 'M12 3a9 9 0 100 18 9 9 0 000-18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18',
  tree: 'M4 4h6v5H4zM14 4h6v5h-6zM14 15h6v5h-6zM7 9v8h7M7 6.5h7',
  copy: 'M9 9h11v11H9zM5 15V5a1 1 0 011-1h9',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  pie: 'M12 3v9h9M21 12a9 9 0 11-9-9',
  inbox: 'M3 13l3-8h12l3 8v6H3zM3 13h5l1 3h6l1-3h5',
  heart: 'M12 20s-8-5-8-11a4.5 4.5 0 018-2.7A4.5 4.5 0 0120 9c0 6-8 11-8 11z',
  disc: 'M12 3a9 9 0 100 18 9 9 0 000-18zM12 9a3 3 0 100 6 3 3 0 000-6z',
  plus: 'M12 5v14M5 12h14',
  chevron: 'M9 6l6 6-6 6',
  search: 'M11 4a7 7 0 100 14 7 7 0 000-14zM21 21l-4.3-4.3',
  import: 'M12 3v12M7 10l5 5 5-5M4 20h16',
  layers: 'M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5M3 17l9 5 9-5',
  headphones: 'M4 15v-3a8 8 0 0116 0v3M4 15h3v5H5a1 1 0 01-1-1v-4zM20 15h-3v5h2a1 1 0 001-1v-4z',
  history: 'M3 12a9 9 0 103-6.7L3 8M3 3v5h5M12 7v5l3 2',
  chart: 'M4 20V11M10 20V4M16 20v-6M22 20H2',
  play: 'M7 4l13 8-13 8V4z',
  pause: 'M7 4v16M17 4v16',
  prev: 'M19 5v14L8 12l11-7zM5 5v14',
  next: 'M5 5v14l11-7L5 5zM19 5v14',
  shuffle: 'M3 7h4l10 10h4M3 17h4l3-3M14 10l3-3h4M18 4l3 3-3 3M18 14l3 3-3 3',
  repeat: 'M4 11V9a3 3 0 013-3h12M16 3l3 3-3 3M20 13v2a3 3 0 01-3 3H5M8 21l-3-3 3-3',
  queue: 'M3 6h13M3 12h13M3 18h8M17 14v6l5-3-5-3z',
  speaker: 'M4 9v6h4l5 4V5L8 9H4zM17 9a4 4 0 010 6M19.5 6.5a8 8 0 010 11',
  // un engranaje con dientes (el de antes, un círculo con rayos, parecía el brillo o el modo claro: el autor, 01/11)
  gear: 'M18.45 10.59L21.08 10.49L21.08 13.51L18.45 13.41L17.56 15.56L19.49 17.35L17.35 19.49L15.56 17.56L13.41 18.45L13.51 21.08L10.49 21.08L10.59 18.45L8.44 17.56L6.65 19.49L4.51 17.35L6.44 15.56L5.55 13.41L2.92 13.51L2.92 10.49L5.55 10.59L6.44 8.44L4.51 6.65L6.65 4.51L8.44 6.44L10.59 5.55L10.49 2.92L13.51 2.92L13.41 5.55L15.56 6.44L17.35 4.51L19.49 6.65L17.56 8.44ZM12 9.2a2.8 2.8 0 100 5.6 2.8 2.8 0 000-5.6z',
  // los discos del pie de la barra lateral: el de la compu, uno externo (USB) y expulsar
  hdd: 'M3 13l2.6-7.2A1.5 1.5 0 017 5h10a1.5 1.5 0 011.4.8L21 13v5a1 1 0 01-1 1H4a1 1 0 01-1-1v-5zM3 13h18M7 16h.01M11 16h6',
  usb: 'M9 3h6v5H9zM7 8h10v6a5 5 0 01-10 0V8zM12 19v3M10.5 5h.01M13.5 5h.01',
  eject: 'M12 5l7 8H5l7-8zM5 18h14',
  alert: 'M12 3l10 18H2L12 3zM12 10v5M12 18h.01',
  check: 'M5 12.5l4.5 4.5L19 7',
  close: 'M6 6l12 12M18 6L6 18',
  bolt: 'M13 2L4 14h7l-1 8 9-12h-7l1-8z',
  up: 'M6 15l6-6 6 6',
  down: 'M6 9l6 6 6-6',
  comoda: 'M4 5h16M4 12h16M4 19h16',
  compacta: 'M4 4h16M4 8h16M4 12h16M4 16h16M4 20h16',
  dot: 'M12 8a4 4 0 100 8 4 4 0 000-8z',
  ring: 'M12 5a7 7 0 100 14 7 7 0 000-14z',
  info: 'M12 3a9 9 0 100 18 9 9 0 000-18zM12 11v6M12 7.5h.01',
  send: 'M4 12l16-8-6 16-3-7-7-1zM11 13l9-9',
  expand: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  scissors: 'M9 6a3 3 0 11-6 0 3 3 0 016 0zM9 18a3 3 0 11-6 0 3 3 0 016 0zM20 4L8.1 15.9M14.5 14.5L20 20M8.1 8.1L12 12',
} as const

export type IconName = keyof typeof PATHS

export function Icon({ name, size = 16, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  )
}
