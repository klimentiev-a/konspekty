# Topic 10. Building a three-statement model
short: Драйверы прогноза, расписания долга и амортизации, циркулярность, балансировка через revolver и cash sweep, проверки и сценарии в Excel
level: C1
unit: 2
minutes: 8

## Theory

> **In one minute.** A three-statement model (модель трёх отчётов) forecasts the income statement, balance sheet and cash flow statement so that they tie (сходятся): the cash from the CFS equals cash on the balance sheet and assets equal liabilities plus equity in every year. Drivers (драйверы) sit on one assumptions sheet (лист предпосылок), schedules (расписания) compute debt, D&A and NWC, and a revolver (возобновляемая кредитная линия) balances the sheet.

## Layout

```f
Assumptions → Income statement → Balance sheet → Cash flow statement
Schedules: D&A and capex (PP&E roll-forward), NWC (days), debt (tranches, interest, repayments),
           equity (dividends, buybacks), tax (NOLs), leases
Checks: BS balance = 0; cash CFS = cash BS; debt schedule = BS debt; no negative cash
```

Conventions: inputs in blue, formulas in black, links in green; one formula per row across years; no hard-coded numbers (жёстко прописанные числа) inside formulas; historical columns to the left of forecast; units stated.

## Drivers

- **Revenue:** volume × price, or segment growth; tie to capacity and market.
- **Costs:** % of revenue for variable (переменные), fixed (постоянные) grown with inflation; split COGS and opex.
- **NWC:** DSO, DIO, DPO days applied to revenue and COGS.
- **Capex and D&A:** capex as % of revenue or project list; D&A from the PP&E roll-forward (движение основных средств): opening + capex − D&A = closing; D&A = opening PP&E / useful life + new capex / life × ½.
- **Tax:** statutory rate on EBT, adjusted for NOLs (перенос убытков) and non-deductibles; deferred tax if needed.
- **Debt:** tranches (транши) with rate, maturity, amortisation (график погашения); interest on average balance.
- **Dividends:** payout ratio or policy formula.

## Balancing the model

Cash is the plug (балансирующая статья) through the cash flow statement; it must never be forced. Minimum cash (минимальный остаток) is an assumption; if forecast cash falls below it, the revolver draws; if cash is above it, the revolver repays or a cash sweep (досрочное погашение из избытка денег) pays down term debt.

```f
Revolver draw = MAX(0, Min cash − Cash before revolver)
Revolver repayment = MIN(Revolver balance, MAX(0, Cash before revolver − Min cash))
```

## Circularity

Interest depends on average debt, debt depends on cash, cash depends on interest: a circular reference (циклическая ссылка). Options: enable iterative calculation (итеративные вычисления) with a circuit breaker switch (переключатель-предохранитель) that sets interest to opening balance when the model blows up; or compute interest on opening balances and accept the simplification.

## Checks and error traps

- Balance check row: Assets − Liabilities − Equity = 0 in all years, conditional formatting.
- Cash tie: closing cash CFS = BS cash.
- Debt tie: schedule balances = BS debt by tranche.
- Signs: capex negative in CFI, D&A positive add-back, ΔNWC sign.
- Sanity: margins, NWC days, capex/D&A, leverage within plausible ranges; TV share.
- Use IFERROR sparingly; errors should be visible, not hidden.

## Scenarios and sensitivity

Scenario switch (переключатель сценариев) via CHOOSE or INDEX on the assumptions sheet: base, upside (оптимистичный), downside (пессимистичный). Data tables (таблицы данных, What-If) for two-way sensitivities; they slow the model, so keep them on a separate sheet. Goal Seek (подбор параметра) for break-even (точка безубыточности) questions: what revenue decline breaches the covenant?

## Excel vocabulary

Workbook (книга), worksheet / tab (лист), cell reference (ссылка на ячейку), absolute reference with $ (абсолютная ссылка), named range (именованный диапазон), lookup (INDEX/MATCH, XLOOKUP; ПОИСКПОЗ, ПРОСМОТРX), SUMPRODUCT (СУММПРОИЗВ), EOMONTH (КОНМЕСЯЦА), OFFSET (СМЕЩ), roll-forward (движение остатка: opening → closing), toggle (переключатель), flag (флаг 0/1), timeline (временная шкала).

## Words

| Term | Перевод | Example |
|---|---|---|
| three-statement model | модель трёх отчётов | The three-statement model ties in every year. |
| tie (out) | сходиться, увязываться | The cash flow ties to the balance sheet. |
| assumptions sheet | лист предпосылок | All inputs live on the assumptions sheet. |
| schedule | расписание (вспомогательный расчёт) | The debt schedule computes interest by tranche. |
| roll-forward | движение остатка (начало → конец периода) | The PP&E roll-forward drives depreciation. |
| hard-coded number | жёстко прописанное число | Avoid hard-coded numbers inside formulas. |
| variable / fixed costs | переменные / постоянные затраты | Fixed costs grow with inflation, variable with volume. |
| useful life | срок полезного использования | Equipment is depreciated over a ten-year useful life. |
| net operating loss (NOL) | налоговый убыток к переносу | NOLs shield taxable income for three years. |
| tranche | транш | The senior tranche amortises 10% a year. |
| amortisation schedule | график погашения | The amortisation schedule is back-ended. |
| plug | балансирующая статья | Cash is the plug through the cash flow statement. |
| minimum cash balance | минимальный остаток денежных средств | Minimum cash is set at 5% of revenue. |
| revolver (revolving credit facility) | возобновляемая кредитная линия | The revolver draws when cash falls below the minimum. |
| cash sweep | досрочное погашение из избытка денег | A 50% cash sweep repays the term loan early. |
| circular reference | циклическая ссылка | Interest on average debt creates a circular reference. |
| iterative calculation | итеративные вычисления | Enable iterative calculation to resolve the circularity. |
| circuit breaker | переключатель-предохранитель | A circuit breaker stops the model from blowing up. |
| scenario switch | переключатель сценариев | The scenario switch selects base, upside or downside. |
| data table | таблица данных (анализ «что если») | A data table shows price sensitivity to WACC and g. |
| Goal Seek | подбор параметра | Use Goal Seek to find the break-even price. |
| conditional formatting | условное форматирование | Conditional formatting flags a non-zero balance check. |
