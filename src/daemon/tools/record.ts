/**
 * v0.11: Recording & export tools.
 *
 *   record start                      — begin recording commands
 *   record stop                       — end recording
 *   record status                     — show recording state + step count
 *   record export --format=pytest|junit5|mocha [--name=N] [--browser=B] [--out=FILE]
 *   record report --format=junit|html [--name=N] [--out=FILE]
 *
 * The recorder state lives in this module (daemon process). `server.ts`
 * calls `recordStep()` after every executed command while recording is on.
 */

import { Response } from '../../response';
import * as fs from 'fs';
import {
  createRecorder,
  startRecording,
  stopRecording,
  addStep,
  renderExport,
  type RecorderState,
  type RecordedStep,
} from '../../recorder';
import { renderReport } from '../../report';

export const recorder: RecorderState = createRecorder();

/** Called by server.ts after each command while recording is enabled. */
export function recordStep(step: Omit<RecordedStep, 'ts'>): void {
  addStep(recorder, step);
}

export async function browser_record_start(
  _driver: any,
  _params: any,
  response: Response,
): Promise<void> {
  if (recorder.recording) {
    throw new Error('Recording is already active. Run `se-cli record stop` first.');
  }
  startRecording(recorder);
  response.addResult('Recording started — commands will be captured for export.');
  response.addCode('// se-cli record: start');
}

export async function browser_record_stop(
  _driver: any,
  _params: any,
  response: Response,
): Promise<void> {
  if (!recorder.recording) {
    throw new Error('Recording is not active. Run `se-cli record start` first.');
  }
  stopRecording(recorder);
  response.addResult(`Recording stopped — ${recorder.steps.length} step(s) captured. Run \`se-cli record export\` to generate a test file.`);
  response.addCode('// se-cli record: stop');
}

export async function browser_record_status(
  _driver: any,
  _params: any,
  response: Response,
): Promise<void> {
  const state = recorder.recording ? 'recording' : 'idle';
  response.addResult(`recording: ${state} · steps: ${recorder.steps.length}`);
}

export async function browser_record_export(
  _driver: any,
  params: { format?: string; name?: string; browser?: string; out?: string },
  response: Response,
): Promise<void> {
  const format = params.format as 'pytest' | 'junit5' | 'mocha' | undefined;
  if (!format || !['pytest', 'junit5', 'mocha'].includes(format)) {
    throw new Error('--format is required: pytest | junit5 | mocha');
  }
  if (recorder.steps.length === 0) {
    throw new Error('No recorded steps. Run `se-cli record start`, execute commands, then `se-cli record stop`.');
  }
  const body = renderExport(format, recorder.steps, {
    name: params.name,
    browser: params.browser,
  });
  if (params.out) {
    try {
      fs.writeFileSync(params.out, body, 'utf8');
    } catch (e: any) {
      throw new Error(`Cannot write export file ${params.out}: ${e.message}`);
    }
    response.addResult(`Exported ${format} test to ${params.out} (${recorder.steps.length} steps).`);
    response.addCode(`// se-cli record export --format=${format} --out=${params.out}`);
  } else {
    response.addResult(body);
    response.addCode(`// se-cli record export --format=${format}`);
  }
}

export async function browser_record_report(
  _driver: any,
  params: { format?: string; name?: string; out?: string },
  response: Response,
): Promise<void> {
  const format = params.format as 'junit' | 'html' | undefined;
  if (!format || !['junit', 'html'].includes(format)) {
    throw new Error('--format is required: junit | html');
  }
  if (recorder.steps.length === 0) {
    throw new Error('No recorded steps to report on.');
  }
  const body = renderReport(format, recorder.steps, { name: params.name });
  if (params.out) {
    try {
      fs.writeFileSync(params.out, body, 'utf8');
    } catch (e: any) {
      throw new Error(`Cannot write report file ${params.out}: ${e.message}`);
    }
    response.addResult(`Report written to ${params.out} (${recorder.steps.length} steps, ${recorder.steps.filter((s) => !s.ok).length} failed).`);
    response.addCode(`// se-cli record report --format=${format} --out=${params.out}`);
  } else {
    response.addResult(body);
    response.addCode(`// se-cli record report --format=${format}`);
  }
}
