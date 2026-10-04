/**
 * Keep the screen awake while the game is on it.
 *
 * A lane defence has long stretches where the right move is to touch nothing
 * and watch a wave arrive, and a phone reads "no touches" as "nobody is here"
 * and dims. It happened to the first real player mid-level.
 *
 * ## Why it has to be re-acquired
 *
 * The lock is dropped by the browser whenever the page stops being visible —
 * tab switch, phone locked, app backgrounded — and it is NOT restored when you
 * come back. Requesting once at startup therefore works exactly until the first
 * interruption and then silently stops, which is the worst version of this bug
 * because it looks fixed. The `visibilitychange` listener is the whole point of
 * this module.
 *
 * ## Why the first request waits for a gesture
 *
 * Some browsers reject a wake lock that isn't tied to user activation. There is
 * always a gesture here — you cannot play without tapping — so `arm()` is
 * called from the same place the AudioContext is unlocked, on the first press.
 *
 * ## It is entirely optional
 *
 * Not every browser has this, and a request can be refused for reasons the page
 * has no say in (battery saver, most obviously). Every failure path is a
 * no-op: the game plays exactly as before and the screen dims as it used to.
 */

/**
 * The bits of the Wake Lock API this uses, described structurally.
 *
 * Reached through a cast rather than by relying on `navigator.wakeLock` being
 * typed, because the DOM lib only grew these definitions recently and marks the
 * property as always present — which is exactly the assumption that breaks on a
 * browser without it. A structural read plus an `undefined` check is honest
 * about what is actually known at runtime.
 */
interface Sentinel {
  released: boolean;
  release(): Promise<void>;
}

interface WakeLockApi {
  request(type: 'screen'): Promise<Sentinel>;
}

function wakeLockApi(): WakeLockApi | undefined {
  return (navigator as unknown as { wakeLock?: WakeLockApi }).wakeLock;
}

export class WakeLock {
  private sentinel: Sentinel | null = null;
  private wanted = false;
  private armed = false;
  /** A request is in flight. See the note in `acquire`. */
  private pending = false;

  /** True if this browser has the API at all. Purely for reporting. */
  get supported(): boolean {
    return wakeLockApi() !== undefined;
  }

  /** True if a lock is held right now. Used by the dev handle to check it. */
  get held(): boolean {
    return this.sentinel !== null && !this.sentinel.released;
  }

  /**
   * Start keeping the screen awake, and keep doing so across interruptions.
   *
   * Safe to call on every press: the first call wires the listener and requests
   * a lock, and the rest are a boolean check.
   */
  arm(): void {
    this.wanted = true;
    if (this.armed) {
      void this.acquire();
      return;
    }
    this.armed = true;
    document.addEventListener('visibilitychange', () => {
      // Coming back from hidden is the case that matters; the browser has
      // already dropped the lock by this point and will not restore it.
      if (document.visibilityState === 'visible') void this.acquire();
    });
    void this.acquire();
  }

  /** Give the screen back. Nothing calls this yet; it exists so `arm` has an inverse. */
  release(): void {
    this.wanted = false;
    const held = this.sentinel;
    this.sentinel = null;
    void held?.release().catch(() => {});
  }

  private async acquire(): Promise<void> {
    // `held` is not enough on its own. A request is asynchronous, so two calls
    // arriving close together — `arm()` on a press and the visibilitychange
    // listener firing in the same tick, which is exactly what happens when you
    // tap the screen to wake the phone — both pass the check before either
    // resolves, and the second sentinel overwrites the first. The first lock is
    // then held forever with nothing left pointing at it.
    if (!this.wanted || this.held || this.pending) return;
    if (document.visibilityState !== 'visible') return;
    const api = wakeLockApi();
    if (!api) return;
    this.pending = true;
    try {
      const sentinel = await api.request('screen');
      // `release()` may have been called while this was in flight, in which
      // case nothing wants this lock any more and holding it would keep the
      // screen awake after the game had given up on it.
      if (this.wanted) this.sentinel = sentinel;
      else void sentinel.release().catch(() => {});
    } catch {
      // Refused — unsupported, battery saver, or not user-activated yet. The
      // next press calls arm() again, so a refusal now is not permanent.
      this.sentinel = null;
    } finally {
      this.pending = false;
    }
  }
}
