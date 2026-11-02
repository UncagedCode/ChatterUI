import { create } from 'zustand'

import { Llama } from '@lib/engine/Local/LlamaLocal'
import { useAppModeStore } from '@lib/state/AppMode'
import { Logger } from '@lib/state/Logger'

import type { SideMessage } from './Memory/MemoryPrompts'

/**
 * Small background completions (summaries, memory) that run on the loaded local model between
 * chat replies. They never touch the chat buffer, and a new chat reply always takes priority:
 * call `yieldToChat()` before starting a reply and any running side task is stopped.
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

export const isSideTaskCancelled = () => cancelled

export const yieldToChat = async () => {
    if (!useSideTaskStore.getState().running) return
    cancelled = true
    try {
        await Llama.useLlamaModelStore.getState().context?.stopCompletion()
        await current
    } catch {}
}

export const canRunSideTask = () =>
    useAppModeStore.getState().appMode === 'local' &&
    !!Llama.useLlamaModelStore.getState().context &&
    !useSideTaskStore.getState().running

/** Runs one completion on the loaded local model. Returns undefined if stopped or failed. */
export const runSideCompletion = async (
    messages: SideMessage[],
    options: { maxTokens: number; label: string }
): Promise<string | undefined> => {
    const context = Llama.useLlamaModelStore.getState().context
    if (!context || useSideTaskStore.getState().running) return

    cancelled = false
    useSideTaskStore.getState().setRunning(true, options.label)
    const run = (async () => {
        const formatted = await context.getFormattedChat(messages, null, {
            jinja: true,
            enable_thinking: false,
        })
        const prompt = typeof formatted === 'string' ? formatted : formatted.prompt
        if (cancelled) return
        const threads = Llama.useLlamaPreferencesStore.getState().config.threads
        const result = await context.completion({
            prompt,
            n_predict: options.maxTokens,
            temperature: 0.2,
            top_p: 0.9,
            n_threads: threads,
            enable_thinking: false,
        })
        if (cancelled || result.interrupted) return
        return result.text
    })()
    current = run
    try {
        return await run
    } catch (e) {
        Logger.warn(`[${options.label}] background task failed: ${e}`)
    } finally {
        current = undefined
        useSideTaskStore.getState().setRunning(false)
    }
}
