# Topic 3. Balance sheet, working capital and net debt
short: Что считать долгом и долгоподобными статьями, NWC по операционному определению, DSO/DIO/DPO, цикл оборота денег, забалансовые обязательства
level: B2
unit: 1
minutes: 8

## Theory

> **In one minute.** The balance sheet is a photo: Assets = Liabilities + Equity. For valuation you need two things from it: net working capital, NWC (чистый оборотный капитал), because its change is a cash flow, and net debt (чистый долг) with debt-like items (долгоподобные статьи), because they are subtracted from enterprise value. Book equity (балансовый капитал) is history; market capitalization (рыночная капитализация) is expectation.

## Operating NWC

```f
NWC (operating) = Receivables + Inventory + Prepayments
               − Payables − Accrued expenses − Customer advances
Excludes: cash, short-term debt, current portion of LTD, dividends payable
```

Growth consumes NWC. ΔNWC > 0 is a cash outflow (отток), ΔNWC < 0 an inflow (приток). Forecast NWC through days (в днях), not as a lump sum:

```f
DSO = Receivables / Revenue × 365        (дни оборота дебиторки)
DIO = Inventory / COGS × 365             (дни оборота запасов)
DPO = Payables / COGS × 365              (дни оборота кредиторки)
Cash conversion cycle (CCC) = DSO + DIO − DPO
```

Retail and marketplaces often run a negative CCC: customers pay today, suppliers are paid in 45–60 days, so suppliers finance growth (поставщики финансируют рост). In a downturn this reverses: sales fall, payables still come due.

## Net debt and debt-like items

```f
Net debt = Gross debt (loans, bonds, leases) − Cash and equivalents
Debt-like items (subtract from EV in the bridge):
  lease liabilities (IFRS 16), pension deficits (дефицит пенсионного плана),
  asset retirement obligations (обязательства по выводу из эксплуатации),
  preferred shares, minority interest (NCI), earn-outs, deferred consideration,
  unpaid dividends, litigation provisions
Cash-like items (add): marketable securities, stakes in associates, non-core assets
```

Restricted cash (ограниченные в использовании денежные средства) is not cash. Trapped cash (заблокированные деньги) in foreign subsidiaries may be discounted. For a consistent EV/EBITDA, lease liabilities go into net debt only if EBITDA is post-IFRS 16.

## Leverage and liquidity ratios

```f
Net debt / EBITDA       — leverage; < 2x comfortable, > 4x stressed (sector-dependent)
Debt / Equity, Debt / Capital
Interest coverage = EBIT / Interest   (or EBITDA / Interest)
Current ratio = Current assets / Current liabilities
Quick ratio = (Current assets − Inventory) / Current liabilities
```

Utilities and infrastructure carry higher leverage because cash flows are regulated and stable; miners and developers cannot.

## Equity

Share capital (уставный капитал), share premium (эмиссионный доход), retained earnings, other comprehensive income, OCI (прочий совокупный доход: FX translation, revaluation), treasury shares (negative). Book value per share (балансовая стоимость на акцию) matters for banks and insurers, where P/B is the key multiple; for industrials it is mostly irrelevant.

## Off-balance-sheet and hidden liabilities

Guarantees (поручительства) for subsidiaries, take-or-pay contracts (контракты «бери или плати»), commitments (обязательства по капзатратам), contingent liabilities (условные обязательства) in litigation, factoring without recourse (факторинг без регресса) that removes receivables but not risk. All live in the notes (примечания). Due diligence (комплексная проверка) in M&A spends most of its time here.

## Reading the balance sheet in five minutes

1. Net debt / EBITDA and the maturity profile (график погашений): when is the debt wall (стена погашений)?
2. NWC days versus history and peers: are receivables ageing (стареет ли дебиторка)?
3. Goodwill and intangibles share of assets: acquisition-driven growth, impairment risk.
4. Cash versus short-term debt: liquidity cushion (подушка ликвидности), undrawn facilities (невыбранные кредитные линии).
5. Equity sign: negative equity (отрицательный капитал) after losses or buybacks is a covenant and solvency (платёжеспособность) issue.

## Words

| Term | Перевод | Example |
|---|---|---|
| net working capital (NWC) | чистый оборотный капитал | ΔNWC is a cash flow, not an expense. |
| operating definition | операционное определение | Use the operating definition of NWC, without cash and debt. |
| prepayments | авансы выданные, предоплата | Prepayments to suppliers are part of NWC. |
| customer advances | авансы полученные | Customer advances reduce working capital needs. |
| accrued expenses | начисленные расходы | Accrued expenses include unpaid wages. |
| days sales outstanding (DSO) | дни оборота дебиторской задолженности | DSO rose from 40 to 55 days. |
| cash conversion cycle | цикл оборота денежных средств | A negative cash conversion cycle funds growth. |
| gross debt / net debt | валовой долг / чистый долг | Net debt excludes cash on the balance sheet. |
| debt-like items | долгоподобные статьи | Pension deficits are debt-like items. |
| restricted cash | ограниченные в использовании денежные средства | Restricted cash is excluded from net debt. |
| asset retirement obligation | обязательство по выводу из эксплуатации | Miners carry large asset retirement obligations. |
| minority interest (NCI) | доля меньшинства, неконтролирующая доля | NCI is subtracted in the EV bridge. |
| interest coverage | покрытие процентов | Interest coverage dropped below 2x. |
| other comprehensive income (OCI) | прочий совокупный доход | FX translation differences go through OCI. |
| book value per share | балансовая стоимость на акцию | The bank trades at 0.8x book value per share. |
| contingent liability | условное обязательство | Contingent liabilities are disclosed in the notes. |
| take-or-pay contract | контракт «бери или плати» | Take-or-pay contracts are hidden fixed costs. |
| factoring without recourse | факторинг без регресса | Factoring without recourse removes receivables from the balance sheet. |
| maturity profile | график погашений | The maturity profile shows a wall in 2027. |
| undrawn facility | невыбранная кредитная линия | Undrawn facilities provide a liquidity cushion. |
| solvency | платёжеспособность | Negative equity raises solvency concerns. |
