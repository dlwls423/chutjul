import { register } from 'node:module';
import { sensitiveCases, safeCases, gapCases } from './fixtures/privacy-cases.mjs';

register('./helpers/typescript-loader.mjs', import.meta.url);
// Text regression must never call an external service or require Secrets.
globalThis.fetch = async () => { throw new Error('NETWORK_FORBIDDEN_IN_PRIVACY_REGRESSION'); };
const { maskSensitiveText, maskAnswerAttribution, redactionRanges } = await import('../lib/browser-privacy.ts');
const { maskPersonalInfo, maskAnswerAttribution: maskServerAttribution } = await import('../lib/ingestion.ts');
const { detectResidualSensitiveInfo } = await import('../lib/privacy-check.ts');
const { editableTextToSummary, summaryText } = await import('../lib/local-draft.ts');

let checks = 0;
let failures = 0;
function check(ok, id, stage) {
  checks++;
  if (!ok) {
    failures++;
    // Print IDs only: no source text, detected values, or outbound payloads.
    console.error(`FAIL ${id}: ${stage}`);
  }
}

for (const sample of sensitiveCases) {
  const masked = maskSensitiveText(sample.text);
  check(sample.privateValues.every(value => !masked.value.includes(value)), sample.id, 'mask');
  check(Object.values(masked.counts).some(count => count > 0), sample.id, 'count');
  check(detectResidualSensitiveInfo(sample.text).some(finding => finding.type === sample.type), sample.id, 'raw-detection');
  check(detectResidualSensitiveInfo(masked.value).length === 0, sample.id, 'residual');
  check(maskSensitiveText(masked.value).value === masked.value, sample.id, 'idempotence');
  check(sample.privateValues.every(value => !maskPersonalInfo(sample.text).masked.includes(value)), sample.id, 'ingestion-mask');
  const ranges = redactionRanges(sample.text);
  check(sample.privateValues.every(value => {
    const start = sample.text.indexOf(value);
    return ranges.some(range => range.start <= start && range.end >= start + value.length);
  }), sample.id, 'pdf-range');
}
for (const sample of safeCases) {
  check(maskSensitiveText(sample.text).value === sample.text, sample.id, 'overmasking');
  check(detectResidualSensitiveInfo(sample.text).length === 0, sample.id, 'false-positive');
  check(maskPersonalInfo(sample.text).masked === sample.text, sample.id, 'ingestion-overmasking');
  // Existing placeholders may be covered again in image PDFs; legal prose must not be.
  if (sample.id !== 'placeholders') check(redactionRanges(sample.text).length === 0, sample.id, 'pdf-overmasking');
}

const legalQuestion = safeCases.find(sample => sample.id === 'legal-article').text;
const complaint = legalQuestion + '\n' + sensitiveCases.map(sample => sample.text).join('\n');
const summary = summaryText(editableTextToSummary(complaint));
check(sensitiveCases.every(sample => sample.privateValues.every(value => !summary.includes(value))), 'combined-complaint', 'summary-leak');
check(detectResidualSensitiveInfo(summary).length === 0, 'combined-complaint', 'summary-residual');
check(summary.includes('제35조의2'), 'combined-complaint', 'legal-context');

const attribution = maskAnswerAttribution(`${legalQuestion}\n김가상 주무관(02-000-1234)`);
check(!attribution.value.includes('김가상') && !attribution.value.includes('02-000-1234'), 'answer-attribution', 'mask');
check(attribution.value.includes(legalQuestion), 'answer-attribution', 'legal-context');
for (const phone of ['02-000-1234', '+82 10 0000 1234', '+82 (0)10 0000 1234']) {
  const text = `${legalQuestion}\n김가상 주무관(${phone})`;
  check(!maskAnswerAttribution(text).value.includes(phone), 'international-attribution', 'browser');
  check(!maskServerAttribution(text).masked.includes(phone), 'international-attribution', 'server');
}

let gaps = 0;
for (const sample of gapCases) {
  const masked = maskSensitiveText(sample.text).value;
  const ok = sample.safe
    ? masked === sample.text && detectResidualSensitiveInfo(sample.text).length === 0 && redactionRanges(sample.text).length === 0 && maskPersonalInfo(sample.text).masked === sample.text
    : sample.privateValues.every(value => !masked.includes(value)) && detectResidualSensitiveInfo(sample.text).some(finding => finding.type === sample.type) && sample.privateValues.every(value => !maskPersonalInfo(sample.text).masked.includes(value));
  if (!ok) { gaps++; console.error(`GAP ${sample.id}`); }
}
console.log(`privacy regression: ${checks - failures}/${checks} checks passed; ${gaps}/${gapCases.length} exploratory gaps`);
if (failures || (gaps && process.argv.includes('--strict-gaps'))) process.exitCode = 1;
