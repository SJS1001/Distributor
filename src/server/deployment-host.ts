import type {
  RestoreHostContext,
  RestoreRuntimeConfiguration,
} from "./runtime-host.ts";

/** Replace this static composition in a reviewed deployment change when the
 * real host/authority implementation is available. Never import code selected
 * by an environment variable, command, evidence file or stored record.
 * No adapter, trust authority or provider qualification is fabricated here. */
export function configuredRestoreHost(
  _context: RestoreHostContext,
): RestoreRuntimeConfiguration | undefined {
  return undefined;
}
