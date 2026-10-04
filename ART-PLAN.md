# Art plan: sprite sheets and animation

Generated art for *Ellie's Slingshot*, using the same Gemini pipeline that brought
`../tower-defense` to life.

> **Status: Phase 1 is done**: the raccoons, Ellie, the five toys, the TNT crate and the explosion
> flipbook are generated and in the game (DECISIONS.md 13). Phase 1 turned out to be nine images,
> not twelve. Phases 2 and 3 (materials, slingshot, backdrop, ground, title) and the Whoopee
> Cushion are still plans.

It has two halves:

1. **The requests.** Every image we'd ask Gemini for, with its grid, aspect, size, and a drafted
   prompt.
2. **The rendering work.** What the game has to learn to draw those images on bodies that roll,
   tumble, snap in half and explode.

Read tower-defense's decisions 20, 22, 26–28, 41, 57, 61 and 65 first. Almost every rule below is
one of those lessons, applied here.

---

## What carries over unchanged

These are the tower-defense rules, and they apply to this game as-is:

- **Art sits on top and never replaces anything.** `sprite(id)` returns null and the procedural
  painter runs. Deleting `public/sprites/` has to leave a game that is still *readable*, not just
  still running. Physics and `verify()` never see the art.
- **One shared STYLE paragraph and one sentence of subject per piece.** Changing the look means
  changing the paragraph and regenerating everything.
- **A character has to look the same everywhere, so all of its poses go in ONE image.** Never two
  calls for one character.
