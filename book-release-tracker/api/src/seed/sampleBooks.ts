import type { DatePrecision } from "../lib/releaseDate.js";

/**
 * Sample catalog for demos and grading. Every title and author is INVENTED
 * (hard gate: synthetic data only). Dates are given relative to "today" so the
 * catalog always has upcoming releases, whenever it's seeded.
 *
 * 24 hand-written books + 136 generated from word lists = 160. The generator
 * uses a FIXED random seed, so it produces exactly the same books every run;
 * that's what keeps `npm run seed` safe to repeat.
 *
 *   offsetDays: days from today (negative = already released)
 *   precision:  "day"   -> exact date
 *               "month" -> "sometime in that month"
 *               "year"  -> "sometime next year" (offset picks the year)
 */
export interface SampleBook {
  key: string; // stable id; stored as google_volume_id "seed-<key>"
  title: string;
  authors: string[];
  categories: string[];
  offsetDays: number;
  precision: DatePrecision;
}

const HAND_WRITTEN: SampleBook[] = [
  // ---- already out (visible with "Include past releases")
  { key: "salt-archivist", title: "The Salt Archivist", authors: ["Mirela Dragan"], categories: ["Fiction"], offsetDays: -120, precision: "day" },
  { key: "small-rooms", title: "Small Rooms, Large Windows", authors: ["Theo Brandt"], categories: ["Essays"], offsetDays: -45, precision: "day" },
  { key: "copper-season", title: "Copper Season", authors: ["Ines Varga"], categories: ["Poetry"], offsetDays: -10, precision: "day" },

  // ---- the next few weeks
  { key: "lantern-keeper", title: "The Lantern Keeper", authors: ["Mira Solano"], categories: ["Fantasy"], offsetDays: 6, precision: "day" },
  { key: "glass-orchard", title: "The Glass Orchard", authors: ["Mirela Dragan"], categories: ["Fiction"], offsetDays: 12, precision: "day" },
  { key: "quiet-signal", title: "A Quiet Signal", authors: ["Jonah Abernathy"], categories: ["Science Fiction"], offsetDays: 19, precision: "day" },
  { key: "winter-cartography", title: "Winter Cartography", authors: ["Ines Varga"], categories: ["Poetry"], offsetDays: 25, precision: "day" },
  { key: "ledger-of-ash", title: "The Ledger of Ash", authors: ["Priya Raman"], categories: ["Mystery"], offsetDays: 31, precision: "day" },

  // ---- next couple of months
  { key: "field-guide-quiet", title: "A Field Guide to Quiet", authors: ["Theo Brandt", "Lena Okafor"], categories: ["Nonfiction"], offsetDays: 40, precision: "day" },
  { key: "harbor-lights", title: "Harbor Lights at Midnight", authors: ["Celia Marchetti"], categories: ["Romance"], offsetDays: 48, precision: "day" },
  { key: "iron-bloom", title: "Iron Bloom", authors: ["Mira Solano"], categories: ["Fantasy", "Young Adult"], offsetDays: 55, precision: "month" },
  { key: "last-ferry-north", title: "The Last Ferry North", authors: ["Priya Raman"], categories: ["Thriller"], offsetDays: 63, precision: "day" },
  { key: "borrowed-stars", title: "Borrowed Stars", authors: ["Jonah Abernathy"], categories: ["Science Fiction"], offsetDays: 70, precision: "day" },
  { key: "letters-from-sibiu", title: "Letters from Sibiu", authors: ["Ana Constantin"], categories: ["History"], offsetDays: 78, precision: "day" },

  // ---- further out
  { key: "orchard-keeper-daughter", title: "The Orchard Keeper's Daughter", authors: ["Celia Marchetti"], categories: ["Romance", "Historical Fiction"], offsetDays: 95, precision: "month" },
  { key: "tidewater", title: "Tidewater", authors: ["Lena Okafor"], categories: ["Fiction"], offsetDays: 110, precision: "day" },
  { key: "clockwork-choir", title: "The Clockwork Choir", authors: ["Mira Solano"], categories: ["Fantasy"], offsetDays: 128, precision: "day" },
  { key: "atlas-small-hours", title: "An Atlas of Small Hours", authors: ["Ines Varga", "Theo Brandt"], categories: ["Essays"], offsetDays: 140, precision: "month" },
  { key: "second-silence", title: "The Second Silence", authors: ["Priya Raman"], categories: ["Mystery"], offsetDays: 160, precision: "day" },
  { key: "paper-moons", title: "Paper Moons", authors: ["Daniel Fairweather"], categories: ["Young Adult"], offsetDays: 175, precision: "day" },
  { key: "garden-of-wires", title: "A Garden of Wires", authors: ["Jonah Abernathy"], categories: ["Science Fiction"], offsetDays: 200, precision: "month" },

  // ---- only the year is known
  { key: "notes-long-year", title: "Notes from the Long Year", authors: ["Theo Brandt"], categories: ["Essays"], offsetDays: 400, precision: "year" },
  { key: "untitled-solano", title: "The Ninth Lantern", authors: ["Mira Solano"], categories: ["Fantasy"], offsetDays: 420, precision: "year" },
  { key: "bridges-in-fog", title: "Bridges in Fog", authors: ["Ana Constantin"], categories: ["Biography"], offsetDays: 450, precision: "year" },
];

