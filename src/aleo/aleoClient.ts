import {
  Account as TestnetAccount,
  type OwnedRecord,
  RecordScanner as TestnetRecordScanner,
} from '@provablehq/sdk/testnet.js';
import {
  Account as MainnetAccount,
  RecordScanner as MainnetRecordScanner,
} from '@provablehq/sdk/mainnet.js';
import {loadNetwork, type Networks} from "@provablehq/sdk/dynamic.js";

type RecordScanner = TestnetRecordScanner | MainnetRecordScanner;
export type Account = TestnetAccount | MainnetAccount;

export type AleoApiSecrets = {
  apiKey: string
  consumerId: string
  apiRoot?: string
}

export type AleoJwtData = {
  jwt: string
  expiration: number
}

export class AleoClient<NetworkKey extends keyof Networks> {
  private readonly networkKey: NetworkKey;
  private network: Networks[NetworkKey] | undefined;
  private readonly apiSecrets: AleoApiSecrets;
  private readonly apiRoot: string;
  private jwtData?: AleoJwtData;

  private recordScanner?: RecordScanner;
  private recordScannerUuids: Map<string, string> = new Map();

  async initNetwork(): Promise<Networks[NetworkKey]> {
    if (this.network) return this.network;
    this.network = await loadNetwork<NetworkKey>(this.networkKey);
    return this.network;
  }

  constructor(networkKey: NetworkKey, apiSecrets: AleoApiSecrets) {
    this.networkKey = networkKey;
    this.apiSecrets = apiSecrets;
    this.apiRoot = apiSecrets.apiRoot ? apiSecrets.apiRoot : "https://api.provable.com";
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

  async registerAccountForRecordScanning(account: Account, address?: string) {
    if (!this.recordScanner) await this.setupRecordScanner();
    address = address ? address : account.address().to_string();
    if (! this.recordScannerUuids.has(address)) {
      const regResult = await this.recordScanner!.registerEncrypted(account.viewKey(), 0);
      if (!regResult.ok) throw new Error(regResult.error?.message ?? `Registration failed: ${regResult.status}`);
      this.recordScannerUuids.set(address, regResult.data.uuid);
    }
  }

  async fetchUnspentRecords(account: Account, programNames: string[], address?: string): Promise<AleoRecord[]> {
    const net = await this.initNetwork();
    if (!this.recordScanner) await this.setupRecordScanner();
    address = address ? address : account.address().to_string();
    if (! this.recordScannerUuids.has(address)) await this.registerAccountForRecordScanning(account);
    const records = await this.recordScanner!.findRecords({
      uuid: this.recordScannerUuids.get(address),
      unspent: true,
      filter: { programs: programNames },
    });
    return records.map((ownedRecord: OwnedRecord) => {
      const plainText = net.RecordCiphertext.fromString(ownedRecord.record_ciphertext!).decrypt(account.viewKey());
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
  }
}

export type AleoRecord = {
  ownedRecord: OwnedRecord
  amount: string
  tokenId: string
}
