<script setup lang="ts">
// A money amount with aligned digits. `euros` is the API's number (rounded to the cent).
import { computed } from 'vue'
import { formatEuros, toCents } from '@/domain'

const props = withDefaults(defineProps<{ euros: number; size?: 'hero' | 'large' | 'body' }>(), {
  size: 'body',
})

const text = computed(() => formatEuros(toCents(props.euros)))
</script>

<template>
  <span class="money tabular-nums" :class="`money--${size}`">{{ text }}</span>
</template>

<style scoped>
.money {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.money--hero {
  font-size: 2.25rem;
  line-height: 1.15;
  font-weight: 700;
  letter-spacing: -0.01em;
}
.money--large {
  font-size: 1.25rem;
  font-weight: 600;
}
.money--body {
  font-weight: 600;
}
</style>
