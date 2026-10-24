# Topic 17. Debt financing, leveraged finance and restructuring
short: Инструменты долга и их цена, синдикация, обеспечение и очерёдность, ковенанты и waiver, рейтинги, рефинансирование, дефолт, реструктуризация и банкротство
level: C1
unit: 4
minutes: 8

## Theory

> **In one minute.** Debt is priced as base rate plus spread (базовая ставка плюс спред) for credit risk, structured by seniority (старшинство) and security (обеспечение), and policed by covenants (ковенанты). When cash flow fails, the sequence is waiver → amend and extend → restructuring (haircut, debt-for-equity) → bankruptcy. The waterfall (очерёдность выплат) decides who gets what.

## Instruments and pricing

```f
Loan rate = Base (key rate / RUONIA / SOFR / EURIBOR) + Margin (bp)   — floating
Bond yield = Risk-free (same tenor) + Credit spread                       — fixed or floating
Margin ratchet (ступенчатая маржа): spread steps with leverage
Fees: arrangement (за организацию), commitment (за резервирование), prepayment (за досрочное погашение)
```

| Instrument | Typical use |
|---|---|
| Bilateral / club / syndicated loan | Working capital, capex, acquisitions; lead arranger (организатор) and agent bank (банк-агент) |
| Revolver (RCF) | Liquidity; drawn / undrawn |
| Term loan A/B | Amortising bank debt / institutional cov-lite |
| Bonds (local, Eurobonds, replacement, yuan) | Longer tenor (срок), broader investor base, disclosure |
| Commercial paper | Short-term unsecured |
| Project finance | Non-recourse (без регресса) to the sponsor; DSCR-based sizing |
| Leasing, factoring, trade finance | Asset-based (под активы) |
| Convertible, hybrid, perpetual | Equity-like features, rating agency equity credit |

Leveraged finance (левередж-финансирование) is lending to sub-investment-grade borrowers: LBO debt, high-yield bonds, unitranche (единый транш, private credit).

## Seniority and security

```f
Waterfall: super-senior (revolver, DIP) → senior secured → senior unsecured → subordinated → hybrids → preferred → common equity
Structural subordination: debt at a holding company ranks behind opco debt (структурная субординация)
Security: pledge of shares, PP&E, receivables, accounts; guarantees from subsidiaries (поручительства)
Intercreditor agreement (межкредиторское соглашение): who enforces, standstill, release of security
```

Recovery rates (уровень возмещения): senior secured 60–80%, unsecured 30–50%, subordinated 10–20% historically; LGD = 1 − recovery.

## Covenants and ratings

Maintenance (tested quarterly: leverage, coverage, minimum equity) versus incurrence (triggered by actions). Breach → event of default (случай неисполнения) → lenders may accelerate (потребовать досрочного погашения); cross-default (кросс-дефолт) spreads it to other debt. In practice: waiver for a fee, reset of covenants, amend and extend (A&E, изменение условий и продление).

Ratings (Topic 11): agencies map FFO/debt, debt/EBITDA, coverage and business risk to a grade; outlook and watch signal direction. Covenant headroom and rating headroom are what the CFO manages.

## Refinancing and liability management

Refinance before the debt wall (стена погашений); extend maturities (удлинить сроки), diversify sources (currency, market, bank vs bond), keep undrawn RCF and cash as the liquidity cushion. Liability management (управление обязательствами): tender offer for bonds, exchange offer (обмен бумаг), consent solicitation (запрос согласия держателей) to change terms, early redemption (досрочное погашение) at a make-whole (компенсация за досрочный выкуп) or call price.

## Distress and restructuring

```f
Signals: coverage < 1.5x, negative FCF, covenant breaches, rating in CCC, bonds below 70, auditor going-concern doubt (сомнение в непрерывности деятельности)
Options: out-of-court restructuring (внесудебная) vs in-court (bankruptcy)
Tools: maturity extension, coupon cut, PIK toggle, haircut (списание), debt-for-equity swap (конвертация долга в капитал),
       new money (новые деньги) with super-senior status, asset sales, sale of the company
```

Distressed debt investors (инвесторы в проблемный долг) buy bonds at 30–60 cents to control the restructuring (fulcrum security, «опорная» бумага, which converts into equity). In Russia: Federal Law on Insolvency (Bankruptcy) No. 127-FZ — observation (наблюдение), financial rehabilitation (финансовое оздоровление), external management (внешнее управление), bankruptcy proceedings (конкурсное производство); creditors' meeting (собрание кредиторов), register of claims (реестр требований), priority of claims (очередность требований). US: Chapter 11 (reorganisation under court protection, DIP financing, cramdown) versus Chapter 7 (liquidation).

## Words

| Term | Перевод | Example |
|---|---|---|
| base rate plus margin | базовая ставка плюс маржа | The loan is priced at key rate plus 300 bp. |
| margin ratchet | ступенчатая маржа (зависит от долговой нагрузки) | The margin ratchet cuts 50 bp below 2x leverage. |
| lead arranger / agent bank | организатор / банк-агент | The lead arranger syndicated 70% of the loan. |
| tenor | срок (инструмента) | Bonds offer longer tenor than loans. |
| non-recourse | без регресса на спонсора | Project finance is non-recourse to the sponsor. |
| unitranche | единый транш (частный кредит) | A unitranche replaced senior and mezzanine. |
| leveraged finance | левередж-финансирование | Leveraged finance desks fund LBOs. |
| waterfall | очерёдность выплат | The waterfall pays senior secured first. |
| structural subordination | структурная субординация | Holdco bonds suffer structural subordination. |
| intercreditor agreement | межкредиторское соглашение | The intercreditor agreement sets a 90-day standstill. |
| recovery rate | уровень возмещения | Recovery on unsecured bonds was 35%. |
| event of default | случай неисполнения обязательств | A missed covenant is an event of default. |
| cross-default | кросс-дефолт | Cross-default clauses link all facilities. |
| accelerate | потребовать досрочного погашения | Lenders may accelerate after a breach. |
| amend and extend | изменить условия и продлить срок | An amend-and-extend pushed maturities to 2029. |
| consent solicitation | запрос согласия держателей облигаций | The consent solicitation passed with 80%. |
| make-whole | компенсация при досрочном выкупе | Early redemption requires a make-whole payment. |
| going concern | непрерывность деятельности | The auditor flagged going-concern doubt. |
| haircut | списание части долга | Creditors took a 40% haircut. |
| debt-for-equity swap | конвертация долга в акции | Lenders became shareholders via a debt-for-equity swap. |
| fulcrum security | «опорная» бумага при реструктуризации | The senior unsecured bonds are the fulcrum security. |
| register of claims | реестр требований кредиторов | Claims must be entered in the register of claims. |
