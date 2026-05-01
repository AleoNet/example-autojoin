import { ProgramManager, AleoKeyProvider } from '@provablehq/sdk/mainnet.js';

const HOST = 'https://api.provable.com/v2';

const tokens = [
  { label: 'Aleo Credits',  base: 'credits.aleo',          wrapperPrefix: 'autojoin_credits' },
  { label: 'USDCx',         base: 'usdcx_stablecoin.aleo', wrapperPrefix: 'aj_usdcx_stablecoin' },
  { label: 'USAD',          base: 'usad_stablecoin.aleo',  wrapperPrefix: 'aj_usad_stablecoin' },
];

function wrapperFor(prefix, n) {
  if (n >= 2 && n <= 10) return `${prefix}_2_10.aleo`;
  if (n >= 11 && n <= 14) return `${prefix}_11_14.aleo`;
  if (n >= 15 && n <= 16) return `${prefix}_15_16.aleo`;
  throw new Error(`No wrapper for n=${n}`);
}

const keyProvider = new AleoKeyProvider();
keyProvider.useCache(true);
const pm = new ProgramManager(HOST, keyProvider);

async function estimate(programName, functionName) {
  try {
    const fee = await pm.estimateExecutionFee({ programName, functionName });
    return { ok: true, fee: BigInt(fee) };
  } catch (e) {
    return { ok: false, error: e?.message ?? String(e) };
  }
}

function fmt(uALEO) {
  const credits = Number(uALEO) / 1_000_000;
  return `${uALEO.toString().padStart(10)} μALEO  (${credits.toFixed(6)} ALEO)`;
}

const results = {};

for (const { label, base, wrapperPrefix } of tokens) {
  results[label] = [];

  // bare `join` lives on the base program
  const baseRes = await estimate(base, 'join');
  results[label].push({ program: base, fn: 'join', ...baseRes });

  for (let n = 2; n <= 16; n++) {
    const program = wrapperFor(wrapperPrefix, n);
    const fn = `join_${n}`;
    const res = await estimate(program, fn);
    results[label].push({ program, fn, ...res });
  }
}

for (const [label, rows] of Object.entries(results)) {
  console.log(`\n=== ${label} ===`);
  for (const r of rows) {
    const left = `${r.program}/${r.fn}`.padEnd(46);
    if (r.ok) {
      console.log(`${left}  ${fmt(r.fee)}`);
    } else {
      console.log(`${left}  ERROR: ${r.error}`);
    }
  }
}
