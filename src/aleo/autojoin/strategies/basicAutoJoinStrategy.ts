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


  async joinRecords(records: AleoRecord[], feePrivate: boolean): Promise<AleoRecord[]> {
    if (records.length === 0) throw new Error('No records found');
    if (records.length === 1) return [records[0]];
    let current = records;
    const programManager = await this.autoJoinClient.getProgramManager();

    if (feePrivate) {
      // Determine number of join operations needed and the cost for each operation
      const totalJoinOps = current.length - 1;
      const joinCostInMicrocredits = BigInt(await programManager.estimateExecutionFee({
        programName: records[0].programName,
        functionName: "join",
      }));
      const totalCostInMicrocredits = (joinCostInMicrocredits + 10000n) * BigInt(totalJoinOps);

      // Fetch the list of available Aleo Credits records (if joining USDCx / USAD)
      const creditsRecords = (records[0].programName) === "credits.aleo" ? records : await this.autoJoinClient.aleoClient.fetchUnspentRecords(this.autoJoinClient.account, ["credits.aleo"], this.autoJoinClient.accountAddress);
      // Find a large enough record, split into a master fee record, then split that into the individual fee reocrds      
      const [leftoverCreditsRecords, masterFeeRecord] = await this.autoJoinClient.generateMasterFeeRecord(creditsRecords,totalCostInMicrocredits);
      const [feeRecords, remainder] = await this.autoJoinClient.generateFeeRecords(masterFeeRecord, totalJoinOps, joinCostInMicrocredits);
      if (records[0].programName === "credits.aleo") {
        current = leftoverCreditsRecords;
        current.push(remainder);
      }
      
      while (current.length > 1) {
        // Greedily pair up records with a private fee, potentially leaving the last one unpaired
        const triplets: [AleoRecord, AleoRecord, AleoRecord][] = [];
        for (let i = 0; i + 1 < current.length; i += 2) {
          triplets.push([current[i], current[i + 1], feeRecords.pop()!]);
        }
        const joinedRecords = await Promise.all(triplets.map(async ([a, b, fee]) => {
          const {transactionId, newRecord} = await this.join2(a, b, fee);
          await this.autoJoinClient.aleoClient.waitForTransactionConfirmation(transactionId);
          return newRecord;
        }));

        if (triplets.length * 2 < current.length) {
          current = joinedRecords.concat(current[current.length - 1]);
        } else {
          current = joinedRecords;
        }
      }
      return [current[0]]; 

    } else {
      while (current.length > 1) {
        // Greedily pair up records, potentially leaving the last one unpaired
        const pairs: [AleoRecord, AleoRecord][] = [];
        for (let i = 0; i + 1 < current.length; i += 2) {
          pairs.push([current[i], current[i + 1]]);
        }

        const joinedRecords = await Promise.all(pairs.map(async ([a, b]) => {
          const {transactionId, newRecord} = await this.join2(a, b);
          await this.autoJoinClient.aleoClient.waitForTransactionConfirmation(transactionId);
          return newRecord;
        }));

        if (pairs.length * 2 < current.length) {
          current = joinedRecords.concat(current[current.length - 1]);
        } else {
          current = joinedRecords;
        }
      }
    return [current[0]];
    }
  }

  private async join2(recordA: AleoRecord, recordB: AleoRecord, privateFeeRecord?: AleoRecord): Promise<{transactionId: string, newRecord: AleoRecord}> {
    const programManager = await this.autoJoinClient.getProgramManager();
    const provingRequest = await programManager.provingRequest({
      programName: recordA.programName,
      functionName: 'join',
      priorityFee: 0,
      privateFee: !!privateFeeRecord,
      feeRecord: privateFeeRecord?.plainText,
      inputs: [
        recordA.plainText.toString(),
        recordB.plainText.toString(),
      ],
      broadcast: true,
    });
    const {transaction, broadcast_result} = await this.autoJoinClient.aleoClient.submitProvingRequestWithRetries(provingRequest,3);
    if (broadcast_result?.status !== "Accepted") throw new Error(`Broadcast status not accepted: ${JSON.stringify(broadcast_result)}`);
    
    const transactionId = transaction?.id;
    if (!transactionId) throw new Error(`Transaction invalid: ${transaction}`);
    
    const firstOutput = transaction.execution?.transitions?.[0]?.outputs?.[0];
    if (!firstOutput?.value) throw new Error('No output record in join transaction');

    const newRecord = this.autoJoinClient.aleoClient.recordCipherTextStringToAleoRecord(
      firstOutput.value,
      this.autoJoinClient.account,
      recordA.programName,
      transaction.id.trim(),
    );

    return {transactionId, newRecord};
  }
}
