/**
 * What art to generate, and the prompt for each piece.
 *
 * This file is the art direction; `generate-art.mjs` is plumbing. The plan it
 * implements, and the reasoning behind every rule below, is ART-PLAN.md.
 *
 * Rules inherited from ../tower-defense, where each was learned the hard way:
 *
 *  1. **One shared style paragraph** and one subject per piece. Change the look
 *     by changing DRAW_STYLE and regenerating everything, never per piece.
 *  2. **A character's poses are ONE image.** Two calls are two characters.
 *  3. **Say the grid as a count**, loudly. The model draws the grid it likes.
 *  4. **Pose sheets face RIGHT**, because that is what the model draws anyway;
 *     the loader mirrors whatever needs to face left.
 *
 * And the new ones, because everything in this game spins (ART-PLAN.md N1-N5):
 * subjects that are physics circles must be ROUND; anything that rotates is lit
 * flat; nothing keyed may contain green; explosions are painted on black.
 */

// --- Shared prompt parts -----------------------------------------------------

/** The chroma-key demand. First and loudest, as in tower-defense. */
const KEY_BACKGROUND = [
  'THE BACKGROUND MUST BE FLAT SOLID CHROMA-KEY GREEN, hex #00FF00, pure saturated green,',
  'covering every pixel that is not the subject. No white, no gradient, no vignette,',
  'no shadow cast onto the background, no floor, no scenery, no border.',
].join(' ');

/** For explosions, which are drawn additively, so black adds nothing. */
const BLACK_BACKGROUND = [
  'THE BACKGROUND MUST BE PURE SOLID BLACK, hex #000000, every single pixel that is not fire',
  'or glowing light. No smoke against the black, no haze, no ground, no scenery, no border.',
].join(' ');

const DRAW_STYLE = [
  "children's picture book illustration, soft rounded shapes,",
  'thick clean dark outlines, flat bright colours with simple soft shading, cheerful and sunny,',
  'palette of sky blue, warm honey wood, soft grey, sunny yellow and berry pink,',
  'no text, no letters, no watermark',
].join(' ');

/**
 * For anything that physically rotates in the game. A sunlit top edge and a
 * shadow underneath look wrong the moment the thing lands upside down.
 */
const FLAT_LIGHT = [
  'Lit evenly from the front with NO directional light: no bright highlight on one side and',
  'no dark shading on the other, no cast shadow. It must look equally correct turned upside down.',
].join(' ');

/**
 * The game is set outdoors, and a model drawing "a raccoon in a meadow" adds
 * grass tufts that the green-screen flood fill then half-eats.
 */
const NO_GREEN = 'The subject contains NO green anywhere: no grass, no leaves, no green clothing or trim.';

const CUT_OUT = 'clean crisp edges suitable for cutting out against pure green #00FF00.';

/** Grid rules shared by every keyed sheet. Condensed from tower-defense's SHEET_COMMON. */
function gridRules(cols, rows) {
  const cells = cols * rows;
  return [
    `A SPRITE SHEET laid out as a grid of ${cols} columns by ${rows} rows.`,
    `THE GRID IS EXACTLY ${cols} CELLS ACROSS AND ${rows} CELLS DOWN: ${cells} figures in total, no more and no fewer.`,
    `Do NOT add another row. Do NOT repeat a row. Do NOT draw more than ${cells} figures.`,
    'Read each row left to right, top row first.',
    'The character is IDENTICAL in every single cell: same face, same fur or hair, same size, same',
    'build, same clothes, same colours. It must be impossible to tell that any two cells were drawn',
    'separately, because they were not. ONLY THE POSE AND EXPRESSION CHANGE from cell to cell.',
    'Centre each figure in its own cell, at the same size, with its bottom at the same height in every',
    'cell of a row. EVERY figure must fit ENTIRELY INSIDE its own cell with a clear band of plain',
    'background on all four sides; nothing may touch or cross the boundary between cells, and',
    'nothing may run off the edge of the picture.',
    'Draw NO lines, borders, boxes, numbers or dividers between the cells: one single continuous',
    'flat #00FF00 background behind and between all the figures.',
    'NEVER mirror or turn the character around between cells.',
    'Colours are FIXED: use exactly the colours described, identical in every cell, for every part.',
    'Draw NOTHING except the character: no ground line, no shadow, no motion lines, no clouds,',
    'no smoke, no stray marks of any kind.',
  ].join(' ');
}

/** Cells described as a numbered list, one sentence each. */
function cellList(cells) {
  return cells.map((text, i) => `Cell ${i + 1}: ${text}`).join(' ');
}

// --- The pieces ---------------------------------------------------------------

