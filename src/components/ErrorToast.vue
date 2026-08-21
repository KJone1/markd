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

<style scoped>
.error-toast {
  position: fixed;
  z-index: 50;
  right: var(--space-lg);
  bottom: var(--space-lg);
  width: min(calc(100% - 48px), 416px);
  display: flex;
  gap: var(--space-md);
  padding: var(--space-md);
  color: var(--color-body);
  background: var(--color-surface);
  border: 1px solid var(--color-hairline);
  border-radius: var(--radius-lg);
  box-shadow: 0 10px 15px -3px rgb(15 23 42 / 16%);
}

.error-toast-icon {
  display: grid;
  flex: 0 0 24px;
  width: 24px;
  height: 24px;
  place-items: center;
  color: white;
  background: var(--color-error);
  border-radius: 9999px;
  font-weight: 700;
}

.error-toast-content {
  min-width: 0;
  flex: 1;
}

.error-toast-content p {
  margin: 0;
  font-size: 14px;
  line-height: 1.5;
}

.error-toast-actions {
  display: flex;
  gap: var(--space-xs);
  justify-content: flex-end;
  margin-top: var(--space-md);
}

.toast-retry,
.toast-dismiss {
  min-height: 32px;
  padding: 8px 12px;
  color: var(--color-ink);
  background: transparent;
  border: 1px solid var(--color-ink);
  border-radius: var(--radius-md);
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}

.toast-retry {
  color: white;
  background: var(--color-primary-active);
  border-color: var(--color-primary-active);
}

.toast-retry:focus-visible,
.toast-dismiss:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}
</style>
