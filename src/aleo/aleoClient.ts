import {
  Account as TestnetAccount,
  RecordScanner as TestnetRecordScanner,
  ProgramManager as TestnetProgramManager,
  type FunctionKeyProvider as TestnetFunctionKeyProvider,
  type RecordCiphertext as TestnetRecordCiphertext,
  type RecordPlaintext as TestnetRecordPlaintext,
  type Transaction as TestnetTransaction,
} from '@provablehq/sdk/testnet.js';
import {
  Account as MainnetAccount,
  RecordScanner as MainnetRecordScanner,
  ProgramManager as MainnetProgramManager,
  type FunctionKeyProvider as MainnetFunctionKeyProvider,
  type OwnedRecord,
  type ProvingRequest,
  type ProvingResponse,
  type RecordCiphertext as MainnetRecordCiphertext,
  type RecordPlaintext as MainnetRecordPlaintext,
  type Transaction as MainnetTransaction, type ConfirmedTransactionJSON,
} from '@provablehq/sdk/mainnet.js';
import {loadNetwork, type Networks} from "@provablehq/sdk/dynamic.js";
import {AleoNetworkClient} from "@provablehq/sdk";
export {AleoNetworkClient} from "@provablehq/sdk";
export { type OwnedRecord, type ProvingRequest, type ProvingResponse } from '@provablehq/sdk/mainnet.js';

type RecordScanner = TestnetRecordScanner | MainnetRecordScanner;
export type ProgramManager = TestnetProgramManager | MainnetProgramManager;
type FunctionKeyProvider = TestnetFunctionKeyProvider | MainnetFunctionKeyProvider;
export type RecordPlaintext = TestnetRecordPlaintext | MainnetRecordPlaintext;
export type RecordCiphertext = TestnetRecordCiphertext | MainnetRecordCiphertext;
export type Transaction = TestnetTransaction | MainnetTransaction;

export type Account = TestnetAccount | MainnetAccount;
export type AleoNetwork = keyof Networks;

export type AleoApiSecrets = {
  apiKey: string
  consumerId: string
  apiRoot?: string
}

export type AleoJwtData = {
  jwt: string
  expiration: number
}

type CachedRecords = {
  cachedAt: number;
  records: AleoRecord[];
}

/**
 * A simple wrapper around common Provable SDK features including record scanning and delegated proving.
 */
export class AleoClient<NetworkKey extends AleoNetwork> {
  private readonly networkKey: NetworkKey;
  private network: Networks[NetworkKey] | undefined;
  private readonly apiSecrets: AleoApiSecrets;
  private readonly apiRoot: string;
  private jwtData?: AleoJwtData;

  private recordScanner?: RecordScanner;
  private recordScannerUuids: Map<string, string> = new Map();

  private cacheTtlSec: number = 15;
  private cachedRecords: Map<string, CachedRecords> = new Map();

  private keyProvider?: FunctionKeyProvider;
  private readonly networkClient: AleoNetworkClient;
  private readonly provingNetworkClient: AleoNetworkClient;

  async initNetwork(): Promise<Networks[NetworkKey]> {
    if (this.network) return this.network;
    this.network = await loadNetwork<NetworkKey>(this.networkKey);
    return this.network;
  }

  constructor(networkKey: NetworkKey, apiSecrets: AleoApiSecrets) {
    this.networkKey = networkKey;
    this.apiSecrets = apiSecrets;
    this.apiRoot = apiSecrets.apiRoot ? apiSecrets.apiRoot : "https://api.provable.com";
    this.provingNetworkClient = new AleoNetworkClient(`${this.apiSecrets.apiRoot}/prove`);
    this.networkClient = new AleoNetworkClient(`${this.apiSecrets.apiRoot}/v2`);
  }

  /** Converts a private key to an `Account` object. Must call `await initNetwork()` prior to using this. */
  accountFromPrivateKey(privateKey: string): Account {
    if (this.network === undefined) throw new Error("Network must be initialized first");
    return new this.network.Account({ privateKey: privateKey });
  }

  private async fetchJwt(): Promise<AleoJwtData> {
    const jwtRes = await fetch(`${this.apiRoot}/jwts/${this.apiSecrets.consumerId}`, {
      method: "POST",
      headers: {
        "X-Provable-API-Key": this.apiSecrets.apiKey,
      },
    });
    const bearerHeader = jwtRes.headers.get("authorization");
    if (!jwtRes.ok || !bearerHeader) throw new Error(`JWT Auth: ${await jwtRes.text()}`);
    this.jwtData = {
      jwt: bearerHeader,
      expiration: (await jwtRes.json())["exp"],
    };
    return this.jwtData;
  }

  private async setupRecordScanner() {
    if (!this.recordScanner) {
      const net = await this.initNetwork();
      if (!this.jwtData) await this.fetchJwt();
      this.recordScanner = new net.RecordScanner({
        url: `${this.apiRoot}/scanner`,
        jwtData: this.jwtData,
      });
    }
  }

