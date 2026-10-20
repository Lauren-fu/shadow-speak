const KEY = "supadataApiKey";

export function createKeyStore(storage) {
  // Keys persist on this device, but are unavailable to YouTube content scripts.
  const restricted = storage.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
  return {
    async read() {
      await restricted;
      const result = await storage.get(KEY);
      return typeof result[KEY] === "string" ? result[KEY] : "";
    },
    async save(value) {
      await restricted;
      const key = value.trim();
      if (!key) throw new Error("Enter a Supadata API key first.");
      await storage.set({ [KEY]: key });
    },
    async clear() {
      await restricted;
      await storage.remove(KEY);
    }
  };
}
