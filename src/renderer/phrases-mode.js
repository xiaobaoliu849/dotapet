// Runs before first paint: the settings center embeds this editor with ?embedded=1.
if (new URLSearchParams(location.search).get('embedded') === '1') document.documentElement.dataset.embedded = 'true';
