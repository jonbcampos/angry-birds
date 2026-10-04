# Decisions

What we decided, why, and what would make us revisit it. **Append to this; don't rewrite
history.** This is the sister log to the ones in `../flappy-unicorn`, `../runner` and
`../tower-defense`.

---

## 1. Our own physics engine, not a library

The brief was "like Angry Birds, and the physics effects matter most." The obvious move is
Box2D or planck.js. We wrote one instead (`src/physics/`, about 900 lines), for two reasons:

- **House rule.** None of the four games has a runtime dependency, and the physics is the whole
  game, so it's the last place to hand off to a black box.
- **The feel is tuned in the engine.** Rolling resistance, when a toy counts as "at rest",
  speculative contacts, sleep thresholds and impact energy reporting are all decisions about
  how the game feels. Owning them means each one is a number in a file we control.

It's the Box2D v2 design, minus everything a slingshot game doesn't need. We kept convex
polygons and circles, SAT with reference-face clipping, warm-started sequential impulses, a
separate restitution pass, non-linear Gauss-Seidel position correction, and island sleeping. We
dropped joints, continuous collision detection and a dynamic tree. The 2 × 120 Hz substeps
cover tunnelling, and an insertion-sorted sweep is plenty for 60 bodies.

**Revisit if:** a level needs joints (a drawbridge, a rope), or the body count passes a few hundred.

## 2. 240 Hz physics inside the 120 Hz fixed step

The loop is inherited from the siblings and steps at exactly 1/120 s. Physics runs two substeps
per tick. At 20 m/s a toy travels 8 cm per substep, comfortably less than a 25 cm plank, so it
can't tunnel. An entire level steps in under 0.1 ms.

## 3. Levels start asleep, and `verify()` keeps that honest

Every body loads asleep, resting exactly on the one below it (the level builder returns heights
so pieces stack with zero gap). A fort appears perfectly still instead of settling visibly.

The risk is that sleep hides instability: a fort that can't stand would look fine until the first
toy woke it, and then collapse on its own, stealing credit from the shot. `__game.verify()` wakes
every body and requires five seconds with no damage, no lost pieces, under 12 cm of drift and
under 0.06 rad of tilt. All fourteen levels pass, with a worst drift of 3 mm.

## 4. Damage is approach energy, with a floor

Each impact reports ½·m_red·v_n² from the approach speed measured before the solve, and only for
contacts that actually pushed. Speculative contacts that never closed don't count. Hit points are
area × material toughness. `DAMAGE_FLOOR_J` (10 J) is subtracted first so settling contacts do
nothing, and a fort never grinds itself to dust under its own weight.

An impulse-based measure was rejected because resting contacts carry the weight of everything
above them as impulse every step. Energy from approach speed is zero for things that are already
touching.

## 5. Broken blocks split into real halves

When wood or stone breaks and its long side is at least 0.9 m, it becomes two bodies. Each keeps
the parent's velocity at its own offset, including the spin, plus a small kick apart. Halves
have 60% of the toughness, so a 2 m plank goes 2 → 1 → 0.5 → dust. Glass and anything smaller
shatters into particles.

This is the single biggest contributor to collapses that look like collapses. A block that
vanishes into particles takes its weight with it; a block that snaps keeps falling and keeps
hitting things.

## 6. The camera frames the whole level and holds still

Angry Birds pans with the bird. For a five-year-old, that puts the tower she aimed at off screen
when the toy arrives, and the collapse happens where she can't see it. The camera fits the
slingshot through the last fort and only shakes. Forts sit 13–25 m out, which was pulled in 3 m
after the first look, because blocks at 18–28 m were too small on a phone.

## 7. Aim from anywhere, and see where it'll go

- **The pull is measured from wherever the finger went down**, not from the pouch. Grabbing a
  15 px toy is a fine-motor test this game shouldn't be setting.
- **The release re-reads the finger's final position.** A flick can go down, move and lift between
  two ticks, and the first version fired nothing because it only knew the previous tick's pull.