  /** Retrieve a `ProgramManager` with the account provided so that transactions can be generated. */
  async getProgramManagerForAccount(account: Account): Promise<ProgramManager> {
    if (!this.keyProvider) {
      const net = await this.initNetwork();
      const keyProvider = new net.AleoKeyProvider();
      keyProvider.useCache(true);
      this.keyProvider = keyProvider;
    }
    const net = await this.initNetwork();
    const programManager = new net.ProgramManager(`${this.apiSecrets.apiRoot}/v2`, this.keyProvider);
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-expect-error
    programManager.setAccount(account);
    return programManager;
  }

  /** Register with the record scanner the view key belonging to the account. Idempotent. */
  async registerAccountForRecordScanning(account: Account, address?: string) {
    if (!this.recordScanner) await this.setupRecordScanner();
    address = address ? address : account.address().to_string();
    if (! this.recordScannerUuids.has(address)) {
      const regResult = await this.recordScanner!.registerEncrypted(account.viewKey(), 0);
      if (!regResult.ok) throw new Error(regResult.error?.message ?? `Registration failed: ${regResult.status}`);
      this.recordScannerUuids.set(address, regResult.data.uuid);
    }
  }

  decryptRecordCiphertext(ciphertext: RecordCiphertext, account: Account): RecordPlaintext {
    return ciphertext.decrypt(account.viewKey());
  }

  /**
   * Retrieve unspent program records belonging to the specified program name(s). Records without an amount field
   * are skipped.
   *
   * @param account The account object so that the view key can be found.
   * @param programNames The list of program names to retrieve for.
   * @param address (optional) The address of the account, otherwise derived from the account data.
   * @param useCache (default: true) If the records cache is hot (`cacheTtlSec`) then don't make RPC calls.
   * @return list of `AleoRecord` which has pre-parsed amounts
   */
  async fetchUnspentRecords(account: Account, programNames: string[], address?: string, useCache: boolean = true): Promise<AleoRecord[]> {
    if (!this.recordScanner) await this.setupRecordScanner();
    await this.initNetwork();
    address = address ? address : account.address().to_string();

    if (useCache) {
      const cached = this.cachedRecords.get(address);
      if (cached && Date.now() - cached.cachedAt < this.cacheTtlSec * 1000) {
        return cached.records;
      }
    }

    if (! this.recordScannerUuids.has(address)) await this.registerAccountForRecordScanning(account);
    const records = await this.recordScanner!.findRecords({
      uuid: this.recordScannerUuids.get(address),
      unspent: true,
      filter: { programs: programNames },
    });
    console.log("fetched records", records);
    const aleoRecords = records.map(r => this.ownedRecordToAleoRecord(r, account));
    this.cachedRecords.set(address, { cachedAt: Date.now(), records: aleoRecords });
    return aleoRecords;
  }

  ownedRecordToAleoRecord(ownedRecord: OwnedRecord, account: Account): AleoRecord {
    const cipherText = this.network!.RecordCiphertext.fromString(ownedRecord.record_ciphertext!);
    return this.recordCipherTextToAleoRecord(
      cipherText,
      account,
      ownedRecord.program_name!,
      ownedRecord.transaction_id!,
    );
  }

  recordCipherTextStringToAleoRecord(
    cipherText: string,
    account: Account,
    programName: string,
    transactionId: string,
  ) {
    return this.recordCipherTextToAleoRecord(
      this.network!.RecordCiphertext.fromString(cipherText),
      account,
      programName,
      transactionId,
    );
  }

  recordCipherTextToAleoRecord(
    cipherText: RecordCiphertext,
    account: Account,
    programName: string,
    transactionId: string,
  ) {
    const plainText = this.decryptRecordCiphertext(cipherText, account);
    let amount: string = "";
    try {
      if (programName === 'credits.aleo') {
        amount = plainText.microcredits().toString();
      } else {
        amount = plainText.getMember('amount').toString().replace('u128', '');
      }
    } catch (e) {
      console.error("No amount field found for record", e);
    }
    return {
      programName,
      transactionId: transactionId.trim(),
      cipherText,
      plainText,
      ownerAddress: account.address().to_string(),
      amount,
    };
  }

  /** Calls out to the delegated proving system to submit a request for proving. **/
  async submitProvingRequest(provingRequest: ProvingRequest): Promise<ProvingResponse> {
    return await this.provingNetworkClient.submitProvingRequest({
      provingRequest,
      dpsPrivacy: true,
      jwtData: this.jwtData,
    });
  }

  async submitTransaction(transaction: Transaction, waitForConfirmation: boolean = false) {
    const transactionId = await this.networkClient.submitTransaction(transaction);
    if (waitForConfirmation) {
      const confirmedTx = await this.waitForTransactionConfirmation(transactionId);
      return { transactionId, confirmedTx};
    }
    return { transactionId, confirmedTx: null};
  }

  async waitForTransactionConfirmation(transactionId: string): Promise<ConfirmedTransactionJSON> {
    return await this.networkClient.waitForTransactionConfirmation(transactionId);
  }
}

export type AleoRecord = {
  programName: string
  transactionId: string
  cipherText: RecordCiphertext
  plainText: RecordPlaintext
  ownerAddress: string
  sender?: string
  amount?: string
}