- **Every multi-frame grid is 4×2 on 16:9, with the cell count spelled out loudly in the prompt.**
  The one exception (Ellie's moods, 2×2) is already proven in tower-defense.
- **Flat chroma-key #00FF00 backgrounds**, removed in the browser by a flood fill from the edges,
  plus the second flood that clears enclosed holes.
- **Pose sheets are drawn facing RIGHT.** The model draws them that way regardless of what you ask.
- **Generate large, then shrink** with `npm run art:shrink`, sized to about 4× what's actually
  drawn.
- **Game state stays hand-drawn on top of the art:** bands, pouch, flight path, trails, fuse
  sparks, HUD and BOOM words.
- **`checkArt()` runs after every art run.** It counts bands of content and requires an exact
  match with the grid the slicer will cut.

## What's new here, because things spin

In tower-defense every sprite stands upright on a fixed grid. Here almost everything is a rigid
body that rotates, tumbles, and lands upside down. That brings five new rules, and they're the
main design content of this plan.

### N1. The collision shape is the sprite, so the art has to fill the shape

The hitbox *is* the drawn object; there is no inset like Flappy's. A raccoon is a circle, so the
raccoon must be **round**, filling a circle, with only its ears allowed to poke out (under 10% of
the radius, and upward only). Anything that overhangs further looks like it's sinking into the
block beside it. Every round subject's prompt says "body is a near-perfect circle".

### N2. No baked-in lighting direction, no shadows, for anything that rotates

A block or toy with a sunlit top edge and a shadow underneath looks wrong the moment it lands
upside down. Rotating pieces ask for **flat, even lighting with no cast shadow and no
directional highlight**. Bevels and a highlight are added procedurally afterwards, in screen
space, so they stay on top as the body turns.

This doesn't apply to the backdrop, ground, Ellie or the slingshot, which never rotate.

### N3. Blocks are textures, not stickers

Blocks are stretched and cut in ways no fixed sprite survives: planks run from 0.5 m to 6.1 m
long, posts are planks turned on their side, triangles are cut from squares, and broken blocks
split into halves. So each material gets:

- **A plank**, drawn by **3-slice**: left cap, middle stretched, right cap. Wood grain stretches
  along its length naturally. A post is the same plank rotated 90°.
- **A square block**, used for squares and clipped to a triangle for triangles. A broken half
  just shows the half it covers.
- **Four damage states** of each, held in one image, picked by `hp / maxHp`. They replace the
  procedural cracks when art is present.

A body that splits keeps its texture, cut where the halves fall.

### N4. Glass can't be see-through on a green background

Ask for transparent glass and the model paints it tinted with whatever is behind it, which here
is #00FF00. Glass is therefore prompted as **frosted, opaque, pale-blue, nothing visible through
it**, and the game draws it at 85% opacity. Tower-defense never had to solve this.

### N5. Explosions go on black and are blended additively

Fire is soft-edged and glowing, which is the worst case for a chroma-key flood fill: you get
green fringes around every flame. Explosion frames are instead painted on **pure black** with no
cut-out, and drawn with `globalCompositeOperation = 'lighter'`, so black adds nothing and the
fire adds light. It's the standard VFX trick, and it makes blasts glow over whatever is behind
them.

Smoke can't be additive (grey would turn into light), so smoke is a separate, normally keyed
sheet.

### Size budget

The camera fits the whole level, at about 13–25 px per metre, and up to 2× on retina. So at
most:

| Thing | Drawn size (device px) | Shrink target |
| --- | --- | --- |
| Toy (0.5–1 m) | 15–50 | 192 |
| Raccoon (0.84 m, up to 1.2 m) | 22–60 | 256 / frame |
| Ellie (~1.8 m) | 45–90 | 320 / frame |
| Plank (0.25 m thick) | 6–12 thick | 1024 × 128 |
| Block / TNT (1 m) | 26–50 | 256 |
| Explosion (8.4 m across) | up to ~420 | 512 / frame |
| Backdrop, ground | full frame | 1280 |

The plank row matters most: **a plank is about 8 px thick on a phone.** Fine grain detail
disappears, while a bold colour and a dark outline survive. The material prompts say so.

---

## The requests

**About 22 billed images in total**, in three phases, with the biggest visual win first.
Tower-defense's set was about 45.

### Shared prompt parts

Same structure as tower-defense's `art-manifest.mjs`. The palette moves outdoors:

```
DRAW_STYLE:
  children's picture book illustration, soft rounded shapes, thick clean dark outlines,
  flat bright colours with simple soft shading, cheerful and sunny, palette of sky blue,
  warm honey wood, soft grey, sunny yellow and berry pink, no text, no letters, no watermark

KEY_BACKGROUND:   (unchanged from tower-defense)
FLAT_LIGHT (new, N2):
  Lit evenly from the front with NO directional light: no highlight on one edge, no shadow
  on the other, no cast shadow. The object must look equally correct turned upside down.
BLACK_BACKGROUND (new, N5):
  THE BACKGROUND MUST BE PURE SOLID BLACK, hex #000000, every pixel that is not fire or
  light. No smoke against the black, no ground, no scenery, no border.
NO_GREEN (new):
  The subject contains NO green anywhere: no grass, no leaves, no green clothing or trim.
```

`NO_GREEN` exists because this game is set outdoors, and a model drawing "a raccoon in a meadow"
will add grass tufts that the flood fill then half-eats.

### Phase 1: characters, toys, TNT, the boom (12 images, 13 with the whoopee cushion)

#### `bandit`: raccoon sheet (**4×3**, **4:3**, 2K)

The villain, and the thing she looks at most. They aren't just targets; they're **cheeky**. They
stick their tongues out at Ellie, waggle their fingers, laugh at her misses, and **burp and toot
at her**. Farts and burps are top-tier comedy at five, so they're a core part of the cast. All of
that is what makes bonking one satisfying.

That takes twelve frames, which is the one deliberate break from "always 4×2". It still has to be
**one image**, because teasing frames drawn in a second call would be a different raccoon. The
grid follows the subject: three rows of round raccoons on a 4:3 frame gives near-square cells,
like tower-defense's sock slider, which the manifest already encodes as a 4×3 sheet. The prompt
spells out "TWELVE figures, THREE rows, no more", and `checkArt()` must pass before this sheet
ships. If the model won't draw 4×3, the fallback is to drop *nyah-nyah* and *laughing* to fit
4×2, keeping the toot and the burp, which are the funniest. Never split the sheet.

**Rows 1–2 are mirrored at load** so the raccoons in the forts face Ellie. **Row 3 is not
mirrored**, so a bonked raccoon runs off to the right, away from her. That needs a new per-row
mirror option in the loader, `mirrorRows: [0, 1]`.

```
The character: a small plump raccoon bandit, his body ROUND like a ball — a near-perfect
circle — sitting upright, soft grey fur, a black bandit mask across the eyes, a cream belly,
small rounded ears, a thick ringed grey-and-charcoal tail curling up behind him, tiny paws.
A cheeky little troublemaker, naughty but never mean or scary.
Silhouette: a circle with two small ears on top and a curled tail.
TOP ROW (frames 1-4), TEASING, looking straight out at the viewer:
  1 raspberry: tongue stuck right out, eyes squeezed shut, cheeks puffed.
  2 nyah-nyah: both thumbs in his ears, fingers waggling, tongue out, eyes rolled up.
  3 toot: still sitting, leaning over onto one side so one hip lifts, eyes half closed
    with a very pleased cheeky grin, one paw raised as if saying "oops!". NO cloud, NO
    smoke, NO marks: just the raccoon.
  4 burp: still sitting, belly pushed out round, mouth stretched wide open in a huge
    burp, eyes squeezed shut, one paw patting his tummy.
MIDDLE ROW (frames 5-8), SITTING IN HIS FORT:
  5 smug: paws folded, sly half-smile, eyes narrowed, tail curled up.
  6 pointing and laughing: one paw pointing at the viewer, other paw on his belly, mouth
    wide open laughing, eyes squeezed into happy crescents.
  7 scared: eyes huge and round, both paws up, fur standing on end, mouth a small "o".
  8 dizzy: eyes are spirals, tongue lolling, a white bandage crossed on his head.
BOTTOM ROW (frames 9-12), RUNNING AWAY: the same raccoon scampering on all fours, a
  four-frame gallop: 9 front paws reaching, 10 all paws gathered under, 11 back paws pushing
  off, 12 stretched out mid-air.
+ FLAT_LIGHT + NO_GREEN
```

Rows 1–2 are moods, not cycles, so the shared rule "frame 3 must not repeat frame 1" is reworded
for this sheet. The teasing frames are all still **seated and round** (N1). He teases from where
he sits, because a raccoon standing up tall would no longer fit his collision circle.

**The toot cloud is never part of the picture.** It would be a green cloud on a #00FF00
background: the flood fill would eat half of it, and `NO_GREEN` forbids it anyway. The game draws
it as a puff particle in pale yellow-green (#d4e157), well away from the key colour. It drifts up,
wobbles and fades, which is funnier moving than painted anyway.

The blink and wiggle frames were cut to make room for the toot and the burp. A blink is now a
quick vertical squash of the smug frame, and the victory dance cycles the teasing frames with a
procedural hop.

#### `ellie`: Ellie sheet (4×2, 16:9, 2K)

**Use tower-defense's exact `look`/`outfit` text for her**, so she's the same girl in both games:
long wavy dark brown hair, warm honey-tan skin, big brown eyes, coral sundress, plus sneakers
because she's outdoors. She stands left of the slingshot facing the forts. That's RIGHT, which
is what the model draws anyway, so no mirroring.

She **doesn't hold the pouch.** In Angry Birds nobody does, and a drawn hand can't be kept on a
pouch that moves continuously with the player's finger. She reacts instead:

```
1 ready: standing, hands on hips, determined little smile.
2 teasing back: tongue stuck out at the raccoons, one hand pulling down her lower eyelid,
  a playful "so there!" face.
3 aiming: squinting one eye, pointing an arm straight out to the RIGHT at the forts.
4 GO!: one fist punched forward to the right, mouth open shouting.
5 cheering: jumping, BOTH arms straight up, huge grin, eyes squeezed shut.
6 ew, giggling: pinching her nose with one hand and waving the other in front of her
  face, eyes squeezed shut, giggling hard (for a toot or a burp).
7 amazed: both hands on her cheeks, mouth a wide "O", eyes sparkling (for a BOOM).
8 oh-well: shoulders shrugged, small pout, palms up (lost level).
+ FLAT_LIGHT not needed (she never rotates); NO_GREEN
```

As tower-defense's decision 34 found, posture carries the mood at 45 px, so every frame is
described by her whole body, not only her face. Her breathing between frames is a procedural bob,
which frees frame 2 for **teasing them back**. It's a playful exchange, and she gets the last
word.

#### Toys (5 stills, 1:1, 1K)

All drawn round and filling the circle (N1), with flat light (N2):

| id | Prompt subject |
| --- | --- |
| `toy.ball` | a shiny rubber bouncy ball, berry-pink with a sunny-yellow band and a sky-blue band crossing, perfectly round |
| `toy.ducks` | ONE yellow rubber duck seen from the side facing RIGHT, orange beak, round chubby body, plump enough that its outline is nearly a circle |
| `toy.rocket` | a chunky toy rocket lying HORIZONTAL with its nose pointing RIGHT, red nose cone and fins, white body, round blue window; short and fat so it fits a circle |
| `toy.bear` | a round curled-up brown teddy bear, hugging its knees so the whole bear is a ball, round ears, cream muzzle, stitched smile |
| `toy.firecracker` | a round cherry-bomb firecracker toy, deep purple with gold stars, a short twisted fuse on top, cartoon not realistic |
| `toy.whoopee` *(proposed)* | a pink rubber whoopee cushion puffed up round like a ball, a short nozzle pointing LEFT, a happy little face printed on it |

The rocket is the one toy drawn along its heading rather than its spin, as now. Its flame stays
procedural.

**Proposed sixth toy: the Whoopee Cushion** (`toy.whoopee`, one more image):

- **Tap trick:** a fart-jet. It blasts forward like the rocket's boost, leaving a trail of toot
  clouds and making the longest, silliest toot in the game.
- **Every bounce** squeaks out a tiny toot, and it's bouncy, so it keeps going.
- **Best against wood**, like the rocket.

It replaces the rocket on a level or two, and gets its own level, *Toot Toot!*, built from forts
where ricochets matter. In code it's a sibling of the rocket; its real job is being the funniest
thing in the game.

#### `tnt`: TNT crate sheet (2×2, 1:1, 1K)

```
FOUR drawings of the SAME wooden TNT crate, one per quadrant, square, seen straight on:
dark red painted boards with darker wooden corner battens, big chunky yellow letters "TNT"
on the front, a short black fuse on top.
1 brand new. 2 a few cracks and a dent. 3 badly cracked, one board split, letters scuffed.
4 about to blow: same cracks, glowing orange light leaking out of every crack, fuse sparking.
+ FLAT_LIGHT + NO_GREEN
```

This is the one piece with **letters in it.** If "TNT" comes back misspelled after two tries, drop
the letters from the prompt and keep the procedural "TNT" text painted over the art. Frame 4 also
gives chained crates something to show during their 0.16 s countdown (see R7).

#### `boom`: explosion flipbook (4×2, 16:9, 2K, **black background**, N5)

```
EIGHT frames of ONE cartoon explosion, read left to right then top to bottom, centred in
each cell, each the same overall size of cell:
1 a small white-hot flash star. 2 a bright yellow-white ball bursting outward with spiky
edges. 3 a big round fireball, yellow core, orange rim. 4 fireball at its biggest, orange
with red edges and puffy billows. 5 breaking up into separate orange puffs. 6 deep red puffs
spreading. 7 dim dark-red embers, mostly faded. 8 a few last glowing sparks.
Cartoon style with bold shapes, like a picture book, not realistic.
+ BLACK_BACKGROUND
```

Drawn over the particle system at 0.55 s for the full flipbook, scaled to the blast radius. The
rings, embers, splinters and debris stay procedural on top.

### Phase 2: the world (7 images)

#### Materials (6 images: plank sheet + block sheet per material)

**Plank sheets** (1×4, 21:9, 2K). Four planks stacked top to bottom, each about 9:1:

```
FOUR copies of the SAME long [material] plank lying horizontally, stacked one above the
other with clear space between them, each spanning almost the full width.
Top: brand new. Second: a few cracks. Third: badly cracked. Bottom: about to snap, a deep
split across the middle.
Bold simple colours and a thick dark outline — this is drawn only 8 pixels thick in the
game, so fine detail is wasted.
+ FLAT_LIGHT + NO_GREEN
```

**Block sheets** (2×2, 1:1, 1K): the same material as a square block at the same four damage
stages.

Materials:

- **wood**: honey-coloured planks with a few long grain lines and a knot.
- **glass**: frosted pale-blue opaque glass, like a thick ice block, with a soft white streak.
  NOT transparent; nothing visible through it (N4).
- **stone**: light grey cut stone with a few darker speckles and rounded corners.

#### `slingshot` (1 still, 3:4, 1K)

```
a big wooden Y-shaped slingshot planted upright in the ground, seen side-on: a thick
trunk splitting into two forked arms, a leather wrap around the trunk, the fork tips
slightly knobbly. NO rubber bands and NO pouch — the forks are bare.
+ NO_GREEN
```

Its bands are drawn by the game, so it needs **two measured anchor points**: where the fork tips
are in the image. They're recorded in the manifest as `anchors: { forkL, forkR }` in 0–1 image
coordinates and measured once by hand with a new `__game.art.anchors('slingshot')` overlay. Then
`FORK_L` and `FORK_R` come from the art instead of from constants.

### Phase 3: the backdrop, the title, and extras (3–5 images)

#### `meadow`: play background (21:9, 2K, full-bleed)

```
A FLAT side-on GAME BACKGROUND, no perspective: a sunny sky with a few soft clouds; along
the lower third, gentle rolling hills and a distant soft tree line, hazy and pale. The
bottom tenth is plain flat grass colour. Nothing square, boxy or block-shaped anywhere —
no fences, houses, crates or walls — and no animals or people.
```

The "nothing block-shaped" line is a gameplay rule, not a style choice. A background shape that
looks like part of a fort will be aimed at.

#### `ground`: ground strip (21:9, 1K, full-bleed)

A side-on cross-section of a grass top edge over soil with a few pebbles. It's tiled across the
level with every other copy mirrored, which hides the seam without asking the model for a
seamless tile, something it's unreliable at. Ledges and hills reuse it, clipped.

#### `title`: menu picture (16:9, 2K, full-bleed)

Ellie on the left with her slingshot, and a wobbly raccoon fort on a hill on the right with three
smug raccoons peeking over the top. The **centre third is left as open sky** for the title and
the PLAY button. No text.

#### Optional extras

- **`meadow.dusk`**: a sunset variant for levels 11–14. Explosions look best against a dusky sky,
  and she'll be seeing a lot of them on those levels.
- **`bandit.chief`**: a boss raccoon for *Big Bandit HQ*'s big bandit, the same 4×2 sheet plus a
  little black top hat. It must be its own sheet, never a hat drawn over the ordinary raccoon,
  because drift between two images is exactly what the one-picture rule prevents.
- **`smoke`**: 8 grey smoke puffs (4×2, keyed), for the smoke and dust particles to use at
  random.

---

## The rendering work

This is the order to build it in. Each step leaves the game working, with or without art on disk.

**R1. Port the pipeline.** Copy `generate-art.mjs`, `shrink-art.mjs`, the shape of
`art-manifest.mjs`, `src/render/sprites.ts`, `src/dev/art.ts`, `.env.example` and the three `art`
npm scripts from tower-defense. This is a second copy of the loader, and the same caution as
tower-defense's decision 2 applies: if a third game wants it, it becomes a shared package.

**R2. Loader additions:**

- `mirrorRows`, for the raccoon's split facing.
- `key: 'none'`, to skip the cut-out for the black-background explosion.
- `anchors`, to carry measured points (the fork tips) through `index.json`.
- Sheets registered by **state name** rather than cycle: `bandit.smug`, `bandit.scared`,
  `bandit.run`, `ellie.cheer` and so on.

**R3. Round bodies** (raccoons, toys): fit the circle's diameter to the sprite's content box,
rotate with the body, and allow the ears to overhang.

- **Squash on impact:** when an impact event lands within a body's radius, squash the sprite by
  up to 15% along the impact normal and spring it back over 0.15 s. This is render-only, driven
  by the impact events main.ts already gets, and it's the biggest "it's soft and alive"
  difference for the least work.

**R4. Raccoon animation, driven by physics rather than a clock:**

- **Smug** frames alternate every ~2.5 s, with a blink.
- **Teasing**, which is driven by what happens rather than a timer, so it always reads as a
  reaction to *her*. See "The teasing" below.
- **Scared** while the body is moving faster than 1.2 m/s, *or* for 0.6 s after any impact or
  blast within 3 m. A flinch before the hit is what makes him look aware of it.
- **Dizzy** below 60% hp.
- **Bonked:** the scared frame tumbles through the air, rotated by the existing particle. Then the
  run cycle plays, with **frames advanced by distance run**, not time.

**R5. Ellie's state machine**, picking a frame from game state:

| Game state | Frame |
| --- | --- |
| idle | ready (1), with a procedural breathing bob |
| a raccoon just teased her | teasing back (2), for 0.8 s, half a beat after the raccoon starts |
| aiming | aiming (3) |
| just launched | GO! (4) |
| raccoon bonked | cheer (5) for 0.8 s, with a procedural jump |
| a raccoon toots or burps | ew, giggling (6) for 1 s, half a beat later |
| a BOOM within view | amazed (7) for 1 s |
| won | cheer (5), bouncing |
| lost | oh-well (8) |

Her procedural reaching arm goes.

**R5b. The teasing.** This is behaviour, not art, so it can be built and played **before any
images exist**. The procedural raccoon gets a tongue and a pointing paw, and the art replaces them
later. The triggers:

| When | Who | What |
| --- | --- | --- |
| A level starts | one raccoon, picked at random | a big **burp** (4), then a raspberry (1) |
| She's been aiming for 3 s | the nearest raccoon | a **toot** (3) with a cloud, or nyah-nyah (2) |
| A shot comes to rest having bonked nobody | every raccoon that can see the slingshot | pointing and laughing (6) at once, with giggles |
| A raccoon next door is bonked | its neighbours | scared (7), then 1 s later the bravest one burps at her anyway (4) |
| A raccoon is bonked | that raccoon, 1 time in 3 | a startled **toot** as he flies off, trailing little clouds |
| She loses a level | all survivors | a victory dance cycling 1–4, ending in one long toot |
| She wins | (they're all gone) | Ellie's cheer, which is her win |

**Build the surprise toot-when-bonked first.** It rewards a hit, it's random so it stays funny,
and it costs only a sound and a particle.

The rules that keep it fun rather than mean:

- **Teasing is never more than one raccoon at a time, except right after a miss**, where a whole
  fort laughing is the joke.
- **It never fires mid-flight**, so it can't distract from the shot.
- **Ellie answers.** Every tease gets her tongue-out frame half a beat later, so the exchange
  ends with her and not with them.
- **A tease is never a punishment.** No score change, no timer. Missing should feel like "oh,
  those cheeky raccoons!", not like failing.

Every tease sound is synthesised like everything else, with no audio files:

- **Toot:** a sawtooth around 70–140 Hz through a low-pass filter (400–900 Hz), its volume
  flapped at 18–35 Hz for the flutter, with the pitch wandering randomly. Three flavours, picked
  at random so it never sounds like a loop: a short *pfft* (filtered noise only), a long rumbler
  (0.8 s, slow flap), and a squeaker (starts at 220 Hz and rises).
- **Burp:** a sawtooth sliding 120 → 75 Hz over about 0.5 s through two wobbling band-pass
  "mouth" filters (~500 Hz and ~1.1 kHz), with vibrato, and sometimes a little *hic* at the end.
- **Nyah-nyah:** a quick two-note square wave, a falling minor third.
- **Raspberry:** a low noise burst with a fast tremolo.
- **Giggle:** three bright chirps.

All of them are pitched by raccoon size, so the boss's burp is a foghorn.

Speech bubbles ("nyah nyah!", "missed me!", "hee hee!", "BURP!", "toot!", "oops!") are procedural,
in the HUD font, drawn above the raccoon, and capped at one on screen at a time.

**R6. Blocks** (N3):

- **Planks:** 3-slice the plank frame; posts are the same plank rotated.
- **Squares and triangles:** clip the block frame to the shape.
- **Damage stage:** chosen from `hp / maxHp`.
- **Split halves:** keep their half of the parent's texture. Store the texture offset on the body
  as render data; the engine already carries `user`.
- **Outline and bevel:** a procedural dark outline and a 1 px top-left highlight, in screen space,
  so they stay correct as the body rotates (N2).
- **Glass:** drawn at 85% opacity.

**R7. TNT:**

- Damage frames as the crate is hit, with the procedural fuse spark and tremble kept.
- **Chained crates stay visible** on frame 4, glowing, for their 0.16 s countdown. Today a crate
  caught in a chain vanishes the instant it's queued. To fix that, `pendingBooms` becomes
  readable, and the renderer draws a glowing crate at each one.

**R8. Booms:**

- The flipbook is drawn additively at each blast, scaled to the radius, with a small random
  rotation and mirror per blast so a chain doesn't look like one blast stamped five times.
- The smoke particles use the `smoke` frames when present.

**R9. The world:**

- The backdrop replaces the sky, clouds and hills.
- The ground strip replaces the grass and dirt rectangles.
- The title picture goes behind the menus, with a scrim.
- The slingshot sprite uses its anchors, and the bands and pouch stay procedural.

**R10. Checks:**

- `checkArt()` covers every sheet.
- **Delete `public/sprites/` and play level 1.** The game must still be readable, not just
  running.
- **Profile on a phone during a big collapse.** The worst case is level 14's chain, with about 60
  rotated sprites plus 1,400 particles at 60 fps.

## Risks and fallbacks

| Risk | Fallback |
| --- | --- |
| The model draws a grid other than the one asked for (it has, three times) | `checkArt()` catches it. Encode what it reliably draws (tower-defense's decision 57). Use `deadRows` for a bad row. |
| "TNT" lettering misspelled | Drop the letters from the prompt and paint them procedurally on top. |
| Glass comes back see-through and green-tinted | Reprompt harder for "opaque ice block". Otherwise glass stays procedural; it's already the best-looking material. |
| Explosion has a dark grey haze instead of pure black | Additive blending turns the haze into a faint glow box. Fix it with a black-point clamp at load (every pixel under ~24 brightness set to 0). |
| The 4×3 raccoon sheet comes back as 4×2 or 4×4 | `checkArt()` catches it. Retry once, then fall back to 4×2 by dropping nyah-nyah and laughing. Don't split the sheet. |
| The model draws a cloud with the toot anyway, or won't draw the pose | The toot cloud is game-drawn, so a painted one is a bug. Reprompt once with "just the raccoon, nothing else"; if it persists, the smug frame stands in for that frame. |
| A teasing pose stands him up tall, out of his circle | Reprompt with "still sitting, still round". The fit uses the content box, so he shrinks rather than overhangs, but a tiny raccoon reads wrong. |
| The raccoon isn't round enough for its circle | Its fit uses the content box, so it scales into the circle anyway. If it reads as squashed, reprompt with "a ball with a face". |
| Plank texture turns to mush at 8 px | Expected. The outline and bold colour carry it. Shrink to 128 px tall, not smaller. |

## Before we start generating

Five things for you to decide, with my recommendations:

1. **Is Ellie the same girl as in Squeeze Squad**, with the same hair, skin and coral dress?
   Recommended: yes. One Ellie across the whole set.
2. **Cartoon booms or realistic?** Recommended: picture-book cartoon, to match everything else.
   The physics makes it feel big; the art just needs to be fun.
3. **How cheeky should they be?** Recommended: as in the table, tongues, finger-waggles,
   pointing-and-laughing, burps, toots and a dance. No bottom-wiggling: that needs them to turn
   around, which breaks the never-turn-around sheet rule, and a seated hip-lift does the same
   job.
4. **Add the Whoopee Cushion toy?** Recommended: yes, plus its level. It's one image, and a
   sibling of the rocket in code.
5. **Phase 1 only first?** Recommended: yes. Twelve images (13 with the whoopee cushion) cover
   everything she looks at during a shot. Play it with her, then decide on the world art.
