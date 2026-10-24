# Topic 2. Income statement, EBITDA and adjustments
short: Структура ОФР, EBITDA и её корректировки, МСФО 16, разовые статьи, разводнённая EPS через treasury stock method
level: B2
unit: 1
minutes: 8

## Theory

> **In one minute.** Revenue → gross profit → EBITDA → EBIT → EBT → net income. EBITDA (прибыль до процентов, налогов и амортизации) is the banker's proxy for operating cash generation (операционная генерация денег): it strips out financing (interest), jurisdiction (tax) and asset age (D&A). Everyone adjusts it, so always ask which EBITDA: reported (отчётная), adjusted (скорректированная), pre- or post-IFRS 16, LTM or forward.

## Structure

```f
Revenue
− COGS                      → Gross profit        (gross margin, валовая маржа)
− SG&A, R&D, other opex     → EBITDA              (EBITDA margin)
− D&A                       → EBIT                (operating margin)
± Interest, FX, other       → EBT (pre-tax)
− Income tax                → Net income          (net margin)
÷ Diluted shares            → Diluted EPS
```

Margins (маржа, рентабельность) are each line divided by revenue. "Operating leverage" (операционный рычаг) means margins expand when revenue grows because part of the costs is fixed (постоянные затраты).

## EBITDA adjustments

Adjusted EBITDA (скорректированная EBITDA) removes items that are non-recurring (разовые) or non-operating (неоперационные):

- one-off items (разовые статьи): restructuring costs (расходы на реструктуризацию), litigation (судебные издержки), gains on asset sales (прибыль от продажи активов);
- impairments (обесценения) and write-offs (списания);
- share-based compensation (вознаграждение акциями) — US practice adds it back, many analysts do not;
- FX revaluation (курсовые переоценки) of debt and balances;
- income from associates (доход от ассоциированных компаний) if their value is added separately in the EV bridge.

Rule: whatever you add back to EBITDA must be treated consistently (единообразно) across all peers and in the EV bridge. Suspicious sign: "adjustments" every year in the same direction.

## IFRS 16 and leases

Since 2019 operating leases (операционная аренда) are capitalised: a right-of-use asset (актив в форме права пользования) and a lease liability (обязательство по аренде). Rent leaves opex and splits into depreciation and interest, so EBITDA rises mechanically for retailers, airlines and telecoms. Two consistent options: use post-IFRS 16 EBITDA and include lease liabilities in net debt, or use EBITDAR (EBITDA before rent) with pre-IFRS 16 debt. Mixing them makes EV/EBITDA look cheap.

## Revenue recognition

Under IFRS 15 revenue is recognised when control (контроль) of a good or service passes to the customer, allocated across performance obligations (обязанности к исполнению). Long contracts use percentage of completion (по мере готовности). Subscriptions create deferred revenue (отложенная выручка). Gross vs net (брутто или нетто): a marketplace books commission, not the full ticket. Check the policy before comparing revenue multiples.

## Below EBIT

Interest expense (процентные расходы) net of interest income; FX gains and losses (курсовые разницы); share of profit of associates (доля в прибыли ассоциированных компаний, equity method). Effective tax rate (эффективная ставка налога) = tax / EBT; it differs from the statutory rate (установленная законом ставка; 25% in Russia from 2025) because of non-deductible expenses (невычитаемые расходы), tax losses carried forward (перенос убытков) and different jurisdictions (юрисдикции).

## Diluted EPS and the treasury stock method

Basic EPS (базовая прибыль на акцию) = net income to common shareholders / weighted average shares (средневзвешенное число акций). Diluted EPS (разводнённая) adds potential shares from options, warrants and convertibles (конвертируемые бумаги).

```f
Treasury stock method (TSM):
new shares = options × (1 − strike / share price)      — only in-the-money options
Convertibles (if-converted): add conversion shares, add back after-tax interest to NI
```

Diluted share count is also what you use in the EV bridge and for price per share in a DCF.

## Quality of earnings checks

- Revenue grows, receivables grow faster → aggressive recognition.
- EBITDA grows, CFO does not → working capital or capitalised costs.
- Capitalised development (капитализированные разработки) rising → costs moved from P&L to balance sheet.
- Frequent changes in depreciation lives (сроки амортизации) or inventory method.
- Large "other income" (прочие доходы).

## Words

| Term | Перевод | Example |
|---|---|---|
| gross profit / gross margin | валовая прибыль / валовая маржа | Gross margin compressed on higher input costs. |
| operating leverage | операционный рычаг | Operating leverage drives margin expansion as volumes grow. |
| EBITDA | прибыль до процентов, налогов и амортизации | Adjusted EBITDA excludes restructuring costs. |
| adjusted (normalised) EBITDA | скорректированная EBITDA | Normalised EBITDA is the base for multiples. |
| non-recurring item | разовая статья | The fine was treated as a non-recurring item. |
| restructuring costs | расходы на реструктуризацию | Restructuring costs were added back. |
| write-off | списание | The write-off of obsolete inventory hit EBIT. |
| share-based compensation | вознаграждение акциями | US companies add back share-based compensation. |
| right-of-use asset | актив в форме права пользования | IFRS 16 created a right-of-use asset. |
| lease liability | обязательство по аренде | Lease liabilities are included in net debt. |
| EBITDAR | EBITDA до арендных платежей | Airlines are compared on EBITDAR. |
| revenue recognition | признание выручки | Revenue recognition follows IFRS 15. |
| performance obligation | обязанность к исполнению | Each performance obligation is recognised separately. |
| gross vs net revenue | выручка брутто и нетто | The marketplace reports net revenue. |
| effective tax rate | эффективная ставка налога | The effective tax rate is below the statutory 25%. |
| tax loss carryforward | перенос налогового убытка | Tax loss carryforwards reduce future cash taxes. |
| basic / diluted EPS | базовая / разводнённая прибыль на акцию | Diluted EPS is lower because of options. |
| treasury stock method | метод казначейских акций | The treasury stock method counts only in-the-money options. |
| weighted average shares | средневзвешенное число акций | EPS uses weighted average shares, not year-end. |
| equity method | метод долевого участия | Associates are accounted for by the equity method. |
| capitalised development costs | капитализированные затраты на разработку | Capitalised development costs flatter EBITDA. |
