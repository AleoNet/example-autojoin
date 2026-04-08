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
    switch (programName) {
        case "credits.aleo":
          if ((batchSize >= 2) && (batchSize <= 10)) {
            return "autojoin_credits_2_10.aleo";
          } else if ((batchSize >= 11) && (batchSize <= 14)) {
            return "autojoin_credits_11_14.aleo";
          } else if (batchSize == 15 || batchSize == 16) {
            return "autojoin_credits_15_16.aleo";
          } else {
            throw new Error('Invalid batch size for this token');
          }
        case "usdcx_stablecoin.aleo":
          if ((batchSize >= 2) && (batchSize <= 10)) {
            return "aj_usdcx_stablecoin_2_10.aleo";
          } else if ((batchSize >= 11) && (batchSize <= 14)) {
            return "aj_usdcx_stablecoin_11_14.aleo";
          } else if (batchSize == 15 || batchSize == 16) {
            return "aj_usdcx_stablecoin_15_16.aleo";
          } else {
            throw new Error('Invalid batch size for this token');
          }
        case "test_usdcx_stablecoin.aleo":
          if ((batchSize >= 2) && (batchSize <= 10)) {
            return "aj_test_usdcx_stablecoin_2_10.aleo";
          } else if ((batchSize >= 11) && (batchSize <= 14)) {
            return "aj_test_usdcx_stablecoin_11_14.aleo";
          } else if (batchSize == 15 || batchSize == 16) {
            return "aj_test_usdcx_stablecoin_15_16.aleo";
          } else {
            throw new Error('Invalid batch size for this token');
          }
        case "usad_stablecoin.aleo":
          if ((batchSize >= 2) && (batchSize <= 10)) {
            return "aj_usad_stablecoin_2_10.aleo";
          } else if ((batchSize >= 11) && (batchSize <= 14)) {
            return "aj_usad_stablecoin_11_14.aleo";
          } else if (batchSize == 15 || batchSize == 16) {
            return "aj_usad_stablecoin_15_16.aleo";
          } else {
            throw new Error('Invalid batch size for this token');
          }
        case "test_usad_stablecoin.aleo":
          if ((batchSize >= 2) && (batchSize <= 10)) {
            return "aj_test_usad_stablecoin_2_10.aleo";
          } else if ((batchSize >= 11) && (batchSize <= 14)) {
            return "aj_test_usad_stablecoin_11_14.aleo";
          } else if (batchSize == 15 || batchSize == 16) {
            return "aj_test_usad_stablecoin_15_16.aleo";
          } else {
            throw new Error('Invalid batch size for this token');
          }
        default:
          throw new Error('Invalid program name');
    }
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
        const { transactionId, newRecord } = await this.joinBatch(batch);
        await this.autoJoinClient.aleoClient.waitForTransactionConfirmation(transactionId);
        return newRecord;
      }));

      current = current.concat(joinedRecords);
    }

    return current[0];
  }

  private joinBatch(records: AleoRecord[]): Promise<{transactionId: string, newRecord: AleoRecord}> {
    switch (records.length) {
      case 2:  return this.join2(records[0], records[1]);
      case 3:  return this.join3(records[0], records[1], records[2]);
      case 4:  return this.join4(records[0], records[1], records[2], records[3]);
      case 5:  return this.join5(records[0], records[1], records[2], records[3], records[4]);
      case 6:  return this.join6(records[0], records[1], records[2], records[3], records[4], records[5]);
      case 7:  return this.join7(records[0], records[1], records[2], records[3], records[4], records[5], records[6]);
      case 8:  return this.join8(records[0], records[1], records[2], records[3], records[4], records[5], records[6], records[7]);
      case 9:  return this.join9(records[0], records[1], records[2], records[3], records[4], records[5], records[6], records[7], records[8]);
      case 10: return this.join10(records[0], records[1], records[2], records[3], records[4], records[5], records[6], records[7], records[8], records[9]);
      case 11: return this.join11(records[0], records[1], records[2], records[3], records[4], records[5], records[6], records[7], records[8], records[9], records[10]);
      case 12: return this.join12(records[0], records[1], records[2], records[3], records[4], records[5], records[6], records[7], records[8], records[9], records[10], records[11]);
      case 13: return this.join13(records[0], records[1], records[2], records[3], records[4], records[5], records[6], records[7], records[8], records[9], records[10], records[11], records[12]);
      case 14: return this.join14(records[0], records[1], records[2], records[3], records[4], records[5], records[6], records[7], records[8], records[9], records[10], records[11], records[12], records[13]);
      case 15: return this.join15(records[0], records[1], records[2], records[3], records[4], records[5], records[6], records[7], records[8], records[9], records[10], records[11], records[12], records[13], records[14]);
      case 16: return this.join16(records[0], records[1], records[2], records[3], records[4], records[5], records[6], records[7], records[8], records[9], records[10], records[11], records[12], records[13], records[14], records[15]);
      default: throw new Error(`Unsupported batch size: ${records.length}`);
    }
  }