const pad = (n: number) => String(n).padStart(2, "0");

/** today (YYYY-MM-DD, UTC) + offset, rounded down to the precision. */
export function sampleDate(today: string, offsetDays: number, precision: DatePrecision): string {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  switch (precision) {
    case "day":
      return `${y}-${pad(m)}-${pad(d.getUTCDate())}`;
    case "month":
      return `${y}-${pad(m)}-01`;
    case "year":
      return `${y}-01-01`;
  }
}

// ---------------------------------------------------------------- generated

/** Small deterministic PRNG (mulberry32): same seed -> same sequence, every run. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ADJECTIVES = [
  "Copper", "Silent", "Hollow", "Distant", "Burning", "Paper", "Velvet", "Northern", "Forgotten", "Golden",
  "Crooked", "Winter", "Glass", "Wandering", "Quiet", "Salted", "Midnight", "Borrowed", "Restless", "Amber",
  "Lantern-lit", "Uncharted", "Painted", "Sunken", "Cinder", "Hidden", "Last", "Gentle", "Iron", "Silver",
];
const NOUNS = [
  "Lighthouse", "Orchard", "Archive", "Harbor", "Cartographer", "Garden", "Bridge", "Clockmaker", "Atlas", "River",
  "Lantern", "Kingdom", "Station", "Choir", "Library", "Meadow", "Observatory", "Ferry", "Workshop", "Island",
  "Compass", "Tide", "Ledger", "Orchestra", "Beekeeper", "Mapmaker", "Courtyard", "Bell", "Heron", "Monastery",
  "Vineyard", "Apothecary", "Telegraph", "Glasshouse", "Shepherd", "Weaver", "Ember", "Signal", "Comet", "Hourglass",
];
const PLACES = [
  "the Northern Coast", "the Lower Valley", "Ash Street", "the Far Shore", "the Old Quarter", "the High Moors",
  "the Salt Flats", "the Hill Country", "the Delta", "the Winter Road", "the Eastern Gate", "the River Towns",
];
const PLURALS = ["Letters", "Songs", "Maps", "Notes", "Stories", "Lessons", "Echoes", "Rumors", "Recipes", "Postcards"];

const FIRST = [
  "Adela", "Bram", "Corina", "Dorian", "Elif", "Felix", "Greta", "Hugo", "Ilona", "Jasper", "Kaia", "Luca", "Maren",
  "Niko", "Odile", "Pavel", "Quinn", "Rosalind", "Silas", "Tamsin", "Ulla", "Viktor", "Wren", "Ximena", "Yusuf", "Zora",
  "Anouk", "Bastian", "Clara", "Desmond", "Esme", "Florin", "Hana", "Ivo", "Juniper", "Leontine",
];
const LAST = [
  "Ashdown", "Belcourt", "Corvan", "Drăgulescu", "Elsworth", "Fennimore", "Galloway", "Halvorsen", "Ivanescu", "Jarrell",
  "Kestrel", "Lindqvist", "Morrow", "Novák", "Okonkwo-Hale", "Pellegrin", "Quillon", "Rasmussen", "Stavros", "Thornbury",
  "Underhill", "Valcourt", "Whitlock", "Yardley", "Zamfir", "Arkwright", "Brennick", "Castellane", "Delacroix-Moss", "Everly",
];

const CATEGORIES = [
  ["Fiction"], ["Fantasy"], ["Mystery"], ["Romance"], ["Science Fiction"], ["Thriller"], ["Historical Fiction"],
  ["Young Adult"], ["Poetry"], ["Essays"], ["History"], ["Biography"], ["Nonfiction"], ["Horror"], ["Fantasy", "Young Adult"],
  ["Romance", "Historical Fiction"], ["Mystery", "Thriller"], ["Science Fiction", "Young Adult"], ["Memoir"], ["Travel"],
] as const;

const pick = <T,>(rand: () => number, list: readonly T[]): T => list[Math.floor(rand() * list.length)] as T;

function makeTitle(rand: () => number): string {
  switch (Math.floor(rand() * 7)) {
    case 0: return `The ${pick(rand, ADJECTIVES)} ${pick(rand, NOUNS)}`;
    case 1: return `${pick(rand, PLURALS)} from ${pick(rand, PLACES)}`;
    case 2: return `The ${pick(rand, NOUNS)}'s ${pick(rand, NOUNS)}`;
    case 3: return `A ${pick(rand, NOUNS)} for ${pick(rand, PLACES)}`;
    case 4: return `${pick(rand, ADJECTIVES)} ${pick(rand, PLURALS)}`;
    case 5: return `The ${pick(rand, NOUNS)} of ${pick(rand, PLACES)}`;
    default: return `When the ${pick(rand, NOUNS)} Was ${pick(rand, ADJECTIVES)}`;
  }
}

export const GENERATED_COUNT = 136;

function generateBooks(count: number, taken: Set<string>): SampleBook[] {
  const rand = prng(20261117);
  // ~45 recurring authors, so many of them have several books (good for watchlists).
  const authors: string[] = [];
  while (authors.length < 45) {
    const name = `${pick(rand, FIRST)} ${pick(rand, LAST)}`;
    if (!authors.includes(name)) authors.push(name);
  }
  const books: SampleBook[] = [];
  let n = 0;
  while (books.length < count) {
    n += 1;
    const title = makeTitle(rand);
    if (taken.has(title)) continue; // titles are unique across the whole sample set
    taken.add(title);

    const main = pick(rand, authors);
    const coAuthor = rand() < 0.12 ? pick(rand, authors) : null;
    const r = rand();
    // ~15% already out, ~60% within a year, ~25% further out
    const offsetDays =
      r < 0.15 ? -1 - Math.floor(rand() * 200) : r < 0.75 ? Math.floor(rand() * 365) : 366 + Math.floor(rand() * 335);
    const p = rand();
    const precision: DatePrecision = p < 0.7 ? "day" : p < 0.9 ? "month" : "year";

    books.push({
      key: `gen-${String(n).padStart(3, "0")}`,
      title,
      authors: coAuthor && coAuthor !== main ? [main, coAuthor] : [main],
      categories: [...pick(rand, CATEGORIES)],
      offsetDays,
      precision,
    });
  }
  return books;
}

export const SAMPLE_BOOKS: SampleBook[] = [
  ...HAND_WRITTEN,
  ...generateBooks(GENERATED_COUNT, new Set(HAND_WRITTEN.map((b) => b.title))),
];
