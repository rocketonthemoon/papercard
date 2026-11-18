<script>
  import { appState } from '../state.svelte.js';
</script>

{#if appState.toastMessage}
  <div class="toast-banner" role="status">
    <span>{appState.toastMessage}</span>
  </div>
{/if}

<style>
  .toast-banner {
    position: fixed;
    top: 20px;
    left: 50%;
    transform: translateX(-50%);
    background: var(--color-bone-white);
    color: var(--color-ink-black);
    border: var(--border-thick);
    border-radius: var(--radius-pill);
    padding: 10px 22px;
    font-weight: 700;
    font-size: 14px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    z-index: 9999;
    animation: toast-in 0.2s cubic-bezier(0.16, 1, 0.3, 1);
    pointer-events: none;
  }

  @keyframes toast-in {
    from {
      opacity: 0;
      transform: translate(-50%, -10px);
    }
    to {
      opacity: 1;
      transform: translate(-50%, 0);
    }
  }
</style>
