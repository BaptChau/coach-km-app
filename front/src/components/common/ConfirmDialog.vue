<script setup lang="ts">
// Confirmation for heavy or irreversible actions only (waiver, issuing a receipt): every
// other action uses an undo snackbar (UX.md section 4).
const open = defineModel<boolean>({ default: false })

withDefaults(
  defineProps<{
    title: string
    confirmLabel: string
    cancelLabel?: string
    loading?: boolean
    color?: string
  }>(),
  { cancelLabel: 'Annuler', loading: false, color: 'primary' },
)
const emit = defineEmits<{ confirm: [] }>()
</script>

<template>
  <v-dialog v-model="open" max-width="440" :persistent="loading">
    <v-card data-testid="confirm-dialog">
      <v-card-title class="text-wrap pt-4">{{ title }}</v-card-title>
      <v-card-text class="text-body-1">
        <slot />
      </v-card-text>
      <v-card-actions class="confirm-actions">
        <v-btn variant="text" :disabled="loading" @click="open = false">{{ cancelLabel }}</v-btn>
        <v-btn
          :color="color"
          variant="flat"
          :loading="loading"
          :disabled="loading"
          data-testid="confirm-ok"
          @click="emit('confirm')"
        >
          {{ confirmLabel }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.confirm-actions {
  flex-wrap: wrap-reverse;
  justify-content: flex-end;
  gap: 8px;
  padding: 8px 16px 16px;
}
</style>
