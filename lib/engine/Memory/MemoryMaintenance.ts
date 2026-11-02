import { t } from 'i18next'

import { AppSettings } from '@lib/constants/GlobalValues'
import { Llama } from '@lib/engine/Local/LlamaLocal'
import { Chats, useInference } from '@lib/state/Chat'
import { Logger } from '@lib/state/Logger'
import { Memory } from '@lib/state/Memory'
import { SamplersManager } from '@lib/state/SamplerState'
import { mmkv } from '@lib/storage/MMKV'

import { canRunSideTask, isSideTaskCancelled, runSideCompletion } from '../SideTask'
import {
    buildMemoryExtractionMessages,
    buildSummaryMessages,
    cleanSummary,
    estimateTokens,
    parseExtractedFacts,
    selectLinesForMemoryScan,
    selectLinesToSummarise,
    TranscriptLine,
} from './MemoryPrompts'

const IDLE_DELAY_MS = 1500

const loadTranscript = async (chatId: number): Promise<TranscriptLine[]> => {
    const chat = await Chats.db.query.chat(chatId)
    if (!chat) return []
    return chat.messages
        .map((entry) => {
            const swipe = entry.swipes[0]
            const text = swipe?.swipe ?? ''
            return {
                id: entry.id,
                isUser: entry.is_user,
                name: entry.name,
                text,
                tokens: swipe?.token_length || estimateTokens(text),
            }
        })
        .filter((line) => line.text.trim().length > 0)
        .sort((a, b) => a.id - b.id)
}

const contextLength = () => {
    const config = Llama.useLlamaPreferencesStore.getState().config
    const genamt = Number(SamplersManager.getCurrentSampler().genamt ?? 0)
    return Math.max(config.context_length - genamt, 512)
}

const updateSummary = async (chatId: number, lines: TranscriptLine[]) => {
    const state = await Memory.db.query.chatState(chatId)
    const batch = selectLinesToSummarise(lines, contextLength(), state.summary_until_entry_id)
    if (batch.length === 0) return

    Logger.info(`[Memory] Summarising ${batch.length} older messages`)
    const output = await runSideCompletion(buildSummaryMessages(state.summary, batch), {
        maxTokens: 400,
        label: 'summary',
    })
    if (!output) return
    const summary = cleanSummary(output)
    if (!summary) return
    const tokens =
        (await Llama.useLlamaModelStore.getState().tokenLength(summary)) || estimateTokens(summary)
    await Memory.db.mutate.saveChatState({
        chat_id: chatId,
        summary,
        summary_until_entry_id: batch[batch.length - 1].id,
        summary_token_count: tokens,
    })
}

const updateMemories = async (chatId: number, lines: TranscriptLine[]) => {
    const state = await Memory.db.query.chatState(chatId)
    const fresh = selectLinesForMemoryScan(lines, state.memory_until_entry_id)
    if (fresh.length === 0) return

    const existing = await Memory.db.query.allContents()
    Logger.info(`[Memory] Checking ${fresh.length} messages for things to remember`)
    // the newest messages are the most useful; keep the prompt small
    const output = await runSideCompletion(
        buildMemoryExtractionMessages(existing.slice(0, 60), fresh.slice(-16)),
        { maxTokens: 200, label: 'memory' }
    )
    if (output === undefined) return
    const facts = parseExtractedFacts(output, existing)
    for (const fact of facts) await Memory.db.mutate.add(fact, chatId)
    await Memory.db.mutate.saveChatState({
        chat_id: chatId,
        memory_until_entry_id: fresh[fresh.length - 1].id,
    })
    if (facts.length > 0)
        Logger.infoToast(t('plus.memory.toast.remembered', { count: facts.length }))
}

export const maintainChat = async (chatId: number) => {
    const summaries = mmkv.getBoolean(AppSettings.ChatSummaries) ?? true
    const autoMemory = mmkv.getBoolean(AppSettings.AutoMemory) ?? true
    if (!summaries && !autoMemory) return
    if (!canRunSideTask()) return

    try {
        const lines = await loadTranscript(chatId)
        if (summaries) await updateSummary(chatId, lines)
        if (isSideTaskCancelled() || useInference.getState().nowGenerating) return
        if (autoMemory) await updateMemories(chatId, lines)
    } catch (e) {
        Logger.warn(`[Memory] Maintenance failed: ${e}`)
    }
}

let timer: ReturnType<typeof setTimeout> | undefined
let subscribed = false

/** Runs memory upkeep shortly after each finished reply, while the user is reading it. */
export const startMemoryMaintenance = () => {
    if (subscribed) return
    subscribed = true
    useInference.subscribe((state, previous) => {
        if (state.nowGenerating) {
            if (timer) clearTimeout(timer)
            return
        }
        if (!previous.nowGenerating) return
        const { id: chatId, incognito } = Chats.useChatState.getState()
        // nothing from an incognito chat is summarised or remembered
        if (!chatId || incognito) return
        if (timer) clearTimeout(timer)
        timer = setTimeout(() => {
            if (useInference.getState().nowGenerating) return
            const current = Chats.useChatState.getState()
            if (current.incognito || current.id !== chatId) return
            maintainChat(chatId)
        }, IDLE_DELAY_MS)
    })
}
