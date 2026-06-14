<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { BookOpen, ChevronDown, Eye, Play } from 'lucide-vue-next'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { FORMAT_TO_GROUP, READER_OPENABLE_FORMATS } from '@bookorbit/types'
import type { BookCard, BookFileRef } from '@bookorbit/types'
import { getFormatColor } from '@/features/book/lib/format-colors'

const props = defineProps<{
  book: BookCard
}>()

const router = useRouter()

const fileInfo = computed(() => {
  const readable = props.book.files.filter((file) => {
    const format = file.format?.trim().toLowerCase()
    return format ? READER_OPENABLE_FORMATS.has(format) : false
  })
  const prim = readable.find((file) => file.role === 'primary')
  const readableFiles = prim ? [prim, ...readable.filter((file) => file.id !== prim.id)] : readable

  const audioFiles = readableFiles.filter((file) => {
    const format = file.format?.toLowerCase()
    return format ? FORMAT_TO_GROUP[format] === 'audio' : false
  })
  const isMultiTrackAudio = audioFiles.length > 1

  const collapsed = isMultiTrackAudio
    ? (() => {
        const firstAudio = readableFiles.find((file) => {
          const format = file.format?.toLowerCase()
          return format ? FORMAT_TO_GROUP[format] === 'audio' : false
        })
        const nonAudio = readableFiles.filter((file) => {
          const format = file.format?.toLowerCase()
          return format ? FORMAT_TO_GROUP[format] !== 'audio' : false
        })
        return firstAudio ? [firstAudio, ...nonAudio] : nonAudio
      })()
    : readableFiles

  const seen = new Set<string>()
  const openableFiles = collapsed.filter((file) => {
    const key = file.format!.trim().toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  const primaryFile = openableFiles.find((file) => file.role === 'primary') ?? openableFiles[0] ?? null

  const primaryFormat = primaryFile?.format?.toLowerCase()
  const primaryIsAudio = primaryFormat ? FORMAT_TO_GROUP[primaryFormat] === 'audio' : false

  const canOpen = props.book.status !== 'missing' && !!primaryFile
  const hasMultipleFormats = openableFiles.length > 1

  return {
    readableFiles,
    isMultiTrackAudio,
    openableFiles,
    primaryFile,
    primaryIsAudio,
    canOpen,
    hasMultipleFormats,
  }
})

function actionVerb(file: BookFileRef | null): string {
  const format = file?.format?.toLowerCase()
  return format && FORMAT_TO_GROUP[format] === 'audio' ? 'Play' : 'Read'
}

function isAudioFile(file: BookFileRef | null): boolean {
  const format = file?.format?.toLowerCase()
  return format ? FORMAT_TO_GROUP[format] === 'audio' : false
}

function formatLabel(file: BookFileRef | null): string {
  return file?.format?.trim().toUpperCase() ?? 'FILE'
}

function formatBadgeStyle(format: string) {
  const color = getFormatColor(format)
  return {
    color,
    borderColor: `${color}66`,
    backgroundColor: `${color}1a`,
  }
}

function openFile(file: BookFileRef | null, mode?: 'peek') {
  if (!file || props.book.status === 'missing') return
  router.push({
    name: 'reader',
    params: { bookId: props.book.id, fileId: file.id },
    query: mode === 'peek' ? { format: file.format ?? 'epub', mode } : { format: file.format ?? 'epub' },
  })
}

function openPrimaryFile() {
  openFile(fileInfo.value.primaryFile)
}

function peekPrimaryFile() {
  openFile(fileInfo.value.primaryFile, 'peek')
}
</script>

<template>
  <div v-if="fileInfo.canOpen" class="flex w-full items-center justify-start">
    <div v-if="fileInfo.hasMultipleFormats" class="mr-auto flex h-7 items-center overflow-hidden rounded-md">
      <button
        type="button"
        class="inline-flex h-7 w-7 items-center justify-center rounded-l-md text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
        :aria-label="`${actionVerb(fileInfo.primaryFile)} ${formatLabel(fileInfo.primaryFile)}`"
        :title="`${actionVerb(fileInfo.primaryFile)} ${formatLabel(fileInfo.primaryFile)}`"
        @click.stop="openPrimaryFile"
      >
        <Play v-if="fileInfo.primaryIsAudio" :size="13" class="text-sky-500" />
        <BookOpen v-else :size="13" class="text-emerald-500" />
      </button>
      <div class="w-px shrink-0 bg-border/80" />
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <button
            type="button"
            class="inline-flex h-7 w-6 shrink-0 items-center justify-center rounded-r-md text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
            aria-label="Choose format to read or play"
            @click.stop
          >
            <ChevronDown :size="12" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" class="w-48">
          <DropdownMenuItem v-for="file in fileInfo.openableFiles" :key="file.id" class="gap-2" @select="openFile(file)">
            <span
              class="rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide"
              :style="formatBadgeStyle(file.format?.toLowerCase() ?? '?')"
            >
              {{ file.format }}
            </span>
            <span class="flex-1 truncate text-xs">{{ actionVerb(file) }} {{ formatLabel(file) }}</span>
            <span v-if="file.role === 'primary' && !fileInfo.isMultiTrackAudio" class="text-[10px] text-primary">Primary</span>
          </DropdownMenuItem>
          <DropdownMenuItem v-for="file in fileInfo.openableFiles" :key="`peek-${file.id}`" class="gap-2" @select="openFile(file, 'peek')">
            <Eye :size="13" class="text-primary" />
            <span class="flex-1 truncate text-xs">Peek {{ formatLabel(file) }}</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>

    <div v-else class="mr-auto inline-flex h-7 items-center overflow-hidden rounded-md">
      <button
        type="button"
        class="inline-flex h-7 w-7 items-center justify-center rounded-l-md text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
        :aria-label="`${actionVerb(fileInfo.primaryFile)} ${formatLabel(fileInfo.primaryFile)}`"
        :title="`${actionVerb(fileInfo.primaryFile)} ${formatLabel(fileInfo.primaryFile)}`"
        @click.stop="openPrimaryFile"
      >
        <Play v-if="isAudioFile(fileInfo.primaryFile)" :size="13" class="text-sky-500" />
        <BookOpen v-else :size="13" class="text-emerald-500" />
      </button>
      <div class="w-px shrink-0 bg-border/80" />
      <button
        type="button"
        class="inline-flex h-7 w-7 items-center justify-center rounded-r-md text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
        :aria-label="`Peek ${formatLabel(fileInfo.primaryFile)}`"
        :title="`Peek ${formatLabel(fileInfo.primaryFile)}`"
        @click.stop="peekPrimaryFile"
      >
        <Eye :size="13" class="text-primary" />
      </button>
    </div>
  </div>

  <span v-else class="text-xs text-muted-foreground/40">-</span>
</template>
