# Topic 5. Time value of money, NPV and IRR
short: Дисконтирование, аннуитет и перпетуитет, NPV и IRR с их ловушками, mid-year convention, связь IRR и MOIC
level: B2
unit: 2
minutes: 7

## Theory

> **In one minute.** PV = CF / (1 + r)^t. Perpetuity = C / r; growing perpetuity = C / (r − g). NPV (чистая приведённая стоимость) > 0 means the project earns more than its cost of capital; IRR (внутренняя норма доходности) is the rate at which NPV = 0. NPV decides, IRR communicates.

## Core formulas

```f
FV = PV × (1 + r)^n                  PV = FV / (1 + r)^n
Discount factor DF_t = 1 / (1 + r)^t
Annuity PV = C × [1 − (1 + r)^−n] / r
Perpetuity PV = C / r                Growing perpetuity PV = C₁ / (r − g), g < r
Mid-year convention: DF_t = 1 / (1 + r)^(t − 0.5)
EAR = (1 + APR / m)^m − 1            continuous: FV = PV × e^(rt)
Rule of 72: doubling time ≈ 72 / r(%)
```

Cash flows arrive through the year, not on 31 December, so DCF models use the mid-year convention (поправка на середину года); it raises value by roughly half a year of discounting. Nominal flows (номинальные, с инфляцией) go with nominal rates, real with real; rouble flows with a rouble rate.

## NPV

```f
NPV = Σ CF_t / (1 + r)^t − I₀
```

Decision rule: accept if NPV > 0 at the cost of capital. NPV is additive (аддитивна): the NPV of a portfolio of projects is the sum. Excel: `=NPV(r; CF₁..CFₙ) + CF₀` (ЧПС); the function assumes the first flow is one period away, so add the initial investment (первоначальные инвестиции) outside.

## IRR and its traps

```f
Σ CF_t / (1 + IRR)^t = 0          Excel: IRR (ВСД), XIRR for dated flows (ЧИСТВНДОХ)
```

Accept if IRR > hurdle rate (пороговая ставка). Traps:

- **Multiple IRRs** when flows change sign more than once (mine closure costs, refinancing).
- **Reinvestment assumption:** IRR assumes interim flows are reinvested at the IRR. MIRR (модифицированная IRR) uses the cost of capital.
- **Scale:** a 50% IRR on 1 million is worth less than 20% on 100 million. Mutually exclusive projects (взаимоисключающие проекты): use NPV, or incremental IRR (приростная IRR).
- **Timing games:** early cash out inflates IRR; private equity uses subscription lines (кредитные линии под обязательства инвесторов) to delay capital calls and lift IRR without creating value.

## IRR, MOIC and time

Private equity reports IRR together with MOIC (мультипликатор вложенного капитала), because IRR alone hides duration.

| MOIC | 3 years | 5 years | 7 years |
|---|---|---|---|
| 2.0x | 26% | 15% | 10% |
| 2.5x | 36% | 20% | 14% |
| 3.0x | 44% | 25% | 17% |

Mental rule: IRR ≈ MOIC^(1/n) − 1.

## Payback and profitability index

Payback (срок окупаемости) ignores time value and later flows; discounted payback (дисконтированный срок окупаемости) fixes the first. Profitability index, PI (индекс рентабельности) = PV of inflows / I₀, useful under capital rationing (ограниченность капитала): rank by PI, not by NPV.

## Choosing the discount rate

The rate must match the risk and the currency of the flow: risk-free (безрисковая ставка) for certain flows, WACC for the firm's operating flows, Ke for equity flows, a project-specific rate (ставка под проект) when the project's risk differs from the company's. Using the company WACC for a riskier project is a classic value-destroying error.

## Words

| Term | Перевод | Example |
|---|---|---|
| discount factor | коэффициент дисконтирования | The discount factor for year 5 at 12% is 0.567. |
| annuity | аннуитет | Loan repayments form an annuity. |
| perpetuity | перпетуитет | Terminal value is a growing perpetuity. |
| mid-year convention | поправка на середину года | The mid-year convention adds about 4% to EV. |
| effective annual rate (EAR) | эффективная годовая ставка | EAR exceeds the quoted APR under monthly compounding. |
| nominal vs real | номинальный / реальный | Match nominal flows with nominal rates. |
| net present value (NPV) | чистая приведённая стоимость | NPV is positive at a 15% WACC. |
| additive | аддитивный | NPV is additive across projects. |
| initial investment | первоначальные инвестиции | The initial investment is paid at t = 0. |
| internal rate of return (IRR) | внутренняя норма доходности | The project IRR is 18% against a 15% hurdle. |
| hurdle rate | пороговая ставка | Projects must clear the hurdle rate. |
| multiple IRRs | несколько значений IRR | Sign changes produce multiple IRRs. |
| reinvestment assumption | допущение о реинвестировании | IRR's reinvestment assumption is optimistic. |
| modified IRR (MIRR) | модифицированная внутренняя норма доходности | MIRR reinvests at the cost of capital. |
| mutually exclusive projects | взаимоисключающие проекты | For mutually exclusive projects, rank by NPV. |
| incremental IRR | приростная IRR | Compare the incremental IRR with the hurdle. |
| subscription line | кредитная линия под обязательства инвесторов | Subscription lines inflate reported IRR. |
| capital call | требование о внесении капитала | The fund issued a capital call for the deal. |
| MOIC | мультипликатор вложенного капитала | 2.5x MOIC in five years is roughly a 20% IRR. |
| payback period | срок окупаемости | Payback is four years before discounting. |
| profitability index | индекс рентабельности | Rank projects by profitability index under capital rationing. |
| capital rationing | ограниченность капитала | Under capital rationing not all positive-NPV projects can be funded. |
