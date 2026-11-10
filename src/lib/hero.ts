/**
 * The home page's hero photo. Shared by the page and the build (which preloads it in <head>).
 * Below 640px the card is square and shows the middle of the photo, so phones get exactly that
 * square (683×683, cut from the same 1024×683 picture at the card's 60% position): the same
 * pixels on screen for less than half the download.
 */
const H = "/home/";
export const HERO = {
  name: "hero-stamp",
  widths: [640, 1024],
  sizes: "(min-width: 1400px) 1336px, (min-width: 1024px) calc(100vw - 64px), 100vw",
  mobile: { src: `${H}hero-stamp-m-683.webp`, size: 683, media: "(max-width: 639.98px)" },
  desktopMedia: "(min-width: 640px)",
} as const;

export const heroSrcSet = HERO.widths.map((w) => `${H}${HERO.name}-${w}.webp ${w}w`).join(", ");

/** <link rel="preload"> tags for the hero: one per layout, so each screen fetches only its own file. */
export const heroPreloads = (): string[] => [
  `<link rel="preload" as="image" href="${HERO.mobile.src}" media="${HERO.mobile.media}" fetchpriority="high" />`,
  `<link rel="preload" as="image" imagesrcset="${heroSrcSet}" imagesizes="${HERO.sizes}" media="${HERO.desktopMedia}" fetchpriority="high" />`,
];