private async join2(
  record1: AleoRecord, 
  record2: AleoRecord
): Promise<{transactionId: string, newRecord: AleoRecord}> {
    const programManager = await this.autoJoinClient.getProgramManager();
    const provingRequest = await programManager.provingRequest({
      programName: this.getBatchProgram(record1.programName,2),
      functionName: 'join_2',
      priorityFee: 0,
      privateFee: false,
      inputs: [
        record1.plainText.toString(),
        record2.plainText.toString(),
      ],
      broadcast: true,
    });
    const {transaction, broadcast_result} = await this.autoJoinClient.aleoClient.submitProvingRequest(provingRequest);
    if (broadcast_result?.status !== "Accepted") throw new Error(`Broadcast status not accepted: ${JSON.stringify(broadcast_result)}`);

    const transactionId = transaction?.id;
    if (!transactionId) throw new Error(`Transaction invalid: ${transaction}`);

    const firstOutput = transaction.execution?.transitions?.[0]?.outputs?.[0];
    if (!firstOutput?.value) throw new Error('No output record in join transaction');

    const newRecord = this.autoJoinClient.aleoClient.recordCipherTextStringToAleoRecord(
      firstOutput.value,
      this.autoJoinClient.account,
      record1.programName,
      transaction.id.trim(),
    );
    return {transactionId, newRecord};
  }

  private async join3(
    record1: AleoRecord,
    record2: AleoRecord,
    record3: AleoRecord,
  ): Promise<{transactionId: string, newRecord: AleoRecord}> {
    const programManager = await this.autoJoinClient.getProgramManager();
    const provingRequest = await programManager.provingRequest({
      programName: this.getBatchProgram(record1.programName, 3),
      functionName: 'join_3',
      priorityFee: 0,
      privateFee: false,
      inputs: [
        record1.plainText.toString(),
        record2.plainText.toString(),
        record3.plainText.toString(),
      ],
      broadcast: true,
    });
    const {transaction, broadcast_result} = await this.autoJoinClient.aleoClient.submitProvingRequest(provingRequest);
    if (broadcast_result?.status !== "Accepted") throw new Error(`Broadcast status not accepted: ${JSON.stringify(broadcast_result)}`);

    const transactionId = transaction?.id;
    if (!transactionId) throw new Error(`Transaction invalid: ${transaction}`);

    const firstOutput = transaction.execution?.transitions?.[1]?.outputs?.[0];
    if (!firstOutput?.value) throw new Error('No output record in join transaction');

    const newRecord = this.autoJoinClient.aleoClient.recordCipherTextStringToAleoRecord(
      firstOutput.value,
      this.autoJoinClient.account,
      record1.programName,
      transaction.id.trim(),
    );
    return {transactionId, newRecord};
  }

  private async join4(
    record1: AleoRecord,
    record2: AleoRecord,
    record3: AleoRecord,
    record4: AleoRecord,
  ): Promise<{transactionId: string, newRecord: AleoRecord}> {
    const programManager = await this.autoJoinClient.getProgramManager();
    const provingRequest = await programManager.provingRequest({
      programName: this.getBatchProgram(record1.programName, 4),
      functionName: 'join_4',
      priorityFee: 0,
      privateFee: false,
      inputs: [
        record1.plainText.toString(),
        record2.plainText.toString(),
        record3.plainText.toString(),
        record4.plainText.toString(),
      ],
      broadcast: true,
    });
    const {transaction, broadcast_result} = await this.autoJoinClient.aleoClient.submitProvingRequest(provingRequest);
    if (broadcast_result?.status !== "Accepted") throw new Error(`Broadcast status not accepted: ${JSON.stringify(broadcast_result)}`);

    const transactionId = transaction?.id;
    if (!transactionId) throw new Error(`Transaction invalid: ${transaction}`);

    const firstOutput = transaction.execution?.transitions?.[2]?.outputs?.[0];
    if (!firstOutput?.value) throw new Error('No output record in join transaction');

    const newRecord = this.autoJoinClient.aleoClient.recordCipherTextStringToAleoRecord(
      firstOutput.value,
      this.autoJoinClient.account,
      record1.programName,
      transaction.id.trim(),
    );
    return {transactionId, newRecord};
  }

  private async join5(
    record1: AleoRecord,
    record2: AleoRecord,
    record3: AleoRecord,
    record4: AleoRecord,
    record5: AleoRecord,
  ): Promise<{transactionId: string, newRecord: AleoRecord}> {
    const programManager = await this.autoJoinClient.getProgramManager();
    const provingRequest = await programManager.provingRequest({
      programName: this.getBatchProgram(record1.programName, 5),
      functionName: 'join_5',
      priorityFee: 0,
      privateFee: false,
      inputs: [
        record1.plainText.toString(),
        record2.plainText.toString(),
        record3.plainText.toString(),
        record4.plainText.toString(),
        record5.plainText.toString(),
      ],
      broadcast: true,
    });
    const {transaction, broadcast_result} = await this.autoJoinClient.aleoClient.submitProvingRequest(provingRequest);
    if (broadcast_result?.status !== "Accepted") throw new Error(`Broadcast status not accepted: ${JSON.stringify(broadcast_result)}`);

    const transactionId = transaction?.id;
    if (!transactionId) throw new Error(`Transaction invalid: ${transaction}`);

    const firstOutput = transaction.execution?.transitions?.[3]?.outputs?.[0];
    if (!firstOutput?.value) throw new Error('No output record in join transaction');

    const newRecord = this.autoJoinClient.aleoClient.recordCipherTextStringToAleoRecord(
      firstOutput.value,
      this.autoJoinClient.account,
      record1.programName,
      transaction.id.trim(),
    );
    return {transactionId, newRecord};
  }

  private async join6(
    record1: AleoRecord,
    record2: AleoRecord,
    record3: AleoRecord,
    record4: AleoRecord,
    record5: AleoRecord,
    record6: AleoRecord,
  ): Promise<{transactionId: string, newRecord: AleoRecord}> {
    const programManager = await this.autoJoinClient.getProgramManager();
    const provingRequest = await programManager.provingRequest({
      programName: this.getBatchProgram(record1.programName, 6),
      functionName: 'join_6',
      priorityFee: 0,
      privateFee: false,
      inputs: [
        record1.plainText.toString(),
        record2.plainText.toString(),
        record3.plainText.toString(),
        record4.plainText.toString(),
        record5.plainText.toString(),
        record6.plainText.toString(),
      ],
      broadcast: true,
    });
    const {transaction, broadcast_result} = await this.autoJoinClient.aleoClient.submitProvingRequest(provingRequest);
    if (broadcast_result?.status !== "Accepted") throw new Error(`Broadcast status not accepted: ${JSON.stringify(broadcast_result)}`);

    const transactionId = transaction?.id;
    if (!transactionId) throw new Error(`Transaction invalid: ${transaction}`);

    const firstOutput = transaction.execution?.transitions?.[4]?.outputs?.[0];
    if (!firstOutput?.value) throw new Error('No output record in join transaction');

    const newRecord = this.autoJoinClient.aleoClient.recordCipherTextStringToAleoRecord(
      firstOutput.value,
      this.autoJoinClient.account,
      record1.programName,
      transaction.id.trim(),
    );
    return {transactionId, newRecord};
  }

  private async join7(
    record1: AleoRecord,
    record2: AleoRecord,
    record3: AleoRecord,
    record4: AleoRecord,
    record5: AleoRecord,
    record6: AleoRecord,
    record7: AleoRecord,
  ): Promise<{transactionId: string, newRecord: AleoRecord}> {
    const programManager = await this.autoJoinClient.getProgramManager();
    const provingRequest = await programManager.provingRequest({
      programName: this.getBatchProgram(record1.programName, 7),
      functionName: 'join_7',
      priorityFee: 0,
      privateFee: false,
      inputs: [
        record1.plainText.toString(),
        record2.plainText.toString(),
        record3.plainText.toString(),
        record4.plainText.toString(),
        record5.plainText.toString(),
        record6.plainText.toString(),
        record7.plainText.toString(),
      ],
      broadcast: true,
    });
    const {transaction, broadcast_result} = await this.autoJoinClient.aleoClient.submitProvingRequest(provingRequest);
    if (broadcast_result?.status !== "Accepted") throw new Error(`Broadcast status not accepted: ${JSON.stringify(broadcast_result)}`);

    const transactionId = transaction?.id;
    if (!transactionId) throw new Error(`Transaction invalid: ${transaction}`);

    const firstOutput = transaction.execution?.transitions?.[5]?.outputs?.[0];
    if (!firstOutput?.value) throw new Error('No output record in join transaction');

    const newRecord = this.autoJoinClient.aleoClient.recordCipherTextStringToAleoRecord(
      firstOutput.value,
      this.autoJoinClient.account,
      record1.programName,
      transaction.id.trim(),
    );
    return {transactionId, newRecord};
  }

  private async join8(
    record1: AleoRecord,
    record2: AleoRecord,
    record3: AleoRecord,
    record4: AleoRecord,
    record5: AleoRecord,
    record6: AleoRecord,
    record7: AleoRecord,
    record8: AleoRecord,
  ): Promise<{transactionId: string, newRecord: AleoRecord}> {
    const programManager = await this.autoJoinClient.getProgramManager();
    const provingRequest = await programManager.provingRequest({
      programName: this.getBatchProgram(record1.programName, 8),
      functionName: 'join_8',
      priorityFee: 0,
      privateFee: false,
      inputs: [
        record1.plainText.toString(),
        record2.plainText.toString(),
        record3.plainText.toString(),
        record4.plainText.toString(),
        record5.plainText.toString(),
        record6.plainText.toString(),
        record7.plainText.toString(),
        record8.plainText.toString(),
      ],
      broadcast: true,
    });
    const {transaction, broadcast_result} = await this.autoJoinClient.aleoClient.submitProvingRequest(provingRequest);
    if (broadcast_result?.status !== "Accepted") throw new Error(`Broadcast status not accepted: ${JSON.stringify(broadcast_result)}`);

    const transactionId = transaction?.id;
    if (!transactionId) throw new Error(`Transaction invalid: ${transaction}`);

    const firstOutput = transaction.execution?.transitions?.[6]?.outputs?.[0];
    if (!firstOutput?.value) throw new Error('No output record in join transaction');

    const newRecord = this.autoJoinClient.aleoClient.recordCipherTextStringToAleoRecord(
      firstOutput.value,
      this.autoJoinClient.account,
      record1.programName,
      transaction.id.trim(),
    );
    return {transactionId, newRecord};
  }

  private async join9(
    record1: AleoRecord,
    record2: AleoRecord,
    record3: AleoRecord,
    record4: AleoRecord,
    record5: AleoRecord,
    record6: AleoRecord,
    record7: AleoRecord,
    record8: AleoRecord,
    record9: AleoRecord,
  ): Promise<{transactionId: string, newRecord: AleoRecord}> {
    const programManager = await this.autoJoinClient.getProgramManager();
    const provingRequest = await programManager.provingRequest({
      programName: this.getBatchProgram(record1.programName, 9),
      functionName: 'join_9',
      priorityFee: 0,
      privateFee: false,
      inputs: [
        record1.plainText.toString(),
        record2.plainText.toString(),
        record3.plainText.toString(),
        record4.plainText.toString(),
        record5.plainText.toString(),
        record6.plainText.toString(),
        record7.plainText.toString(),
        record8.plainText.toString(),
        record9.plainText.toString(),
      ],
      broadcast: true,
    });
    const {transaction, broadcast_result} = await this.autoJoinClient.aleoClient.submitProvingRequest(provingRequest);
    if (broadcast_result?.status !== "Accepted") throw new Error(`Broadcast status not accepted: ${JSON.stringify(broadcast_result)}`);

    const transactionId = transaction?.id;
    if (!transactionId) throw new Error(`Transaction invalid: ${transaction}`);

    const firstOutput = transaction.execution?.transitions?.[7]?.outputs?.[0];
    if (!firstOutput?.value) throw new Error('No output record in join transaction');

    const newRecord = this.autoJoinClient.aleoClient.recordCipherTextStringToAleoRecord(
      firstOutput.value,
      this.autoJoinClient.account,
      record1.programName,
      transaction.id.trim(),
    );
    return {transactionId, newRecord};
  }

  private async join10(
    record1: AleoRecord,
    record2: AleoRecord,
    record3: AleoRecord,
    record4: AleoRecord,
    record5: AleoRecord,
    record6: AleoRecord,
    record7: AleoRecord,
    record8: AleoRecord,
    record9: AleoRecord,
    record10: AleoRecord,
  ): Promise<{transactionId: string, newRecord: AleoRecord}> {
    const programManager = await this.autoJoinClient.getProgramManager();
    const provingRequest = await programManager.provingRequest({
      programName: this.getBatchProgram(record1.programName, 10),
      functionName: 'join_10',
      priorityFee: 0,
      privateFee: false,
      inputs: [
        record1.plainText.toString(),
        record2.plainText.toString(),
        record3.plainText.toString(),
        record4.plainText.toString(),
        record5.plainText.toString(),
        record6.plainText.toString(),
        record7.plainText.toString(),
        record8.plainText.toString(),
        record9.plainText.toString(),
        record10.plainText.toString(),
      ],
      broadcast: true,
    });
    const {transaction, broadcast_result} = await this.autoJoinClient.aleoClient.submitProvingRequest(provingRequest);
    if (broadcast_result?.status !== "Accepted") throw new Error(`Broadcast status not accepted: ${JSON.stringify(broadcast_result)}`);

    const transactionId = transaction?.id;
    if (!transactionId) throw new Error(`Transaction invalid: ${transaction}`);

    const firstOutput = transaction.execution?.transitions?.[8]?.outputs?.[0];
    if (!firstOutput?.value) throw new Error('No output record in join transaction');

    const newRecord = this.autoJoinClient.aleoClient.recordCipherTextStringToAleoRecord(
      firstOutput.value,
      this.autoJoinClient.account,
      record1.programName,
      transaction.id.trim(),
    );
    return {transactionId, newRecord};
  }

  private async join11(
    record1: AleoRecord,
    record2: AleoRecord,
    record3: AleoRecord,
    record4: AleoRecord,
    record5: AleoRecord,
    record6: AleoRecord,
    record7: AleoRecord,
    record8: AleoRecord,
    record9: AleoRecord,
    record10: AleoRecord,
    record11: AleoRecord,
  ): Promise<{transactionId: string, newRecord: AleoRecord}> {
    const programManager = await this.autoJoinClient.getProgramManager();
    const provingRequest = await programManager.provingRequest({
      programName: this.getBatchProgram(record1.programName, 11),
      functionName: 'join_11',
      priorityFee: 0,
      privateFee: false,
      inputs: [
        record1.plainText.toString(),
        record2.plainText.toString(),
        record3.plainText.toString(),
        record4.plainText.toString(),
        record5.plainText.toString(),
        record6.plainText.toString(),
        record7.plainText.toString(),
        record8.plainText.toString(),
        record9.plainText.toString(),
        record10.plainText.toString(),
        record11.plainText.toString(),
      ],
      broadcast: true,
    });
    const {transaction, broadcast_result} = await this.autoJoinClient.aleoClient.submitProvingRequest(provingRequest);
    if (broadcast_result?.status !== "Accepted") throw new Error(`Broadcast status not accepted: ${JSON.stringify(broadcast_result)}`);

    const transactionId = transaction?.id;
    if (!transactionId) throw new Error(`Transaction invalid: ${transaction}`);

    const firstOutput = transaction.execution?.transitions?.[9]?.outputs?.[0];
    if (!firstOutput?.value) throw new Error('No output record in join transaction');

    const newRecord = this.autoJoinClient.aleoClient.recordCipherTextStringToAleoRecord(
      firstOutput.value,
      this.autoJoinClient.account,
      record1.programName,
      transaction.id.trim(),
    );
    return {transactionId, newRecord};
  }

  private async join12(
    record1: AleoRecord,
    record2: AleoRecord,
    record3: AleoRecord,
    record4: AleoRecord,
    record5: AleoRecord,
    record6: AleoRecord,
    record7: AleoRecord,
    record8: AleoRecord,
    record9: AleoRecord,
    record10: AleoRecord,
    record11: AleoRecord,
    record12: AleoRecord,
  ): Promise<{transactionId: string, newRecord: AleoRecord}> {
    const programManager = await this.autoJoinClient.getProgramManager();
    const provingRequest = await programManager.provingRequest({
      programName: this.getBatchProgram(record1.programName, 12),
      functionName: 'join_12',
      priorityFee: 0,
      privateFee: false,
      inputs: [
        record1.plainText.toString(),
        record2.plainText.toString(),
        record3.plainText.toString(),
        record4.plainText.toString(),
        record5.plainText.toString(),
        record6.plainText.toString(),
        record7.plainText.toString(),
        record8.plainText.toString(),
        record9.plainText.toString(),
        record10.plainText.toString(),
        record11.plainText.toString(),
        record12.plainText.toString(),
      ],
      broadcast: true,
    });
    const {transaction, broadcast_result} = await this.autoJoinClient.aleoClient.submitProvingRequest(provingRequest);
    if (broadcast_result?.status !== "Accepted") throw new Error(`Broadcast status not accepted: ${JSON.stringify(broadcast_result)}`);

    const transactionId = transaction?.id;
    if (!transactionId) throw new Error(`Transaction invalid: ${transaction}`);

    const firstOutput = transaction.execution?.transitions?.[10]?.outputs?.[0];
    if (!firstOutput?.value) throw new Error('No output record in join transaction');

    const newRecord = this.autoJoinClient.aleoClient.recordCipherTextStringToAleoRecord(
      firstOutput.value,
      this.autoJoinClient.account,
      record1.programName,
      transaction.id.trim(),
    );
    return {transactionId, newRecord};
  }

  private async join13(
    record1: AleoRecord,
    record2: AleoRecord,
    record3: AleoRecord,
    record4: AleoRecord,
    record5: AleoRecord,
    record6: AleoRecord,
    record7: AleoRecord,
    record8: AleoRecord,
    record9: AleoRecord,
    record10: AleoRecord,
    record11: AleoRecord,
    record12: AleoRecord,
    record13: AleoRecord,
  ): Promise<{transactionId: string, newRecord: AleoRecord}> {
    const programManager = await this.autoJoinClient.getProgramManager();
    const provingRequest = await programManager.provingRequest({
      programName: this.getBatchProgram(record1.programName, 13),
      functionName: 'join_13',
      priorityFee: 0,
      privateFee: false,
      inputs: [
        record1.plainText.toString(),
        record2.plainText.toString(),
        record3.plainText.toString(),
        record4.plainText.toString(),
        record5.plainText.toString(),
        record6.plainText.toString(),
        record7.plainText.toString(),
        record8.plainText.toString(),
        record9.plainText.toString(),
        record10.plainText.toString(),
        record11.plainText.toString(),
        record12.plainText.toString(),
        record13.plainText.toString(),
      ],
      broadcast: true,
    });
    const {transaction, broadcast_result} = await this.autoJoinClient.aleoClient.submitProvingRequest(provingRequest);
    if (broadcast_result?.status !== "Accepted") throw new Error(`Broadcast status not accepted: ${JSON.stringify(broadcast_result)}`);

    const transactionId = transaction?.id;
    if (!transactionId) throw new Error(`Transaction invalid: ${transaction}`);

    const firstOutput = transaction.execution?.transitions?.[11]?.outputs?.[0];
    if (!firstOutput?.value) throw new Error('No output record in join transaction');

    const newRecord = this.autoJoinClient.aleoClient.recordCipherTextStringToAleoRecord(
      firstOutput.value,
      this.autoJoinClient.account,
      record1.programName,
      transaction.id.trim(),
    );
    return {transactionId, newRecord};
  }

  private async join14(
    record1: AleoRecord,
    record2: AleoRecord,
    record3: AleoRecord,
    record4: AleoRecord,
    record5: AleoRecord,
    record6: AleoRecord,
    record7: AleoRecord,
    record8: AleoRecord,
    record9: AleoRecord,
    record10: AleoRecord,
    record11: AleoRecord,
    record12: AleoRecord,
    record13: AleoRecord,
    record14: AleoRecord,
  ): Promise<{transactionId: string, newRecord: AleoRecord}> {
    const programManager = await this.autoJoinClient.getProgramManager();
    const provingRequest = await programManager.provingRequest({
      programName: this.getBatchProgram(record1.programName, 14),
      functionName: 'join_14',
      priorityFee: 0,
      privateFee: false,
      inputs: [
        record1.plainText.toString(),
        record2.plainText.toString(),
        record3.plainText.toString(),
        record4.plainText.toString(),
        record5.plainText.toString(),
        record6.plainText.toString(),
        record7.plainText.toString(),
        record8.plainText.toString(),
        record9.plainText.toString(),
        record10.plainText.toString(),
        record11.plainText.toString(),
        record12.plainText.toString(),
        record13.plainText.toString(),
        record14.plainText.toString(),
      ],
      broadcast: true,
    });
    const {transaction, broadcast_result} = await this.autoJoinClient.aleoClient.submitProvingRequest(provingRequest);
    if (broadcast_result?.status !== "Accepted") throw new Error(`Broadcast status not accepted: ${JSON.stringify(broadcast_result)}`);

    const transactionId = transaction?.id;
    if (!transactionId) throw new Error(`Transaction invalid: ${transaction}`);

    const firstOutput = transaction.execution?.transitions?.[12]?.outputs?.[0];
    if (!firstOutput?.value) throw new Error('No output record in join transaction');

    const newRecord = this.autoJoinClient.aleoClient.recordCipherTextStringToAleoRecord(
      firstOutput.value,
      this.autoJoinClient.account,
      record1.programName,
      transaction.id.trim(),
    );
    return {transactionId, newRecord};
  }

  private async join15(
    record1: AleoRecord,
    record2: AleoRecord,
    record3: AleoRecord,
    record4: AleoRecord,
    record5: AleoRecord,
    record6: AleoRecord,
    record7: AleoRecord,
    record8: AleoRecord,
    record9: AleoRecord,
    record10: AleoRecord,
    record11: AleoRecord,
    record12: AleoRecord,
    record13: AleoRecord,
    record14: AleoRecord,
    record15: AleoRecord,
  ): Promise<{transactionId: string, newRecord: AleoRecord}> {
    const programManager = await this.autoJoinClient.getProgramManager();
    const provingRequest = await programManager.provingRequest({
      programName: this.getBatchProgram(record1.programName, 15),
      functionName: 'join_15',
      priorityFee: 0,
      privateFee: false,
      inputs: [
        record1.plainText.toString(),
        record2.plainText.toString(),
        record3.plainText.toString(),
        record4.plainText.toString(),
        record5.plainText.toString(),
        record6.plainText.toString(),
        record7.plainText.toString(),
        record8.plainText.toString(),
        record9.plainText.toString(),
        record10.plainText.toString(),
        record11.plainText.toString(),
        record12.plainText.toString(),
        record13.plainText.toString(),
        record14.plainText.toString(),
        record15.plainText.toString(),
      ],
      broadcast: true,
    });
    const {transaction, broadcast_result} = await this.autoJoinClient.aleoClient.submitProvingRequest(provingRequest);
    if (broadcast_result?.status !== "Accepted") throw new Error(`Broadcast status not accepted: ${JSON.stringify(broadcast_result)}`);

    const transactionId = transaction?.id;
    if (!transactionId) throw new Error(`Transaction invalid: ${transaction}`);

    const firstOutput = transaction.execution?.transitions?.[13]?.outputs?.[0];
    if (!firstOutput?.value) throw new Error('No output record in join transaction');

    const newRecord = this.autoJoinClient.aleoClient.recordCipherTextStringToAleoRecord(
      firstOutput.value,
      this.autoJoinClient.account,
      record1.programName,
      transaction.id.trim(),
    );
    return {transactionId, newRecord};
  }

  private async join16(
    record1: AleoRecord, 
    record2: AleoRecord, 
    record3: AleoRecord, 
    record4: AleoRecord, 
    record5: AleoRecord, 
    record6: AleoRecord, 
    record7: AleoRecord, 
    record8: AleoRecord, 
    record9: AleoRecord,
    record10: AleoRecord,
    record11: AleoRecord,
    record12: AleoRecord,
    record13: AleoRecord,
    record14: AleoRecord,
    record15: AleoRecord,
    record16: AleoRecord,
  ): Promise<{transactionId: string, newRecord: AleoRecord}> {
    const programManager = await this.autoJoinClient.getProgramManager();
    const provingRequest = await programManager.provingRequest({
      programName: this.getBatchProgram(record1.programName,16),
      functionName: 'join_16',
      priorityFee: 0,
      privateFee: false,
      inputs: [
        record1.plainText.toString(),
        record2.plainText.toString(),
        record3.plainText.toString(),
        record4.plainText.toString(),
        record5.plainText.toString(),
        record6.plainText.toString(),
        record7.plainText.toString(),
        record8.plainText.toString(),
        record9.plainText.toString(),
        record10.plainText.toString(),
        record11.plainText.toString(),
        record12.plainText.toString(),
        record13.plainText.toString(),
        record14.plainText.toString(),
        record15.plainText.toString(),
        record16.plainText.toString(),
      ],
      broadcast: true,
    });
    const {transaction, broadcast_result} = await this.autoJoinClient.aleoClient.submitProvingRequest(provingRequest);
    if (broadcast_result?.status !== "Accepted") throw new Error(`Broadcast status not accepted: ${JSON.stringify(broadcast_result)}`);

    const transactionId = transaction?.id;
    if (!transactionId) throw new Error(`Transaction invalid: ${transaction}`);

    const firstOutput = transaction.execution?.transitions?.[14]?.outputs?.[0];
    if (!firstOutput?.value) throw new Error('No output record in join transaction');

    const newRecord = this.autoJoinClient.aleoClient.recordCipherTextStringToAleoRecord(
      firstOutput.value,
      this.autoJoinClient.account,
      record1.programName,
      transaction.id.trim(),
    );
    return {transactionId, newRecord};
  }

}


