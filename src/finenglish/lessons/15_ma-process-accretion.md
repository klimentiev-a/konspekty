# Topic 15. M&A: process, pricing and accretion/dilution
short: Продажа через аукцион от тизера до closing, документы SPA и CPs, синергии и премия, математика accretion/dilution, PPA и гудвил, защита от враждебных сделок, российские пороги оферты
level: C1
unit: 4
minutes: 9

## Theory

> **In one minute.** The buyer pays the unaffected price (цена до объявления) plus a control premium (премия за контроль), justified by synergies (синергии). Value is created only if the PV, present value (приведённая стоимость), of synergies exceeds the premium plus costs. Accretion/dilution (влияние на прибыль на акцию) is the board's optics test: EPS, earnings per share (прибыль на акцию), up or down. Goodwill (гудвил) is the price above fair value of net assets; an impairment later is the market's receipt for overpaying.

## Sell-side process

```f
Teaser → NDA → CIM (information memorandum) → non-binding offers (IOI)
→ management presentations, data room, due diligence (financial, tax, legal, commercial, technical)
→ binding offers with mark-up of SPA → negotiation, signing → conditions precedent (CPs)
→ closing: payment, transfer of shares; post-closing adjustments (completion accounts / locked box)
```

Documents: NDA, non-disclosure agreement (соглашение о неразглашении), CIM, confidential information memorandum (информационный меморандум), LOI / term sheet, letter of intent (письмо о намерениях / основные условия), SPA, share purchase agreement (договор купли-продажи акций), with representations and warranties, R&W (заверения и гарантии), indemnities (возмещение потерь), MAC clause, material adverse change (оговорка о существенном неблагоприятном изменении), escrow (счёт эскроу), earn-out (отложенный платёж по результатам), non-compete (запрет конкуренции). Price mechanisms: completion accounts (цена по отчётности на дату закрытия, with adjustments for NWC, net working capital — оборотный капитал, and net debt) versus locked box (цена зафиксирована на прошлую дату, с leakage protection).

CPs: antitrust (ФАС, Федеральная антимонопольная служба, in Russia), government commission approval for foreign investors, shareholder votes, financing. Break fee (штраф за срыв сделки, платит продавец) and reverse break fee (обратный штраф, платит покупатель).

## Pricing: premium and synergies

```f
Offer price = Unaffected price × (1 + premium)          premium 20–40%
Value created for buyer = PV(synergies) − Premium paid − Transaction and integration costs
Breakeven run-rate synergies (pre-tax) = Premium × (WACC − g) / (1 − t)
```

The last line solves Synergies × (1 − t) / (WACC − g) = Premium: after-tax synergies capitalised as a growing perpetuity must at least repay the premium (t — tax rate, g — growth rate of synergies).

Cost synergies (синергии по затратам: procurement, overheads, footprint) are credible; revenue synergies (синергии по выручке) are discounted by the market. Integration costs (затраты на интеграцию) typically equal one year of run-rate synergies (синергии в годовом выражении). Strategic buyers (стратеги) can pay more than financial buyers (финансовые инвесторы) because of synergies; the market reaction on announcement (реакция рынка на объявление) prices how much of the synergies the buyer gave away.

## Accretion / dilution

```f
Pro forma NI = NI_A + NI_T + Synergies × (1 − t) − Interest on new debt × (1 − t) − Foregone interest on cash × (1 − t) + / − new D&A from write-ups
Pro forma EPS = Pro forma NI / (Shares_A + New shares issued)
Accretive if pro forma EPS > standalone EPS_A

Rules of thumb:
 All-stock: accretive if P/E_A > P/E_T  (buyer's "expensive" shares buy "cheap" earnings)
 All-cash:  accretive if Target earnings yield (E/P) > after-tax cost of debt (or cash yield)
```

A and T denote the acquirer and the target; NI is net income (чистая прибыль); D&A is depreciation and amortisation (амортизация).

