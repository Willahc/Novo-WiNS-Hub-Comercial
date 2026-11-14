#!/usr/bin/env python3
"""Higienização, engenharia de features e desnormalização de cnpj-sp.db para consultas em milissegundos."""
import re
import sqlite3
import time
from pathlib import Path

DB_PATH = Path("/root/wins-hub/data/cnpj-sp.db")

ACCOUNTING_DOMAINS = {
    "contabilizei.com.br",
    "maismei.com.br",
    "agilize.com.br",
    "senhorcontabil.com.br",
    "mei.com.br",
    "meifacil.com",
    "qipu.com.br",
    "contajunta.com.br",
    "conube.com.br",
    "osayk.com.br",
    "adaflow.com",
    "heroisdomicro.com.br",
}

ACCOUNTING_LOCAL_PREFIXES = (
    "meucnpj",
    "legalizacao",
    "abertura",
    "societario",
    "paralegal",
    "cadastrocnpj",
)

EMAIL_RE = re.compile(r"^[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}$")
WS_RE = re.compile(r"\s+")


def clean_phone(raw: str) -> str:
    digits = "".join(ch for ch in (raw or "") if ch.isdigit())
    if len(digits) not in (10, 11):
        return ""
    ddd = int(digits[:2])
    if ddd < 11 or ddd > 99:
        return ""
    body = digits[2:]
    if len(set(digits)) <= 2 or len(set(body)) <= 1:
        return ""
    if body in ("12345678", "123456789", "87654321", "987654321"):
        return ""
    return digits


def is_mobile_br(phone: str) -> bool:
    return len(phone) == 11 and phone[2] == "9"


def clean_email(raw: str) -> str:
    e = (raw or "").strip().lower()
    if not e or not EMAIL_RE.match(e):
        return ""
    local, domain = e.split("@", 1)
    if domain in ACCOUNTING_DOMAINS:
        return ""
    if "contabil" in domain or local.startswith(ACCOUNTING_LOCAL_PREFIXES):
        return ""
    if domain.endswith(".com.br") and domain == "gmail.com.br":
        return local + "@gmail.com"
    return e


def clean_text(raw: str) -> str:
    return WS_RE.sub(" ", (raw or "").strip())


def compute_score(tel1: str, email: str, optante_mei: str) -> int:
    score = 0
    if tel1:
        score += 3 if is_mobile_br(tel1) else 2
    if email:
        score += 2
    if optante_mei == "S":
        score += 1
    return score


