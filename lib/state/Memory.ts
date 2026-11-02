import { desc, eq } from 'drizzle-orm'

import { db as database } from '@db/db'
import { chatMemoryState, ChatMemoryStateType, memories } from '@db/schema'

export const MAX_STORED_MEMORIES = 200

export namespace Memory {
    export namespace db {
        export namespace query {
            export const all = () =>
                database.query.memories.findMany({ orderBy: desc(memories.created_at) })

            export const enabledContents = async () => {
                const rows = await database.query.memories.findMany({
                    where: eq(memories.enabled, true),
                    orderBy: desc(memories.created_at),
                })
                return rows.map((row) => row.content)
            }

            export const allContents = async () =>
                (await database.query.memories.findMany()).map((row) => row.content)

            export const chatState = async (chatId: number): Promise<ChatMemoryStateType> => {
                const row = await database.query.chatMemoryState.findFirst({
                    where: eq(chatMemoryState.chat_id, chatId),
                })
                return (
                    row ?? {
                        chat_id: chatId,
                        summary: '',
                        summary_until_entry_id: 0,
                        summary_token_count: 0,
                        memory_until_entry_id: 0,
                    }
                )
            }
        }

        export namespace mutate {
            export const add = async (content: string, sourceChatId?: number) => {
                const trimmed = content.trim()
                if (!trimmed) return
                const count = (await database.query.memories.findMany({ columns: { id: true } }))
                    .length
                if (count >= MAX_STORED_MEMORIES) return
                await database
                    .insert(memories)
                    .values({ content: trimmed, source_chat_id: sourceChatId ?? null })
            }

            export const update = async (id: number, content: string) => {
                const trimmed = content.trim()
                if (!trimmed) return
                await database.update(memories).set({ content: trimmed }).where(eq(memories.id, id))
            }

            export const setEnabled = async (id: number, enabled: boolean) => {
                await database.update(memories).set({ enabled }).where(eq(memories.id, id))
            }

            export const remove = async (id: number) => {
                await database.delete(memories).where(eq(memories.id, id))
            }

            export const removeAll = async () => {
                await database.delete(memories)
            }

            export const saveChatState = async (
                state: Partial<ChatMemoryStateType> & { chat_id: number }
            ) => {
                const { chat_id, ...values } = state
                await database
                    .insert(chatMemoryState)
                    .values({ chat_id, ...values })
                    .onConflictDoUpdate({ target: chatMemoryState.chat_id, set: values })
            }

            export const clearChatSummary = async (chatId: number) => {
                await saveChatState({
                    chat_id: chatId,
                    summary: '',
                    summary_until_entry_id: 0,
                    summary_token_count: 0,
                })
            }
        }
    }
}
