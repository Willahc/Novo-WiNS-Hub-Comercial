#!/usr/bin/env python3
"""Importador streaming da Base Aberta de CNPJ da Receita Federal filtrado para UF=SP e Situação=ATIVA (02)."""
import csv
import io
import os
import sqlite3
import subprocess
import sys
import time
import unicodedata
import zipfile
from pathlib import Path

BASE_URL = "https://arquivos.receitafederal.gov.br/public.php/webdav/2026-10"
SHARE_TOKEN = "YggdBLfdninEJX9"
DATA_DIR = Path("/root/wins-hub/data")
DB_PATH = DATA_DIR / "cnpj-sp.db"
TMP_ZIP = Path("/tmp/rfb_cnpj_part.zip")


def norm_text(s: str) -> str:
    s = unicodedata.normalize("NFKD", s or "")
    s = "".join(c for c in s if not unicodedata.combining(c))
    return " ".join(s.upper().strip().split())


def set_meta(conn: sqlite3.Connection, key: str, value: str):
    conn.execute("INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)", (key, str(value)))
    conn.commit()


def download_zip(filename: str):
    url = f"{BASE_URL}/{filename}"
    if TMP_ZIP.exists():
        TMP_ZIP.unlink()
    for attempt in range(1, 4):
        try:
            subprocess.run(
                ["curl", "-fSL", "--retry", "3", "--retry-delay", "3", "-u", f"{SHARE_TOKEN}:", url, "-o", str(TMP_ZIP)],
                check=True,
            )
            return
        except subprocess.CalledProcessError as e:
            print(f"[WARN] Tentativa {attempt} falhou para {filename}: {e}", flush=True)
            if attempt == 3:
                raise
            time.sleep(5)


def iter_csv_from_zip(zip_path: Path):
    with zipfile.ZipFile(zip_path, "r") as zf:
        for name in zf.namelist():
            with zf.open(name, "r") as raw:
                wrapper = io.TextIOWrapper(raw, encoding="latin1", errors="replace", newline="")
                reader = csv.reader(wrapper, delimiter=";", quotechar='"')
                for row in reader:
                    yield row


