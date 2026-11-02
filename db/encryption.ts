import { File } from 'expo-file-system'
import { defaultDatabaseDirectory, openDatabaseSync, SQLiteDatabase } from 'expo-sqlite'

import { mmkv } from '@lib/storage/MMKV'
import { randomHexKey, SecureKeyNames, SecureKeys, sqlcipherRawKey } from '@lib/storage/SecureKeys'

/**
 * Database encryption at rest (SQLCipher, enabled via `useSQLCipher` in app.config.js).
 *
 * - db.db is encrypted with a random 256-bit key kept in the Android keystore.
 * - A plaintext db.db (from before encryption existed) is converted on first launch.
 * - Backups being restored are prepared as `<name>.import` (already encrypted with the device
 *   key) and swapped in here, before the database is opened.
 *
 * All file operations here are synchronous on purpose: they must finish before SQLite opens
 * the database path.
 */

export const RERUN_DATA_MIGRATIONS_FLAG = 'chatteruiplus.rerun-data-migrations'

const dirPath = (defaultDatabaseDirectory as string).replace(/^file:\/\//, '').replace(/\/$/, '')

export const databasePath = (name: string) => `${dirPath}/${name}`
const fileOf = (name: string) => new File('file://' + databasePath(name))

const SIDECARS = ['-journal', '-wal', '-shm']

const deleteIfExists = (name: string) => {
    const file = fileOf(name)
    if (file.exists) file.delete()
}

const deleteWithSidecars = (name: string) => {
    deleteIfExists(name)
    for (const suffix of SIDECARS) deleteIfExists(name + suffix)
}

/** Moves a database and its journal files together, replacing whatever is at the target. */
const moveWithSidecars = (from: string, to: string) => {
    deleteWithSidecars(to)
    fileOf(from).moveSync(fileOf(to))
    for (const suffix of SIDECARS) {
        const sidecar = fileOf(from + suffix)
        if (sidecar.exists) sidecar.moveSync(fileOf(to + suffix))
    }
}

export const importStagingName = (name: string) => `${name}.import`
export const safetyCopyName = (name: string) => `${name}.before-restore`
const previousSafetyName = (name: string) => `${name}.before-restore.old`

const probe = (name: string, hexKey?: string) => {
    let connection: SQLiteDatabase | undefined
    try {
        connection = openDatabaseSync(name, { useNewConnection: true })
        if (hexKey) connection.execSync(`PRAGMA key = ${sqlcipherRawKey(hexKey)};`)
        connection.getFirstSync('SELECT count(*) FROM sqlite_master;')
        return true
    } catch {
        return false
    } finally {
        try {
            connection?.closeSync()
        } catch {}
    }
}

/** Swap in a restored backup that was prepared by the backup screen. */
const applyStagedImport = (name: string) => {
    if (!fileOf(importStagingName(name)).exists) return
    console.log('[DB] Applying restored backup')
    // keep the previous safety copy until the swap has fully succeeded
    if (fileOf(safetyCopyName(name)).exists)
        moveWithSidecars(safetyCopyName(name), previousSafetyName(name))
    if (fileOf(name).exists) moveWithSidecars(name, safetyCopyName(name))
    moveWithSidecars(importStagingName(name), name)
    deleteWithSidecars(previousSafetyName(name))
    // data migrations are tracked in settings, which describe the *old* database
    mmkv.set(RERUN_DATA_MIGRATIONS_FLAG, true)
}

const plaintextBackupName = (name: string) => name + '.plaintext'
const encryptingName = (name: string) => name + '.encrypting'

/** Converts a plaintext database to an encrypted one and returns the key. */
const encryptPlaintextDatabase = (name: string): string => {
    const tempName = encryptingName(name)
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

    if (!probe(tempName, key)) throw new Error('Encrypted copy could not be verified')

    // keep the plaintext original until the encrypted copy is in place
    moveWithSidecars(name, plaintextBackupName(name))
    moveWithSidecars(tempName, name)
    SecureKeys.set(SecureKeyNames.Database, key)
    deleteWithSidecars(plaintextBackupName(name))
    SecureKeys.remove(SecureKeyNames.DatabasePending)
    return key
}

/** Finishes a conversion that was interrupted part way. */
const recoverInterruptedEncryption = (name: string) => {
    if (!fileOf(name).exists && fileOf(plaintextBackupName(name)).exists) {
        // interrupted between the two moves: put the original back and start again
        moveWithSidecars(plaintextBackupName(name), name)
    }
    deleteWithSidecars(encryptingName(name))
}

class MissingKeyError extends Error {}

const resolveDatabaseKey = (name: string): string => {
    // A keystore read error is thrown, not treated as "no key": a temporary failure must never
    // lead to a new key being written over the real one.
    const key = SecureKeys.get(SecureKeyNames.Database)
    if (key) return key

    recoverInterruptedEncryption(name)

    if (!fileOf(name).exists) {
        // Fresh install
        const fresh = randomHexKey()
        SecureKeys.set(SecureKeyNames.Database, fresh)
        return fresh
    }

    // An interrupted conversion may have already swapped in the encrypted file
    const pending = SecureKeys.get(SecureKeyNames.DatabasePending)
    if (pending && probe(name, pending)) {
        SecureKeys.set(SecureKeyNames.Database, pending)
        SecureKeys.remove(SecureKeyNames.DatabasePending)
        return pending
    }

    if (probe(name)) return encryptPlaintextDatabase(name)

    throw new MissingKeyError('Database is encrypted but its key is missing')
}

/**
 * Set when the real database could not be unlocked. The app then runs on an empty in-memory
 * database and shows an error screen, so nothing on disk is touched.
 */
export let databaseOpenError: string | undefined

export const openEncryptedDatabase = (
    name: string,
    open: (name: string) => SQLiteDatabase
): SQLiteDatabase => {
    try {
        return openEncryptedDatabaseInternal(name, open)
    } catch (e) {
        console.error('[DB] Could not open database', e)
        databaseOpenError = `${e}`
        return openDatabaseSync(':memory:')
    }
}

const openEncryptedDatabaseInternal = (
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
        if (!(e instanceof MissingKeyError)) throw e // keystore trouble: fail, change nothing
        // The file is encrypted and no key exists anywhere, so it can never be opened again.
        // Keep it aside anyway and start with an empty database.
        const target = `${name}.unreadable-${Date.now()}`
        console.error(`[DB] ${e}. Moved to ${target}`)
        moveWithSidecars(name, target)
        key = randomHexKey()
        SecureKeys.set(SecureKeyNames.Database, key)
    }

    const database = open(name)
    try {
        database.execSync(`PRAGMA key = ${sqlcipherRawKey(key)};`)
        // A wrong key shows up here as "file is not a database". Nothing is moved or replaced:
        // the error screen is shown and the data stays where it is.
        database.getFirstSync('SELECT count(*) FROM sqlite_master;')
    } catch (e) {
        try {
            database.closeSync()
        } catch {}
        throw e
    }
    return database
}

/** Raw key for the open database, needed to build encrypted copies (restore). */
export const getDatabaseKey = () => {
    const key = SecureKeys.get(SecureKeyNames.Database)
    if (!key) throw new Error('Database key missing')
    return key
}
