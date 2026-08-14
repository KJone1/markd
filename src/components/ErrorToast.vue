<script setup lang="ts">
import { onBeforeUnmount, onMounted } from "vue";

defineProps<{ message: string }>();
const emit = defineEmits<{
  retry: [];
  dismiss: [];
}>();

let dismissTimer: ReturnType<typeof setTimeout> | null = null;
onMounted(() => {
  dismissTimer = setTimeout(() => emit("dismiss"), 10_000);
});
onBeforeUnmount(() => {
  if (dismissTimer !== null) clearTimeout(dismissTimer);
});
</script>

<template>
  <aside class="error-toast" role="alert" aria-live="assertive">
    <span class="error-toast-icon" aria-hidden="true">!</span>
    <div class="error-toast-content">
      <p>{{ message }}</p>
      <div class="error-toast-actions">
        <button type="button" class="toast-retry" @click="emit('retry')">
          Retry
        </button>
        <button type="button" class="toast-dismiss" @click="emit('dismiss')">
          Dismiss
        </button>
      </div>
    </div>
  </aside>
</template>
