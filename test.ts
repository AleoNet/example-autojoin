import { AleoKeyProvider, ProgramManager } from "@provablehq/sdk/mainnet.js";

// Initialize a program manager with the key provider to automatically fetch keys for executions.
const keyProvider = new AleoKeyProvider();
keyProvider.useCache(true);
const programManager = new ProgramManager("https://api.provable.com/v2", keyProvider);

// Get the base fee in microcredits.
const baseFeeMicrocredits = await programManager.estimateExecutionFee({
  programName: "credits.aleo",
  functionName: "join",
});
console.log(baseFeeMicrocredits)

// Get the base fee in microcredits.
const baseFeeMicrocredits2 = await programManager.estimateExecutionFee({
  programName: "usdcx_stablecoin.aleo",
  functionName: "join",
});
console.log(baseFeeMicrocredits2)

// Get the base fee in microcredits.
const baseFeeMicrocredits3 = await programManager.estimateExecutionFee({
  programName: "usad_stablecoin.aleo",
  functionName: "join",
});
console.log(baseFeeMicrocredits3.toString() + "u64")
