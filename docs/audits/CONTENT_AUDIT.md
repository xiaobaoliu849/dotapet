# DotaPad content and audio audit

Current catalog fetched: 2026-11-19T05:04:28.926Z

Baseline candidates are inferred from archived generation inputs. MP3 transcripts have not been verified by listening or speech recognition.

## Findings

| Classification | Lessons |
| --- | ---: |
| baseline-matches | 784 |
| baseline-changed | 197 |
| baseline-extra-context | 84 |
| current-verified | 26 |
| needs-stats-template | 65 |
| missing | 164 |
| unknown-transcript | 8 |
| unresolved-current | 1 |

Candidate scripts ready for review: **309**. No MP3s were generated, deleted or replaced.

Lessons with observed numeric differences in shared archived/current fields: **523**. Separate [numeric and bilingual comparison](historical-data-comparison.json). Entries absent from the archive are coverage differences, not proof of newly introduced or removed gameplay content. Missing historical fields are not treated as changes.

“Baseline matches” means archived candidate text matches current narration text; it does not verify what the MP3 actually says. “Baseline changed” is a review priority, not proof that the audio is wrong. Unresolved source placeholders are excluded from synthesis.

“Baseline extra context” means the current main description is present unchanged in the archived candidate, which also includes other notes or stats. That extra context requires review; it is not automatically labelled obsolete or queued for replacement.

“Needs stats template” means the feed provides an empty prose description (typically a stat-only item); it needs a narration template based on current attributes, not placeholder repair. “Unresolved current” means a nonempty description still contains a source token.

The official item feed includes historical/internal entries. Missing-item candidates require an active-item availability review before synthesis; their queue records explicitly start with purchaseAvailabilityVerified=false.

## Review priority: changed baseline wording

