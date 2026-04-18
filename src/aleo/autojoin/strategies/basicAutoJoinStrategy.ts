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
      const total_join_ops = current.length - 1;
      const join_cost_in_microcredits = Number(await programManager.estimateExecutionFee({
        programName: records[0].programName,
        functionName: "join",
      }));
      const total_cost_in_microcredits = (join_cost_in_microcredits + 10000) * total_join_ops;
      let masterFeeRecord: AleoRecord | undefined = undefined;
      let feeRecords: AleoRecord[] = [];

      let creditsRecords = (records[0].programName) === "credits.aleo" ? records : await this.autoJoinClient.aleoClient.fetchUnspentRecords(this.autoJoinClient.account, ["credits.aleo"], this.autoJoinClient.accountAddress);
      creditsRecords.sort((r1, r2) => Number(r1.amount) - Number(r2.amount!));
      for (let i: number = 0; i < creditsRecords.length; i++) {
        if (Number(creditsRecords[i].amount) >= total_cost_in_microcredits){
          const provingRequest = await programManager.provingRequest({
            programName: "credits.aleo",
            functionName: 'split',
            priorityFee: 0,
            privateFee: false,
            inputs: [
              creditsRecords[i].plainText.toString(),
              total_cost_in_microcredits.toString() + "u64"
            ],
            broadcast: true,
          });
          const {transaction, broadcast_result} = await this.autoJoinClient.aleoClient.submitProvingRequestwithRetries(provingRequest,3);
          if (broadcast_result?.status !== "Accepted") throw new Error(`Broadcast status not accepted: ${JSON.stringify(broadcast_result)}`);
          const transactionId = transaction?.id;
          if (!transactionId) throw new Error(`Transaction invalid: ${transaction}`);

          const firstOutput = transaction.execution?.transitions?.[0]?.outputs?.[0];
          if (!firstOutput?.value) throw new Error('No output record 1 in split transaction');
          masterFeeRecord = this.autoJoinClient.aleoClient.recordCipherTextStringToAleoRecord(
            firstOutput.value,
            this.autoJoinClient.account,
            "credits.aleo",
            transaction.id.trim(),
          );

          const secondOutput = transaction.execution?.transitions?.[0]?.outputs?.[1];
          if (!secondOutput?.value) throw new Error('No output record 2 in split transaction');
          let leftovers = this.autoJoinClient.aleoClient.recordCipherTextStringToAleoRecord(
            secondOutput.value,
            this.autoJoinClient.account,
            "credits.aleo",
            transaction.id.trim(),
          );
          creditsRecords.splice(i,1);
          creditsRecords.push(leftovers);
          break;
        }
      }
      if (masterFeeRecord === undefined) {
        throw Error("No records with large enough balance to pay for gas fees.");
      }

      /// Split masterFeeRecord
      for (let i: number = 0; i < total_join_ops; i++) {
        const provingRequest = await programManager.provingRequest({
          programName: "credits.aleo",
          functionName: 'split',
          priorityFee: 0,
          privateFee: false,
          inputs: [
            masterFeeRecord.plainText.toString(),
            join_cost_in_microcredits.toString() + "u64"
          ],
          broadcast: true,
        });
        const {transaction, broadcast_result} = await this.autoJoinClient.aleoClient.submitProvingRequestwithRetries(provingRequest,3);
        if (broadcast_result?.status !== "Accepted") throw new Error(`Broadcast status not accepted: ${JSON.stringify(broadcast_result)}`);
        const transactionId = transaction?.id;
        if (!transactionId) throw new Error(`Transaction invalid: ${transaction}`);

        const firstOutput = transaction.execution?.transitions?.[0]?.outputs?.[0];
        if (!firstOutput?.value) throw new Error('No output record 1 in split transaction');
        let newFeeRecord = this.autoJoinClient.aleoClient.recordCipherTextStringToAleoRecord(
          firstOutput.value,
          this.autoJoinClient.account,
          "credits.aleo",
          transaction.id.trim(),
        );
        feeRecords.push(newFeeRecord);

        const secondOutput = transaction.execution?.transitions?.[0]?.outputs?.[1];
        if (!secondOutput?.value) throw new Error('No output record 2 in split transaction');
        masterFeeRecord = this.autoJoinClient.aleoClient.recordCipherTextStringToAleoRecord(
          secondOutput.value,
          this.autoJoinClient.account,
          "credits.aleo",
          transaction.id.trim(),
        );
      }
      while (current.length > 1) {
        // Pair up records, potentially leaving the last one unpaired
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
        // Pair up records, potentially leaving the last one unpaired
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
      privateFee: (privateFeeRecord ? true : false),
      feeRecord: privateFeeRecord?.plainText,
      inputs: [
        recordA.plainText.toString(),
        recordB.plainText.toString(),
      ],
      broadcast: true,
    });
    const {transaction, broadcast_result} = await this.autoJoinClient.aleoClient.submitProvingRequestwithRetries(provingRequest,3);
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