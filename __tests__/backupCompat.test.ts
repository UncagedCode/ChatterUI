import { backupFileName, checkBackupCompatibility } from '../lib/storage/BackupCompat'

describe('checkBackupCompatibility', () => {
    const app = [100, 200, 300]

    it('accepts a backup from the same version', () => {
        expect(checkBackupCompatibility([100, 200, 300], app)).toEqual({
            status: 'compatible',
            upgradeSteps: 0,
        })
    })

    it('accepts an older backup and counts the upgrades it needs', () => {
        expect(checkBackupCompatibility([100], app)).toEqual({
            status: 'compatible',
            upgradeSteps: 2,
        })
    })

    it('rejects a backup from a newer version', () => {
        expect(checkBackupCompatibility([100, 200, 300, 400], app)).toEqual({
            status: 'newer',
            unknownSteps: 1,
        })
    })

    it('rejects files without migration history', () => {
        expect(checkBackupCompatibility(null, app)).toEqual({ status: 'not_chatterui' })
        expect(checkBackupCompatibility([], app)).toEqual({ status: 'not_chatterui' })
    })
})

describe('backupFileName', () => {
    it('starts with the app version and marks encryption', () => {
        const date = new Date(2026, 10, 2, 23, 5)
        expect(backupFileName('0.10.1', date, true)).toBe(
            '0.10.1-ChatterUIPlus-backup-encrypted-2026-11-02_2305.db'
        )
        expect(backupFileName('0.10.1', date, false)).toBe(
            '0.10.1-ChatterUIPlus-backup-2026-11-02_2305.db'
        )
    })
})
