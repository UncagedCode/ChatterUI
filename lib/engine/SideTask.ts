import { create } from 'zustand'

import { Llama } from '@lib/engine/Local/LlamaLocal'
import { useAppModeStore } from '@lib/state/AppMode'
import { useInference } from '@lib/state/Chat'
import { Logger } from '@lib/state/Logger'

import type { SideMessage } from './Memory/MemoryPrompts'

/**
 * Small background jobs (summaries, memory) that use the loaded local model between chat
 * replies. They never touch the chat buffer, and a chat reply always wins: `generateResponse`
 * marks itself as generating and then calls `yieldToChat()`, which stops the running job and
 * waits for it to let go of the model.
 */

type SideTaskState = {
    running: boolean
    label?: string
    setRunning: (running: boolean, label?: string) => void
}

export const useSideTaskStore = create<SideTaskState>()((set) => ({
    running: false,
    label: undefined,
    setRunning: (running, label) => set({ running, label: running ? label : undefined }),
}))

let current: Promise<unknown> | undefined
let cancelled = false

export const isSideTaskCancelled = () => cancelled || useInference.getState().nowGenerating

export const yieldToChat = async () => {
    if (!current) return
    cancelled = true
    try {
        await Llama.useLlamaModelStore.getState().context?.stopCompletion()
    } catch {}
    try {
        await current
    } catch {}
}

export const canRunSideTask = () =>
    useAppModeStore.getState().appMode === 'local' &&
    !!Llama.useLlamaModelStore.getState().context &&
    !current &&
    !useInference.getState().nowGenerating

/**
 * Runs `job` while holding the model. The lock is taken synchronously, so a reply sent at any
 * point during the job (even before it reaches the model) will wait for it to stop.
 */
export const runSideTask = async <T>(label: string, job: () => Promise<T>) => {
    if (!canRunSideTask()) return
    cancelled = false
    useSideTaskStore.getState().setRunning(true, label)
    const run = job()
    current = run
    try {
        return await run
    } catch (e) {
        Logger.warn(`[${label}] background task failed: ${e}`)
    } finally {
        current = undefined
        cancelled = false
        useSideTaskStore.getState().setRunning(false)
    }
}

/** One completion on the loaded model. Only call inside `runSideTask`. */
export const runSideCompletion = async (
    messages: SideMessage[],
    options: { maxTokens: number }
): Promise<string | undefined> => {
    const context = Llama.useLlamaModelStore.getState().context
    if (!context || isSideTaskCancelled()) return
    const formatted = await context.getFormattedChat(messages, null, {
        jinja: true,
        enable_thinking: false,
    })
    const prompt = typeof formatted === 'string' ? formatted : formatted.prompt
    if (isSideTaskCancelled()) return
    const threads = Llama.useLlamaPreferencesStore.getState().config.threads
    const result = await context.completion({
        prompt,
        n_predict: options.maxTokens,
        temperature: 0.2,
        top_p: 0.9,
        n_threads: threads,
        enable_thinking: false,
    })
    if (isSideTaskCancelled() || result.interrupted) return
    return result.text
}
