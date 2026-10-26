# Topic 19. IFRS vs US GAAP, consolidation and goodwill
short: Ключевые различия стандартов, периметр консолидации и контроль, метод долевого участия, NCI, гудвил и обесценение, сегменты, отложенные налоги
level: C1
unit: 4
minutes: 8

## Theory

> **In one minute.** IFRS (МСФО) is principles-based (на принципах), US GAAP (ОПБУ США) rules-based (на правилах); the logic matches, the details differ. Consolidation (консолидация) depends on control (контроль): subsidiaries (дочерние компании) are consolidated line by line with NCI (доля меньшинства); associates (ассоциированные компании, 20–50%) use the equity method (метод долевого участия); JVs, joint ventures (совместные предприятия), likewise. Goodwill = price − fair value of net assets, tested for impairment, never amortised under IFRS.

## Perimeter of consolidation

```f
Control (IFRS 10): power + exposure to variable returns + ability to use power → consolidate 100%, show NCI
Significant influence (20–50%, IAS 28): equity method — one line "share of profit", one line "investment"
Joint control (IFRS 11): joint venture → equity method; joint operation → proportionate share
< 20%: financial asset at fair value (FVTPL / FVOCI)
```

IAS are the older International Accounting Standards still in force (МСФО (IAS)); FVTPL means fair value through profit or loss, FVOCI — fair value through other comprehensive income (see below).

Consolidation steps: add 100% of the subsidiary's lines, eliminate (исключить) intercompany balances and sales (внутригрупповые обороты), unrealised profit in inventory, the parent's investment against the subsidiary's equity; what remains is goodwill; the part of net assets not owned is NCI. Equity-accounted income is in EBIT or below depending on policy and is excluded from EBITDA by most analysts, so the stake is added separately in the EV bridge (мост от стоимости бизнеса к стоимости акций).

## Goodwill and impairment

```f
Goodwill = Consideration + NCI (fair value or proportionate) − Fair value of identifiable net assets
Impairment test (IAS 36) annually at cash-generating unit (CGU, единица, генерирующая денежные потоки) level:
  recoverable amount = max(value in use, fair value less costs of disposal) < carrying amount → impairment
Under US GAAP: qualitative step then quantitative; no reversal of goodwill impairment under either standard
```

Impairment is non-cash but signals overpayment and often precedes dividend cuts or covenant (ковенант) pressure.

## Key IFRS vs US GAAP differences

FIFO and LIFO are first-in-first-out and last-in-first-out inventory methods (ФИФО и ЛИФО); ASC is the US GAAP Accounting Standards Codification; CFS, CFO and CFF are the cash flow statement and its operating and financing sections.

| Area | IFRS | US GAAP |
|---|---|---|
| Inventory | FIFO or weighted average; no LIFO | LIFO allowed (LIFO reserve disclosed) |
| Development costs | Capitalised if criteria met (IAS 38) | Expensed (except software) |
| PP&E revaluation | Allowed (revaluation model) | Not allowed |
| Leases | All on balance sheet; single model (IFRS 16) | Operating vs finance lease; both on balance sheet (ASC 842), different expense pattern |
| Impairment of assets | One-step, reversible for non-goodwill | Two-step, no reversal |
| Interest paid in CFS | CFO or CFF | CFO |
| Extraordinary items | Prohibited | Prohibited since 2015 |
| Deferred tax | Balance sheet liability method, no current/non-current split | Same method, all non-current |
| Fair value hierarchy | Level 1/2/3 (IFRS 13) | Level 1/2/3 (ASC 820) |

RAS (РСБУ) differences: tax-driven, less fair value, no consolidation requirement at entity level, different lease and impairment practice; use IFRS for analysis and RAS for dividend capacity of subsidiaries (dividends are paid from RAS net profit).

## Deferred taxes and other items

A deferred tax liability (DTL, отложенное налоговое обязательство) arises when book value exceeds tax base (налоговая база): accelerated tax depreciation, write-ups in the PPA, purchase price allocation (распределение цены покупки). Deferred tax asset (DTA, отложенный налоговый актив): tax losses, provisions. DTL from PPA is debt-like only if it will reverse in cash. Provisions (резервы, IAS 37): recognised when probable and measurable; contingent liabilities (условные обязательства) only disclosed. Segment reporting (IFRS 8, сегментная отчётность): revenue and EBITDA by segment feed the SOTP, sum-of-the-parts valuation (оценка по частям).

## Fair value and financial instruments

IFRS 9 classification: amortised cost (амортизированная стоимость), FVOCI (через прочий совокупный доход), FVTPL (через прибыль или убыток); the expected credit loss (ECL, ожидаемые кредитные убытки) model with stages 1–3 for banks. Hedge accounting (учёт хеджирования) aligns derivative gains with the hedged item. Fair value hierarchy: Level 1 quoted prices, Level 2 observable inputs, Level 3 models.

## Audit vocabulary

Unqualified opinion (безоговорочно положительное заключение), qualified (с оговоркой), adverse (отрицательное), disclaimer (отказ от выражения мнения); key audit matters (ключевые вопросы аудита); going concern; restatement (пересчёт прошлых отчётов); material misstatement (существенное искажение); materiality threshold (порог существенности).

## Words

| Term | Перевод | Example |
|---|---|---|
| principles-based / rules-based | основанный на принципах / на правилах | IFRS is principles-based, US GAAP rules-based. |
| perimeter of consolidation | периметр консолидации | The JV is outside the perimeter of consolidation. |
| control | контроль (IFRS 10) | Control means power over relevant activities. |
| significant influence | значительное влияние | A 30% stake gives significant influence. |
| equity method | метод долевого участия | The associate is accounted for by the equity method. |
| intercompany elimination | исключение внутригрупповых оборотов | Intercompany sales are eliminated on consolidation. |
| non-controlling interest (NCI) | неконтролирующая доля | NCI reflects the 25% held by minorities. |
| cash-generating unit (CGU) | единица, генерирующая денежные потоки | Goodwill is tested at the CGU level. |
| recoverable amount | возмещаемая стоимость | The recoverable amount fell below carrying value. |
| value in use | ценность использования | Value in use is a DCF of the CGU. |
| carrying amount | балансовая стоимость | Carrying amount exceeded fair value. |
| LIFO reserve | резерв ЛИФО | Add the LIFO reserve to compare inventories. |
| revaluation model | модель переоценки | The revaluation model is allowed under IFRS only. |
| deferred tax asset / liability | отложенный налоговый актив / обязательство | The DTL arose from accelerated tax depreciation. |
| tax base | налоговая база (актива) | Book value above tax base creates a DTL. |
| provision | резерв (под обязательство) | A provision was booked for the lawsuit. |
| segment reporting | сегментная отчётность | Segment reporting feeds the sum-of-the-parts. |
| amortised cost | амортизированная стоимость | Loans are carried at amortised cost. |
| expected credit loss (ECL) | ожидаемые кредитные убытки | ECL provisions rose in stage 3. |
| fair value hierarchy | иерархия справедливой стоимости | Level 3 inputs are unobservable. |
| restatement | пересчёт (корректировка) прошлой отчётности | The restatement cut prior-year profit by 10%. |
| materiality | существенность | The error was below the materiality threshold. |
