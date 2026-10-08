// Common player names in addition to the official Chinese/English names.
// Full pinyin transliteration is not advertised; these are curated aliases.
export const HERO_SEARCH_ALIASES = {
  anti_mage: ['AM', '敌法', 'difa'],
  invoker: ['卡尔', 'kaer'],
  shadow_fiend: ['SF', '影魔', 'nevermore', 'yingmo'],
  spirit_breaker: ['SB', '白牛', 'bainiu'],
  storm_spirit: ['蓝猫', 'lanmao'],
  ember_spirit: ['火猫', 'huomao'],
  earth_spirit: ['土猫', 'tumao'],
  void_spirit: ['紫猫', 'zimao'],
  crystal_maiden: ['CM', '冰女', 'bingnv'],
  drow_ranger: ['小黑', 'DR', 'xiaohei'],
  earthshaker: ['ES', '小牛', 'xiaoniu'],
  juggernaut: ['剑圣', 'jugg', 'jiansheng'],
  mirana: ['POM', '白虎', 'baihu'],
  morphling: ['水人', 'shuiren'],
  phantom_lancer: ['PL', '猴子', 'houzi'],
  phantom_assassin: ['PA', '幻刺', 'huanci'],
  templar_assassin: ['TA', '圣堂', 'shengtang'],
  queen_of_pain: ['QOP', '女王', 'nvwang'],
  pudge: ['屠夫', 'tufu'],
  windranger: ['WR', '风行', 'fengxing'],
  kunkka: ['船长', 'chuanzhang'],
  shadow_shaman: ['SS', '小Y', 'xiaoy'],
  wraith_king: ['WK', '骷髅王', 'kulouwang'],
  death_prophet: ['DP', '死亡先知'],
  natures_prophet: ['NP', '先知'],
  lifestealer: ['小狗', 'xiaogou'],
  bounty_hunter: ['BH', '赏金'],
  ancient_apparition: ['AA', '冰魂', 'binghun'],
  outworld_destroyer: ['OD', '黑鸟', 'heiniao'],
  chaos_knight: ['CK', '混沌骑士'],
  keeper_of_the_light: ['KOTL', '光法', 'guangfa'],
  naga_siren: ['小娜迦', 'xiaonajia'],
  medusa: ['大娜迦', 'danajia'],
  terrorblade: ['TB', '恐怖利刃'],
  legion_commander: ['LC', '军团'],
  skywrath_mage: ['天怒', 'tiannu'],
};
const normalize = value => String(value || '').toLowerCase().normalize('NFKC').replace(/[\s_\-']/g, '');
const acronyms = new Set(Object.values(HERO_SEARCH_ALIASES).flat()
  .filter(value => /^[a-z]{1,3}$/i.test(value)).map(normalize));

export function heroMatchesSearch(hero, query) {
  const needle = normalize(query);
  if (!needle) return true;
  const acronym = acronyms.has(needle);
  const names = [hero.nameZh, hero.nameEn, hero.id];
  const aliases = [...(hero.aliases || []), ...(HERO_SEARCH_ALIASES[hero.id] || [])];
  return names.some(value => acronym ? normalize(value) === needle : normalize(value).includes(needle)) ||
    aliases.some(value => acronym ? normalize(value) === needle : normalize(value).includes(needle));
}
