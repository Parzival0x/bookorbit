<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { ChevronDown } from 'lucide-vue-next'
import { STATUS_OPTIONS, STATUS_ICONS, STATUS_COLORS } from '@/features/book/composables/useBookStatus'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import type { ReadStatus, UserBookStatus } from '@bookorbit/types'

const props = defineProps<{
  value: UserBookStatus | null
  isActive: boolean
  isReadOnly?: boolean
}>()

const emit = defineEmits<{
  activate: []
  save: [value: ReadStatus]
  cancel: []
  navigate: [direction: 'next' | 'prev']
}>()

const isOpen = ref(false)
const saving = ref(false)

// ⚡ Bolt: Performance Optimization
// Consolidating 4 individual computed properties into a single `displayData` object.
// Impact: Reduces Vue reactive watchers per table cell instance from 4 to 1,
// significantly decreasing initialization overhead during rapid scrolling in virtualized lists.
const displayData = computed(() => {
  const status = props.value?.status ?? 'unread'
  return {
    status,
    icon: STATUS_ICONS[status] as unknown,
    color: STATUS_COLORS[status],
    label: STATUS_OPTIONS.find((o) => o.value === status)?.label ?? 'Unread',
  }
})

watch(
  () => props.isActive,
  (active) => {
    if (active && !isOpen.value) isOpen.value = true
    else if (!active && isOpen.value) isOpen.value = false
  },
)

function handleOpenChange(open: boolean) {
  isOpen.value = open
  if (open) {
    if (!props.isActive) emit('activate')
  } else {
    if (!saving.value && props.isActive) emit('cancel')
    saving.value = false
  }
}

function selectOption(status: ReadStatus) {
  saving.value = true
  isOpen.value = false
  emit('save', status)
}

function handleTab(e: KeyboardEvent) {
  isOpen.value = false
  emit('cancel')
  emit('navigate', e.shiftKey ? 'prev' : 'next')
}
</script>

<template>
  <div class="w-full min-w-0">
    <DropdownMenu :open="isOpen" @update:open="handleOpenChange">
      <DropdownMenuTrigger as-child :disabled="isReadOnly">
        <button
          type="button"
          class="flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-xs transition-colors"
          :class="[displayData.color, isReadOnly ? 'cursor-default' : 'hover:bg-primary/5 cursor-pointer']"
        >
          <component :is="displayData.icon" :size="12" />
          <span class="truncate">{{ displayData.label }}</span>
          <ChevronDown v-if="!isReadOnly" :size="10" class="ml-auto shrink-0 text-muted-foreground/50" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" class="min-w-[140px]" :trap-focus="false" @keydown.tab.prevent="handleTab">
        <DropdownMenuItem
          v-for="opt in STATUS_OPTIONS"
          :key="opt.value"
          class="gap-2 text-xs"
          :class="opt.value === displayData.status ? 'text-primary font-medium' : ''"
          @select="selectOption(opt.value)"
        >
          <component :is="STATUS_ICONS[opt.value]" :size="12" :class="STATUS_COLORS[opt.value]" />
          {{ opt.label }}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </div>
</template>
