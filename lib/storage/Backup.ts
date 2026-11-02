import { localDownload } from '@vali98/react-native-fs'
import { reloadAppAsync } from 'expo'
import { File, Paths } from 'expo-file-system'

import appConfig from '@appconfig'
import { DB_NAME, sqliteDB } from '@db/db'
import {
    databasePath,
    getDatabaseKey,
    importStagingName,
    safetyCopyName,
} from '@db/encryption'
import { Logger } from '@lib/state/Logger'

import migrations from '../../db/migrations/migrations'
import { backupFileName, checkBackupCompatibility } from './BackupCompat'
import { sqlcipherPassphrase, sqlcipherRawKey } from './SecureKeys'

const appVersion: string = appConfig.expo.version

const sqlPath = (path: string) => `'${path.replace(/^file:\/\//, '').replaceAll("'", "''")}'`

const appMigrationTimes = (): number[] =>
    (migrations.journal.entries as { when: number }[]).map((entry) => entry.when)

const detachQuietly = (alias: string) => {
    try {
        sqliteDB.execSync(`DETACH DATABASE ${alias};`)
    } catch {}
}

/**
 * Writes a copy of all chats, characters and settings stored in the database to Downloads.
 * With a password the copy is encrypted (SQLCipher). Without one it is a normal SQLite file
 * that the official ChatterUI can also import.
 */
export const exportBackup = async (password: string) => {
    const encrypted = password.length > 0
    const name = backupFileName(appVersion, new Date(), encrypted)
    const target = new File(Paths.cache, name)
    if (target.exists) target.delete()

    try {
        const key = encrypted ? sqlcipherPassphrase(password) : "''"
        sqliteDB.execSync(`ATTACH DATABASE ${sqlPath(target.uri)} AS backup KEY ${key};`)
        sqliteDB.execSync(`SELECT sqlcipher_export('backup');`)
        // incognito chats are never part of a backup
        sqliteDB.execSync(`DELETE FROM backup.chats WHERE incognito = 1;`)
        detachQuietly('backup')
        await localDownload(target.uri.replace('file://', ''))
        return { ok: true as const, name }
    } catch (e) {
        detachQuietly('backup')
        Logger.error(`Backup failed: ${e}`)
        return { ok: false as const, error: `${e}` }
    } finally {
        if (target.exists) target.delete()
    }
}

export type RestoreResult =
    | { ok: true; upgradeSteps: number }
    | { ok: false; reason: 'wrong_password' | 'newer_version' | 'not_chatterui' | 'failed' }

const readMigrationTimes = (alias: string): number[] | null => {
    try {
        const rows = sqliteDB.getAllSync<{ created_at: number }>(
            `SELECT created_at FROM ${alias}.__drizzle_migrations;`
        )
        return rows.map((row) => Number(row.created_at))
    } catch {
        return null
    }
}

const attachSource = (path: string, password: string): boolean => {
    // try the given password first, then as an unencrypted file (official ChatterUI backups)
    const attempts = password.length > 0 ? [sqlcipherPassphrase(password), "''"] : ["''"]
    for (const key of attempts) {
        try {
            sqliteDB.execSync(`ATTACH DATABASE ${sqlPath(path)} AS restore_src KEY ${key};`)
            sqliteDB.getFirstSync('SELECT count(*) FROM restore_src.sqlite_master;')
            return true
        } catch {
            detachQuietly('restore_src')
        }
    }
    return false
}

/**
 * Checks a backup and prepares it to replace the current database on the next start.
 * Older backups are upgraded by the normal startup migrations. The current database is kept
 * as a safety copy, so the restore can be undone.
 */
export const prepareRestore = async (uri: string, password: string): Promise<RestoreResult> => {
    const source = new File(Paths.cache, 'restore-source.db')
    const staging = new File('file://' + databasePath(importStagingName(DB_NAME)))
    try {
        if (source.exists) source.delete()
        new File(uri).copy(source)
        if (staging.exists) staging.delete()

        if (!attachSource(source.uri, password)) return { ok: false, reason: 'wrong_password' }

        const compatibility = checkBackupCompatibility(
            readMigrationTimes('restore_src'),
            appMigrationTimes()
        )
        if (compatibility.status === 'newer') {
            detachQuietly('restore_src')
            return { ok: false, reason: 'newer_version' }
        }
        if (compatibility.status === 'not_chatterui') {
            detachQuietly('restore_src')
            return { ok: false, reason: 'not_chatterui' }
        }

        sqliteDB.execSync(
            `ATTACH DATABASE ${sqlPath(staging.uri)} AS restore_dst KEY ${sqlcipherRawKey(getDatabaseKey())};`
        )
        sqliteDB.execSync(`SELECT sqlcipher_export('restore_dst', 'restore_src');`)
        detachQuietly('restore_dst')
        detachQuietly('restore_src')
        return { ok: true, upgradeSteps: compatibility.upgradeSteps }
    } catch (e) {
        detachQuietly('restore_dst')
        detachQuietly('restore_src')
        if (staging.exists) staging.delete()
        Logger.error(`Restore failed: ${e}`)
        return { ok: false, reason: 'failed' }
    } finally {
        if (source.exists) source.delete()
    }
}

export const hasSafetyCopy = () =>
    new File('file://' + databasePath(safetyCopyName(DB_NAME))).exists

/** Puts back the database that was replaced by the last restore. */
export const undoLastRestore = () => {
    const safety = new File('file://' + databasePath(safetyCopyName(DB_NAME)))
    if (!safety.exists) return false
    const staging = new File('file://' + databasePath(importStagingName(DB_NAME)))
    if (staging.exists) staging.delete()
    safety.copy(staging)
    return true
}

export const restartApp = () => reloadAppAsync()
