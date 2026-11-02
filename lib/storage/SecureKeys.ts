import { getRandomBytes } from 'expo-crypto'
import * as SecureStore from 'expo-secure-store'

/**
 * Encryption keys for data at rest.
 *
 * Keys are generated on the device and kept in Android's hardware-backed keystore via
 * expo-secure-store. They never leave the device and are not part of any backup, which is why
 * Android cloud backup is disabled for this app (see app.config.js).
 */

const KEY_PREFIX = 'chatteruiplus.'

export const SecureKeyNames = {
    /** 32 random bytes, hex encoded - SQLCipher raw key for db.db */
    Database: KEY_PREFIX + 'db-key',
    /** Key generated for a plaintext -> encrypted migration that has not been confirmed yet */
    DatabasePending: KEY_PREFIX + 'db-key-pending',
    /** 16 character key - MMKV supports at most 16 bytes */
    Settings: KEY_PREFIX + 'mmkv-key',
    /** Set once the settings store has been re-encrypted with the settings key */
    SettingsEncrypted: KEY_PREFIX + 'mmkv-encrypted',
} as const

type SecureKeyName = (typeof SecureKeyNames)[keyof typeof SecureKeyNames]

export const toHex = (bytes: Uint8Array) =>
    Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')

const KEY_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

/** Printable key built from random bytes. 64 symbol alphabet = 6 bits per character. */
export const randomPrintableKey = (length: number) => {
    const bytes = getRandomBytes(length)
    let out = ''
    for (let i = 0; i < length; i++) out += KEY_ALPHABET[bytes[i] & 63]
    return out
}

export const randomHexKey = (byteCount: number = 32) => toHex(getRandomBytes(byteCount))

export const SecureKeys = {
    get: (name: SecureKeyName): string | null => SecureStore.getItem(name),
    set: (name: SecureKeyName, value: string) => SecureStore.setItem(name, value),
    remove: (name: SecureKeyName) => SecureStore.deleteItemAsync(name),
}

/** SQL literal for a raw 256-bit SQLCipher key */
export const sqlcipherRawKey = (hexKey: string) => {
    if (!/^[0-9a-f]{64}$/.test(hexKey)) throw new Error('Invalid database key format')
    return `"x'${hexKey}'"`
}

/** SQL literal for a user passphrase (used for backups) */
export const sqlcipherPassphrase = (passphrase: string) => `'${passphrase.replaceAll("'", "''")}'`