| Lesson | Topic | ID |
| --- | --- | --- |
| Persecutor | Anti-Mage · 敌法师 | ability:1447 |
| Crystal Clone | Crystal Maiden · 水晶室女 | ability:953 |
| Multishot | Drow Ranger · 卓尔游侠 | ability:343 |
| Marksmanship | Drow Ranger · 卓尔游侠 | ability:5022 |
| Blade Fury | Juggernaut · 主宰 | ability:5028 |
| Omnislash | Juggernaut · 主宰 | ability:5030 |
| Sacred Arrow | Mirana · 米拉娜 | ability:5048 |
| Celestial Quiver | Mirana · 米拉娜 | ability:1739 |
| Presence of the Dark Lord | Shadow Fiend · 影魔 | ability:5063 |
| Requiem of Souls | Shadow Fiend · 影魔 | ability:5064 |
| Necromastery | Shadow Fiend · 影魔 | ability:5062 |
| Morph | Morphling · 变体精灵 | ability:5057 |
| Juxtapose | Phantom Lancer · 幻影长矛手 | ability:5067 |
| Flesh Heap | Pudge · 帕吉 | ability:1223 |
| Stinger | Sand King · 沙王 | ability:1229 |
| Galvanized | Storm Spirit · 风暴之灵 | ability:1231 |
| Vengeance Aura | Vengeful Spirit · 复仇之魂 | ability:5123 |
| Focus Fire | Windranger · 风行者 | ability:5133 |
| Static Field | Zeus · 宙斯 | ability:5112 |
| Fiery Soul | Lina · 莉娜 | ability:5042 |
| Ice Spire | Lich · 巫妖 | ability:8028 |
| To Hell and Back | Lion · 莱恩 | ability:1249 |
| Urnaconda | Shadow Shaman · 暗影萨满 | ability:1743 |
| Mass Serpent Ward | Shadow Shaman · 暗影萨满 | ability:5081 |
| Dead in the Water | Tidehunter · 潮汐猎人 | ability:5407 |
| Leviathan's Catch | Tidehunter · 潮汐猎人 | ability:1746 |
| Maledict | Witch Doctor · 巫医 | ability:5140 |
| Backstab | Riki · 力丸 | ability:1258 |
| Warp Flare | Tinker · 修补匠 | ability:909 |
| Assassinate | Sniper · 狙击手 | ability:5157 |
| Shadow Strike | Queen of Pain · 痛苦女王 | ability:5173 |
| Plague Ward | Venomancer · 剧毒术士 | ability:5180 |
| Spirit Siphon | Death Prophet · 死亡先知 | ability:5685 |
| Witchcraft | Death Prophet · 死亡先知 | ability:5092 |
| Immaterial | Phantom Assassin · 幻影刺客 | ability:1287 |
| Decrepify | Pugna · 帕格纳 | ability:5187 |
| Nether Ward | Pugna · 帕格纳 | ability:5188 |
| Life Drain | Pugna · 帕格纳 | ability:5189 |
| Meld | Templar Assassin · 圣堂刺客 | ability:5195 |
| Inner Peace | Templar Assassin · 圣堂刺客 | ability:1750 |
| Moon Glaives | Luna · 露娜 | ability:5223 |
| Nothl Projection | Dazzle · 戴泽 | ability:1550 |
| Power Cogs | Clockwerk · 发条技师 | ability:5238 |
| Overclocking | Clockwerk · 发条技师 | ability:321 |
| Armor Power | Clockwerk · 发条技师 | ability:1295 |
| Nihilism | Leshrac · 拉席克 | ability:539 |
| Defilement | Leshrac · 拉席克 | ability:1297 |
| Curse of the Oldgrowth | Nature's Prophet · 自然先知 | ability:997 |
| Spirit of the Forest | Nature's Prophet · 自然先知 | ability:1298 |
| Feast | Lifestealer · 噬魂鬼 | ability:5250 |
| Skeleton Walk | Clinkz · 克林克兹 | ability:5261 |
| Hammer of Purity | Omniknight · 全能骑士 | ability:656 |
| Enchant | Enchantress · 魅惑魔女 | ability:5268 |
| Spider's Milk | Broodmother · 育母蜘蛛 | ability:1313 |
| Big Game Hunter | Bounty Hunter · 赏金猎人 | ability:1316 |
| Geminate Attack | Weaver · 编织者 | ability:5291 |
| Threads of Fate | Weaver · 编织者 | ability:1754 |
| Sticky Napalm | Batrider · 蝙蝠骑士 | ability:5320 |
| Holy Persuasion | Chen · 陈 | ability:5330 |
| Zealot | Chen · 陈 | ability:1755 |
| Cold Feet | Ancient Apparition · 远古冰魄 | ability:5345 |
| Bone Chill | Ancient Apparition · 远古冰魄 | ability:1756 |
| Earthshock | Ursa · 熊战士 | ability:5357 |
| Flak Cannon | Gyrocopter · 矮人直升机 | ability:5363 |
| Side Gunner | Gyrocopter · 矮人直升机 | ability:1758 |
| Invoke | Invoker · 祈求者 | ability:5375 |
| Sanity's Eclipse | Outworld Destroyer · 殁境神蚀者 | ability:5394 |
| Feral Impulse | Lycan · 狼人 | ability:5397 |
| Wolf Bite | Lycan · 狼人 | ability:333 |
| Liquid Courage | Brewmaster · 酒仙 | ability:1681 |
| Shadow Poison | Shadow Demon · 暗影恶魔 | ability:5423 |
| Summon Spirit Bear | Lone Druid · 独行德鲁伊 | ability:1342 |
| Phantasm | Chaos Knight · 混沌骑士 | ability:5429 |
| Dig | Meepo · 米波 | ability:547 |
| Divided We Stand | Meepo · 米波 | ability:5433 |
| Ceaseless Dirge | Undying · 不朽尸王 | ability:1360 |
| Kinetic Fence | Disruptor · 干扰者 | ability:1362 |
| Burrow | Nyx Assassin · 司夜刺客 | ability:5666 |
| Bright Speed | Keeper of the Light · 光之守卫 | ability:1769 |
| Gorgon's Grasp | Medusa · 美杜莎 | ability:1475 |
| Battle Trance | Troll Warlord · 巨魔战将 | ability:5512 |
| Shield of the Scion | Skywrath Mage · 天怒法师 | ability:833 |
| Mist Coil | Abaddon · 亚巴顿 | ability:5585 |
| Curse of Avernus | Abaddon · 亚巴顿 | ability:5587 |
| Withering Mist | Abaddon · 亚巴顿 | ability:1481 |
| Stone Remnant | Earth Spirit · 大地之灵 | ability:1395 |
| Sun Ray | Phoenix · 凤凰 | ability:5626 |
| Dying Light | Phoenix · 凤凰 | ability:1397 |
| Supernova | Phoenix · 凤凰 | ability:5630 |
| Splinter Blast | Winter Wyvern · 寒冬飞龙 | ability:5652 |
| Winter's Curse | Winter Wyvern · 寒冬飞龙 | ability:5654 |
| Invading Force | Underlord · 孽主 | ability:1486 |
| Fiend's Gate | Underlord · 孽主 | ability:865 |
| Jingu Mastery | Monkey King · 齐天大圣 | ability:5723 |
| Swashbuckle | Pangolier · 石鳞剑士 | ability:6344 |
| Phantom's Embrace | Grimstroke · 天涯墨客 | ability:8006 |
| Dark Portrait | Grimstroke · 天涯墨客 | ability:7852 |
| Dauntless | Mars · 玛尔斯 | ability:1415 |
| Astral Step | Void Spirit · 虚无之灵 | ability:7705 |
| Scatterblast | Snapfire · 电炎绝手 | ability:6480 |
| Rebound | Marci · 玛西 | ability:8235 |
| Special Delivery | Marci · 玛西 | ability:1428 |
| Rock Throw | Primal Beast · 獸 | ability:7739 |
| Spectral Slug | Muerta · 琼英碧灵 | ability:1785 |
| Funhouse Mirror | Ringmaster · 百戏大王 | ability:389 |
| Strongman Tonic | Ringmaster · 百戏大王 | ability:392 |
| Whoopee Cushion | Ringmaster · 百戏大王 | ability:390 |
| Unicycle | Ringmaster · 百戏大王 | ability:196 |
| Echo Slash | Kez · 凯 | ability:1498 |
| Raptor Dance | Kez · 凯 | ability:1501 |
| Falcon Rush | Kez · 凯 | ability:1502 |
| Shodo Sai | Kez · 凯 | ability:1504 |
| Raven's Veil | Kez · 凯 | ability:1506 |
| Bullbelly Blitz | Largo · 朗戈 | ability:1663 |
| Overwhelming Blink | item | item:600 |
| Blood Grenade | item | item:1123 |
| Phylactery | item | item:1107 |
| Poor Man's Shield | item | item:71 |
| Vladmir's Offering | item | item:81 |
| Buckler | item | item:86 |
| Holy Locket | item | item:269 |
| Headdress | item | item:94 |
| Bloodthorn | item | item:250 |
| Hurricane Pike | item | item:263 |
| Shiva's Guard | item | item:119 |
| Bloodstone | item | item:121 |
| Meteor Hammer | item | item:223 |
| Nullifier | item | item:225 |
| Essence Distiller | item | item:1852 |
| Crimson Guard | item | item:242 |
| Consecrated Wraps | item | item:1854 |
| Crella's Crozier | item | item:1856 |
| Monkey King Bar | item | item:135 |
| Manta Style | item | item:147 |
| Shadow Blade | item | item:152 |
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
| Solar Crest | item | item:229 |
| Smoke of Deceit | item | item:188 |
| Veil of Discord | item | item:190 |
| Parasma | item | item:1806 |
| Guardian Greaves | item | item:231 |
| Heaven's Halberd | item | item:210 |
| Tranquil Boots | item | item:214 |
| Spider Legs | item | item:326 |
| Essence Ring | item | item:359 |
| Book of the Dead | item | item:370 |
| Fallen Sky | item | item:371 |
| Minotaur Horn | item | item:377 |
| Chipped Vest | item | item:565 |
| Cloak of Flames | item | item:574 |
| Possessed Mask | item | item:577 |
| Psychic Headband | item | item:675 |
| Stormcrafter | item | item:585 |
| Witchbane | item | item:837 |
| Tumbler's Toy | item | item:840 |
| Seeds of Serenity | item | item:945 |
| Occult Bracelet | item | item:947 |
| Dagger of Ristul | item | item:1077 |
| Revenant's Brooch | item | item:911 |
| Duelist Gloves | item | item:2097 |
| Dandelion Amulet | item | item:2190 |
| Unrelenting Eye | item | item:1598 |
| Mana Draught | item | item:1599 |
| Crippling Crossbow | item | item:1601 |
| Gunpowder Gauntlet | item | item:1603 |
| Searing Signet | item | item:1604 |
| Serrated Shiv | item | item:1605 |
| Kobold Cup | item | item:1637 |
| Jidi Pollen Bag | item | item:1640 |
| Dezun Bloodrite | item | item:1642 |
| Divine Regalia | item | item:1644 |
| Weighted Dice | item | item:1716 |
| Ash Legion Shield | item | item:1717 |
| Riftshadow Prism | item | item:1718 |
| Metamorphic Mandible | item | item:1719 |
| Idol of Scree'auk | item | item:1720 |
| Flayer's Bota | item | item:1721 |
| Spellslinger | item | item:1859 |
| Prophet's Pendulum | item | item:1860 |
| Stonefeather Satchel | item | item:1861 |
| Enchanter's Bauble | item | item:1862 |
| Harmonizer | item | item:1863 |
| Conjurer's Catalyst | item | item:1864 |
| Forager's Kit | item | item:1868 |
| Partisan's Brand | item | item:1873 |

Full before/after candidate scripts: [JSON audit](latest-content-audit.json). Reviewed regeneration candidates: [queue](audio-regeneration-queue.json) (all start unreviewed).

## Policy

Keep official bilingual lesson text and balance facts current. Version each generated recording with the exact script hash and catalog retrieval time. Regenerate only reviewed changed scripts; reuse recordings whose verified script still matches. Treat biographies and everyday expressions separately from balance-sensitive explanations. Do not wait for a predicted patch date.
