# DotaPad content and audio audit

Current catalog fetched: 2026-11-15T07:31:22.731Z

Baseline candidates are inferred from archived generation inputs. MP3 transcripts have not been verified by listening or speech recognition.

## Findings

| Classification | Lessons |
| --- | ---: |
| baseline-matches | 884 |
| baseline-changed | 88 |
| baseline-extra-context | 100 |
| needs-stats-template | 65 |
| missing | 164 |
| unknown-transcript | 8 |
| unresolved-current | 1 |

Candidate scripts ready for review: **200**. No MP3s were generated, deleted or replaced.

Lessons with observed numeric differences in shared archived/current fields: **323**. Separate [numeric and bilingual comparison](historical-data-comparison.json). Entries absent from the archive are coverage differences, not proof of newly introduced or removed gameplay content. Missing historical fields are not treated as changes.

“Baseline matches” means archived candidate text matches current narration text; it does not verify what the MP3 actually says. “Baseline changed” is a review priority, not proof that the audio is wrong. Unresolved source placeholders are excluded from synthesis.

“Baseline extra context” means the current main description is present unchanged in the archived candidate, which also includes other notes or stats. That extra context requires review; it is not automatically labelled obsolete or queued for replacement.

“Needs stats template” means the feed provides an empty prose description (typically a stat-only item); it needs a narration template based on current attributes, not placeholder repair. “Unresolved current” means a nonempty description still contains a source token.

The official item feed includes historical/internal entries. Missing-item candidates require an active-item availability review before synthesis; their queue records explicitly start with purchaseAvailabilityVerified=false.

## Review priority: changed baseline wording

| Lesson | Topic | ID |
| --- | --- | --- |
| Persecutor | Anti-Mage · 敌法师 | ability:1447 |
| Multishot | Drow Ranger · 卓尔游侠 | ability:343 |
| Marksmanship | Drow Ranger · 卓尔游侠 | ability:5022 |
| Sacred Arrow | Mirana · 米拉娜 | ability:5048 |
| Necromastery | Shadow Fiend · 影魔 | ability:5062 |
| Morph | Morphling · 变体精灵 | ability:5057 |
| Flesh Heap | Pudge · 帕吉 | ability:1223 |
| Galvanized | Storm Spirit · 风暴之灵 | ability:1231 |
| Vengeance Aura | Vengeful Spirit · 复仇之魂 | ability:5123 |
| Fiery Soul | Lina · 莉娜 | ability:5042 |
| Leviathan's Catch | Tidehunter · 潮汐猎人 | ability:1746 |
| Maledict | Witch Doctor · 巫医 | ability:5140 |
| Immaterial | Phantom Assassin · 幻影刺客 | ability:1287 |
| Meld | Templar Assassin · 圣堂刺客 | ability:5195 |
| Inner Peace | Templar Assassin · 圣堂刺客 | ability:1750 |
| Power Cogs | Clockwerk · 发条技师 | ability:5238 |
| Spirit of the Forest | Nature's Prophet · 自然先知 | ability:1298 |
| Hammer of Purity | Omniknight · 全能骑士 | ability:656 |
| Big Game Hunter | Bounty Hunter · 赏金猎人 | ability:1316 |
| Zealot | Chen · 陈 | ability:1755 |
| Side Gunner | Gyrocopter · 矮人直升机 | ability:1758 |
| Invoke | Invoker · 祈求者 | ability:5375 |
| Sanity's Eclipse | Outworld Destroyer · 殁境神蚀者 | ability:5394 |
| Shadow Poison | Shadow Demon · 暗影恶魔 | ability:5423 |
| Phantasm | Chaos Knight · 混沌骑士 | ability:5429 |
| Divided We Stand | Meepo · 米波 | ability:5433 |
| Bright Speed | Keeper of the Light · 光之守卫 | ability:1769 |
| Battle Trance | Troll Warlord · 巨魔战将 | ability:5512 |
| Withering Mist | Abaddon · 亚巴顿 | ability:1481 |
| Stone Remnant | Earth Spirit · 大地之灵 | ability:1395 |
| Sun Ray | Phoenix · 凤凰 | ability:5626 |
| Dying Light | Phoenix · 凤凰 | ability:1397 |
| Splinter Blast | Winter Wyvern · 寒冬飞龙 | ability:5652 |
| Winter's Curse | Winter Wyvern · 寒冬飞龙 | ability:5654 |
| Dark Portrait | Grimstroke · 天涯墨客 | ability:7852 |
| Dauntless | Mars · 玛尔斯 | ability:1415 |
| Scatterblast | Snapfire · 电炎绝手 | ability:6480 |
| Rebound | Marci · 玛西 | ability:8235 |
| Funhouse Mirror | Ringmaster · 百戏大王 | ability:389 |
| Strongman Tonic | Ringmaster · 百戏大王 | ability:392 |
| Whoopee Cushion | Ringmaster · 百戏大王 | ability:390 |
| Unicycle | Ringmaster · 百戏大王 | ability:196 |
| Echo Slash | Kez · 凯 | ability:1498 |
| Shodo Sai | Kez · 凯 | ability:1504 |
| Raven's Veil | Kez · 凯 | ability:1506 |
| Holy Locket | item | item:269 |
| Hurricane Pike | item | item:263 |
| Shiva's Guard | item | item:119 |
| Bloodstone | item | item:121 |
| Essence Distiller | item | item:1852 |
| Consecrated Wraps | item | item:1854 |
| Crella's Crozier | item | item:1856 |
| Manta Style | item | item:147 |
| Silver Edge | item | item:249 |
| Mjollnir | item | item:158 |
| Eye of Skadi | item | item:160 |
| Helm of the Overlord | item | item:635 |
| Gleipnir | item | item:1466 |
| Mask of Madness | item | item:172 |
| Disperser | item | item:1097 |
| Orb of Venom | item | item:181 |
| Orb of Corrosion | item | item:569 |
| Orb of Frost | item | item:1575 |
| Mage Slayer | item | item:598 |
| Boots of Bearing | item | item:931 |
| Medallion of Courage | item | item:187 |
| Smoke of Deceit | item | item:188 |
| Spider Legs | item | item:326 |
| Book of the Dead | item | item:370 |
| Fallen Sky | item | item:371 |
| Minotaur Horn | item | item:377 |
| Cloak of Flames | item | item:574 |
| Possessed Mask | item | item:577 |
| Psychic Headband | item | item:675 |
| Witchbane | item | item:837 |
| Rattlecage | item | item:1168 |
| Jidi Pollen Bag | item | item:1640 |
| Dezun Bloodrite | item | item:1642 |
| Ash Legion Shield | item | item:1717 |
| Riftshadow Prism | item | item:1718 |
| Metamorphic Mandible | item | item:1719 |
| Idol of Scree'auk | item | item:1720 |
| Flayer's Bota | item | item:1721 |
| Enchanter's Bauble | item | item:1862 |
| Harmonizer | item | item:1863 |
| Conjurer's Catalyst | item | item:1864 |
| Forager's Kit | item | item:1868 |
| Partisan's Brand | item | item:1873 |

Full before/after candidate scripts: [JSON audit](latest-content-audit.json). Reviewed regeneration candidates: [queue](audio-regeneration-queue.json) (all start unreviewed).

## Policy

Keep official bilingual lesson text and balance facts current. Version each generated recording with the exact script hash and catalog retrieval time. Regenerate only reviewed changed scripts; reuse recordings whose verified script still matches. Treat biographies and everyday expressions separately from balance-sensitive explanations. Do not wait for a predicted patch date.