def main():
    if not DB_PATH.exists():
        raise SystemExit(f"Banco não encontrado: {DB_PATH}")

    t0 = time.time()
    conn = sqlite3.connect(str(DB_PATH))
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=OFF")
    conn.execute("PRAGMA temp_store=MEMORY")
    conn.execute("PRAGMA cache_size=-262144")

    # Verifica se já foi otimizado (colunas desnormalizadas já existem)
    cols = {r[1] for r in conn.execute("PRAGMA table_info(estabelecimentos)").fetchall()}
    already_denorm = {"optante_mei", "razao_social", "porte", "contact_score"}.issubset(cols)

    print("[1/4] Criando tabela otimizada e higienizando 8.8M registros...", flush=True)
    conn.execute("DROP TABLE IF EXISTS estabelecimentos_opt")
    conn.execute("""
        CREATE TABLE estabelecimentos_opt (
            cnpj TEXT PRIMARY KEY,
            cnpj_basico TEXT,
            nome_fantasia TEXT,
            razao_social TEXT,
            porte TEXT,
            optante_mei TEXT,
            cnae_principal TEXT,
            cnaes_secundarios TEXT,
            endereco TEXT,
            bairro TEXT,
            cep TEXT,
            municipio TEXT,
            telefone TEXT,
            telefone2 TEXT,
            email TEXT,
            contact_score INTEGER
        )
    """)

    if already_denorm:
        select_sql = """
            SELECT cnpj, cnpj_basico, nome_fantasia, razao_social, porte, optante_mei,
                   cnae_principal, cnaes_secundarios, endereco, bairro, cep, municipio,
                   telefone, telefone2, email
            FROM estabelecimentos
        """
    else:
        select_sql = """
            SELECT e.cnpj, e.cnpj_basico, e.nome_fantasia,
                   COALESCE(emp.razao_social, ''), COALESCE(emp.porte, ''),
                   COALESCE(s.optante_mei, 'N'),
                   e.cnae_principal, e.cnaes_secundarios, e.endereco, e.bairro, e.cep, e.municipio,
                   e.telefone, e.telefone2, e.email
            FROM estabelecimentos e
            LEFT JOIN empresas emp ON emp.cnpj_basico = e.cnpj_basico
            LEFT JOIN simples s ON s.cnpj_basico = e.cnpj_basico
        """

    stats = {
        "total": 0,
        "phones_cleaned": 0,
        "phones_promoted": 0,
        "emails_cleaned": 0,
        "emails_fixed": 0,
        "with_mobile": 0,
        "with_email": 0,
    }

    cur = conn.cursor()
    cur.execute(select_sql)
    batch = []
    insert_sql = "INSERT INTO estabelecimentos_opt VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)"

    while True:
        rows = cur.fetchmany(50000)
        if not rows:
            break
        for r in rows:
            stats["total"] += 1
            (cnpj, basico, fantasia, razao, porte, mei, cnae, cnaes_sec,
             end, bairro, cep, mun, raw_t1, raw_t2, raw_email) = r

            t1 = clean_phone(raw_t1)
            t2 = clean_phone(raw_t2)
            if raw_t1 and not t1:
                stats["phones_cleaned"] += 1
            if not t1 and t2:
                t1, t2 = t2, ""
                stats["phones_promoted"] += 1

            em = clean_email(raw_email)
            if raw_email and not em:
                stats["emails_cleaned"] += 1
            elif raw_email and em != raw_email.strip().lower():
                stats["emails_fixed"] += 1

            if is_mobile_br(t1):
                stats["with_mobile"] += 1
            if em:
                stats["with_email"] += 1

            mei_val = "S" if mei == "S" else "N"
            score = compute_score(t1, em, mei_val)

            batch.append((
                cnpj,
                basico,
                clean_text(fantasia),
                clean_text(razao),
                porte,
                mei_val,
                cnae,
                cnaes_sec,
                clean_text(end),
                clean_text(bairro),
                cep,
                mun,
                t1,
                t2,
                em,
                score,
            ))
        conn.executemany(insert_sql, batch)
        conn.commit()
        batch.clear()
        if stats["total"] % 1000000 == 0:
            print(f"   -> Processados {stats['total']} registros ({time.time()-t0:.1f}s)...", flush=True)

    print("[2/4] Substituindo tabela e removendo redundâncias...", flush=True)
    conn.execute("DROP TABLE estabelecimentos")
    conn.execute("ALTER TABLE estabelecimentos_opt RENAME TO estabelecimentos")
    conn.commit()

    print("[3/4] Criando índices compostos (covering)...", flush=True)
    conn.executescript("""
        CREATE INDEX idx_estab_fast ON estabelecimentos(cnae_principal, municipio, optante_mei, contact_score DESC);
        CREATE INDEX idx_estab_cnae_score ON estabelecimentos(cnae_principal, municipio, contact_score DESC);
        CREATE INDEX idx_estab_mun_mei ON estabelecimentos(municipio, optante_mei, contact_score DESC);
        CREATE INDEX idx_estab_cep ON estabelecimentos(cep);
    """)

    print("[4/4] Rodando ANALYZE e checkpoint WAL...", flush=True)
    conn.execute("ANALYZE")
    conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    conn.close()

    elapsed = time.time() - t0
    print(f"✅ Otimização concluída em {elapsed:.1f}s!", flush=True)
    print(f"   Stats: {stats}", flush=True)


if __name__ == "__main__":
    main()
