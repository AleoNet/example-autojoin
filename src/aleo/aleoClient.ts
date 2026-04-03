import {
  Account as TestnetAccount,
  RecordScanner as TestnetRecordScanner,
  ProgramManager as TestnetProgramManager,
  type FunctionKeyProvider as TestnetFunctionKeyProvider,
} from '@provablehq/sdk/testnet.js';
import {
  Account as MainnetAccount,
  RecordScanner as MainnetRecordScanner,
  ProgramManager as MainnetProgramManager,
  type FunctionKeyProvider as MainnetFunctionKeyProvider,
  type OwnedRecord,
  type ProvingRequest,
  type ProvingResponse,
} from '@provablehq/sdk/mainnet.js';
import {loadNetwork, type Networks} from "@provablehq/sdk/dynamic.js";
import {AleoNetworkClient} from "@provablehq/sdk";
export {AleoNetworkClient} from "@provablehq/sdk";
export { type OwnedRecord, type ProvingRequest, type ProvingResponse } from '@provablehq/sdk/mainnet.js';

type RecordScanner = TestnetRecordScanner | MainnetRecordScanner;
export type ProgramManager = TestnetProgramManager | MainnetProgramManager;
type FunctionKeyProvider = TestnetFunctionKeyProvider | MainnetFunctionKeyProvider;

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
  }

  accountFromPrivateKey(privateKey: string): Account {
    if (this.network === undefined) throw new Error("Network must be initialized first");
    return new this.network.Account({ privateKey: privateKey });
  }

  async fetchJwt(): Promise<AleoJwtData> {
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

  async registerAccountForRecordScanning(account: Account, address?: string) {
    if (!this.recordScanner) await this.setupRecordScanner();
    address = address ? address : account.address().to_string();
    if (! this.recordScannerUuids.has(address)) {
      const regResult = await this.recordScanner!.registerEncrypted(account.viewKey(), 0);
      if (!regResult.ok) throw new Error(regResult.error?.message ?? `Registration failed: ${regResult.status}`);
      this.recordScannerUuids.set(address, regResult.data.uuid);
    }
  }

  decryptRecord(ownedRecord: OwnedRecord, account: Account) {
    return this.network!.RecordCiphertext.fromString(ownedRecord.record_ciphertext!).decrypt(account.viewKey());
  }

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
    const aleoRecords = records.map((ownedRecord: OwnedRecord) => {
      const plainText = this.decryptRecord(ownedRecord, account);
      let amount: string = "";
      try {
        if (ownedRecord.program_name === 'credits.aleo') {
          amount = plainText.microcredits().toString();
        } else {
          amount = plainText.getMember('amount').toString().replace('u128', '');
          console.log(amount);
        }
      } catch (e) {
        console.error("No amount field found for record", e);
      }
      return {
        ownedRecord,
        amount,
        tokenId: ownedRecord.program_name!,
      };
    });
    this.cachedRecords.set(address, { cachedAt: Date.now(), records: aleoRecords });
    return aleoRecords;
  }

  async submitProvingRequest(provingRequest: ProvingRequest): Promise<ProvingResponse> {
    return await this.provingNetworkClient.submitProvingRequest({
      provingRequest,
      dpsPrivacy: true,
      jwtData: this.jwtData,
    });
  }
}

export type AleoRecord = {
  ownedRecord: OwnedRecord
  amount: string
  tokenId: string
}
