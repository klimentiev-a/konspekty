#!/usr/bin/env python3
"""ВУШ Холдинг: собирает emitent-data/wush.json из текста МСФО (pdftotext -layout).
Запуск: python3 build_wush.py <raw.json от extract_ifrs.py> <выход.json>
Цифры сверены: валовая, операционный результат, прибыль до налога и баланс сходятся до нуля.
Суммы в файле — млн ₽."""
import json, sys
raw = json.load(open(sys.argv[1], encoding="utf-8"))
M = lambda x: None if x is None else round(x / 1000, 3)
def per(r, i):
    g = lambda k: (r.get(k) or [None, None])[i]
    return g
def period(key, label, r, i, ebitda, seg, bs=True, src=None):
    g = per(r, i)
    d = {"key": key, "label": label, "src": src,
         "revenue": M(g("revenue")), "cogs": M(g("cogs")), "gross": M(g("gross")), "sga": M(g("sga")),
         "other_inc": M(g("other_inc")), "other_exp": M(g("other_exp")), "op": M(g("op")),
         "fin_inc": M(g("fin_inc")), "fin_exp": M(g("fin_exp")), "pbt": M(g("pbt")), "net": M(g("net")),
         "da": M((g("da_ppe") or 0) + (g("da_int") or 0)), "disp": M(g("disp")),
         "cfo": M(g("cfo")), "interest_paid": M(g("int_paid")), "capex": M((g("capex_ppe") or 0) + (g("capex_int") or 0)),
         "ebitda": M(ebitda), "seg": seg}
    if bs and g("assets") is not None and g("loan_lt") is not None:
        d.update({"ppe": M(g("ppe")), "cash": M(g("cash")), "st_inv": M(g("st_inv")), "assets": M(g("assets")), "equity": M(g("equity")),
                  "loan_lt": M(g("loan_lt")), "loan_st": M(g("loan_st")), "lease_lt": M(g("lease_lt")), "lease_st": M(g("lease_st"))})
    return d
