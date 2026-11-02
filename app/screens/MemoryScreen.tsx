import { desc } from 'drizzle-orm'
import { useLiveQuery } from 'drizzle-orm/expo-sqlite'
import React, { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FlatList, Switch, Text, TouchableOpacity, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import ThemedButton from '@components/buttons/ThemedButton'
import ThemedSwitch from '@components/input/ThemedSwitch'
import SectionTitle from '@components/text/SectionTitle'
import Alert from '@components/views/Alert'
import { BottomSheetRefFunctions } from '@components/views/BottomSheet'
import HeaderTitle from '@components/views/HeaderTitle'
import InputSheet from '@components/views/InputSheet'
import { db } from '@db/db'
import { memories, MemoryType } from '@db/schema'
import { AppSettings } from '@lib/constants/GlobalValues'
import { Chats } from '@lib/state/Chat'
import { Memory } from '@lib/state/Memory'
import { useMMKVBoolean } from '@lib/storage/MMKV'
import { Theme } from '@lib/theme/ThemeManager'

type MemoryRowProps = {
    item: MemoryType
    onEdit: (item: MemoryType) => void
    onDelete: (item: MemoryType) => void
}

const MemoryRow = ({ item, onEdit, onDelete }: MemoryRowProps) => {
    const { color, spacing, borderRadius } = Theme.useTheme()
    return (
        <TouchableOpacity
            onPress={() => onEdit(item)}
            onLongPress={() => onDelete(item)}
            style={{
                flexDirection: 'row',
                alignItems: 'center',
                columnGap: spacing.m,
                paddingVertical: spacing.m,
                paddingHorizontal: spacing.l,
                marginBottom: spacing.s,
                borderRadius: borderRadius.m,
                backgroundColor: color.neutral._200,
            }}>
            <Text
                style={{
                    flex: 1,
                    color: item.enabled ? color.text._100 : color.text._500,
                    textDecorationLine: item.enabled ? 'none' : 'line-through',
                }}>
                {item.content}
            </Text>
            <Switch
                value={item.enabled}
                onValueChange={(value) => Memory.db.mutate.setEnabled(item.id, value)}
                trackColor={{ false: color.neutral._300, true: color.neutral._500 }}
                thumbColor={item.enabled ? color.primary._500 : color.neutral._400}
            />
        </TouchableOpacity>
    )
}

const MemoryScreen = () => {
    const { t } = useTranslation()
    const { color, spacing } = Theme.useTheme()
    const [autoMemory, setAutoMemory] = useMMKVBoolean(AppSettings.AutoMemory)
    const [summaries, setSummaries] = useMMKVBoolean(AppSettings.ChatSummaries)
    const { data } = useLiveQuery(
        db.query.memories.findMany({ orderBy: desc(memories.created_at) })
    )
    const addSheet = useRef<BottomSheetRefFunctions>(null)
    const editSheet = useRef<BottomSheetRefFunctions>(null)
    const [editing, setEditing] = useState<{ item: MemoryType; nonce: number } | undefined>()

    // the editor is re-created for each edit so it starts with that memory's text
    useEffect(() => {
        if (editing) editSheet.current?.open()
    }, [editing])

    const openEditor = (item: MemoryType) => setEditing({ item, nonce: Date.now() })

    const confirmDelete = (item: MemoryType) =>
        Alert.alert({
            title: t('plus.memory.delete'),
            description: item.content,
            buttons: [
                { label: t('common.actions.cancel') },
                {
                    label: t('plus.memory.delete'),
                    type: 'warning',
                    onPress: () => Memory.db.mutate.remove(item.id),
                },
            ],
        })

    const chatId = Chats.useChatState((state) => state.id)

    return (
        <SafeAreaView edges={['bottom']} style={{ flex: 1, paddingHorizontal: spacing.xl }}>
            <HeaderTitle title={t('plus.memory.title')} />
            <FlatList
                data={data ?? []}
                keyExtractor={(item) => item.id.toString()}
                ListHeaderComponent={
                    <View style={{ rowGap: spacing.m, marginBottom: spacing.l }}>
                        <Text style={{ color: color.text._400 }}>
                            {t('plus.memory.description')}
                        </Text>
                        <ThemedSwitch
                            label={t('plus.memory.autoMemory')}
                            description={t('plus.memory.autoMemoryDescription')}
                            value={autoMemory}
                            onChangeValue={setAutoMemory}
                        />
                        <ThemedSwitch
                            label={t('plus.memory.summaries')}
                            description={t('plus.memory.summariesDescription')}
                            value={summaries}
                            onChangeValue={setSummaries}
                        />
                        {chatId !== undefined && (
                            <ThemedButton
                                variant="secondary"
                                label={t('plus.memory.resetSummary')}
                                onPress={() =>
                                    Alert.alert({
                                        title: t('plus.memory.resetSummary'),
                                        description: t('plus.memory.resetSummaryDescription'),
                                        buttons: [
                                            { label: t('common.actions.cancel') },
                                            {
                                                label: t('plus.memory.reset'),
                                                type: 'warning',
                                                onPress: () =>
                                                    Memory.db.mutate.clearChatSummary(chatId),
                                            },
                                        ],
                                    })
                                }
                            />
                        )}
                        <SectionTitle>
                            {t('plus.memory.listTitle', { count: data?.length ?? 0 })}
                        </SectionTitle>
                        <Text style={{ color: color.text._500 }}>{t('plus.memory.listHint')}</Text>
                        <ThemedButton
                            label={t('plus.memory.add')}
                            iconName="plus"
                            onPress={() => addSheet.current?.open()}
                        />
                    </View>
                }
                ListEmptyComponent={
                    <Text style={{ color: color.text._500, textAlign: 'center' }}>
                        {t('plus.memory.empty')}
                    </Text>
                }
                renderItem={({ item }) => (
                    <MemoryRow item={item} onEdit={openEditor} onDelete={confirmDelete} />
                )}
                ListFooterComponent={
                    data && data.length > 0 ? (
                        <View style={{ marginTop: spacing.xl, marginBottom: spacing.xl2 }}>
                            <ThemedButton
                                variant="critical"
                                label={t('plus.memory.forgetAll')}
                                onPress={() =>
                                    Alert.alert({
                                        title: t('plus.memory.forgetAll'),
                                        description: t('plus.memory.forgetAllDescription'),
                                        buttons: [
                                            { label: t('common.actions.cancel') },
                                            {
                                                label: t('plus.memory.forgetAll'),
                                                type: 'warning',
                                                onPress: Memory.db.mutate.removeAll,
                                            },
                                        ],
                                    })
                                }
                            />
                        </View>
                    ) : null
                }
            />

            <InputSheet
                ref={addSheet}
                title={t('plus.memory.add')}
                description={t('plus.memory.addDescription')}
                placeholder={t('plus.memory.placeholder')}
                multiline
                verifyText={(text) => (text.trim() ? '' : t('plus.memory.emptyError'))}
                onConfirm={(text) => Memory.db.mutate.add(text)}
            />

            {editing && (
                <InputSheet
                    key={`${editing.item.id}-${editing.nonce}`}
                    ref={editSheet}
                    title={t('plus.memory.edit')}
                    description={t('plus.memory.editDescription')}
                    defaultValue={editing.item.content}
                    multiline
                    confirmLabel={t('common.actions.save')}
                    verifyText={(text) => (text.trim() ? '' : t('plus.memory.emptyError'))}
                    onConfirm={(text) => Memory.db.mutate.update(editing.item.id, text)}
                />
            )}
        </SafeAreaView>
    )
}

export default MemoryScreen
