const MAX_CONVERSATION_KEYS = 50;

class CryptoKeyCache {
  private privateKey: CryptoKey | null = null;
  private publicKey: CryptoKey | null = null;
  private conversationKeys = new Map<string, CryptoKey>();
  private accessOrder: string[] = [];

  setIdentityKeys(privateKey: CryptoKey, publicKey: CryptoKey) {
    this.privateKey = privateKey;
    this.publicKey = publicKey;
  }

  getPrivateKey(): CryptoKey | null {
    return this.privateKey;
  }

  getPublicKey(): CryptoKey | null {
    return this.publicKey;
  }

  hasIdentityKeys(): boolean {
    return this.privateKey !== null && this.publicKey !== null;
  }

  setConversationKey(conversationId: string, key: CryptoKey) {
    if (this.conversationKeys.has(conversationId)) {
      this.accessOrder = this.accessOrder.filter((id) => id !== conversationId);
    }
    this.conversationKeys.set(conversationId, key);
    this.accessOrder.push(conversationId);

    while (this.conversationKeys.size > MAX_CONVERSATION_KEYS) {
      const evictId = this.accessOrder.shift();
      if (evictId) this.conversationKeys.delete(evictId);
    }
  }

  getConversationKey(conversationId: string): CryptoKey | null {
    const key = this.conversationKeys.get(conversationId);
    if (!key) return null;
    this.accessOrder = this.accessOrder.filter((id) => id !== conversationId);
    this.accessOrder.push(conversationId);
    return key;
  }

  removeConversationKey(conversationId: string) {
    this.conversationKeys.delete(conversationId);
    this.accessOrder = this.accessOrder.filter((id) => id !== conversationId);
  }

  clear() {
    this.privateKey = null;
    this.publicKey = null;
    this.conversationKeys.clear();
    this.accessOrder = [];
  }
}

export const cryptoKeyCache = new CryptoKeyCache();

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    cryptoKeyCache.clear();
  });
}
