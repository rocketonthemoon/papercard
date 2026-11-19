<script>
  import { onMount } from 'svelte';
  import { api } from '../lib/api.js';
  import { appState } from '../lib/state.svelte.js';
  import Icon from '../lib/components/Icon.svelte';

  let { username } = $props();

  let loading = $state(true);
  let errorMsg = $state('');
  let data = $state(null);

  // Edit form state
  let isEditing = $state(false);
  let editHandle = $state('');
  let editBio = $state('');
  let saving = $state(false);
  let editErr = $state('');

  onMount(async () => {
    await loadProfile();
  });

  async function loadProfile() {
    try {
      loading = true;
      const res = await api(`/users/${encodeURIComponent(username)}`);
      data = res;
      if (res.user) {
        editHandle = res.user.username || '';
        editBio = res.user.bio || '';
      }
    } catch (e) {
      errorMsg = e.message || 'Failed to load profile';
    } finally {
      loading = false;
    }
  }

  let u = $derived(data?.user || null);
  let courses = $derived(data?.courses || []);

  async function handleFollowToggle() {
    if (!u) return;
    try {
      if (u.following) {
        await api(`/users/${encodeURIComponent(u.username)}/follow`, { method: 'DELETE' });
        u.following = false;
        u.followers = Math.max(0, (u.followers || 0) - 1);
      } else {
        await api(`/users/${encodeURIComponent(u.username)}/follow`, { method: 'POST' });
        u.following = true;
        u.followers = (u.followers || 0) + 1;
      }
      data = { ...data };
    } catch (e) {
      appState.showToast(e.message || 'Action failed');
    }
  }

  async function handleSaveProfile(e) {
    e.preventDefault();
    try {
      saving = true;
      editErr = '';
      const updated = await api('/me', {
        method: 'POST',
        body: { username: editHandle.trim(), bio: editBio.trim() }
      });
      u.username = updated.user.username;
      u.bio = updated.user.bio;
      appState.user = updated.user;
      isEditing = false;
      appState.showToast('Profile updated!');
    } catch (e) {
      editErr = e.message || 'Failed to update profile';
    } finally {
      saving = false;
    }
  }
</script>