Accretion is not value creation: an accretive deal can destroy value if the premium exceeds synergies, and vice versa. Boards still care because EPS guidance (прогноз по EPS) moves the stock.

## Purchase price allocation and goodwill

```f
Goodwill = Purchase price − Fair value of net identifiable assets
Net identifiable assets = Book equity + Write-ups (PP&E, intangibles: brands, customer relationships, technology) − Deferred tax liability on write-ups
```

PP&E is property, plant and equipment (основные средства).

Write-ups (дооценка) create new D&A, which lowers pro forma EPS; goodwill is not amortised under IFRS (МСФО) but tested annually for impairment (обесценение). Bargain purchase (выгодная покупка): price below fair value → gain in the P&L (ОФР). Consolidation (консолидация): 100% of the target's assets and liabilities, with NCI, non-controlling interest (доля меньшинства), for the part not owned.

## Hostile deals and defences

Hostile takeover (враждебное поглощение): tender offer (публичная оферта) directly to shareholders, proxy fight (борьба за доверенности) for the board. Defences: poison pill (ядовитая пилюля, rights plan), staggered board (ступенчатый совет директоров), white knight (белый рыцарь), crown jewel sale (продажа ключевого актива), golden parachutes (золотые парашюты), Pac-Man defence. Russian law: mandatory offer (обязательное предложение) on crossing 30%, 50%, 75% of voting shares in a public company; squeeze-out (принудительный выкуп) above 95% after a voluntary offer that gathered 10%+.

## Other transaction types

Divestiture (продажа подразделения), spin-off (выделение с распределением акций акционерам), carve-out IPO (частичное выделение через IPO), joint venture (совместное предприятие), minority investment (миноритарная инвестиция) with shareholder agreement (акционерное соглашение): tag-along (право присоединиться к продаже), drag-along (право требовать совместной продажи), ROFR, right of first refusal (преимущественное право покупки), put/call options between partners.

## Words

| Term | Перевод | Example |
|---|---|---|
| unaffected price | цена до объявления о сделке | The premium is 35% to the unaffected price. |
| indication of interest (IOI) | необязывающее предложение | Six IOIs came in the first round. |
| representations and warranties (R&W) | заверения и гарантии | R&W cover tax and title to assets. |
| indemnity | возмещение потерь | The seller gave an indemnity for the tax claim. |
| MAC clause | оговорка о существенном неблагоприятном изменении | The buyer invoked the MAC clause. |
| escrow | эскроу | Ten percent of the price sits in escrow for a year. |
| completion accounts / locked box | цена по отчётности на закрытие / фиксированная цена | A locked box fixes the price at the last audited date. |
| leakage | утечка стоимости (до закрытия) | Dividends before closing count as leakage. |
| conditions precedent (CPs) | отлагательные условия | Antitrust approval is the last CP. |
| break fee | штраф за срыв сделки | The break fee is 2% of equity value. |
| run-rate synergies | синергии в годовом выражении | Run-rate synergies of 5 billion by year three. |
| integration costs | затраты на интеграцию | Integration costs equal one year of synergies. |
| breakeven synergies | синергии, покрывающие премию | Breakeven synergies are 3% of combined costs. |
| pro forma | про-форма (объединённые показатели) | Pro forma EPS rises 4%. |
| accretive / dilutive | увеличивающий / размывающий EPS | The cash deal is accretive from year one. |
| foregone interest | упущенный процентный доход | Foregone interest on cash reduces accretion. |
| write-up | дооценка актива | Write-ups of intangibles add amortisation. |
| purchase price allocation (PPA) | распределение цены покупки | PPA allocated 40% of the price to goodwill. |
| bargain purchase | выгодная покупка (цена ниже справедливой) | A bargain purchase gain was booked. |
| squeeze-out | принудительный выкуп миноритариев | The squeeze-out followed the 95% threshold. |
| tag-along / drag-along | право присоединения / право принуждения к продаже | Minority holders have tag-along rights. |
| right of first refusal (ROFR) | преимущественное право покупки | The ROFR gives partners first option on the stake. |
