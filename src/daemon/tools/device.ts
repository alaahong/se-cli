import { Response } from '../../response';
import { DEVICE_PRESETS, findDevice, type DevicePreset } from '../../devices';
import { setEmulationState, getEmulationState, applyEmulation, describeEmulation } from './emulation-state';

/**
 * device <name> — apply a device preset (viewport + UA + scale + touch).
 * device-list — list all built-in presets.
 */
export async function browser_device(
  driver: any,
  params: { name?: string },
  response: Response,
): Promise<void> {
  const name = params.name?.trim();
  if (!name) {
    response.addResult(describeEmulation());
    response.addCode(`// emulation state: ${describeEmulation()}`);
    return;
  }

  const preset = findDevice(name);
  if (!preset) {
    response.addError(`Unknown device: "${name}". Run "se-cli device-list" for available presets.`);
    return;
  }

  await applyDevicePreset(driver, preset);
  response.addResult(`device "${preset.name}" applied (${preset.viewport.width}x${preset.viewport.height}@${preset.deviceScaleFactor}x${preset.isMobile ? ', mobile' : ''}${preset.hasTouch ? ', touch' : ''})`);
  response.addCode([
    `// device: ${preset.name}`,
    `await driver.manage().window().setRect({ width: ${preset.viewport.width}, height: ${preset.viewport.height} });`,
    preset.colorScheme ? `// colorScheme: ${preset.colorScheme}` : '',
  ].filter(Boolean).join('\n'));
}

export async function browser_device_list(
  driver: any,
  params: any,
  response: Response,
): Promise<void> {
  const lines = DEVICE_PRESETS.map(p =>
    `${p.name.padEnd(14)} ${p.viewport.width}x${p.viewport.height}@${p.deviceScaleFactor}x mobile=${p.isMobile ? 'yes' : 'no'} touch=${p.hasTouch ? 'yes' : 'no'}`
  );
  response.addResult(lines.join('\n'));
  response.addCode('// device-list');
}

/**
 * Apply a preset's viewport/UA to the emulation state and the live driver.
 * Chrome/Edge get the full CDP treatment; Firefox only the viewport (BiDi).
 */
export async function applyDevicePreset(driver: any, preset: DevicePreset): Promise<void> {
  const current = getEmulationState();
  setEmulationState({
    ...current,
    viewport: {
      width: preset.viewport.width,
      height: preset.viewport.height,
      deviceScaleFactor: preset.deviceScaleFactor,
      mobile: preset.isMobile,
      hasTouch: preset.hasTouch,
    },
    userAgent: preset.userAgent,
    colorScheme: preset.colorScheme,
  });
  await applyEmulation(driver);
}