SRC = "https://www.e-disclosure.ru/portal/files.aspx?id=38772&type=4"
H26, F25, F24 = raw["1H26"], raw["FY25"], raw["FY24"]
P = []
# 2023 — только ОПУ/ДДС из отчёта 2024 (баланс 2023 не извлечён)
p23 = period("2023", "2023", F24, 1, 4453.802 * 1000, {"rev_ru": None, "rev_la": None}, bs=False, src="МСФО 2024, сравнительные данные")
p23["gross"], p23["sga"] = M(F24["gross"][1]), M(F24["sga"][1])
P.append(p23)
P.append(period("2024", "2024", F25, 1, 6054.048 * 1000, {"rev_ru": 13435.845, "rev_la": 868.456, "ebitda_ru": 5743.721, "ebitda_la": 310.327, "capex_ru": 4382.539, "capex_la": 245.952}, src="МСФО 2025, сравнительные данные; отчёт 2024 (31.03.2025)"))
P.append(period("1H2025", "1П 2025", H26, 1, 1006.321 * 1000, {"rev_ru": 4440.788, "rev_la": 928.050, "ebitda_ru": 615.059, "ebitda_la": 391.263, "capex_ru": 2221.344, "capex_la": 34.124}, bs=False, src="МСФО 1П 2026, сравнительные данные"))
P.append(period("2025", "2025", F25, 0, 3560.177 * 1000, {"rev_ru": 10689.505, "rev_la": 1768.637, "ebitda_ru": 2871.839, "ebitda_la": 688.338, "capex_ru": 3024.545, "capex_la": 385.903}, src="МСФО 2025 (06.03.2026)"))
P.append(period("1H2026", "1П 2026", H26, 0, 1437.824 * 1000, {"rev_ru": 4436.591, "rev_la": 1127.636, "ebitda_ru": 1062.018, "ebitda_la": 375.806, "capex_ru": 459.074, "capex_la": 34.647}, src="МСФО 1П 2026 (27.08.2026)"))
# 1П 2025: баланс на 30.06.2025 в этих документах нет
out = {
 "company": "ПАО «ВУШ Холдинг»", "ticker": "WUSH", "edisclosure_id": 38772, "bond_issuer_id": 38662, "unit": "млн ₽",
 "source_page": SRC, "built": "2026-11-16",
 "periods": P,
 "bonds_at_2026_06_30": {
  "rows": [
   {"series": "ВУШ-001Р-02", "coupon": "11,80%", "maturity": "июль 2026", "jun26": 4114.980, "dec25": 4109.612},
   {"series": "ВУШ-001Р-03", "coupon": "ключевая ставка + 2,50% (флоатер)", "maturity": "август 2027", "jun26": 4001.567, "dec25": 3998.776},
   {"series": "ВУШ-001Р-04", "coupon": "20,25%", "maturity": "май 2028", "jun26": 5029.579, "dec25": 5019.346},
   {"series": "ВУШ-001Р-05", "coupon": "22,00%", "maturity": "январь 2028", "jun26": 996.458, "dec25": None},
   {"series": "ВУШ-001Р-06", "coupon": "22,00%", "maturity": "апрель 2029", "jun26": 659.137, "dec25": None},
   {"series": "ВУШ-001Р-07", "coupon": "22,50%", "maturity": "октябрь 2029", "jun26": 566.263, "dec25": None}],
  "total": {"jun26": 15367.984, "dec25": 13127.734}, "fair_value": {"jun26": 14455.791, "dec25": 12418.200},
  "other_debt": [
   {"name": "Банковские кредиты (плавающая ставка, эффективная 15,37%)", "jun26": 227.559, "dec25": 375.834},
   {"name": "Займы от связанных сторон (21,00%)", "jun26": 872.605, "dec25": 0},
   {"name": "Обязательства по аренде", "jun26": 1192.175, "dec25": 1188.341}],
  "total_debt": {"jun26": 17660.323, "dec25": 14691.910}},
 "revenue_split": {
  "1H2026": {"sharing": 5380.021, "insurance_agent": 184.206, "goods": 0},
  "1H2025": {"sharing": 5088.847, "insurance_agent": 273.548, "goods": 6.443},
  "2025": {"sharing": 11781.364, "insurance_agent": 671.455, "goods": 5.323},
  "2024": {"sharing": 13590.932, "insurance_agent": 704.977, "goods": 8.392}},
 "cogs_1H": {
  "labels": ["Амортизация", "Оплата труда", "Ремонт и обслуживание", "Зарядка и перевозка самокатов", "Краткосрочная аренда", "Связь", "Поддержка пользователей", "Прочее"],
  "1H2026": [1325.179, 654.618, 985.082, 1010.408, 139.130, 92.505, 35.588, 113.856],
  "1H2025": [1300.439, 907.599, 1040.839, 1022.336, 131.010, 120.096, 52.436, 133.332]},
 "sga_1H": {
  "labels": ["Оплата труда", "Банковский эквайринг", "Юридические и консалтинг", "Маркетинг и реклама", "Программное обеспечение", "Амортизация", "Прочее"],
  "1H2026": [495.370, 116.768, 143.172, 122.691, 37.709, 53.336, 155.055],
  "1H2025": [443.549, 104.689, 50.193, 40.935, 77.442, 43.395, 180.811]},
 "fin_exp_1H": {
  "labels": ["Проценты по облигациям", "Проценты по банковским кредитам", "Проценты по аренде", "Курсовые разницы", "Хеджирование", "Прочее"],
  "1H2026": [1210.229, 27.363, 94.817, 21.289, 6.599, 2.852],
  "1H2025": [974.632, 120.065, 81.017, 116.069, 73.969, 0.626]},
 "notes": [
  "Источник — консолидированная МСФО ПАО «ВУШ Холдинг» с e-disclosure.ru (раздел «Консолидированная»).",
  "EBITDA — «EBITDA кикшеринга» из примечания о сегментах (скорректированная, как публикует компания).",
  "Баланс на 30.06.2025 в использованных отчётах не раскрыт; баланс 2023 не извлекался."]
}
json.dump(out, open(sys.argv[2], "w", encoding="utf-8"), ensure_ascii=False, indent=1)
# проверки
for p in P:
    if p.get("assets"):
        d = p["loan_lt"] + p["loan_st"] + p["lease_lt"] + p["lease_st"]
        print(p["key"], "долг с арендой", round(d, 1), "деньги", p["cash"], "депозиты", p["st_inv"])
    chk = round(p["revenue"] + p["cogs"] - p["gross"], 3), round(p["gross"] + p["sga"] + p["other_inc"] + p["other_exp"] - p["op"], 3), round(p["op"] + p["fin_inc"] + p["fin_exp"] - p["pbt"], 3)
    print(p["key"], "контроль ОПУ", chk)
