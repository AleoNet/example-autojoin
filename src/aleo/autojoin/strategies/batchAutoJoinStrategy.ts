import { type JoinStrategy, AutoJoinClient } from "../";
import type {AleoRecord} from "../../aleoClient.ts";

/**
 * Batch strategy for joining records using the typical join_2, join_3, ... join_X transitions
 * supported by custom wrapper programs for Aleo Credits and USDCx/USAD stablecoins. This strategy should also work for
 * most token_registry tokens and the upcoming ARC-20s but these are not yet added to the supported programs list.
 */
export class BatchAutoJoinStrategy implements JoinStrategy {
  private readonly autoJoinClient: AutoJoinClient;
  private readonly supportedPrograms: string[] = [
    "credits.aleo",
    "usdcx_stablecoin.aleo",
    "usad_stablecoin.aleo",
    "test_usdcx_stablecoin.aleo",
    "test_usad_stablecoin.aleo",
  ];
  private readonly supportedBatchPrograms: string[] = [
    "autojoin_credits_2_10.aleo",
    "autojoin_credits_11_14.aleo",
    "autojoin_credits_15_16.aleo",
    "aj_usdcx_stablecoin_2_10.aleo",
    "aj_usdcx_stablecoin_11_14.aleo",
    "aj_usdcx_stablecoin_15_16.aleo",
    "aj_test_usdcx_stablecoin_2_10.aleo",
    "aj_test_usdcx_stablecoin_11_14.aleo",
    "aj_test_usdcx_stablecoin_15_16.aleo",
    "aj_usad_stablecoin_2_10.aleo",
    "aj_usad_stablecoin_11_14.aleo",
    "aj_usad_stablecoin_15_16.aleo",
    "aj_test_usad_stablecoin_2_10.aleo",
    "aj_test_usad_stablecoin_11_14.aleo",
    "aj_test_usad_stablecoin_15_16.aleo"
  ];

  constructor(autoJoinClient: AutoJoinClient) {
    this.autoJoinClient = autoJoinClient;
  }

  isSupportedProgram(programName: string): boolean {
    return this.supportedPrograms.includes(programName.trim().toLowerCase());
  }

  isSupportedBatchProgram(batchProgramName: string): boolean {
    return this.supportedBatchPrograms.includes(batchProgramName.trim().toLowerCase());
  }

  private getBatchProgram(programName: string, batchSize: number): string {
    if (batchSize < 1 || batchSize > 16) {
      throw new Error('Invalid batch size for this token');
    }
    const prefix = programName == 'credits.aleo' ? "" : "aj_";
    const suffix = (batchSize >= 2 && batchSize <= 10) ? "2_10" : ((batchSize >= 11 && batchSize <= 14) ? "11_14" : "15_16");
    const batchProgramName =(() => {
      switch (programName) {
        case "credits.aleo":
          return "autojoin_credits";
        case "usdcx_stablecoin.aleo":
          return "usdcx_stablecoin";
        case "test_usdcx_stablecoin.aleo":
          return "test_usdcx_stablecoin";
        case "usad_stablecoin.aleo":
          return "usad_stablecoin"
        case "test_usad_stablecoin.aleo":
          return "test_usad_stablecoin"
      }
    })(); 
    
    return `${prefix}${batchProgramName}_${suffix}.aleo`;
  }

  async joinRecords(records: AleoRecord[]): Promise<AleoRecord> {
    if (records.length === 0) throw new Error('No records found');
    if (records.length === 1) return records[0];
    let current = records;

    while (current.length > 1) {
      const batches: AleoRecord[][] = [];
      while (current.length > 0) {
        batches.push(current.splice(0, Math.min(current.length, 16)));
      }

      const joinedRecords = await Promise.all(batches.map(async (batch) => {
        const { transactionId, newRecord } = await this.joinN(batch);
        await this.autoJoinClient.aleoClient.waitForTransactionConfirmation(transactionId);
        return newRecord;
      }));

      current = current.concat(joinedRecords);
    }

    return current[0];
  }

private async joinN(records: AleoRecord[]) :Promise<{transactionId: string, newRecord: AleoRecord}> {
    const programManager = await this.autoJoinClient.getProgramManager();
    const provingRequest = await programManager.provingRequest({
      programName: this.getBatchProgram(records[0].programName, records.length),
      functionName: `join_${records.length}`,
      priorityFee: 0,
      privateFee: false,
      inputs: records.map(r => r.plainText.toString()),
      broadcast: true,
    });

    const {transaction, broadcast_result} = await this.autoJoinClient.aleoClient.submitProvingRequest(provingRequest);
    if (broadcast_result?.status !== "Accepted") throw new Error(`Broadcast status not accepted: ${JSON.stringify(broadcast_result)}`);

    const transactionId = transaction?.id;
    if (!transactionId) throw new Error(`Transaction invalid: ${transaction}`);

    const firstOutput = transaction.execution?.transitions?.[records.length-2]?.outputs?.[0];
    if (!firstOutput?.value) throw new Error('No output record in join transaction');

    const newRecord = this.autoJoinClient.aleoClient.recordCipherTextStringToAleoRecord(
      firstOutput.value,
      this.autoJoinClient.account,
      records[0].programName,
      transaction.id.trim(),
    );
    return {transactionId, newRecord};
  }
}