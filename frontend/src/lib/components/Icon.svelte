<script>
  let { name = '', size = 18, class: className = '' } = $props();
</script>

{#if name === 'fire'}
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none" class={className} aria-hidden="true">
    <path d="M10 2c1 3.5 4 5 4 9a6 6 0 1 1-12 0c0-4 3-5.5 4-9 0 2.5 1.5 4 4 0z" fill="#f4ed36" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
  </svg>
{:else if name === 'heart'}
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none" class={className} aria-hidden="true">
    <path d="M10 16.5s-6-3.8-6-8a4 4 0 0 1 6-3.5 4 4 0 0 1 6 3.5c0 4.2-6 8-6 8z" fill="#c94245" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
  </svg>
{:else if name === 'bolt'}
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none" class={className} aria-hidden="true">
    <path d="M11 2 4 11h6l-1 7 7-9h-6z" fill="#f4ed36" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
  </svg>
{:else if name === 'home'}
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" class={className} aria-hidden="true">
    <path d="M3.5 9 10 3.5 16.5 9v7a1 1 0 0 1-1 1H12v-4.5H8V17H4.5a1 1 0 0 1-1-1z"/>
  </svg>
{:else if name === 'review'}
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" class={className} aria-hidden="true">
    <rect x="3" y="5.5" width="10.5" height="11.5" rx="2"/><path d="M7 3h7.5A2.5 2.5 0 0 1 17 5.5v8.5"/>
  </svg>
{:else if name === 'courses'}
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" class={className} aria-hidden="true">
    <circle cx="10" cy="10" r="7"/><path d="m8.5 7.3 4 2.7-4 2.7z"/>
  </svg>
{:else if name === 'play'}
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" class={className} aria-hidden="true">
    <path d="M11 2.5 4.5 11H10l-1 6.5L15.5 9H10z"/>
  </svg>
{:else if name === 'trophy'}
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class={className} aria-hidden="true">
    <path d="M6 3h8v4a4 4 0 0 1-8 0zM6 5H3a3 3 0 0 0 3 3m8-3h3a3 3 0 0 1-3 3M10 11v4m-3 2h6"/>
  </svg>
{:else if name === 'studio'}
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" class={className} aria-hidden="true">
    <path d="M3.5 16.5h3l9-9-3-3-9 9z"/><path d="m11 5.5 3 3"/>
  </svg>
{:else if name === 'admin'}
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" class={className} aria-hidden="true">
    <path d="M10 2.5 16 5v4.5c0 3.6-2.6 6.4-6 8-3.4-1.6-6-4.4-6-8V5z"/>
  </svg>
{:else if name === 'logout'}
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" class={className} aria-hidden="true">
    <path d="M8 4H4.5v12H8M12 6.5 15.5 10 12 13.5M15.5 10H8"/>
  </svg>
{:else if name === 'lock'}
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" class={className} aria-hidden="true">
    <rect x="5" y="9" width="10" height="8" rx="2"/><path d="M7 9V7a3 3 0 0 1 6 0v2"/>
  </svg>
{:else if name === 'chev'}
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" class={className} aria-hidden="true">
    <path d="m5 7.5 5 5 5-5"/>
  </svg>
{:else if name === 'check'}
  <svg width={size} height={size} viewBox="0 0 20 20" class={className} aria-hidden="true">
    <rect width="20" height="20" rx="4" fill="#b5c995" stroke="#1a1a1a" stroke-width="1.5"/>
    <path d="M5.5 10.5l3 3 6-7" stroke="#1a1a1a" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>
{:else if name === 'ok'}
  <svg width={size} height={size} viewBox="0 0 20 20" class={className} aria-label="right">
    <path d="M4.5 10.5l3.5 3.5 7.5-8" stroke="currentColor" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>
{:else if name === 'miss'}
  <svg width={size} height={size} viewBox="0 0 20 20" class={className} aria-label="wrong">
    <path d="M5 5l10 10M15 5 5 15" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>
  </svg>
{:else if name === 'back'}
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" class={className} aria-hidden="true">
    <path d="M12.5 4 6.5 10l6 6"/>
  </svg>
{:else if name === 'arrow'}
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class={className} aria-hidden="true">
    <path d="M4 10h12m-5-5 5 5-5 5"/>
  </svg>
{:else if name === 'speaker'}
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class={className} aria-hidden="true">
    <path d="M3 8v4h3l4 3V5L6 8H3zm11-1a4 4 0 0 1 0 6m2-8a7 7 0 0 1 0 10"/>
  </svg>
{:else if name === 'flip'}
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class={className} aria-hidden="true">
    <path d="M4 8h12M4 8l3-3M4 8l3 3M16 12H4m12 0-3-3m3 3-3 3"/>
  </svg>
{:else if name === 'shuffle'}
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class={className} aria-hidden="true">
    <path d="M14 4h3v3M3 16l5-5m3-3 3-3h3v3M14 16h3v-3M3 4l14 14"/>
  </svg>
{:else if name === 'cards'}
  <svg width={size} height={size} viewBox="0 0 80 80" class={className} aria-hidden="true">
    <rect x="12" y="18" width="38" height="50" rx="5" fill="#8584bd" stroke="#1a1a1a" stroke-width="2.5" transform="rotate(-9 31 43)"/>
    <rect x="28" y="12" width="38" height="50" rx="5" fill="#f4ed36" stroke="#1a1a1a" stroke-width="2.5"/>
    <text x="47" y="45" font-size="24" font-weight="800" text-anchor="middle" fill="#1a1a1a" font-family="JetBrains Mono, monospace">Ą</text>
  </svg>
{:else if name === 'decks'}
  <svg width={size} height={size} viewBox="0 0 80 80" class={className} aria-hidden="true">
    <rect x="10" y="22" width="34" height="46" rx="4" fill="#8584bd" stroke="#1a1a1a" stroke-width="2.5"/>
    <rect x="22" y="16" width="34" height="46" rx="4" fill="#f9f5f2" stroke="#1a1a1a" stroke-width="2.5"/>
    <rect x="34" y="10" width="34" height="46" rx="4" fill="#f4ed36" stroke="#1a1a1a" stroke-width="2.5"/>
    <text x="51" y="40" font-size="17" font-weight="800" text-anchor="middle" fill="#1a1a1a" font-family="JetBrains Mono, monospace">A1</text>
  </svg>
{:else if name === 'star'}
  <svg width={size} height={size} viewBox="0 0 24 24" class={className} aria-hidden="true">
    <path d="m12 3 2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 16.8 6.6 19.7l1.1-6.1L3.2 9.4l6.1-.8z" fill="currentColor"/>
  </svg>
{:else if name === 'grip'}
  <svg width={size} height={size} viewBox="0 0 20 20" class={className} aria-hidden="true">
    <circle cx="7" cy="5" r="1.5" fill="currentColor"/>
    <circle cx="13" cy="5" r="1.5" fill="currentColor"/>
    <circle cx="7" cy="10" r="1.5" fill="currentColor"/>
    <circle cx="13" cy="10" r="1.5" fill="currentColor"/>
    <circle cx="7" cy="15" r="1.5" fill="currentColor"/>
    <circle cx="13" cy="15" r="1.5" fill="currentColor"/>
  </svg>
{:else if name === 'upload'}
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class={className} aria-hidden="true">
    <path d="M10 13V3m-4 4 4-4 4 4M4 13v3h12v-3"/>
  </svg>
{:else if name === 'copy'}
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" class={className} aria-hidden="true">
    <rect x="7" y="7" width="10" height="10" rx="2"/>
    <path d="M13 4H5a1 1 0 0 0-1 1v8" stroke-linecap="round"/>
  </svg>
{:else if name === 'send'}
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" class={className} aria-hidden="true">
    <path d="M3 10 17 3l-4 14-3-6z"/>
  </svg>
{:else if name === 'plus'}
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" class={className} aria-hidden="true">
    <path d="M10 4v12M4 10h12"/>
  </svg>
{:else if name === 'close'}
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" class={className} aria-hidden="true">
    <path d="M5 5l10 10M15 5 5 15"/>
  </svg>
{:else if name === 'refresh'}
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" class={className} aria-hidden="true">
    <path d="M16 10a6 6 0 1 1-1.8-4.3M16 3v4h-4"/>
  </svg>
{:else if name === 'chat'}
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" class={className} aria-hidden="true">
    <path d="M3.5 4.5h13v9H9l-4 3v-3H3.5z"/>
    <path d="M7 8.2h6M7 10.8h4" stroke-linecap="round"/>
  </svg>
{:else if name === 'list'}
  <svg width={size} height={size} viewBox="0 0 20 20" class={className} aria-hidden="true">
    <path d="M7 5h10M7 10h10M7 15h10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
    <circle cx="3.5" cy="5" r="1.2" fill="currentColor"/>
    <circle cx="3.5" cy="10" r="1.2" fill="currentColor"/>
    <circle cx="3.5" cy="15" r="1.2" fill="currentColor"/>
  </svg>
{:else if name === 'edit'}
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class={className} aria-hidden="true">
    <path d="M13.5 3.5l3 3L6 17H3v-3L13.5 3.5z"/>
  </svg>
{:else if name === 'trash'}
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class={className} aria-hidden="true">
    <path d="M4 6h12M7 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 6v10a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2V6"/>
  </svg>
{:else if name === 'cup'}
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none" class={className} aria-hidden="true">
    <path d="M6 3h8v4.5a4 4 0 0 1-8 0z" fill="#f4ed36" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
    <path d="M6 4.5H3.5v1.2A2.8 2.8 0 0 0 6.3 8.5M14 4.5h2.5v1.2a2.8 2.8 0 0 1-2.8 2.8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M10 11.5V14M7 17h6M8 14h4v3H8z" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>
{:else if name === 'github'}
  <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" class={className} aria-hidden="true">
    <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z"/>
  </svg>
{:else}
  <!-- Unknown icon name: render an empty box of the right size rather than a placeholder blob. -->
  <span class="icon-blank {className}" style:width="{size}px" style:height="{size}px" aria-hidden="true"></span>
{/if}
