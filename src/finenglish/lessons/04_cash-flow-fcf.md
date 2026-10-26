# Topic 4. Cash flow, FCFF and FCFE
short: Косвенный метод, три раздела ОДДС, формулы FCFF и FCFE, с какой ставкой что дисконтировать, cash conversion и дивидендная способность
level: B2
unit: 1
minutes: 8

## Theory

> **In one minute.** CFO, cash flow from operations (операционный денежный поток), starts from net income, adds back non-cash items and subtracts ΔNWC, the change in net working capital (изменение оборотного капитала). FCFF, free cash flow to the firm (поток для всех инвесторов), is unlevered (без учёта долга) and discounted at WACC, the weighted average cost of capital (средневзвешенная стоимость капитала), to get enterprise value (стоимость бизнеса); FCFE, free cash flow to equity (поток для акционеров), is levered (с учётом долга) and discounted at the cost of equity (стоимость собственного капитала) to get equity value (стоимость акционерного капитала). Never cross them.

## The three sections

```f
CFO = Net income + D&A + impairments + SBC ± other non-cash − ΔNWC (− interest paid, if shown here)
CFI = − Capex − Acquisitions + Disposals ± Financial investments
CFF = + Debt raised − Debt repaid + Equity issued − Buybacks − Dividends − Lease principal
Δ Cash = CFO + CFI + CFF + FX effect
```

CFI and CFF are investing and financing cash flows (инвестиционный и финансовый потоки), D&A is depreciation and amortisation (амортизация), SBC is share-based compensation (вознаграждение акциями).

Under IFRS (МСФО) interest paid and dividends received can sit in CFO or CFF; US GAAP puts interest paid in CFO. For comparisons, reclassify (переклассифицировать) to one convention.

## FCFF and FCFE

```f
FCFF = EBIT × (1 − t) + D&A − Capex − ΔNWC
     = NOPAT + D&A − Capex − ΔNWC
     = CFO + Interest × (1 − t) − Capex            (if interest is in CFO)

FCFE = FCFF − Interest × (1 − t) + Net borrowing
     = CFO − Capex + Net borrowing                  (if interest is in CFO)
```

Here t is the tax rate (ставка налога). NOPAT, net operating profit after tax (чистая операционная прибыль после налогов), uses EBIT (operating profit, операционная прибыль), not EBT (прибыль до налогообложения), because interest has not been deducted: the cash is available to lenders and shareholders together. Net borrowing (чистое привлечение долга) = new debt − repayments.

| Flow | Belongs to | Discount at | Result |
|---|---|---|---|
| FCFF | Lenders + shareholders | WACC | Enterprise value |
| FCFE | Shareholders | Cost of equity (Ke) | Equity value |
| Dividends | Shareholders | Ke | Equity value (DDM, dividend discount model) |

## Simple FCF and dividend capacity

```f
FCF (simple) = CFO − Capex
FCF yield = FCF / Market cap
Dividend capacity = FCF − mandatory debt repayments − lease principal
```

Russian dividend policies (дивидендная политика) often reference FCF (Lukoil: 100% of adjusted FCF), net income under IFRS (SOEs, state-owned enterprises — госкомпании: 50%), or leverage thresholds (Severstal, NLMK: 100% of FCF if Net debt/EBITDA < 1x). Read the policy, then rebuild the formula.

## Capex: maintenance versus growth

Maintenance capex (поддерживающие капзатраты) keeps capacity (мощности) flat; growth capex (капзатраты на рост) adds it. Companies rarely split them, so analysts proxy maintenance capex by D&A or by the company's guidance (ориентир менеджмента). In a DCF the terminal year must have capex ≥ D&A, otherwise the company shrinks while you assume it grows.

## Cash conversion and quality

```f
Cash conversion = CFO / EBITDA     (or FCF / Net income)
```

Below 60–70% for several years means profit is not turning into cash: receivables ageing, inventory build-up, capitalised costs (капитализированные расходы) hidden in CFI, or prepayments to related parties. Above 100% is usually temporary: NWC release (высвобождение оборотного капитала) in a downturn.

## Non-cash and non-operating traps

- Share-based compensation: non-cash, but it dilutes shareholders; subtract its value or count the shares.
- Capitalised interest (капитализированные проценты) on construction sits in CFI, not CFO.
- Factoring receivables boosts CFO once; it is financing in substance (по сути).
- Working capital facilities (кредитные линии на оборотный капитал) drawn at year end flatter cash.
- FX effect on cash (курсовой эффект) is not a flow: show it separately.

## Burn rate and runway

For loss-making companies: burn rate (скорость сжигания денег) = monthly negative FCF; runway (запас хода) = cash / burn rate. A venture round (раунд финансирования) must close before runway hits six months.

## Words

| Term | Перевод | Example |
|---|---|---|
| cash flow from operations (CFO) | операционный денежный поток | CFO covers capex twice. |
| indirect method | косвенный метод | The indirect method starts from net income. |
| disposal | продажа актива, выбытие | Disposals of non-core assets boosted CFI. |
| reclassify | переклассифицировать | Reclassify interest paid into CFO for comparability. |
| free cash flow to the firm (FCFF) | свободный денежный поток для фирмы | FCFF is unlevered and discounted at WACC. |
| free cash flow to equity (FCFE) | свободный денежный поток для акционеров | FCFE includes net borrowing. |
| unlevered / levered | без учёта долга / с учётом долга | Unlevered free cash flow ignores interest. |
| NOPAT | чистая операционная прибыль после налогов | NOPAT equals EBIT times one minus tax. |
| net borrowing | чистое привлечение долга | Net borrowing was positive after the refinancing. |
| dividend discount model (DDM) | модель дисконтирования дивидендов | Banks are often valued with a DDM. |
| FCF yield | доходность по свободному денежному потоку | A 12% FCF yield supports the dividend. |
| dividend capacity | дивидендная способность | Dividend capacity is FCF after mandatory repayments. |
| maintenance capex | поддерживающие капзатраты | Maintenance capex roughly equals D&A. |
| guidance | ориентир (прогноз менеджмента) | Management guidance implies capex of 50 billion. |
| capacity | мощности | Growth capex adds capacity. |
| cash conversion | конверсия прибыли в деньги | Cash conversion improved to 85%. |
| working capital release | высвобождение оборотного капитала | A working capital release lifted FCF in the downturn. |
| capitalised interest | капитализированные проценты | Capitalised interest is hidden in CFI. |
| in substance | по сути, по экономическому содержанию | Factoring is financing in substance. |
| burn rate | скорость сжигания денег | The burn rate is 3 million dollars a month. |
| runway | запас хода (месяцев денег) | Runway is under a year. |
