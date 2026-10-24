<script setup lang="ts">
// Shell of every form (UX.md section 3): full screen below `md`, a centred 560 px dialog
// above; a close button, a scrollable body and a sticky full-width primary button at the
// bottom (safe-area aware). Wraps a <v-form>: call `validate()` through a template ref.
import { ref } from 'vue'
import { useBreakpoint } from '@/composables/useBreakpoint'

const open = defineModel<boolean>({ default: false })

withDefaults(
  defineProps<{
    title: string
    submitLabel?: string
    loading?: boolean
  }>(),
  { submitLabel: 'Enregistrer', loading: false },
)
const emit = defineEmits<{ submit: [] }>()

const { isMobile } = useBreakpoint()
const formRef = ref<{
  validate: () => Promise<{ valid: boolean }>
  resetValidation: () => void
} | null>(null)

defineExpose({
  async validate(): Promise<boolean> {
    return (await formRef.value?.validate())?.valid ?? true
  },
  resetValidation(): void {
    formRef.value?.resetValidation()
  },
})
</script>

<template>
  <v-dialog
    v-model="open"
    :fullscreen="isMobile"
    max-width="560"
    scrollable
    :persistent="loading"
    transition="dialog-bottom-transition"
  >
    <v-card class="form-dialog" :rounded="isMobile ? 0 : 'lg'">
      <v-form
        ref="formRef"
        class="form-dialog__form"
        validate-on="blur lazy"
        @submit.prevent="emit('submit')"
      >
        <v-toolbar color="surface" density="comfortable" border="b">
          <v-btn
            icon="mdi-close"
            size="default"
            aria-label="Fermer"
            :disabled="loading"
            @click="open = false"
          />
          <v-toolbar-title class="form-dialog__title">{{ title }}</v-toolbar-title>
        </v-toolbar>

        <v-card-text class="form-dialog__body">
          <slot />
        </v-card-text>

        <div class="form-dialog__actions">
          <slot name="before-submit" />
          <v-btn
            type="submit"
            color="primary"
            block
            size="large"
            :loading="loading"
            :disabled="loading"
            data-testid="form-submit"
          >
            {{ submitLabel }}
          </v-btn>
        </div>
      </v-form>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.form-dialog__form {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
}
.form-dialog__title {
  font-weight: 600;
}
.form-dialog__body {
  flex: 1 1 auto;
  overflow-y: auto;
  padding: 16px !important;
}
/* Sticky primary button, always reachable (UX.md section 3). */
.form-dialog__actions {
  position: sticky;
  bottom: 0;
  padding: 12px 16px calc(12px + env(safe-area-inset-bottom, 0px));
  background: rgb(var(--v-theme-surface));
  border-top: thin solid rgba(var(--v-border-color), var(--v-border-opacity));
}
</style>
