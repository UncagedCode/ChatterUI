/**
 * Decides whether a backup can be restored into this app version.
 *
 * Every schema change ships as a drizzle migration with a timestamp (`when` in the journal).
 * A restored database records which migrations it has applied in `__drizzle_migrations`.
 *
 * - Backup is older (or same): restore it, and the normal startup migrations bring it up to date.
 * - Backup has migrations this app does not know: it came from a newer version and would break.
 */

export type BackupCompatibility =
    | { status: 'compatible'; upgradeSteps: number }
    | { status: 'newer'; unknownSteps: number }
    | { status: 'not_chatterui' }

export const checkBackupCompatibility = (
    backupMigrationTimes: number[] | null,
    appMigrationTimes: number[]
): BackupCompatibility => {
    if (!backupMigrationTimes || backupMigrationTimes.length === 0)
        return { status: 'not_chatterui' }

    const known = new Set(appMigrationTimes)
    const unknownSteps = backupMigrationTimes.filter((time) => !known.has(time)).length
    const newestBackup = Math.max(...backupMigrationTimes)
    const newestApp = Math.max(...appMigrationTimes)

    if (unknownSteps > 0 && newestBackup > newestApp) return { status: 'newer', unknownSteps }

    const applied = new Set(backupMigrationTimes)
    const upgradeSteps = appMigrationTimes.filter((time) => !applied.has(time)).length
    return { status: 'compatible', upgradeSteps }
}

/** File name for a new backup, e.g. `0.10.1-ChatterUIPlus-backup-2026-11-02_2305.db` */
export const backupFileName = (appVersion: string, date: Date, encrypted: boolean) => {
    const pad = (n: number) => n.toString().padStart(2, '0')
    const stamp =
        `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
        `_${pad(date.getHours())}${pad(date.getMinutes())}`
    return `${appVersion}-ChatterUIPlus-backup${encrypted ? '-encrypted' : ''}-${stamp}.db`
}
