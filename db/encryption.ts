import { File } from 'expo-file-system'
import { defaultDatabaseDirectory, openDatabaseSync, SQLiteDatabase } from 'expo-sqlite'

import { mmkv } from '@lib/storage/MMKV'
import {
    randomHexKey,
    SecureKeyNames,
    SecureKeys,
    sqlcipherRawKey,
} from '@lib/storage/SecureKeys'

/**
 * Database encryption at rest (SQLCipher, enabled via `useSQLCipher` in app.config.js).
 *
 * - db.db is encrypted with a random 256-bit key kept in the Android keystore.
 * - A plaintext db.db (from before encryption existed) is converted on first launch.
 * - Backups being restored are prepared as `<name>.import` (already encrypted with the device
 *   key) and swapped in here, before the database is opened.
 */

export const RERUN_DATA_MIGRATIONS_FLAG = 'chatteruiplus.rerun-data-migrations'

const dirPath = (defaultDatabaseDirectory as string).replace(/^file:\/\//, '').replace(/\/$/, '')

export const databasePath = (name: string) => `${dirPath}/${name}`
const fileOf = (name: string) => new File('file://' + databasePath(name))

const deleteIfExists = (name: string) => {
    const file = fileOf(name)
    if (file.exists) file.delete()
}

const deleteWithSidecars = (name: string) => {
    deleteIfExists(name)
    deleteIfExists(name + '-wal')
    deleteIfExists(name + '-shm')
    deleteIfExists(name + '-journal')
}

export const importStagingName = (name: string) => `${name}.import`
export const safetyCopyName = (name: string) => `${name}.before-restore`

/** Returns true if `key` opens the database file `name`. */
const keyOpens = (name: string, hexKey: string) => {
    let probe: SQLiteDatabase | undefined
    try {
        probe = openDatabaseSync(name, { useNewConnection: true })
        probe.execSync(`PRAGMA key = ${sqlcipherRawKey(hexKey)};`)
        probe.getFirstSync('SELECT count(*) FROM sqlite_master;')
        return true
    } catch {
        return false
    } finally {
        try {
            probe?.closeSync()
        } catch {}
    }
}

const isPlaintextDatabase = (name: string) => {
    let probe: SQLiteDatabase | undefined
    try {
        probe = openDatabaseSync(name, { useNewConnection: true })
        probe.getFirstSync('SELECT count(*) FROM sqlite_master;')
        return true
    } catch {
        return false
    } finally {
        try {
            probe?.closeSync()
        } catch {}
    }
}

/** Swap in a restored backup that was prepared by the backup screen. */
const applyStagedImport = (name: string) => {
    const staged = fileOf(importStagingName(name))
    if (!staged.exists) return
    console.log('[DB] Applying restored backup')
    // keep the previous database until the next restore, in case the user wants it back
    deleteWithSidecars(safetyCopyName(name))
    const current = fileOf(name)
    if (current.exists) current.move(fileOf(safetyCopyName(name)))
    deleteIfExists(name + '-wal')
    deleteIfExists(name + '-shm')
    deleteIfExists(name + '-journal')
    staged.move(fileOf(name))
    // data migrations are tracked in settings, which describe the *old* database
    mmkv.set(RERUN_DATA_MIGRATIONS_FLAG, true)
}

/** Converts a plaintext database to an encrypted one and returns the key. */
const encryptPlaintextDatabase = (name: string): string => {
    const tempName = name + '.encrypting'
    deleteWithSidecars(tempName)

    // remember the key *before* writing anything with it
    const key = SecureKeys.get(SecureKeyNames.DatabasePending) ?? randomHexKey()
    SecureKeys.set(SecureKeyNames.DatabasePending, key)

    console.log('[DB] Encrypting existing database')
    const plain = openDatabaseSync(name, { useNewConnection: true })
    try {
        const tempPath = databasePath(tempName).replaceAll("'", "''")
        plain.execSync(`ATTACH DATABASE '${tempPath}' AS encrypted KEY ${sqlcipherRawKey(key)};`)
        plain.execSync(`SELECT sqlcipher_export('encrypted');`)
        plain.execSync(`DETACH DATABASE encrypted;`)
    } finally {
        plain.closeSync()
    }

    if (!keyOpens(tempName, key)) throw new Error('Encrypted copy could not be verified')

    deleteWithSidecars(name)
    fileOf(tempName).move(fileOf(name))
    SecureKeys.set(SecureKeyNames.Database, key)
    SecureKeys.remove(SecureKeyNames.DatabasePending)
    return key
}

const resolveDatabaseKey = (name: string): string => {
    const key = SecureKeys.get(SecureKeyNames.Database)
    if (key) return key

    const exists = fileOf(name).exists
    if (!exists) {
        // Fresh install
        const fresh = randomHexKey()
        SecureKeys.set(SecureKeyNames.Database, fresh)
        return fresh
    }

    // An interrupted conversion may have already swapped in the encrypted file
    const pending = SecureKeys.get(SecureKeyNames.DatabasePending)
    if (pending && keyOpens(name, pending)) {
        SecureKeys.set(SecureKeyNames.Database, pending)
        SecureKeys.remove(SecureKeyNames.DatabasePending)
        return pending
    }

    if (isPlaintextDatabase(name)) return encryptPlaintextDatabase(name)

    throw new Error('Database is encrypted but its key is missing')
}

/** Moves an unreadable database aside so the app can start, without deleting anything. */
const quarantine = (name: string) => {
    const file = fileOf(name)
    if (!file.exists) return
    const target = `${name}.unreadable-${Date.now()}`
    console.error(`[DB] Database could not be opened, moved to ${target}`)
    file.move(fileOf(target))
    deleteIfExists(name + '-wal')
    deleteIfExists(name + '-shm')
}

export const openEncryptedDatabase = (
    name: string,
    open: (name: string) => SQLiteDatabase
): SQLiteDatabase => {
    try {
        applyStagedImport(name)
    } catch (e) {
        console.error('[DB] Failed to apply restored backup', e)
    }

    let key: string
    try {
        key = resolveDatabaseKey(name)
    } catch (e) {
        console.error('[DB]', e)
        quarantine(name)
        key = randomHexKey()
        SecureKeys.set(SecureKeyNames.Database, key)
    }

    const database = open(name)
    database.execSync(`PRAGMA key = ${sqlcipherRawKey(key)};`)
    try {
        database.getFirstSync('SELECT count(*) FROM sqlite_master;')
    } catch (e) {
        console.error('[DB] Key rejected', e)
        database.closeSync()
        quarantine(name)
        const reopened = open(name)
        reopened.execSync(`PRAGMA key = ${sqlcipherRawKey(key)};`)
        return reopened
    }
    return database
}

/** Raw key for the open database, needed to build encrypted copies (restore). */
export const getDatabaseKey = () => {
    const key = SecureKeys.get(SecureKeyNames.Database)
    if (!key) throw new Error('Database key missing')
    return key
}
