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
    const prefix = programName == 'credits.aleo' ? "autojoin" : "aj";
    const suffix = (batchSize >= 2 && batchSize <= 10) ? "2_10" : ((batchSize >= 11 && batchSize <= 14) ? "11_14" : "15_16");
    return `${prefix}_${programName.split(".")[0]}_${suffix}.aleo`;
  }

  async joinRecords(records: AleoRecord[], feePrivate: boolean): Promise<AleoRecord[]> {
    if (records.length === 0) throw new Error('No records found');
    if (records.length === 1) return [records[0]];
    let current = records;

    if (feePrivate) {
      const programManager = await this.autoJoinClient.getProgramManager();
      const totalJoin15Ops = Math.floor((records.length - 1) / 14);
      const finalJoinNFunction = `join_${((records.length - 1) % 14) + 1}`;
      const join15CostInMicrocredits = Number(await programManager.estimateExecutionFee({
        programName: this.getBatchProgram(records[0].programName, 15),
        functionName: `join_15`,
      }));
      const joinNCostInMicrocredits = Number(await programManager.estimateExecutionFee({
        programName: this.getBatchProgram(records[0].programName, ((records.length - 1) % 14)+1),
        functionName: finalJoinNFunction
      }));
      const totalCostInMicrocredits = totalJoin15Ops * (join15CostInMicrocredits + 10000) + joinNCostInMicrocredits;

      let creditsRecords = (records[0].programName) === "credits.aleo" ? records : await this.autoJoinClient.aleoClient.fetchUnspentRecords(this.autoJoinClient.account, ["credits.aleo"], this.autoJoinClient.accountAddress);
      let [leftoverCreditsRecords, masterFeeRecord] = await this.autoJoinClient.generateMasterFeeRecord(creditsRecords,totalCostInMicrocredits);
      let [join15FeeRecords, joinNFeeRecord] = await this.autoJoinClient.generateFeeRecords(masterFeeRecord, totalJoin15Ops, join15CostInMicrocredits);
      if (records[0].programName === "credits.aleo") {
        current = leftoverCreditsRecords;
      }
  
      if (Number(joinNFeeRecord.amount) !== joinNCostInMicrocredits) {
        throw Error("Error with fee calculations");
      }

      const batches: [AleoRecord[],AleoRecord][] = [];
      for (let i: number = 0; i < totalJoin15Ops; i++) {
        batches.push([current.splice(0, 15),join15FeeRecords.pop()!]);
      }

      const intermediateRecords = await Promise.all(batches.map(async ([batch,fee]) => {
        const { transactionId, newRecord } = await this.joinN(batch,fee);
        await this.autoJoinClient.aleoClient.waitForTransactionConfirmation(transactionId);
        return newRecord;
      }));

      current = current.concat(intermediateRecords);

      const { transactionId, newRecord } = await this.joinN(current, joinNFeeRecord);
      await this.autoJoinClient.aleoClient.waitForTransactionConfirmation(transactionId);

      return [newRecord]; 

    } else {
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

      return [current[0]];
    }
  }

  private async joinN(records: AleoRecord[], privateFeeRecord?: AleoRecord) :Promise<{transactionId: string, newRecord: AleoRecord}> {
    const programManager = await this.autoJoinClient.getProgramManager();
    const provingRequest = await programManager.provingRequest({
      programName: this.getBatchProgram(records[0].programName, records.length),
      functionName: `join_${records.length}`,
      priorityFee: 0,
      privateFee: (privateFeeRecord ? true : false),
      feeRecord: privateFeeRecord?.plainText,
      inputs: records.map(r => r.plainText.toString()),
      broadcast: true,
    });

    const {transaction, broadcast_result} = await this.autoJoinClient.aleoClient.submitProvingRequestwithRetries(provingRequest,3);
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