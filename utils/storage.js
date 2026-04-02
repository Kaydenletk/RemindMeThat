export const extensionStorage = {
  async get(key, fallback = undefined) {
    const result = await chrome.storage.local.get(key);
    if (result[key] === undefined) {
      return fallback;
    }

    return result[key];
  },

  async getMany(keys) {
    return chrome.storage.local.get(keys);
  },

  async getAll() {
    return chrome.storage.local.get(null);
  },

  async set(values) {
    return chrome.storage.local.set(values);
  },

  async remove(keys) {
    return chrome.storage.local.remove(keys);
  }
};
