# Genesis — Year Zero: World Bible

> Canon reference for designers and for the AI event generator. The simulation
> engine is the authority on world *state*; this document is the authority on
> world *tone and lore*. Anything not written here is undecided — not forbidden.

## 1. The Collapse (2089)

In 2089 a coordinated stratospheric climate intervention failed. Within months,
monsoon systems stalled, crop belts failed, and cascading failures in power,
logistics and communications brought down every government in the region.
Survivors know the *effects* of the collapse; almost none know the *cause*.

**Hidden truth (secret `project_halcyon`):** the intervention was *Project
Halcyon*, an aerosol-cooling programme rushed into deployment and concealed by
the governments that launched it. This must only become public through play.

## 2. Haven Deep (Vault 7)

A sealed bunker beneath the old Calder dam. It held ~200 people at the collapse;
four decades of closed-loop life have whittled that to about twenty. In **2131
(tick 0)** the survivors open the blast door for good.

- Reclaimers keep water flowing, but they were built for a sealed vault.
- Grow rooms produce monotonous, fragile crops.
- The archive holds fragments of modern science without the industry to use it.

**Hidden truth (secret `founders_pact`):** Haven Deep's founders were Halcyon
engineers who built the vault knowing the programme might fail.

## 3. The Surface

Habitable but scarred: ash soils, poisoned seeps, dust storms, ruined towns.

| Location | Known at start | Notes |
| --- | --- | --- |
| Ashford Crossing | yes | Bridge town on a slow river; fertile floodplain. Settleable. |
| Cinder Flats | yes | Burnt logistics park; rich in scrap. Settleable. |
| Old Reservoir | no | Drained basin over a clean aquifer. Settleable. |
| Greenhollow | no | Sheltered valley with feral orchards. Settleable. |
| Seed Vault Ruins | no | Agricultural research station; may hold viable seed. |
| Signal Tower | no | Relay mast on Harrow Ridge. |
| Vault 12 | hidden | A bunker absent from every Haven Deep map. Only narrative events can reveal it. |

**Hidden truth (secret `vault12_fate`):** Vault 12 sealed itself during a fever
outbreak; its residents chose quarantine over spreading the disease.

## 4. People and Professions

- **Scientists** keep and rebuild knowledge.
- **Engineers** salvage, build and maintain.
- **Medics** keep people alive without industrial medicine.
- **Scouts** walk the surface, forage, and find what was lost.

Children take a profession at 16. Elders (65+) work at half capacity but carry
memory. Survivors are pragmatic, scarred, and suspicious of grand projects.

## 5. Tone

Hopeful but not naïve. Rebuilding is slow and costly. Every gain has a price;
every crisis can be survived — or not. Avoid zombies, mutants, magic, and
superweapons. The danger is scarcity, sickness, weather, ruins and each other.

## 6. Technology Ladder

Water Purification · Salvage Tooling · Field Medicine · Hydroponics → Irrigation
(Hydroponics + Purification) · Shortwave Radio (Salvage) · Civic Charter (pop ≥ 30)
· Antibiotics (Medicine + Purification) · Solar Power (Salvage) → Power Grid
(Solar + Charter) · Crop Genetics (Irrigation + Antibiotics).

Events must never assume a technology that has not been unlocked. Use a
`technology` precondition to gate them.

## 7. Rules for Event Authors (human or AI)

1. Events describe *possibilities*. They fire only when preconditions hold.
2. State changes happen **only** through the typed effects (ADJUST_RESOURCE,
   CHANGE_RELATIONSHIP, DISCOVER_LOCATION, UNLOCK_TECHNOLOGY,
   CHANGE_SETTLEMENT_STAT, ADD_WORLD_FLAG, REMOVE_WORLD_FLAG,
   CREATE_HISTORICAL_EVENT, REVEAL_SECRET, ADD_LIFE_EVENT, CHARACTER_DEATH).
3. Secrets are revealed with `REVEAL_SECRET`, never by writing flags.
4. Dead characters cannot take part. Roles are filled from living residents.
5. History is append-only. Nothing can rewrite what already happened.
6. Keep resource swings proportional: a settlement of 20 consumes ~20 food and
   ~20 water per year.
7. Prefer choices with real trade-offs, tagged with the values they express
   (`cautious`, `bold`, `growth`, `science`, `community`, `industry`,
   `secrecy`, `openness`) so simulated councils can choose in character.
