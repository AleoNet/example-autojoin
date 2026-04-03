import { type JoinStrategy, AutoJoinClient } from "../";
import type {OwnedRecord} from "@provablehq/sdk/mainnet.js";

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

  async joinRecords(records: OwnedRecord[]): Promise<OwnedRecord> {
    if (records.length === 0) throw new Error('No records found');
    if (records.length === 1) return records[0];
    const programName = records[0].program_name!;
    let current = records;

    while (current.length > 1) {
      // Pair up records, potentially leaving the last one unpaired
      const pairs: [OwnedRecord, OwnedRecord][] = [];
      for (let i = 0; i + 1 < current.length; i += 2) {
        pairs.push([current[i], current[i + 1]]);
      }

      // Track commitments of the input records that were consumed
      const consumedCommitments = new Set(
        pairs.flatMap(([a, b]) => [a.commitment!.trim(), b.commitment!.trim()])
      );

      // Join each pair in parallel, collect resulting transaction IDs
      const joinTxIds = await Promise.all(pairs.map(([a, b]) => this.join2(a, b)));

      // Validate with retry: up to 6 attempts, 5s apart (30s total)
      const MAX_ATTEMPTS = 6;
      const RETRY_DELAY_MS = 5000;
      let validated = false;
      let stillPresent: string[] = [];
      let notFound: string[] = [];
      await new Promise<void>(resolve => setTimeout(resolve, RETRY_DELAY_MS * 2));

      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        const fresh = await this.autoJoinClient.aleoClient.fetchUnspentRecords(
          this.autoJoinClient.account, [programName], this.autoJoinClient.accountAddress, false
        );
        const freshCommitments = new Set(fresh.map(r => r.ownedRecord.commitment!.trim()));
        const freshTxIds = new Set(fresh.map(r => r.ownedRecord.transaction_id!.trim()));

        stillPresent = [...consumedCommitments].filter(c => freshCommitments.has(c));
        notFound = joinTxIds.filter(txId => !freshTxIds.has(txId));

        if (stillPresent.length === 0 && notFound.length === 0) {
          current = fresh.map(r => r.ownedRecord);
          validated = true;
          break;
        }

        if (attempt < MAX_ATTEMPTS - 1) {
          await new Promise<void>(resolve => setTimeout(resolve, RETRY_DELAY_MS));
        }
      }

      if (!validated) {
        throw new Error('Timed out after 30s waiting for join confirmation');
      }
    }

    return current[0];
  }

  private async join2(recordA: OwnedRecord, recordB: OwnedRecord): Promise<string> {
    const autoJoinClient = this.autoJoinClient!;
    const programManager = await autoJoinClient.getProgramManager();
    const provingRequest = await programManager.provingRequest({
      programName: recordA.program_name!,
      functionName: 'join',
      priorityFee: 0,
      privateFee: false,
      inputs: [
        autoJoinClient.aleoClient.decryptRecord(recordA, autoJoinClient.account).toString(),
        autoJoinClient.aleoClient.decryptRecord(recordB, autoJoinClient.account).toString(),
      ],
      broadcast: true,
    });
    const {transaction, broadcast_result} = await autoJoinClient.aleoClient.submitProvingRequest(provingRequest);
    if (broadcast_result?.status !== "Accepted") throw new Error(`Broadcast status not accepted: ${broadcast_result}`);
    if (!transaction?.id) throw new Error(`Transaction invalid: ${transaction}`);
    return transaction.id.trim();
  }
}