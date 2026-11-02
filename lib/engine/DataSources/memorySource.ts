import { AppSettings } from '@lib/constants/GlobalValues'
import { Chats } from '@lib/state/Chat'
import { Memory } from '@lib/state/Memory'
import { mmkv } from '@lib/storage/MMKV'

import { DataSource } from './types'
import { buildMemoryBlock, buildSummaryBlock, estimateTokens } from '../Memory/MemoryPrompts'

/** at most this share of the context window is spent on remembered facts */
const MEMORY_CONTEXT_SHARE = 0.2

export const createUserMemoryDataSource = async (): Promise<DataSource | undefined> => {
    if (!(mmkv.getBoolean(AppSettings.AutoMemory) ?? true)) return
    // incognito chats start from a blank slate
    if (Chats.useChatState.getState().incognito) return
    const facts = await Memory.db.query.enabledContents()
    if (facts.length === 0) return
    const estimate = estimateTokens(buildMemoryBlock(facts))

    return {
        name: 'user_memory',
        priority: 0,
        tokenBudget: estimate,
        retrieve: async (params) => {
            const budget = Math.min(estimate, Math.floor(params.maxLength * MEMORY_CONTEXT_SHARE))
            // newest facts first, drop older ones if the window is small
            const kept: string[] = []
            for (const fact of facts) {
                if (estimateTokens(buildMemoryBlock([...kept, fact])) > budget) break
                kept.push(fact)
            }
            if (kept.length === 0) return []
            const content = buildMemoryBlock(kept)
            return [
                {
                    content,
                    source: 'user_memory',
                    tokenLength: await params.tokenizer(content),
                    position: { type: 'relative', location: 'afterSystem' },
                },
            ]
        },
    }
}

export const createChatSummaryDataSource = async (): Promise<DataSource | undefined> => {
    if (!(mmkv.getBoolean(AppSettings.ChatSummaries) ?? true)) return
    if (Chats.useChatState.getState().incognito) return
    const chatId = Chats.useChatState.getState().id
    if (!chatId) return
    const state = await Memory.db.query.chatState(chatId)
    if (!state.summary) return
    const content = buildSummaryBlock(state.summary)

    return {
        name: 'chat_summary',
        priority: 0,
        tokenBudget: state.summary_token_count || estimateTokens(content),
        retrieve: async (
            params,
            messages,
            maxLength,
            currentLength,
            budget,
            lastMessageReached
        ) => {
            // the whole chat fits: the summary would only repeat it
            if (lastMessageReached) return []
            return [
                {
                    content,
                    source: 'chat_summary',
                    tokenLength: await params.tokenizer(content),
                    position: { type: 'relative', location: 'afterSystem' },
                },
            ]
        },
    }
}
