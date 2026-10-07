/** Offline seeding only: makes Date report a chosen time so fictional history
 * spans several weeks. Never install in a running server.
 */
export function installVirtualClock(start: number) {
  const Real = globalThis.Date;
  let current = start;
  class VirtualDate extends Real {
    constructor(...args: unknown[]) {
      if (args.length === 0) super(current);
      else super(...(args as [string | number]));
    }
    static override now() {
      return current;
    }
  }
  globalThis.Date = VirtualDate as DateConstructor;
  return {
    set(ms: number) {
      current = ms;
    },
    now: () => current,
    restore() {
      globalThis.Date = Real;
    },
  };
}
export type VirtualClock = ReturnType<typeof installVirtualClock>;
