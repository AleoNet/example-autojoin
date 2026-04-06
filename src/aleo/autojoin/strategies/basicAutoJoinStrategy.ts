import { type JoinStrategy, AutoJoinClient } from "../";
import type {AleoRecord} from "../../aleoClient.ts";

/**
 * Simple strategy for joining records using the typical join(recordA, recordB) transition
 * supported by credits and USDCx/USAD stablecoins. This strategy should also work for
 * most token_registry tokens and the upcoming ARC-20s but these are not yet added to the
 * supported programs list.
 */
export class BasicAutoJoinStrategy implements JoinStrategy {
  private readonly autoJoinClient: AutoJoinClient;
  private readonly supportedPrograms: string[] = [
    "credits.aleo",
    "usdcx_stablecoin.aleo",
    "usad_stablecoin.aleo",
    "test_usdcx_stablecoin.aleo",
    "test_usad_stablecoin.aleo",
  ];

  constructor(autoJoinClient: AutoJoinClient) {
    this.autoJoinClient = autoJoinClient;
  }

  isSupportedProgram(programName: string): boolean {
    return this.supportedPrograms.includes(programName.trim().toLowerCase());
  }

  async joinRecords(records: AleoRecord[]): Promise<AleoRecord> {
    if (records.length === 0) throw new Error('No records found');
    if (records.length === 1) return records[0];
    let current = records;

    while (current.length > 1) {
      // Pair up records, potentially leaving the last one unpaired
      const pairs: [AleoRecord, AleoRecord][] = [];
      for (let i = 0; i + 1 < current.length; i += 2) {
        pairs.push([current[i], current[i + 1]]);
      }

      const joinRecords = await Promise.all(pairs.map(async ([a, b]) => {
        const {transactionId, newRecord} = await this.join2(a, b);
        await this.autoJoinClient.aleoClient.waitForTransactionConfirmation(transactionId);
        return newRecord;
      }));

      if (pairs.length * 2 < current.length) {
        current = joinRecords.concat(current[current.length - 1]);
      } else {
        current = joinRecords;
      }
    }

    return current[0];
  }

  private async join2(recordA: AleoRecord, recordB: AleoRecord): Promise<{transactionId: string, newRecord: AleoRecord}> {
    const autoJoinClient = this.autoJoinClient!;
    const programManager = await autoJoinClient.getProgramManager();
    const provingRequest = await programManager.provingRequest({
      programName: recordA.programName,
      functionName: 'join',
      priorityFee: 0,
      privateFee: false,
      inputs: [
        recordA.plainText.toString(),
        recordB.plainText.toString(),
      ],
      broadcast: true,
    });
    const {transaction, broadcast_result} = await autoJoinClient.aleoClient.submitProvingRequest(provingRequest);
    if (broadcast_result?.status !== "Accepted") throw new Error(`Broadcast status not accepted: ${broadcast_result}`);
    const transactionId = transaction?.id;
    if (!transactionId) throw new Error(`Transaction invalid: ${transaction}`);
    const firstTransition = transaction.execution?.transitions[0];
    const firstOutput = firstTransition?.outputs![0];
    const newRecord = autoJoinClient.aleoClient.recordCipherTextStringToAleoRecord(
      firstOutput!.value!,
      autoJoinClient.account,
      recordA.programName,
      transaction.id.trim(),
    );
    return {transactionId, newRecord};
  }
}