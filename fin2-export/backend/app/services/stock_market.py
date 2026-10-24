"""A dated, issue-capitalization-weighted map of the TQBR equity universe."""
from __future__ import annotations

import math
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

from . import equity_indices, moex, stock_sectors

_LOCK = threading.Lock()
_QUOTE_CACHE = None
_SECTOR_CACHE = None
SECTORS = [(r['code'], r['name']) for r in equity_indices.CATALOG['sectors']] + [('MOEXTL', 'Телекоммуникации')]


def number(value):
    try:
        v = float(value)
        return v if math.isfinite(v) else None
    except (TypeError, ValueError):
        return None


def sector_memberships():
    global _SECTOR_CACHE
    if _SECTOR_CACHE and time.time() - _SECTOR_CACHE[0] < 86400:
        return _SECTOR_CACHE[1]

    def load(meta):
        code, name = meta
        try:
            return code, name, moex.get_index_composition(code), None
        except Exception:
            return code, name, {}, 'Состав индекса недоступен'

    mapping, dates, failures = {}, {}, []
    with ThreadPoolExecutor(max_workers=4) as pool:
        for code, name, basket, error in pool.map(load, SECTORS):
            if error:
                failures.append(code)
            if basket.get('as_of'):
                dates[code] = basket['as_of']
            for item in basket.get('items', []):
                mapping[item['secid']] = {'sector': name, 'sector_index': code}
    result = mapping, dates, failures
    # Failed classifications are retried; never cache an outage for a full day.
    if not failures:
        _SECTOR_CACHE = time.time(), result
    return result


def build_map(payload, memberships, sector_dates=None, failures=None):
    securities = moex._block(payload, 'securities')
    quotes = {r['SECID']: r for r in moex._block(payload, 'marketdata')}
    versions = moex._block(payload, 'dataversion')
    trade_date = versions[0].get('trade_date') if versions else None
    items, excluded, seen = [], [], set()
    for sec in securities:
        ticker = sec.get('SECID')
        if not ticker or ticker in seen or str(sec.get('SECTYPE')) not in ('1', '2'):
            continue
        seen.add(ticker)
        q = quotes.get(ticker, {})
        cap = number(q.get('ISSUECAPITALIZATION'))
        cap_source = 'ISSUECAPITALIZATION'
        # Last/previous price references stay explicit, including no-trade days.
        price = number(q.get('LAST'))
        price_source = 'LAST'
        if price is None or price <= 0:
            price = number(sec.get('PREVPRICE'))
            price_source = 'PREVPRICE'
        if cap is None or cap <= 0:
            size = number(sec.get('ISSUESIZE'))
            if price is not None and price > 0 and size is not None and size > 0:
                cap = price * size
                cap_source = price_source + ' × ISSUESIZE'
        if cap is None or cap <= 0:
            excluded.append({'ticker': ticker, 'name': sec.get('SHORTNAME') or ticker, 'reason': 'Нет положительной капитализации и данных для расчёта'})
            continue
        membership = memberships.get(ticker, {})
        classification = stock_sectors.classify(ticker, membership)
        # LASTTOPREVPRICE is against previous session, NOT change of the last trade.
        change = number(q.get('LASTTOPREVPRICE')) if price_source == 'LAST' else None
        quote_date = str(q.get('SYSTIME') or '')[:10] or trade_date
        items.append({
            'ticker': ticker, 'name': sec.get('SHORTNAME') or ticker,
            'full_name': sec.get('SECNAME') or sec.get('SHORTNAME') or ticker,
            'isin': sec.get('ISIN'), **classification,
            'sector_index': membership.get('sector_index'),
            'cap': cap, 'cap_source': cap_source, 'price': price,
            'issued_shares': number(sec.get('ISSUESIZE')),
            'price_source': price_source, 'price_date': quote_date if price_source == 'LAST' else sec.get('PREVDATE'),
            'change': change, 'turnover': number(q.get('VALTODAY_RUR')),
            'quote_time': q.get('UPDATETIME'), 'quote_date': quote_date,
            'cap_time': q.get('ISSUECAPITALIZATION_UPDATETIME'),
            'share_type': 'Привилегированная' if str(sec.get('SECTYPE')) == '2' else 'Обыкновенная',
        })
    items.sort(key=lambda r: r['cap'], reverse=True)
    return {
        'items': items, 'excluded': excluded, 'universe_count': len(seen),
        'as_of': trade_date or max((r['quote_date'] or '' for r in items), default=None),
        'fetched_at': datetime.now(timezone.utc).isoformat(), 'refresh_interval_seconds': 300,
        'source': 'MOEX ISS', 'board': 'TQBR', 'sector_dates': sector_dates or {},
        'sector_errors': failures or [], 'stale': False,
        'source_url': 'https://iss.moex.com/iss/engines/stock/markets/shares/boards/TQBR/securities.json',
        'sector_reviewed_at': stock_sectors.REVIEWED_AT,
        'methodology': 'Площадь — капитализация отдельного выпуска, не free-float. Обыкновенные и привилегированные акции показаны отдельно. Сектор — по бизнес-классификации StockAI или отраслевым индексам MOEX; метод и источник видны в карточке. Изменение — LASTTOPREVPRICE к предыдущей сессии, без дивидендов. Фонды и расписки не входят в периметр.',
    }


def get_map():
    global _QUOTE_CACHE
    with _LOCK:
        if _QUOTE_CACHE and time.time() - _QUOTE_CACHE[0] < 300:
            return _QUOTE_CACHE[1]
        try:
            payload = moex._get('engines/stock/markets/shares/boards/TQBR/securities.json', {
                'iss.only': 'securities,marketdata,dataversion',
                'securities.columns': 'SECID,SHORTNAME,SECNAME,SECTYPE,ISSUESIZE,PREVPRICE,PREVDATE,ISIN',
                'marketdata.columns': 'SECID,LAST,LASTTOPREVPRICE,ISSUECAPITALIZATION,ISSUECAPITALIZATION_UPDATETIME,UPDATETIME,SYSTIME,VALTODAY_RUR',
            })
            memberships, dates, failures = sector_memberships()
            result = build_map(payload, memberships, dates, failures)
            if not result['items']:
                raise ValueError('MOEX не вернула акции с капитализацией')
            _QUOTE_CACHE = time.time(), result
            return result
        except Exception:
            if _QUOTE_CACHE:
                return {**_QUOTE_CACHE[1], 'stale': True}
            raise
