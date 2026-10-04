/**
 * What to ask Gemini to SAY and PLAY: voice lines (text-to-speech) and music
 * (Lyria). The physical sounds (crashes, booms, toots, burps) stay synthesised
 * in src/core/audio.ts; no available model makes sound effects, and the synth
 * versions react to impact energy in a way a recording can't.
 *
 * ## Voice direction must not be spoken
 *
 * The first test put the direction in plain text ("Say it like a cheeky
 * cartoon raccoon: Nyah nyah!") and the model read every word of it aloud,
 * 8.7 seconds of it. A system instruction is refused by the TTS models. The
 * format that works is a director's-notes prompt where only the TRANSCRIPT is
 * spoken (`voicePrompt` below), and it came back as 2.9 seconds of exactly the
 * line, in a squeaky cartoon voice.
 *
 * ## Lines are short, and there are a few of each
 *
 * A child hears these dozens of times a session. Two or three variants per
 * moment, picked at random, keep them from wearing out; and every line is a
 * second or two, because a long line talks over the next thing that happens.
 */

/**
 * Feedback from listening: Ellie came out "almost flirty", and both read as
 * natural voices rather than cartoons. "Cartoonish" was defined as shorter and
 * higher pitched. So: cartoon direction, short lines, and a playback `rate`
 * that the game applies on top: faster playback is shorter AND higher, which
 * is exactly the classic cartoon-voice trick. The rate is written into the
 * sound index, so it can be tuned without re-recording.
 */
const RACCOON = {
  voice: 'Puck',
  rate: 1.35,
  profile:
    'a tiny squeaky cartoon critter from a children\'s TV cartoon: a mischievous little raccoon with a ' +
    'high, nasal, chipmunk-like voice, silly and over the top, never mean',
};

const ELLIE = {
  voice: 'Zephyr',
  // Not sped up: at 1.25 she sat at the same pitch as the raccoons and the two
  // were hard to tell apart. Her cartoon-ness comes from the direction; the
  // raccoons keep their speed-up, so they're the squeaky ones.
  rate: 1,
  profile:
    'a little cartoon girl from a children\'s TV cartoon, about five years old: high, bright, squeaky ' +
    'and bouncy, innocent and goofy, like an animated kid sidekick. NOT grown-up, NOT breathy, NOT ' +
    'soft or sultry: a loud happy little kid',
};

function line(id, who, style, text) {
  return { id, kind: 'voice', who, style, text };
}

export const SOUNDS = [
  // --- Raccoons ---------------------------------------------------------------
  line('r.nyah', RACCOON, 'sing-song teasing, quick', 'Nyah nyah!'),
  line('r.nyah2', RACCOON, 'sing-song teasing, very pleased with himself', "Can't get me!"),
  line('r.missed', RACCOON, 'gleeful, quick', 'Missed me!'),
  line('r.missed2', RACCOON, 'a short burst of giggles', 'Hee hee hee!'),
  line('r.missed3', RACCOON, 'smug, sing-song', 'Too slow!'),
  line('r.excuse', RACCOON, 'not sorry at all, right after a burp', "'Scuse me!"),
  line('r.oops', RACCOON, 'pretend-embarrassed, right after tooting', 'Oopsie!'),
  line('r.oops2', RACCOON, 'proud and silly', 'Big one!'),
  line('r.uhoh', RACCOON, 'suddenly nervous, two quick syllables', 'Uh-oh!'),
  line('r.whoa', RACCOON, 'flying through the air, wobbly', 'Whoaaa!'),
  line('r.nofair', RACCOON, 'whiny, dramatic', 'No fair!'),
  line('r.hello', RACCOON, 'sneaky and smug', 'Our toys now!'),
  line('r.dance', RACCOON, 'triumphant, sing-song', 'We win! We win!'),

  // Mouth-fart raspberries, blown by the raccoon voice. An alternative to the
  // synthesised toot in audio.ts; the game uses these when present.
  line('r.fart1', RACCOON, 'blowing a long, wet, silly cartoon raspberry with his lips, a mouth-fart noise, not words', 'Pbbbbbbbbbbbt!'),
  line('r.fart2', RACCOON, 'a short, sputtering cartoon mouth-fart noise, not words', 'Pfft-pfft-pbbt!'),
  line('r.fart3', RACCOON, 'a big low rumbling cartoon raspberry noise, flapping lips, not words', 'Brrrrrrrrap!'),

  // --- Ellie ------------------------------------------------------------------
  line('e.yay', ELLIE, 'delighted, cheering', 'Yay!'),
  line('e.gotcha', ELLIE, 'triumphant, giggly', 'Got you!'),
  line('e.takethat', ELLIE, 'bold, playful', 'Take that!'),
  line('e.ew', ELLIE, 'grossed out but laughing', 'Ew, stinky!'),
  line('e.ew2', ELLIE, 'grossed out, one quick giggle', 'Ewww! Hee!'),
  line('e.kaboom', ELLIE, 'thrilled, shouting', 'KABOOM!'),
  line('e.wow', ELLIE, 'wide-eyed amazement', 'Woooow!'),
  line('e.nyah', ELLIE, 'teasing right back, playful', 'Nyah nyah!'),
  line('e.hmph', ELLIE, 'pretend-grumpy, playful', 'Hmph!'),
  line('e.ohno', ELLIE, 'disappointed but cheerful', 'Oh no!'),
  line('e.won', ELLIE, 'thrilled and proud', 'We did it!'),

  // --- Music (Lyria) -------------------------------------------------------------
  // Each comes back as about thirty seconds that may fade at the end; the player
  // in src/core/audio.ts finds the steady part and crossfades it into a loop.
  {
    id: 'music.title',
    kind: 'music',
    prompt:
      "A bright, mischievous title theme for a children's cartoon game about cheeky raccoon bandits and " +
      'a brave little girl with a slingshot: sneaky pizzicato strings and a playful clarinet, bouncy ' +
      'ukulele, a little glockenspiel sparkle, 104 bpm. Steady the whole way through: no long intro, no ' +
      'ending, no fade-out. Instrumental, no vocals.',
  },
  {
    id: 'music.day',
    kind: 'music',
    prompt:
      "Cheerful, bouncy, playful background music for a children's cartoon game set in a sunny meadow: " +
      'ukulele, glockenspiel, pizzicato strings, light hand claps and soft drums, sunny and silly, 112 bpm. ' +
      'Gentle enough to play under sound effects. A steady groove the whole way through: no intro, no ' +
      'build-up, no ending and no fade-out, so it can loop. Instrumental, no vocals.',
  },
  {
    id: 'music.dusk',
    kind: 'music',
    prompt:
      "Warm, playful golden-hour background music for a children's cartoon game at sunset, building a " +
      'little excitement for big explosions: marimba, plucky bass, soft brass stabs, light drums, 116 bpm. ' +
      'Gentle enough to play under sound effects. A steady groove the whole way through: no intro, no ' +
      'ending and no fade-out, so it can loop. Instrumental, no vocals.',
  },
];

/** The TTS prompt. Only the TRANSCRIPT section is spoken. */
export function voicePrompt(s) {
  return [
    `# AUDIO PROFILE: ${s.who.profile}`,
    "## DIRECTOR'S NOTES",
    `Style: ${s.style}. Cartoon voice acting, short, punchy and high-pitched.`,
    '#### TRANSCRIPT',
    s.text,
  ].join('\n');
}