def main():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if DB_PATH.exists():
        DB_PATH.unlink()

    conn = sqlite3.connect(str(DB_PATH))
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=OFF")
    conn.execute("PRAGMA temp_store=MEMORY")
    conn.execute("PRAGMA cache_size=-131072")

    conn.executescript("""
        CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
        CREATE TABLE municipios (codigo TEXT PRIMARY KEY, nome TEXT, nome_norm TEXT);
        CREATE TABLE cnaes (codigo TEXT PRIMARY KEY, descricao TEXT);
        CREATE TABLE empresas (cnpj_basico TEXT PRIMARY KEY, razao_social TEXT, porte TEXT);
        CREATE TABLE simples (cnpj_basico TEXT PRIMARY KEY, optante_simples TEXT, optante_mei TEXT);
        CREATE TABLE estabelecimentos (
            cnpj TEXT PRIMARY KEY,
            cnpj_basico TEXT,
            nome_fantasia TEXT,
            cnae_principal TEXT,
            cnaes_secundarios TEXT,
            endereco TEXT,
            bairro TEXT,
            cep TEXT,
            municipio TEXT,
            telefone TEXT,
            telefone2 TEXT,
            email TEXT
        );
    """)
    set_meta(conn, "status", "importing")
    set_meta(conn, "competencia", "2026-10")
    set_meta(conn, "progress", "Baixando Municípios e CNAEs...")

    # 1. Municípios
    print("[1/4] Importando Municípios...", flush=True)
    download_zip("Municipios.zip")
    batch = []
    for row in iter_csv_from_zip(TMP_ZIP):
        if len(row) >= 2:
            batch.append((row[0].strip(), row[1].strip(), norm_text(row[1])))
    conn.executemany("INSERT OR REPLACE INTO municipios VALUES (?, ?, ?)", batch)
    conn.commit()
    TMP_ZIP.unlink(missing_ok=True)

    # 2. CNAEs
    download_zip("Cnaes.zip")
    batch = []
    for row in iter_csv_from_zip(TMP_ZIP):
        if len(row) >= 2:
            batch.append((row[0].strip(), row[1].strip()))
    conn.executemany("INSERT OR REPLACE INTO cnaes VALUES (?, ?)", batch)
    conn.commit()
    TMP_ZIP.unlink(missing_ok=True)

    # 3. Estabelecimentos (apenas UF=SP e Situação=02 ATIVA)
    sp_basicos = set()
    total_sp = 0
    for idx in range(10):
        fname = f"Estabelecimentos{idx}.zip"
        set_meta(conn, "progress", f"Estabelecimentos {idx+1}/10 ({total_sp} SP ativos)...")
        print(f"[2/4] Baixando e filtrando {fname}...", flush=True)
        download_zip(fname)
        batch = []
        for row in iter_csv_from_zip(TMP_ZIP):
            if len(row) < 28:
                continue
            if row[19].strip() != "SP" or row[5].strip() != "02":
                continue
            basico = row[0].strip()
            cnpj = basico + row[1].strip() + row[2].strip()
            sp_basicos.add(basico)
            tipo_log = row[13].strip()
            logr = row[14].strip()
            num = row[15].strip()
            comp = row[16].strip()
            end_parts = [p for p in [f"{tipo_log} {logr}".strip(), num, comp] if p]
            endereco = ", ".join(end_parts)
            ddd1, tel1 = row[21].strip(), row[22].strip()
            ddd2, tel2 = row[23].strip(), row[24].strip()
            fone1 = f"{ddd1}{tel1}" if ddd1 and tel1 else ""
            fone2 = f"{ddd2}{tel2}" if ddd2 and tel2 else ""
            batch.append((
                cnpj,
                basico,
                row[4].strip(),
                row[11].strip(),
                row[12].strip(),
                endereco,
                row[17].strip(),
                row[18].strip(),
                row[20].strip(),
                fone1,
                fone2,
                row[27].strip().lower(),
            ))
            if len(batch) >= 20000:
                conn.executemany("INSERT OR REPLACE INTO estabelecimentos VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", batch)
                conn.commit()
                total_sp += len(batch)
                batch.clear()
        if batch:
            conn.executemany("INSERT OR REPLACE INTO estabelecimentos VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", batch)
            conn.commit()
            total_sp += len(batch)
        TMP_ZIP.unlink(missing_ok=True)
        print(f"   -> Total SP ativos até agora: {total_sp}", flush=True)

    # 4. Empresas (apenas cnpj_basico de SP)
    total_emp = 0
    for idx in range(10):
        fname = f"Empresas{idx}.zip"
        set_meta(conn, "progress", f"Empresas {idx+1}/10 ({total_emp} empresas SP)...")
        print(f"[3/4] Baixando e filtrando {fname}...", flush=True)
        download_zip(fname)
        batch = []
        for row in iter_csv_from_zip(TMP_ZIP):
            if len(row) < 6:
                continue
            basico = row[0].strip()
            if basico not in sp_basicos:
                continue
            batch.append((basico, row[1].strip(), row[5].strip()))
            if len(batch) >= 20000:
                conn.executemany("INSERT OR REPLACE INTO empresas VALUES (?,?,?)", batch)
                conn.commit()
                total_emp += len(batch)
                batch.clear()
        if batch:
            conn.executemany("INSERT OR REPLACE INTO empresas VALUES (?,?,?)", batch)
            conn.commit()
            total_emp += len(batch)
        TMP_ZIP.unlink(missing_ok=True)

    # 5. Simples / MEI
    set_meta(conn, "progress", "Importando Simples Nacional / MEI...")
    print("[4/4] Baixando e filtrando Simples.zip...", flush=True)
    download_zip("Simples.zip")
    batch = []
    total_mei = 0
    for row in iter_csv_from_zip(TMP_ZIP):
        if len(row) < 5:
            continue
        basico = row[0].strip()
        if basico not in sp_basicos:
            continue
        mei = row[4].strip()
        if mei == "S":
            total_mei += 1
        batch.append((basico, row[1].strip(), mei))
        if len(batch) >= 20000:
            conn.executemany("INSERT OR REPLACE INTO simples VALUES (?,?,?)", batch)
            conn.commit()
            batch.clear()
    if batch:
        conn.executemany("INSERT OR REPLACE INTO simples VALUES (?,?,?)", batch)
        conn.commit()
    TMP_ZIP.unlink(missing_ok=True)

    # 6. Índices
    set_meta(conn, "progress", "Criando índices de busca rápida...")
    print("Criando índices...", flush=True)
    conn.executescript("""
        CREATE INDEX idx_estab_cnae_mun ON estabelecimentos(cnae_principal, municipio);
        CREATE INDEX idx_estab_mun ON estabelecimentos(municipio);
        CREATE INDEX idx_estab_cep ON estabelecimentos(cep);
        CREATE INDEX idx_mun_norm ON municipios(nome_norm);
        CREATE INDEX idx_simples_mei ON simples(optante_mei);
    """)
    set_meta(conn, "total_sp", str(total_sp))
    set_meta(conn, "total_mei", str(total_mei))
    set_meta(conn, "status", "ready")
    set_meta(conn, "progress", f"Pronto: {total_sp} empresas ativas em SP ({total_mei} MEIs)")
    conn.close()
    print(f"✅ Importação concluída! {total_sp} estabelecimentos ativos em SP ({total_mei} MEIs).", flush=True)


if __name__ == "__main__":
    main()
