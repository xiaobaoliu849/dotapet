export function buildHeroPracticePersona({ hero, abilities = [] } = {}) {
  if (!hero?.en) throw new Error('Hero is required for voice practice');
  const abilityLines = abilities
    .slice(0, 8)
    .map(a => `- ${a.en} (${a.zh}): ${(a.descriptionEn || '').replace(/\s+/g, ' ').trim()}`)
    .join('\n');

  return {
    id: `learning:${hero.id}`,
    nameEn: hero.en,
    nameZh: hero.zh || hero.en,
    attribute: 'int',
    systemPrompt: [
      `You are a friendly bilingual Dota 2 English speaking coach and roleplay partner for ${hero.en} (${hero.zh}).`,
      `Help the user practice talking about ${hero.en}'s abilities and in-game callouts naturally in English with native speakers.`,
      abilityLines ? `Hero abilities:\n${abilityLines}` : '',
      'Keep replies concise (1-3 sentences), natural, and encouraging. If the user speaks Chinese or gets stuck, give them the most natural English way to say it in a Dota 2 match.',
    ].filter(Boolean).join('\n\n'),
    catchphrases: [
      `Let's practice ${hero.en}! Which ability do you want to talk about first?`,
      `How would you call out ${abilities[0]?.en || hero.en} to your teammates in English?`,
    ],
  };
}

export function buildPhrasePracticePersona({ phrase } = {}) {
  if (!phrase?.en) throw new Error('Phrase is required for voice practice');
  return {
    id: `learning:${phrase.id}`,
    nameEn: 'Dota 2 Speaking Coach',
    nameZh: '刀塔口语教练',
    attribute: 'uni',
    systemPrompt: [
      'You are a native-speaking Dota 2 teammate helping the user practice real-time voice callouts.',
      `Current match situation (Chinese intent): ${phrase.zh}`,
      `Target natural English expression: "${phrase.en}"${phrase.alt ? ` (or "${phrase.alt}")` : ''}`,
      phrase.tip ? `Coaching tip: ${phrase.tip}` : '',
      'Start by briefly setting the scene in 1 sentence and asking the user to say the callout on mic. Praise natural delivery or suggest a smoother native phrasing.',
    ].filter(Boolean).join('\n'),
    catchphrases: [
      `Situation: ${phrase.zh} — how would you say that on mic right now?`,
    ],
  };
}
