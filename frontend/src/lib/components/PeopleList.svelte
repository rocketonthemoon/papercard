<script>
  import { onMount } from 'svelte';
  import { api } from '../api.js';
  import { appState } from '../state.svelte.js';
  import { initial } from '../format.js';
  import Icon from './Icon.svelte';

  /**
   * Followers / following of one account, in a dialog.
   * onclose(changed): `changed` is true when the viewer followed or unfollowed someone here,
   * so the page behind can refresh its counts.
   */
  let { username, tab = 'followers', onclose } = $props();

  let current = $state(tab);
  let users = $state([]);
  let loading = $state(true);
  let errorMsg = $state('');
  let changed = $state(false);
  let dialog = $state(null);
  let opener = null;

  async function load(kind) {
    current = kind;
    loading = true;
    errorMsg = '';
    try {
      const res = await api(`/users/${encodeURIComponent(username)}/${kind}`);
      users = res.users || [];
    } catch (e) {
      errorMsg = e.message || `Couldn't load ${kind}`;
      users = [];
    } finally {
      loading = false;
    }
  }

  async function toggleFollow(person) {
    try {
      const fresh = await api(`/users/${encodeURIComponent(person.username)}/follow`, {
        method: person.youFollow ? 'DELETE' : 'POST',
        body: {},
      });
      users = users.map((p) => (p.username === person.username ? { ...p, ...fresh } : p));
      changed = true;
    } catch (e) {
      appState.showToast(e.message || 'Action failed');
    }
  }

  function close() {
    onclose?.(changed);
    opener?.focus?.();
  }

  function onKey(e) {
    if (e.key === 'Escape') close();
  }

  onMount(() => {
    opener = document.activeElement;
    dialog?.focus();
    load(current);
  });
</script>

<svelte:window onkeydown={onKey} />

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="modal-back" onclick={(e) => e.target === e.currentTarget && close()}>
  <div class="modal people-modal" role="dialog" aria-modal="true" aria-labelledby="people-title" tabindex="-1" bind:this={dialog}>
    <header class="people-head">
      <h2 id="people-title">@{username}</h2>
      <button type="button" class="icon-btn" aria-label="Close" onclick={close}>
        <Icon name="close" size={16} />
      </button>
    </header>

    <div class="segmented people-tabs" role="tablist" aria-label="People">
      <button type="button" role="tab" aria-selected={current === 'followers'} class:active={current === 'followers'} onclick={() => load('followers')}>
        Followers
      </button>
      <button type="button" role="tab" aria-selected={current === 'following'} class:active={current === 'following'} onclick={() => load('following')}>
        Following
      </button>
    </div>

    <div class="people-body" role="tabpanel" aria-busy={loading}>
      {#if loading}
        <p class="people-status muted">Loading…</p>
      {:else if errorMsg}
        <p class="people-status form-error" role="alert">{errorMsg}</p>
      {:else if users.length === 0}
        <p class="people-status muted">
          {current === 'followers' ? 'No followers yet.' : 'Not following anyone yet.'}
        </p>
      {:else}
        <ul class="people-list">
          {#each users as p (p.username)}
            <li class="people-row">
              <a class="people-who link-plain" href="#/u/{p.username}" onclick={close}>
                <span class="people-avatar" aria-hidden="true">
                  {#if p.picture}<img src={p.picture} alt="" referrerpolicy="no-referrer" />{:else}{initial(p)}{/if}
                </span>
                <span class="people-names">
                  <b>
                    {p.name || p.username}{#if p.isYou}<span class="muted"> (you)</span>{/if}
                    {#if p.official}<span class="pill yellow sm">Official</span>{/if}
                  </b>
                  <span class="mono-tag muted">@{p.username} · {p.followers ?? 0} {(p.followers ?? 0) === 1 ? 'follower' : 'followers'}</span>
                </span>
              </a>
              {#if !p.isYou}
                <button
                  type="button"
                  class="btn small {p.youFollow ? 'outline' : 'btn-gate-pill'} people-follow"
                  aria-pressed={!!p.youFollow}
                  aria-label="{p.youFollow ? 'Unfollow' : 'Follow'} {p.name || p.username}"
                  onclick={() => toggleFollow(p)}
                >
                  {p.youFollow ? 'Following' : 'Follow'}
                </button>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  </div>
</div>

<style>
  .people-modal {
    max-width: 440px;
    max-height: min(640px, calc(100dvh - 40px));
    padding: 20px !important;
    gap: 14px !important;
    align-items: stretch !important;
    text-align: left !important;
    outline: none;
  }

  .people-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .people-head h2 {
    margin: 0;
    font-size: 18px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .people-tabs {
    align-self: flex-start;
  }

  .people-body {
    min-height: 120px;
    overflow-y: auto;
    margin: 0 -4px;
    padding: 0 4px;
  }

  .people-status {
    margin: 0;
    padding: 32px 0;
    text-align: center;
  }

  .people-list {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .people-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 0;
    border-bottom: 1px solid rgba(26, 26, 26, 0.08);
  }

  .people-row:last-child {
    border-bottom: none;
  }

  .people-who {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
    color: var(--color-ink-black);
  }

  .people-who:hover b {
    text-decoration: underline;
  }

  .people-avatar {
    display: grid;
    place-items: center;
    flex-shrink: 0;
    width: 36px;
    height: 36px;
    overflow: hidden;
    border-radius: 50%;
    border: 2px solid var(--color-ink-black);
    background: var(--color-hi-vis-yellow);
    font-weight: 800;
    font-size: 15px;
  }

  .people-avatar img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .people-names {
    display: grid;
    gap: 2px;
    min-width: 0;
  }

  .people-names b {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 15px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .people-names .mono-tag {
    font-size: 12px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .people-follow {
    flex-shrink: 0;
  }
</style>
