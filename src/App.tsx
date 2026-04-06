import { useState, useEffect, useMemo } from 'react';
import './App.css';
import {AleoClient, type AleoRecord, type Account} from "./aleo";
import {AutoJoinClient} from "./aleo/autojoin/autoJoinClient.ts";
import {BasicAutoJoinStrategy} from "./aleo/autojoin/strategies/basicAutoJoinStrategy.ts";

const TOKEN_PROGRAMS = {
  'testnet': [
    'credits.aleo',
    'test_usad_stablecoin.aleo',
    'test_usdcx_stablecoin.aleo',
  ],
  'mainnet': [
    'credits.aleo',
    'usad_stablecoin.aleo',
    'usdcx_stablecoin.aleo',
  ]
};

function App() {
  const testnetAleoClient = useMemo(() => new AleoClient('testnet', {
    apiKey: import.meta.env.VITE_PROVABLE_API_KEY,
    consumerId: import.meta.env.VITE_PROVABLE_CONSUMER_ID,
    apiRoot: import.meta.env.VITE_PROVABLE_API_ROOT,
  }), []);
  const mainnetAleoClient = useMemo(() => new AleoClient('mainnet', {
    apiKey: import.meta.env.VITE_PROVABLE_API_KEY,
    consumerId: import.meta.env.VITE_PROVABLE_CONSUMER_ID,
    apiRoot: import.meta.env.VITE_PROVABLE_API_ROOT,
  }), []);

  const [aleoClient, setAleoClient] = useState<AleoClient<'testnet' | 'mainnet'>>(testnetAleoClient);
  const [network, setNetwork] = useState<'testnet' | 'mainnet'>('testnet');
  const [aleoAutoJoin, setAutoJoinClient] = useState<AutoJoinClient | undefined>();

  const [privateKeyInput, setPrivateKeyInput] = useState(import.meta.env.VITE_DEFAULT_PKEY || '');
  const [programNameInput, setProgramNameInput] = useState('credits.aleo');
  const [showPrivateKey, setShowPrivateKey] = useState(false);
  const [address, setAddress] = useState<string | null>(null);
  const [viewKey, setViewKey] = useState<string | null>(null);
  const [showViewKey, setShowViewKey] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [aleoAccount, setAleoAccount] = useState<Account | null>(null);
  const [records, setRecords] = useState<AleoRecord[]>([]);
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [joinLoading, setJoinLoading] = useState(false);

  useEffect(() => {
    void testnetAleoClient.initNetwork();
    void mainnetAleoClient.initNetwork();
  }, [testnetAleoClient, mainnetAleoClient]);

  useEffect(() => {
    setAleoClient(network === 'testnet' ? testnetAleoClient : mainnetAleoClient);
    setProgramNameInput(TOKEN_PROGRAMS[network][0]);
    setAleoAccount(null);
    setAddress(null);
    setViewKey(null);
    setRecords([]);
    setAutoJoinClient(undefined);
  }, [network, testnetAleoClient, mainnetAleoClient]);

  async function handleDerive() {
    setLoading(true);
    setError(null);
    setAddress(null);
    setViewKey(null);
    setShowViewKey(false);
    try {
      const account = aleoClient.accountFromPrivateKey(privateKeyInput.trim());
      setAleoAccount(account);
      setAddress(account.address().to_string());
      setViewKey(account.viewKey().to_string());
      setAutoJoinClient(new AutoJoinClient(aleoClient, account, BasicAutoJoinStrategy));
      await aleoClient.registerAccountForRecordScanning(account);
    } catch (e: unknown) {
      if (e instanceof Error) {
        setError(`Unable to derive private key: ${e}`);
      }
    } finally {
      setLoading(false);
    }
  }

  function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text);
  }

  async function handleLoadRecords() {
    setError(null);
    setRecordsLoading(true);
    try {
      const fetched = await aleoClient.fetchUnspentRecords(aleoAccount!, [programNameInput], address!);
      setRecords(fetched);
    } catch (e: unknown) {
      if (e instanceof Error) {
        setError(`Unable to load records: ${e}`);
      }
    } finally {
      setRecordsLoading(false);
    }
  }

  async function handleJoin() {
    if (! aleoAutoJoin) return;
    setError(null);
    setJoinLoading(true);
    try {
      const newRecord = await aleoAutoJoin.joinRecords(records);
      setRecords([newRecord]);
    } catch (e: unknown) {
      if (e instanceof Error) {
        setError(`Join operation failed: ${e}`);
      }
    } finally {
      setJoinLoading(false);
    }
  }

  const hasResults = address !== null && viewKey !== null;

  return (
    <div className="keys-card">
      <div className="network-toggle">
        <button
          type="button"
          className={`network-btn${network === 'testnet' ? ' network-btn--active' : ''}`}
          onClick={() => setNetwork('testnet')}
        >
          Testnet
        </button>
        <button
          type="button"
          className={`network-btn${network === 'mainnet' ? ' network-btn--active' : ''}`}
          onClick={() => setNetwork('mainnet')}
        >
          Mainnet
        </button>
      </div>
      <h1 className="card-title">Record Join Example</h1>

      <label htmlFor="private-key" className="field-label">
        Private Key
      </label>
      <div className="input-wrap">
        <input
          id="private-key"
          type={showPrivateKey ? 'text' : 'password'}
          value={privateKeyInput}
          onChange={e => setPrivateKeyInput(e.target.value)}
          placeholder="APrivateKey1zkp..."
          className="form-input"
          autoComplete="off"
          spellCheck={false}
        />
        <button
          type="button"
          className="toggle-btn"
          onClick={() => setShowPrivateKey(v => !v)}
        >
          {showPrivateKey ? 'hide' : 'show'}
        </button>
      </div>

      <button
        type="button"
        className="derive-btn"
        onClick={handleDerive}
        disabled={!privateKeyInput.trim() || loading}
      >
        {loading ? 'Deriving\u2026' : 'Derive Keys'}
      </button>

      {error && <div className="error-banner">{error}</div>}

      {hasResults && (
        <>
        <div className="form-group">
          <label className="field-label">Address</label>
          <div className="key-row">
            <span className="key-value">{address}</span>
            <button
              type="button"
              className="copy-btn"
              onClick={() => copyToClipboard(address!)}
            >
              Copy
            </button>
          </div>

          <label className="field-label">View Key</label>
          <div className="key-row">
            <span className="key-value">
              {showViewKey ? viewKey : '\u2022'.repeat(48)}
            </span>
            <button
              type="button"
              className="toggle-btn"
              onClick={() => setShowViewKey(v => !v)}
            >
              {showViewKey ? 'hide' : 'show'}
            </button>
            <button
              type="button"
              className="copy-btn"
              onClick={() => copyToClipboard(viewKey!)}
            >
              Copy
            </button>
          </div>
        </div>

        <div className="form-group">
          <label htmlFor="program-name" className="field-label">
            Program Name
          </label>
          <div className="input-wrap">
            <select
              id="program-name"
              className="form-input"
              value={programNameInput}
              onChange={e => setProgramNameInput(e.target.value)}
            >
              {TOKEN_PROGRAMS[network].map(p => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>
          <button
            type="button"
            className="derive-btn"
            disabled={recordsLoading || joinLoading}
            onClick={handleLoadRecords}
          >
            {recordsLoading ? 'Loading\u2026' : 'Load Records'}
          </button>
          {records.length > 0 && (
            <ul className="records-list">
              {records.map((record, i) => (
                <li key={i} className="record-item">
                  <span className="record-label">Amount</span>
                  <span className="record-value">
                    {record.amount === undefined ? "-" : (Number(record.amount) / 1e6).toFixed(6)}
                  </span>
                  <span className="record-label">Tx ID</span>
                  <span className="record-value">{record.transactionId}</span>
                </li>
              ))}
            </ul>
          )}
          {records.length > 0 && (
            <button
              type="button"
              className="derive-btn"
              disabled={records.length < 2 || recordsLoading || joinLoading}
              onClick={handleJoin}
            >
              {joinLoading ? 'Joining\u2026' : 'Join Records'}
            </button>
          )}
        </div>
        </>
      )}
    </div>
  );
}

export default App;
