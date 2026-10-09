// Runs before first paint: the settings center embeds this editor with ?embedded=1.
// Both it and the F6 panel use the settings palette; only the embedded page drops its close button.
if (new URLSearchParams(location.search).get('embedded') === '1') document.documentElement.dataset.embedded = 'true';