- **Pulling the wrong way cancels.** A drag toward the forts is zero power, not a shot behind Ellie.
- **The dotted flight path shows for 1.6 s while aiming.** Angry Birds teaches by trial and error;
  this turns "guess the angle" into "choose what to hit." The previous shot's trail stays faintly
  on screen, and stops at the first thing it hit.

**Revisit if:** it's too easy. Shorten `PREVIEW_SECONDS` before removing it.

## 8. Pops are a speed kick, not an impulse

The first version applied a fixed 75 N·s impulse. A 1.7 kg raccoon left at 40 m/s and a whole
tower was thrown off the level, while stone slabs barely moved. Pops now set a speed,
`POP_SPEED · falloff / (1 + m / POP_HALF_MASS)`, so light things fly, heavy things shift, and
nothing leaves the screen.

## 9. The villain is the Raccoon Bandits

Chosen by Jonathan from four options (Sock Goblins, Grumble Clouds, Raccoon Bandits, Gloom
Gremlins). Like every game in the set, nobody is hurt: a bonked raccoon becomes a particle that
tumbles, lands on its feet and scampers off to the right. It's the only time a bandit turns its
back.

## 10. Shared core: copied a fourth time

`core/loop.ts`, `core/rng.ts`, `core/viewport.ts`, `core/wakelock.ts` and `ui/text.ts` are copied
verbatim. `config.ts` keeps the export names that `viewport.ts` imports. Tower-defense decision 2
already names this as a strike toward extracting a package; this copy is another one.
`core/input.ts`, `core/audio.ts` and `core/save.ts` are new, because the gesture, the sounds and
the progress model differ.

## 11. TNT, and lots of it

Ellie's favourite thing in Angry Birds is the TNT going off, so the first version's pink "party
crates" became proper TNT and became the centrepiece. Thirteen of the fourteen levels have crates.
Two new levels, *Boom Town* and *The Big Bang*, are built around chain reactions. The Party Popper
toy became the Firecracker, with a blast 85% the size of a crate's.

What makes a blast feel big, layer by layer (see `Particles.explosion` and the `boom` event in
`main.ts`):

- **Physics first.** A 4.2 m radius, a 15 m/s kick for light things that falls off with distance
  and mass, and 340 J of damage at the centre, which is enough to break stone up close.
- **Chains always chain, and always stagger.** A crate caught in a blast doesn't take damage the
  normal way. It's removed and queued to go off 0.16 s later, so a row of crates reads as
  BOOM-BOOM-BOOM rather than one bang. Boom Town's huts were moved in 0.5 m after the first test
  left its TNT tower 25 cm outside the radius: it toppled instead of exploding.
- **A beat of slow motion.** 0.32 s of real time at 30% speed, easing back to normal and renewed by
  each blast in a chain. The blast is too fast to see at full speed, and seeing it is the point.
- **The rest:** a white full-frame flash, a shockwave ring, a fireball that cools from white to
  smoke, embers that bounce, splinters, a scorch mark, maximum screen shake, and a three-layer boom
  (a diving sine thump, low-passed rumble, scattered crackle), pitched differently each time so
  chains don't sound like a loop.
- **One word at a time.** The first chain stacked five "BOOM!"s into an unreadable smear. Words
  are now at least 0.45 s apart, and the third blast in a chain gets "MEGA BOOM!" instead.

TNT crates have a fixed 25 hit points rather than area × toughness, so any solid knock sets one
off, as in Angry Birds. `verify()` still confirms none of them are set off by their fort settling.

**Revisit if:** the slow motion gets old. Shorten `BOOM_SLOWMO` before removing it.

## 12. The raccoons tease, toot and burp, and Ellie answers

Asked for when planning the art: the raccoons should stick their tongues out and tease her, and
"farts and burps do great for a 5 yr old." Built as behaviour first, before any images exist,
because the personality is *when* they do it, not how it looks. `src/render/cast.ts` is the
director, and ART-PLAN.md has the full trigger table.