<div class="profile-view">
  {#if loading}
    <div class="card loading-box">
      <p class="muted">Loading profile…</p>
    </div>
  {:else if errorMsg}
    <div class="card error-box">
      <h2>Profile not found</h2>
      <p class="muted">{errorMsg}</p>
      <a href="#/learn" class="btn primary">Back to Home</a>
    </div>
  {:else if u}
    <section class="card profile-card">
      <div class="profile-header">
        <div class="avatar-large">
          {#if u.picture}
            <img src={u.picture} alt="" class="avatar-img" referrerpolicy="no-referrer" />
          {:else}
            <span class="avatar-txt">{u.name?.charAt(0) || '?'}</span>
          {/if}
        </div>

        <div class="profile-info">
          <div class="name-row">
            <h1 class="profile-name">{u.name}</h1>
            {#if u.official}
              <span class="pill yellow sm">OFFICIAL</span>
            {/if}
          </div>

          <p class="handle-txt mono-tag muted small">@{u.username}</p>

          {#if u.bio}
            <p class="bio-txt">{u.bio}</p>
          {/if}

          <div class="follow-counts mono-tag small">
            <span><b>{u.followers || 0}</b> followers</span>
            <span><b>{u.followingCount || 0}</b> following</span>
          </div>
        </div>

        <div class="action-slot">
          {#if u.isYou}
            <div class="owner-actions">
              <button class="btn outline sm" onclick={() => isEditing = !isEditing}>
                <Icon name="edit" size={14} />
                <span>{isEditing ? 'Close' : 'Edit profile'}</span>
              </button>
              <button class="btn outline sm logout-btn" onclick={() => appState.logout()} title="Sign out of Papercard">
                <Icon name="logout" size={14} />
                <span>Sign out</span>
              </button>
            </div>
          {:else}
            <button
              class="btn sm"
              class:primary={!u.following}
              class:outline={u.following}
              onclick={handleFollowToggle}
            >
              {u.following ? 'Following' : 'Follow +'}
            </button>
          {/if}
        </div>
      </div>

      <!-- Edit Form (Toggled) -->
      {#if isEditing}
        <form onsubmit={handleSaveProfile} class="edit-profile-form">
          <div class="field">
            <label for="pf-user" class="mono-tag small">Username</label>
            <input
              id="pf-user"
              type="text"
              class="input-box"
              maxlength="20"
              bind:value={editHandle}
            />
          </div>

          <div class="field">
            <label for="pf-bio" class="mono-tag small">Bio</label>
            <textarea
              id="pf-bio"
              class="input-box"
              maxlength="200"
              rows="2"
              placeholder="What you're learning, what you teach..."
              bind:value={editBio}
            ></textarea>
          </div>

          {#if editErr}
            <p class="error-msg">{editErr}</p>
          {/if}

          <div class="form-actions">
            <button type="button" class="btn outline sm" onclick={() => isEditing = false}>
              Cancel
            </button>
            <button type="submit" class="btn primary sm" disabled={saving}>
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </form>
      {/if}
    </section>

    <!-- Created Courses -->
    <div class="user-courses-section">
      <div class="section-top">
        <h2>{u.isYou ? 'Your courses' : 'Courses'}</h2>
        {#if u.isYou}
          <a href="#/studio" class="btn outline sm">
            <Icon name="plus" size={14} />
            <span>New course</span>
          </a>
        {/if}
      </div>

      {#if courses.length === 0}
        <div class="card empty-courses">
          <p class="muted">{u.isYou ? "You haven't made any courses yet." : "No courses published yet."}</p>
        </div>
      {:else}
        <div class="courses-grid">
          {#each courses as c}
            <article class="card course-card">
              <div class="course-top">
                <span class="pill yellow">{c.fromLang} → {c.toLang}</span>
                <span class="mono-tag muted small">{c.words || 0} words</span>
              </div>
              <h3 class="course-title">
                <a href="#/course/{c.id}">{c.title}</a>
              </h3>
              <p class="course-desc muted small">{c.description || ''}</p>
              <div class="course-actions">
                <a href="#/course/{c.id}" class="btn outline sm">Details</a>
              </div>
            </article>
          {/each}
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .profile-view {
    max-width: 720px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: 24px;
  }

  .profile-card {
    display: flex;
    flex-direction: column;
    gap: 20px;
    padding: 28px;
  }

  .profile-header {
    display: flex;
    gap: 20px;
    align-items: flex-start;
  }

  @media (max-width: 580px) {
    .profile-header {
      flex-direction: column;
      align-items: center;
      text-align: center;
    }
  }

  .avatar-large {
    width: 72px;
    height: 72px;
    border-radius: 50%;
    border: var(--border-thick);
    background: var(--color-bone-white);
    box-shadow: 0 3px 0 var(--color-ink-black);
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .avatar-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .avatar-txt {
    font-family: var(--font-display);
    font-size: 30px;
    font-weight: 900;
  }

  .profile-info {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .name-row {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .profile-name {
    font-family: var(--font-display);
    font-size: 28px;
    font-weight: 900;
  }

  .owner-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .owner-actions .logout-btn:hover {
    background: var(--color-firecracker-red);
    color: var(--color-bone-white);
  }

  .bio-txt {
    font-size: 14.5px;
    line-height: 1.45;
    margin-top: 4px;
  }

  .follow-counts {
    display: flex;
    gap: 14px;
    margin-top: 6px;
    font-weight: 700;
  }

  .edit-profile-form {
    border-top: 1.5px solid rgba(26, 26, 26, 0.12);
    padding-top: 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .input-box {
    border: var(--border-thick);
    border-radius: var(--radius-card);
    padding: 10px 14px;
    font-family: inherit;
    font-size: 14px;
    font-weight: 600;
    background: var(--color-bone-white);
    box-shadow: 0 2px 0 var(--color-ink-black);
  }

  .form-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }

  .error-msg {
    color: var(--color-firecracker-red);
    font-size: 13px;
    font-weight: 700;
  }

  .user-courses-section {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .section-top {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .section-top h2 {
    font-family: var(--font-display);
    font-size: 24px;
    font-weight: 900;
    color: var(--color-bone-white);
  }

  .courses-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: 16px;
  }

  .course-card {
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    min-height: 180px;
    background: var(--color-bone-white);
    border: var(--border-thick);
    border-radius: var(--radius-card);
    box-shadow: var(--shadow-card);
    padding: 20px;
    transition: transform 0.12s ease, box-shadow 0.12s ease;
  }

  .course-card:hover {
    transform: translateY(-2px);
    box-shadow: 0 6px 0 rgba(26, 26, 26, 0.3);
  }

  .course-top {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .course-title {
    font-family: var(--font-display);
    font-size: 18px;
    font-weight: 800;
  }

  .empty-courses, .loading-box, .error-box {
    text-align: center;
    padding: 36px 20px;
  }
</style>
