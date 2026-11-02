import {
    createMMKV,
    MMKV,
    useMMKVBoolean as useMMKVBooleanBase,
    useMMKVNumber as useMMKVNumberBase,
    useMMKVString as useMMKVStringBase,
} from 'react-native-mmkv'
import { createJSONStorage, StateStorage } from 'zustand/middleware'

import { randomPrintableKey, SecureKeyNames, SecureKeys } from './SecureKeys'

/**
 * Opens the app settings store encrypted with a device-only key.
 *
 * Older installs have a plaintext store. The first launch with encryption generates a key,
 * stores it in the Android keystore *before* re-encrypting, and only marks the store as
 * encrypted afterwards, so an interrupted first launch can always be resumed.
 */
// Same file the app used before encryption, so existing settings are kept
const DEFAULT_ID = 'mmkv.default'

const openEncryptedStore = (): MMKV => {
    const existingKey = SecureKeys.get(SecureKeyNames.Settings)
    const state = SecureKeys.get(SecureKeyNames.SettingsEncrypted)

    // 'pending' means the last launch stopped during re-encryption, which is a single quick
    // write: treat the store as encrypted rather than risk re-encrypting it twice.
    if (existingKey && (state === '1' || state === 'pending')) {
        if (state === 'pending') SecureKeys.set(SecureKeyNames.SettingsEncrypted, '1')
        return createMMKV({ id: DEFAULT_ID, encryptionKey: existingKey })
    }

    const key = existingKey ?? randomPrintableKey(16)
    if (!existingKey) SecureKeys.set(SecureKeyNames.Settings, key)

    // Store is still plaintext (fresh install or pre-encryption data): encrypt it in place
    const store = createMMKV({ id: DEFAULT_ID })
    SecureKeys.set(SecureKeyNames.SettingsEncrypted, 'pending')
    store.recrypt(key)
    SecureKeys.set(SecureKeyNames.SettingsEncrypted, '1')
    return store
}

export const mmkv = openEncryptedStore()

/**
 * Always use these hooks instead of the ones from react-native-mmkv: the library hooks read the
 * default *unencrypted* instance.
 */
export const useMMKVBoolean = (key: string) => useMMKVBooleanBase(key, mmkv)
export const useMMKVNumber = (key: string) => useMMKVNumberBase(key, mmkv)
export const useMMKVString = (key: string) => useMMKVStringBase(key, mmkv)

export const mmkvStorage: StateStorage = {
    setItem: (name, value) => {
        return mmkv.set(name, value)
    },
    getItem: (name) => {
        const value = mmkv.getString(name)
        return value ?? null
    },
    removeItem: (name) => {
        return mmkv.remove(name)
    },
}

export const createMMKVStorage = () => {
    return createJSONStorage(() => mmkvStorage)
}
