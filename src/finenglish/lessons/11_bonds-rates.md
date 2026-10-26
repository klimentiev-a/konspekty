# Topic 11. Bonds, yields, duration and credit
short: Цена и доходность, YTM и текущая доходность, дюрация и выпуклость, кредитный спред и рейтинги, кривая доходности, типы ОФЗ, НКД
level: B2
unit: 3
minutes: 8

## Theory

> **In one minute.** Price and yield move inversely (в противоположных направлениях). YTM, yield to maturity (доходность к погашению), is the IRR, internal rate of return (внутренняя норма доходности), of the bond's cash flows. Duration (дюрация) is the price sensitivity to yield: ΔP/P ≈ −D_mod × Δy, where D_mod is modified duration (модифицированная дюрация). Credit spread (кредитный спред) over the risk-free curve prices default risk; ratings map it. The yield curve (кривая доходности) shows the market's path for the policy rate (ключевая ставка центрального банка).

## Pricing

```f
P = Σ C / (1 + y)^t + F / (1 + y)^n          C = coupon, F = face value, y = YTM per period
Current yield = C / P
Price < 100 → trades at a discount (ниже номинала); > 100 → at a premium
Dirty price = Clean price + Accrued interest (НКД)
Accrued = C × days since last coupon / days in coupon period
```

Zero-coupon bonds (бескупонные): P = F / (1 + y)^n; duration = maturity.

## Duration and convexity

```f
Macaulay duration D = Σ t × PV(CF_t) / P                (years)
Modified duration D_mod = D / (1 + y)
ΔP / P ≈ −D_mod × Δy + ½ × Convexity × Δy²
DV01 (PVBP) = price change per 1 bp = D_mod × P × 0.0001
```

DV01 (dollar value of one basis point) and PVBP (price value of a basis point) are the same measure; 1 bp, one basis point (базисный пункт), is 0.01%.

Longer maturity and lower coupon → higher duration. A 10-year OFZ (ОФЗ, облигации федерального займа) with D_mod ≈ 6 loses about 6% if yields rise 100 bp. Convexity (выпуклость) is positive for plain bonds: prices rise more when yields fall than they drop when yields rise. Floaters (флоатеры) have duration close to the next reset date, so they protect against rising rates.

## Credit

```f
Yield = Risk-free (same maturity) + Credit spread (bp) [+ liquidity premium]
Expected loss = PD × LGD × EAD    (probability of default × loss given default × exposure at default: вероятность дефолта × потери при дефолте × сумма под риском)
```

Ratings: AAA–BBB− investment grade (инвестиционный уровень), BB+ and below high yield (высокодоходные). Russian scale: ACRA (АКРА), Expert RA (Эксперт РА), NCR (НКР), NRA (НРА) from AAA(RU) down. A downgrade (понижение) widens spreads; a fallen angel (падший ангел) crosses below investment grade and forces index-driven selling. Covenants (ковенанты), seniority (старшинство) and security (обеспечение) determine LGD (Topic 17).

Government bonds: OFZ-PD fixed coupon (ОФЗ‑ПД, постоянный купон), OFZ-PK floater linked to RUONIA, the rouble overnight index average (ОФЗ‑ПК, переменный купон), OFZ-IN inflation-linked (ОФЗ‑ИН, индексируемый номинал), OFZ-AD amortising (ОФЗ‑АД, амортизация долга). Corporate: fixed, floaters tied to key rate or RUONIA, replacement bonds (замещающие облигации) that replaced Eurobonds (еврооблигации), yuan bonds. Put via offer (оферта): the investor may redeem early at a set date; call (колл): the issuer may.

## Yield curve

Term structure (временная структура ставок): yield against maturity for one issuer. Normal (upward), flat, inverted (инвертированная). Theories: expectations (ожидания будущих коротких ставок), liquidity premium (премия за срок), segmentation. An inverted curve means the market expects cuts: Russia 2024–2025 with short OFZ above long. Steepening (увеличение наклона) and flattening (выравнивание) are traded through curve positions. RGBI (Russian Government Bond Index, индекс гособлигаций Мосбиржи) tracks OFZ prices.

## Bond math for the desk

- Breakeven inflation (вменённая инфляция) = nominal yield − linker (облигация с индексируемым номиналом) real yield.
- Carry and roll-down (кэрри и скатывание по кривой): the return from holding a bond as it ages down a steep curve.
- Reinvestment risk (риск реинвестирования) vs price risk: they offset at the horizon equal to duration (immunisation, иммунизация).
- Yield to call / yield to put / yield to worst (доходность к худшему) for bonds with options.
- Repo (репо) funds bond positions; the repo rate versus the coupon gives positive or negative carry.

## Reading a bond headline

"Issuer placed a 3-year bond at 15.5%, 150 bp over OFZ, book covered 2x, duration 2.4." "OFZ curve bull-steepened (ралли на коротком конце) after the dovish statement (мягкий сигнал ЦБ о снижении ставки)." "Spreads tightened (сузились) 40 bp."

## Words

| Term | Перевод | Example |
|---|---|---|
| yield to maturity (YTM) | доходность к погашению | YTM is the bond's internal rate of return. |
| current yield | текущая доходность | Current yield ignores the pull to par. |
| pull to par | подтягивание цены к номиналу | Pull to par lifts a discount bond as it nears maturity. |
| clean / dirty price | чистая / грязная цена | The dirty price includes accrued interest. |
| accrued interest | накопленный купонный доход (НКД) | Accrued interest is paid to the seller. |
| modified duration | модифицированная дюрация | Modified duration of 6 means a 6% loss per 100 bp. |
| convexity | выпуклость | Convexity makes long bonds gain more than they lose. |
| DV01 | изменение цены на 1 б.п. | The position's DV01 is 2 million roubles. |
| credit spread | кредитный спред | Credit spreads tightened after the upgrade. |
| probability of default (PD) | вероятность дефолта | PD rises as coverage falls. |
| loss given default (LGD) | потери при дефолте | Secured bonds have lower LGD. |
| fallen angel | «падший ангел» | Fallen angels are sold by investment-grade funds. |
| floating-rate note (floater) | флоатер | Floaters reset to RUONIA plus a spread. |
| inflation-linked bond (linker) | облигация с индексируемым номиналом | Linkers hedge inflation risk. |
| put option / offer | оферта (право досрочного погашения) | The bond has a put via offer in two years. |
| term structure | временная структура ставок | The term structure is inverted. |
| steepening / flattening | увеличение / уменьшение наклона кривой | The curve steepened on supply concerns. |
| breakeven inflation | вменённая (безубыточная) инфляция | Breakeven inflation is 6%. |
| carry and roll-down | кэрри и скатывание по кривой | Carry and roll-down add 2% a year. |
| yield to worst | доходность к худшему | Quote yield to worst for callable bonds. |
| immunisation | иммунизация (портфеля облигаций) | Immunisation matches duration to the horizon. |
| book covered 2x | книга заявок переподписана в 2 раза | The book was covered 2x within an hour. |