/**
 * Ellie, word for word as she is described in ../tower-defense, so she is the
 * same girl in both games. Standing here rather than sitting, and in sneakers,
 * because she is outdoors.
 */
const ELLIE =
  'a little girl about five years old, long wavy dark brown hair past her shoulders, ' +
  'warm honey-tan skin, big brown eyes, a bright coral-pink sleeveless sundress with white trim ' +
  'at the neck and hem, and white sneakers with pink laces. She is standing, seen from the side ' +
  'and slightly from the front, facing RIGHT.';

const RACCOON =
  'a small plump raccoon bandit whose body is ROUND like a ball, a near-perfect circle, ' +
  'sitting upright: soft grey fur, a black bandit mask across his eyes, a cream belly, small ' +
  'rounded ears, a thick ringed grey-and-charcoal tail curling up behind him, and tiny grey paws. ' +
  'A cheeky little troublemaker, naughty but never mean or scary. ' +
  'Silhouette: a circle with two small ears on top and a curled tail.';

export const PIECES = [
  // --- Characters --------------------------------------------------------------
  {
    // Twelve frames in ONE image: teasing, moods, and running away. See ART-PLAN.md
    // for why this is the one 4x3 sheet in the game rather than two 4x2s.
    //
    // Rows 1-2 are mirrored at load so the raccoons in the forts face Ellie.
    // Row 3 is not: a bonked raccoon runs off to the RIGHT, away from her.
    id: 'bandit.motion',
    aspect: '4:3',
    size: '2K',
    sheet: { cols: 4, rows: 3, align: 'floor', mirrorRows: [0, 1], rowIds: ['tease', 'mood', 'run'] },
    subject: RACCOON,
    cells: [
      'RASPBERRY: sitting, sticking his tongue right out, eyes squeezed shut, cheeks puffed out.',
      'NYAH-NYAH: sitting, both thumbs in his ears with his fingers waggling, tongue out, eyes rolled up.',
      'TOOT: still sitting, leaning over onto one side so one hip lifts, eyes half closed with a very ' +
        'pleased cheeky grin, one paw raised as if saying "oops!". Just the raccoon: NO cloud, NO smoke.',
      'BURP: still sitting, belly pushed out round, mouth stretched wide open in a huge burp, eyes ' +
        'squeezed shut, one paw patting his tummy.',
      'SMUG: sitting, paws folded over his belly, a sly half-smile, eyes narrowed.',
      'LAUGHING: sitting, one paw pointing forward, the other paw on his belly, mouth wide open ' +
        'laughing, eyes squeezed into happy crescents.',
      'SCARED: sitting, eyes huge and round, both paws thrown up, fur standing on end, mouth a small "o".',
      'DIZZY: sitting, eyes drawn as spirals, tongue lolling out of the side of his mouth, a white ' +
        'bandage stuck crossways on top of his head.',
      'RUNNING AWAY on all fours, front paws reaching far forward.',
      'RUNNING on all fours, all four paws gathered underneath him.',
      'RUNNING on all fours, back paws pushing off behind.',
      'RUNNING on all fours, stretched out flat in mid-air.',
    ],
    extra:
      'The top two rows are SITTING and look straight out at the viewer. The bottom row is the same ' +
      'raccoon RUNNING to the RIGHT, seen from the side. In every cell his body is round and he is ' +
      'the same size. ' +
      FLAT_LIGHT +
      ' ' +
      NO_GREEN,
  },
  {
    // Eight reactions, chosen by game state rather than played as a cycle. She
    // never holds the pouch (ART-PLAN.md R5), so no frame depends on where it is.
    id: 'ellie.motion',
    aspect: '16:9',
    size: '2K',
    sheet: { cols: 4, rows: 2, align: 'floor', rowIds: ['poses', 'poses'] },
    subject: ELLIE,
    cells: [
      'READY: standing with her hands on her hips, a determined little smile.',
      'TEASING BACK: tongue stuck out playfully, one hand pulling down her lower eyelid, a cheeky ' +
        '"so there!" face.',
      'AIMING: squinting one eye, one arm pointing straight out to the RIGHT.',
      'GO!: one fist punched forward to the right, mouth open shouting.',
      'CHEERING: jumping with BOTH arms straight up in the air, a huge grin, eyes squeezed shut.',
      'EW, GIGGLING: pinching her nose with one hand and waving the other hand in front of her face, ' +
        'eyes squeezed shut, giggling.',
      'AMAZED: both hands on her cheeks, mouth a wide round "O", eyes sparkling.',
      'OH WELL: shoulders shrugged up, palms turned up, a small pout.',
    ],
    extra:
      'Each mood is shown by her WHOLE BODY, not only her face, because she is drawn small in the ' +
      'game. All eight face RIGHT. ' +
      NO_GREEN,
  },

  // --- Toys: round, filling a circle, lit flat. -----------------------------------
  {
    id: 'toy.ball',
    subject:
      'a shiny rubber bouncy ball, berry-pink with a sunny-yellow band and a sky-blue band crossing ' +
      'it. Perfectly round.',
  },
  {
    id: 'toy.ducks',
    subject:
      'ONE yellow rubber duck seen from the side, facing RIGHT, orange beak, a round chubby body ' +
      'plump enough that its outline is nearly a circle.',
  },
  {
    id: 'toy.rocket',
    subject:
      'a chunky toy rocket lying HORIZONTAL with its nose pointing RIGHT: red nose cone and red fins, ' +
      'a white body, a round blue window. Short and fat, so it almost fits inside a circle. No flame.',
  },
  {
    id: 'toy.bear',
    subject:
      'a round curled-up brown teddy bear hugging its knees so the whole bear is a ball, round ears, ' +
      'a cream muzzle, a stitched smile.',
  },
  {
    id: 'toy.firecracker',
    subject:
      'a round cartoon cherry-bomb firecracker toy, deep purple with little gold stars, a short ' +
      'twisted fuse on top. Cute, not realistic. No spark, no flame.',
  },

  // --- TNT --------------------------------------------------------------------
  {
    // The one piece with letters in it. If "TNT" comes back misspelled, drop the
    // letters from this prompt and the game paints them on top instead.
    id: 'tnt.motion',
    aspect: '1:1',
    size: '1K',
    sheet: { cols: 2, rows: 2, align: 'center', rowIds: ['damage', 'damage'] },
    subject:
      'a square wooden TNT crate seen straight on: dark red painted boards, darker wooden battens ' +
      'on the corners, big chunky yellow letters "TNT" across the front, a short black fuse on top.',
    cells: [
      'brand new.',
      'a few cracks and a dent.',
      'badly cracked, one board split, the letters scuffed.',
      'about to explode: the same cracks with bright orange light glowing out of every crack.',
    ],
    extra: FLAT_LIGHT + ' ' + NO_GREEN,
  },

  // --- The boom -------------------------------------------------------------------
  {
    // Painted on black and drawn with additive blending, so it glows over the
    // scene and needs no cut-out (ART-PLAN.md N5). Read as an 8-frame flipbook.
    id: 'boom.motion',
    aspect: '16:9',
    size: '2K',
    background: 'black',
    sheet: { cols: 4, rows: 2, align: 'center', rowIds: ['fx', 'fx'] },
    subject: 'ONE cartoon explosion, shown as an animation in eight stages.',
    cells: [
      'a small white-hot flash star.',
      'a bright yellow-white ball bursting outward with spiky edges.',
      'a big round fireball, yellow core, orange rim.',
      'the fireball at its biggest: orange with red edges and puffy billows.',
      'breaking up into separate orange puffs.',
      'deep red puffs spreading apart.',
      'dim dark-red embers, mostly faded.',
      'a few last tiny glowing sparks.',
    ],
  },
];

