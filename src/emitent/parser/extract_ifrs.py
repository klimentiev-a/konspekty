import re,json,sys
NUM=re.compile(r'\(?-?\d[\d ]*(?:,\d+)?\)?|(?<=\s)-(?=\s|$)')
def nums(line):
    # числа в конце строки: тысячи через пробел, скобки = минус
    tail=re.findall(r'(\(\s*\d[\d ]*\)|\d[\d ]*\d|\d|(?<=\s)-(?=\s|$))',line)
    return tail
def parse_line(line):
    # разбор «метка  прим.  знач1  знач2»
    m=re.match(r'^\s*(.*?)\s{2,}((?:\(?[\d ]+\)?|-)\s{2,}\(?[\d ]+\)?|(?:\(?[\d ]+\)?|-))\s*$',line)
    return None
def vals(line):
    # берём два последних «числовых блока», разделённых 2+ пробелами
    parts=re.split(r'\s{2,}',line.strip())
    out=[]
    for p in parts[::-1]:
        q=p.strip()
        if q=='-' : out.append(0);continue
        m=re.fullmatch(r'\(?\s*(\d{1,3}(?: \d{3})*|\d+)\s*\)?',q)
        if not m: break
        v=int(m.group(1).replace(' ',''))
        if q.startswith('('): v=-v
        out.append(v)
    return out[::-1]
def grab(lines,pat,start=0,end=None,nth=0,cont=True):
    end=min(end or len(lines),len(lines));k=0
    for i in range(start,end):
        if re.search(pat,lines[i]):
            v=vals(lines[i])
            if len(v)<2 and cont and i+1<end: v=vals(lines[i+1])
            if len(v)>=2:
                if k==nth: return v[-2:],i
                k+=1
    return None,None
def read(p): return open(p,encoding='utf-8').read().split('\n')
def section(lines,a,b):
    s=next(i for i,l in enumerate(lines) if re.search(a,l) and not re.search(r'\.{5}',l))
    e=next((i for i in range(s+1,len(lines)) if re.search(b,lines[i])),len(lines))
    return s,e
def extract(path):
    L=read(path)
    # границы: баланс -> ИТОГО ОБЯЗАТЕЛЬСТВА; ОПУ; ОДДС
    bs,be=section(L,r'отчет о финансовом положении',r'ИТОГО СОБСТВЕННЫЙ КАПИТАЛ И|ИТОГО КАПИТАЛ И')
    ps,pe=section(L,r'отчет о прибыли или убытке',r'Базовая|Базовый')
    cs,ce=section(L,r'отчет о движении денежных средств',r'Нетто изменение|Чистое (изменение|увеличение)')
    ce=min(ce+8,len(L))
    R={}
    def put(k,pat,a,b,nth=0):
        b=min(b,len(L))
        v,_=grab(L,pat,a,b,nth)
        R[k]=v
    put(r'ppe','^\s*Основные средства',bs,be)
    put(r'inv','^\s*Запасы',bs,be)
    put(r'recv','^\s*Торговая и прочая дебиторская',bs,be)
    put(r'st_inv','^\s*Краткосрочные финансовые вложения',bs,be)
    put(r'cash','^\s*Денежные средства и их эквиваленты',bs,be)
    put(r'assets','^\s*ИТОГО АКТИВОВ',bs,be)
    put(r'equity','^\s*ИТОГО СОБСТВЕННЫЙ КАПИТАЛ\s',bs,be+2)
    put(r'liab','^\s*ИТОГО ОБЯЗАТЕЛЬСТВА',bs,be+2)
    put(r'loan_lt','^\s*Кредиты и займы',bs,be,0)
    put(r'lease_lt','^\s*Обязательства по аренде',bs,be,0)
    put(r'loan_st','^\s*Кредиты и займы',bs,be,1)
    put(r'lease_st','^\s*Обязательства по аренде',bs,be,1)
    put(r'payables','^\s*Торговая и прочая кредиторская',bs,be)
    put(r'revenue','^\s*Выручка\s',ps,pe)
    put(r'cogs','^\s*Себестоимость продаж',ps,pe)
    put(r'gross','^\s*Валовая прибыль',ps,pe)
    put(r'sga','^\s*административные расходы|Коммерческие, общехозяйственные и\s+\d|^\s*Коммерческие, общехозяйственные',ps,pe)
    put(r'other_inc','^\s*Прочие операционные доходы',ps,pe)
    put(r'other_exp','^\s*Прочие операционные расходы',ps,pe)
    put(r'op','^\s*Операционн(ая прибыль|ый убыток|ая (прибыль|убыток)|ый (убыток|прибыль))',ps,pe)
    put(r'fin_inc','^\s*Финансовые доходы',ps,pe)
    put(r'fin_exp','^\s*Финансовые расходы',ps,pe)
    put(r'pbt','^\s*\(?(Убыток|Прибыль)\)?(/\(?(убыток|прибыль)\)?)? до налогообложения',ps,pe)
    put(r'net','^\s*\(?(Убыток|Прибыль)\)?(/\(?(убыток|прибыль)\)?)? за отчетный',ps,pe)
    put(r'da_ppe','^\s*Амортизация основных средств',cs,ce)
    put(r'da_int','^\s*Амортизация нематериальных активов',cs,ce)
    put(r'disp','^\s*Убыток от выбытия основных средств',cs,ce)
    put(r'cfo_pre','^\s*Потоки денежных средств от операционной',cs,ce)
    put(r'int_paid','^\s*Проценты уплаченные',cs,ce)
    put(r'cfo','^\s*Чистый поток денежных средств, полученных от',cs,ce)
    put(r'capex_ppe','^\s*Приобретение основных средств',cs,ce)
    put(r'capex_int','^\s*Приобретение нематериальных активов',cs,ce)
    put(r'proceeds','^\s*Поступления от займов',cs,ce)
    put(r'repay','^\s*Погашение кредитов',cs,ce)
    put(r'lease_pay','^\s*Платежи по обязательствам по аренде',cs,ce)
    # SG&A: две строки
    for i in range(ps,pe):
        if re.search(r'^\s*Коммерческие, общехозяйственные',L[i]):
            v=vals(L[i]) or vals(L[i+1]) or vals(L[i-1])
            R['sga']=v[-2:] if len(v)>=2 else None;break
    return R
if __name__=='__main__':
    out={}
    for name,p in [('1H26','/tmp/wush/1h26/r.txt'),('FY25','/tmp/wush/FY2025/r1188843.txt'),('FY24','/tmp/wush/FY2024/r778932.txt')]:
        out[name]=extract(p)
    json.dump(out,open('/tmp/wush/raw.json','w'),ensure_ascii=False,indent=1)
    for k,v in out.items():
        print('==',k)
        for a,b in v.items(): print(' ',a,b)
