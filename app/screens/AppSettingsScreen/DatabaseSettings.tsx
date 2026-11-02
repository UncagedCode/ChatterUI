import { getDocumentAsync } from 'expo-document-picker'
import React, { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Text, View } from 'react-native'

import ThemedButton from '@components/buttons/ThemedButton'
import SectionTitle from '@components/text/SectionTitle'
import Alert from '@components/views/Alert'
import { BottomSheetRefFunctions } from '@components/views/BottomSheet'
import InputSheet from '@components/views/InputSheet'
import { migrateData } from '@db/dataMigrations'
import { Logger } from '@lib/state/Logger'
import {
    exportBackup,
    hasSafetyCopy,
    prepareRestore,
    restartApp,
    undoLastRestore,
} from '@lib/storage/Backup'
import { Theme } from '@lib/theme/ThemeManager'

const DatabaseSettings = () => {
    const { t } = useTranslation()
    const { color, spacing } = Theme.useTheme()
    const exportSheet = useRef<BottomSheetRefFunctions>(null)
    const restoreSheet = useRef<BottomSheetRefFunctions>(null)
    const [restoreUri, setRestoreUri] = useState<string | undefined>()
    const [busy, setBusy] = useState(false)
    const [canUndo, setCanUndo] = useState(() => hasSafetyCopy())

    const runExport = async (password: string) => {
        setBusy(true)
        const result = await exportBackup(password)
        setBusy(false)
        if (result.ok) Logger.infoToast(t('plus.backup.toast.saved', { name: result.name }))
        else Logger.errorToast(t('plus.backup.toast.failed', { error: result.error }))
    }

    const runRestore = async (password: string) => {
        if (!restoreUri) return
        setBusy(true)
        const result = await prepareRestore(restoreUri, password)
        setBusy(false)
        setRestoreUri(undefined)
        if (!result.ok) {
            Alert.alert({
                title: t('plus.backup.restoreFailed.title'),
                description: t(`plus.backup.restoreFailed.${result.reason}`),
                buttons: [{ label: t('common.actions.close') }],
            })
            return
        }
        Alert.alert({
            title: t('plus.backup.restoreReady.title'),
            description:
                t('plus.backup.restoreReady.description') +
                (result.upgradeSteps > 0 ? '\n\n' + t('plus.backup.restoreReady.upgrade') : ''),
            buttons: [{ label: t('plus.backup.restoreReady.confirm'), onPress: restartApp }],
            onDismiss: restartApp,
        })
    }

    const pickBackup = async () => {
        const result = await getDocumentAsync({ type: ['application/*'] })
        if (result.canceled) return
        setRestoreUri(result.assets[0].uri)
        restoreSheet.current?.open()
    }

    const rerunMigrations = () => {
        Alert.alert({
            title: t('settings.database.alert.rerunMigrations.title'),
            description: t('settings.database.alert.rerunMigrations.description'),
            buttons: [
                { label: t('common.actions.cancel') },
                {
                    label: t('settings.database.alert.rerunMigrations.confirm'),
                    onPress: () => migrateData({ bypass: true }),
                    type: 'warning',
                },
            ],
        })
    }

    return (
        <View style={{ rowGap: 8 }}>
            <SectionTitle>{t('plus.backup.title')}</SectionTitle>

            <Text
                style={{
                    color: color.text._500,
                    paddingBottom: spacing.xs,
                    marginBottom: spacing.m,
                }}>
                {t('plus.backup.description')}
            </Text>

            <ThemedButton
                label={t('plus.backup.createButton')}
                variant={busy ? 'disabled' : 'secondary'}
                onPress={() => exportSheet.current?.open()}
            />

            <ThemedButton
                label={t('plus.backup.restoreButton')}
                variant={busy ? 'disabled' : 'secondary'}
                onPress={pickBackup}
            />

            {canUndo && (
                <ThemedButton
                    label={t('plus.backup.undoButton')}
                    variant={busy ? 'disabled' : 'secondary'}
                    onPress={() =>
                        Alert.alert({
                            title: t('plus.backup.undo.title'),
                            description: t('plus.backup.undo.description'),
                            buttons: [
                                { label: t('common.actions.cancel') },
                                {
                                    label: t('plus.backup.undo.confirm'),
                                    type: 'warning',
                                    onPress: () => {
                                        if (undoLastRestore()) restartApp()
                                        else setCanUndo(false)
                                    },
                                },
                            ],
                        })
                    }
                />
            )}

            <ThemedButton
                label={t('settings.database.rerunMigrationsButton')}
                variant={busy ? 'disabled' : 'secondary'}
                onPress={rerunMigrations}
            />

            <InputSheet
                ref={exportSheet}
                secure
                title={t('plus.backup.create.title')}
                description={t('plus.backup.create.description')}
                placeholder={t('plus.backup.passwordPlaceholder')}
                confirmLabel={t('plus.backup.create.confirm')}
                onConfirm={runExport}
            />

            <InputSheet
                ref={restoreSheet}
                secure
                title={t('plus.backup.restore.title')}
                description={t('plus.backup.restore.description')}
                placeholder={t('plus.backup.passwordPlaceholder')}
                confirmLabel={t('plus.backup.restore.confirm')}
                onConfirm={runRestore}
            />
        </View>
    )
}

export default DatabaseSettings
