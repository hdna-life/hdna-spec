const CONFIG_KEY = 'hdna_persona_interpreter_config';

export interface PersonaInterpreterConfig {
  /** Opt-in, defaults false — unlike RuntimeControls' flags, which default to "running". */
  enabled: boolean;
  apiKey?: string;
  modelId?: string;
}

const DEFAULT_CONFIG: PersonaInterpreterConfig = {
  enabled: false,
};

/**
 * Holds the OpenRouter API key and model/enabled preferences for T3
 * interpretation. Deliberately NOT backed by StorageAdapter/IndexedDB — a
 * credential is local secret/config state, not persona evidence, and must
 * never surface through StorageAdapter.usageByClass()/listRecordMeta()
 * (storage-accounting UI, eviction) or any future persona-export/evidence
 * API that walks the StorageAdapter stores. Using a separate browser API
 * (chrome.storage.local) makes that separation structural rather than a
 * convention that a future StorageAdapter.query() call could violate.
 *
 * This is plain local browser storage, not cryptographic secret
 * protection — no encryption-at-rest beyond whatever Chrome itself
 * provides for extension storage. See docs/decisions/0015.
 */
export class PersonaInterpreterConfigStore {
  async get(): Promise<PersonaInterpreterConfig> {
    const result = await chrome.storage.local.get(CONFIG_KEY);
    const stored = result[CONFIG_KEY] as PersonaInterpreterConfig | undefined;
    return stored ?? DEFAULT_CONFIG;
  }

  async set(config: PersonaInterpreterConfig): Promise<void> {
    await chrome.storage.local.set({ [CONFIG_KEY]: config });
  }
}
