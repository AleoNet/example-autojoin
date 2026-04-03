import {
  type Account,
  AleoClient,
  type AleoNetwork,
  type OwnedRecord,
  type ProgramManager,
} from './aleoClient.ts';

export class AleoAutoJoin {
  private readonly aleoClient: AleoClient<AleoNetwork>;
  private readonly account: Account;
  private readonly accountAddress: string;
  private programManager?: ProgramManager;

  constructor(aleoClient: AleoClient<AleoNetwork>, account: Account) {
    this.aleoClient = aleoClient;
    this.account = account;
    this.accountAddress = account.address().to_string();
  }

  async joinRecords(records: OwnedRecord[]): Promise<OwnedRecord> {
    if (records.length === 0) throw new Error('No records found');
    if (records.length === 1) return records[0];
    if (records.some(r => r.program_name !== records[0].program_name)) throw new Error('All records must be same program');
    if (records[0].program_name === undefined) throw new Error('All records must have a program name');
    if (records.some(r => r.owner !== this.accountAddress)) throw new Error('All records must be owned by account');
    throw new Error('Not implemented');
  }

  async join2(recordA: OwnedRecord, recordB: OwnedRecord): Promise<void> {
    const programManager = await this.getProgramManager();
    const provingRequest = await programManager.provingRequest({
      programName: recordA.program_name!,
      functionName: 'join',
      priorityFee: 0,
      privateFee: false,
      inputs: [
        this.aleoClient.decryptRecord(recordA, this.account).toString(),
        this.aleoClient.decryptRecord(recordB, this.account).toString(),
      ],
      broadcast: true,
    });
    console.log('proving request', provingRequest);
    const {transaction, broadcast_result} = await this.aleoClient.submitProvingRequest(provingRequest);
    console.log("Transaction ID:", transaction?.id);
    console.log("Broadcast status:", broadcast_result?.status);
  }

  private async getProgramManager(): Promise<ProgramManager> {
    if (this.programManager) return this.programManager;
    this.programManager = await this.aleoClient.getProgramManagerForAccount(this.account);
    return this.programManager;
  }
}