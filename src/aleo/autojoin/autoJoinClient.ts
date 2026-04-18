import {
  type Account,
  AleoClient,
  type AleoNetwork,
  type AleoRecord,
  type ProgramManager
} from "../aleoClient.ts";
import type {JoinStrategy, JoinStrategyConstructor} from "./joinStrategy.ts";

export class AutoJoinClient {
  readonly aleoClient: AleoClient<AleoNetwork>;
  readonly account: Account;
  readonly accountAddress: string;
  private programManager?: ProgramManager;
  private readonly joinStrategyClass: JoinStrategyConstructor;

  constructor(aleoClient: AleoClient<AleoNetwork>, account: Account, joinStrategyClass: JoinStrategyConstructor) {
    this.aleoClient = aleoClient;
    this.account = account;
    this.accountAddress = account.address().to_string();
    this.joinStrategyClass = joinStrategyClass;
  }

  /** Throws if records are not appropriate for joining. */
  private static validateRecordsForJoining(records: AleoRecord[], joinStrategy: JoinStrategy) {
    if (records.some(r => r.programName !== records[0].programName)) throw new Error('All records must be same program');
    if (! joinStrategy.isSupportedProgram(records[0].programName)) throw new Error('Unsupported program record');
    if (records.some(r => r.ownerAddress !== records[0].ownerAddress)) throw new Error('All records must be owned by same owner');
    if (records.some(r => !r.transactionId)) throw new Error('All records must have a transaction_id');
  }

  async getProgramManager(): Promise<ProgramManager> {
    if (this.programManager) return this.programManager;
    this.programManager = await this.aleoClient.getProgramManagerForAccount(this.account);
    return this.programManager;
  }

  async joinRecords(records: AleoRecord[], feePrivate: boolean): Promise<AleoRecord[]> {
    if (records.length === 0) throw new Error('No records found');
    if (records.length === 1) return [records[0]];
    const joinStrategy = new this.joinStrategyClass(this);
    AutoJoinClient.validateRecordsForJoining(records, joinStrategy);
    return await joinStrategy.joinRecords(records, feePrivate);
  }

  async findMasterFeeRecord(creditsRecords: AleoRecord[], totalCostInMicrocredits: number): Promise<[AleoRecord[],AleoRecord]> {
    const programManager = await this.getProgramManager();
    let masterFeeRecord: AleoRecord | undefined = undefined;

    creditsRecords.sort((r1, r2) => Number(r1.amount) - Number(r2.amount!));
    for (let i: number = 0; i < creditsRecords.length; i++) {
      if (Number(creditsRecords[i].amount) >= totalCostInMicrocredits){
        const provingRequest = await programManager.provingRequest({
          programName: "credits.aleo",
          functionName: 'split',
          priorityFee: 0,
          privateFee: false,
          inputs: [
            creditsRecords[i].plainText.toString(),
            totalCostInMicrocredits.toString() + "u64"
          ],
          broadcast: true,
        });
        const {transaction, broadcast_result} = await this.aleoClient.submitProvingRequestwithRetries(provingRequest,3);
        if (broadcast_result?.status !== "Accepted") throw new Error(`Broadcast status not accepted: ${JSON.stringify(broadcast_result)}`);
        const transactionId = transaction?.id;
        if (!transactionId) throw new Error(`Transaction invalid: ${transaction}`);

        const firstOutput = transaction.execution?.transitions?.[0]?.outputs?.[0];
        if (!firstOutput?.value) throw new Error('No output record 1 in split transaction');
        masterFeeRecord = this.aleoClient.recordCipherTextStringToAleoRecord(
          firstOutput.value,
          this.account,
          "credits.aleo",
          transaction.id.trim(),
        );

        const secondOutput = transaction.execution?.transitions?.[0]?.outputs?.[1];
        if (!secondOutput?.value) throw new Error('No output record 2 in split transaction');
        let leftovers = this.aleoClient.recordCipherTextStringToAleoRecord(
          secondOutput.value,
          this.account,
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
    return [creditsRecords, masterFeeRecord];
  }

  async generateFeeRecords(creditsRecord: AleoRecord, numberOfRecordsNeeded: number, amountPerRecord: number,): Promise<[AleoRecord[],AleoRecord]> {
    let leftovers: AleoRecord = creditsRecord;
    let feeRecords: AleoRecord[] = [];

    const programManager = await this.getProgramManager();
    for (let i: number = 0; i < numberOfRecordsNeeded; i++) {
      const provingRequest = await programManager.provingRequest({
        programName: "credits.aleo",
        functionName: 'split',
        priorityFee: 0,
        privateFee: false,
        inputs: [
          leftovers.plainText.toString(),
          amountPerRecord.toString() + "u64"
        ],
        broadcast: true,
      });
      const {transaction, broadcast_result} = await this.aleoClient.submitProvingRequestwithRetries(provingRequest,3);
      if (broadcast_result?.status !== "Accepted") throw new Error(`Broadcast status not accepted: ${JSON.stringify(broadcast_result)}`);
      const transactionId = transaction?.id;
      if (!transactionId) throw new Error(`Transaction invalid: ${transaction}`);

      const firstOutput = transaction.execution?.transitions?.[0]?.outputs?.[0];
      if (!firstOutput?.value) throw new Error('No output record 1 in split transaction');
      let newFeeRecord = this.aleoClient.recordCipherTextStringToAleoRecord(
        firstOutput.value,
        this.account,
        "credits.aleo",
        transaction.id.trim(),
      );
      feeRecords.push(newFeeRecord);

      const secondOutput = transaction.execution?.transitions?.[0]?.outputs?.[1];
      if (!secondOutput?.value) throw new Error('No output record 2 in split transaction');
      leftovers = this.aleoClient.recordCipherTextStringToAleoRecord(
        secondOutput.value,
        this.account,
        "credits.aleo",
        transaction.id.trim(),
      );
    }

    return [feeRecords,leftovers];
  }


}
