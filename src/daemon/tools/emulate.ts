import { Response } from '../../response';
import {
  getEmulationState,
  updateEmulationState,
  setEmulationState,
  applyEmulation,
  parseThrottleNetwork,
  describeEmulation,
} from './emulation-state';

/**
 * emulate — runtime network/CPU emulation (v0.8).
 *
 *   se-cli emulate                        show current emulation state
 *   se-cli emulate --offline              go offline
 *   se-cli emulate --throttle-network=slow3g|fast3g|gprs|custom:download=,upload=,latency=
 *   se-cli emulate --throttle-cpu=4       CPU slowdown (4x)
 *   se-cli emulate --reset                restore all emulation (runtime state only)
 *
 * Chrome/Edge only (CDP). Firefox reports a clear error.
 */
export async function browser_emulate(
  driver: any,
  params: {
    offline?: boolean;
    throttleNetwork?: string;
    throttleCpu?: string;
    reset?: boolean;
  },
  response: Response,
): Promise<void> {
  if (params.reset) {
    // Reset ONLY the runtime state (offline/throttle/cpu). Open-time flags
    // (viewport/UA/locale/...) stay in effect.
    const current = getEmulationState();
    setEmulationState({
      ...current,
      offline: undefined,
      throttleNetwork: null,
      throttleCpu: null,
    });
    await applyEmulation(driver);
    response.addResult(`emulation reset — ${describeEmulation()}`);
    response.addCode('// emulate --reset');
    return;
  }

  const patch: any = {};
  let applied = false;

  if (params.offline !== undefined) {
    patch.offline = params.offline;
    applied = true;
  }
  if (params.throttleNetwork !== undefined) {
    patch.throttleNetwork = parseThrottleNetwork(params.throttleNetwork);
    applied = true;
  }
  if (params.throttleCpu !== undefined) {
    const rate = Number(params.throttleCpu);
    if (!Number.isFinite(rate) || rate < 1) {
      throw new Error(`Invalid --throttle-cpu: "${params.throttleCpu}". Expected a number >= 1`);
    }
    patch.throttleCpu = rate;
    applied = true;
  }

  if (!applied) {
    // No flags — just report the current state.
    response.addResult(describeEmulation());
    response.addCode('// emulate (query)');
    return;
  }

  // Firefox has no CDP — network/CPU emulation is unsupported there.
  const caps = await driver.getCapabilities();
  if ((caps.get('browserName') || '') === 'firefox') {
    throw new Error('emulate is not supported on Firefox (CDP unavailable)');
  }

  updateEmulationState(patch);
  await applyEmulation(driver);
  response.addResult(`emulation applied — ${describeEmulation()}`);
  response.addCode('// emulate applied');
}