It lives in `src/render/` because it's presentation. It never touches a body, a score or a
timer, and the simulation's only contribution is one new event, `shotover`, which reports how
many bandits a shot bonked so a miss can be laughed at.

What makes it fun rather than mean:

- **One teaser at a time**, except right after a miss, when the whole fort laughs. The cooldown
  stops *other* raccoons butting in, not a raccoon's own follow-up. The first version blocked a
  raccoon's planned burp-then-raspberry greeting with its own cooldown.
- **Never mid-flight.** Teases scheduled during a shot wait until it's over.
- **Ellie always answers**, half a beat later: tongue out for a tease, nose pinched and giggling
  for a toot or burp. The exchange ends with her.
- **No consequences.** A tease never costs anything.

The surprise toot when bonked (one time in three, with a trail of clouds) is the reward
version. It's random, so it stays funny.

Toot clouds are particles, never painted art: pale yellow-green (#d4e157), well away from the
#00FF00 key the art pipeline will use. The toot and burp sounds are synthesized: a low-passed
sawtooth with its volume flapped at 18–35 Hz for the toot, in three random flavours; a falling
sawtooth through two wobbling vowel filters for the burp. Both are pitched by raccoon size.

`__game.gallery()` draws every raccoon mood and Ellie pose large, because at play size a
raccoon is about fifteen pixels across, too small to tell whether a tongue reads as a tongue.
That's how the first pass's tongues were found to be too small.

**Revisit if:** the teasing gets repetitive. The aim-idle tease interval (`AIM_TEASE_EVERY`) and
the bonk-toot chance are the levers. Don't add more raccoons teasing at once.

## 13. Phase 1 art landed, and what it took

Nine images from Gemini (`npm run art`): the raccoon sheet, Ellie's sheet, the five toys, the
TNT crate and the explosion flipbook. ART-PLAN.md said twelve; it was a miscount and nine is the
whole of Phase 1. All nine came back usable on the first run, about 8.5 MB, shrunk to 684 KB
by `npm run art:shrink`.

The pipeline is tower-defense's (the generator, shrink script, loader and `checkArt`), copied and
extended in three places:

- **`mirrorRows`.** The raccoon's sitting rows are mirrored to face Ellie and his running row
  isn't, so a bonked raccoon runs away from her. Generated facing right, as every pose sheet is.
- **`background: 'black'` → `additive`.** The explosion is painted on black, never keyed,
  near-black clamped to black at load, and drawn with `'lighter'`. It glows over the scene with
  no green fringes, which a keyed fireball would have had.
- **`drawFitted` / `frameBounds`.** Art is fitted to physics shapes by its measured CONTENT box,
  not its padded frame. A raccoon is fitted by height to 2.35× his radius with his bottom on the
  circle's bottom, so he sits on his plank rather than in it. The TNT crate is fitted by width
  and sat on its box's bottom edge, because its fuse makes the picture taller than the crate;
  fitting the whole picture into the square squashed the crate.

Two sheets came back with grid lines drawn between cells despite the prompt: faint dark lines
on Ellie, grey on the explosion. The slicer's `CELL_INSET` already trims cell edges for this,
which is exactly why tower-defense added it. But `checkArt` counted a vertical line as content
on every row and flagged the correct explosion sheet as one band. The checker now ignores a
thin strip at every cell boundary, the same strips the slicer throws away.

Chained crates now stay visible for their 0.16 s countdown, glowing on the TNT sheet's last
frame. `pendingBooms` became readable for this, and that's the only gameplay-side change.

`__game.snap()` renders the current instant and pins it over the page. The live loop keeps
running between console calls, so stepping to a 0.1 s explosion frame and *then* taking a
screenshot showed whatever happened afterwards. Step and snap in one call.

**Revisit if:** the raccoon reads too small on a phone. `RACCOON_ART_HEIGHT` scales him
without touching his collision circle, but past about 2.6 his ears start overlapping the plank
above.