// --- Prompt assembly --------------------------------------------------------------

/**
 * Composed from named parts, never by editing a finished string: tower-defense
 * lost a whole background to a `.replace()` that silently stopped matching.
 */
export function promptFor(piece) {
  if (piece.background === 'black') {
    const { cols, rows } = piece.sheet;
    return [
      BLACK_BACKGROUND,
      `A grid of ${cols} columns by ${rows} rows: EXACTLY ${cols * rows} drawings, no more and no fewer,`,
      'each centred in its own cell with black space all around it, read left to right, top row first.',
      'No lines, borders or numbers between the cells.',
      `Subject: ${piece.subject}`,
      cellList(piece.cells),
      'Bold cartoon shapes like a picture book, not realistic. No text, no letters, no watermark.',
      BLACK_BACKGROUND,
    ].join(' ');
  }
  if (piece.sheet) {
    const { cols, rows } = piece.sheet;
    return [
      KEY_BACKGROUND,
      gridRules(cols, rows),
      `The character: ${piece.subject}`,
      cellList(piece.cells),
      piece.extra ?? '',
      `${DRAW_STYLE}, ${CUT_OUT}`,
    ].join(' ');
  }
  // A single still. Every still in this game is a toy that spins.
  return [
    KEY_BACKGROUND,
    `Subject: ${piece.subject}`,
    'A single centred subject filling most of the frame.',
    FLAT_LIGHT,
    NO_GREEN,
    `${DRAW_STYLE}, ${CUT_OUT}`,
  ].join(' ');
}
