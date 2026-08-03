import { Response } from '../../response';
import { findElement } from './shared';
import { buildCandidates, recommendCandidate, type LocatorCandidate } from './locator';

function formatCandidate(c: LocatorCandidate, markRecommended: boolean): string {
  const star = markRecommended ? ' *' : '';
  const name = c.type === 'role' && !c.hasName ? ` (${c.type}, no name${star})` : ` (${c.type}${star})`;
  const match = ` ${c.matchCount} match${c.matchCount === 1 ? '' : 'es'}`;
  return `${c.expression}${name}${match}`;
}

/**
 * generate-locator <ref>
 *
 * Inspection command: reports the recommended locator for an element
 * (role-based by default) plus alternatives, without performing any action.
 *
 *   se-cli generate-locator e7
 *   se-cli generate-locator e7 --all
 *   se-cli generate-locator e7 --style=id
 *   se-cli --raw generate-locator e7
 *   se-cli --json generate-locator e7
 */
export async function browser_generate_locator(
  driver: any,
  params: { target?: string; all?: boolean; style?: string },
  response: Response
): Promise<void> {
  if (!params.target) {
    response.addError('generate-locator requires a ref, e.g. `generate-locator e7`');
    return;
  }
  let candidates: LocatorCandidate[];
  try {
    const el = await findElement(driver, params.target);
    candidates = await buildCandidates(driver, el);
  } catch (e: any) {
    response.addError(`generate-locator failed: ${e.message}`);
    return;
  }

  if (params.style) {
    candidates = candidates.filter((c) => c.type === params.style);
    if (candidates.length === 0) {
      response.addError(
        `No ${params.style} locator could be generated for ${params.target}. ` +
          `Available: ${candidates.map((c) => c.type).join(', ') || 'none'}`,
      );
      return;
    }
  }

  const recommended = recommendCandidate(candidates);

  if (response.options.json) {
    const rows = candidates.map((c) => ({
      type: c.type,
      locator: c.expression,
      matchCount: c.matchCount,
      recommended: !!recommended && c === recommended,
    }));
    response.addResult(JSON.stringify(rows, null, 2));
    return;
  }

  if (response.options.raw) {
    if (recommended) response.addResult(recommended.expression);
    else response.addResult('(no unique locator found — try --all to inspect candidates)');
    return;
  }

  if (params.all) {
    const lines = candidates.map((c) => formatCandidate(c, !!recommended && c === recommended));
    response.addResult(`Locator candidates for ${params.target}:\n${lines.join('\n')}`);
    return;
  }

  if (recommended) {
    const alternatives = candidates
      .filter((c) => c !== recommended)
      .map((c) => formatCandidate(c, false));
    const out = `Recommended: ${recommended.expression}`;
    const alt = alternatives.length > 0 ? `\nAlternatives:\n${alternatives.join('\n')}` : '';
    response.addResult(out + alt);
  } else {
    response.addResult(
      `No unique locator found for ${params.target} — every candidate matches more than one ` +
        `element. Use --all to inspect candidates.`,
    );
  }
}
