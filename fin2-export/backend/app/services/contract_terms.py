"""Reviewed issue-document terms supplement ISS; missing terms are never assumed."""
from functools import lru_cache
import json
from pathlib import Path

_FILE = Path(__file__).parent / 'data' / 'verified_contract_terms.json'


@lru_cache(maxsize=1)
def registry():
    try:
        raw = json.loads(_FILE.read_text(encoding='utf-8'))
        return raw.get('issues', {}) if raw.get('version') == 1 else {}
    except (OSError, ValueError):
        return {}


def issue(isin):
    return registry().get(isin, {})


def zero_coupon(isin):
    """Explicit issuer disclosure, not an inference from a missing coupon table."""
    term = issue(isin).get('zero_coupon', {})
    return term if term.get('source') and term.get('source_sha256') and term.get('coupon_cash') == 0 else {}


def redemption_price(isin, day):
    """Only reviewed dates within an explicitly documented exercise window."""
    for event in issue(isin).get('redemptions', []):
        if event.get('source') and event['from'] <= day <= event['till']:
            return event.get('price_percent')
    return None


def call_dates(isin):
    return [event['from'] for event in issue(isin).get('redemptions', [])
            if event.get('type') == 'CALL' and event.get('source')]
