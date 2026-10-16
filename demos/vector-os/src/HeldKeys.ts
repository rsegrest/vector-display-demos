import type { KeyPress } from "./apps/OsApp.js";

export interface HeldKey<Recipient> {
  // The press as it went down, which is also what is sent when it comes up: a key
  // pressed as "a" comes up as "a" even if Shift went down in between.
  readonly press: KeyPress;
  readonly recipient: Recipient;
  // Whether the recipient used it, so its repeats are kept from the browser too.
  readonly used: boolean;
}

// The keys that are down, and which program each went down to.
//
// A game reads a key as held from its press until its release, so a release
// must never go astray: if it went to whatever window is in front by then, a
// key held while clicking another window would stay held in the first for
// good, and a ship would thrust for ever. So each key is remembered with the
// program it went to; its release goes there, and when a window leaves the
// front the OS lets go of every key it holds.
//
// Keys are known by `code`, the key itself, since what it types can change
// while it is held (Shift goes down, and "a" comes up as "A").
export class HeldKeys<Recipient> {
  private readonly held = new Map<string, HeldKey<Recipient>>();

  public get count(): number {
    return this.held.size;
  }

  // The key, if it is already down: a repeat, or a second press after the browser lost a release.
  public find(press: KeyPress): HeldKey<Recipient> | undefined {
    return this.held.get(identify(press));
  }

  public press(press: KeyPress, recipient: Recipient, used: boolean): void {
    this.held.set(identify(press), { press, recipient, used });
  }

  // The key coming up: the press it ends and where that went, or null if it was not
  // held (its window let go of it when it left the front).
  public release(press: KeyPress): HeldKey<Recipient> | null {
    const key = identify(press);
    const held = this.held.get(key) ?? null;
    this.held.delete(key);
    return held;
  }

  // Lets go of every key held by one recipient, or by all of them, and returns
  // them so each can be sent its release.
  public releaseAll(recipient?: Recipient): HeldKey<Recipient>[] {
    const released: HeldKey<Recipient>[] = [];
    for (const [key, held] of this.held) {
      if (recipient !== undefined && held.recipient !== recipient) continue;
      this.held.delete(key);
      released.push(held);
    }
    return released;
  }
}

// A press synthesised without a code (by a test, say) is known by what it types.
function identify(press: KeyPress): string {
  return press.code || `key:${press.key}`;
}
