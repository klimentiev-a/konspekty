# Topic 1. The three statements and how they link
short: Как связаны ОФР, баланс и ОДДС, «walk me through the three statements», что происходит при изменении амортизации, выручки и оборотного капитала
level: B2
unit: 1
minutes: 8

## Theory

> **In one minute.** The income statement (P&L; ОФР, отчёт о прибылях и убытках) shows performance over a period; the balance sheet (баланс) shows the position at a date; the cash flow statement (ОДДС, отчёт о движении денежных средств) reconciles (сверяет) profit with cash. Net income (NI, чистая прибыль) is the link: it flows into retained earnings (нераспределённая прибыль) on the balance sheet and is the first line of cash flow from operations (CFO, операционный денежный поток). Every change you make to one statement must land on the other two, and the balance sheet must still balance.

## The three links

```f
1. Net income → Retained earnings (Equity)           — balance sheet
2. Net income → first line of CFO, + D&A − ΔNWC       — cash flow statement
3. Closing cash (CFS) → Cash (Assets)                 — balance sheet
   Capex → PP&E; new debt → Liabilities; dividends → Retained earnings ↓
```

Abbreviations: D&A is depreciation and amortisation (амортизация), ΔNWC is the change in net working capital (изменение оборотного капитала), CFS is the cash flow statement, PP&E is property, plant and equipment (основные средства), CFI and CFF are investing and financing cash flows (инвестиционный и финансовый денежные потоки).

Assets = Liabilities + Equity holds after every transaction (операция). If it does not, you have forgotten one leg of the entry (проводка).

## Walk me through: depreciation up by 10 (tax 25%)

The standard interview script, line by line.

| Statement | Change | Why |
|---|---|---|
| Income statement | EBIT (operating profit, операционная прибыль) −10, tax −2.5, net income −7.5 | D&A is an expense before tax |
| Cash flow statement | NI −7.5, add back D&A +10, CFO +2.5, cash +2.5 | D&A is non-cash (неденежный расход); the tax saving is real |
| Balance sheet | Cash +2.5, PP&E −10 → assets −7.5; retained earnings −7.5 → equity −7.5 | Both sides down 7.5, balances |

The tax shield (налоговый щит) is the only cash effect: 10 × 25% = 2.5. Higher D&A lowers profit but raises cash.

## Walk me through: revenue up by 100 on credit (cost 60, tax 25%)

| Statement | Change |
|---|---|
| Income statement | Revenue +100, COGS (cost of goods sold, себестоимость продаж) +60, EBIT +40, tax +10, NI +30 |
| Cash flow statement | NI +30, receivables (дебиторская задолженность) +100 → −100 in ΔNWC, inventory −60 → +60; CFO −10; cash −10 |
| Balance sheet | Cash −10, receivables +100, inventory −60 → assets +30; retained earnings +30 |

Profit rose by 30 while cash fell by 10: the sale is booked under the accrual principle (принцип начисления) before the customer pays. This is why analysts compare cash conversion (конверсия прибыли в деньги) = CFO / EBITDA (earnings before interest, taxes, depreciation and amortisation; прибыль до процентов, налогов и амортизации) across years.

## Walk me through: 100 of capex financed with debt

Income statement: nothing in year 0 (capex is not an expense; depreciation starts next year, interest starts accruing). Cash flow: CFI −100, CFF +100, cash unchanged. Balance sheet: PP&E +100, debt +100. From year 1: D&A and interest expense (процентные расходы) hit the P&L, interest is paid in CFO, principal (основная сумма) is repaid in CFF.

## Which statement matters most?

The interview answer: the cash flow statement, because cash is a fact and profit is an opinion (прибыль — мнение, деньги — факт), and because valuation (оценка) discounts cash flows. If you can see only one line, take CFO; if you can see only two statements, take the income statement and the balance sheet, since the cash flow statement can be rebuilt from them.

## Where numbers come from

Statements are prepared under IFRS (МСФО) for Russian public companies, US GAAP (ОПБУ США) in the United States and RAS (РСБУ, российские стандарты) for tax and statutory purposes. Annual reports (годовые отчёты) are audited (проверены аудитором); quarterly ones usually are not. Notes to the statements (примечания к отчётности) hold the details that the face of the statements hides: debt schedules, lease commitments, segment data (данные по сегментам), related-party transactions (операции со связанными сторонами).

## Checks and pitfalls

- Deferred revenue (отложенная выручка) is a liability, not revenue: cash received before delivery.
- Dividends never touch the income statement: equity down, cash down (CFF).
- Share buybacks (обратный выкуп) reduce equity through treasury shares (казначейские акции), not through profit.
- Goodwill impairment (обесценение гудвила) is a non-cash loss: NI down, add back in CFO, cash unchanged.
- Interest paid sits in CFO under US GAAP; under IFRS it may be in CFO or CFF: check the policy before comparing.

## Words

| Term | Перевод | Example |
|---|---|---|
| income statement (P&L) | отчёт о прибылях и убытках, ОФР | The income statement covers a period, not a date. |
| balance sheet | баланс | The balance sheet must balance after every entry. |
| cash flow statement | отчёт о движении денежных средств, ОДДС | The cash flow statement reconciles profit with cash. |
| reconcile | сверять, увязывать | CFO reconciles net income with operating cash. |
| retained earnings | нераспределённая прибыль | Net income flows into retained earnings. |
| accrual principle | принцип начисления | Revenue is recognised on delivery under the accrual principle. |
| non-cash expense | неденежный расход | Depreciation is the classic non-cash expense. |
| tax shield | налоговый щит | The tax shield on D&A equals D&A times the tax rate. |
| cash conversion | конверсия прибыли в деньги | Cash conversion fell to 60% of EBITDA. |
| receivables | дебиторская задолженность | A jump in receivables drains operating cash flow. |
| inventory | запасы | Inventory build-up ahead of the season reduced CFO. |
| capital expenditures (capex) | капитальные затраты | Capex is capitalised, not expensed. |
| capitalise vs expense | капитализировать / списывать в расходы | The company capitalised development costs. |
| principal | основная сумма долга | Principal repayments sit in financing cash flow. |
| deferred revenue | отложенная выручка | Deferred revenue is a liability until the service is delivered. |
| treasury shares | казначейские акции | Buybacks create treasury shares. |
| impairment | обесценение | The impairment is non-cash and added back in CFO. |
| notes to the financial statements | примечания к отчётности | The debt schedule is in the notes. |
| related-party transactions | операции со связанными сторонами | Related-party transactions are disclosed separately. |
| statutory accounts | отчётность по национальным стандартам | Statutory accounts under RAS differ from IFRS. |
| audited | проверенный аудитором | Only the annual statements are audited. |
